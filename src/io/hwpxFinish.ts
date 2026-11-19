import JSZip from "jszip";
import { measureTextWidth, simulateWrap, type MeasureOptions } from "kordoc";
import { COVER_LOGO_DATA } from "./coverLogoData";
import { paragraphSignature, type GongmunParagraphHint } from "./gongmunOutline";

/**
 * Finishing of generated official documents (2.7.0, R-024).
 *
 * Kordoc's official-document engine fixes some looks that an institution's own
 * forms do differently: the item markers of each numbering scheme, the table
 * header color, the size of the title and chapter lines, and the Seoul-style
 * document-information box on the report cover. A built-in style lists the few
 * changes it needs; this module applies them to the generated HWPX
 * deterministically. The same pass moves body paragraphs of the legal family
 * under their heading. It only adds new character, paragraph, and border styles
 * (never edits shared ones), so text outside the targeted paragraphs keeps its look.
 */

/** Markers of Kordoc's two schemes: legal 가. 1) 가) (1) (가) ① ㉮ and box □ ○/ㅇ - ㆍ. */
export type FinishMarkerClass =
  | "legal1"
  | "legal2"
  | "legal3"
  | "legal4"
  | "legal5"
  | "legal6"
  | "legal7"
  | "box0"
  | "box1"
  | "box2"
  | "box3";

/** Replacement that numbers 1), 2) … again under each chapter. */
export const NUMBERED_PAREN = "{n})";

export interface GongmunFinishSpec {
  /** Item markers to redraw, by marker class. */
  markers?: Partial<Record<FinishMarkerClass, string>>;
  /** Header rows of body tables (cells marked header="1"). */
  tableHeader?: { fill: string; textColor: string };
  /** The document title line (style 1). "body" takes the typeface of the body items. */
  title?: { pt?: number; bold?: boolean; font?: "body" };
  /**
   * Chapter lines (style 2) drawn as text. `blankLineBefore` puts one text line of
   * space before every chapter after the first.
   */
  chapter?: { pt?: number; bold?: boolean; blankLineBefore?: boolean };
  /**
   * Report cover: remove the Seoul-style information box, recolor the title bars,
   * restyle the lines under the title, drop the title box repeated on page 2, and
   * put the institution's logo at the bottom of the cover.
   */
  cover?: {
    removeInfoBox?: boolean;
    removeBodyTitle?: boolean;
    barColors?: readonly [string, string];
    linePt?: number;
    lineBold?: boolean;
    logo?: CoverLogo;
  };
  /**
   * Plain paragraphs of the legal family in order (gongmunOutline.ts). Each moves to
   * the left edge of the items one level below its heading.
   */
  paragraphs?: readonly GongmunParagraphHint[];
  /** The first closing line of a notice ({@link paragraphSignature} key): one text line of space before it. */
  closing?: { key: string };
  /**
   * Frames Kordoc sizes for one line (the ministry briefing's section bands, sub-heading
   * boxes, item bands, and contents) get the lines their text needs (R-027).
   */
  fitFrames?: boolean;
}

/** A logo picture: PNG or JPEG bytes (base64) and their pixel size. */
export interface CoverLogoImage {
  data: string;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

/**
 * A logo drawn at the bottom of the cover (3.0.0): a picture centred on the paper and
 * anchored to it, so it stays in place however long the title runs. A built-in look
 * names a picture of coverLogoData.ts by `key`; the user's own look carries its
 * `image`. Sizes are millimetres; `bottomMm` is the paper's lower edge to the logo.
 */
export interface CoverLogo {
  key: string;
  widthMm: number;
  bottomMm: number;
  image?: CoverLogoImage;
}

export interface FinishedXml {
  section: string;
  header: string;
  /** Operations that found nothing to change (for tests and diagnostics). */
  missed: string[];
  /** Cover logos placed in the section; their pictures go into the package. */
  logos?: CoverLogo[];
}

// i18n-data-begin: Kordoc's own marker glyphs, cover labels, and colors matched in its XML
const MARKER_CLASSES: ReadonlyArray<[FinishMarkerClass, RegExp]> = [
  ["legal1", /^[가-힣]\.$/u],
  ["legal2", /^\d{1,2}\)$/u],
  ["legal3", /^[가-힣]\)$/u],
  ["legal4", /^\(\d{1,2}\)$/u],
  ["legal5", /^\([가-힣]\)$/u],
  ["legal6", /^[①-⑳]$/u],
  ["legal7", /^[㉮-㉻]$/u],
  ["box0", /^□$/u],
  ["box1", /^[○ㅇ]$/u],
  ["box2", /^-$/u],
  ["box3", /^ㆍ$/u]
];
const COVER_INFO_LABELS = ["문서번호", "결재일자", "공개여부", "방침번호"];
const COVER_BAR_COLOR = "#1F2FD6";
// i18n-data-end

const MARKER_RUN =
  /(<hp:p\b[^>]*>)<hp:run charPrIDRef="(\d+)"><hp:t>([^<]{1,6})<hp:tab width="(\d+)"([^>]*)\/><\/hp:t><\/hp:run>/g;
const MARKER_START = new RegExp(`^${MARKER_RUN.source}`);

export function markerClass(marker: string): FinishMarkerClass | null {
  for (const [name, pattern] of MARKER_CLASSES) if (pattern.test(marker)) return name;
  return null;
}

/** Header style tables: clones get fresh ids and are appended to their list. */
type StyleKind = "charPr" | "borderFill" | "paraPr";
const STYLE_LISTS: Readonly<Record<StyleKind, string>> = {
  charPr: "charProperties",
  borderFill: "borderFills",
  paraPr: "paraProperties"
};

class HeaderStyles {
  private readonly clones = new Map<string, number>();

  constructor(public xml: string) {}

