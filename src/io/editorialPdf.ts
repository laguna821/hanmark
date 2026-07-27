import type {
  EditorialBlock,
  EditorialDocument,
  EditorialInline
} from "./editorialDocument";
import { parseEditorialDocument } from "./editorialDocument";
import type { HanmarkExportOutcome } from "./exportTypes";

export const EDITORIAL_PDF_MIN_CHROMIUM = 131;
export const EDITORIAL_PDF_BODY_CLASS = "hanmark-editorial-pdf-active";
export const EDITORIAL_PDF_ROOT_CLASS = "hanmark-editorial-pdf-root";
const EDITORIAL_PDF_STYLE_CLASS = "hanmark-editorial-pdf-style";
const DEFAULT_WATCHDOG_MS = 5 * 60 * 1000;
const DEFAULT_ASSET_TIMEOUT_MS = 20 * 1000;
const MAX_EDITORIAL_PDF_RENDER_DEPTH = 128;
const SAFE_IMAGE_DATA_URI = /^data:image\/(?:png|jpeg|gif|bmp);base64,[a-z0-9+/=\s]+$/i;
const SAFE_LINK = /^(?:https?:|mailto:)/i;
const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/i;
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

interface FontFaceSetLike {
  ready: Promise<unknown>;
  load?: (font: string, text?: string) => Promise<unknown>;
}

interface SegmentPart {
  segment: string;
}

interface SegmenterLike {
  segment(value: string): Iterable<SegmentPart>;
}

interface SegmenterConstructor {
  new (
    locale?: string | string[],
    options?: { granularity: "grapheme" }
  ): SegmenterLike;
}

export interface EditorialPdfRequest {
  markdown: string;
  fileName: string;
  window?: Window;
  document?: Document;
  chromiumMajor?: number;
  watchdogMs?: number;
  assetTimeoutMs?: number;
}

export interface EditorialPdfRuntimeSupport {
  supported: boolean;
  chromiumMajor: number | null;
  minimum: number;
}

function createHtmlElement<K extends keyof HTMLElementTagNameMap>(
  ownerDocument: Document,
  tag: K
): HTMLElementTagNameMap[K] {
  return ownerDocument.createElementNS(
    HTML_NAMESPACE,
    tag
  ) as HTMLElementTagNameMap[K];
}

function normalizedFileTitle(fileName: string): string {
  const normalized = fileName.replace(/\\/g, "/");
  const leaf = normalized.slice(normalized.lastIndexOf("/") + 1);
  const withoutExtension = leaf.replace(/\.md$/i, "");
  return withoutExtension.trim() || "Untitled";
}

function graphemes(value: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
  if (!Segmenter) return Array.from(value);
  return Array.from(new Segmenter("ko", { granularity: "grapheme" }).segment(value), (part) => part.segment);
}

export function truncateEditorialPdfHeader(value: string, maxGraphemes = 72): string {
  if (!Number.isInteger(maxGraphemes) || maxGraphemes < 1) {
    throw new Error("PDF header length must be a positive integer.");
  }
  const parts = graphemes(value);
  if (parts.length <= maxGraphemes) return value;
  return `${parts.slice(0, maxGraphemes).join("")}…`;
}

/**
 * Escapes arbitrary user text for use inside a quoted CSS string. The caller
 * must still include the returned value between quotes.
 */
export function escapeEditorialPdfCssString(value: string): string {
  let escaped = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === "\\" || character === "\"") {
      escaped += `\\${character}`;
    } else if (
      codePoint === 0 ||
      codePoint <= 0x1f ||
      codePoint === 0x7f ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    ) {
      escaped += `\\${codePoint === 0 ? "fffd" : codePoint.toString(16)} `;
    } else {
      escaped += character;
    }
  }
  return escaped;
}

export function detectChromiumMajor(userAgent: string): number | null {
  const match = /\b(?:Chrome|Chromium)\/(\d+)(?:\.|$)/i.exec(userAgent);
  if (!match) return null;
  const major = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(major) ? major : null;
}

export function getEditorialPdfRuntimeSupport(
  userAgent: string,
  overrideMajor?: number
): EditorialPdfRuntimeSupport {
  const chromiumMajor = overrideMajor ?? detectChromiumMajor(userAgent);
  return {
    supported: chromiumMajor !== null && chromiumMajor >= EDITORIAL_PDF_MIN_CHROMIUM,
    chromiumMajor,
    minimum: EDITORIAL_PDF_MIN_CHROMIUM
  };
}

