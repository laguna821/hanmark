import { lintBlocks, usesGaejosikMunche, type GongmunPreset, type LintBlock } from "kordoc";
import { DEFAULT_CHECK_FAMILIES, type CheckFamily, type CheckFamilySwitches } from "./gongmunCheckFamilies";

/**
 * Official-document checks over a note (3.0.0, R-035).
 *
 * The note is cut into blocks the user typed (one per line, one per table cell) and
 * handed to Kordoc's lintBlocks, which answers with a block id and UTF-16 offsets.
 * Every finding therefore carries the exact range in the NOTE: no mapping back
 * through note assembly or the export adapter is needed, because neither runs here.
 * Front matter, code blocks (Mermaid included), comments, math blocks and embed lines
 * are not checked.
 */
export { CHECK_FAMILIES, DEFAULT_CHECK_FAMILIES, type CheckFamily, type CheckFamilySwitches } from "./gongmunCheckFamilies";

export interface CheckFinding {
  family: CheckFamily;
  rule: string;
  severity: "error" | "warning";
  /** Engine message (Korean), shown as is. */
  message: string;
  match: string;
  /** Zero-based line of the note and UTF-16 column of the first character. */
  line: number;
  ch: number;
  length: number;
  /** Text that replaces the range when the engine gave a concrete replacement. */
  replacement?: string;
  /** Advice of the engine that is not a replacement ("예) …"). */
  advice?: string;
}

export interface CheckOptions {
  families?: CheckFamilySwitches;
  preset?: GongmunPreset;
  /** Entries of the note's ignore property: a rule id, or `rule|matched text`. */
  ignored?: readonly string[];
  /** Milliseconds one run may take; later slices are left unchecked (default 1500). */
  budgetMs?: number;
  now?: () => number;
}

export interface CheckResult {
  findings: CheckFinding[];
  /** Findings hidden by the note's ignore list. */
  ignored: number;
  /** Lines that were checked. */
  checkedLines: number;
  /** The run stopped at its time budget or skipped over-long lines. */
  partial: boolean;
  /** The note is larger than the checker accepts; nothing was checked. */
  tooLarge: boolean;
}

/** Notes above this size are not checked while typing or in the window. */
export const MAX_CHECK_CHARS = 400_000;
/** A single line longer than this is skipped (never a real paragraph). */
export const MAX_CHECK_LINE = 20_000;
const SLICE_BLOCKS = 600;
const DEFAULT_BUDGET_MS = 1500;

export interface CheckBlock extends LintBlock {
  line: number;
  ch: number;
}

function fenceOf(line: string): string | null {
  return /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})/u.exec(line)?.[1] ?? null;
}

function closesFence(line: string, fence: string): boolean {
  const close = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})[ \t]*$/u.exec(line)?.[1];
  return Boolean(close && close[0] === fence[0] && close.length >= fence.length);
}

/** Cells of a pipe-table row with the column where each trimmed cell starts; null when the line is no row. */
function tableCells(line: string): Array<{ text: string; ch: number }> | null {
  const lead = /^(?:[ \t]*>)*[ \t]*/u.exec(line)?.[0].length ?? 0;
  if (line[lead] !== "|") return null;
  const cells: Array<{ text: string; ch: number }> = [];
  let start = lead + 1;
  for (let at = lead + 1; at <= line.length; at += 1) {
    const end = at === line.length;
    if (!end && line[at] === "\\") {
      at += 1;
      continue;
    }
    if (end || line[at] === "|") {
      const raw = line.slice(start, at);
      if (!(end && !raw.trim())) {
        const trimmedStart = raw.length - raw.trimStart().length;
        cells.push({ text: raw.trim(), ch: start + trimmedStart });
      }
      start = at + 1;
    }
  }
  return cells;
}

const DELIMITER_CELL = /^:?-{1,}:?$/u;

/** The checkable blocks of a note: body lines and table cells, each with its place in the note. */
export function buildCheckBlocks(note: string): { blocks: CheckBlock[]; skippedLong: number } {
  const lines = note.split("\n").map((line) => line.replace(/\r$/u, ""));
  const blocks: CheckBlock[] = [];
  let skippedLong = 0;
  let index = 0;
  // Front matter.
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, at) => at > 0 && /^(?:---|\.\.\.)\s*$/u.test(line));
    if (end > 0) index = end + 1;
  }
  let fence: string | null = null;
  let comment: "%%" | "html" | null = null;
  let math = false;
  let table = 0;
  let tableRow = -1;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    if (comment) {
      if (comment === "%%" ? line.includes("%%") : line.includes("-->")) comment = null;
      continue;
    }
    if (math) {
      if (line.trim().endsWith("$$")) math = false;
      continue;
    }
    const opened = fenceOf(line);
    if (opened) {
      fence = opened;
      tableRow = -1;
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      tableRow = -1;
      continue;
    }
    if (trimmed.startsWith("%%")) {
      if (!(trimmed.length > 2 && trimmed.endsWith("%%") && trimmed.indexOf("%%", 2) >= 0)) comment = "%%";
      continue;
    }
    if (trimmed.startsWith("<!--")) {
      if (!trimmed.includes("-->")) comment = "html";
      continue;
    }
    if (trimmed.startsWith("$$")) {
      if (!(trimmed.length > 2 && trimmed.endsWith("$$"))) math = true;
      continue;
    }
    if (/^!\[\[[^\]]*\]\]$/u.test(trimmed)) continue;
    if (line.length > MAX_CHECK_LINE) {
      skippedLong += 1;
      continue;
    }
    const cells = tableCells(line);
    if (cells) {
      if (cells.length && cells.every((cell) => DELIMITER_CELL.test(cell.text))) continue;
      if (tableRow < 0) {
        table += 1;
        tableRow = 0;
      } else {
        tableRow += 1;
      }
      cells.forEach((cell, col) => {
        if (!cell.text) return;
        blocks.push({
          id: `${index}:${col}`,
          text: cell.text,
          table: { id: `t${table}`, row: tableRow, col },
          line: index,
          ch: cell.ch
        });
      });
      continue;
    }
    tableRow = -1;
    blocks.push({ id: `${index}`, text: line, line: index, ch: 0 });
  }
  return { blocks, skippedLong };
}

