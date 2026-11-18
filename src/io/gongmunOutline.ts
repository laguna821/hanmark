import type { GongmunNumbering, GongmunOptions, GongmunPreset } from "kordoc";
import type { GongmunClosing } from "./gongmunStyle";

/**
 * Heading outline for official documents (2.7.0, R-024).
 *
 * Kordoc's official-document engine reads `#` as the document title, `##` as a
 * chapter, and `###`/`####` as items of depth 0/1. The report family draws chapters
 * as bands, so `###` (□) sits below them. The legal numbering family (official,
 * notice, minutes) draws chapters as depth-0 items ("1."), so `###` lands on the
 * same depth and a note's outline collapses into one numbered run
 * (1. 2. 3. … for both `##` and `###`). A note also often skips levels or has no
 * `#` title at all.
 *
 * This step rewrites only heading markers before the engine runs:
 * - one leading `#` stays the title; without it the note name becomes the title,
 *   and a note that uses several `#` headings as sections is shifted down a level;
 * - heading levels below the chapter level are made consecutive, and in the legal
 *   family they start one level deeper, so `##` → 1., `###` → 가., `####` → 1);
 * - the bullet-style report (개조식) draws its own □ before `###`, so a number the
 *   note already wrote there ("### 1) …") is dropped, as the other presets do.
 * Body text, lists, tables, and code are left as they are.
 *
 * It also lists the note's plain paragraphs with the depth of the heading they sit
 * under. The engine draws every paragraph flush left; in the legal family the
 * finisher (hwpxFinish.ts) moves each one to where a first-level item under its
 * heading starts, so text under "가." no longer sticks out to the left of it.
 * Kordoc reads Markdown line by line (parseMarkdownToBlocks): every non-blank line
 * that is not a heading, list item, quote, table, rule, fence, or formula is a
 * paragraph of its own, and so is every hint here.
 */

/** Kordoc's default numbering per preset (PRESET_DEFAULTS in Kordoc 4.25.0). */
const PRESET_NUMBERING: Readonly<Record<GongmunPreset, GongmunNumbering>> = {
  official: "standard",
  report: "report",
  plan: "report",
  notice: "standard",
  minutes: "standard",
  gaejosik: "gaejosik",
  press: "report",
  ministry: "report",
  // 서울방침 (Kordoc 4.16.1): the Seoul report family, □ ○ - numbering.
  bangchim: "report"
};

// i18n-data-begin: Kordoc's marker glyphs and lead words matched in document text (Kordoc 4.15.7)
/** Leading item markers that make Kordoc switch to box numbering (BOX_RE). */
const BOX_MARKER_RE = /^([□■❑❏ㅁ○ㅇ◦●❍◎\-–―—ㅡ‣▪▫ㆍ·•∙])\s+/u;
/** Markers Kordoc reads at the start of a line: ※ notes, box items, legal numbers (parseLeadingMarker). */
const LEADING_MARKER_RE =
  /^(?:※|＊|\*(?=\s)|[□■❑❏ㅁ○ㅇ◦●❍◎\-–―—ㅡ‣▪▫ㆍ·•∙]\s|(?:\d{1,2}\.|[가-힣]\.|\d{1,2}\)|[가-힣]\)|\(\d{1,2}\)|\([가-힣]\)|[①-⑳]|[㉮-㉻])\s)/u;
/** A number or bullet a note wrote in front of a heading's text. */
const HEADING_NUMBER_RE =
  /^(?:[□■❑❏ㅁ○ㅇ◦●❍◎\-–―—ㅡ‣▪▫ㆍ·•∙]|\d{1,2}\.|[가-힣]\.|\d{1,2}\)|[가-힣]\)|\(\d{1,2}\)|\([가-힣]\)|[①-⑳]|[㉮-㉻])\s+/u;
