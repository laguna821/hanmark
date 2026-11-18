import { convertToHwpx, parse, validateHwpx } from "kordoc";
import { bytesAsArrayBuffer } from "./fileGateway";
import { finalizeHwpxPackage } from "./hwpxPostProcess";
import { kordocParseOptions } from "./importOptions";
import { describeImportFailure } from "./messageCatalog";
import { t } from "../i18n";

/**
 * HWP to HWPX conversion (3.0.0, R-034).
 *
 * Kordoc's own converter runs in memory: HWP 5.x keeps its formatting, HWP 3.x
 * carries text and tables over with default formatting. The second engine Kordoc
 * offers (saving through Hancom Office) is removed from the bundle; the engine
 * is named here so that no default can ever select it.
 */
export const HWP_CONVERT_ENGINE = "kordoc" as const;

export interface ConvertedHwp {
  data: ArrayBuffer;
  /** "preserve": formatting kept (HWP 5.x). "content": text and tables only (HWP 3.x). */
  mode: "preserve" | "content";
  /** Sentences for the report, already localized. */
  notes: string[];
}

export class HwpConvertError extends Error {
  constructor(
    message: string,
    /** Asking for the open password can make a retry succeed. */
    readonly passwordHelps: boolean,
    readonly original: string
  ) {
    super(message);
    this.name = "HwpConvertError";
  }
}

/** True for a ZIP package (HWPX); HWP 5.x is an OLE2 file and HWP 3.x a plain binary. */
export function isHwpxBytes(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
}

function copy(bytes: Uint8Array): ArrayBuffer {
  return bytesAsArrayBuffer(bytes.slice());
}

/** Why a conversion failed, in the words the import report uses. */
async function explainFailure(bytes: Uint8Array, error: unknown, password?: string): Promise<HwpConvertError> {
  const original = error instanceof Error ? error.message : String(error);
  try {
    const parsed = await parse(copy(bytes), kordocParseOptions({ images: false, ...(password ? { password } : {}) }));
    if (!parsed.success) {
      const described = describeImportFailure(parsed.code, parsed.fileType);
      return new HwpConvertError(`${described.title} ${described.fix ?? ""}`.trim(), Boolean(described.passwordHelps), original);
    }
  } catch {
    // The reader failed as well; the converter's own message is all there is.
  }
  return new HwpConvertError(t("convert.error.failed", { detail: original }), false, original);
}

/**
 * Converts one HWP document to a validated, deterministic HWPX package. An HWPX
 * input is returned re-packed (same content). Nothing is written anywhere.
 */
export async function convertHwpToHwpx(bytes: Uint8Array, password?: string): Promise<ConvertedHwp> {
  let converted: Awaited<ReturnType<typeof convertToHwpx>>;
  try {
    converted = await convertToHwpx(bytes.slice(), { engine: HWP_CONVERT_ENGINE, ...(password ? { password } : {}) });
  } catch (error: unknown) {
    throw await explainFailure(bytes, error, password);
  }
  // Fixed ZIP dates and entry order: the same document gives the same bytes on every run.
  const finalized = await finalizeHwpxPackage(copy(converted.data));
  const validation = await validateHwpx(finalized.data);
  if (!validation.ok) {
    const detail = validation.issues.slice(0, 3).map((issue) => issue.message).join(" / ");
    throw new HwpConvertError(t("convert.error.invalid", { detail }), false, detail);
  }
  const notes: string[] = [];
  if (converted.mode === "content") notes.push(t("convert.note.contentOnly"));
  else notes.push(...converted.warnings);
  return { data: finalized.data, mode: converted.mode, notes };
}

/**
 * The HWPX package a form is filled through: an HWPX form as it is, an HWP 5.x
 * form converted with its formatting. HWP 3.x forms are refused, because their
 * conversion rebuilds the document with default formatting.
 */
export async function formTemplateHwpx(bytes: Uint8Array): Promise<{ hwpx: Uint8Array; source: "hwpx" | "hwp" }> {
  if (isHwpxBytes(bytes)) return { hwpx: bytes, source: "hwpx" };
  const converted = await convertHwpToHwpx(bytes);
  if (converted.mode !== "preserve") throw new Error(t("form.hwp3Unsupported"));
  return { hwpx: new Uint8Array(converted.data), source: "hwp" };
}
