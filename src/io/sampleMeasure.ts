import JSZip from "jszip";
import type { GongmunStyleOptions } from "./gongmunStyle";

/**
 * Values measured straight from a sample HWPX (R-036), for the parts the engine's
 * template path has no shape for. The sample's package XML is read as text; nothing
 * is rendered. A level is recognised by the mark its paragraphs start with, so a
 * sample whose marks are automatic numbering (no mark character in the text) yields
 * no levels, and the summary says so.
 */
export interface MeasuredShape {
  font: string;
  pt: number;
  bold: boolean;
  /** Line spacing in percent of the font size; undefined when the sample uses a fixed height. */
  lineSpacing?: number;
  /** Paragraphs the shape was read from. */
  count: number;
}

export type MeasuredLevelKey = "0" | "1" | "2" | "3";

export interface SampleMeasure {
  /** The most frequent shape of running paragraphs outside tables. */
  body?: MeasuredShape;
  /** Item levels found by their marks: □ (0), ㅇ ○ (1), - (2), · ㆍ • (3). */
  levels: Partial<Record<MeasuredLevelKey, MeasuredShape & { marker: string }>>;
  /** ※ notes. */
  ref?: MeasuredShape;
  /** The most frequent cell text shape, and the fill of the first row of the first table that has one. */
  table?: { font?: string; pt?: number; headerFill?: string };
  marginsMm: { top: number; bottom: number; left: number; right: number };
}

