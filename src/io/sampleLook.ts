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
import { normalizeGongmunStyleOptions, type GongmunStyleOptions } from "./gongmunStyle";
import { measureSample, measuredStyleOptions, type MeasuredItem, type MeasuredShape, type SampleMeasure } from "./sampleMeasure";

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
  /**
   * How documents are made with the look:
   * - "template": the engine fills the emptied sample, so every shape the sample has is
   *   the sample's own; HanMark's official-document outline and finishing do not run.
   * - "measured": the frame's own structure with the values measured from the sample
   *   (margins, body and level fonts and sizes, line spacing, table header fill); outline and
   *   finishing run as for any form.
   */
  use: SampleLookUse;
  /** Fill of the sample's table header row; drawn by HanMark's finishing when the look is used by its measured values. */
  headerFill?: string;
  /** What was read from the sample, part by part, for the summary shown with the look. */
  measured?: MeasuredItem[];
  /** A trial document made from the sample kept the sample's shapes (the reason for `use` when it was chosen automatically). */
  templateFits?: boolean;
}

export type SampleLookUse = "template" | "measured";

/** Roles that carry a note's running content; a sample with none of them is used by its measured values. */
const CONTENT_ROLES = ["body", "L0", "L1", "L2"];

/** The way a sample is best used when nothing was tried: as a template when it has shapes for running content. */
export function suggestedSampleUse(roles: readonly string[]): SampleLookUse {
  return roles.some((role) => CONTENT_ROLES.includes(role)) ? "template" : "measured";
}

// i18n-data-begin: a trial document (content, not UI text)
const TRIAL_NOTE = [
  "# 시험 문서",
  "",
  "## 첫째 장",
  "",
  "- 첫째 단계 항목을 충분히 길게 적은 줄입니다",
  "- 첫째 단계 항목을 한 줄 더 적습니다",
  "  - 둘째 단계 항목을 충분히 길게 적은 줄입니다",
  "  - 둘째 단계 항목을 한 줄 더 적습니다",
  "",
  "본문 문단을 충분히 길게 적은 줄입니다. 한 문장을 더 적습니다.",
  "",
  "본문 문단을 하나 더 충분히 길게 적은 줄입니다.",
  ""
].join("\n");
// i18n-data-end

/**
 * Tries the sample as a template: a small document with items and running text is
 * made from it and measured. The sample fits when that content comes out in the
 * sample's own body font (or the font of a level the sample has); otherwise the
 * engine stood in a shape of its own and the measured values serve the look better.
 */
async function templateKeepsSampleShapes(template: Uint8Array, measure: SampleMeasure): Promise<boolean> {
  if (!measure.body) return false;
  try {
    const made = await measureSample(new Uint8Array(await markdownToHwpx(TRIAL_NOTE, { template, totalRow: "keep" })));
    const allowed = new Set([measure.body.font, ...Object.values(measure.levels).map((level) => level.font)]);
    const used = [made.body, ...Object.values(made.levels)].filter((shape): shape is MeasuredShape => !!shape);
    return used.length > 0 && used.every((shape) => allowed.has(shape.font));
  } catch {
    return false;
  }
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
    leftover: info.leftover.map((text) => text.slice(0, 400)).slice(0, 60),
    images: info.images,
    facts,
    sourceSha256,
    use: suggestedSampleUse(info.roles)
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

const XML_TOKEN = /<hp:subList\b[^>]*>|<\/hp:subList>|<hp:p\b[^>]*>|<\/hp:p>|<hp:t\b[^>]*\/>|<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>/gu;
const PLAIN_PARAGRAPH = /^(?:<\/?hp:(?:p|run|t|linesegarray|lineseg|tab|lineBreak|fwSpace|nbSpace)\b[^>]*>|[^<])*$/u;
/** Text the engine writes into an emptied sample to mark where a part goes. */
const ENGINE_PLACEHOLDERS = new Set(["문서 제목", "□ 첫째 단계 항목", "○ 둘째 단계 항목", "- 셋째 단계 항목", "· 넷째 단계 항목", "기호 항목", "부호 없는 본문 문단", "참고 문구"]); // i18n-data: placeholder text Kordoc writes into a template

const plainText = (xml: string): string =>
  xml.replace(/<[^>]+>/gu, "").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&amp;/gu, "&");
const oneLine = (text: string): string => text.replace(/\s+/gu, " ").trim();

