import { hwpToHwpx, parse, validateHwpx } from "kordoc";
import { bytesAsArrayBuffer } from "./fileGateway";
import { finalizeHwpxPackage } from "./hwpxPostProcess";
import { generateValidatedHwpx } from "./kordocEngine";
import { kordocParseOptions } from "./importOptions";
import { describeImportFailure } from "./messageCatalog";
import { t } from "../i18n";

/**
 * HWP to HWPX conversion (3.0.0, R-034).
 *
 * HWP 5.x goes through Kordoc's formatting-preserving converter (`hwpToHwpx`), in
 * memory. HWP 3.x has no such converter: its text, tables and pictures are read
 * and written as a new document with default formatting, and the report says so.
 *
 * Kordoc's `convertToHwpx` wraps both and adds an engine that saves through Hancom
 * Office. HanMark does not call it: the wrapper loads Kordoc's whole entry module
 * (OCR and print code included), and the choice of engine should not exist here.
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

/** True for an OLE2 compound file, the container of HWP 5.x. */
export function isOle2Bytes(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

/** True for a ZIP package (HWPX); HWP 5.x is an OLE2 file and HWP 3.x a plain binary. */
export function isHwpxBytes(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
}

function copy(bytes: Uint8Array): ArrayBuffer {
  return bytesAsArrayBuffer(bytes.slice());
}

/** Reads a document as it stands (layout tables kept, script tags on), through the offline whitelist. */
function readDocument(bytes: Uint8Array, password?: string): ReturnType<typeof parse> {
  return parse(copy(bytes), kordocParseOptions({ layoutTables: "keep", scriptTags: true, ...(password ? { password } : {}) }));
}

/** Why a conversion failed, in the words the import report uses. */
async function explainFailure(bytes: Uint8Array, error: unknown, password?: string): Promise<HwpConvertError> {
  const original = error instanceof Error ? error.message : String(error);
  try {
    const parsed = await readDocument(bytes, password);
    if (!parsed.success) {
      const described = describeImportFailure(parsed.code, parsed.fileType);
      return new HwpConvertError(`${described.title} ${described.fix ?? ""}`.trim(), Boolean(described.passwordHelps), original);
    }
  } catch {
    // The reader failed as well; the converter's own message is all there is.
  }
  return new HwpConvertError(t("convert.error.failed", { detail: original }), false, original);
}

const REBUILD_FORMATS: readonly string[] = ["hwp3", "hwpml"];

/**
 * HWP 3.x (and HWPML): read the document as it stands, layout tables and all, and
 * write its text, tables and pictures as a new HWPX with default formatting.
 */
async function rebuildAsHwpx(bytes: Uint8Array, password?: string): Promise<Uint8Array> {
  const parsed = await readDocument(bytes, password);
  if (!parsed.success) {
    const described = describeImportFailure(parsed.code, parsed.fileType);
    throw new HwpConvertError(`${described.title} ${described.fix ?? ""}`.trim(), Boolean(described.passwordHelps), parsed.error);
  }
  if (!REBUILD_FORMATS.includes(parsed.fileType)) {
    throw new HwpConvertError(t("convert.error.notHwp"), false, parsed.fileType);
  }
  const pictures = new Map(parsed.images?.map((image) => [image.filename, image]) ?? []);
  const generated = await generateValidatedHwpx(parsed.markdown, {
    images: {
      allowFailures: true,
      loader: (source) => {
        const picture = pictures.get(decodeURIComponent(source));
        return picture
          ? Promise.resolve({ data: picture.data, contentType: picture.mimeType })
          : Promise.reject(new Error(source));
      }
    }
  });
  return new Uint8Array(generated.data);
}

/**
 * Converts one HWP document to a validated, deterministic HWPX package. An HWPX
 * input is returned re-packed (same content). Nothing is written anywhere.
 */
export async function convertHwpToHwpx(bytes: Uint8Array, password?: string): Promise<ConvertedHwp> {
  let converted: { data: Uint8Array; mode: "preserve" | "content"; warnings: string[] };
  try {
    if (isHwpxBytes(bytes)) {
      converted = { data: bytes, mode: "preserve", warnings: [] };
    } else if (isOle2Bytes(bytes)) {
      converted = { data: await hwpToHwpx(bytes.slice(), password ? { password } : {}), mode: "preserve", warnings: [] };
    } else {
      converted = { data: await rebuildAsHwpx(bytes, password), mode: "content", warnings: [] };
    }
  } catch (error: unknown) {
    if (error instanceof HwpConvertError) throw error;
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
