import MarkdownIt from "markdown-it";

export type EditorialAlignment = "left" | "center" | "right" | "justify";

export type EditorialInline =
  | { type: "text"; value: string }
  | { type: "hardbreak" }
  | { type: "code"; value: string }
  | { type: "image"; src: string; alt: string }
  | { type: "link"; href: string; children: EditorialInline[] }
  | { type: "wikilink"; target: string; label: string }
  | {
      type: "styled";
      style:
        | "strong"
        | "emphasis"
        | "delete"
        | "mark"
        | "underline"
        | "superscript"
        | "subscript"
        | "span";
      children: EditorialInline[];
      color?: string;
      backgroundColor?: string;
    };

export interface EditorialListItem {
  blocks: EditorialBlock[];
  checked?: boolean;
}

export type EditorialBlock =
  | {
      type: "paragraph";
      inlines: EditorialInline[];
      alignment?: EditorialAlignment;
    }
  | {
      type: "heading";
      level: 1 | 2 | 3 | 4 | 5 | 6;
      inlines: EditorialInline[];
    }
  | {
      type: "list";
      ordered: boolean;
      start?: number;
      items: EditorialListItem[];
    }
  | {
      type: "table";
      header: EditorialInline[][];
      rows: EditorialInline[][][];
    }
  | { type: "quote"; blocks: EditorialBlock[] }
  | {
      type: "callout";
      kind: string;
      collapsed?: boolean;
      blocks: EditorialBlock[];
    }
  | { type: "code"; language?: string; value: string }
  | { type: "thematic-break" };

export interface EditorialDocument {
  title: string;
  masthead: EditorialInline[];
  blocks: EditorialBlock[];
}

interface MarkdownToken {
  type: string;
  tag: string;
  attrs: [string, string][] | null;
  nesting: number;
  children: MarkdownToken[] | null;
  content: string;
  markup: string;
  info: string;
  hidden: boolean;
}

interface HtmlAttribute {
  name: string;
  value: string;
}

type HtmlEvent =
  | { type: "text"; value: string }
  | {
      type: "open";
      tag: string;
      attributes: HtmlAttribute[];
      selfClosing: boolean;
    }
  | { type: "close"; tag: string };

interface HtmlTextNode {
  type: "text";
  value: string;
}

interface HtmlElementNode {
  type: "element";
  tag: string;
  attributes: HtmlAttribute[];
  children: HtmlNode[];
}

type HtmlNode = HtmlTextNode | HtmlElementNode;

interface InlineFrame {
  kind:
    | "root"
    | "strong"
    | "emphasis"
    | "delete"
    | "mark"
    | "underline"
    | "superscript"
    | "subscript"
    | "span"
    | "link";
  source: "markdown" | "html" | "root";
  tag: string;
  children: EditorialInline[];
  href?: string;
  color?: string;
  backgroundColor?: string;
}

const MARKDOWN = new MarkdownIt({
  breaks: false,
  html: true,
  linkify: false,
  typographer: false
});
const DEFAULT_MARKDOWN_VALIDATE_LINK = MARKDOWN.validateLink.bind(MARKDOWN);

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const RASTER_BASE64_SIGNATURES: Record<string, string> = {
  png: "iVBORw0KGgo",
  jpeg: "/9j/",
  gif: "R0lGOD",
  bmp: "Qk"
};
const ALLOWED_HTML_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "details",
  "em",
  "font",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul"
]);
const INLINE_HTML_TAGS = new Set([
  "a",
  "b",
  "br",
  "code",
  "del",
  "em",
  "font",
  "i",
  "img",
  "mark",
  "s",
  "span",
  "strong",
  "sub",
  "sup",
  "u"
]);
const UNSAFE_HTML_SUBTREES = new Set([
  "applet",
  "audio",
  "button",
  "canvas",
  "embed",
  "form",
  "frame",
  "frameset",
  "iframe",
  "input",
  "math",
  "object",
  "script",
  "select",
  "style",
  "svg",
  "textarea",
  "video"
]);
// Raw HTML can be supplied by an untrusted note. Keep recursive conversion
// comfortably below the JavaScript call-stack limit and drop only the
// over-deep subtree instead of partially exposing its contents.
const MAX_HTML_RENDER_DEPTH = 128;
const VOID_HTML_TAGS = new Set(["br", "hr", "img"]);
const SAFE_NAMED_COLORS = new Set([
  "black",
  "blue",
  "gray",
  "green",
  "navy",
  "orange",
  "purple",
  "red",
  "silver",
  "teal",
  "white",
  "yellow"
]);

function tokenAttribute(token: MarkdownToken, name: string): string {
  return token.attrs?.find(([candidate]) => candidate === name)?.[1] ?? "";
}