interface TextParagraph {
  start: number;
  end: number;
  /** The paragraph's own text, without the text of tables inside it. */
  text: string;
  runs: Array<{ start: number; end: number }>;
  /** The cell (or the page body) the paragraph sits in. */
  container: number;
  nested: boolean;
}

/** Paragraphs of one section, each with only its own text runs. */
function textParagraphs(xml: string): TextParagraph[] {
  const done: TextParagraph[] = [];
  const open: Array<TextParagraph & { parts: string[] }> = [];
  const containers: number[] = [0];
  let serial = 0;
  for (const match of xml.matchAll(XML_TOKEN)) {
    const token = match[0];
    const at = match.index;
    if (token.startsWith("<hp:subList")) containers.push(++serial);
    else if (token === "</hp:subList>") { if (containers.length > 1) containers.pop(); }
    else if (token.startsWith("<hp:p")) {
      const parent = open[open.length - 1];
      if (parent) parent.nested = true;
      open.push({ start: at, end: at, text: "", runs: [], container: containers[containers.length - 1], nested: false, parts: [] });
    } else if (token === "</hp:p>") {
      const paragraph = open.pop();
      if (!paragraph) continue;
      const { parts, ...rest } = paragraph;
      done.push({ ...rest, end: at + token.length, text: oneLine(parts.join("")) });
    } else if (match[1] !== undefined) {
      const paragraph = open[open.length - 1];
      if (!paragraph) continue;
      paragraph.parts.push(plainText(match[1]));
      const bodyStart = at + token.indexOf(">") + 1;
      paragraph.runs.push({ start: bodyStart, end: at + token.length - "</hp:t>".length });
    }
  }
  return done;
}

const lettersIn = (text: string): number => (text.match(/[\p{L}\p{N}]/gu) ?? []).length;

async function sectionXmls(hwpx: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(hwpx);
  const names = Object.keys(zip.files).filter((name) => /^Contents\/section\d+\.xml$/u.test(name)).sort();
  return Promise.all(names.map(async (name) => (await zip.file(name)?.async("string")) ?? ""));
}

/**
 * Whole paragraphs of the sample that are still in the emptied template: slogans,
 * letterheads, subtitle lines. The engine lists such text run by run and stops after
 * a dozen; a reader thinks in lines, and removing must take the whole line.
 */
async function fixedParagraphTexts(template: Uint8Array, sample: Uint8Array): Promise<string[]> {
  const inSample = new Set<string>();
  for (const xml of await sectionXmls(sample)) for (const paragraph of textParagraphs(xml)) if (paragraph.text) inSample.add(paragraph.text);
  const found: string[] = [];
  for (const xml of await sectionXmls(template)) {
    for (const paragraph of textParagraphs(xml)) {
      const text = paragraph.text;
      if (lettersIn(text) < 3 || ENGINE_PLACEHOLDERS.has(text) || !inSample.has(text) || found.includes(text)) continue;
      found.push(text);
    }
  }
  return found;
}

/**
 * Takes fixed lines out of one section. A plain line that is not alone in its cell is
 * removed whole; any other keeps its paragraph (and what is anchored in it) and loses its text.
 */
function withoutParagraphs(xml: string, wanted: ReadonlySet<string>, removed: Set<string>): string {
  const paragraphs = textParagraphs(xml);
  const hits = paragraphs.filter((paragraph) => paragraph.text && wanted.has(paragraph.text));
  if (!hits.length) return xml;
  const left = new Map<number, number>();
  for (const paragraph of paragraphs) left.set(paragraph.container, (left.get(paragraph.container) ?? 0) + 1);
  const cuts: Array<{ start: number; end: number }> = [];
  for (const paragraph of hits) {
    removed.add(paragraph.text);
    const alone = (left.get(paragraph.container) ?? 0) <= 1;
    if (!paragraph.nested && !alone && PLAIN_PARAGRAPH.test(xml.slice(paragraph.start, paragraph.end))) {
      left.set(paragraph.container, (left.get(paragraph.container) ?? 0) - 1);
      cuts.push({ start: paragraph.start, end: paragraph.end });
    } else {
      cuts.push(...paragraph.runs);
    }
  }
  cuts.sort((a, b) => b.start - a.start);
  let out = xml;
  let limit = Number.POSITIVE_INFINITY;
  for (const cut of cuts) {
    if (cut.end > limit) continue;
    out = out.slice(0, cut.start) + out.slice(cut.end);
    limit = cut.start;
  }
  return out;
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
  const lines = await fixedParagraphTexts((await openSampleLook(record)).template, sample);
  const runs = record.leftover.filter((text) => !lines.some((line) => line.includes(oneLine(text))));
  return { ...record, facts, leftover: [...lines, ...runs].map((text) => text.slice(0, 400)).slice(0, 60) };
}