export function createEditorialPdfStyles(headerTitle: string): string {
  const header = escapeEditorialPdfCssString(
    truncateEditorialPdfHeader(headerTitle)
  );
  return `
@page {
  size: A4 portrait;
  margin: 22mm 20mm 20mm;

  @top-center {
    content: "${header}";
    box-sizing: border-box;
    width: 100%;
    padding-bottom: 2.5mm;
    border-bottom: 0.45pt solid #24364b;
    color: #24364b;
    font-family: "HanMark Pretendard", "Pretendard", sans-serif;
    font-size: 8.5pt;
    font-weight: 600;
    text-align: right;
  }

  @bottom-center {
    content: counter(page);
    box-sizing: border-box;
    width: 100%;
    padding-top: 2.5mm;
    border-top: 0.45pt solid #24364b;
    color: #526276;
    font-family: "HanMark Pretendard", "Pretendard", sans-serif;
    font-size: 8pt;
    text-align: right;
  }
}

@page :first {
  @top-center {
    content: none;
    border-bottom: none;
  }

  @bottom-center {
    content: none;
    border-top: none;
  }
}

.${EDITORIAL_PDF_ROOT_CLASS} {
  display: none;
}

@media print {
  html body.${EDITORIAL_PDF_BODY_CLASS} {
    background: #ffffff;
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > :not(.${EDITORIAL_PDF_ROOT_CLASS}):not(.${EDITORIAL_PDF_STYLE_CLASS}) {
    display: none;
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} {
    display: block;
  }

  .${EDITORIAL_PDF_ROOT_CLASS},
  .${EDITORIAL_PDF_ROOT_CLASS} * {
    box-sizing: border-box;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} {
    color: #172130;
    background: #ffffff;
    font-family: "HanMark Pretendard", "Pretendard", "Apple SD Gothic Neo", sans-serif;
    font-size: 10pt;
    line-height: 1.55;
    overflow-wrap: anywhere;
    word-break: keep-all;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover {
    min-height: 255mm;
    display: flex;
    align-items: center;
    justify-content: center;
    break-after: page;
    page-break-after: always;
    color: #ffffff;
    background: #12263a;
    margin: -22mm -20mm -20mm;
    padding: 30mm;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-title {
    max-width: 150mm;
    margin: 0;
    color: inherit;
    font-size: 28pt;
    font-weight: 700;
    line-height: 1.22;
    letter-spacing: -0.025em;
    text-align: center;
    text-wrap: balance;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body {
    display: block;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} h1,
  .${EDITORIAL_PDF_ROOT_CLASS} h2,
  .${EDITORIAL_PDF_ROOT_CLASS} h3,
  .${EDITORIAL_PDF_ROOT_CLASS} h4,
  .${EDITORIAL_PDF_ROOT_CLASS} h5,
  .${EDITORIAL_PDF_ROOT_CLASS} h6 {
    color: #12263a;
    line-height: 1.3;
    break-after: avoid-page;
    page-break-after: avoid;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} h1 { margin: 0 0 7mm; font-size: 20pt; }
  .${EDITORIAL_PDF_ROOT_CLASS} h2 { margin: 9mm 0 3.5mm; font-size: 15pt; }
  .${EDITORIAL_PDF_ROOT_CLASS} h3 { margin: 7mm 0 3mm; font-size: 12.5pt; }
  .${EDITORIAL_PDF_ROOT_CLASS} h4,
  .${EDITORIAL_PDF_ROOT_CLASS} h5,
  .${EDITORIAL_PDF_ROOT_CLASS} h6 { margin: 5mm 0 2.5mm; font-size: 11pt; }

  .${EDITORIAL_PDF_ROOT_CLASS} p {
    margin: 0 0 0.75em;
    text-align: justify;
    widows: 3;
    orphans: 3;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} ol,
  .${EDITORIAL_PDF_ROOT_CLASS} ul {
    margin: 0.35em 0 0.8em;
    padding-inline-start: 2em;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} li {
    margin: 0.18em 0;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} blockquote,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-callout {
    margin: 0.8em 0;
    padding: 0.75em 1em;
    border-inline-start: 3pt solid #2d7585;
    background: #edf4f5;
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-callout-label {
    margin: 0 0 0.4em;
    color: #245b68;
    font-size: 9pt;
    font-weight: 700;
    text-transform: uppercase;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} pre,
  .${EDITORIAL_PDF_ROOT_CLASS} table,
  .${EDITORIAL_PDF_ROOT_CLASS} img {
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} pre {
    margin: 0.8em 0;
    padding: 0.9em;
    border: 0.5pt solid #cbd4de;
    border-radius: 3pt;
    background: #f5f7f9;
    font-size: 8.5pt;
    line-height: 1.45;
    white-space: pre-wrap;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} code {
    font-family: "SFMono-Regular", Consolas, monospace;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} table {
    width: 100%;
    margin: 0.9em 0;
    border-collapse: collapse;
    font-size: 9pt;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} th,
  .${EDITORIAL_PDF_ROOT_CLASS} td {
    padding: 0.45em 0.55em;
    border: 0.5pt solid #aeb9c5;
    vertical-align: top;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} th {
    color: #12263a;
    background: #e8eef3;
    font-weight: 700;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} img {
    display: block;
    max-width: 100%;
    max-height: 225mm;
    height: auto;
    margin: 0.9em auto;
    object-fit: contain;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} a {
    color: #1a6172;
    text-decoration: underline;
    text-underline-offset: 0.12em;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} mark {
    background: #fff0a8;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} hr {
    margin: 1.2em 0;
    border: 0;
    border-top: 0.6pt solid #9ba9b8;
  }
}
`.trim();
}