  private element(kind: StyleKind, id: string): string | null {
    const pattern = new RegExp(`<hh:${kind} id="${id}"[\\s\\S]*?<\\/hh:${kind}>`);
    return pattern.exec(this.xml)?.[0] ?? null;
  }

  private nextId(kind: StyleKind): number {
    let max = -1;
    for (const match of this.xml.matchAll(new RegExp(`<hh:${kind} id="(\\d+)"`, "g"))) max = Math.max(max, Number(match[1]));
    return max + 1;
  }

  private append(kind: StyleKind, element: string): void {
    const list = STYLE_LISTS[kind];
    const close = `</hh:${list}>`;
    const at = this.xml.indexOf(close);
    if (at < 0) throw new Error(`HWPX header has no ${list}`);
    this.xml = `${this.xml.slice(0, at)}${element}\n    ${this.xml.slice(at)}`;
    this.xml = this.xml.replace(new RegExp(`(<hh:${list} itemCnt=")(\\d+)(")`), (_all, a: string, count: string, b: string) => `${a}${Number(count) + 1}${b}`);
  }

  height(id: string): number {
    return Number(/\bheight="(\d+)"/.exec(this.element("charPr", id) ?? "")?.[1] ?? 1000);
  }

  fontRef(id: string): string | null {
    return /<hh:fontRef\b[^>]*\/>/.exec(this.element("charPr", id) ?? "")?.[0] ?? null;
  }

  /** Size, width ratio, letter spacing, and typeface of a character shape. */
  charMetrics(id: string): { height: number; ratio: number; spacing: number; face: string } {
    const element = this.element("charPr", id) ?? "";
    const fontId = /<hh:fontRef hangul="(\d+)"/.exec(element)?.[1] ?? "0";
    const hangul = /<hh:fontface lang="HANGUL"[\s\S]*?<\/hh:fontface>/.exec(this.xml)?.[0] ?? "";
    return {
      height: Number(/\bheight="(\d+)"/.exec(element)?.[1] ?? 1000),
      ratio: Number(/<hh:ratio hangul="(\d+)"/.exec(element)?.[1] ?? 100),
      spacing: Number(/<hh:spacing hangul="(-?\d+)"/.exec(element)?.[1] ?? 0),
      face: new RegExp(`<hh:font id="${fontId}" face="([^"]*)"`).exec(hangul)?.[1] ?? ""
    };
  }

  /** Margins, space before and after, and line spacing (%) of a paragraph shape. */
  paraMetrics(id: string): { left: number; right: number; prev: number; next: number; lineSpacing: number } {
    const element = this.element("paraPr", id) ?? "";
    const value = (name: string): number => Number(new RegExp(`<hc:${name} value="(-?\\d+)"`).exec(element)?.[1] ?? 0);
    return { left: value("left"), right: value("right"), prev: value("prev"), next: value("next"), lineSpacing: this.lineSpacing(id) };
  }

  charPr(id: string, change: { pt?: number; bold?: boolean; color?: string; fontRef?: string | null; ratio?: number }): string {
    const key = `c:${id}:${JSON.stringify(change)}`;
    const known = this.clones.get(key);
    if (known !== undefined) return String(known);
    const source = this.element("charPr", id);
    if (!source) return id;
    const newId = this.nextId("charPr");
    let element = source.replace(/^<hh:charPr id="\d+"/, `<hh:charPr id="${newId}"`);
    if (change.pt !== undefined) element = element.replace(/\bheight="\d+"/, `height="${Math.round(change.pt * 100)}"`);
    if (change.color) element = element.replace(/\btextColor="[^"]*"/, `textColor="${change.color}"`);
    if (change.fontRef) element = element.replace(/<hh:fontRef\b[^>]*\/>/, change.fontRef);
    if (change.ratio !== undefined) {
      const ratio = change.ratio;
      element = element.replace(/<hh:ratio\b[^>]*\/>/, (tag) => tag.replace(/="\d+"/g, `="${ratio}"`));
    }
    if (change.bold !== undefined) {
      element = element.replace(/<hh:bold\/>/g, "").replace(/\sbold="[01]"/, "");
      if (change.bold) element = element.replace(/^(<hh:charPr\b[^>]*?)>/, `$1 bold="1">`).replace(/<\/hh:charPr>$/, "<hh:bold/></hh:charPr>");
    }
    this.append("charPr", element);
    this.clones.set(key, newId);
    return String(newId);
  }

  borderFill(id: string, fill: string): string {
    const key = `b:${id}:${fill}`;
    const known = this.clones.get(key);
    if (known !== undefined) return String(known);
    const source = this.element("borderFill", id);
    if (!source) return id;
    const newId = this.nextId("borderFill");
    let element = source.replace(/^<hh:borderFill id="\d+"/, `<hh:borderFill id="${newId}"`);
    element = /faceColor="[^"]*"/.test(element)
      ? element.replace(/faceColor="[^"]*"/, `faceColor="${fill}"`)
      : element.replace(
          /<\/hh:borderFill>$/,
          `<hc:fillBrush><hc:winBrush faceColor="${fill}" hatchColor="#000000" alpha="0"/></hc:fillBrush></hh:borderFill>`
        );
    this.append("borderFill", element);
    this.clones.set(key, newId);
    return String(newId);
  }

  /** A body paragraph shape as Kordoc draws it: justified, no margin, no indent. */
  isFlushJustified(id: string): boolean {
    const element = this.element("paraPr", id);
    if (!element || !/<hh:align horizontal="JUSTIFY"/.test(element)) return false;
    const margins = [...element.matchAll(/<hc:(?:left|intent) value="(-?\d+)"/g)];
    return margins.length > 0 && margins.every((margin) => margin[1] === "0");
  }

  /** Line spacing of a paragraph shape in percent (160 when it is not a percentage). */
  lineSpacing(id: string): number {
    const value = /<hh:lineSpacing type="PERCENT" value="(\d+)"/.exec(this.element("paraPr", id) ?? "")?.[1];
    return value ? Number(value) : 160;
  }

  paraPr(id: string, change: { left?: number; prev?: number }): string {
    const key = `p:${id}:${JSON.stringify(change)}`;
    const known = this.clones.get(key);
    if (known !== undefined) return String(known);
    const source = this.element("paraPr", id);
    if (!source) return id;
    const newId = this.nextId("paraPr");
    let element = source.replace(/^<hh:paraPr id="\d+"/, `<hh:paraPr id="${newId}"`);
    if (change.left !== undefined) element = element.replace(/(<hc:left value=")-?\d+(")/g, `$1${change.left}$2`);
    if (change.prev !== undefined) element = element.replace(/(<hc:prev value=")-?\d+(")/g, `$1${change.prev}$2`);
    this.append("paraPr", element);
    this.clones.set(key, newId);
    return String(newId);
  }

  borderFillIdsWithColor(color: string): Set<string> {
    const ids = new Set<string>();
    for (const match of this.xml.matchAll(/<hh:borderFill id="(\d+)"[\s\S]*?<\/hh:borderFill>/g)) {
      if (match[0].toUpperCase().includes(`FACECOLOR="${color.toUpperCase()}"`)) ids.add(match[1]);
    }
    return ids;
  }
}