/** What learning from one sample gives: the pack, the measured values, and the table look. */
export interface LearnedLook {
  sample: SampleLookRecord;
  /** Official-document options carrying the measured values (used by "measured", editable). */
  options: GongmunStyleOptions;
  /** What was read from the sample, part by part. */
  items: MeasuredItem[];
  measure: SampleMeasure;
  /** A trial document made from the sample came out in the sample's own shapes. */
  templateFits: boolean;
}

/** Learns everything HanMark can take from one sample HWPX. */
export async function learnLook(sample: Uint8Array, name: string): Promise<LearnedLook> {
  const record = await learnLookFromHwpx(sample, name);
  const measure = await measureSample(sample);
  const measured = measuredStyleOptions(measure);
  const templateFits =
    suggestedSampleUse(record.roles) === "template" && (await templateKeepsSampleShapes((await openSampleLook(record)).template, measure));
  const headerFill = measure.table?.headerFill;
  return {
    sample: { ...record, use: templateFits ? "template" : "measured", ...(headerFill ? { headerFill } : {}), measured: measured.items, templateFits },
    options: measured.options,
    items: measured.items,
    measure,
    templateFits
  };
}

/**
 * Removes chosen fixed text (letterheads, slogans) from the emptied sample inside a
 * look, so a shared pack does not carry it. A whole line found at learning time goes
 * as a line; text the engine listed run by run is matched run by run.
 */
export async function removeLeftoverText(record: SampleLookRecord, texts: readonly string[]): Promise<SampleLookRecord> {
  const wanted = new Set(texts.map((text) => text.trim()).filter(Boolean));
  if (!wanted.size) return record;
  const wantedLines = new Set([...wanted].map(oneLine));
  const packBytes = exportSampleLookPack(record);
  await assertSafePack(packBytes);
  const pack = await JSZip.loadAsync(packBytes);
  const fixed = { date: new Date(Date.UTC(1980, 0, 1)) };
  const decode = (text: string): string =>
    text.replace(/<[^>]+>/gu, "").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&amp;/gu, "&").trim();
  const out = new JSZip();
  const removed = new Set<string>();
  for (const name of Object.keys(pack.files)) {
    const entry = pack.files[name];
    if (entry.dir) continue;
    let bytes = await entry.async("uint8array");
    if (/^kinds\/.+\.hwpx$/u.test(name)) {
      const inner = await JSZip.loadAsync(bytes);
      const rebuilt = new JSZip();
      for (const part of Object.keys(inner.files)) {
        const item = inner.files[part];
        if (item.dir) continue;
        if (/^Contents\/.+\.xml$/u.test(part)) {
          const source = await item.async("string");
          const lineRemoved = new Set<string>();
          const withoutLines = /^Contents\/section\d+\.xml$/u.test(part) ? withoutParagraphs(source, wantedLines, lineRemoved) : source;
          for (const text of wanted) if (lineRemoved.has(oneLine(text))) removed.add(text);
          const xml = withoutLines.replace(/<hp:t\b([^>]*)>([\s\S]*?)<\/hp:t>/gu, (whole: string, attrs: string, body: string) => {
            const text = decode(body);
            if (!wanted.has(text)) return whole;
            removed.add(text);
            return `<hp:t${attrs}></hp:t>`;
          });
          rebuilt.file(part, xml, fixed);
        } else {
          rebuilt.file(part, await item.async("uint8array"), { ...fixed, ...(part === "mimetype" ? { compression: "STORE" as const } : {}) });
        }
      }
      bytes = await rebuilt.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    } else if (name === "pack.json") {
      const manifest = JSON.parse(await entry.async("string")) as { kinds?: Record<string, { leftover?: string[] }> };
      for (const kind of Object.values(manifest.kinds ?? {})) {
        if (Array.isArray(kind.leftover)) kind.leftover = kind.leftover.filter((text) => !wanted.has(String(text).trim()));
      }
      bytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    }
    out.file(name, bytes, fixed);
  }
  const rebuiltPack = await out.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const next = await recordFromPackBytes(rebuiltPack);
  return {
    ...next,
    facts: record.facts,
    use: record.use,
    ...(record.headerFill ? { headerFill: record.headerFill } : {}),
    ...(record.measured ? { measured: record.measured } : {}),
    ...(record.templateFits !== undefined ? { templateFits: record.templateFits } : {}),
    leftover: record.leftover.filter((text) => !removed.has(text.trim()))
  };
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