const LEVEL_MARKS: ReadonlyArray<[MeasuredLevelKey, RegExp]> = [
  ["0", /^[□■▢◻❏]/u],
  ["1", /^[ㅇ○◦◯]/u],
  ["2", /^[-–‐‑－―]/u],
  ["3", /^[·ㆍ•∙‧]/u]
];
const REF_MARK = /^※/u;
const HWPUNIT_PER_MM = 7200 / 25.4;

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`, "u").exec(tag)?.[1];
}

/** Splits section XML into the text outside tables and the outermost tables. */
function splitTables(xml: string): { outside: string; tables: string[] } {
  const token = /<hp:tbl\b|<\/hp:tbl>/gu;
  const tables: string[] = [];
  let outside = "";
  let depth = 0;
  let cursor = 0;
  let start = 0;
  for (let match = token.exec(xml); match; match = token.exec(xml)) {
    if (match[0] !== "</hp:tbl>") {
      if (depth === 0) {
        outside += xml.slice(cursor, match.index);
        start = match.index;
      }
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) {
        cursor = match.index + match[0].length;
        tables.push(xml.slice(start, cursor));
      }
    }
  }
  if (depth === 0) outside += xml.slice(cursor);
  return { outside, tables };
}

interface Paragraph {
  para: string;
  char: string;
  text: string;
}

function paragraphs(xml: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const match of xml.matchAll(/<hp:p\b([^>]*)>([\s\S]*?)<\/hp:p>/gu)) {
    const para = attribute(match[1], "paraPrIDRef");
    if (para === undefined) continue;
    let char: string | undefined;
    let longest = 0;
    let text = "";
    for (const run of match[2].matchAll(/<hp:run\b([^>]*)>([\s\S]*?)<\/hp:run>/gu)) {
      const runText = [...run[2].matchAll(/<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>/gu)]
        .map((item) => item[1].replace(/<[^>]+>/gu, ""))
        .join("");
      if (!runText) continue;
      // The shape of a paragraph is the shape of its longest run (a mark alone is often its own run).
      if (runText.trim().length > longest) {
        longest = runText.trim().length;
        char = attribute(run[1], "charPrIDRef");
      }
      text += runText;
    }
    const cleaned = text.replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&").trim();
    if (char !== undefined && cleaned) out.push({ para, char, text: cleaned });
  }
  return out;
}

interface Shapes {
  fonts: Map<string, string>;
  chars: Map<string, { font: string; pt: number; bold: boolean }>;
  spacing: Map<string, number | undefined>;
  fills: Map<string, string>;
}

function readShapes(header: string): Shapes {
  const hangul = /<hh:fontface\b[^>]*\blang="HANGUL"[\s\S]*?<\/hh:fontface>/u.exec(header)?.[0] ?? header;
  const fonts = new Map<string, string>();
  for (const match of hangul.matchAll(/<hh:font\b([^>]*)>/gu)) {
    const id = attribute(match[1], "id");
    const face = attribute(match[1], "face");
    if (id !== undefined && face) fonts.set(id, face);
  }
  const chars = new Map<string, { font: string; pt: number; bold: boolean }>();
  for (const match of header.matchAll(/<hh:charPr\b([^>]*)>([\s\S]*?)<\/hh:charPr>/gu)) {
    const id = attribute(match[1], "id");
    if (id === undefined) continue;
    const ref = attribute(/<hh:fontRef\b[^>]*>/u.exec(match[2])?.[0] ?? "", "hangul");
    chars.set(id, {
      font: (ref !== undefined && fonts.get(ref)) || "",
      pt: Number(attribute(match[1], "height") ?? 0) / 100,
      bold: /<hh:bold\b/u.test(match[2])
    });
  }
  const spacing = new Map<string, number | undefined>();
  for (const match of header.matchAll(/<hh:paraPr\b([^>]*)>([\s\S]*?)<\/hh:paraPr>/gu)) {
    const id = attribute(match[1], "id");
    if (id === undefined) continue;
    const tag = /<hh:lineSpacing\b[^>]*>/u.exec(match[2])?.[0] ?? "";
    spacing.set(id, attribute(tag, "type") === "PERCENT" ? Number(attribute(tag, "value")) : undefined);
  }
  const fills = new Map<string, string>();
  for (const match of header.matchAll(/<hh:borderFill\b([^>]*)>([\s\S]*?)<\/hh:borderFill>/gu)) {
    const id = attribute(match[1], "id");
    const color = attribute(/<hc:winBrush\b[^>]*>/u.exec(match[2])?.[0] ?? "", "faceColor");
    if (id !== undefined && color && /^#[0-9A-Fa-f]{6}$/u.test(color) && color.toUpperCase() !== "#FFFFFF") fills.set(id, color.toUpperCase());
  }
  return { fonts, chars, spacing, fills };
}

function mostFrequent(items: readonly Paragraph[], shapes: Shapes): MeasuredShape | undefined {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(`${item.para}/${item.char}`, (counts.get(`${item.para}/${item.char}`) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (!best) return undefined;
  const [para, char] = best[0].split("/");
  const shape = shapes.chars.get(char);
  if (!shape || !shape.font || !(shape.pt > 0)) return undefined;
  const lineSpacing = shapes.spacing.get(para);
  return { ...shape, ...(lineSpacing ? { lineSpacing } : {}), count: best[1] };
}

/** Reads body, item level, note and table shapes and the page margins of a sample HWPX. */
export async function measureSample(hwpx: Uint8Array): Promise<SampleMeasure> {
  const zip = await JSZip.loadAsync(hwpx);
  const header = (await zip.file("Contents/header.xml")?.async("string")) ?? "";
  let section = "";
  for (const name of Object.keys(zip.files).filter((item) => /^Contents\/section\d+\.xml$/u.test(item)).sort()) {
    section += (await zip.file(name)?.async("string")) ?? "";
  }
  const shapes = readShapes(header);
  const { outside, tables } = splitTables(section);
  const flow = paragraphs(outside);

  const levels: SampleMeasure["levels"] = {};
  for (const [key, mark] of LEVEL_MARKS) {
    const items = flow.filter((item) => mark.test(item.text));
    // One stray dash is not a level; two paragraphs with the same mark are.
    const shape = items.length >= 2 ? mostFrequent(items, shapes) : undefined;
    if (shape) levels[key] = { ...shape, marker: items[0].text[0] };
  }
  const notes = flow.filter((item) => REF_MARK.test(item.text));
  const marked = (text: string): boolean => REF_MARK.test(text) || LEVEL_MARKS.some(([, mark]) => mark.test(text));
  const running = flow.filter((item) => !marked(item.text) && item.text.length >= 12);
  const body = mostFrequent(running.length ? running : flow.filter((item) => !marked(item.text)), shapes);

  let table: SampleMeasure["table"];
  if (tables.length) {
    const cells = tables.flatMap((item) => paragraphs(item.replace(/^<hp:tbl\b[^>]*>/u, "")));
    const shape = mostFrequent(cells, shapes);
    // A data table's header row: cells marked as header first, else the first row of
    // the first table with two or more columns (a one-cell table is a box, not data).
    const fillOf = (cells: string): string | undefined =>
      [...cells.matchAll(/<hp:tc\b([^>]*)>/gu)]
        .map((cell) => shapes.fills.get(attribute(cell[1], "borderFillIDRef") ?? ""))
        .find((color): color is string => !!color);
    let headerFill: string | undefined;
    for (const item of tables) {
      const marked = [...item.matchAll(/<hp:tc\b[^>]*\bheader="1"[^>]*>/gu)].map((cell) => cell[0]).join("");
      headerFill = marked ? fillOf(marked) : undefined;
      if (headerFill) break;
    }
    if (!headerFill) {
      for (const item of tables) {
        if (Number(attribute(/^<hp:tbl\b[^>]*>/u.exec(item)?.[0] ?? "", "colCnt") ?? 0) < 2) continue;
        headerFill = fillOf(/<hp:tr\b[^>]*>([\s\S]*?)<\/hp:tr>/u.exec(item)?.[1] ?? "");
        if (headerFill) break;
      }
    }
    if (shape || headerFill) table = { ...(shape ? { font: shape.font, pt: shape.pt } : {}), ...(headerFill ? { headerFill } : {}) };
  }

  const margin = /<hp:margin\b[^>]*>/u.exec(section)?.[0] ?? "";
  const mm = (name: string): number => Math.round((Number(attribute(margin, name) ?? 0) / HWPUNIT_PER_MM) * 10) / 10;
  return {
    ...(body ? { body } : {}),
    levels,
    ...(notes.length ? { ref: mostFrequent(notes, shapes) } : {}),
    ...(table ? { table } : {}),
    marginsMm: { top: mm("top"), bottom: mm("bottom"), left: mm("left"), right: mm("right") }
  };
}

/** One line of the summary: a part of the look, where its value came from, and the value. */
export interface MeasuredItem {
  part: "margins" | "body" | "lineSpacing" | "level0" | "level1" | "level2" | "level3" | "ref" | "tableFont" | "tableHeaderFill";
  /** "sample": read from the sample; "body": the sample has no such part, the body shape is used; "none": nothing to use, the frame's own shape stays. */
  source: "sample" | "body" | "none";
  value: string;
}

const round = (value: number): number => Math.round(value * 10) / 10;

/**
 * Official-document options that carry the measured values. Levels the sample does
 * not have take the body shape, so text placed there still looks like the sample;
 * where the sample has no running text either, the frame's own shapes stay.
 */
export function measuredStyleOptions(measure: SampleMeasure): { options: GongmunStyleOptions; items: MeasuredItem[] } {
  const options: GongmunStyleOptions = {};
  const items: MeasuredItem[] = [];
  const { top, bottom, left, right } = measure.marginsMm;
  if (top > 0 && left > 0 && right > 0) {
    options.margins = { top, bottom, left, right };
    items.push({ part: "margins", source: "sample", value: `${top} / ${bottom} / ${left} / ${right} mm` });
  } else {
    items.push({ part: "margins", source: "none", value: "" });
  }
  const body = measure.body;
  if (body) {
    options.fonts = { ...options.fonts, body: body.font };
    options.bodyPt = round(body.pt);
    items.push({ part: "body", source: "sample", value: `${body.font} ${round(body.pt)}pt` });
    if (body.lineSpacing) {
      options.lineSpacing = Math.round(body.lineSpacing);
      items.push({ part: "lineSpacing", source: "sample", value: `${Math.round(body.lineSpacing)}%` });
    } else {
      items.push({ part: "lineSpacing", source: "none", value: "" });
    }
  } else {
    items.push({ part: "body", source: "none", value: "" }, { part: "lineSpacing", source: "none", value: "" });
  }
  const levels: NonNullable<GongmunStyleOptions["levels"]> = {};
  for (const key of ["0", "1", "2", "3"] as const) {
    const level = measure.levels[key];
    const part = `level${key}` as MeasuredItem["part"];
    if (level) {
      levels[key] = { font: level.font, pt: round(level.pt), ...(level.bold ? { bold: true } : {}) };
      items.push({ part, source: "sample", value: `${level.marker} ${level.font} ${round(level.pt)}pt` });
    } else if (body) {
      // The font only: the frame keeps its own size steps around the body size.
      levels[key] = { font: body.font };
      items.push({ part, source: "body", value: body.font });
    } else {
      items.push({ part, source: "none", value: "" });
    }
  }
  if (Object.keys(levels).length) options.levels = levels;
  const second = measure.levels["1"]?.marker;
  if (second === "○" || second === "ㅇ") options.bullet2 = second; // i18n-data: Kordoc bullet characters
  if (measure.ref) {
    options.fonts = { ...options.fonts, ref: measure.ref.font };
    items.push({ part: "ref", source: "sample", value: `${measure.ref.font} ${round(measure.ref.pt)}pt` });
  } else {
    items.push({ part: "ref", source: body ? "body" : "none", value: body ? body.font : "" });
    if (body) options.fonts = { ...options.fonts, ref: body.font };
  }
  if (measure.table?.font) {
    options.fonts = { ...options.fonts, table: measure.table.font };
    items.push({ part: "tableFont", source: "sample", value: `${measure.table.font}${measure.table.pt ? ` ${round(measure.table.pt)}pt` : ""}` });
  } else {
    items.push({ part: "tableFont", source: "none", value: "" });
  }
  items.push(
    measure.table?.headerFill
      ? { part: "tableHeaderFill", source: "sample", value: measure.table.headerFill }
      : { part: "tableHeaderFill", source: "none", value: "" }
  );
  return { options, items };
}
