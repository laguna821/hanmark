import JSZip from "jszip";
import {
  applyMeasuredLayout,
  buildAgencyPack,
  loadAgencyPack,
  markdownToHwpx,
  measurePdfLayout,
  packRoleWarnings,
  packTemplate,
  resolvePackKind,
  type GongmunOptions,
  type PdfLayoutSpec
} from "kordoc";
import { base64ToBytes, bytesToBase64 } from "./pngMeta";

/**
 * A look learned from one sample document of the user's institution (R-036).
 *
 * HWPX sample: Kordoc empties the sample into a template ("기관팩", a .kpack zip without
 * code) and later fills that template with the note, so page setup, fonts, paragraph
 * shapes and table borders are the sample's own. The pack is kept in plugin data, so
 * the sample file may move or be deleted, and the same pack bytes are what a colleague
 * imports.
 *
 * PDF sample: nothing of the file is kept. Kordoc measures margins, line spacing and
 * the font and size of each bullet level, and those values fill official-document
 * options the user can still edit.
 */
export interface SampleFacts {
  /** Page size in mm. */
  pageMm: { width: number; height: number };
  /** Margins in mm (header and footer are the bands inside top and bottom). */
  marginsMm: { top: number; bottom: number; left: number; right: number; header: number; footer: number };
  /** Font names of the sample's font table, in order. */
  fonts: string[];
}

export interface SampleLookRecord {
  /** The .kpack bytes, base64. */
  pack: string;
  /** Document kind inside the pack the look uses. */
  kind: string;
  /** Parts the sample has (title, contact, summary, chapter, L0..L3, body, ref, table, …). */
  roles: string[];
  /** Parts the sample lacks; the engine uses the nearest shape for them. */
  missing: string[];
  /** Fixed text left in the emptied sample (letterheads and the like); shown before sharing. */
  leftover: string[];
  /** Pictures kept in the emptied sample (logos). */
  images: number;
  facts: SampleFacts;
  /** Fingerprint of the sample the engine recorded; the sample itself is not kept. */
  sourceSha256: string;
}

/** Largest sample HanMark reads, and largest pack it stores or imports. */
export const SAMPLE_MAX_BYTES = 20 * 1024 * 1024;
export const SAMPLE_PACK_MAX_BYTES = 1024 * 1024;
const PACK_MAX_ENTRIES = 16;
const PACK_MAX_UNPACKED_BYTES = 8 * 1024 * 1024;
const PACK_ENTRY_NAME = /^(?:pack\.json|guide\.md|kinds\/|kinds\/[\p{L}\p{N}_ .()-]{1,60}\.hwpx)$/u;

export type SampleLookErrorCode = "too-large" | "not-hwpx" | "pack-too-large" | "pack-invalid" | "engine";

export class SampleLookError extends Error {
  constructor(
    readonly code: SampleLookErrorCode,
    detail = ""
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "SampleLookError";
  }
}