function htmlAttribute(attributes: HtmlAttribute[], name: string): string {
  return attributes.find((attribute) => attribute.name === name)?.value ?? "";
}

function hasUnsafeControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function structurallyValidRasterBase64(mime: string, value: string): boolean {
  const signature = RASTER_BASE64_SIGNATURES[mime.toLowerCase()];
  if (!signature || value.length === 0 || value.length % 4 !== 0) return false;
  if (!value.startsWith(signature)) return false;

  let padding = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const base64 =
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x30 && code <= 0x39) ||
      code === 0x2b ||
      code === 0x2f;
    if (base64 && padding === 0) continue;
    if (code === 0x3d && index >= value.length - 2) {
      padding += 1;
      if (padding <= 2) continue;
    }
    return false;
  }
  return true;
}

export function safeEditorialImageUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || hasUnsafeControlCharacter(trimmed)) return "";
  const lower = trimmed.slice(0, 40).toLowerCase();
  for (const mime of Object.keys(RASTER_BASE64_SIGNATURES)) {
    const prefix = `data:image/${mime};base64,`;
    if (!lower.startsWith(prefix)) continue;
    const encoded = trimmed.slice(prefix.length);
    return structurallyValidRasterBase64(mime, encoded) ? trimmed : "";
  }
  return "";
}

// markdown-it deliberately rejects BMP data URLs in its default link
// validator. HanMark imports BMP images from HWPX, so allow only the same
// signature-checked raster data URLs that the Editorial renderer can emit.
MARKDOWN.validateLink = (value: string): boolean =>
  DEFAULT_MARKDOWN_VALIDATE_LINK(value) ||
  safeEditorialImageUrl(value) !== "";

export function safeEditorialLinkUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || hasUnsafeControlCharacter(trimmed)) return "#";
  try {
    const parsed = new URL(trimmed);
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol.toLowerCase())
      ? trimmed
      : "#";
  } catch {
    return "#";
  }
}

function safeColor(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (
    /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(trimmed) ||
    SAFE_NAMED_COLORS.has(trimmed)
  ) {
    return trimmed;
  }
  return undefined;
}

function styleValue(style: string, property: string): string | undefined {
  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const name = declaration.slice(0, separator).trim().toLowerCase();
    if (name !== property) continue;
    return declaration.slice(separator + 1).trim();
  }
  return undefined;
}

function safeAlignment(attributes: HtmlAttribute[]): EditorialAlignment | undefined {
  const style = htmlAttribute(attributes, "style");
  const candidate = (
    htmlAttribute(attributes, "align") ||
    styleValue(style, "text-align") ||
    ""
  ).trim().toLowerCase();
  if (
    candidate === "left" ||
    candidate === "center" ||
    candidate === "right" ||
    candidate === "justify"
  ) {
    return candidate;
  }
  return undefined;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z][a-z0-9]{1,31}));/gi,
    (entity, decimal: string | undefined, hex: string | undefined, named: string | undefined) => {
      if (decimal || hex) {
        const codePoint = Number.parseInt(decimal ?? hex ?? "", decimal ? 10 : 16);
        if (
          Number.isFinite(codePoint) &&
          codePoint > 0 &&
          codePoint <= 0x10ffff &&
          !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return String.fromCodePoint(codePoint);
        }
        return "\uFFFD";
      }
      const replacements: Record<string, string> = {
        amp: "&",
        apos: "'",
        gt: ">",
        lt: "<",
        nbsp: "\u00A0",
        quot: "\""
      };
      return replacements[(named ?? "").toLowerCase()] ??
        MARKDOWN.utils.unescapeAll(entity);
    }
  );
}

function findHtmlTagEnd(value: string, start: number): number {
  let quote = "";
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function parseHtmlAttributes(value: string): HtmlAttribute[] {
  const attributes: HtmlAttribute[] = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && /\s/.test(value[index])) index += 1;
    if (index >= value.length || value[index] === "/") break;

    const nameStart = index;
    while (
      index < value.length &&
      !/[\s=/>]/.test(value[index])
    ) {
      index += 1;
    }
    const name = value.slice(nameStart, index).toLowerCase();
    if (!name) {
      index += 1;
      continue;
    }

    while (index < value.length && /\s/.test(value[index])) index += 1;
    let attributeValue = "";
    if (value[index] === "=") {
      index += 1;
      while (index < value.length && /\s/.test(value[index])) index += 1;
      const quote = value[index] === "\"" || value[index] === "'"
        ? value[index]
        : "";
      if (quote) {
        index += 1;
        const valueStart = index;
        while (index < value.length && value[index] !== quote) index += 1;
        attributeValue = value.slice(valueStart, index);
        if (index < value.length) index += 1;
      } else {
        const valueStart = index;
        while (index < value.length && !/[\s>]/.test(value[index])) index += 1;
        attributeValue = value.slice(valueStart, index);
      }
    }
    attributes.push({ name, value: decodeHtmlEntities(attributeValue) });
  }
  return attributes;
}

