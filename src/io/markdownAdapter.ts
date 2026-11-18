import { markdownImageTokens } from "./markdownImageTokens";
import {
  resolveOutputLocale,
  t,
  tOut,
  translate,
  type LanguagePreference,
  type Locale,
  type MessageKey
} from "../i18n";

export type AdapterWarningCode =
  | "image-missing"
  | "note-embed-flattened"
  | "file-embed-flattened"
  | "embed-missing"
  | "embed-cycle"
  | "embed-depth"
  | "embed-section"
  | "gongmun-property"
  | "engine-note"
  | "callout-flattened"
  | "highlight-flattened"
  | "footnote-undefined"
  | "font-substituted"
  | "font-missing"
  | "document-style-level-unused"
  | "diagram-kept-as-code"
  | "diagram-font"
  | "memo-placed"
  | "memo-unplaced";

export interface AdapterWarning {
  code: AdapterWarningCode;
  message: string;
  count: number;
}

export interface MarkdownAdapterResult {
  markdown: string;
  warnings: AdapterWarning[];
  /** Number of unique Markdown/HTML image sources found outside fenced code. */
  imageCount: number;
}

export interface MarkdownAdapterOptions {
  /**
   * Language of labels the adapter writes into the document (callout titles,
   * embed placeholders). "auto" (default) reads the note itself: Korean when it
   * contains Hangul, English otherwise.
   */
  outputLanguage?: LanguagePreference;
}

const IMAGE_EXT = /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp|wmf|emf)$/i;
const FENCE = /^\s*(`{3,}|~{3,})/;

const CALLOUT_LABELS: Readonly<Record<string, MessageKey>> = {
  note: "output.callout.note",
  info: "output.callout.info",
  tip: "output.callout.tip",
  warning: "output.callout.warning",
  caution: "output.callout.caution",
  danger: "output.callout.danger",
  error: "output.callout.error",
  example: "output.callout.example",
  quote: "output.callout.quote",
  question: "output.callout.question",
  success: "output.callout.success",
  failure: "output.callout.failure",
  bug: "output.callout.bug",
  todo: "output.callout.todo"
};

function labelForCallout(type: string, locale: Locale): string {
  const kind = type.toLowerCase();
  return Object.prototype.hasOwnProperty.call(CALLOUT_LABELS, kind)
    ? translate(locale, CALLOUT_LABELS[kind])
    : type;
}

function warning(
  map: Map<AdapterWarningCode, AdapterWarning>,
  code: AdapterWarningCode,
  message: string,
  increment = 1
): void {
  const current = map.get(code);
  if (current) current.count += increment;
  else map.set(code, { code, message, count: increment });
}

function isHardBlock(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^#{1,6}\s/.test(trimmed)) return true;
  if (/^(?:[-+*]|\d+[.)])\s+/.test(trimmed)) return true;
  if (/^>/.test(trimmed)) return true;
  if (/^(?:`{3,}|~{3,}|\$\$)/.test(trimmed)) return true;
  if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return true;
  if (/^</.test(trimmed) || /^!\[/.test(trimmed)) return true;
  if (/\|/.test(trimmed)) return true; // GFM/HTML table rows must keep their line boundaries.
  return /^ {4}/.test(line);
}

const FOOTNOTE_DEFINITION = /^\[\^([^\]\s]+)\]:/;
const FOOTNOTE_REFERENCE = /\[\^([^\]\s]+)\](?!:)/g;

function isFootnoteDefinition(line: string): boolean {
  return FOOTNOTE_DEFINITION.test(line.trim());
}

/**
 * Kordoc reads a footnote definition only from its own single line. Obsidian allows the
 * body to continue on following lines (lazy continuation, indented lines, or an indented
 * paragraph after a blank line), so fold those lines into the definition line.
 */
function mergeFootnoteDefinitions(lines: string[]): string[] {
  const out: string[] = [];
  let fenceMarker = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(FENCE)?.[1] ?? "";
    if (fence) {
      if (!fenceMarker) fenceMarker = fence[0];
      else if (fence[0] === fenceMarker) fenceMarker = "";
      out.push(line);
      continue;
    }
    if (fenceMarker || !isFootnoteDefinition(line)) {
      out.push(line);
      continue;
    }
    let merged = line.trimEnd();
    let next = index + 1;
    while (next < lines.length) {
      const candidate = lines[next];
      if (candidate.trim()) {
        const indented = /^(?: {2,}|\t)/.test(candidate);
        const lazy = !indented && !isHardBlock(candidate) && !isFootnoteDefinition(candidate);
        if (!indented && !lazy) break;
        merged = `${merged} ${candidate.trim()}`;
        next += 1;
        continue;
      }
      const following = lines[next + 1];
      if (typeof following === "string" && /^(?: {4}|\t)/.test(following) && following.trim()) {
        next += 1;
        continue;
      }
      break;
    }
    out.push(merged);
    index = next - 1;
  }
  return out;
}