const HWPUNIT_PER_MM = 7200 / 25.4;
const mm = (hwpunit: string | undefined): number => Math.round((Number(hwpunit ?? 0) / HWPUNIT_PER_MM) * 10) / 10;

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`, "u").exec(tag)?.[1];
}

/** Page setup and fonts read straight from a HWPX package (no rendering). */
export async function readSampleFacts(hwpx: Uint8Array): Promise<SampleFacts> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(hwpx);
  } catch {
    throw new SampleLookError("not-hwpx");
  }
  const header = (await zip.file("Contents/header.xml")?.async("string")) ?? "";
  const section = (await zip.file("Contents/section0.xml")?.async("string")) ?? "";
  if (!header || !section) throw new SampleLookError("not-hwpx");
  const page = /<hp:pagePr\b[^>]*>/u.exec(section)?.[0] ?? "";
  const margin = /<hp:margin\b[^>]*>/u.exec(section)?.[0] ?? "";
  const landscape = attribute(page, "landscape") === "NARROWLY";
  const width = mm(attribute(page, "width"));
  const height = mm(attribute(page, "height"));
  const fonts: string[] = [];
  for (const match of header.matchAll(/<hh:font\b[^>]*\bface="([^"]+)"/gu)) {
    if (!fonts.includes(match[1])) fonts.push(match[1]);
  }
  return {
    pageMm: landscape ? { width: height, height: width } : { width, height },
    marginsMm: {
      top: mm(attribute(margin, "top")),
      bottom: mm(attribute(margin, "bottom")),
      left: mm(attribute(margin, "left")),
      right: mm(attribute(margin, "right")),
      header: mm(attribute(margin, "header")),
      footer: mm(attribute(margin, "footer"))
    },
    fonts: fonts.slice(0, 24)
  };
}

function recordFromPack(
  packBytes: Uint8Array,
  kind: string,
  info: { roles: readonly string[]; missing: readonly string[]; leftover: readonly string[]; images: number },
  facts: SampleFacts,
  sourceSha256: string
): SampleLookRecord {
  return {
    pack: bytesToBase64(packBytes),
    kind,
    roles: [...info.roles],
    missing: [...info.missing],
    leftover: info.leftover.map((text) => text.slice(0, 120)).slice(0, 40),
    images: info.images,
    facts,
    sourceSha256
  };
}

/**
 * Checks a .kpack as an untrusted file before the engine reads it: size, entry
 * count, unpacked size, and entry names (only the manifest, the guide and one HWPX
 * per kind; no folders above the pack, no drive or device names).
 */
async function assertSafePack(bytes: Uint8Array): Promise<void> {
  if (bytes.length > SAMPLE_PACK_MAX_BYTES) throw new SampleLookError("pack-too-large", String(bytes.length));
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new SampleLookError("pack-invalid", "zip");
  }
  const names = Object.keys(zip.files);
  if (!names.includes("pack.json") || names.length > PACK_MAX_ENTRIES) throw new SampleLookError("pack-invalid", "entries");
  let unpacked = 0;
  for (const name of names) {
    if (!PACK_ENTRY_NAME.test(name) || name.includes("..")) throw new SampleLookError("pack-invalid", "name");
    const entry = zip.files[name];
    if (entry.dir) continue;
    unpacked += (await entry.async("uint8array")).length;
    if (unpacked > PACK_MAX_UNPACKED_BYTES) throw new SampleLookError("pack-too-large", "unpacked");
  }
}

async function recordFromPackBytes(bytes: Uint8Array): Promise<SampleLookRecord> {
  await assertSafePack(bytes);
  try {
    const pack = await loadAgencyPack(bytes);
    const kind = resolvePackKind(pack);
    const info = pack.manifest.kinds[kind];
    const template = packTemplate(pack, kind);
    const facts = await readSampleFacts(template);
    const source = pack.manifest.sources.find((item) => item.kind === kind) ?? pack.manifest.sources[0];
    return recordFromPack(bytes, kind, info, facts, source?.sha256 ?? "");
  } catch (error: unknown) {
    if (error instanceof SampleLookError) throw error;
    throw new SampleLookError("pack-invalid", error instanceof Error ? error.message : String(error));
  }
}

/**
 * A HWPX saved by older generators (HanMark 2.7 among them) has no version.xml. The
 * engine copies the sample's package, so a document made from such a sample would fail
 * the package check; the part is added from a package the engine writes itself.
 */
async function withVersionPart(sample: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(sample);
  if (zip.file("version.xml")) return sample;
  const version = await (await JSZip.loadAsync(await markdownToHwpx(""))).file("version.xml")?.async("uint8array");
  if (!version) return sample;
  const out = new JSZip();
  const fixed = { date: new Date(Date.UTC(1980, 0, 1)) };
  const mimetype = await zip.file("mimetype")?.async("uint8array");
  if (mimetype) out.file("mimetype", mimetype, { ...fixed, compression: "STORE" });
  out.file("version.xml", version, fixed);
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir || name === "mimetype") continue;
    out.file(name, await entry.async("uint8array"), fixed);
  }
  return out.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Learns a look from one sample HWPX. The sample is not kept; the emptied template is. */
export async function learnLookFromHwpx(sample: Uint8Array, name: string): Promise<SampleLookRecord> {
  if (sample.length > SAMPLE_MAX_BYTES) throw new SampleLookError("too-large", String(sample.length));
  // Facts come from the sample itself, so the summary shows what the user gave.
  const facts = await readSampleFacts(sample);
  let built: Awaited<ReturnType<typeof buildAgencyPack>>;
  try {
    built = await buildAgencyPack(name.trim().slice(0, 80) || "sample", [{ data: await withVersionPart(sample) }]);
  } catch (error: unknown) {
    throw new SampleLookError("engine", error instanceof Error ? error.message : String(error));
  }
  const record = await recordFromPackBytes(built.pack);
  return { ...record, facts };
}

/** Reads a look from a .kpack file someone shared. */
export async function importSampleLookPack(bytes: Uint8Array): Promise<SampleLookRecord> {
  return recordFromPackBytes(bytes);
}

/** The .kpack bytes of a stored look (the same bytes on every export). */
export function exportSampleLookPack(record: SampleLookRecord): Uint8Array {
  const bytes = base64ToBytes(record.pack);
  if (!bytes) throw new SampleLookError("pack-invalid", "base64");
  return bytes;
}

/** A stored record read back from plugin data; undefined when it is not a usable look. */
export function normalizeSampleLookRecord(value: unknown): SampleLookRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const data = value as Record<string, unknown>;
  if (typeof data.pack !== "string" || !data.pack || data.pack.length > Math.ceil(SAMPLE_PACK_MAX_BYTES / 3) * 4 + 4) return undefined;
  if (!base64ToBytes(data.pack)) return undefined;
  const strings = (input: unknown, limit: number): string[] =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === "string").slice(0, limit) : [];
  const facts = (typeof data.facts === "object" && data.facts !== null ? data.facts : {}) as Partial<SampleFacts>;
  const number = (input: unknown): number => (typeof input === "number" && Number.isFinite(input) ? input : 0);
  const margins = (facts.marginsMm ?? {}) as Partial<SampleFacts["marginsMm"]>;
  const page = (facts.pageMm ?? {}) as Partial<SampleFacts["pageMm"]>;
  return {
    pack: data.pack,
    kind: typeof data.kind === "string" && data.kind ? data.kind.slice(0, 60) : "report",
    roles: strings(data.roles, 40),
    missing: strings(data.missing, 40),
    leftover: strings(data.leftover, 40),
    images: number(data.images),
    facts: {
      pageMm: { width: number(page.width), height: number(page.height) },
      marginsMm: {
        top: number(margins.top),
        bottom: number(margins.bottom),
        left: number(margins.left),
        right: number(margins.right),
        header: number(margins.header),
        footer: number(margins.footer)
      },
      fonts: strings(facts.fonts, 24)
    },
    sourceSha256: typeof data.sourceSha256 === "string" ? data.sourceSha256.slice(0, 80) : ""
  };
}

export interface SampleLookTemplate {
  /** The emptied sample the engine fills. */
  template: Uint8Array;
  /** Engine notes about parts of this note the sample has no shape for. */
  roleWarnings: (markdown: string) => string[];
}

/** Opens a stored look for generation. The pack is checked again as untrusted input. */
export async function openSampleLook(record: SampleLookRecord): Promise<SampleLookTemplate> {
  const bytes = exportSampleLookPack(record);
  await assertSafePack(bytes);
  const pack = await loadAgencyPack(bytes);
  const kind = resolvePackKind(pack, record.kind in pack.manifest.kinds ? record.kind : undefined);
  const info = pack.manifest.kinds[kind];
  return { template: packTemplate(pack, kind), roleWarnings: (markdown) => packRoleWarnings(info, markdown) };
}

export interface PdfLookResult {
  /** Official-document options with the measured values filled in. */
  options: GongmunOptions;
  /** What was taken, one line each (engine wording). */
  applied: string[];
  warnings: string[];
  spec: PdfLayoutSpec;
}

/** Measures a report PDF and fills official-document options; nothing of the PDF is kept. */
export async function learnLookFromPdf(pdf: Uint8Array, base: GongmunOptions): Promise<PdfLookResult> {
  if (pdf.length > SAMPLE_MAX_BYTES) throw new SampleLookError("too-large", String(pdf.length));
  let spec: PdfLayoutSpec;
  try {
    spec = await measurePdfLayout(pdf);
  } catch (error: unknown) {
    throw new SampleLookError("engine", error instanceof Error ? error.message : String(error));
  }
  const result = applyMeasuredLayout(base, spec);
  return { options: result.gongmun, applied: result.applied, warnings: [...spec.warnings, ...result.warnings], spec };
}