function tokenizeHtml(value: string): HtmlEvent[] {
  const events: HtmlEvent[] = [];
  let index = 0;
  let textStart = 0;
  const pushText = (end: number): void => {
    if (end > textStart) {
      events.push({
        type: "text",
        value: decodeHtmlEntities(value.slice(textStart, end))
      });
    }
  };

  while (index < value.length) {
    if (value[index] !== "<") {
      index += 1;
      continue;
    }
    pushText(index);

    if (value.startsWith("<!--", index)) {
      const end = value.indexOf("-->", index + 4);
      index = end < 0 ? value.length : end + 3;
      textStart = index;
      continue;
    }
    if (value.startsWith("<!", index) || value.startsWith("<?", index)) {
      const end = findHtmlTagEnd(value, index + 2);
      index = end < 0 ? value.length : end + 1;
      textStart = index;
      continue;
    }

    const end = findHtmlTagEnd(value, index + 1);
    if (end < 0) {
      index += 1;
      continue;
    }
    const raw = value.slice(index + 1, end).trim();
    const closing = raw.startsWith("/");
    const withoutSlash = closing ? raw.slice(1).trimStart() : raw;
    const nameMatch = /^([A-Za-z][A-Za-z0-9:-]*)/.exec(withoutSlash);
    if (!nameMatch) {
      index += 1;
      continue;
    }
    const tag = nameMatch[1].toLowerCase();
    if (closing) {
      events.push({ type: "close", tag });
    } else {
      events.push({
        type: "open",
        tag,
        attributes: parseHtmlAttributes(
          withoutSlash.slice(nameMatch[0].length)
        ),
        selfClosing: /\/\s*$/.test(raw) || VOID_HTML_TAGS.has(tag)
      });
    }
    index = end + 1;
    textStart = index;
  }
  pushText(value.length);
  return events;
}

function htmlTree(value: string): HtmlNode[] {
  const root: HtmlElementNode = {
    type: "element",
    tag: "root",
    attributes: [],
    children: []
  };
  const stack: HtmlElementNode[] = [root];
  const unsafeStack: string[] = [];

  for (const event of tokenizeHtml(value)) {
    if (event.type === "text") {
      if (!unsafeStack.length && event.value) {
        stack[stack.length - 1].children.push(event);
      }
      continue;
    }
    if (event.type === "open") {
      if (unsafeStack.length) {
        if (!event.selfClosing) unsafeStack.push(event.tag);
        continue;
      }
      if (UNSAFE_HTML_SUBTREES.has(event.tag)) {
        if (!event.selfClosing) unsafeStack.push(event.tag);
        continue;
      }
      const node: HtmlElementNode = {
        type: "element",
        tag: ALLOWED_HTML_TAGS.has(event.tag) ? event.tag : "",
        attributes: event.attributes,
        children: []
      };
      stack[stack.length - 1].children.push(node);
      if (!event.selfClosing) stack.push(node);
      continue;
    }

    if (unsafeStack.length) {
      if (unsafeStack[unsafeStack.length - 1] === event.tag) {
        unsafeStack.pop();
      }
      continue;
    }
    for (let cursor = stack.length - 1; cursor > 0; cursor -= 1) {
      const node = stack[cursor];
      if (node.tag === event.tag || node.tag === "") {
        stack.length = cursor;
        break;
      }
    }
  }
  return root.children;
}

function appendText(inlines: EditorialInline[], value: string): void {
  if (!value) return;
  const previous = inlines[inlines.length - 1];
  if (previous?.type === "text") {
    previous.value += value;
  } else {
    inlines.push({ type: "text", value });
  }
}

function appendSoftSpace(inlines: EditorialInline[]): void {
  const previous = inlines[inlines.length - 1];
  if (previous?.type === "text") {
    if (!/\s$/.test(previous.value)) previous.value += " ";
  } else if (inlines.length > 0 && previous?.type !== "hardbreak") {
    inlines.push({ type: "text", value: " " });
  }
}