/** Paragraph elements directly in the section (not inside tables, notes, or boxes). */
function topLevelParagraphs(section: string): Array<{ start: number; end: number }> {
  const found: Array<{ start: number; end: number }> = [];
  let depth = 0;
  let start = -1;
  for (const tag of section.matchAll(/<hp:p\b[^>]*?(\/?)>|<\/hp:p>/g)) {
    const at = tag.index ?? 0;
    if (tag[0] === "</hp:p>") {
      depth -= 1;
      if (depth === 0 && start >= 0) found.push({ start, end: at + tag[0].length });
    } else if (!tag[1]) {
      if (depth === 0) start = at;
      depth += 1;
    }
  }
  return found;
}

/** Text of a paragraph without its footnotes or other nested text. */
function paragraphText(xml: string): string {
  const own = xml.replace(/<hp:subList\b[\s\S]*?<\/hp:subList>/g, "");
  let text = "";
  for (const match of own.matchAll(/<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>/g)) {
    text += match[1].replace(/<[^>]*>/g, "").replace(/&#?\w+;/g, " ");
  }
  return text;
}

/**
 * Moves each plain paragraph to the left edge of the items one level below its
 * heading. In the legal scheme item depth d starts 2·d "타" (half the text size
 * each) from the margin (seoulLegalScheme in Kordoc 4.15.7).
 */
function alignParagraphs(section: string, styles: HeaderStyles, hints: GongmunFinishSpec["paragraphs"], missed: string[]): string {
  if (!hints?.some((hint) => hint.depth > 0)) return section;
  const candidates = topLevelParagraphs(section).filter(({ start, end }) => {
    const xml = section.slice(start, end);
    const open = /^<hp:p\b[^>]*>/.exec(xml)?.[0] ?? "";
    if (!/\bstyleIDRef="0"/.test(open) || MARKER_START.test(xml) || /<hp:(?:tbl|pic|equation)\b/.test(xml)) return false;
    const shape = /\bparaPrIDRef="(\d+)"/.exec(open)?.[1];
    return !!shape && styles.isFlushJustified(shape);
  });
  const edits: Array<{ start: number; open: string; replacement: string }> = [];
  let next = 0;
  for (const hint of hints) {
    for (let index = next; index < candidates.length; index += 1) {
      const { start, end } = candidates[index];
      const xml = section.slice(start, end);
      if (!paragraphSignature(paragraphText(xml)).startsWith(hint.key)) continue;
      next = index + 1;
      if (hint.depth > 0) {
        const open = /^<hp:p\b[^>]*>/.exec(xml)?.[0] ?? "";
        const shape = /\bparaPrIDRef="(\d+)"/.exec(open)?.[1] ?? "";
        const run = /<hp:run charPrIDRef="(\d+)"/.exec(xml)?.[1];
        const pt = (run ? styles.height(run) : 1000) / 100;
        const left = hint.depth * 2 * Math.round(pt * 50);
        edits.push({ start, open, replacement: open.replace(/\bparaPrIDRef="\d+"/, `paraPrIDRef="${styles.paraPr(shape, { left })}"`) });
      }
      break;
    }
  }
  if (!edits.length) {
    missed.push("paragraphs");
    return section;
  }
  let output = "";
  let cursor = 0;
  for (const edit of edits) {
    output += section.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.start + edit.open.length;
  }
  return output + section.slice(cursor);
}

/** One text line of space before the notice's closing lines (the last paragraph that matches). */
function spaceClosing(section: string, styles: HeaderStyles, closing: GongmunFinishSpec["closing"], missed: string[]): string {
  if (!closing?.key) return section;
  const paragraphs = topLevelParagraphs(section);
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const { start, end } = paragraphs[index];
    const xml = section.slice(start, end);
    if (!paragraphSignature(paragraphText(xml)).startsWith(closing.key)) continue;
    const open = /^<hp:p\b[^>]*>/.exec(xml)?.[0] ?? "";
    const shape = /\bparaPrIDRef="(\d+)"/.exec(open)?.[1];
    const run = /<hp:run charPrIDRef="(\d+)"/.exec(xml)?.[1];
    if (!shape || !run) break;
    const prev = Math.round((styles.height(run) * styles.lineSpacing(shape)) / 100);
    const replacement = open.replace(/\bparaPrIDRef="\d+"/, `paraPrIDRef="${styles.paraPr(shape, { prev })}"`);
    return section.slice(0, start) + replacement + section.slice(start + open.length);
  }
  missed.push("closing");
  return section;
}