const MEASURED_PARTS = ["margins", "body", "lineSpacing", "level0", "level1", "level2", "level3", "ref", "tableFont", "tableHeaderFill"];

function normalizeMeasuredItems(value: unknown): MeasuredItem[] {
  if (!Array.isArray(value)) return [];
  const out: MeasuredItem[] = [];
  for (const item of value.slice(0, 20) as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const data = item as Record<string, unknown>;
    if (typeof data.part !== "string" || !MEASURED_PARTS.includes(data.part)) continue;
    const source = data.source === "sample" || data.source === "body" || data.source === "table" ? data.source : "none";
    out.push({ part: data.part as MeasuredItem["part"], source, value: typeof data.value === "string" ? data.value.slice(0, 120) : "" });
  }
  return out;
}

/** What a shared look file carries besides the emptied sample: the values its maker saw and could edit. */
export interface SharedLookData {
  name: string;
  /** Document type the look was made for (a Kordoc preset key). */
  preset?: string;
  options: GongmunStyleOptions;
  use: SampleLookUse;
  headerFill?: string;
  measured?: MeasuredItem[];
}

const SHARED_OPEN = "<!-- hanmark-look:";
const SHARED_CLOSE = "-->";
const SHARED_MAX_CHARS = 20_000;

/**
 * The look as a file for a colleague: the .kpack with HanMark's values written as a
 * comment at the end of the pack's guide, so Kordoc still reads the pack and HanMark
 * restores the look exactly. The same look and values give the same bytes.
 */
export async function exportSharedLookPack(record: SampleLookRecord, data: SharedLookData): Promise<Uint8Array> {
  const packBytes = exportSampleLookPack(record);
  await assertSafePack(packBytes);
  const pack = await JSZip.loadAsync(packBytes);
  const fixed = { date: new Date(Date.UTC(1980, 0, 1)) };
  const out = new JSZip();
  const payload = bytesToBase64(new TextEncoder().encode(JSON.stringify(data)));
  for (const name of Object.keys(pack.files)) {
    const entry = pack.files[name];
    if (entry.dir) continue;
    if (name === "guide.md") {
      const guide = (await entry.async("string")).split(SHARED_OPEN)[0].trimEnd();
      out.file(name, `${guide}\n\n${SHARED_OPEN}${payload}${SHARED_CLOSE}\n`, fixed);
    } else {
      out.file(name, await entry.async("uint8array"), fixed);
    }
  }
  const bytes = await out.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  await assertSafePack(bytes);
  return bytes;
}

export interface ImportedLook {
  learned: LearnedLook;
  /** The maker's values, when the file carries them; otherwise the look is measured again from the emptied sample. */
  shared?: SharedLookData;
}