function fallbackMarkdownLink(
  value: string,
  from: number
): { start: number; end: number; label: string; source: string } | null {
  let start = value.indexOf("[", from);
  while (start >= 0) {
    if (value[start - 1] !== "!" && value[start + 1] !== "[") {
      const labelEnd = value.indexOf("](", start + 1);
      if (labelEnd > start + 1) {
        let depth = 1;
        let cursor = labelEnd + 2;
        for (; cursor < value.length; cursor += 1) {
          if (value[cursor] === "\\") {
            cursor += 1;
            continue;
          }
          if (value[cursor] === "(") depth += 1;
          else if (value[cursor] === ")") {
            depth -= 1;
            if (depth === 0) {
              return {
                start,
                end: cursor + 1,
                label: value.slice(start + 1, labelEnd),
                source: value.slice(labelEnd + 2, cursor)
              };
            }
          }
        }
      }
    }
    start = value.indexOf("[", start + 1);
  }
  return null;
}

function textExtensions(value: string): EditorialInline[] {
  const output: EditorialInline[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const wiki = value.indexOf("[[", cursor);
    const mark = value.indexOf("==", cursor);
    const markdownLink = fallbackMarkdownLink(value, cursor);
    let start = -1;
    let kind: "wiki" | "mark" | "link" | null = null;
    if (
      markdownLink &&
      (wiki < 0 || markdownLink.start < wiki) &&
      (mark < 0 || markdownLink.start < mark)
    ) {
      start = markdownLink.start;
      kind = "link";
    } else if (wiki >= 0 && (mark < 0 || wiki <= mark)) {
      start = wiki;
      kind = "wiki";
    } else if (mark >= 0) {
      start = mark;
      kind = "mark";
    }
    if (start < 0 || !kind) {
      appendText(output, value.slice(cursor));
      break;
    }
    appendText(output, value.slice(cursor, start));
    if (kind === "link" && markdownLink) {
      output.push({
        type: "link",
        href: safeEditorialLinkUrl(markdownLink.source),
        children: textExtensions(markdownLink.label)
      });
      cursor = markdownLink.end;
      continue;
    }
    const end = value.indexOf(kind === "wiki" ? "]]" : "==", start + 2);
    if (end < 0) {
      appendText(output, value.slice(start));
      break;
    }
    const inner = value.slice(start + 2, end);
    if (kind === "wiki") {
      const separator = inner.indexOf("|");
      const target = (separator >= 0 ? inner.slice(0, separator) : inner).trim();
      const label = (separator >= 0 ? inner.slice(separator + 1) : inner).trim();
      if (target && label) {
        output.push({ type: "wikilink", target, label });
      } else {
        appendText(output, value.slice(start, end + 2));
      }
    } else if (inner) {
      output.push({
        type: "styled",
        style: "mark",
        children: [{ type: "text", value: inner }]
      });
    } else {
      appendText(output, "====");
    }
    cursor = end + 2;
  }
  return output;
}

function appendExtendedText(inlines: EditorialInline[], value: string): void {
  for (const inline of textExtensions(value)) {
    if (inline.type === "text") appendText(inlines, inline.value);
    else inlines.push(inline);
  }
}

function closeInlineFrame(
  frames: InlineFrame[],
  expectedTag: string,
  source: "markdown" | "html"
): void {
  let match = -1;
  for (let index = frames.length - 1; index > 0; index -= 1) {
    if (frames[index].source === source && frames[index].tag === expectedTag) {
      match = index;
      break;
    }
  }
  if (match < 0) return;
  while (frames.length - 1 >= match) {
    const frame = frames.pop();
    if (!frame) return;
    let node: EditorialInline;
    if (frame.kind === "link") {
      node = {
        type: "link",
        href: safeEditorialLinkUrl(frame.href ?? ""),
        children: frame.children
      };
    } else {
      node = {
        type: "styled",
        style: frame.kind === "root" ? "span" : frame.kind,
        children: frame.children,
        ...(frame.color ? { color: frame.color } : {}),
        ...(frame.backgroundColor
          ? { backgroundColor: frame.backgroundColor }
          : {})
      };
    }
    frames[frames.length - 1].children.push(node);
  }
}

function openHtmlInlineFrame(
  frames: InlineFrame[],
  event: Extract<HtmlEvent, { type: "open" }>
): boolean {
  const tagToKind: Record<string, InlineFrame["kind"] | undefined> = {
    a: "link",
    b: "strong",
    del: "delete",
    em: "emphasis",
    font: "span",
    i: "emphasis",
    mark: "mark",
    s: "delete",
    span: "span",
    strong: "strong",
    sub: "subscript",
    sup: "superscript",
    u: "underline"
  };
  const kind = tagToKind[event.tag];
  if (!kind) return false;
  const style = htmlAttribute(event.attributes, "style");
  const color = safeColor(
    htmlAttribute(event.attributes, "color") ||
      styleValue(style, "color") ||
      ""
  );
  const backgroundColor = safeColor(
    styleValue(style, "background-color") ||
      styleValue(style, "background") ||
      ""
  );
  frames.push({
    kind,
    source: "html",
    tag: event.tag,
    children: [],
    href: event.tag === "a" ? htmlAttribute(event.attributes, "href") : undefined,
    color,
    backgroundColor
  });
  if (event.selfClosing) closeInlineFrame(frames, event.tag, "html");
  return true;
}