// i18n-data-begin: typeface names in Kordoc's width tables (faceClassForGen, Kordoc 4.15.7)
const METRIC_FACES = new Set(["한컴돋움", "HY견고딕", "휴먼명조", "HY헤드라인M", "굴림체", "굴림", "맑은 고딕", "함초롬돋움"]);
const FIXED_PITCH_FACES = /^(?:굴림체|돋움체|바탕체|궁서체)$/u;
const GOTHIC_FACES = /^(?:한컴돋움|맑은 고딕|HY견고딕|HY헤드라인M|HY중고딕|한양중고딕|나눔고딕|나눔스퀘어|돋움|굴림)$/u;
// i18n-data-end
/**
 * Tables Kordoc draws itself (Kordoc 4.15.7): the bullet-style report's frames from id
 * 9 200 000, every other cover, head, band, box, and contents from 9 300 000. Markdown
 * tables start at 1 000 and charts at 9 100 000; neither is touched.
 */
const FRAME_TABLE_IDS = { from: 9_200_000, to: 9_400_000 };
/** Summary boxes, which Kordoc already sizes to their wrapped text. */
const SIZED_CELL = /^<hp:tc name="__kordoc_summary"/;
/** Width ratios tried to keep a frame line on one line (Kordoc condenses frame titles down to 85 %). */
const CONDENSED_RATIOS = [95, 90, 85];
/** Kordoc keeps 2 % of the room free when it fits a frame line on one line (fitOneLine). */
const FIT_SAFETY = 0.98;
/** A grown frame keeps the room it had below its text, up to about 1 cm. */
const PAD_CAP = 3000;
const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The width table Kordoc uses for a typeface (its faceClassForGen). */
function faceClass(face: string): MeasureOptions["faceClass"] {
  const name = face.trim();
  if (METRIC_FACES.has(name)) return `font:${name}`;
  if (FIXED_PITCH_FACES.test(name)) return "fixedPitch";
  return GOTHIC_FACES.test(name) ? "gothic" : "hcr";
}

/** A paragraph's text as it is printed (entities decoded). */
function printedText(paragraph: string): string {
  let text = "";
  for (const match of paragraph.matchAll(/<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>/g)) {
    text += match[1]
      .replace(/<[^>]*>/g, "")
      .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (entity, dec: string, hex: string, name: string) =>
        dec || hex ? String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16)) : (XML_ENTITIES[name] ?? entity)
      );
  }
  return text;
}

function isFrameTable(table: string): boolean {
  const id = Number(/^<hp:tbl id="(\d+)"/.exec(table)?.[1]);
  return id >= FRAME_TABLE_IDS.from && id < FRAME_TABLE_IDS.to;
}

function tableRows(table: string): string[][] {
  return [...table.matchAll(/<hp:tr>([\s\S]*?)<\/hp:tr>/g)].map((row) =>
    [...row[1].matchAll(/<hp:tc\b[\s\S]*?<\/hp:tc>/g)].map((cell) => cell[0])
  );
}

function cellWidth(cell: string): number {
  return Number(/<hp:cellSz width="(\d+)"/.exec(cell)?.[1] ?? 0);
}

function withCellSize(cell: string, size: { width?: number; height?: number }): string {
  return cell.replace(/<hp:cellSz width="(\d+)" height="(\d+)"/, (_size, width: string, height: string) =>
    `<hp:cellSz width="${size.width ?? width}" height="${size.height ?? height}"`
  );
}

/** Margins of a cell: its own when it has them, otherwise the table's (left, right, top, bottom). */
function cellMargins(cell: string, tableMargins: number[]): number[] {
  const own = /\bhasMargin="1"/.test(cell)
    ? /<hp:cellMargin left="(\d+)" right="(\d+)" top="(\d+)" bottom="(\d+)"/.exec(cell)?.slice(1).map(Number)
    : undefined;
  return own ?? tableMargins;
}

interface LineShape {
  text: string;
  runs: string[];
  main: { height: number; ratio: number; spacing: number; face: string };
  /** Width the text has in a cell of this width. */
  room: (cellWidth: number) => number;
  lineHeight: number;
  /** Space before and after the paragraph. */
  around: number;
}

function lineShape(paragraph: string, styles: HeaderStyles, margins: number[]): LineShape | null {
  const runs = [...paragraph.matchAll(/<hp:run charPrIDRef="(\d+)"/g)].map((match) => match[1]);
  if (!runs.length) return null;
  const shape = styles.paraMetrics(/paraPrIDRef="(\d+)"/.exec(paragraph)?.[1] ?? "0");
  return {
    text: printedText(paragraph),
    runs,
    main: styles.charMetrics(runs[runs.length - 1]),
    room: (width) => width - margins[0] - margins[1] - shape.left - shape.right,
    lineHeight: Math.round((Math.max(...runs.map((id) => styles.height(id))) * shape.lineSpacing) / 100),
    around: shape.prev + shape.next
  };
}

function wrapLines(text: string, width: number, metrics: LineShape["main"], ratio: number): number {
  if (!text.trim()) return 1;
  if (width <= 0) return Number.POSITIVE_INFINITY;
  return simulateWrap(text, width, width, metrics.height, ratio, "keep", {
    faceClass: faceClass(metrics.face),
    spacingPct: metrics.spacing
  }).lines;
}

function paragraphsOf(cell: string): string[] {
  return cell.match(/<hp:p\b[^>]*>[\s\S]*?<\/hp:p>/g) ?? [];
}

/**
 * A two-column frame table (label | value) whose labels do not fit on one line gets a wider
 * label column and a narrower value column, when every value keeps its lines. Kordoc's plan
 * cover gives 문서번호 about 15 mm for 17 mm of 12 pt text.
 */
