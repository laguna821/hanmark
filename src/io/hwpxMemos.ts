import { addMemoHwpx, parse, validateHwpx, type MemoNote } from "kordoc";
import { finalizeHwpxPackage } from "./hwpxPostProcess";
import { kordocParseOptions } from "./importOptions";
import type { AdapterWarning } from "./markdownAdapter";
import { t } from "../i18n";

/**
 * Hangul memos from a note's comments (3.0.0, R-034).
 *
 * One notation, made of two things Obsidian users already write: a highlight
 * directly followed by a comment.
 *
 *     ==추진 일정==%%1월 워크숍 날짜 확인 필요%%
 *
 * The highlight is the text the memo is attached to (Hangul paints that range),
 * the comment is the memo. Reading view shows the highlight and hides the comment,
 * which is how a memo looks in Hangul. An author may lead the comment as
 * `%%@이름: 글%%`; line breaks inside the comment are memo paragraphs.
 *
 * Comments without a highlight stay ordinary comments and are left out of every
 * export, as before.
 */
export interface MemoMark {
  anchor: string;
  text: string;
  author?: string;
  /** Text of the anchor's paragraph around it, marks and spaces removed; tells repeats apart. */
  context: string;
  /** 0-based count of the same anchor earlier in the note. */
  ordinal: number;
}

export interface MemoExtraction {
  markdown: string;
  memos: MemoMark[];
}

const PAIR = /==([^=\n](?:[^=\n]|=(?!=))*?)==%%([\s\S]*?)%%/gu;
const FENCE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})/u;
const CONTEXT_SPAN = 12;