/** Lines Kordoc turns into attachment or source lines instead of paragraphs (BUNIM_RE, SOURCE_RE). */
const ATTACH_RE = /^붙\s*임(?:\s|:|$)/u;
const SOURCE_RE = /^(?:출처|자료|근거|참고)\s*[:：]/u;
// i18n-data-end
const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const HEADING_RE = /^(\s{0,3})(#{1,6})(?:([ \t]+)(.*?))?[ \t]*$/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const RULE_RE = /^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const MAX_LEVEL = 6;
/** Letters and digits compared when matching a paragraph to the generated document. */
const KEY_LENGTH = 24;
const MIN_KEY_LENGTH = 2;

/** Outline choices of an institution style. */
export interface GongmunOutlineStyle {
  /**
   * Lists directly under a chapter start one level down. For styles whose first
   * item level is a sub-heading (AI융합연구원 "1)"), so list text stays body text (○).
   */
  nestChapterLists?: boolean;
  /**
   * Sub-headings (`###` and below) are written in bold, without a number the note
   * put in front. For styles whose items stand for sub-headings (일송 "• 추진 방향").
   */
  boldSubHeadings?: boolean;
  /** Right-aligned date and sender at the end (통지·안내; applyTypeFrame in gongmunStyle.ts). */
  closing?: GongmunClosing;
}

export interface GongmunOutlineOptions extends GongmunOutlineStyle {
  preset: GongmunPreset;
  /** Numbering chosen by an institution style or note; the preset default otherwise. */
  numbering?: GongmunNumbering;
  /** Chapter look; Kordoc draws "band" chapters (the report default) as a table. */
  h2Marker?: GongmunOptions["h2Marker"];
  /** Document title when the note has no leading `#` title (the note name). */
  title?: string;
}

/** A plain paragraph of the note and the item depth of the heading above it plus one. */
export interface GongmunParagraphHint {
  /** First letters and digits of the paragraph ({@link paragraphSignature}). */
  key: string;
  /** Depth whose item position the paragraph takes; 0 = flush left (no change). */
  depth: number;
}

export interface GongmunOutlineResult {
  markdown: string;
  /** A `#` title was added from `options.title`. */
  titleAdded: boolean;
  /** At least one heading (or, with nestChapterLists, list) line changed. */
  headingsChanged: boolean;
  /** Plain paragraphs in order; empty unless the legal numbering family is used. */
  paragraphs: GongmunParagraphHint[];
}

interface HeadingLine {
  index: number;
  level: number;
  indent: string;
  gap: string;
  text: string;
}

/** Letters and digits only, so quotes, spaces, and inline marks do not matter. */
export function paragraphSignature(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

/** Whether Kordoc will draw this note with legal numbers (1. 가. 1) …). */
export function usesLegalNumbering(markdown: string, options: Pick<GongmunOutlineOptions, "preset" | "numbering">): boolean {
  const numbering = options.numbering ?? PRESET_NUMBERING[options.preset];
  return numbering === "standard" && !hasBoxMarkers(markdown);
}

function scanLines(markdown: string): { lines: string[]; headings: HeadingLine[]; bodyTexts: string[] } {
  const lines = markdown.split(/\r?\n/);
  const headings: HeadingLine[] = [];
  const bodyTexts: string[] = [];
  let fence: string | null = null;
  lines.forEach((line, index) => {
    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      return;
    }
    if (fence) return;
    const heading = HEADING_RE.exec(line);
    if (heading) {
      headings.push({
        index,
        level: heading[2].length,
        indent: heading[1],
        gap: heading[3] ?? " ",
        text: heading[4] ?? ""
      });
      return;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(">") || trimmed.startsWith("|")) return;
    const item = LIST_ITEM_RE.exec(line);
    bodyTexts.push((item ? item[1] : trimmed).trim());
  });
  return { lines, headings, bodyTexts };
}

function hasBoxMarkers(markdown: string): boolean {
  return scanLines(markdown).bodyTexts.some((text) => BOX_MARKER_RE.test(text));
}

/** Link targets, images, footnote marks, and HTML tags are not text of the paragraph. */
function visibleText(markdown: string): string {
  return markdown
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "");
}

/** A line Kordoc reads as something other than a paragraph. */
function startsBlock(line: string): boolean {
  const trimmed = line.trim();
  return LIST_ITEM_RE.test(line) || RULE_RE.test(line) || /^[>|<]/.test(trimmed) || /^\[\^[^\]]+\]:/.test(trimmed);
}