function appendInlines(
  ownerDocument: Document,
  parent: HTMLElement,
  inlines: readonly EditorialInline[],
  depth = 0
): void {
  if (depth > MAX_EDITORIAL_PDF_RENDER_DEPTH) {
    throw new Error("PDF content nesting exceeds the safe rendering limit.");
  }
  for (const inline of inlines) {
    switch (inline.type) {
      case "text":
        parent.appendChild(ownerDocument.createTextNode(inline.value));
        break;
      case "hardbreak":
        parent.appendChild(createHtmlElement(ownerDocument, "br"));
        break;
      case "code": {
        const code = createHtmlElement(ownerDocument, "code");
        code.textContent = inline.value;
        parent.appendChild(code);
        break;
      }
      case "image": {
        if (!SAFE_IMAGE_DATA_URI.test(inline.src)) {
          parent.appendChild(ownerDocument.createTextNode(inline.alt || "[image omitted]"));
          break;
        }
        const image = createHtmlElement(ownerDocument, "img");
        image.src = inline.src;
        image.alt = inline.alt;
        parent.appendChild(image);
        break;
      }
      case "link": {
        if (!SAFE_LINK.test(inline.href)) {
          appendInlines(ownerDocument, parent, inline.children, depth + 1);
          break;
        }
        const link = createHtmlElement(ownerDocument, "a");
        link.href = inline.href;
        link.rel = "noreferrer noopener";
        appendInlines(ownerDocument, link, inline.children, depth + 1);
        parent.appendChild(link);
        break;
      }
      case "wikilink":
        parent.appendChild(ownerDocument.createTextNode(inline.label || inline.target));
        break;
      case "styled": {
        const tagByStyle: Record<typeof inline.style, keyof HTMLElementTagNameMap> = {
          strong: "strong",
          emphasis: "em",
          delete: "del",
          mark: "mark",
          underline: "u",
          superscript: "sup",
          subscript: "sub",
          span: "span"
        };
        const styled = createHtmlElement(ownerDocument, tagByStyle[inline.style]);
        if (inline.color && SAFE_COLOR.test(inline.color)) {
          styled.style.color = inline.color;
        }
        if (inline.backgroundColor && SAFE_COLOR.test(inline.backgroundColor)) {
          styled.style.backgroundColor = inline.backgroundColor;
        }
        appendInlines(ownerDocument, styled, inline.children, depth + 1);
        parent.appendChild(styled);
        break;
      }
    }
  }
}