/**
 * Kordoc intentionally treats every non-empty source line as a paragraph. Obsidian users
 * commonly hard-wrap prose, so join only consecutive plain-text lines and leave every
 * structural Markdown line untouched. A footnote definition always starts its own line.
 */
function joinSoftWrappedLines(lines: string[]): string[] {
  const out: string[] = [];
  let fenceMarker = "";
  for (const line of lines) {
    const fence = line.match(FENCE)?.[1] ?? "";
    if (fence) {
      if (!fenceMarker) fenceMarker = fence[0];
      else if (fence[0] === fenceMarker) fenceMarker = "";
      out.push(line);
      continue;
    }
    if (fenceMarker || !line.trim() || isHardBlock(line) || isFootnoteDefinition(line)) {
      out.push(line);
      continue;
    }

    const previous = out[out.length - 1];
    const canJoin =
      typeof previous === "string" &&
      previous.trim().length > 0 &&
      !isHardBlock(previous) &&
      !/ {2}$/.test(previous) &&
      !/\\$/.test(previous);
    if (canJoin) out[out.length - 1] = `${previous.trimEnd()} ${line.trimStart()}`;
    else out.push(line);
  }
  return out;
}

/** Splits a line into text and inline-code parts (code parts keep their backticks). */
function splitInlineCode(line: string): Array<{ code: boolean; text: string }> {
  const parts: Array<{ code: boolean; text: string }> = [];
  let last = 0;
  for (const match of line.matchAll(/(`+)[\s\S]*?\1/g)) {
    if (match.index > last) parts.push({ code: false, text: line.slice(last, match.index) });
    parts.push({ code: true, text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < line.length) parts.push({ code: false, text: line.slice(last) });
  return parts;
}

/**
 * Removes comments Obsidian does not show — `<!-- … -->` and `%% … %%`, on one line or
 * across lines — outside fenced and inline code (2.7.0, R-027). Kordoc would print them.
 */
function stripComments(lines: string[]): string[] {
  const out: string[] = [];
  let fenceMarker = "";
  let open: "" | "-->" | "%%" = "";
  for (const line of lines) {
    const fence = open ? "" : (line.match(FENCE)?.[1] ?? "");
    if (fence || (fenceMarker && !open)) {
      if (fence) {
        if (!fenceMarker) fenceMarker = fence[0];
        else if (fence[0] === fenceMarker) fenceMarker = "";
      }
      out.push(line);
      continue;
    }
    let kept = "";
    let touched = false;
    for (const part of splitInlineCode(line)) {
      if (part.code && !open) {
        kept += part.text;
        continue;
      }
      let rest = part.text;
      while (rest) {
        if (open) {
          const end = rest.indexOf(open);
          touched = true;
          if (end < 0) {
            rest = "";
            break;
          }
          rest = rest.slice(end + open.length);
          open = "";
          continue;
        }
        const html = rest.indexOf("<!--");
        const obsidian = rest.indexOf("%%");
        const start = html < 0 ? obsidian : obsidian < 0 ? html : Math.min(html, obsidian);
        if (start < 0) {
          kept += rest;
          break;
        }
        kept += rest.slice(0, start);
        open = start === html ? "-->" : "%%";
        rest = rest.slice(start + (open === "-->" ? 4 : 2));
        touched = true;
      }
    }
    // A line that held only a comment disappears instead of leaving a blank paragraph.
    if (touched && !kept.trim()) continue;
    out.push(touched ? kept.replace(/(\S) {2,}(?=\S)/g, "$1 ").trimEnd() : line);
  }
  return out;
}

/**
 * Escapes square brackets inside a link's text, as in `[[AIC 2026] 교수 인터뷰](https://…)`.
 * Obsidian allows balanced brackets there; Kordoc's link pattern does not, and would
 * print the whole link as text.
 */
function escapeLinkTextBrackets(line: string): string {
  let result = "";
  for (const part of splitInlineCode(line)) {
    if (part.code || !part.text.includes("](")) {
      result += part.text;
      continue;
    }
    const text = part.text;
    let out = "";
    let index = 0;
    while (index < text.length) {
      const open = text.indexOf("[", index);
      if (open < 0 || (open > 0 && text[open - 1] === "\\")) {
        out += text.slice(index, open < 0 ? text.length : open + 1);
        index = open < 0 ? text.length : open + 1;
        continue;
      }
      let depth = 0;
      let close = -1;
      for (let cursor = open; cursor < text.length; cursor += 1) {
        const char = text[cursor];
        if (char === "\\") {
          cursor += 1;
          continue;
        }
        if (char === "[") depth += 1;
        else if (char === "]" && --depth === 0) {
          close = cursor;
          break;
        }
      }
      const inner = close > open ? text.slice(open + 1, close) : "";
      const isLink = close > open && text[close + 1] === "(" && text.indexOf(")", close) > close;
      const isImage = open > 0 && text[open - 1] === "!";
      if (!isLink || isImage || !/[[\]]/.test(inner)) {
        out += text.slice(index, open + 1);
        index = open + 1;
        continue;
      }
      out += text.slice(index, open) + "[" + inner.replace(/(?<!\\)([[\]])/g, "\\$1") + "]";
      index = close + 1;
    }
    result += out;
  }
  return result;
}

/** Convert Obsidian-specific Markdown into the conservative subset kordoc generates well. */
export function adaptMarkdownForKordoc(
  source: string,
  options: MarkdownAdapterOptions = {}
): MarkdownAdapterResult {
  const locale = resolveOutputLocale(options.outputLanguage, source);
  const warnings = new Map<AdapterWarningCode, AdapterWarning>();
  const imageRefs = new Set<string>();
  const lines = stripComments(source.replace(/\r\n?/g, "\n").split("\n"));
  const converted: string[] = [];
  const footnoteDefinitions = new Set<string>();
  const footnoteReferences = new Set<string>();
  let fenceMarker = "";

  for (let line of lines) {
    const fence = line.match(FENCE)?.[1] ?? "";
    if (fence) {
      if (!fenceMarker) fenceMarker = fence[0];
      else if (fence[0] === fenceMarker) fenceMarker = "";
      converted.push(line);
      continue;
    }
    if (fenceMarker) {
      converted.push(line);
      continue;
    }

    // Obsidian embeds must be handled before ordinary wiki links.
    line = line.replace(/!\[\[([^\]]+)\]\]/g, (_all, inner: string) => {
      const [targetPart, aliasPart] = String(inner).split("|", 2);
      const target = targetPart.split("#", 1)[0].trim();
      const alias = (aliasPart || nodeLabel(target)).trim();
      if (IMAGE_EXT.test(target)) {
        imageRefs.add(target);
        const destination = /[\s()]/.test(target) ? `<${target}>` : target;
        return `![${alias}](${destination})`;
      }
      // Note embeds are normally inlined by note assembly first; what reaches this
      // point is a note embed with assembly turned off, or an embedded non-image file.
      const fileEmbed = /\.[a-z0-9]{1,5}$/i.test(target) && !/\.md$/i.test(target);
      warning(
        warnings,
        fileEmbed ? "file-embed-flattened" : "note-embed-flattened",
        fileEmbed ? t("adapter.warning.fileEmbedFlattened") : t("adapter.warning.noteEmbedFlattened")
      );
      return tOut(locale, "output.embedPlaceholder", { name: alias });
    });

    line = line.replace(/\[\[([^\]]+)\]\]/g, (_all, inner: string) => {
      const [targetAndHeading, aliasPart] = String(inner).split("|", 2);
      const [target, heading] = targetAndHeading.split("#", 2);
      return (aliasPart || (heading ? `${nodeLabel(target)} — ${heading}` : nodeLabel(target))).trim();
    });
    line = escapeLinkTextBrackets(line);

    const callout = line.match(/^(\s*>\s*)\[!([^\]]+)\][+-]?\s*(.*)$/i);
    if (callout) {
      const title = callout[3].trim() || labelForCallout(callout[2], locale);
      line = `${callout[1]}**${title}**`;
      warning(warnings, "callout-flattened", t("adapter.warning.calloutFlattened"));
    }

    line = line.replace(/^(\s*[-+*]\s+)\[([ xX])\]\s+/, (_all, prefix: string, checked: string) => {
      return `${prefix}${checked.trim() ? "☑" : "☐"} `;
    });

    if (/==[^=\n]+==/.test(line)) {
      line = line.replace(/==([^=\n]+)==/g, "$1");
      warning(warnings, "highlight-flattened", t("adapter.warning.highlightFlattened"));
    }
    const definition = line.trim().match(FOOTNOTE_DEFINITION);
    if (definition) footnoteDefinitions.add(definition[1]);
    for (const reference of line.replace(FOOTNOTE_DEFINITION, "").matchAll(FOOTNOTE_REFERENCE)) {
      footnoteReferences.add(reference[1]);
    }

    for (const token of markdownImageTokens(line)) {
      imageRefs.add(token.source);
    }
    for (const match of line.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
      imageRefs.add(match[1]);
    }
    converted.push(line);
  }

  const undefinedFootnotes = [...footnoteReferences].filter((id) => !footnoteDefinitions.has(id));
  if (undefinedFootnotes.length > 0) {
    warning(
      warnings,
      "footnote-undefined",
      t("adapter.warning.footnoteUndefined", {
        ids: undefinedFootnotes.map((id) => `[^${id}]`).join(", ")
      }),
      undefinedFootnotes.length
    );
  }

  return {
    markdown: joinSoftWrappedLines(mergeFootnoteDefinitions(converted)).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n",
    warnings: [...warnings.values()],
    imageCount: imageRefs.size
  };
}

function nodeLabel(target: string): string {
  const normalized = target.replace(/\\/g, "/");
  const last = normalized.split("/").pop() || normalized;
  return last.replace(/\.[^.]+$/, "");
}
