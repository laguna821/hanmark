import JSZip from "jszip";

/**
 * Superscripts and subscripts in generated HWPX (3.0.0, R-032 §9).
 *
 * Kordoc 4.25.0 reads raised and lowered text as `<sup>`/`<sub>` (HanMark's import
 * default), but its generator drops the tags and writes the text at body size
 * ("25m<sup>2</sup>" came out as the run "25m2"). HanMark therefore marks the spans
 * with private-use characters before generation and, in the finished section XML,
 * turns each marked stretch into its own run whose character shape is a copy of the
 * surrounding shape plus `<hh:supscript/>` or `<hh:subscript/>`.
 */
export const SCRIPT_SUP_OPEN = "\uE010";
export const SCRIPT_SUP_CLOSE = "\uE011";
export const SCRIPT_SUB_OPEN = "\uE012";
export const SCRIPT_SUB_CLOSE = "\uE013";

const MARKER_CLASS = "\uE010-\uE013";
const ANY_MARKER = new RegExp(`[${MARKER_CLASS}]`);
const ANY_MARKER_GLOBAL = new RegExp(`[${MARKER_CLASS}]`, "g");
// Not preceded by a backslash: Kordoc's import writes a literal "<" as "\<".
const SCRIPT_TAG = /(?<!\\)<(sup|sub)>((?:(?!<\/?(?:sup|sub)>)[^\n])+?)<\/\1>/gi;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

export type ScriptKind = "sup" | "sub";

export interface MarkedScripts {
  markdown: string;
  /** Number of `<sup>`/`<sub>` spans marked for {@link applyScriptRunsToHwpx}. */
  marked: number;
}

/** Ranges of inline code in a line: a run of backticks up to the next run of the same length. */
function codeSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`") {
      index += 1;
      continue;
    }
    let length = 1;
    while (line[index + length] === "`") length += 1;
    let close = -1;
    for (let at = index + length; at < line.length; at += 1) {
      if (line[at] !== "`") continue;
      let run = 1;
      while (line[at + run] === "`") run += 1;
      if (run === length) {
        close = at;
        break;
      }
      at += run - 1;
    }
    if (close < 0) {
      index += length;
      continue;
    }
    spans.push([index, close + length]);
    index = close + length;
  }
  return spans;
}

/** Replaces spans outside code with markers; code spans and fences keep their text. */
function markLine(line: string): { line: string; marked: number } {
  let marked = 0;
  let output = "";
  let cursor = 0;
  const replace = (text: string): string =>
    text.replace(SCRIPT_TAG, (_all, tag: string, inner: string) => {
      marked += 1;
      return tag.toLowerCase() === "sup"
        ? `${SCRIPT_SUP_OPEN}${inner}${SCRIPT_SUP_CLOSE}`
        : `${SCRIPT_SUB_OPEN}${inner}${SCRIPT_SUB_CLOSE}`;
    });
  for (const [start, end] of codeSpans(line)) {
    output += replace(line.slice(cursor, start)) + line.slice(start, end);
    cursor = end;
  }
  output += replace(line.slice(cursor));
  return { line: output, marked };
}

/**
 * Marks `<sup>…</sup>` and `<sub>…</sub>` for the generator. A note that already
 * contains one of the marker characters is left untouched (its tags are dropped by
 * the engine as before) rather than risking a wrong run split.
 */
export function markScriptTags(markdown: string): MarkedScripts {
  if (!/<su[pb]>/i.test(markdown) || ANY_MARKER.test(markdown)) return { markdown, marked: 0 };
  let marked = 0;
  let fence: string | null = null;
  const lines = markdown.split(/(\r?\n)/);
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index];
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const character = fenceMatch[1][0];
      if (!fence) fence = character;
      else if (fence === character) fence = null;
      continue;
    }
    if (fence || !/<su[pb]>/i.test(line)) continue;
    const result = markLine(line);
    lines[index] = result.line;
    marked += result.marked;
  }
  return { markdown: marked ? lines.join("") : markdown, marked };
}

class ScriptShapes {
  private readonly clones = new Map<string, string>();

  constructor(public header: string) {}

  /** Id of the copy of character shape `id` that is raised or lowered. */
  shape(id: string, kind: ScriptKind): string {
    const key = `${id}:${kind}`;
    const known = this.clones.get(key);
    if (known !== undefined) return known;
    const source = new RegExp(`<hh:charPr id="${id}"[\\s\\S]*?<\\/hh:charPr>`).exec(this.header)?.[0];
    if (!source) return id;
    let max = -1;
    for (const match of this.header.matchAll(/<hh:charPr id="(\d+)"/g)) max = Math.max(max, Number(match[1]));
    const newId = String(max + 1);
    const element = source
      .replace(/^<hh:charPr id="\d+"/, `<hh:charPr id="${newId}"`)
      .replace(/<hh:(?:supscript|subscript)\b[^>]*\/>/g, "")
      .replace(/<\/hh:charPr>$/, `<hh:${kind === "sup" ? "supscript" : "subscript"}/></hh:charPr>`);
    const close = "</hh:charProperties>";
    const at = this.header.indexOf(close);
    if (at < 0) return id;
    this.header = `${this.header.slice(0, at)}${element}\n    ${this.header.slice(at)}`;
    this.header = this.header.replace(
      /(<hh:charProperties itemCnt=")(\d+)(")/,
      (_all, a: string, count: string, b: string) => `${a}${Number(count) + 1}${b}`
    );
    this.clones.set(key, newId);
    return newId;
  }
}