function appendBlocks(
  ownerDocument: Document,
  parent: HTMLElement,
  blocks: readonly EditorialBlock[],
  depth = 0
): void {
  if (depth > MAX_EDITORIAL_PDF_RENDER_DEPTH) {
    throw new Error("PDF content nesting exceeds the safe rendering limit.");
  }
  for (const block of blocks) {
    switch (block.type) {
      case "paragraph": {
        const paragraph = createHtmlElement(ownerDocument, "p");
        if (block.alignment) paragraph.style.textAlign = block.alignment;
        appendInlines(ownerDocument, paragraph, block.inlines, depth + 1);
        parent.appendChild(paragraph);
        break;
      }
      case "heading": {
        const heading = createHtmlElement(ownerDocument, `h${block.level}`);
        appendInlines(ownerDocument, heading, block.inlines, depth + 1);
        parent.appendChild(heading);
        break;
      }
      case "list": {
        let list: HTMLOListElement | HTMLUListElement;
        if (block.ordered) {
          const orderedList = createHtmlElement(ownerDocument, "ol");
          if (block.start && block.start !== 1) orderedList.start = block.start;
          list = orderedList;
        } else {
          list = createHtmlElement(ownerDocument, "ul");
        }
        for (const item of block.items) {
          const listItem = createHtmlElement(ownerDocument, "li");
          if (typeof item.checked === "boolean") {
            const marker = createHtmlElement(ownerDocument, "span");
            marker.textContent = item.checked ? "☑ " : "☐ ";
            marker.setAttribute("aria-hidden", "true");
            listItem.appendChild(marker);
          }
          appendBlocks(ownerDocument, listItem, item.blocks, depth + 1);
          list.appendChild(listItem);
        }
        parent.appendChild(list);
        break;
      }
      case "table": {
        const table = createHtmlElement(ownerDocument, "table");
        if (block.header.length > 0) {
          const tableHead = createHtmlElement(ownerDocument, "thead");
          const row = createHtmlElement(ownerDocument, "tr");
          for (const cell of block.header) {
            const heading = createHtmlElement(ownerDocument, "th");
            appendInlines(ownerDocument, heading, cell, depth + 1);
            row.appendChild(heading);
          }
          tableHead.appendChild(row);
          table.appendChild(tableHead);
        }
        const tableBody = createHtmlElement(ownerDocument, "tbody");
        for (const bodyRow of block.rows) {
          const row = createHtmlElement(ownerDocument, "tr");
          for (const cell of bodyRow) {
            const data = createHtmlElement(ownerDocument, "td");
            appendInlines(ownerDocument, data, cell, depth + 1);
            row.appendChild(data);
          }
          tableBody.appendChild(row);
        }
        table.appendChild(tableBody);
        parent.appendChild(table);
        break;
      }
      case "quote": {
        const quote = createHtmlElement(ownerDocument, "blockquote");
        appendBlocks(ownerDocument, quote, block.blocks, depth + 1);
        parent.appendChild(quote);
        break;
      }
      case "callout": {
        const callout = createHtmlElement(ownerDocument, "aside");
        callout.className = "hanmark-editorial-pdf-callout";
        const label = createHtmlElement(ownerDocument, "p");
        label.className = "hanmark-editorial-pdf-callout-label";
        label.textContent = block.kind;
        callout.appendChild(label);
        appendBlocks(ownerDocument, callout, block.blocks, depth + 1);
        parent.appendChild(callout);
        break;
      }
      case "code": {
        const pre = createHtmlElement(ownerDocument, "pre");
        const code = createHtmlElement(ownerDocument, "code");
        if (block.language) code.setAttribute("data-language", block.language);
        code.textContent = block.value;
        pre.appendChild(code);
        parent.appendChild(pre);
        break;
      }
      case "thematic-break":
        parent.appendChild(createHtmlElement(ownerDocument, "hr"));
        break;
    }
  }
}

function inlinePlainText(inlines: readonly EditorialInline[]): string {
  return inlines.map((inline): string => {
    switch (inline.type) {
      case "text":
      case "code":
        return inline.value;
      case "hardbreak":
        return "\n";
      case "image":
        return inline.alt;
      case "link":
      case "styled":
        return inlinePlainText(inline.children);
      case "wikilink":
        return inline.label || inline.target;
    }
  }).join("");
}

export function buildEditorialPdfRoot(
  ownerDocument: Document,
  editorial: EditorialDocument,
  fileTitle: string
): HTMLElement {
  const root = createHtmlElement(ownerDocument, "section");
  root.className = EDITORIAL_PDF_ROOT_CLASS;
  root.setAttribute("aria-hidden", "true");

  const cover = createHtmlElement(ownerDocument, "section");
  cover.className = "hanmark-editorial-pdf-cover";
  const coverTitle = createHtmlElement(ownerDocument, "h1");
  coverTitle.className = "hanmark-editorial-pdf-cover-title";
  coverTitle.textContent = fileTitle;
  cover.appendChild(coverTitle);
  root.appendChild(cover);

  const body = createHtmlElement(ownerDocument, "main");
  body.className = "hanmark-editorial-pdf-body";
  const mastheadText = inlinePlainText(editorial.masthead).trim();
  if (mastheadText && mastheadText !== fileTitle) {
    const masthead = createHtmlElement(ownerDocument, "h1");
    appendInlines(ownerDocument, masthead, editorial.masthead);
    body.appendChild(masthead);
  }
  appendBlocks(ownerDocument, body, editorial.blocks);
  root.appendChild(body);
  return root;
}