function parseInlineTokens(tokens: MarkdownToken[]): EditorialInline[] {
  const frames: InlineFrame[] = [{
    kind: "root",
    source: "root",
    tag: "root",
    children: []
  }];
  const unsafeStack: string[] = [];
  const current = (): EditorialInline[] => frames[frames.length - 1].children;

  for (const token of tokens) {
    if (token.type === "html_inline") {
      for (const event of tokenizeHtml(token.content)) {
        if (event.type === "text") {
          if (!unsafeStack.length) appendExtendedText(current(), event.value);
          continue;
        }
        if (event.type === "open") {
          if (unsafeStack.length) {
            if (!event.selfClosing) unsafeStack.push(event.tag);
            continue;
          }
          if (UNSAFE_HTML_SUBTREES.has(event.tag)) {
            if (!event.selfClosing) unsafeStack.push(event.tag);
            continue;
          }
          if (event.tag === "br") {
            current().push({ type: "hardbreak" });
          } else if (event.tag === "img") {
            const src = safeEditorialImageUrl(
              htmlAttribute(event.attributes, "src")
            );
            const alt = htmlAttribute(event.attributes, "alt");
            if (src) current().push({ type: "image", src, alt });
            else appendExtendedText(current(), alt);
          } else {
            openHtmlInlineFrame(frames, event);
          }
          continue;
        }
        if (unsafeStack.length) {
          if (unsafeStack[unsafeStack.length - 1] === event.tag) {
            unsafeStack.pop();
          }
        } else {
          closeInlineFrame(frames, event.tag, "html");
        }
      }
      continue;
    }
    if (unsafeStack.length) continue;

    switch (token.type) {
      case "text":
        appendExtendedText(current(), token.content);
        break;
      case "softbreak":
        appendSoftSpace(current());
        break;
      case "hardbreak":
        current().push({ type: "hardbreak" });
        break;
      case "code_inline":
        current().push({ type: "code", value: token.content });
        break;
      case "image": {
        const src = safeEditorialImageUrl(tokenAttribute(token, "src"));
        const alt = token.content;
        if (src) current().push({ type: "image", src, alt });
        else appendExtendedText(current(), alt);
        break;
      }
      case "link_open":
        frames.push({
          kind: "link",
          source: "markdown",
          tag: "link",
          children: [],
          href: tokenAttribute(token, "href")
        });
        break;
      case "link_close":
        closeInlineFrame(frames, "link", "markdown");
        break;
      case "strong_open":
      case "em_open":
      case "s_open": {
        const kind = token.type === "strong_open"
          ? "strong"
          : token.type === "em_open"
            ? "emphasis"
            : "delete";
        frames.push({
          kind,
          source: "markdown",
          tag: token.type.slice(0, -5),
          children: []
        });
        break;
      }
      case "strong_close":
      case "em_close":
      case "s_close":
        closeInlineFrame(
          frames,
          token.type.slice(0, -6),
          "markdown"
        );
        break;
      default:
        if (token.content) appendExtendedText(current(), token.content);
        break;
    }
  }

  while (frames.length > 1) {
    const frame = frames.pop();
    if (!frame) break;
    if (frame.children.length) {
      frames[frames.length - 1].children.push({
        type: "styled",
        style:
          frame.kind === "link" || frame.kind === "root"
            ? "span"
            : frame.kind,
        children: frame.children
      });
    }
  }
  return frames[0].children;
}

