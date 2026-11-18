import JSZip from "jszip";
import { pngDiagramMark } from "./pngMeta";
import {
  parseEditorialBlocks,
  type EditorialAlignment,
  type EditorialBlock,
  type EditorialInline
} from "./editorialDocument";
import {
  WORD_STYLE_ID_MAP,
  applyWordSettings,
  applyWordTemplateFonts,
  applyWordTemplatePage,
  applyWordTemplateStyles
} from "../legacy-port/wordReferenceDoc";
import type { WordTemplateSpec } from "../legacy-port/wordTypes";

/**
 * Built-in DOCX writer (R-031): Markdown -> the shared document model -> a
 * WordprocessingML package, with no external program. The package is written from
 * HanMark's own minimal base; every template style comes from WordTemplateSpec
 * through the same builders the Pandoc reference document uses, so one Word
 * template drives both paths. The same note and template give the same bytes.
 */

export type DocxNoticeCode =
  | "math"
  | "image-not-embedded"
  | "link-not-external"
  | "color-not-applied"
  | "footnote-repeated"
  | "footnote-missing"
  | "callout-fold";

export interface DocxNotice {
  code: DocxNoticeCode;
  count: number;
}

export interface DocxWriteOptions {
  template: WordTemplateSpec;
  /** Document title written to the core properties. */
  title: string;
  /** Proofing language of the text ("ko" marks East Asian text as Korean). */
  language?: "ko" | "en";
}

export interface WrittenDocx {
  bytes: Uint8Array;
  notices: DocxNotice[];
}

/** Every entry carries this date so equal input gives equal bytes. */
export const DOCX_FIXED_ENTRY_DATE = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const NS_PACKAGE_RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_BASE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Styles the writer adds to the template's own (ids are part of the output contract). */
export const DOCX_EXTRA_STYLE_IDS = Object.freeze({
  compact: "Compact",
  footnoteText: "FootnoteText",
  footnoteReference: "FootnoteReference",
  calloutTitle: "CalloutTitle",
  calloutBody: "CalloutBody",
  mathText: "MathText"
});

const STYLE = {
  body: WORD_STYLE_ID_MAP["Body Text"],
  first: WORD_STYLE_ID_MAP["First Paragraph"],
  quote: WORD_STYLE_ID_MAP["Block Text"],
  code: WORD_STYLE_ID_MAP["Source Code"],
  link: WORD_STYLE_ID_MAP.Hyperlink,
  verbatim: WORD_STYLE_ID_MAP["Verbatim Char"],
  table: WORD_STYLE_ID_MAP.Table,
  ...DOCX_EXTRA_STYLE_IDS
} as const;

const BULLET_ABSTRACT = 1;
const ORDERED_ABSTRACT = 2;
const LIST_LEVELS = 9;
const LIST_STEP_TWIPS = 480;
const LIST_HANGING_TWIPS = 360;
const QUOTE_STEP_TWIPS = 360;
const EMU_PER_PIXEL = 9525;
const EMU_PER_TWIP = 635;
// i18n-data-begin: list and task markers written into the document
const BULLETS = ["\u2022", "\u25E6", "\u25AA"];
const TASK_OPEN = "\u2610";
const TASK_DONE = "\u2611";
// i18n-data-end

/** True for a character XML 1.0 can hold (tab, line breaks, and everything from U+0020 except surrogates and U+FFFE/F). */
function isXmlCharacter(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    code >= 0x10000
  );
}