function widenLabels(table: string, styles: HeaderStyles, margins: number[]): string {
  const rows = tableRows(table);
  if (rows.length < 2 || rows.some((cells) => cells.length !== 2)) return table;
  const labelWidth = cellWidth(rows[0][0]);
  const valueWidth = cellWidth(rows[0][1]);
  if (rows.some(([label, value]) => cellWidth(label) !== labelWidth || cellWidth(value) !== valueWidth)) return table;
  let need = labelWidth;
  for (const [label] of rows) {
    for (const paragraph of paragraphsOf(label)) {
      const line = lineShape(paragraph, styles, cellMargins(label, margins));
      if (!line || wrapLines(line.text, line.room(labelWidth), line.main, line.main.ratio) <= 1) continue;
      const text = measureTextWidth(line.text, line.main.height, line.main.ratio, {
        faceClass: faceClass(line.main.face),
        spacingPct: line.main.spacing
      });
      need = Math.max(need, Math.ceil((labelWidth - line.room(labelWidth) + text / FIT_SAFETY) / 100) * 100);
    }
  }
  const narrower = valueWidth - (need - labelWidth);
  if (need <= labelWidth || narrower <= 0) return table;
  const valuesKeep = rows.every(([, value]) =>
    paragraphsOf(value).every((paragraph) => {
      const line = lineShape(paragraph, styles, cellMargins(value, margins));
      if (!line) return true;
      return wrapLines(line.text, line.room(narrower), line.main, line.main.ratio) <= wrapLines(line.text, line.room(valueWidth), line.main, line.main.ratio);
    })
  );
  if (!valuesKeep) return table;
  return table.replace(/<hp:tr>([\s\S]*?)<\/hp:tr>/g, (_row, inner: string) => {
    const [label, value] = [...inner.matchAll(/<hp:tc\b[\s\S]*?<\/hp:tc>/g)].map((cell) => cell[0]);
    return `<hp:tr>${withCellSize(label, { width: need })}${withCellSize(value, { width: narrower })}</hp:tr>`;
  });
}

interface FittedCell {
  cell: string;
  /** Height the text needs as it wraps. */
  needed: number;
  /** Height with every paragraph on one line (what Kordoc sized the frame for). */
  oneLine: number;
  wrapped: boolean;
}

/**
 * One frame cell of a row `height` high. When its wrapped text fits, it stays as Kordoc drew
 * it (a cover title may take two lines). When it does not, a line that runs over a little is
 * condensed to stay on one line, and the rest wraps.
 */
function fitCell(cell: string, styles: HeaderStyles, tableMargins: number[], height: number): FittedCell {
  const width = cellWidth(cell);
  const margins = cellMargins(cell, tableMargins);
  const paragraphs = paragraphsOf(cell).map((paragraph) => {
    const line = lineShape(paragraph, styles, margins);
    if (!line) return { paragraph, line, lines: 0, ratio: undefined };
    const room = line.room(width);
    const lines = wrapLines(line.text, room, line.main, line.main.ratio);
    const ratio = lines > 1
      ? CONDENSED_RATIOS.find((candidate) => candidate < line.main.ratio && wrapLines(line.text, room * FIT_SAFETY, line.main, candidate) === 1)
      : undefined;
    return { paragraph, line, lines: Number.isFinite(lines) ? lines : 1, ratio };
  });
  const measure = (condense: boolean): { needed: number; oneLine: number; wrapped: boolean } => {
    let needed = margins[2] + margins[3];
    let oneLine = needed;
    let wrapped = false;
    for (const { line, lines, ratio } of paragraphs) {
      if (!line) continue;
      const count = condense && ratio !== undefined ? 1 : lines;
      if (count > 1) wrapped = true;
      needed += line.around + count * line.lineHeight;
      oneLine += line.around + line.lineHeight;
    }
    return { needed, oneLine, wrapped };
  };
  const natural = measure(false);
  if (natural.needed <= height || paragraphs.every((item) => item.ratio === undefined)) return { cell, ...natural };
  let index = 0;
  const fitted = cell.replace(/<hp:p\b[^>]*>[\s\S]*?<\/hp:p>/g, (paragraph) => {
    const ratio = paragraphs[index++]?.ratio;
    if (ratio === undefined) return paragraph;
    return paragraph.replace(/<hp:run charPrIDRef="(\d+)"/g, (_run, id: string) => `<hp:run charPrIDRef="${styles.charPr(id, { ratio })}"`);
  });
  return { cell: fitted, ...measure(true) };
}

/** Rows a merged cell reaches into from the row above; their heights belong to that cell. */
function rowsUnderSpans(table: string): Set<number> {
  const spanned = new Set<number>();
  for (const cell of table.matchAll(/<hp:cellAddr colAddr="\d+" rowAddr="(\d+)"\/><hp:cellSpan colSpan="\d+" rowSpan="(\d+)"\/>/g)) {
    const [row, span] = [Number(cell[1]), Number(cell[2])];
    for (let offset = 0; offset < span && span > 1; offset += 1) spanned.add(row + offset);
  }
  return spanned;
}

/**
 * Kordoc sizes the frames it draws (cover and heading titles, bands, boxes, contents, the
 * draft's head and foot) for one line of text, so a long title or value ran out of its
 * frame. A line that runs over a little is condensed (down to 85 %); a longer one wraps and
 * its row grows, keeping the room the frame had below its text. A label column too narrow
 * for its labels takes room from its value column (R-027).
 */