/** Reads a shared look file. Everything in it is treated as untrusted input. */
export async function importSharedLookPack(bytes: Uint8Array): Promise<ImportedLook> {
  const record = await recordFromPackBytes(bytes);
  const template = (await openSampleLook(record)).template;
  const measure = await measureSample(template);
  const measured = measuredStyleOptions(measure);
  const templateFits = suggestedSampleUse(record.roles) === "template" && (await templateKeepsSampleShapes(template, measure));
  const headerFill = measure.table?.headerFill;
  const learned: LearnedLook = {
    sample: { ...record, use: templateFits ? "template" : "measured", ...(headerFill ? { headerFill } : {}), measured: measured.items, templateFits },
    options: measured.options,
    items: measured.items,
    measure,
    templateFits
  };
  let shared: SharedLookData | undefined;
  try {
    const guide = (await (await JSZip.loadAsync(bytes)).file("guide.md")?.async("string")) ?? "";
    const start = guide.lastIndexOf(SHARED_OPEN);
    const end = start < 0 ? -1 : guide.indexOf(SHARED_CLOSE, start);
    const text = start >= 0 && end > start ? guide.slice(start + SHARED_OPEN.length, end).trim() : "";
    const decoded = text && text.length <= SHARED_MAX_CHARS ? base64ToBytes(text) : null;
    if (decoded) {
      const data = JSON.parse(new TextDecoder().decode(decoded)) as Record<string, unknown>;
      const items = normalizeMeasuredItems(data.measured);
      shared = {
        name: typeof data.name === "string" ? data.name.slice(0, 80) : "",
        ...(typeof data.preset === "string" ? { preset: data.preset.slice(0, 40) } : {}),
        options: normalizeGongmunStyleOptions(data.options),
        use: data.use === "template" ? "template" : "measured",
        ...(typeof data.headerFill === "string" && /^#[0-9A-Fa-f]{6}$/u.test(data.headerFill) ? { headerFill: data.headerFill.toUpperCase() } : {}),
        ...(items.length ? { measured: items } : {})
      };
    }
  } catch {
    shared = undefined;
  }
  if (shared) {
    learned.options = shared.options;
    learned.sample = {
      ...learned.sample,
      use: shared.use,
      ...(shared.headerFill ? { headerFill: shared.headerFill } : {}),
      ...(shared.measured ? { measured: shared.measured } : {})
    };
    if (shared.measured) learned.items = shared.measured;
  }
  return { learned, ...(shared ? { shared } : {}) };
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
    leftover: strings(data.leftover, 60),
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
    sourceSha256: typeof data.sourceSha256 === "string" ? data.sourceSha256.slice(0, 80) : "",
    use: data.use === "measured" || data.use === "template" ? data.use : suggestedSampleUse(strings(data.roles, 40)),
    ...(typeof data.headerFill === "string" && /^#[0-9A-Fa-f]{6}$/u.test(data.headerFill) ? { headerFill: data.headerFill.toUpperCase() } : {}),
    ...(normalizeMeasuredItems(data.measured).length ? { measured: normalizeMeasuredItems(data.measured) } : {}),
    ...(typeof data.templateFits === "boolean" ? { templateFits: data.templateFits } : {})
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
  /** What HanMark put into the options, for the summary. */
  taken: PdfLookTaken;
}

export interface PdfLookTaken {
  levels: Array<{ level: number; font?: string; pt?: number }>;
  lineSpacing?: number;
  /** Side margins in mm. The right one only when lines reach the edge. */
  margins?: { left: number; right?: number };
  bandColor?: string;
}

/** How far the measured right margin may be from the left one and still be believed. */
const PDF_SIDE_TOLERANCE_MM = 5;

type Margins = { top: number; bottom: number; left: number; right: number };

/**
 * Which margins measured from a PDF can be used. A PDF shows where text lies, not
 * where the margins are. The left edge of item lines is the left margin; the right
 * edge is the right margin only when lines run to it (then both sides are about
 * equal); the top and bottom are never known. So the frame's own margins stay, with
 * the sides replaced where they can be believed.
 */
export function believablePdfMargins(measured: Margins | undefined, frame: Margins): { margins: Margins; taken: { left: number; right?: number } } | undefined {
  if (!measured || !(measured.left >= 5 && measured.left <= 60)) return undefined;
  const rightKnown = Math.abs(measured.right - measured.left) <= PDF_SIDE_TOLERANCE_MM;
  return {
    margins: { top: frame.top, bottom: frame.bottom, left: measured.left, right: rightKnown ? measured.right : frame.right },
    taken: { left: measured.left, ...(rightKnown ? { right: measured.right } : {}) }
  };
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
  const options: GongmunOptions = { ...result.gongmun };
  const taken: PdfLookTaken = { levels: [] };
  for (const [key, level] of Object.entries(options.levels ?? {})) {
    if (level && (level.font || level.pt)) taken.levels.push({ level: Number(key), ...(level.font ? { font: level.font } : {}), ...(level.pt ? { pt: level.pt } : {}) });
  }
  taken.levels.sort((a, b) => a.level - b.level);
  if (spec.lineSpacing !== null && options.lineSpacing !== undefined) taken.lineSpacing = options.lineSpacing;
  if (spec.chapterFill && options.bandColor) taken.bandColor = options.bandColor;
  delete options.margins;
  if (spec.edges && result.gongmun.margins) {
    const frame =
      base.margins ?? (await readSampleFacts(new Uint8Array(await markdownToHwpx("", { gongmun: { preset: base.preset } })))).marginsMm;
    const sides = believablePdfMargins(result.gongmun.margins, frame);
    if (sides) {
      options.margins = sides.margins;
      taken.margins = sides.taken;
    }
  }
  return { options, applied: result.applied, warnings: [...spec.warnings, ...result.warnings], spec, taken };
}