function escapeXml(value: string): string {
  return Array.from(value)
    .filter((character) => isXmlCharacter(character.codePointAt(0) ?? 0))
    .join("")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface RunFormat {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  highlight?: boolean;
  vertical?: "superscript" | "subscript";
  color?: string;
  fill?: string;
  style?: string;
}

function runProperties(format: RunFormat): string {
  // Child order follows CT_RPr.
  const parts: string[] = [];
  if (format.style) parts.push(`<w:rStyle w:val="${format.style}"/>`);
  if (format.bold) parts.push("<w:b/><w:bCs/>");
  if (format.italic) parts.push("<w:i/><w:iCs/>");
  if (format.strike) parts.push("<w:strike/>");
  if (format.color) parts.push(`<w:color w:val="${format.color}"/>`);
  if (format.highlight) parts.push('<w:highlight w:val="yellow"/>');
  if (format.underline) parts.push('<w:u w:val="single"/>');
  if (format.fill) parts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${format.fill}"/>`);
  if (format.vertical) parts.push(`<w:vertAlign w:val="${format.vertical}"/>`);
  return parts.length ? `<w:rPr>${parts.join("")}</w:rPr>` : "";
}

function textRun(value: string, format: RunFormat): string {
  if (!value) return "";
  const pieces = value.split(/(\t|\r?\n)/);
  const content = pieces
    .map((piece) => {
      if (piece === "\t") return "<w:tab/>";
      if (piece === "\n" || piece === "\r\n") return "<w:br/>";
      return piece ? `<w:t xml:space="preserve">${escapeXml(piece)}</w:t>` : "";
    })
    .join("");
  return content ? `<w:r>${runProperties(format)}${content}</w:r>` : "";
}

// The colour names the document model lets through (editorialDocument.ts).
const NAMED_COLORS: Readonly<Record<string, string>> = {
  black: "000000",
  blue: "0000FF",
  gray: "808080",
  green: "008000",
  navy: "000080",
  orange: "FFA500",
  purple: "800080",
  red: "FF0000",
  silver: "C0C0C0",
  teal: "008080",
  white: "FFFFFF",
  yellow: "FFFF00"
};

function hexColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  const named = NAMED_COLORS[text.toLowerCase()];
  if (named) return named;
  const long = /^#([0-9a-f]{6})$/i.exec(text);
  if (long) return long[1].toUpperCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  if (short) return `${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(text);
  if (rgb) {
    const channels = rgb.slice(1).map(Number);
    if (channels.every((channel) => channel <= 255)) {
      return channels.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase();
    }
  }
  return undefined;
}

interface ImageSize {
  width: number;
  height: number;
}

/** Pixel size from the header of a PNG, JPEG, GIF, or BMP. */
export function rasterImageSize(data: Uint8Array): ImageSize | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length >= 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (data.length >= 10 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (data.length >= 26 && data[0] === 0x42 && data[1] === 0x4d) {
    return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = data[offset + 1];
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        offset += 2;
        continue;
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  }
  return null;
}

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
  "image/bmp": "bmp"
};

function decodeDataUri(source: string): { mime: string; data: Uint8Array } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(source);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!IMAGE_EXTENSIONS[mime]) return null;
  try {
    return { mime, data: new Uint8Array(Buffer.from(match[2].replace(/\s+/g, ""), "base64")) };
  } catch {
    return null;
  }
}

interface Relationship {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

/** Relationships of one part (document.xml or footnotes.xml). */
class PartRelationships {
  readonly items: Relationship[] = [];
  private readonly byKey = new Map<string, string>();

  add(type: string, target: string, external: boolean): string {
    const key = `${type}\n${target}`;
    const known = this.byKey.get(key);
    if (known) return known;
    const id = `rId${this.items.length + 1}`;
    this.items.push({ id, type, target, external });
    this.byKey.set(key, id);
    return id;
  }

  xml(): string {
    const rows = this.items
      .map(
        (item) =>
          `<Relationship Id="${item.id}" Type="${item.type}" Target="${escapeXml(item.target)}"${
            item.external ? ' TargetMode="External"' : ""
          }/>`
      )
      .join("");
    return `${XML_HEADER}<Relationships xmlns="${NS_PACKAGE_RELS}">${rows}</Relationships>`;
  }
}

interface MediaEntry {
  name: string;
  data: Uint8Array;
  mime: string;
  /** Placed size in document pixels (a diagram HanMark drew is placed at its drawn size, R-033). */
  size: ImageSize;
  /** True for a diagram picture HanMark drew (R-033). */
  diagram: boolean;
  /** The paragraph after a diagram picture is its caption. */
  captionFollows: boolean;
}

interface ListFrame {
  numId: number;
  level: number;
}

interface BlockContext {
  rels: PartRelationships;
  /** Paragraph style of plain text here. */
  style: string;
  /** Extra left indent in twips (quotes and list continuation). */
  indent: number;
  list?: ListFrame;
  /** True right after a heading at the top level (First Paragraph rule). */
  afterHeading?: boolean;
}

interface ParagraphOptions {
  style: string;
  indent?: number;
  hanging?: number;
  numbering?: ListFrame;
  alignment?: EditorialAlignment;
  keepNext?: boolean;
}

function paragraph(runs: string, options: ParagraphOptions): string {
  // Child order follows CT_PPr.
  const parts = [`<w:pStyle w:val="${options.style}"/>`];
  if (options.keepNext) parts.push("<w:keepNext/>");
  if (options.numbering) {
    parts.push(`<w:numPr><w:ilvl w:val="${options.numbering.level}"/><w:numId w:val="${options.numbering.numId}"/></w:numPr>`);
  }
  if (!options.numbering && (options.indent || options.hanging)) {
    parts.push(
      `<w:ind w:left="${options.indent ?? 0}"${options.hanging ? ` w:hanging="${options.hanging}"` : ""}/>`
    );
  }
  if (options.alignment) {
    parts.push(`<w:jc w:val="${options.alignment === "justify" ? "both" : options.alignment}"/>`);
  }
  return `<w:p><w:pPr>${parts.join("")}</w:pPr>${runs}</w:p>`;
}

const MATH_SPAN = /\$\$[\s\S]+?\$\$|\$(?=\S)(?:[^$\\\n]|\\[\s\S])+?(?<=\S)\$(?!\d)/g;
const MATH_OPEN = "\uE000";
const MATH_CLOSE = "\uE001";
const MATH_TOKEN = /\uE000HANMARKMATH(\d+)\uE001/g;

/**
 * Markdown would read the backslashes inside an equation as escapes (`\,` becomes
 * `,`), so equations are taken out before parsing and put back as text when the
 * runs are written. Fenced code and inline code are left alone.
 */
export function protectMath(markdown: string): { markdown: string; equations: string[] } {
  const equations: string[] = [];
  const source = markdown.replace(/[\uE000\uE001]/g, "");
  const protectText = (text: string): string =>
    text
      .split(/(`+[\s\S]*?`+)/)
      .map((piece, index) =>
        index % 2 === 1
          ? piece
          : piece.replace(MATH_SPAN, (equation) => {
              equations.push(equation);
              return `${MATH_OPEN}HANMARKMATH${equations.length - 1}${MATH_CLOSE}`;
            })
      )
      .join("");
  const output: string[] = [];
  let pending: string[] = [];
  let fence: string | null = null;
  const flush = (): void => {
    if (pending.length) output.push(protectText(pending.join("\n")));
    pending = [];
  };
  for (const line of source.split("\n")) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      output.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (marker) {
      flush();
      output.push(line);
      fence = marker;
    } else {
      pending.push(line);
    }
  }
  flush();
  return { markdown: output.join("\n"), equations };
}

class DocxBuilder {
  readonly documentRels = new PartRelationships();
  readonly footnoteRels = new PartRelationships();
  readonly media: MediaEntry[] = [];
  private readonly mediaBySource = new Map<string, MediaEntry | null>();
  private readonly notices = new Map<DocxNoticeCode, number>();
  private readonly numbers: Array<{ numId: number; ordered: boolean; level: number; start: number }> = [];
  private readonly usedFootnotes = new Set<number>();
  private drawingId = 0;

  constructor(
    private readonly textWidthTwips: number,
    private readonly footnoteCount: number,
    private readonly equations: readonly string[]
  ) {}

  note(code: DocxNoticeCode, count = 1): void {
    this.notices.set(code, (this.notices.get(code) ?? 0) + count);
  }

  noticeList(): DocxNotice[] {
    return [...this.notices.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) => left.code.localeCompare(right.code));
  }

  referencedFootnotes(): ReadonlySet<number> {
    return this.usedFootnotes;
  }

  private newNumber(ordered: boolean, level: number, start: number): number {
    const numId = this.numbers.length + 1;
    this.numbers.push({ numId, ordered, level, start });
    return numId;
  }

  private text(value: string, format: RunFormat): string {
    if (!value.includes(MATH_OPEN)) return textRun(value, format);
    let output = "";
    let cursor = 0;
    for (const match of value.matchAll(MATH_TOKEN)) {
      const index = match.index ?? 0;
      const equation = this.equations[Number(match[1])];
      if (equation === undefined) continue;
      output += textRun(value.slice(cursor, index), format);
      output += textRun(equation, { ...format, style: STYLE.mathText });
      this.note("math");
      cursor = index + match[0].length;
    }
    return output + textRun(value.slice(cursor), format);
  }

  /** Text outside the run writer (code, alternative text): equations go back as written. */
  private plain(value: string): string {
    return value.includes(MATH_OPEN)
      ? value.replace(MATH_TOKEN, (token, index: string) => this.equations[Number(index)] ?? token)
      : value;
  }

  /** Set while a paragraph is written when it placed a diagram picture (with or without a caption under it). */
  private diagramPlaced: false | "plain" | "captioned" = false;

  private image(source: string, rawAlt: string, rels: PartRelationships, format: RunFormat): string {
    const alt = this.plain(rawAlt);
    let entry = this.mediaBySource.get(source);
    if (entry === undefined) {
      const decoded = decodeDataUri(source);
      const size = decoded ? rasterImageSize(decoded.data) : null;
      const mark = decoded ? pngDiagramMark(decoded.data) : null;
      const scale = mark?.scale ?? 1;
      entry =
        decoded && size && size.width > 0 && size.height > 0
          ? {
              name: `image${this.media.length + 1}.${IMAGE_EXTENSIONS[decoded.mime]}`,
              data: decoded.data,
              mime: decoded.mime,
              size: { width: size.width / scale, height: size.height / scale },
              diagram: mark !== null,
              captionFollows: mark?.captionFollows === true
            }
          : null;
      if (entry) this.media.push(entry);
      this.mediaBySource.set(source, entry);
    }
    if (!entry) {
      this.note("image-not-embedded");
      return textRun(alt ? `[${alt}]` : "", format);
    }
    const relationId = rels.add(`${REL_BASE}/image`, `media/${entry.name}`, false);
    const maxWidth = this.textWidthTwips * EMU_PER_TWIP;
    let width = Math.round(entry.size.width * EMU_PER_PIXEL);
    let height = Math.round(entry.size.height * EMU_PER_PIXEL);
    if (entry.diagram) this.diagramPlaced = entry.captionFollows ? "captioned" : "plain";
    if (width > maxWidth) {
      height = Math.round((height * maxWidth) / width);
      width = maxWidth;
    }
    this.drawingId += 1;
    const id = this.drawingId;
    const name = escapeXml(entry.name);
    const description = escapeXml(alt);
    return (
      `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
      `<wp:extent cx="${width}" cy="${height}"/>` +
      `<wp:docPr id="${id}" name="${name}" descr="${description}"/>` +
      `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic><a:graphicData uri="${NS_PIC}"><pic:pic>` +
      `<pic:nvPicPr><pic:cNvPr id="${id}" name="${name}" descr="${description}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${relationId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
    );
  }

  inlines(inlines: readonly EditorialInline[], rels: PartRelationships, format: RunFormat = {}): string {
    let output = "";
    for (const inline of inlines) {
      if (inline.type === "text") output += this.text(inline.value, format);
      else if (inline.type === "hardbreak") output += `<w:r>${runProperties(format)}<w:br/></w:r>`;
      else if (inline.type === "code") output += textRun(this.plain(inline.value), { ...format, style: STYLE.verbatim });
      else if (inline.type === "image") output += this.image(inline.src, inline.alt, rels, format);
      else if (inline.type === "wikilink") output += this.text(inline.label || inline.target, format);
      else if (inline.type === "link") {
        if (/^(?:https?:|mailto:|tel:)/i.test(inline.href)) {
          const relationId = rels.add(`${REL_BASE}/hyperlink`, inline.href, true);
          const runs = this.inlines(inline.children, rels, { ...format, style: STYLE.link });
          output += `<w:hyperlink r:id="${relationId}" w:history="1">${runs}</w:hyperlink>`;
        } else {
          this.note("link-not-external");
          output += this.inlines(inline.children, rels, format);
        }
      } else {
        if (inline.footnote !== undefined) {
          const number = inline.footnote;
          if (number < 1 || number > this.footnoteCount) {
            this.note("footnote-missing");
          } else if (this.usedFootnotes.has(number) || rels !== this.documentRels) {
            // Word allows one reference per note, and none inside a note.
            this.note("footnote-repeated");
          } else {
            this.usedFootnotes.add(number);
            output += `<w:r><w:rPr><w:rStyle w:val="${STYLE.footnoteReference}"/></w:rPr><w:footnoteReference w:id="${number}"/></w:r>`;
            continue;
          }
        }
        const next: RunFormat = { ...format };
        if (inline.style === "strong") next.bold = true;
        else if (inline.style === "emphasis") next.italic = true;
        else if (inline.style === "delete") next.strike = true;
        else if (inline.style === "underline") next.underline = true;
        else if (inline.style === "mark") next.highlight = true;
        else if (inline.style === "superscript") next.vertical = "superscript";
        else if (inline.style === "subscript") next.vertical = "subscript";
        for (const [key, value] of [["color", inline.color], ["fill", inline.backgroundColor]] as const) {
          if (!value) continue;
          const color = hexColor(value);
          if (color) next[key] = color;
          else this.note("color-not-applied");
        }
        output += this.inlines(inline.children, rels, next);
      }
    }
    return output;
  }

  private table(block: Extract<EditorialBlock, { type: "table" }>, context: BlockContext): string {
    const columns = Math.max(block.header.length, ...block.rows.map((row) => row.length), 1);
    const available = Math.max(this.textWidthTwips - context.indent, 1440);
    const width = Math.floor(available / columns);
    const grid = Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join("");
    const border = (side: string): string => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`;
    const row = (cells: readonly EditorialInline[][], header: boolean): string => {
      const filled = Array.from({ length: columns }, (_, index) => cells[index] ?? []);
      const body = filled
        .map((cell, index) => {
          const runs = this.inlines(cell, context.rels, header ? { bold: true } : {});
          const alignment = block.align?.[index] ?? (header ? "center" : undefined);
          return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${paragraph(runs, { style: STYLE.compact, alignment })}</w:tc>`;
        })
        .join("");
      return `<w:tr>${header ? "<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>" : ""}${body}</w:tr>`;
    };
    const rows = (block.header.length ? row(block.header, true) : "") + block.rows.map((cells) => row(cells, false)).join("");
    const properties =
      `<w:tblPr><w:tblStyle w:val="${STYLE.table}"/><w:tblW w:w="${width * columns}" w:type="dxa"/>` +
      (context.indent ? `<w:tblInd w:w="${context.indent}" w:type="dxa"/>` : "") +
      `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>` +
      `<w:tblLayout w:type="fixed"/>` +
      `<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>` +
      `<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`;
    // A table must be followed by a paragraph inside cells and is tidier with one after it.
    return `<w:tbl>${properties}<w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
  }

  private list(block: Extract<EditorialBlock, { type: "list" }>, context: BlockContext): string {
    const level = Math.min(context.list ? context.list.level + 1 : 0, LIST_LEVELS - 1);
    const numId = this.newNumber(block.ordered, level, block.ordered ? (block.start ?? 1) : 1);
    const frame: ListFrame = { numId, level };
    const textIndent = context.indent + LIST_STEP_TWIPS * (level + 1);
    let output = "";
    for (const item of block.items) {
      const blocks = [...item.blocks];
      const first = blocks[0];
      const lead = first?.type === "paragraph" ? first : undefined;
      if (lead) blocks.shift();
      const leadRuns = lead ? this.inlines(lead.inlines, context.rels) : "";
      if (item.checked !== undefined) {
        const mark = textRun(`${item.checked ? TASK_DONE : TASK_OPEN}\t`, {});
        output += paragraph(mark + leadRuns, { style: STYLE.compact, indent: textIndent, hanging: LIST_HANGING_TWIPS });
      } else {
        output += paragraph(leadRuns, { style: STYLE.compact, numbering: frame });
      }
      output += this.blocks(blocks, { rels: context.rels, style: STYLE.compact, indent: textIndent, list: frame });
    }
    return output;
  }

  blocks(blocks: readonly EditorialBlock[], context: BlockContext): string {
    let output = "";
    let afterHeading = false;
    let afterDiagram = false;
    for (const block of blocks) {
      const wasAfterHeading = afterHeading;
      const wasAfterDiagram = afterDiagram;
      afterHeading = false;
      afterDiagram = false;
      if (block.type === "paragraph") {
        // The centred paragraph right under a diagram picture is its caption (R-033).
        const caption = wasAfterDiagram && !block.inlines.some((inline) => inline.type === "image");
        const style = caption
          ? WORD_STYLE_ID_MAP["Image Caption"]
          : context.style === STYLE.body && wasAfterHeading ? STYLE.first : context.style;
        this.diagramPlaced = false;
        const runs = this.inlines(block.inlines, context.rels);
        const placed = this.diagramPlaced as false | "plain" | "captioned";
        afterDiagram = placed === "captioned";
        output += paragraph(runs, {
          style,
          indent: context.indent,
          alignment: placed || caption ? "center" : block.alignment,
          ...(afterDiagram ? { keepNext: true } : {})
        });
      } else if (block.type === "heading") {
        output += paragraph(this.inlines(block.inlines, context.rels), {
          style: WORD_STYLE_ID_MAP[`Heading ${block.level}`],
          indent: context.indent
        });
        afterHeading = true;
      } else if (block.type === "list") {
        output += this.list(block, context);
      } else if (block.type === "table") {
        output += this.table(block, context);
      } else if (block.type === "quote") {
        output += this.blocks(block.blocks, {
          ...context,
          style: STYLE.quote,
          indent: context.style === STYLE.quote ? context.indent + QUOTE_STEP_TWIPS : context.indent
        });
      } else if (block.type === "callout") {
        if (block.collapsed !== undefined) this.note("callout-fold");
        output += paragraph(textRun(block.kind.toUpperCase(), {}), {
          style: STYLE.calloutTitle,
          indent: context.indent,
          keepNext: block.blocks.length > 0
        });
        output += this.blocks(block.blocks, { ...context, style: STYLE.calloutBody });
      } else if (block.type === "code") {
        output += paragraph(textRun(this.plain(block.value).replace(/\r?\n$/, ""), {}), { style: STYLE.code, indent: context.indent });
      } else {
        output += `<w:p><w:pPr><w:pStyle w:val="${context.style}"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>`;
      }
    }
    return output;
  }

  numberingXml(): string {
    const levels = (ordered: boolean, startLevel = -1, start = 1): string =>
      Array.from({ length: LIST_LEVELS }, (_, level) => {
        const left = LIST_STEP_TWIPS * (level + 1);
        const format = ordered
          ? `<w:start w:val="${level === startLevel ? start : 1}"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${level + 1}."/>`
          : `<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${BULLETS[level % BULLETS.length]}"/>`;
        return `<w:lvl w:ilvl="${level}">${format}<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="${LIST_HANGING_TWIPS}"/></w:pPr></w:lvl>`;
      }).join("");
    // A list that does not start at 1 gets its own definition: some readers ignore
    // the start override of a list instance and would show 1.
    const custom = this.numbers.filter((item) => item.ordered && item.start !== 1);
    const customId = (item: { numId: number }): number => ORDERED_ABSTRACT + 1 + custom.findIndex((other) => other.numId === item.numId);
    const abstracts =
      `<w:abstractNum w:abstractNumId="${BULLET_ABSTRACT}"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="${ORDERED_ABSTRACT}"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum>` +
      custom
        .map(
          (item) =>
            `<w:abstractNum w:abstractNumId="${customId(item)}"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true, item.level, item.start)}</w:abstractNum>`
        )
        .join("");
    // Each list is its own instance so numbering restarts; the override also carries `start`.
    const instances = this.numbers
      .map(
        (item) =>
          `<w:num w:numId="${item.numId}"><w:abstractNumId w:val="${!item.ordered ? BULLET_ABSTRACT : item.start !== 1 ? customId(item) : ORDERED_ABSTRACT}"/>` +
          `<w:lvlOverride w:ilvl="${item.level}"><w:startOverride w:val="${item.start}"/></w:lvlOverride></w:num>`
      )
      .join("");
    return `${XML_HEADER}<w:numbering xmlns:w="${NS_W}">${abstracts}${instances}</w:numbering>`;
  }
}

function extraStylesXml(): string {
  const body = STYLE.body;
  return (
    `<w:style w:type="paragraph" w:styleId="${STYLE.compact}"><w:name w:val="Compact"/><w:basedOn w:val="${body}"/><w:qFormat/>` +
    `<w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="${STYLE.footnoteText}"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="0" w:right="0" w:firstLine="0"/></w:pPr>` +
    `<w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>` +
    `<w:style w:type="character" w:styleId="${STYLE.footnoteReference}"><w:name w:val="footnote reference"/>` +
    `<w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="${STYLE.calloutTitle}"><w:name w:val="Callout Title"/><w:basedOn w:val="${body}"/><w:next w:val="${STYLE.calloutBody}"/>` +
    `<w:pPr><w:keepNext/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="7F7F7F"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:before="120" w:after="0"/></w:pPr>` +
    `<w:rPr><w:b/><w:bCs/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="${STYLE.calloutBody}"><w:name w:val="Callout Body"/><w:basedOn w:val="${body}"/>` +
    `<w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="7F7F7F"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:before="0" w:after="0"/></w:pPr></w:style>` +
    `<w:style w:type="character" w:styleId="${STYLE.mathText}"><w:name w:val="Math Text"/>` +
    `<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:cs="Cambria Math"/><w:noProof/></w:rPr></w:style>`
  );
}

function stylesXml(template: WordTemplateSpec, language: "ko" | "en"): string {
  const base =
    `${XML_HEADER}<w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:lang w:val="en-US" w:eastAsia="${language === "ko" ? "ko-KR" : "en-US"}" w:bidi="ar-SA"/>` +
    `</w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults></w:styles>`;
  return applyWordTemplateStyles(base, template).replace("</w:styles>", `${extraStylesXml()}</w:styles>`);
}

function sectionXml(template: WordTemplateSpec): string {
  const patched = applyWordTemplatePage(
    `<w:document xmlns:w="${NS_W}"><w:body><w:sectPr/></w:body></w:document>`,
    template
  );
  const section = /<w:sectPr\b[\s\S]*<\/w:sectPr>/.exec(patched)?.[0];
  if (!section) throw new Error("Could not build the DOCX section properties.");
  return section;
}

function footnotesXml(bodies: readonly string[]): string {
  const separator =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>`;
  const notes = bodies.map((body, index) => `<w:footnote w:id="${index + 1}">${body}</w:footnote>`).join("");
  return `${XML_HEADER}<w:footnotes xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}">${separator}${notes}</w:footnotes>`;
}

function textWidthTwips(template: WordTemplateSpec): number {
  const page = template.page;
  return Math.max(Math.round((page.widthPt - page.marginLeftPt - page.marginRightPt) * 20), 1440);
}

/** Builds the DOCX package of a note body (front matter already removed, images embedded as data URIs). */
export async function writeDocx(markdown: string, options: DocxWriteOptions): Promise<WrittenDocx> {
  const language = options.language ?? "ko";
  const protectedSource = protectMath(markdown);
  const parsed = parseEditorialBlocks(protectedSource.markdown);
  const builder = new DocxBuilder(textWidthTwips(options.template), parsed.footnotes.length, protectedSource.equations);
  const body = builder.blocks(parsed.blocks, { rels: builder.documentRels, style: STYLE.body, indent: 0 });

  const footnoteMark = `<w:r><w:rPr><w:rStyle w:val="${STYLE.footnoteReference}"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>`;
  const footnoteBodies = parsed.footnotes.map((blocks) => {
    const xml = builder.blocks(blocks, { rels: builder.footnoteRels, style: STYLE.footnoteText, indent: 0 });
    // The automatic number goes into the note's first paragraph.
    const lead = /^<w:p><w:pPr>[\s\S]*?<\/w:pPr>/.exec(xml);
    return lead
      ? `${lead[0]}${footnoteMark}${xml.slice(lead[0].length)}`
      : `<w:p><w:pPr><w:pStyle w:val="${STYLE.footnoteText}"/></w:pPr>${footnoteMark}</w:p>${xml}`;
  });
  const unreferenced = parsed.footnotes.length - builder.referencedFootnotes().size;
  if (unreferenced > 0) builder.note("footnote-missing", unreferenced);

  const documentXml =
    `${XML_HEADER}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}">` +
    `<w:body>${body}${sectionXml(options.template)}</w:body></w:document>`;

  const settingsXml = applyWordSettings(
    `${XML_HEADER}<w:settings xmlns:w="${NS_W}"><w:defaultTabStop w:val="720"/>` +
      `<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>` +
      `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>` +
      `<w:themeFontLang w:val="en-US" w:eastAsia="ko-KR" w:bidi="ar-SA"/></w:settings>`
  );
  const fontTableXml = applyWordTemplateFonts(
    `${XML_HEADER}<w:fonts xmlns:w="${NS_W}"><w:font w:name="Cambria Math"/></w:fonts>`,
    options.template
  );

  const rels = builder.documentRels;
  rels.add(`${REL_BASE}/styles`, "styles.xml", false);
  rels.add(`${REL_BASE}/numbering`, "numbering.xml", false);
  rels.add(`${REL_BASE}/footnotes`, "footnotes.xml", false);
  rels.add(`${REL_BASE}/settings`, "settings.xml", false);
  rels.add(`${REL_BASE}/fontTable`, "fontTable.xml", false);

  const imageDefaults = [...new Set(builder.media.map((entry) => IMAGE_EXTENSIONS[entry.mime]))]
    .sort()
    .map((extension) => `<Default Extension="${extension}" ContentType="image/${extension}"/>`)
    .join("");
  const wordType = "application/vnd.openxmlformats-officedocument.wordprocessingml";
  const contentTypes =
    `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>${imageDefaults}` +
    `<Override PartName="/word/document.xml" ContentType="${wordType}.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="${wordType}.styles+xml"/>` +
    `<Override PartName="/word/numbering.xml" ContentType="${wordType}.numbering+xml"/>` +
    `<Override PartName="/word/footnotes.xml" ContentType="${wordType}.footnotes+xml"/>` +
    `<Override PartName="/word/settings.xml" ContentType="${wordType}.settings+xml"/>` +
    `<Override PartName="/word/fontTable.xml" ContentType="${wordType}.fontTable+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
    `</Types>`;
  const packageRels =
    `${XML_HEADER}<Relationships xmlns="${NS_PACKAGE_RELS}">` +
    `<Relationship Id="rId1" Type="${REL_BASE}/officeDocument" Target="word/document.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="${REL_BASE}/extended-properties" Target="docProps/app.xml"/>` +
    `</Relationships>`;
  // No creation time: the same note must give the same bytes.
  const coreXml =
    `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:title>${escapeXml(options.title)}</dc:title><dc:language>${language === "ko" ? "ko-KR" : "en-US"}</dc:language></cp:coreProperties>`;
  const appXml =
    `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>HanMark</Application></Properties>`;

  const zip = new JSZip();
  const add = (name: string, data: string | Uint8Array): void => {
    zip.file(name, data, { date: DOCX_FIXED_ENTRY_DATE, createFolders: false });
  };
  add("[Content_Types].xml", contentTypes);
  add("_rels/.rels", packageRels);
  add("docProps/core.xml", coreXml);
  add("docProps/app.xml", appXml);
  add("word/document.xml", documentXml);
  add("word/_rels/document.xml.rels", rels.xml());
  add("word/styles.xml", stylesXml(options.template, language));
  add("word/numbering.xml", builder.numberingXml());
  add("word/footnotes.xml", footnotesXml(footnoteBodies));
  if (builder.footnoteRels.items.length) add("word/_rels/footnotes.xml.rels", builder.footnoteRels.xml());
  add("word/settings.xml", settingsXml);
  add("word/fontTable.xml", fontTableXml);
  for (const entry of builder.media) add(`word/media/${entry.name}`, entry.data);

  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "DOS"
  });
  return { bytes, notices: builder.noticeList() };
}