function fitFrames(section: string, styles: HeaderStyles, enabled: boolean | undefined): string {
  if (!enabled) return section;
  return section.replace(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g, (source) => {
    if (!isFrameTable(source) || source.indexOf("<hp:tbl", 1) >= 0) return source;
    const inMargin = /<hp:inMargin left="(\d+)" right="(\d+)" top="(\d+)" bottom="(\d+)"/.exec(source);
    const margins = inMargin ? inMargin.slice(1).map(Number) : [141, 141, 141, 141];
    const table = widenLabels(source, styles, margins);
    const spanned = rowsUnderSpans(table);
    let grown = 0;
    let index = -1;
    const rows = table.replace(/<hp:tr>([\s\S]*?)<\/hp:tr>/g, (row, inner: string) => {
      index += 1;
      if (spanned.has(index)) return row;
      const cells = [...inner.matchAll(/<hp:tc\b[\s\S]*?<\/hp:tc>/g)].map((match) => match[0]);
      const current = Math.max(0, ...cells.map((cell) => Number(/<hp:cellSz width="\d+" height="(\d+)"/.exec(cell)?.[1] ?? 0)));
      let height = current;
      const fitted = cells.map((cell) => {
        if (SIZED_CELL.test(cell)) return cell;
        const fit = fitCell(cell, styles, margins, current);
        if (fit.wrapped && fit.needed > current) {
          height = Math.max(height, fit.needed + Math.min(Math.max(current - fit.oneLine, 0), PAD_CAP));
        }
        return fit.cell;
      });
      grown += height - current;
      return `<hp:tr>${(height > current ? fitted.map((cell) => withCellSize(cell, { height })) : fitted).join("")}</hp:tr>`;
    });
    if (!grown) return rows;
    return rows.replace(/(<hp:sz width="\d+" widthRelTo="\w+" height=")(\d+)(")/, (_size, open: string, height: string, close: string) =>
      `${open}${Number(height) + grown}${close}`
    );
  });
}

function redrawMarkers(section: string, styles: HeaderStyles, markers: GongmunFinishSpec["markers"], missed: string[]): string {
  if (!markers || !Object.keys(markers).length) return section;
  let counter = 0;
  let changed = 0;
  // One pass in document order: a chapter restarts the 1), 2) numbering.
  const pattern = /<hp:p\b[^>]*>/g;
  let output = "";
  let cursor = 0;
  for (const open of section.matchAll(pattern)) {
    const start = open.index ?? 0;
    if (start < cursor) continue;
    if (/\bstyleIDRef="2"/.test(open[0])) counter = 0;
    MARKER_RUN.lastIndex = start;
    const run = MARKER_RUN.exec(section);
    if (!run || run.index !== start) continue;
    const kind = markerClass(run[3]);
    const target = kind ? markers[kind] : undefined;
    if (target === undefined) continue;
    const replacement = target === NUMBERED_PAREN ? `${++counter})` : target;
    const height = styles.height(run[2]);
    const width = (text: string): number => measureTextWidth(text, height, 100);
    const tab = Math.max(0, Math.round(Number(run[4]) + width(run[3]) - width(replacement)));
    output += section.slice(cursor, start);
    output += `${run[1]}<hp:run charPrIDRef="${run[2]}"><hp:t>${replacement}<hp:tab width="${tab}"${run[5]}/></hp:t></hp:run>`;
    cursor = start + run[0].length;
    changed += 1;
  }
  if (!changed) missed.push("markers");
  return output + section.slice(cursor);
}

function recolorTableHeaders(section: string, styles: HeaderStyles, header: GongmunFinishSpec["tableHeader"], missed: string[]): string {
  if (!header) return section;
  let changed = 0;
  const result = section.replace(/<hp:tc\b([^>]*\bheader="1"[^>]*)>([\s\S]*?)<\/hp:tc>/g, (cell, attrs: string, inner: string) => {
    if (inner.includes("<hp:tc")) return cell;
    const fill = /borderFillIDRef="(\d+)"/.exec(attrs)?.[1];
    if (!fill) return cell;
    changed += 1;
    const newAttrs = attrs.replace(/borderFillIDRef="\d+"/, `borderFillIDRef="${styles.borderFill(fill, header.fill)}"`);
    const newInner = inner.replace(/<hp:run charPrIDRef="(\d+)">/g, (_run, id: string) =>
      `<hp:run charPrIDRef="${styles.charPr(id, { color: header.textColor, bold: true })}">`
    );
    return `<hp:tc${newAttrs}>${newInner}</hp:tc>`;
  });
  if (!changed) missed.push("tableHeader");
  return result;
}

/** Character style of the first text run after a marker: the typeface of body items. */
function bodyFontRef(section: string, styles: HeaderStyles): string | null {
  MARKER_RUN.lastIndex = 0;
  for (const run of section.matchAll(MARKER_RUN)) {
    const after = section.slice((run.index ?? 0) + run[0].length);
    const id = /^<hp:run charPrIDRef="(\d+)">/.exec(after)?.[1];
    if (id) return styles.fontRef(id);
  }
  return null;
}

function restyleTitle(section: string, styles: HeaderStyles, title: GongmunFinishSpec["title"], missed: string[]): string {
  if (!title) return section;
  const open = /<hp:p\b[^>]*\bstyleIDRef="1"[^>]*>/.exec(section);
  if (!open) {
    missed.push("title");
    return section;
  }
  const start = open.index;
  const end = section.indexOf("</hp:p>", start);
  const paragraph = section.slice(start, end);
  const fontRef = title.font === "body" ? bodyFontRef(section, styles) : null;
  const restyled = paragraph.replace(/<hp:run charPrIDRef="(\d+)">(?=(?:(?!<\/hp:run>)[\s\S])*<hp:t>[^<])/g, (_run, id: string) =>
    `<hp:run charPrIDRef="${styles.charPr(id, { pt: title.pt, bold: title.bold, fontRef })}">`
  );
  return section.slice(0, start) + restyled + section.slice(end);
}