function plain(text: string): string {
  return text
    .replace(/%%[\s\S]*?%%/gu, "")
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/gu, "$2")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/<[^>]+>/gu, "")
    .replace(/[*_~=`\\]/gu, "")
    .replace(/\s+/gu, "");
}

function splitAuthor(comment: string): { text: string; author?: string } {
  const match = /^\s*@([^:\n]{1,40}):\s*([\s\S]*)$/u.exec(comment);
  const body = (match ? match[2] : comment)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return match ? { text: body, author: match[1].trim() } : { text: body };
}

/**
 * Takes the memo pairs out of a note: the highlight becomes plain text (the memo
 * marks the range in Hangul) and the comment leaves the body. Code blocks and
 * inline code are not read.
 */
export function extractMemoMarks(markdown: string): MemoExtraction {
  if (!markdown.includes("==") || !markdown.includes("%%")) return { markdown, memos: [] };
  const memos: MemoMark[] = [];
  const seen = new Map<string, number>();
  // Paragraph-sized pieces: a pair never spans a blank line, a comment may span lines.
  const pieces = markdown.split(/(\n[ \t]*\n)/u);
  let fence: string | null = null;
  const out = pieces.map((piece, index) => {
    if (index % 2 === 1) return piece;
    const lines = piece.split("\n");
    let touchesFence = false;
    for (const line of lines) {
      const mark = FENCE.exec(line)?.[1];
      if (!mark) continue;
      touchesFence = true;
      if (!fence) fence = mark[0];
      else if (fence === mark[0]) fence = null;
    }
    if (touchesFence || fence || !piece.includes("==")) return piece;
    // Inline code keeps its text: hide it while pairs are read.
    const code: string[] = [];
    const guarded = piece.replace(/(`+)[^`\n]*?\1/gu, (whole) => {
      code.push(whole);
      return `\uE100${code.length - 1}\uE101`;
    });
    const context = plain(guarded.replace(/\uE100\d+\uE101/gu, ""));
    const replaced = guarded.replace(PAIR, (whole: string, anchorRaw: string, comment: string) => {
      const anchor = anchorRaw.trim();
      const memo = splitAuthor(comment);
      if (!anchor || !memo.text) return whole;
      const key = plain(anchor);
      const at = context.indexOf(key);
      const ordinal = seen.get(anchor) ?? 0;
      seen.set(anchor, ordinal + 1);
      memos.push({
        anchor,
        ...memo,
        context: at < 0 ? key : context.slice(Math.max(0, at - CONTEXT_SPAN), at + key.length + CONTEXT_SPAN),
        ordinal
      });
      return anchorRaw;
    });
    return replaced.replace(/\uE100(\d+)\uE101/gu, (_whole, at: string) => code[Number(at)]);
  });
  return memos.length ? { markdown: out.join(""), memos } : { markdown, memos: [] };
}

export interface PlacedMemos {
  data: ArrayBuffer;
  placed: number;
  /** Memos whose text was not found in one paragraph of the document. */
  unplaced: MemoMark[];
}

const MAX_OCCURRENCE_TRIES = 12;

async function readMemos(data: ArrayBuffer): Promise<MemoNote[]> {
  const parsed = await parse(data.slice(0), kordocParseOptions({ images: false, memos: true }));
  return parsed.success ? parsed.memos ?? [] : [];
}

function sameSpot(memo: MemoNote | undefined, mark: MemoMark): boolean {
  if (!memo) return false;
  const paragraph = plain(memo.paragraph);
  return paragraph.includes(mark.context) || mark.context.includes(paragraph);
}

/**
 * Attaches memos to a generated HWPX. The engine finds an anchor by its text in
 * document order, inside one paragraph. The same words can come earlier in the
 * document than in the note (a contents page repeats headings), so each placement
 * is read back and compared with the note's paragraph; a memo that lands elsewhere
 * is tried on the next occurrence.
 */
export async function placeMemos(hwpx: ArrayBuffer, memos: readonly MemoMark[], now: Date): Promise<PlacedMemos> {
  let data = hwpx;
  let placed = 0;
  const unplaced: MemoMark[] = [];
  for (const mark of memos) {
    let done = false;
    let firstHit: ArrayBuffer | null = null;
    const order = [mark.ordinal, ...Array.from({ length: MAX_OCCURRENCE_TRIES }, (_unused, at) => at).filter((at) => at !== mark.ordinal)];
    for (const occurrence of order) {
      let result: Awaited<ReturnType<typeof addMemoHwpx>>;
      try {
        result = await addMemoHwpx(
          data.slice(0),
          [{ anchor: mark.anchor, text: mark.text, occurrence, ...(mark.author ? { author: mark.author } : { author: "HanMark" }) }],
          now
        );
      } catch {
        // No such occurrence: with the note's own count gone, lower ones may still exist.
        if (occurrence === mark.ordinal) continue;
        break;
      }
      const number = result.placed[0]?.number;
      const back = (await readMemos(result.buffer)).find((memo) => memo.number === number);
      if (sameSpot(back, mark)) {
        data = result.buffer;
        done = true;
        break;
      }
      firstHit ??= result.buffer;
    }
    if (!done && firstHit) {
      // The text exists but its paragraph reads differently (a frame, a generated line):
      // the first occurrence is where a reader would look.
      data = firstHit;
      done = true;
    }
    if (done) placed += 1;
    else unplaced.push(mark);
  }
  return { data, placed, unplaced };
}

/** Reads the stored setting "주석을 한글 메모로"; unknown or missing means off. */
export function commentsAsMemosSetting(settings: Record<string, unknown>): boolean {
  return settings.commentsAsMemos === true;
}

/**
 * Attaches the note's memos to a generated document, packs it deterministically and
 * validates it again. Without memos the document is returned untouched (same bytes).
 */
export async function attachMemos<T extends { data: ArrayBuffer; warnings: AdapterWarning[] }>(
  generated: T,
  memos: readonly MemoMark[],
  now: Date = new Date(new Date().setHours(0, 0, 0, 0))
): Promise<T> {
  if (!memos.length) return generated;
  const result = await placeMemos(generated.data, memos, now);
  if (!result.placed) {
    return { ...generated, warnings: [...generated.warnings, { code: "memo-unplaced", message: unplacedMemoNotice(result.unplaced), count: result.unplaced.length }] };
  }
  const finalized = await finalizeHwpxPackage(result.data);
  const validation = await validateHwpx(finalized.data);
  if (!validation.ok) throw new Error(validation.issues.slice(0, 3).map((issue) => issue.message).join(" / "));
  const warnings: AdapterWarning[] = [
    ...generated.warnings,
    { code: "memo-placed", message: t("memo.notice.placed", { count: result.placed }), count: result.placed }
  ];
  if (result.unplaced.length) {
    warnings.push({ code: "memo-unplaced", message: unplacedMemoNotice(result.unplaced), count: result.unplaced.length });
  }
  return { ...generated, data: finalized.data, warnings, ...("validation" in generated ? { validation } : {}) };
}

/** Report sentence for memos that could not be attached. */
export function unplacedMemoNotice(unplaced: readonly MemoMark[]): string {
  const names = unplaced.slice(0, 3).map((mark) => `「${mark.anchor}」`).join(", ");
  return t("memo.warning.unplaced", { count: unplaced.length, names });
}

// i18n-data-begin: heading Kordoc writes above the memo list of an imported document
const MEMO_HEADING = "**메모**";
const MEMO_SECTION = /\n---\n\n\*\*메모\*\*\n\n((?:\d+\. [^\n]*\n?)+)\s*$/u;
// i18n-data-end

function escapeForComment(text: string): string {
  return text.replace(/%%/gu, "% %");
}

/**
 * Import side: Kordoc lists a document's memos in a section at the end of the note.
 * Each memo whose anchor is found once in its paragraph moves into the body in the
 * notation above, so exporting with "주석을 한글 메모로" puts it back. Memos that
 * cannot be placed stay in the list.
 */
export function inlineImportedMemos(markdown: string, memos: readonly MemoNote[] | undefined): { markdown: string; inlined: number; kept: number } {
  if (!memos?.length) return { markdown, inlined: 0, kept: 0 };
  const section = MEMO_SECTION.exec(markdown);
  if (!section) return { markdown, inlined: 0, kept: memos.length };
  const items = section[1].trimEnd().split("\n");
  if (items.length !== memos.length) return { markdown, inlined: 0, kept: memos.length };
  let body = markdown.slice(0, section.index);
  const kept: string[] = [];
  let inlined = 0;
  // Kordoc lists memos in document order; the note is read front to back to keep repeats apart.
  let cursor = 0;
  for (const [index, memo] of memos.entries()) {
    const anchor = memo.anchor;
    const at = anchor ? body.indexOf(anchor, cursor) : -1;
    const lineStart = at < 0 ? -1 : body.lastIndexOf("\n", at) + 1;
    const lineEnd = at < 0 ? -1 : (body.indexOf("\n", at) + 1 || body.length + 1) - 1;
    const line = at < 0 ? "" : body.slice(lineStart, lineEnd);
    const usable =
      at >= 0 &&
      !anchor.includes("\n") &&
      !/[|`]/u.test(line) && // table rows and code keep their notation
      // Not inside a highlight that is already open on this line.
      (body.slice(lineStart, at).split("==").length - 1) % 2 === 0 &&
      plain(line).includes(plain(anchor));
    if (!usable) {
      kept.push(items[index]);
      continue;
    }
    const author = memo.author && memo.author !== "kordoc" && memo.author !== "HanMark" ? `@${memo.author.replace(/[:\n]/gu, " ")}: ` : "";
    const pair = `==${anchor}==%%${author}${escapeForComment(memo.text)}%%`;
    body = body.slice(0, at) + pair + body.slice(at + anchor.length);
    cursor = at + pair.length;
    inlined += 1;
  }
  if (!kept.length) return { markdown: `${body.trimEnd()}\n`, inlined, kept: 0 };
  const renumbered = kept.map((item, at) => item.replace(/^\d+\./u, `${at + 1}.`));
  return { markdown: `${body}\n---\n\n${MEMO_HEADING}\n\n${renumbered.join("\n")}\n`, inlined, kept: kept.length };
}