function htmlNodesToInlines(
  nodes: HtmlNode[],
  depth = 0
): EditorialInline[] {
  if (depth >= MAX_HTML_RENDER_DEPTH) return [];
  const output: EditorialInline[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      appendExtendedText(output, node.value.replace(/\s+/g, " "));
      continue;
    }
    if (node.tag === "br") {
      output.push({ type: "hardbreak" });
      continue;
    }
    if (node.tag === "img") {
      const src = safeEditorialImageUrl(htmlAttribute(node.attributes, "src"));
      const alt = htmlAttribute(node.attributes, "alt");
      if (src) output.push({ type: "image", src, alt });
      else appendExtendedText(output, alt);
      continue;
    }
    const children = htmlNodesToInlines(node.children, depth + 1);
    const styleByTag: Record<string, Extract<EditorialInline, { type: "styled" }>["style"] | undefined> = {
      b: "strong",
      code: "span",
      del: "delete",
      em: "emphasis",
      font: "span",
      i: "emphasis",
      mark: "mark",
      s: "delete",
      span: "span",
      strong: "strong",
      sub: "subscript",
      sup: "superscript",
      u: "underline"
    };
    if (node.tag === "a") {
      output.push({
        type: "link",
        href: safeEditorialLinkUrl(htmlAttribute(node.attributes, "href")),
        children
      });
      continue;
    }
    const style = styleByTag[node.tag];
    if (style) {
      const rawStyle = htmlAttribute(node.attributes, "style");
      const color = safeColor(
        htmlAttribute(node.attributes, "color") ||
          styleValue(rawStyle, "color") ||
          ""
      );
      const backgroundColor = safeColor(
        styleValue(rawStyle, "background-color") ||
          styleValue(rawStyle, "background") ||
          ""
      );
      output.push({
        type: node.tag === "code" ? "code" : "styled",
        ...(node.tag === "code"
          ? { value: editorialPlainText(children) }
          : {
              style,
              children,
              ...(color ? { color } : {}),
              ...(backgroundColor ? { backgroundColor } : {})
            })
      } as EditorialInline);
      continue;
    }
    for (const child of children) {
      if (child.type === "text") appendText(output, child.value);
      else output.push(child);
    }
  }
  return output;
}

function directElementChildren(
  node: HtmlElementNode,
  tag: string
): HtmlElementNode[] {
  return node.children.filter(
    (child): child is HtmlElementNode =>
      child.type === "element" && child.tag === tag
  );
}

function htmlTable(
  node: HtmlElementNode,
  depth: number
): EditorialBlock {
  const rows: EditorialInline[][][] = [];
  let header: EditorialInline[][] = [];
  const rowNodes: HtmlElementNode[] = [];
  const pending: Array<{ node: HtmlElementNode; depth: number }> = [
    { node, depth }
  ];
  while (pending.length) {
    const current = pending.pop();
    if (!current || current.depth >= MAX_HTML_RENDER_DEPTH) continue;
    const candidate = current.node;
    for (const child of candidate.children) {
      if (child.type !== "element") continue;
      if (child.tag === "tr") rowNodes.push(child);
      else if (
        child.tag === "thead" ||
        child.tag === "tbody" ||
        child.tag === "tfoot" ||
        child.tag === ""
      ) {
        pending.push({ node: child, depth: current.depth + 1 });
      }
    }
  }
  for (const row of rowNodes) {
    const cells = row.children
      .filter(
        (child): child is HtmlElementNode =>
          child.type === "element" &&
          (child.tag === "th" || child.tag === "td")
      )
      .map((cell) => htmlNodesToInlines(cell.children, depth + 1));
    if (!header.length && directElementChildren(row, "th").length > 0) {
      header = cells;
    } else if (cells.length) {
      rows.push(cells);
    }
  }
  return { type: "table", header, rows };
}

function htmlList(
  node: HtmlElementNode,
  depth: number
): EditorialBlock {
  const ordered = node.tag === "ol";
  const parsedStart = Number.parseInt(htmlAttribute(node.attributes, "start"), 10);
  const items = directElementChildren(node, "li").map((item) => ({
    blocks: htmlNodesToBlocks(item.children, depth + 1)
  }));
  return {
    type: "list",
    ordered,
    ...(ordered && Number.isFinite(parsedStart) ? { start: parsedStart } : {}),
    items
  };
}

function containsHtmlBlockContent(node: HtmlElementNode): boolean {
  const pending = [...node.children];
  while (pending.length) {
    const child = pending.pop();
    if (!child || child.type === "text") continue;
    if (child.tag && !INLINE_HTML_TAGS.has(child.tag)) return true;
    for (let index = child.children.length - 1; index >= 0; index -= 1) {
      pending.push(child.children[index]);
    }
  }
  return false;
}