function restyleChapters(section: string, styles: HeaderStyles, chapter: GongmunFinishSpec["chapter"], missed: string[]): string {
  if (!chapter) return section;
  let changed = 0;
  const result = section.replace(
    /(<hp:p\b[^>]*\bstyleIDRef="2"[^>]*>)((?:(?!<\/hp:p>)[\s\S])*?)(<\/hp:p>)/g,
    (all, open: string, inner: string, close: string) => {
      if (inner.includes("<hp:tbl")) return all;
      changed += 1;
      let shapedOpen = open;
      const shape = /\bparaPrIDRef="(\d+)"/.exec(open)?.[1];
      const firstRun = /<hp:run charPrIDRef="(\d+)"/.exec(inner)?.[1];
      if (chapter.blankLineBefore && changed > 1 && shape && firstRun) {
        const prev = Math.round((styles.height(firstRun) * styles.lineSpacing(shape)) / 100);
        shapedOpen = open.replace(/\bparaPrIDRef="\d+"/, `paraPrIDRef="${styles.paraPr(shape, { prev })}"`);
      }
      const runs =
        chapter.pt === undefined && chapter.bold === undefined
          ? inner
          : inner.replace(/<hp:run charPrIDRef="(\d+)">/g, (_run, id: string) =>
              `<hp:run charPrIDRef="${styles.charPr(id, { pt: chapter.pt, bold: chapter.bold })}">`
            );
      return `${shapedOpen}${runs}${close}`;
    }
  );
  if (!changed) missed.push("chapter");
  return result;
}

const HU_PER_MM = 7200 / 25.4;
/** Picture ids from 9 490 000: after Kordoc's own pictures (9 400 000 up) and frames. */
const COVER_LOGO_PIC_ID = 9_490_001;

export function coverLogoItemId(key: string): string {
  return `hanmark_logo_${key.replace(/[^A-Za-z0-9]/g, "_")}`;
}

function coverLogoImage(logo: CoverLogo): CoverLogoImage | undefined {
  if (logo.image) return logo.image;
  const builtIn = COVER_LOGO_DATA[logo.key];
  return builtIn ? { data: builtIn.png, mime: "image/png", width: builtIn.width, height: builtIn.height } : undefined;
}

/** Kordoc's picture XML with the position of a logo anchored to the paper. */
function coverLogoPicXml(logo: CoverLogo): string | null {
  const data = coverLogoImage(logo);
  if (!data || data.width <= 0 || data.height <= 0) return null;
  const w = Math.round(logo.widthMm * HU_PER_MM);
  const h = Math.round((w * data.height) / data.width);
  const id = COVER_LOGO_PIC_ID;
  return (
    `<hp:pic id="${id}" zOrder="1" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${id}" reverse="0" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">` +
    `<hp:offset x="0" y="0"/><hp:orgSz width="${w}" height="${h}"/><hp:curSz width="${w}" height="${h}"/><hp:flip horizontal="0" vertical="0"/>` +
    `<hp:rotationInfo angle="0" centerX="${Math.floor(w / 2)}" centerY="${Math.floor(h / 2)}" rotateimage="1"/>` +
    `<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>` +
    `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${w}" y="0"/><hc:pt2 x="${w}" y="${h}"/><hc:pt3 x="0" y="${h}"/></hp:imgRect>` +
    `<hp:imgClip left="0" right="${w}" top="0" bottom="${h}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="${w}" dimheight="${h}"/>` +
    `<hc:img binaryItemIDRef="${coverLogoItemId(logo.key)}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/>` +
    `<hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PAPER" horzRelTo="PAPER" vertAlign="BOTTOM" horzAlign="CENTER" vertOffset="${Math.round(logo.bottomMm * HU_PER_MM)}" horzOffset="0"/>` +
    `<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment>HanMark cover logo</hp:shapeComment></hp:pic>`
  );
}

/**
 * Anchors the logo to a text run of the cover's own paragraphs (not one in a table cell,
 * not the first paragraph that holds the page setup): the first empty one after the
 * title frame, else the first such run. It is on the cover page whatever follows it.
 */
function placeCoverLogo(region: string, logo: CoverLogo): string | null {
  const pic = coverLogoPicXml(logo);
  if (!pic) return null;
  const firstParagraphEnd = region.indexOf("</hp:p>");
  const firstFrameEnd = region.indexOf("</hp:tbl>");
  const token = /<hp:tbl\b|<\/hp:tbl>|<hp:run charPrIDRef="\d+"><hp:t>(<\/hp:t><\/hp:run>)?/g;
  let depth = 0;
  let any: number | undefined;
  let empty: number | undefined;
  for (const match of region.matchAll(token)) {
    if (match[0] === "</hp:tbl>") depth = Math.max(0, depth - 1);
    else if (match[0].startsWith("<hp:tbl")) depth += 1;
    else if (depth === 0 && match.index > firstParagraphEnd) {
      any ??= match.index;
      if (match[1] && match.index > firstFrameEnd) {
        empty = match.index;
        break;
      }
    }
  }
  const at = empty ?? any;
  if (at === undefined) return null;
  const textOpen = region.indexOf("<hp:t>", at);
  return region.slice(0, textOpen) + pic + region.slice(textOpen);
}