function waitForEventImage(
  image: HTMLImageElement,
  timeoutMs: number,
  view: Window
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeout: number | undefined;
    const cleanup = (): void => {
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
      if (timeout) view.clearTimeout(timeout);
    };
    const handleLoad = (): void => {
      cleanup();
      if (image.naturalWidth > 0) resolve();
      else reject(new Error(`Image has no decodable pixels: ${image.alt || "untitled image"}`));
    };
    const handleError = (): void => {
      cleanup();
      reject(new Error(`Image failed to load: ${image.alt || "untitled image"}`));
    };
    image.addEventListener("load", handleLoad, { once: true });
    image.addEventListener("error", handleError, { once: true });
    timeout = view.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out loading image: ${image.alt || "untitled image"}`));
    }, timeoutMs);
  });
}

export async function waitForEditorialPdfAssets(
  ownerDocument: Document,
  root: HTMLElement,
  timeoutMs = DEFAULT_ASSET_TIMEOUT_MS
): Promise<void> {
  const fonts = (ownerDocument as Document & { fonts?: FontFaceSetLike }).fonts;
  if (fonts) {
    await fonts.load?.(
      '10pt "HanMark Pretendard"',
      "가나다라마바사 ABCDEFG 0123456789"
    );
    await fonts.ready;
  }

  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map(async (image) => {
    try {
      if (typeof image.decode === "function") {
        await image.decode();
      } else if (!image.complete) {
        const view = ownerDocument.defaultView;
        if (!view) throw new Error("The print document has no active window.");
        await waitForEventImage(image, timeoutMs, view);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Image failed to decode (${image.alt || "untitled image"}): ${reason}`);
    }
    if (!image.complete || image.naturalWidth <= 0) {
      throw new Error(`Image failed to decode: ${image.alt || "untitled image"}`);
    }
  }));
}

function editorialPdfUnsupportedMessage(support: EditorialPdfRuntimeSupport): string {
  if (support.chromiumMajor === null) {
    return `Achmage Editorial PDF requires Chromium ${support.minimum} or newer, but this Obsidian runtime could not be identified.`;
  }
  return `Achmage Editorial PDF requires Chromium ${support.minimum} or newer. This Obsidian runtime uses Chromium ${support.chromiumMajor}.`;
}

export class EditorialPdfService {
  private activeCleanup: (() => void) | null = null;

  async print(request: EditorialPdfRequest): Promise<HanmarkExportOutcome> {
    const view = request.window ?? request.document?.defaultView ?? window;
    const ownerDocument = request.document ?? view.document;
    const support = getEditorialPdfRuntimeSupport(
      view.navigator.userAgent,
      request.chromiumMajor
    );
    if (!support.supported) {
      throw new Error(editorialPdfUnsupportedMessage(support));
    }

    this.dispose();

    const fileTitle = normalizedFileTitle(request.fileName);
    const editorial = parseEditorialDocument(request.markdown, fileTitle);
    const style = createHtmlElement(ownerDocument, "style");
    style.className = EDITORIAL_PDF_STYLE_CLASS;
    style.textContent = createEditorialPdfStyles(fileTitle);
    const root = buildEditorialPdfRoot(ownerDocument, editorial, fileTitle);

    ownerDocument.head.appendChild(style);
    ownerDocument.body.appendChild(root);
    ownerDocument.body.classList.add(EDITORIAL_PDF_BODY_CLASS);

    let cleaned = false;
    let watchdog: number | undefined;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      if (watchdog) view.clearTimeout(watchdog);
      view.removeEventListener("afterprint", cleanup);
      view.removeEventListener("error", cleanup);
      view.removeEventListener("beforeunload", cleanup);
      root.remove();
      style.remove();
      if (!ownerDocument.querySelector(`.${EDITORIAL_PDF_ROOT_CLASS}`)) {
        ownerDocument.body.classList.remove(EDITORIAL_PDF_BODY_CLASS);
      }
      if (this.activeCleanup === cleanup) this.activeCleanup = null;
    };
    this.activeCleanup = cleanup;
    view.addEventListener("afterprint", cleanup, { once: true });
    view.addEventListener("error", cleanup, { once: true });
    view.addEventListener("beforeunload", cleanup, { once: true });
    watchdog = view.setTimeout(
      cleanup,
      request.watchdogMs ?? DEFAULT_WATCHDOG_MS
    );

    try {
      await waitForEditorialPdfAssets(
        ownerDocument,
        root,
        request.assetTimeoutMs ?? DEFAULT_ASSET_TIMEOUT_MS
      );
      view.print();
      return {
        format: "pdf",
        status: "delegated"
      };
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  dispose(): void {
    this.activeCleanup?.();
  }
}