/** A paragraph Kordoc draws as body text (not a ※ note, item, attachment, or aligned line). */
function isPlainParagraph(text: string): boolean {
  const lead = text.replace(/^[\s\u3000]+/u, "");
  if (!lead || LEADING_MARKER_RE.test(lead) || ATTACH_RE.test(lead) || SOURCE_RE.test(lead)) return false;
  return paragraphSignature(visibleText(lead)).length >= MIN_KEY_LENGTH;
}

/**
 * Plain paragraphs with the depth of the heading they follow (Kordoc's buildOutline:
 * a chapter is depth 0, `###` depth 0, `####` depth 1 …; a paragraph takes depth + 1).
 */
function paragraphHints(lines: readonly string[], levels: ReadonlyMap<number, number>, titleIndex: number): GongmunParagraphHint[] {
  const hints: GongmunParagraphHint[] = [];
  let fence: string | null = null;
  let formula = false;
  let headingDepth = -1;
  lines.forEach((line, index) => {
    const fenceMatch = FENCE_RE.exec(line);
    if (fence || fenceMatch) {
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (!fence) fence = marker;
        else if (fence === marker) fence = null;
      }
      return;
    }
    const trimmed = line.trim();
    if (formula || trimmed.startsWith("$$")) {
      // A $$ formula runs to the line that closes it.
      const marks = (trimmed.match(/\$\$/g) ?? []).length;
      if (formula ? marks > 0 : marks === 1) formula = !formula;
      return;
    }
    const level = levels.get(index);
    if (level !== undefined) {
      if (index !== titleIndex) headingDepth = level <= 2 ? 0 : Math.min(level - 3, 7);
      return;
    }
    if (!trimmed || startsBlock(line) || !isPlainParagraph(trimmed)) return;
    hints.push({
      key: paragraphSignature(visibleText(trimmed)).slice(0, KEY_LENGTH),
      depth: headingDepth >= 0 ? headingDepth + 1 : 0
    });
  });
  return hints;
}