function finishCover(section: string, styles: HeaderStyles, cover: GongmunFinishSpec["cover"], missed: string[], logos: CoverLogo[] = []): string {
  if (!cover) return section;
  const bodyStart = section.search(/<hp:p\b[^>]*\bpageBreak="1"/);
  if (bodyStart < 0) {
    missed.push("cover");
    return section;
  }
  let region = section.slice(0, bodyStart);
  let rest = section.slice(bodyStart);
  // Only a real report cover has Kordoc's title bars; the report-cover changes leave
  // anything else alone. The logo goes on any cover (the caller sends it only with one).
  const barFills = styles.borderFillIdsWithColor(COVER_BAR_COLOR);
  if (![...barFills].some((id) => region.includes(`borderFillIDRef="${id}"`))) {
    const { logo, ...reportCover } = cover;
    if (Object.keys(reportCover).length) missed.push("cover");
    if (!logo) return section;
    const placed = placeCoverLogo(region, logo);
    if (!placed) {
      missed.push("cover.logo");
      return section;
    }
    logos.push(logo);
    return placed + rest;
  }

  if (cover.removeInfoBox) {
    const box = /<hp:tbl\b[\s\S]*?<\/hp:tbl>/.exec(region);
    if (box && COVER_INFO_LABELS.every((label) => box[0].includes(`<hp:t>${label}</hp:t>`))) {
      region = region.slice(0, box.index) + region.slice(box.index + box[0].length);
    } else {
      missed.push("cover.removeInfoBox");
    }
  }

  if (cover.barColors) {
    let bar = 0;
    region = region.replace(/<hp:tc\b([^>]*)borderFillIDRef="(\d+)"/g, (cell, attrs: string, id: string) => {
      if (!barFills.has(id) || bar > 1) return cell;
      const color = cover.barColors?.[bar] ?? COVER_BAR_COLOR;
      bar += 1;
      return `<hp:tc${attrs}borderFillIDRef="${styles.borderFill(id, color)}"`;
    });
    if (!bar) missed.push("cover.barColors");
  }

  if (cover.linePt !== undefined || cover.lineBold !== undefined) {
    const frameEnd = region.lastIndexOf("</hp:tbl>");
    if (frameEnd < 0) {
      missed.push("cover.lines");
    } else {
      const head = region.slice(0, frameEnd);
      const tail = region.slice(frameEnd).replace(
        /(<hp:p\b[^>]*>)<hp:run charPrIDRef="(\d+)">(<hp:t>[^<]+<\/hp:t>)/g,
        (_all, open: string, id: string, text: string) =>
          `${open}<hp:run charPrIDRef="${styles.charPr(id, { pt: cover.linePt, bold: cover.lineBold })}">${text}`
      );
      region = head + tail;
    }
  }

  if (cover.removeBodyTitle) {
    // The first body paragraph repeats the title in a one-cell box (cell "__kordoc_h1");
    // its page-number restart stays.
    const paragraphEnd = rest.indexOf("</hp:p>");
    const box = /<hp:tbl\b[\s\S]*?<\/hp:tbl>/.exec(rest);
    if (box && box.index < paragraphEnd && box[0].includes('name="__kordoc_h1"')) {
      rest = rest.slice(0, box.index) + rest.slice(box.index + box[0].length);
    } else {
      missed.push("cover.removeBodyTitle");
    }
  }

  if (cover.logo) {
    const placed = placeCoverLogo(region, cover.logo);
    if (placed) {
      region = placed;
      logos.push(cover.logo);
    } else {
      missed.push("cover.logo");
    }
  }
  return region + rest;
}

export function finishGongmunXml(sectionXml: string, headerXml: string, spec: GongmunFinishSpec): FinishedXml {
  const styles = new HeaderStyles(headerXml);
  const missed: string[] = [];
  const logos: CoverLogo[] = [];
  let section = sectionXml;
  section = alignParagraphs(section, styles, spec.paragraphs, missed);
  section = spaceClosing(section, styles, spec.closing, missed);
  section = redrawMarkers(section, styles, spec.markers, missed);
  section = recolorTableHeaders(section, styles, spec.tableHeader, missed);
  section = restyleTitle(section, styles, spec.title, missed);
  section = restyleChapters(section, styles, spec.chapter, missed);
  section = finishCover(section, styles, spec.cover, missed, logos);
  // Last, so frames are fitted to their final text and fonts.
  section = fitFrames(section, styles, spec.fitFrames);
  return { section, header: styles.xml, missed, ...(logos.length ? { logos } : {}) };
}

/** Adds each placed logo's picture and its manifest entry to the package. */
async function addCoverLogos(zip: JSZip, logos: readonly CoverLogo[]): Promise<void> {
  const manifestEntry = zip.file("Contents/content.hpf");
  if (!manifestEntry || !logos.length) return;
  let manifest = await manifestEntry.async("text");
  for (const logo of logos) {
    const image = coverLogoImage(logo);
    const itemId = coverLogoItemId(logo.key);
    if (!image || manifest.includes(`id="${itemId}"`)) continue;
    const href = `BinData/${itemId}.${image.mime === "image/jpeg" ? "jpg" : "png"}`;
    zip.file(href, new Uint8Array(Buffer.from(image.data, "base64")));
    manifest = manifest.replace("</opf:manifest>", () => `<opf:item id="${itemId}" href="${href}" media-type="${image.mime}" isEmbeded="1"/></opf:manifest>`);
  }
  zip.file("Contents/content.hpf", manifest);
}

const SECTION_ENTRY = /^Contents\/section\d+\.xml$/;

/** Applies `spec` to every section of a generated HWPX. */
export async function finishGongmunHwpx(data: ArrayBuffer, spec: GongmunFinishSpec): Promise<{ data: ArrayBuffer; missed: string[] }> {
  const zip = await JSZip.loadAsync(data);
  const headerEntry = zip.file("Contents/header.xml");
  if (!headerEntry) return { data, missed: ["header"] };
  let header = await headerEntry.async("text");
  const missed: string[] = [];
  const logos: CoverLogo[] = [];
  const sections = Object.keys(zip.files).filter((name) => SECTION_ENTRY.test(name)).sort();
  for (const name of sections) {
    const finished = finishGongmunXml(await zip.file(name)!.async("text"), header, spec);
    header = finished.header;
    missed.push(...finished.missed);
    logos.push(...(finished.logos ?? []));
    zip.file(name, finished.section);
  }
  zip.file("Contents/header.xml", header);
  await addCoverLogos(zip, logos);
  return { data: await zip.generateAsync({ type: "arraybuffer" }), missed };
}