function htmlNodesToBlocks(
  nodes: HtmlNode[],
  depth = 0
): EditorialBlock[] {
  if (depth >= MAX_HTML_RENDER_DEPTH) return [];
  const blocks: EditorialBlock[] = [];
  let inlineBuffer: HtmlNode[] = [];
  const flushInlineBuffer = (): void => {
    const inlines = htmlNodesToInlines(inlineBuffer, depth);
    inlineBuffer = [];
    if (editorialPlainText(inlines).trim() || inlines.some((item) => item.type === "image")) {
      blocks.push({ type: "paragraph", inlines });
    }
  };

  for (const node of nodes) {
    if (node.type === "text") {
      inlineBuffer.push(node);
      continue;
    }
    if (
      INLINE_HTML_TAGS.has(node.tag) ||
      (!node.tag && !containsHtmlBlockContent(node))
    ) {
      inlineBuffer.push(node);
      continue;
    }
    flushInlineBuffer();
    if (/^h[1-6]$/.test(node.tag)) {
      blocks.push({
        type: "heading",
        level: Number(node.tag.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6,
        inlines: htmlNodesToInlines(node.children, depth + 1)
      });
    } else if (node.tag === "p") {
      blocks.push({
        type: "paragraph",
        inlines: htmlNodesToInlines(node.children, depth + 1),
        ...(safeAlignment(node.attributes)
          ? { alignment: safeAlignment(node.attributes) }
          : {})
      });
    } else if (node.tag === "hr") {
      blocks.push({ type: "thematic-break" });
    } else if (node.tag === "blockquote") {
      blocks.push({
        type: "quote",
        blocks: htmlNodesToBlocks(node.children, depth + 1)
      });
    } else if (node.tag === "ul" || node.tag === "ol") {
      blocks.push(htmlList(node, depth));
    } else if (node.tag === "table") {
      blocks.push(htmlTable(node, depth));
    } else if (node.tag === "pre") {
      blocks.push({
        type: "code",
        value: editorialPlainText(
          htmlNodesToInlines(node.children, depth + 1)
        )
      });
    } else if (node.tag === "details") {
      blocks.push({
        type: "quote",
        blocks: htmlNodesToBlocks(node.children, depth + 1)
      });
    } else if (node.tag === "summary") {
      blocks.push({
        type: "paragraph",
        inlines: [{
          type: "styled",
          style: "strong",
          children: htmlNodesToInlines(node.children, depth + 1)
        }]
      });
    } else {
      blocks.push(...htmlNodesToBlocks(node.children, depth + 1));
    }
  }
  flushInlineBuffer();
  return blocks;
}

function stripCalloutMarker(
  blocks: EditorialBlock[]
): { kind: string; collapsed?: boolean } | null {
  const paragraph = blocks[0];
  if (paragraph?.type !== "paragraph") return null;
  const first = paragraph.inlines[0];
  if (first?.type !== "text") return null;
  const match = /^\[!([A-Za-z0-9_-]+)\]([+-])?\s*/.exec(first.value);
  if (!match) return null;
  first.value = first.value.slice(match[0].length);
  if (!first.value) paragraph.inlines.shift();
  if (paragraph.inlines.length === 0) blocks.shift();
  return {
    kind: match[1].toLowerCase(),
    ...(match[2] ? { collapsed: match[2] === "-" } : {})
  };
}

function stripTaskMarker(item: EditorialListItem): void {
  const paragraph = item.blocks[0];
  if (paragraph?.type !== "paragraph") return;
  const first = paragraph.inlines[0];
  if (first?.type !== "text") return;
  const match = /^\[([ xX])\]\s+/.exec(first.value);
  if (!match) return;
  item.checked = match[1].toLowerCase() === "x";
  first.value = first.value.slice(match[0].length);
  if (!first.value) paragraph.inlines.shift();
}

function parseMarkdownBlocks(
  tokens: MarkdownToken[],
  cursor: { index: number },
  stopType?: string
): EditorialBlock[] {
  const blocks: EditorialBlock[] = [];
  while (cursor.index < tokens.length) {
    const token = tokens[cursor.index];
    if (token.type === stopType) break;

    if (token.type === "heading_open") {
      const level = Number(token.tag.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6;
      const inline = tokens[cursor.index + 1];
      blocks.push({
        type: "heading",
        level,
        inlines: parseInlineTokens(inline?.children ?? [])
      });
      cursor.index += 3;
      continue;
    }
    if (token.type === "paragraph_open") {
      const inline = tokens[cursor.index + 1];
      blocks.push({
        type: "paragraph",
        inlines: parseInlineTokens(inline?.children ?? [])
      });
      cursor.index += 3;
      continue;
    }
    if (token.type === "fence" || token.type === "code_block") {
      blocks.push({
        type: "code",
        ...(token.info.trim()
          ? { language: token.info.trim().split(/\s+/, 1)[0] }
          : {}),
        value: token.content.replace(/\n$/, "")
      });
      cursor.index += 1;
      continue;
    }
    if (token.type === "hr") {
      blocks.push({ type: "thematic-break" });
      cursor.index += 1;
      continue;
    }
    if (token.type === "html_block") {
      blocks.push(...htmlNodesToBlocks(htmlTree(token.content)));
      cursor.index += 1;
      continue;
    }
    if (
      token.type === "bullet_list_open" ||
      token.type === "ordered_list_open"
    ) {
      const closeType = token.type.replace("_open", "_close");
      const ordered = token.type === "ordered_list_open";
      const parsedStart = Number.parseInt(tokenAttribute(token, "start"), 10);
      const items: EditorialListItem[] = [];
      cursor.index += 1;
      while (
        cursor.index < tokens.length &&
        tokens[cursor.index].type !== closeType
      ) {
        if (tokens[cursor.index].type !== "list_item_open") {
          cursor.index += 1;
          continue;
        }
        cursor.index += 1;
        const item: EditorialListItem = {
          blocks: parseMarkdownBlocks(tokens, cursor, "list_item_close")
        };
        stripTaskMarker(item);
        items.push(item);
        if (tokens[cursor.index]?.type === "list_item_close") cursor.index += 1;
      }
      if (tokens[cursor.index]?.type === closeType) cursor.index += 1;
      blocks.push({
        type: "list",
        ordered,
        ...(ordered && Number.isFinite(parsedStart)
          ? { start: parsedStart }
          : {}),
        items
      });
      continue;
    }
    if (token.type === "blockquote_open") {
      cursor.index += 1;
      const quoteBlocks = parseMarkdownBlocks(
        tokens,
        cursor,
        "blockquote_close"
      );
      if (tokens[cursor.index]?.type === "blockquote_close") cursor.index += 1;
      const callout = stripCalloutMarker(quoteBlocks);
      blocks.push(
        callout
          ? {
              type: "callout",
              kind: callout.kind,
              ...(callout.collapsed !== undefined
                ? { collapsed: callout.collapsed }
                : {}),
              blocks: quoteBlocks
            }
          : { type: "quote", blocks: quoteBlocks }
      );
      continue;
    }
    if (token.type === "table_open") {
      const header: EditorialInline[][] = [];
      const rows: EditorialInline[][][] = [];
      let currentRow: EditorialInline[][] | null = null;
      let inHeader = false;
      cursor.index += 1;
      while (
        cursor.index < tokens.length &&
        tokens[cursor.index].type !== "table_close"
      ) {
        const tableToken = tokens[cursor.index];
        if (tableToken.type === "thead_open") inHeader = true;
        else if (tableToken.type === "thead_close") inHeader = false;
        else if (tableToken.type === "tr_open") currentRow = [];
        else if (tableToken.type === "tr_close" && currentRow) {
          if (inHeader) header.push(...currentRow);
          else rows.push(currentRow);
          currentRow = null;
        } else if (
          (tableToken.type === "th_open" ||
            tableToken.type === "td_open") &&
          currentRow
        ) {
          const inline = tokens[cursor.index + 1];
          currentRow.push(parseInlineTokens(inline?.children ?? []));
        }
        cursor.index += 1;
      }
      if (tokens[cursor.index]?.type === "table_close") cursor.index += 1;
      blocks.push({ type: "table", header, rows });
      continue;
    }
    if (token.type === "inline") {
      blocks.push({
        type: "paragraph",
        inlines: parseInlineTokens(token.children ?? [])
      });
    }
    cursor.index += 1;
  }
  return blocks;
}

export function editorialPlainText(inlines: EditorialInline[]): string {
  let output = "";
  const pending = [...inlines].reverse();
  while (pending.length) {
    const inline = pending.pop();
    if (!inline) break;
    if (inline.type === "text" || inline.type === "code") {
      output += inline.value;
    } else if (inline.type === "hardbreak") {
      output += " ";
    } else if (inline.type === "image") {
      output += inline.alt;
    } else if (inline.type === "wikilink") {
      output += inline.label;
    } else {
      for (let index = inline.children.length - 1; index >= 0; index -= 1) {
        pending.push(inline.children[index]);
      }
    }
  }
  return output;
}

export function parseEditorialDocument(
  markdown: string,
  fallbackTitle: string
): EditorialDocument {
  const source = `${markdown}`;
  const tokens = MARKDOWN.parse(source, {}) as MarkdownToken[];
  const blocks = parseMarkdownBlocks(tokens, { index: 0 });
  const leadingHeading = blocks[0]?.type === "heading" &&
    blocks[0].level === 1
    ? blocks.shift()
    : undefined;
  const masthead = leadingHeading?.type === "heading"
    ? leadingHeading.inlines
    : [{ type: "text", value: fallbackTitle } satisfies EditorialInline];
  const title = leadingHeading?.type === "heading"
    ? editorialPlainText(leadingHeading.inlines).trim() || fallbackTitle
    : fallbackTitle;
  return { title, masthead, blocks };
}