/** Entry of the note's ignore list that hides exactly this finding's text for its rule. */
export function ignoreEntry(finding: Pick<CheckFinding, "rule" | "match">): string {
  return `${finding.rule}|${finding.match}`;
}

function isIgnored(finding: CheckFinding, ignored: ReadonlySet<string>): boolean {
  return ignored.has(finding.rule) || ignored.has(ignoreEntry(finding));
}

/**
 * A replacement the engine states as "matched → replacement"; advice such as
 * "예) 2025. 1. 6." is not a replacement.
 */
export function replacementOf(match: string, suggest: string | undefined): string | undefined {
  if (!suggest || !match) return undefined;
  const lead = `${match} → `;
  if (!suggest.startsWith(lead)) return undefined;
  const replacement = suggest.slice(lead.length);
  return replacement && replacement !== match && !replacement.includes("\n") ? replacement : undefined;
}

const SPACING_AND_MARKS = /[\s~∼〜\-–—‐.,·‧ㆍ]/gu;

/**
 * A fix is mechanical when it only changes spacing, dashes, tildes and dots: every
 * letter and digit stays, in order. Only such fixes may be applied in bulk; a fix
 * that changes a weekday, an amount or a sum states a fact and needs the user's eye.
 */
export function isMechanicalFix(finding: Pick<CheckFinding, "match" | "replacement">): boolean {
  if (finding.replacement === undefined) return false;
  return finding.match.replace(SPACING_AND_MARKS, "") === finding.replacement.replace(SPACING_AND_MARKS, "");
}

function slices(blocks: readonly CheckBlock[]): CheckBlock[][] {
  const out: CheckBlock[][] = [];
  let current: CheckBlock[] = [];
  for (const block of blocks) {
    // Never cut inside a table: sums are checked per table.
    const lastTable = current[current.length - 1]?.table?.id;
    if (current.length >= SLICE_BLOCKS && !(block.table && block.table.id === lastTable)) {
      out.push(current);
      current = [];
    }
    current.push(block);
  }
  if (current.length) out.push(current);
  return out;
}

function lintSlice(
  slice: readonly CheckBlock[],
  families: CheckFamilySwitches,
  preset: GongmunPreset | undefined
): CheckFinding[] {
  const byId = new Map(slice.map((block) => [block.id, block]));
  // Bullet-style wording rules only fit forms written in that style (as in 2.7.0).
  const munche = families.munche && usesGaejosikMunche(preset);
  const result = lintBlocks(
    slice.map(({ id, text, table }) => (table ? { id, text, table } : { id, text })),
    {
      munche,
      budget: families.budget,
      slop: families.slop,
      logic: families.logic,
      numbers: false,
      gate: false,
      ...(preset ? { preset } : {})
    }
  );
  const findings: CheckFinding[] = [];
  for (const item of result.findings) {
    if (!families[item.category] || (item.category === "munche" && !munche)) continue;
    const block = item.block === null ? undefined : byId.get(item.block);
    if (!block) continue;
    const offset = item.offset ?? Math.max(0, block.text.indexOf(item.match));
    const length = item.offset === null ? item.match.length : item.length;
    const replacement = replacementOf(block.text.slice(offset, offset + length), item.suggest);
    findings.push({
      family: item.category,
      rule: item.rule,
      severity: item.severity,
      message: item.message,
      match: block.text.slice(offset, offset + length) || item.match,
      line: block.line,
      ch: block.ch + offset,
      length,
      ...(replacement !== undefined ? { replacement } : item.suggest ? { advice: item.suggest } : {})
    });
  }
  return findings;
}

function finish(findings: CheckFinding[], ignored: ReadonlySet<string>): { kept: CheckFinding[]; hidden: number } {
  const kept = findings.filter((finding) => !isIgnored(finding, ignored));
  kept.sort((a, b) => a.line - b.line || a.ch - b.ch || a.rule.localeCompare(b.rule));
  return { kept, hidden: findings.length - kept.length };
}