const LINK_RE = /\[((?:\\.|[^\]\\])*)\]\(([^)]*)\)/g;
/** Markdown escapes Kordoc reads (its inline parser's set). */
const ESCAPE_RE = /\\([\\`*_{}[\]()#+\-.!|<>~$])/g;

/** Words of inline Markdown as a frame prints them: links, images, code, and emphasis lose their marks. */
export function plainInline(text: string): string {
  const literals: string[] = [];
  const out = text
    .replace(ESCAPE_RE, (_all, char: string) => {
      literals.push(char);
      return `\uE000${literals.length - 1}\uE001`;
    })
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*\*|___)(.+?)\1/g, "$2")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*]+?)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w_])_(?=\S)([^_]+?)_(?!\w)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1");
  return out.replace(/\uE000(\d+)\uE001/g, (_all, index: string) => literals[Number(index)] ?? "");
}

/** Bold a heading's words; inside a link the marks go around the link text so the link stays a link. */
function boldInline(text: string): string {
  if (/[*_]/.test(text.replace(LINK_RE, (_all, words: string) => words))) return text;
  const bold = (segment: string): string => {
    const words = segment.trim();
    return words ? segment.replace(words, `**${words}**`) : segment;
  };
  let out = "";
  let last = 0;
  for (const match of text.matchAll(LINK_RE)) {
    out += bold(text.slice(last, match.index)) + `[**${match[1]}**](${match[2]})`;
    last = match.index + match[0].length;
  }
  return (out + bold(text.slice(last))).trim();
}

/**
 * Heading levels Kordoc draws in a frame that prints raw text: every heading of the
 * ministry briefing (bands, boxes, contents) and the band chapters of the bullet-style
 * report and of the report family (Kordoc 4.15.7).
 */
function drawnInFrame(level: number, legal: boolean, options: GongmunOutlineOptions): boolean {
  if (options.preset === "ministry") return true;
  if (level > 2 || legal) return false;
  if (options.preset === "gaejosik") return true;
  return (options.preset === "report" || options.preset === "plan") && (options.h2Marker ?? "band") === "band";
}

/** Plain text in the quote lines right after the title (Kordoc's report summary box). */
function plainSummary(lines: string[], levels: ReadonlyMap<number, number>): boolean {
  let index = lines.findIndex((_line, position) => levels.get(position) === 1);
  index = index < 0 ? 0 : index + 1;
  while (index < lines.length && !lines[index].trim()) index += 1;
  let changed = false;
  for (; index < lines.length && /^\s*>/.test(lines[index]); index += 1) {
    const quote = /^(\s*>\s?)(.*)$/.exec(lines[index]);
    if (!quote) break;
    const plain = `${quote[1]}${plainInline(quote[2])}`;
    if (plain !== lines[index]) {
      lines[index] = plain;
      changed = true;
    }
  }
  return changed;
}

/** Index of the first line of the quote right after the title (Kordoc's summary box), or -1. */
function firstQuoteRun(lines: readonly string[], levels: ReadonlyMap<number, number>): number {
  let index = lines.findIndex((_line, position) => levels.get(position) === 1);
  index = index < 0 ? 0 : index + 1;
  while (index < lines.length && !lines[index].trim()) index += 1;
  return index < lines.length && /^\s*>/.test(lines[index]) ? index : -1;
}

/**
 * Splits every quote into one quote per line (a blank quote line between them) and drops
 * list marks at their start. `keep` is the first line of a quote left as it is.
 */
function splitQuotes(lines: readonly string[], keep: number): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const fenceMatch = FENCE_RE.exec(line);
    if (fence || fenceMatch) {
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (!fence) fence = marker;
        else if (fence === marker) fence = null;
      }
      out.push(line);
      index += 1;
      continue;
    }
    if (!/^\s*>/.test(line)) {
      out.push(line);
      index += 1;
      continue;
    }
    const start = index;
    const run: string[] = [];
    while (index < lines.length && /^\s*>/.test(lines[index])) run.push(lines[index++]);
    if (start === keep) {
      out.push(...run);
      continue;
    }
    const notes = run
      .map((quote) => /^(\s*>\s?)(.*)$/.exec(quote))
      .filter((match): match is RegExpExecArray => match !== null && match[2].trim() !== "")
      .map((match) => `${match[1]}${match[2].replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+/, "")}`);
    notes.forEach((note, position) => {
      if (position > 0) out.push(">");
      out.push(note);
    });
  }
  return out;
}

/** Indents list items that sit directly under a chapter by one level (two spaces). */
function nestChapterLists(lines: string[], levels: ReadonlyMap<number, number>, titleIndex: number): boolean {
  let fence: string | null = null;
  let underChapter = false;
  let changed = false;
  lines.forEach((line, index) => {
    const fenceMatch = FENCE_RE.exec(line);
    if (fence || fenceMatch) {
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (!fence) fence = marker;
        else if (fence === marker) fence = null;
      }
      return;
    }
    const level = levels.get(index);
    if (level !== undefined) {
      if (index !== titleIndex) underChapter = level <= 2;
      return;
    }
    if (underChapter && LIST_ITEM_RE.test(line)) {
      lines[index] = `  ${line}`;
      changed = true;
    }
  });
  return changed;
}

export function prepareGongmunMarkdown(markdown: string, options: GongmunOutlineOptions): GongmunOutlineResult {
  const { lines, headings } = scanLines(markdown);
  const legal = usesLegalNumbering(markdown, options);
  const levels = new Map<number, number>(headings.map((heading) => [heading.index, heading.level]));

  // 1. Title: exactly one `#`, and it is the first heading → the document title.
  const h1 = headings.filter((heading) => heading.level === 1);
  const titleIsLeadingH1 = h1.length === 1 && headings[0]?.level === 1;
  const shiftSections = h1.length > 1 || (h1.length === 1 && !titleIsLeadingH1);
  if (shiftSections) {
    for (const heading of headings) levels.set(heading.index, Math.min(heading.level + 1, MAX_LEVEL));
  }
  const titleIndex = titleIsLeadingH1 ? headings[0].index : -1;

  // 2. Consecutive levels below the chapter level (`##`).
  const body = headings.filter((heading) => heading.index !== titleIndex);
  const hasChapters = body.some((heading) => (levels.get(heading.index) ?? 0) <= 2);
  const subLevels = [...new Set(body.map((heading) => levels.get(heading.index) ?? 0).filter((level) => level > 2))].sort(
    (a, b) => a - b
  );
  // Legal numbering draws chapters as depth-0 items, so sub-headings start at depth 1.
  const firstSubLevel = legal && hasChapters ? 4 : 3;
  const rank = new Map(subLevels.map((level, position) => [level, Math.min(firstSubLevel + position, MAX_LEVEL)]));
  for (const heading of body) {
    const level = levels.get(heading.index) ?? heading.level;
    if (level > 2) levels.set(heading.index, rank.get(level) ?? level);
  }

  // 3. The bullet-style report puts its own □ / ○ before sub-headings; bold
  //    sub-headings drop the number too, since Kordoc no longer sees it at the start.
  //    Headings Kordoc draws in a frame (title, bands, boxes, contents) print their
  //    text as it is, so they lose link and emphasis marks there (R-027).
  const dropNumbers = options.preset === "gaejosik" || options.boldSubHeadings === true;
  let headingsChanged = false;
  const output = [...lines];
  for (const heading of headings) {
    const level = levels.get(heading.index) ?? heading.level;
    const sub = level > 2 && heading.index !== titleIndex;
    const stripped = dropNumbers && sub ? heading.text.replace(HEADING_NUMBER_RE, "") : heading.text;
    let text = stripped.trim() ? stripped : heading.text;
    if (heading.index === titleIndex || drawnInFrame(level, legal, options)) text = plainInline(text);
    else if (options.boldSubHeadings && sub && text.trim()) text = boldInline(text);
    if (level === heading.level && text === heading.text) continue;
    headingsChanged = true;
    output[heading.index] = `${heading.indent}${"#".repeat(level)}${heading.gap}${text}`;
  }

  // 3b. The report's summary box (the quote right after the title) prints plain text.
  const summaryBox = !legal && (options.preset === "report" || options.preset === "plan");
  if (summaryBox && plainSummary(output, levels)) headingsChanged = true;

  // 4. Lists under a chapter as body text, for styles that use the first item level as a sub-heading.
  if (options.nestChapterLists && nestChapterLists(output, levels, titleIndex)) headingsChanged = true;
  // Paragraph depths use line positions, so they are read before quotes are split below.
  const paragraphs = legal ? paragraphHints(output, levels, titleIndex) : [];

  // 5. Kordoc joins a quote's lines into one ※ note, so a flattened callout with a list
  //    read "※ 제목 - 가 - 나". Each line becomes its own ※ note instead (not in the
  //    report's summary box or the ministry briefing's quote boxes, which keep lines,
  //    nor in the press release, which prints quote lines as they are).
  let noted = output;
  if (options.preset !== "ministry" && options.preset !== "press") {
    noted = splitQuotes(output, summaryBox ? firstQuoteRun(output, levels) : -1);
    if (noted.join("\n") !== output.join("\n")) headingsChanged = true;
  }

  // 6. A note without a leading `#` title gets its name as the title.
  const title = options.title?.replace(/\s+/gu, " ").trim();
  const titleAdded = titleIndex < 0 && !!title;
  const joined = noted.join("\n");
  // 7. The closing lines of a notice, right-aligned after the body.
  const closing = [options.closing?.date, options.closing?.sender && `**${options.closing.sender}**`]
    .filter((line): line is string => Boolean(line?.trim()))
    .map((line) => `<right>${line.trim()}</right>`);
  const text = closing.length ? `${joined.replace(/\s+$/u, "")}\n\n${closing.join("\n\n")}\n` : joined;
  return {
    markdown: titleAdded ? `# ${title}\n\n${text}` : text,
    titleAdded,
    headingsChanged,
    paragraphs
  };
}