const TOKEN = /<hp:p\b[^>]*>|<hp:run\b[^>]*?\/>|<hp:run\b[^>]*>|<\/hp:run>|<hp:t>[\s\S]*?<\/hp:t>|<hp:t\/>/g;

export interface ScriptRunResult {
  section: string;
  header: string;
  /** Raised or lowered stretches written as runs. */
  applied: number;
}

/**
 * Splits marked stretches of text into runs of their own. Runs nest (a run can hold
 * a table or a footnote whose paragraphs have runs), so the scan keeps a stack of the
 * open runs; the markers of one span may sit in different `<hp:t>` elements when the
 * span holds emphasis.
 */
export function applyScriptRunsToXml(sectionXml: string, headerXml: string): ScriptRunResult {
  if (!ANY_MARKER.test(sectionXml)) return { section: sectionXml, header: headerXml, applied: 0 };
  const shapes = new ScriptShapes(headerXml);
  const stack: Array<{ open: string; id: string }> = [];
  let state: ScriptKind | null = null;
  let applied = 0;
  let output = "";
  let cursor = 0;
  // Set when the reopened original run turned out to be empty: its close tag is dropped.
  let dropNextClose = false;
  for (const match of sectionXml.matchAll(TOKEN)) {
    const token = match[0];
    const at = match.index ?? 0;
    output += sectionXml.slice(cursor, at);
    cursor = at + token.length;
    if (token.startsWith("<hp:p")) {
      // A span never crosses a paragraph; an unmatched marker ends here.
      state = null;
      output += token;
    } else if (token.startsWith("</hp:run")) {
      stack.pop();
      if (dropNextClose) dropNextClose = false;
      else output += token;
    } else if (token.startsWith("<hp:run")) {
      if (!token.endsWith("/>")) stack.push({ open: token, id: /\bcharPrIDRef="(\d+)"/.exec(token)?.[1] ?? "0" });
      output += token;
    } else if (token === "<hp:t/>" || (!state && !ANY_MARKER.test(token))) {
      output += token;
    } else {
      const run = stack[stack.length - 1];
      const inner = token.slice("<hp:t>".length, -"</hp:t>".length);
      if (!run) {
        output += `<hp:t>${inner.replace(ANY_MARKER_GLOBAL, "")}</hp:t>`;
        continue;
      }
      // Pieces of the text, each raised, lowered, or plain.
      const pieces: Array<{ text: string; kind: ScriptKind | null }> = [];
      let text = "";
      const flush = (): void => {
        if (text) pieces.push({ text, kind: state });
        text = "";
      };
      for (const character of inner) {
        if (character === SCRIPT_SUP_OPEN || character === SCRIPT_SUB_OPEN) {
          flush();
          state = character === SCRIPT_SUP_OPEN ? "sup" : "sub";
        } else if (character === SCRIPT_SUP_CLOSE || character === SCRIPT_SUB_CLOSE) {
          flush();
          state = null;
        } else {
          text += character;
        }
      }
      flush();
      // A plain piece stays in the original run. A raised or lowered piece closes the
      // original run, gets a run of its own, and reopens the original run for what
      // follows; an original run left empty by this is not written.
      for (const piece of pieces) {
        if (!piece.kind) {
          output += `<hp:t>${piece.text}</hp:t>`;
          continue;
        }
        output = output.endsWith(run.open) ? output.slice(0, -run.open.length) : `${output}</hp:run>`;
        output += `<hp:run charPrIDRef="${shapes.shape(run.id, piece.kind)}"><hp:t>${piece.text}</hp:t></hp:run>${run.open}`;
        applied += 1;
      }
      if (output.endsWith(run.open) && sectionXml.startsWith("</hp:run>", cursor)) {
        output = output.slice(0, -run.open.length);
        dropNextClose = true;
      }
    }
  }
  output += sectionXml.slice(cursor);
  return { section: output, header: shapes.header, applied };
}

const SECTION_ENTRY = /^Contents\/section\d+\.xml$/;

/** Applies {@link applyScriptRunsToXml} to every section of a generated HWPX. */
export async function applyScriptRunsToHwpx(data: ArrayBuffer): Promise<{ data: ArrayBuffer; applied: number }> {
  const zip = await JSZip.loadAsync(data);
  const headerEntry = zip.file("Contents/header.xml");
  if (!headerEntry) return { data, applied: 0 };
  let header = await headerEntry.async("text");
  let applied = 0;
  let touched = false;
  const sections = Object.keys(zip.files).filter((name) => SECTION_ENTRY.test(name)).sort();
  for (const name of sections) {
    const xml = await zip.file(name)!.async("text");
    if (!ANY_MARKER.test(xml)) continue;
    const result = applyScriptRunsToXml(xml, header);
    header = result.header;
    applied += result.applied;
    zip.file(name, result.section);
    touched = true;
  }
  if (!touched) return { data, applied: 0 };
  zip.file("Contents/header.xml", header);
  return { data: await zip.generateAsync({ type: "arraybuffer" }), applied };
}