function empty(tooLarge: boolean): CheckResult {
  return { findings: [], ignored: 0, checkedLines: 0, partial: false, tooLarge };
}

/** Checks a note in one go, slice by slice, stopping at the time budget. */
export function runGongmunCheck(note: string, options: CheckOptions = {}): CheckResult {
  if (note.length > MAX_CHECK_CHARS) return empty(true);
  const families = options.families ?? DEFAULT_CHECK_FAMILIES;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);
  const { blocks, skippedLong } = buildCheckBlocks(note);
  const findings: CheckFinding[] = [];
  const lines = new Set<number>();
  let partial = skippedLong > 0;
  for (const slice of slices(blocks)) {
    if (now() > deadline) {
      partial = true;
      break;
    }
    findings.push(...lintSlice(slice, families, options.preset));
    for (const block of slice) lines.add(block.line);
  }
  const { kept, hidden } = finish(findings, new Set(options.ignored ?? []));
  return { findings: kept, ignored: hidden, checkedLines: lines.size, partial, tooLarge: false };
}

/**
 * The same check for use while the user types: yields between slices and stops as
 * soon as `cancelled` says the note has changed again.
 */
export async function runGongmunCheckAsync(
  note: string,
  options: CheckOptions & { cancelled?: () => boolean; pause?: () => Promise<void> } = {}
): Promise<CheckResult | null> {
  if (note.length > MAX_CHECK_CHARS) return empty(true);
  const families = options.families ?? DEFAULT_CHECK_FAMILIES;
  // The caller supplies the pause that lets the editor breathe (a window timer); tests run straight through.
  const pause = options.pause ?? (() => Promise.resolve());
  const { blocks, skippedLong } = buildCheckBlocks(note);
  const findings: CheckFinding[] = [];
  const lines = new Set<number>();
  for (const slice of slices(blocks)) {
    await pause();
    if (options.cancelled?.()) return null;
    findings.push(...lintSlice(slice, families, options.preset));
    for (const block of slice) lines.add(block.line);
  }
  const { kept, hidden } = finish(findings, new Set(options.ignored ?? []));
  return { findings: kept, ignored: hidden, checkedLines: lines.size, partial: skippedLong > 0, tooLarge: false };
}

export interface TextEdit {
  line: number;
  ch: number;
  length: number;
  text: string;
}

/**
 * The edit that applies a finding's replacement, or null when the note no longer
 * holds the checked text at that place (the fix is then refused, not guessed).
 */
export function fixEdit(lineText: string | undefined, finding: CheckFinding): TextEdit | null {
  if (finding.replacement === undefined || lineText === undefined) return null;
  if (lineText.slice(finding.ch, finding.ch + finding.length) !== finding.match) return null;
  return { line: finding.line, ch: finding.ch, length: finding.length, text: finding.replacement };
}

/** Mechanical fixes of a result that do not overlap, last first so earlier ranges stay valid. */
export function mechanicalFixEdits(lines: readonly string[], findings: readonly CheckFinding[]): TextEdit[] {
  const edits: TextEdit[] = [];
  const ordered = findings
    .filter((finding) => isMechanicalFix(finding))
    .sort((a, b) => b.line - a.line || b.ch - a.ch);
  let lastLine = -1;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const finding of ordered) {
    const edit = fixEdit(lines[finding.line], finding);
    if (!edit) continue;
    if (finding.line === lastLine && finding.ch + finding.length > lastStart) continue;
    edits.push(edit);
    lastLine = finding.line;
    lastStart = finding.ch;
  }
  return edits;
}

export interface CheckSummary {
  total: number;
  errors: number;
  byFamily: Record<CheckFamily, number>;
}

export function summarizeCheck(findings: readonly CheckFinding[]): CheckSummary {
  const byFamily: Record<CheckFamily, number> = { notation: 0, munche: 0, budget: 0, logic: 0, slop: 0 };
  let errors = 0;
  for (const finding of findings) {
    byFamily[finding.family] += 1;
    if (finding.severity === "error") errors += 1;
  }
  return { total: findings.length, errors, byFamily };
}

/** Note property that holds the ignore list (a list of rule ids and `rule|text` entries). */
export const CHECK_IGNORE_KEY = "공문_점검무시"; // i18n-data: note property key
export const CHECK_IGNORE_ALIAS = "gongmun-check-ignore";

export function readIgnoreList(frontmatter: Readonly<Record<string, unknown>> | null | undefined): string[] {
  const value = frontmatter?.[CHECK_IGNORE_KEY] ?? frontmatter?.[CHECK_IGNORE_ALIAS];
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return list.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/** Adds an entry to the ignore list in a front-matter object (used with processFrontMatter). */
export function addIgnoreEntry(frontmatter: Record<string, unknown>, entry: string): void {
  const key = CHECK_IGNORE_ALIAS in frontmatter && !(CHECK_IGNORE_KEY in frontmatter) ? CHECK_IGNORE_ALIAS : CHECK_IGNORE_KEY;
  const list = readIgnoreList(frontmatter);
  if (!list.includes(entry)) list.push(entry);
  frontmatter[key] = list;
}
