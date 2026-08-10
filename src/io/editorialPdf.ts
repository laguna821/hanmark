import type {
  EditorialBlock,
  EditorialDocument,
  EditorialInline
} from "./editorialDocument";
import {
  parseEditorialDocument,
  safeEditorialImageUrl
} from "./editorialDocument";
import {
  BUILTIN_EDITORIAL_PDF_PALETTE,
  BUILTIN_EDITORIAL_PDF_THEME,
  resolveEditorialPdfThemeSnapshot,
  type EditorialPdfThemeSnapshot,
  type ResolvedEditorialPdfTheme
} from "./editorialPdfTheme";
import type { HanmarkExportOutcome } from "./exportTypes";

export const EDITORIAL_PDF_MIN_CHROMIUM = 131;
export const EDITORIAL_PDF_BODY_CLASS = "hanmark-editorial-pdf-active";
export const EDITORIAL_PDF_ROOT_CLASS = "hanmark-editorial-pdf-root";
export const EDITORIAL_PDF_OBSIDIAN_PRINT_CLASS = "print";
export const EDITORIAL_PDF_CODE_COLUMNS = 88;
export const EDITORIAL_PDF_CODE_SPLIT_THRESHOLD_ROWS = 48;
export const EDITORIAL_PDF_TABLE_COLUMNS = 88;
export const EDITORIAL_PDF_TABLE_SPLIT_THRESHOLD_ROWS = 24;
export const EDITORIAL_PDF_TABLE_ROW_SPLIT_THRESHOLD_ROWS = 40;
export const EDITORIAL_PDF_TABLE_PAGE_BUDGET_ROWS = 40;
export const EDITORIAL_PDF_NATIVE_TABLE_MAX_COLUMNS = 12;
export const EDITORIAL_PDF_FALLBACK_LABEL_MAX_GRAPHEMES = 48;
export const EDITORIAL_PDF_FALLBACK_COLUMNS = 72;
export const EDITORIAL_PDF_CONTAINER_SPLIT_THRESHOLD_ROWS = 40;
export const EDITORIAL_PDF_IMAGE_ESTIMATED_ROWS = 48;
export const EDITORIAL_PDF_SPLITTABLE_CLASS =
  "hanmark-editorial-pdf-breakable";
export const EDITORIAL_PDF_SPLITTABLE_CODE_CLASS =
  "hanmark-editorial-pdf-code-splittable";
export const EDITORIAL_PDF_CODE_CHUNK_CLASS =
  "hanmark-editorial-pdf-code-chunk";
export const EDITORIAL_PDF_SPLITTABLE_TABLE_CLASS =
  "hanmark-editorial-pdf-table-splittable";
export const EDITORIAL_PDF_SPLITTABLE_TABLE_HEAD_CLASS =
  "hanmark-editorial-pdf-table-head-splittable";
export const EDITORIAL_PDF_SPLITTABLE_TABLE_ROW_CLASS =
  "hanmark-editorial-pdf-table-row-splittable";
export const EDITORIAL_PDF_SPLITTABLE_CONTAINER_CLASS =
  "hanmark-editorial-pdf-container-splittable";
export const EDITORIAL_PDF_TABLE_FALLBACK_CLASS =
  "hanmark-editorial-pdf-table-fallback";
export const EDITORIAL_PDF_TABLE_FALLBACK_ROW_CLASS =
  "hanmark-editorial-pdf-table-fallback-row";
export const EDITORIAL_PDF_TABLE_FALLBACK_HEADER_ROW_CLASS =
  "hanmark-editorial-pdf-table-fallback-header-row";
export const EDITORIAL_PDF_TABLE_FALLBACK_CELL_CLASS =
  "hanmark-editorial-pdf-table-fallback-cell";
export const EDITORIAL_PDF_TABLE_FALLBACK_LABEL_CLASS =
  "hanmark-editorial-pdf-table-fallback-label";
export const EDITORIAL_PDF_TABLE_FALLBACK_VALUE_CLASS =
  "hanmark-editorial-pdf-table-fallback-value";
export const EDITORIAL_PDF_CONTAINER_FALLBACK_CLASS =
  "hanmark-editorial-pdf-container-fallback";
export const EDITORIAL_PDF_CONTAINER_FALLBACK_LABEL_CLASS =
  "hanmark-editorial-pdf-container-fallback-label";
export const EDITORIAL_PDF_CONTAINER_FALLBACK_BODY_CLASS =
  "hanmark-editorial-pdf-container-fallback-body";
const EDITORIAL_PDF_STYLE_CLASS = "hanmark-editorial-pdf-style";
const DEFAULT_WATCHDOG_MS = 10 * 60 * 1000;
const DEFAULT_ASSET_TIMEOUT_MS = 20 * 1000;
const EDITORIAL_PDF_PRINT_FONT_FAMILY =
  '"HanMark Pretendard", "Pretendard", "Apple SD Gothic Neo", sans-serif';
const EDITORIAL_PDF_FONT_PROBES = [
  '400 10pt "HanMark Pretendard"',
  '600 10pt "HanMark Pretendard"'
] as const;
const EDITORIAL_PDF_FONT_PROBE_TEXT =
  "HanMark PDF 한글 표지 본문 가나다 ABCDEFG 0123456789";
const EDITORIAL_PDF_FALLBACK_FONT_PROBES = [
  `400 10pt ${EDITORIAL_PDF_PRINT_FONT_FAMILY}`,
  `600 10pt ${EDITORIAL_PDF_PRINT_FONT_FAMILY}`
] as const;
const EDITORIAL_PDF_FALLBACK_FONT_PROBE_TEXT =
  "한글 표지 본문 가나다";
const EDITORIAL_PDF_HEADER_MAX_GRAPHEMES = 20;
const EDITORIAL_PDF_COVER_TITLE_WIDTH_PT = 430;
const EDITORIAL_PDF_COVER_TITLE_MIN_PT = 5;
// Windows can open a second "Save PDF" dialog after the browser print dialog
// has already emitted `afterprint`. Keep the prepared DOM alive long enough
// for that native save step to finish; a new export or plugin unload still
// disposes it immediately.
const POST_PRINT_CLEANUP_DELAY_MS = 5 * 60 * 1000;
const MAX_EDITORIAL_PDF_RENDER_DEPTH = 128;
const SAFE_LINK = /^(?:https?:|mailto:)/i;
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SAFE_EDITORIAL_PDF_ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "DOMException",
  "AbortError",
  "DataError",
  "EncodingError",
  "HierarchyRequestError",
  "InvalidCharacterError",
  "InvalidStateError",
  "NamespaceError",
  "NetworkError",
  "NotFoundError",
  "NotReadableError",
  "NotSupportedError",
  "OperationError",
  "QuotaExceededError",
  "SecurityError",
  "TimeoutError"
]);

interface FontFaceSetLike {
  ready: Promise<unknown>;
  load?: (font: string, text?: string) => Promise<unknown>;
}

interface EditorialPdfStyleElementLike {
  isConnected?: boolean;
  parentNode?: Node | null;
  sheet?: {
    cssRules?: ArrayLike<unknown>;
  } | null;
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
  theme?: EditorialPdfThemeSnapshot;
  window?: Window;
  document?: Document;
  chromiumMajor?: number;
  watchdogMs?: number;
  assetTimeoutMs?: number;
}

export interface EditorialPdfRenderTheme {
  readonly builtIn: boolean;
  readonly resolved: ResolvedEditorialPdfTheme;
}

export interface EditorialPdfRuntimeSupport {
  supported: boolean;
  chromiumMajor: number | null;
  minimum: number;
}

export type EditorialPdfStage =
  | "Markdown 파싱"
  | "인쇄 DOM 생성"
  | "인쇄 트리 생성"
  | "호스트 DOM 연결"
  | "글꼴·이미지 대기"
  | "페이지 조판"
  | "인쇄 호출";

type EditorialTableBlock = Extract<EditorialBlock, { type: "table" }>;

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

function editorialPdfDisplayWidth(part: string): number {
  if (part === "\t") return 4;
  const codePoint = part.codePointAt(0) ?? 0;
  if (codePoint <= 0x7f) return 1;

  const isCjk =
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd);
  const isEmoji =
    (codePoint >= 0x2300 && codePoint <= 0x23ff) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    (codePoint >= 0x2b00 && codePoint <= 0x2bff) ||
    (codePoint >= 0x1f000 && codePoint <= 0x1faff) ||
    part.includes("\ufe0f") ||
    part.includes("\u200d") ||
    part.includes("\u20e3");
  return isCjk || isEmoji ? 2 : 1;
}

/**
 * Estimates the number of printed visual rows without laying out the code in
 * the browser. The iterator stops as soon as the caller's row limit is
 * exceeded, so a pathological block cannot turn classification into another
 * unbounded preprocessing pass.
 */
function estimateEditorialPdfTextRows(
  value: string,
  columns: number,
  stopAfterRows: number
): number {
  const safeColumns = Math.max(1, Math.floor(columns));
  const safeLimit = Math.max(1, Math.floor(stopAfterRows));
  const Segmenter = (Intl as unknown as {
    Segmenter?: SegmenterConstructor;
  }).Segmenter;
  const parts: Iterable<string | SegmentPart> = Segmenter
    ? new Segmenter("ko", { granularity: "grapheme" }).segment(value)
    : value;
  let rows = 1;
  let usedColumns = 0;
  let previousWasCarriageReturn = false;

  for (const item of parts) {
    const part = typeof item === "string" ? item : item.segment;
    if (part === "\n" && previousWasCarriageReturn) {
      previousWasCarriageReturn = false;
      continue;
    }
    if (
      part === "\n" ||
      part === "\r" ||
      part === "\r\n" ||
      part === "\u2028" ||
      part === "\u2029"
    ) {
      rows += 1;
      usedColumns = 0;
    } else {
      const width = editorialPdfDisplayWidth(part);
      if (usedColumns > 0 && usedColumns + width > safeColumns) {
        rows += 1;
        usedColumns = 0;
      }
      usedColumns += width;
    }
    previousWasCarriageReturn = part === "\r";
    if (rows > safeLimit) return safeLimit + 1;
  }
  return rows;
}

export function estimateEditorialPdfCodeRows(
  value: string,
  stopAfterRows = EDITORIAL_PDF_CODE_SPLIT_THRESHOLD_ROWS
): number {
  return estimateEditorialPdfTextRows(
    value,
    EDITORIAL_PDF_CODE_COLUMNS,
    stopAfterRows
  );
}

interface EditorialPdfCodePosition {
  rows: number;
  columns: number;
}

function advanceEditorialPdfCodePosition(
  position: EditorialPdfCodePosition,
  part: string,
  columns = EDITORIAL_PDF_CODE_COLUMNS
): EditorialPdfCodePosition {
  if (
    part === "\n" ||
    part === "\r" ||
    part === "\r\n" ||
    part === "\u2028" ||
    part === "\u2029"
  ) {
    return { rows: position.rows + 1, columns: 0 };
  }
  const width = editorialPdfDisplayWidth(part);
  if (
    position.columns > 0 &&
    position.columns + width > columns
  ) {
    return { rows: position.rows + 1, columns: width };
  }
  return {
    rows: position.rows,
    columns: position.columns + width
  };
}

export function splitEditorialPdfCodeChunks(
  value: string,
  maxRows = EDITORIAL_PDF_CODE_SPLIT_THRESHOLD_ROWS,
  columns = EDITORIAL_PDF_CODE_COLUMNS
): string[] {
  const safeMaxRows = Math.max(1, Math.floor(maxRows));
  const safeColumns = Math.max(1, Math.floor(columns));
  if (
    estimateEditorialPdfTextRows(
      value,
      safeColumns,
      safeMaxRows
    ) <=
    safeMaxRows
  ) {
    return [value];
  }

  const Segmenter = (Intl as unknown as {
    Segmenter?: SegmenterConstructor;
  }).Segmenter;
  const parts: Iterable<string | SegmentPart> = Segmenter
    ? new Segmenter("ko", { granularity: "grapheme" }).segment(value)
    : value;
  const chunks: string[] = [];
  let chunkParts: string[] = [];
  let position: EditorialPdfCodePosition = { rows: 1, columns: 0 };
  let pendingCarriageReturn = "";
  let visualRowStartIndex = 0;

  const appendPart = (part: string): void => {
    const isLineBreak =
      part === "\n" ||
      part === "\r" ||
      part === "\r\n" ||
      part === "\u2028" ||
      part === "\u2029";
    let next = advanceEditorialPdfCodePosition(
      position,
      part,
      safeColumns
    );
    if (next.rows > safeMaxRows && chunkParts.length > 0) {
      // Keep an explicit line break at the end of the previous physical PRE,
      // never at the start of the next one. When the last visual row already
      // contains text, move that row into the next chunk before appending the
      // break. This preserves exact text without a duplicate blank first line.
      if (
        isLineBreak &&
        visualRowStartIndex > 0 &&
        visualRowStartIndex < chunkParts.length
      ) {
        chunks.push(
          chunkParts.slice(0, visualRowStartIndex).join("")
        );
        chunkParts = chunkParts.slice(visualRowStartIndex);
      } else {
        chunks.push(chunkParts.join(""));
        chunkParts = [];
      }
      position = { rows: 1, columns: 0 };
      visualRowStartIndex = 0;
      for (
        let existingIndex = 0;
        existingIndex < chunkParts.length;
        existingIndex += 1
      ) {
        const existingPart = chunkParts[existingIndex];
        const previousRows = position.rows;
        position = advanceEditorialPdfCodePosition(
          position,
          existingPart,
          safeColumns
        );
        if (position.rows > previousRows) {
          visualRowStartIndex =
            existingPart === "\n" ||
            existingPart === "\r" ||
            existingPart === "\r\n" ||
            existingPart === "\u2028" ||
            existingPart === "\u2029"
              ? existingIndex + 1
              : existingIndex;
        }
      }
      next = advanceEditorialPdfCodePosition(
        position,
        part,
        safeColumns
      );
    }
    const previousRows = position.rows;
    chunkParts.push(part);
    position = next;
    if (isLineBreak) {
      visualRowStartIndex = chunkParts.length;
    } else if (position.rows > previousRows) {
      visualRowStartIndex = chunkParts.length - 1;
    }
  };

  for (const item of parts) {
    const part = typeof item === "string" ? item : item.segment;
    if (pendingCarriageReturn) {
      if (part === "\n") {
        appendPart("\r\n");
        pendingCarriageReturn = "";
        continue;
      }
      appendPart(pendingCarriageReturn);
      pendingCarriageReturn = "";
    }
    if (part === "\r") {
      pendingCarriageReturn = part;
    } else {
      appendPart(part);
    }
  }
  if (pendingCarriageReturn) appendPart(pendingCarriageReturn);
  if (chunkParts.length > 0 || chunks.length === 0) {
    chunks.push(chunkParts.join(""));
  }
  return chunks;
}

function editorialPdfInlineVisibleText(
  inlines: readonly EditorialInline[]
): string {
  const output: string[] = [];
  const stack: EditorialInline[] = [];
  for (let index = inlines.length - 1; index >= 0; index -= 1) {
    stack.push(inlines[index]);
  }

  while (stack.length > 0) {
    const inline = stack.pop();
    if (!inline) continue;
    switch (inline.type) {
      case "text":
      case "code":
        output.push(inline.value);
        break;
      case "hardbreak":
        output.push("\n");
        break;
      case "image":
        // A printable image may be as tall as 225 mm. Count it as almost a
        // full body page so image-bearing rows and containers are allowed to
        // fragment instead of inheriting an impossible keep-together rule.
        output.push(
          inline.alt,
          "\n".repeat(EDITORIAL_PDF_IMAGE_ESTIMATED_ROWS)
        );
        break;
      case "wikilink":
        output.push(inline.label || inline.target);
        break;
      case "link":
      case "styled":
        for (
          let index = inline.children.length - 1;
          index >= 0;
          index -= 1
        ) {
          stack.push(inline.children[index]);
        }
        break;
    }
  }
  return output.join("");
}

function editorialPdfTableColumnCount(table: EditorialTableBlock): number {
  let columnCount = table.header.length;
  for (const row of table.rows) {
    if (row.length > columnCount) columnCount = row.length;
  }
  return Math.max(1, columnCount);
}

export function estimateEditorialPdfTableRowRows(
  row: readonly EditorialInline[][],
  columnCount: number,
  stopAfterRows = EDITORIAL_PDF_TABLE_ROW_SPLIT_THRESHOLD_ROWS
): number {
  // Reserve roughly one monospace column on either side for cell padding.
  const cellColumns = Math.max(
    6,
    Math.floor(EDITORIAL_PDF_TABLE_COLUMNS / Math.max(1, columnCount)) - 2
  );
  let rowRows = 1;
  for (const cell of row) {
    const cellRows = estimateEditorialPdfTextRows(
      editorialPdfInlineVisibleText(cell),
      cellColumns,
      stopAfterRows
    );
    if (cellRows > rowRows) rowRows = cellRows;
    if (rowRows > stopAfterRows) return stopAfterRows + 1;
  }
  return rowRows;
}

export function estimateEditorialPdfTableRows(
  table: EditorialTableBlock,
  stopAfterRows = EDITORIAL_PDF_TABLE_SPLIT_THRESHOLD_ROWS
): number {
  const columnCount = editorialPdfTableColumnCount(table);
  let totalRows = 0;
  const rows: readonly EditorialInline[][][] =
    table.header.length > 0
      ? [table.header, ...table.rows]
      : table.rows;
  for (const row of rows) {
    totalRows += estimateEditorialPdfTableRowRows(
      row,
      columnCount,
      stopAfterRows - Math.min(totalRows, stopAfterRows)
    );
    if (totalRows > stopAfterRows) return stopAfterRows + 1;
  }
  return totalRows;
}

export function estimateEditorialPdfContainerRows(
  blocks: readonly EditorialBlock[],
  stopAfterRows = EDITORIAL_PDF_CONTAINER_SPLIT_THRESHOLD_ROWS
): number {
  const stack: EditorialBlock[] = [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    stack.push(blocks[index]);
  }
  let totalRows = 0;

  while (stack.length > 0) {
    const block = stack.pop();
    if (!block) continue;
    switch (block.type) {
      case "paragraph":
        totalRows += estimateEditorialPdfTextRows(
          editorialPdfInlineVisibleText(block.inlines),
          EDITORIAL_PDF_CODE_COLUMNS,
          stopAfterRows - Math.min(totalRows, stopAfterRows)
        ) + 1;
        break;
      case "heading":
        totalRows += estimateEditorialPdfTextRows(
          editorialPdfInlineVisibleText(block.inlines),
          EDITORIAL_PDF_CODE_COLUMNS,
          stopAfterRows - Math.min(totalRows, stopAfterRows)
        ) + 2;
        break;
      case "list":
        totalRows += block.items.length;
        for (
          let itemIndex = block.items.length - 1;
          itemIndex >= 0;
          itemIndex -= 1
        ) {
          const itemBlocks = block.items[itemIndex].blocks;
          for (
            let blockIndex = itemBlocks.length - 1;
            blockIndex >= 0;
            blockIndex -= 1
          ) {
            stack.push(itemBlocks[blockIndex]);
          }
        }
        break;
      case "table":
        if (
          estimateEditorialPdfTableRows(block) >
          EDITORIAL_PDF_TABLE_SPLIT_THRESHOLD_ROWS
        ) {
          return stopAfterRows + 1;
        }
        totalRows += estimateEditorialPdfTableRows(
          block,
          stopAfterRows - Math.min(totalRows, stopAfterRows)
        ) + 2;
        break;
      case "quote":
        totalRows += 2;
        for (let index = block.blocks.length - 1; index >= 0; index -= 1) {
          stack.push(block.blocks[index]);
        }
        break;
      case "callout":
        totalRows += 3;
        for (let index = block.blocks.length - 1; index >= 0; index -= 1) {
          stack.push(block.blocks[index]);
        }
        break;
      case "code":
        totalRows += estimateEditorialPdfCodeRows(
          block.value,
          stopAfterRows - Math.min(totalRows, stopAfterRows)
        ) + 2;
        break;
      case "thematic-break":
        totalRows += 1;
        break;
    }
    if (totalRows > stopAfterRows) return stopAfterRows + 1;
  }
  return totalRows;
}

function editorialPdfTitleUnits(value: string): number {
  return graphemes(value).reduce((total, part) => {
    if (/^\s+$/u.test(part)) return total + 0.35;
    const codePoint = part.codePointAt(0) ?? 0;
    if (Array.from(part).length === 1 && codePoint <= 0x7f) {
      if (/^[A-Z0-9]$/u.test(part)) return total + 0.68;
      if (/^[a-z]$/u.test(part)) return total + 0.55;
      return total + 0.45;
    }
    return total + 1;
  }, 0);
}

export function truncateEditorialPdfHeader(value: string, maxGraphemes = 72): string {
  if (!Number.isInteger(maxGraphemes) || maxGraphemes < 1) {
    throw new Error("PDF header length must be a positive integer.");
  }
  const parts = graphemes(value);
  if (parts.length <= maxGraphemes) return value;
  return `${parts.slice(0, maxGraphemes).join("")}…`;
}

export interface EditorialPdfCoverTitleLayout {
  lines: readonly string[];
  fontSizePt: number;
}

function splitEditorialPdfTitleByGrapheme(
  value: string,
  lineCount: number
): string[] {
  const parts = graphemes(value);
  const baseLength = Math.floor(parts.length / lineCount);
  const remainder = parts.length % lineCount;
  const lines: string[] = [];
  let offset = 0;
  for (let index = 0; index < lineCount; index += 1) {
    const length = baseLength + (index < remainder ? 1 : 0);
    lines.push(parts.slice(offset, offset + length).join("").trim());
    offset += length;
  }
  return lines;
}

function splitEditorialPdfTitleByWords(
  words: readonly string[],
  lineCount: number
): string[] {
  const lines: string[] = [];
  let offset = 0;
  for (let lineIndex = 0; lineIndex < lineCount - 1; lineIndex += 1) {
    const remainingLines = lineCount - lineIndex;
    const finalBoundary = words.length - (remainingLines - 1);
    const remainingText = words.slice(offset).join(" ");
    const targetLength =
      editorialPdfTitleUnits(remainingText) / remainingLines;
    let bestBoundary = offset + 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (
      let boundary = offset + 1;
      boundary <= finalBoundary;
      boundary += 1
    ) {
      const candidateLength = editorialPdfTitleUnits(
        words.slice(offset, boundary).join(" ")
      );
      const distance = Math.abs(candidateLength - targetLength);
      if (distance < bestDistance) {
        bestBoundary = boundary;
        bestDistance = distance;
      }
    }
    lines.push(words.slice(offset, bestBoundary).join(" "));
    offset = bestBoundary;
  }
  lines.push(words.slice(offset).join(" "));
  return lines;
}

/**
 * Creates a deterministic, non-truncating cover title layout. Word boundaries
 * are preserved whenever they can produce reasonably balanced lines; only an
 * unusually long unbroken token falls back to grapheme-level splitting.
 */
export function balanceEditorialPdfCoverTitle(
  value: string
): EditorialPdfCoverTitleLayout {
  const normalized = value.trim().replace(/\s+/gu, " ") || "Untitled";
  const length = graphemes(normalized).length;
  const words = normalized.split(" ");
  const split = (lineCount: number): string[] => {
    const idealUnits = editorialPdfTitleUnits(normalized) / lineCount;
    const requiresGraphemeSplit =
      words.length < lineCount ||
      words.some(
        (word) => editorialPdfTitleUnits(word) > idealUnits * 1.35
      );
    return requiresGraphemeSplit
      ? splitEditorialPdfTitleByGrapheme(normalized, lineCount)
      : splitEditorialPdfTitleByWords(words, lineCount);
  };
  const fits = (lines: readonly string[], fontSizePt: number): boolean =>
    Math.max(...lines.map(editorialPdfTitleUnits)) * fontSizePt <=
    EDITORIAL_PDF_COVER_TITLE_WIDTH_PT;

  if (fits([normalized], 30)) {
    return { lines: [normalized], fontSizePt: 30 };
  }

  const twoLines = split(2);
  if (fits(twoLines, 26)) {
    return { lines: twoLines, fontSizePt: 26 };
  }

  const lines = split(3);
  const nominalFontSizePt =
    length <= 72 ? 21 :
    length <= 90 ? 19 :
    length <= 120 ? 18 :
    17;
  const longestLineUnits = Math.max(...lines.map(editorialPdfTitleUnits));
  const fittedFontSizePt =
    Math.floor(
      (EDITORIAL_PDF_COVER_TITLE_WIDTH_PT / longestLineUnits) * 2
    ) / 2;
  const fontSizePt = Math.max(
    EDITORIAL_PDF_COVER_TITLE_MIN_PT,
    Math.min(nominalFontSizePt, fittedFontSizePt)
  );
  return { lines, fontSizePt };
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

function resolveEditorialPdfModeText(
  mode: "file-title" | "custom" | "blank",
  customText: string,
  fileTitle: string
): string {
  switch (mode) {
    case "file-title":
      return fileTitle;
    case "custom":
      return customText;
    case "blank":
      return "";
  }
}

function prepareEditorialPdfRenderTheme(
  snapshot: EditorialPdfThemeSnapshot | undefined
): EditorialPdfRenderTheme | undefined {
  if (!snapshot) return undefined;
  return {
    builtIn: snapshot.builtIn,
    resolved: resolveEditorialPdfThemeSnapshot(snapshot)
  };
}

export function createEditorialPdfStyles(
  headerTitle: string,
  renderTheme?: EditorialPdfRenderTheme
): string {
  const theme = renderTheme?.resolved.theme ?? BUILTIN_EDITORIAL_PDF_THEME;
  const palette = renderTheme?.resolved.palette ?? BUILTIN_EDITORIAL_PDF_PALETTE;
  const headerLeft = escapeEditorialPdfCssString(theme.page.headerLeft);
  const headerRightText = resolveEditorialPdfModeText(
    theme.page.headerRightMode,
    theme.page.headerRightText,
    headerTitle
  );
  const header = escapeEditorialPdfCssString(
    truncateEditorialPdfHeader(
      headerRightText,
      EDITORIAL_PDF_HEADER_MAX_GRAPHEMES
    )
  );
  const footerLeft = escapeEditorialPdfCssString(theme.page.footerLeft);
  const pageNumber = theme.page.showPageNumber ? "counter(page)" : '""';
  const fallbackHeaderSurface =
    !renderTheme || renderTheme.builtIn
      ? palette.keyMutedInk
      : palette.keySurface;
  const customTagRowMinimum =
    !renderTheme || renderTheme.builtIn
      ? ""
      : "\n    min-height: 5.4mm;";
  return `
@page hanmark-cover {
  size: A4 portrait;
  margin: 0;

  @top-left {
    content: none;
  }

  @top-center {
    content: none;
  }

  @top-right {
    content: none;
  }

  @bottom-left {
    content: none;
  }

  @bottom-center {
    content: none;
  }

  @bottom-right {
    content: none;
  }
}

@page hanmark-body {
  size: A4 portrait;
  margin: 22mm 20mm;

  @top-left {
    content: "${headerLeft}";
    width: 33.333333%;
    margin-bottom: 4mm;
    padding-bottom: 4mm;
    border-bottom: 0.8pt solid ${palette.accentLine};
    color: ${palette.keyInk};
    font-family: "HanMark Pretendard", "Pretendard", sans-serif;
    font-size: 7pt;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-align: left;
    vertical-align: bottom;
  }

  @top-center {
    content: "";
    width: 33.333334%;
    margin-bottom: 4mm;
    padding-bottom: 4mm;
    border-bottom: 0.8pt solid ${palette.accentLine};
    vertical-align: bottom;
  }

  @top-right {
    content: "${header}";
    width: 33.333333%;
    margin-bottom: 4mm;
    padding-bottom: 4mm;
    border-bottom: 0.8pt solid ${palette.accentLine};
    color: ${palette.keyInk};
    font-family: "HanMark Pretendard", "Pretendard", sans-serif;
    font-size: 7pt;
    font-weight: 600;
    white-space: nowrap;
    text-align: right;
    vertical-align: bottom;
  }

  @bottom-left {
    content: "${footerLeft}";
    width: 33.333333%;
    margin-top: 4mm;
    padding-top: 4mm;
    border-top: 0.8pt solid ${palette.accentLine};
    color: ${palette.keyInk};
    font-family: "HanMark Pretendard", "Pretendard", sans-serif;
    font-size: 7pt;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-align: left;
    vertical-align: top;
  }

  @bottom-center {
    content: "";
    width: 33.333334%;
    margin-top: 4mm;
    padding-top: 4mm;
    border-top: 0.8pt solid ${palette.accentLine};
    vertical-align: top;
  }

  @bottom-right {
    content: ${pageNumber};
    width: 33.333333%;
    margin-top: 4mm;
    padding-top: 4mm;
    border-top: 0.8pt solid ${palette.accentLine};
    color: ${palette.keyInk};
    font-family: "HanMark Pretendard", "Pretendard", sans-serif;
    font-size: 7pt;
    font-weight: 600;
    text-align: right;
    vertical-align: top;
  }
}

.${EDITORIAL_PDF_ROOT_CLASS} {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: -100000px;
  display: block;
  width: 170mm;
  visibility: hidden;
  pointer-events: none;
  font-family: ${EDITORIAL_PDF_PRINT_FONT_FAMILY};
  font-size: 9pt;
  line-height: 1.55;
}

@media print {
  html {
    height: auto;
    overflow: visible;
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} {
    position: static;
    display: block;
    width: auto;
    height: auto;
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow: visible;
    color-scheme: only light;
    color: ${palette.bodyInk};
    background: ${palette.paper};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > :not(.${EDITORIAL_PDF_ROOT_CLASS}):not(.${EDITORIAL_PDF_STYLE_CLASS}) {
    display: none;
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} {
    position: static;
    inset: auto;
    display: block;
    width: auto;
    min-height: 0;
    overflow: visible;
    visibility: visible;
    pointer-events: auto;
  }

  .${EDITORIAL_PDF_ROOT_CLASS},
  .${EDITORIAL_PDF_ROOT_CLASS} * {
    box-sizing: border-box;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} {
    color-scheme: only light;
    color: ${palette.bodyInk};
    background: ${palette.paper};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    font-family: "HanMark Pretendard", "Pretendard", "Apple SD Gothic Neo", sans-serif;
    font-size: 9pt;
    line-height: 1.55;
    overflow-wrap: anywhere;
    word-break: keep-all;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover {
    page: hanmark-cover;
    width: 210mm;
    height: 297mm;
    display: grid;
    grid-template-rows: 52% 48%;
    margin: 0;
    padding: 0;
    overflow: hidden;
    break-after: page;
    page-break-after: always;
    background: ${palette.paper};
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-upper {
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 24mm 27mm 18mm;
    color: ${palette.onKey};
    background: ${palette.keySurface};
    text-align: center;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-kicker {
    margin: 0;
    color: inherit;
    font-size: 8pt;
    font-weight: 600;
    line-height: 1;
    letter-spacing: 0.18em;
    text-indent: 0;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-edition {
    margin: 8mm 0 0;
    color: inherit;
    font-size: 11pt;
    font-weight: 600;
    line-height: 1;
    letter-spacing: 0.28em;
    text-indent: 0;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-title {
    width: 100%;
    max-width: 156mm;
    margin: auto 0 0;
    color: inherit;
    font-weight: 700;
    line-height: 1.28;
    letter-spacing: -0.035em;
    text-align: center;
    overflow-wrap: anywhere;
    word-break: keep-all;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-title-line {
    display: block;
    white-space: nowrap;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-subtitle {
    margin: 7mm 0 auto;
    color: inherit;
    font-size: 13pt;
    font-weight: 400;
    line-height: 1.2;
    letter-spacing: 0.015em;
    text-indent: 0;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-lower {
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 24mm 24mm 17mm;
    color: ${palette.keyInk};
    background: ${palette.paper};
    text-align: center;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-brand {
    margin: 0;
    color: inherit;
    font-size: 13pt;
    font-weight: 700;
    line-height: 1.3;
    text-indent: 0;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-system {
    margin: 8mm 0 0;
    color: inherit;
    font-size: 9pt;
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: 0.14em;
    text-indent: 0;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-detail {
    margin: 6mm 0 0;
    color: ${palette.keyMutedInk};
    font-size: 7.5pt;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: 0.08em;
    text-indent: 0;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-tags {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 2.5mm;
    margin-top: 16mm;${customTagRowMinimum}
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-tag {
    display: inline-block;
    padding: 1.3mm 3mm 1.1mm;
    border-radius: 999pt;
    color: ${palette.onKey};
    background: ${palette.keySurface};
    font-size: 7pt;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.04em;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body {
    page: hanmark-body;
    display: block;
    width: 170mm;
    margin: 0;
    padding: 0;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h1,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h2,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h3,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h4,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h5,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h6 {
    color: ${palette.keyInk};
    line-height: 1.25;
    letter-spacing: -0.015em;
    overflow-wrap: anywhere;
    word-break: break-word;
    break-after: avoid-page;
    page-break-after: avoid;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h1 {
    margin: 0 0 6mm;
    font-size: 15pt;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h2 {
    margin: 7mm 0 3mm;
    font-size: 11.5pt;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h3 {
    margin: 5.5mm 0 2.5mm;
    font-size: 9.5pt;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h4,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h5,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h6 {
    margin: 4.5mm 0 2mm;
    font-size: 9pt;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body p {
    margin: 0 0 0.75em;
    text-align: justify;
    text-indent: 1em;
    widows: 3;
    orphans: 3;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body li > p,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body blockquote p,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body aside p,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body th p,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body td p {
    text-indent: 0;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body ol,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body ul {
    margin: 0.35em 0 0.8em;
    padding-inline-start: 2em;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body li {
    margin: 0.18em 0;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body blockquote,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-callout {
    margin: 0.8em 0;
    padding: 0.85em 1.05em;
    border: 0;
    border-radius: 0;
    color: ${palette.onKey};
    background: ${palette.keySurface};
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body blockquote *,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-callout * {
    color: inherit;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-callout-label {
    margin: 0 0 0.4em;
    color: ${palette.accentOnKey};
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body pre,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body table,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body img {
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body pre {
    margin: 0.8em 0;
    padding: 0.95em 1.05em;
    border: 0;
    border-radius: 0;
    color: ${palette.onKey};
    background: ${palette.keySurface};
    font-size: 8.5pt;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    tab-size: 4;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body pre.${EDITORIAL_PDF_CODE_CHUNK_CLASS} {
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body .${EDITORIAL_PDF_SPLITTABLE_CLASS} {
    break-inside: auto;
    page-break-inside: auto;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body pre.${EDITORIAL_PDF_SPLITTABLE_CODE_CLASS},
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body table.${EDITORIAL_PDF_SPLITTABLE_TABLE_CLASS},
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body .${EDITORIAL_PDF_SPLITTABLE_CONTAINER_CLASS} {
    break-inside: auto;
    page-break-inside: auto;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body pre.${EDITORIAL_PDF_SPLITTABLE_CODE_CLASS},
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body .${EDITORIAL_PDF_SPLITTABLE_CONTAINER_CLASS} {
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body code {
    font-family: "SFMono-Regular", Consolas, monospace;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body table {
    width: 100%;
    margin: 0.9em 0;
    border-collapse: collapse;
    font-size: 9pt;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body table thead {
    display: table-header-group;
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body table thead.${EDITORIAL_PDF_SPLITTABLE_TABLE_HEAD_CLASS} {
    break-inside: auto;
    page-break-inside: auto;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body table tbody {
    display: table-row-group;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body table tr {
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body table tr.${EDITORIAL_PDF_SPLITTABLE_TABLE_ROW_CLASS} {
    break-inside: auto;
    page-break-inside: auto;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body th,
  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body td {
    padding: 0.45em 0.55em;
    border: 0.5pt solid ${palette.border};
    vertical-align: top;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body th {
    color: ${palette.onKey};
    background: ${palette.keySurface};
    font-weight: 700;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body tbody tr:nth-child(even) {
    background: ${palette.alternate};
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_CLASS},
  .${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_CONTAINER_FALLBACK_CLASS},
  .${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_CONTAINER_FALLBACK_BODY_CLASS} {
    display: block;
    width: 100%;
    break-inside: auto;
    page-break-inside: auto;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_CLASS} {
    margin: 0.9em 0;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_ROW_CLASS} {
    display: block;
    width: 100%;
    margin: 0 0 0.9em;
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_ROW_CLASS}.${EDITORIAL_PDF_SPLITTABLE_CLASS} {
    break-inside: auto;
    page-break-inside: auto;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_CELL_CLASS} {
    display: block;
    width: 100%;
    margin: 0 0 0.7em;
    break-inside: auto;
    page-break-inside: auto;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_LABEL_CLASS},
  .${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_CONTAINER_FALLBACK_LABEL_CLASS} {
    display: block;
    margin: 0 0 0.35em;
    padding: 0.4em 0.65em;
    color: ${palette.onKey};
    background: ${palette.keySurface};
    font-size: 8pt;
    font-weight: 700;
    line-height: 1.3;
    text-align: left;
    text-indent: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
    break-inside: avoid-page;
    page-break-inside: avoid;
    break-after: avoid-page;
    page-break-after: avoid;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_VALUE_CLASS},
  .${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_CONTAINER_FALLBACK_BODY_CLASS} {
    display: block;
    width: 100%;
    color: ${palette.bodyInk};
    background: ${palette.paper};
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_VALUE_CLASS} > p,
  .${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_CONTAINER_FALLBACK_BODY_CLASS} > p {
    text-indent: 0;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_HEADER_ROW_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_LABEL_CLASS} {
    background: ${fallbackHeaderSurface};
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_CONTAINER_FALLBACK_CLASS} {
    margin: 0.8em 0;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body img {
    display: block;
    max-width: 100%;
    max-height: 225mm;
    height: auto;
    margin: 0.9em auto;
    object-fit: contain;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body a {
    color: ${palette.keyInk};
    text-decoration: underline;
    text-underline-offset: 0.12em;
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body mark {
    background: ${palette.softTint};
  }

  .${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body hr {
    margin: 1.2em 0;
    border: 0;
    border-top: 0.8pt solid ${palette.accentLine};
  }

  /*
   * The PDF tree is mounted under Obsidian's live body and therefore also
   * inherits theme-dark/theme-light and print rules. Keep this isolation
   * block last and more specific than ordinary host-theme selectors so every
   * printable leaf resolves to the fixed HanMark light-paper palette.
   */
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS},
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body {
    color-scheme: only light;
    color: ${palette.bodyInk};
    background: ${palette.paper};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover {
    color-scheme: only light;
    color: ${palette.keyInk};
    background: ${palette.paper};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-upper {
    color: ${palette.onKey};
    background: ${palette.keySurface};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-upper * {
    color: inherit;
    background: transparent;
    text-decoration-color: ${palette.onKey};
    text-shadow: none;
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-lower {
    color: ${palette.keyInk};
    background: ${palette.paper};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-lower * {
    color: inherit;
    background: transparent;
    text-decoration-color: ${palette.keyInk};
    text-shadow: none;
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-detail {
    color: ${palette.keyMutedInk};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-cover-tag {
    color: ${palette.onKey};
    background: ${palette.keySurface};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body p,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body li,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body ol,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body ul,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body span,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body strong,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body em,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body del,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body u,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body sup,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body sub {
    color: inherit;
    background: transparent;
    text-decoration-color: ${palette.bodyInk};
    text-shadow: none;
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_CLASS},
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_ROW_CLASS},
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_CELL_CLASS},
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_VALUE_CLASS},
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_CONTAINER_FALLBACK_CLASS},
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_CONTAINER_FALLBACK_BODY_CLASS} {
    color: ${palette.bodyInk};
    background: ${palette.paper};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_LABEL_CLASS},
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_CONTAINER_FALLBACK_LABEL_CLASS} {
    color: ${palette.onKey};
    background: ${palette.keySurface};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_HEADER_ROW_CLASS} .${EDITORIAL_PDF_TABLE_FALLBACK_LABEL_CLASS} {
    color: ${palette.onKey};
    background: ${fallbackHeaderSurface};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h1,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h2,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h3,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h4,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h5,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body h6 {
    color: ${palette.keyInk};
    background: transparent;
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body li::marker,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body li > span[aria-hidden="true"] {
    color: ${palette.keyMutedInk};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body :not(pre) > code {
    padding: 0.08em 0.28em;
    border: 0.5pt solid ${palette.border};
    border-radius: 0;
    color: ${palette.keyInk};
    background: ${palette.alternate};
    text-shadow: none;
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body pre,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body pre code {
    color: ${palette.onKey};
    background: ${palette.keySurface};
    border-color: transparent;
    text-shadow: none;
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body table,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body thead,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body tbody,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body tr,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body td {
    color: ${palette.bodyInk};
    background: ${palette.paper};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body th {
    border-color: ${palette.border};
    color: ${palette.onKey};
    background: ${palette.keySurface};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body td {
    border-color: ${palette.border};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body tbody tr:nth-child(even),
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body tbody tr:nth-child(even) td {
    color: ${palette.bodyInk};
    background: ${palette.alternate};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body blockquote,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-callout {
    color: ${palette.onKey};
    background: ${palette.keySurface};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body blockquote *,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-callout * {
    color: inherit;
    background: transparent;
    text-decoration-color: ${palette.onKey};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-callout-label {
    color: ${palette.accentOnKey};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body a {
    color: ${palette.keyInk};
    background: transparent;
    text-decoration-color: ${palette.keyInk};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body blockquote a,
  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-callout a {
    color: ${palette.onKey};
    background: transparent;
    text-decoration-color: ${palette.accentOnKey};
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body mark {
    color: ${palette.bodyInk};
    background: ${palette.softTint};
    text-shadow: none;
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body img {
    color: ${palette.bodyInk};
    background: transparent;
    filter: none;
    opacity: 1;
    mix-blend-mode: normal;
  }

  html body.${EDITORIAL_PDF_BODY_CLASS} > section.${EDITORIAL_PDF_ROOT_CLASS} .hanmark-editorial-pdf-body hr {
    color: ${palette.accentLine};
    background: transparent;
    border-color: ${palette.accentLine};
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
        const safeSource = safeEditorialImageUrl(inline.src);
        if (!safeSource) {
          parent.appendChild(ownerDocument.createTextNode(inline.alt || "[image omitted]"));
          break;
        }
        const image = createHtmlElement(ownerDocument, "img");
        image.src = safeSource;
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
        appendInlines(ownerDocument, styled, inline.children, depth + 1);
        parent.appendChild(styled);
        break;
      }
    }
  }
}

function markEditorialPdfSplittable(
  element: HTMLElement,
  dedicatedClass: string
): void {
  element.classList.add(EDITORIAL_PDF_SPLITTABLE_CLASS, dedicatedClass);
}

function appendEditorialPdfCode(
  ownerDocument: Document,
  parent: HTMLElement,
  value: string,
  language?: string
): void {
  const chunks = splitEditorialPdfCodeChunks(value);
  for (const chunk of chunks) {
    const pre = createHtmlElement(ownerDocument, "pre");
    if (chunks.length > 1) {
      pre.classList.add(EDITORIAL_PDF_CODE_CHUNK_CLASS);
    }
    const code = createHtmlElement(ownerDocument, "code");
    if (language) code.setAttribute("data-language", language);
    code.textContent = chunk;
    pre.appendChild(code);
    parent.appendChild(pre);
  }
}

function editorialPdfFallbackColumnLabel(
  header: readonly EditorialInline[][],
  index: number
): string {
  const headerCell = header[index];
  if (!headerCell) return `열 ${index + 1}`;
  const output: string[] = [];
  const stack: EditorialInline[] = [];
  for (let inlineIndex = headerCell.length - 1; inlineIndex >= 0; inlineIndex -= 1) {
    stack.push(headerCell[inlineIndex]);
  }
  while (stack.length > 0) {
    const inline = stack.pop();
    if (!inline) continue;
    switch (inline.type) {
      case "text":
      case "code":
        output.push(inline.value);
        break;
      case "hardbreak":
        output.push(" ");
        break;
      case "image":
        output.push(inline.alt);
        break;
      case "wikilink":
        output.push(inline.label || inline.target);
        break;
      case "link":
      case "styled":
        for (
          let childIndex = inline.children.length - 1;
          childIndex >= 0;
          childIndex -= 1
        ) {
          stack.push(inline.children[childIndex]);
        }
        break;
    }
  }
  const label = output.join("")
    .replace(/\s+/gu, " ")
    .trim();
  return truncateEditorialPdfFallbackLabel(label, `열 ${index + 1}`);
}

export function truncateEditorialPdfFallbackLabel(
  value: string,
  fallback: string
): string {
  const label = value.replace(/\s+/gu, " ").trim();
  if (!label) return fallback;
  const parts = graphemes(label);
  if (parts.length <= EDITORIAL_PDF_FALLBACK_LABEL_MAX_GRAPHEMES) {
    return label;
  }
  return `${
    parts.slice(0, EDITORIAL_PDF_FALLBACK_LABEL_MAX_GRAPHEMES).join("")
  }…`;
}

export function estimateEditorialPdfFallbackRowRows(
  cells: readonly EditorialInline[][],
  stopAfterRows = EDITORIAL_PDF_TABLE_PAGE_BUDGET_ROWS
): number {
  const safeLimit = Math.max(1, Math.floor(stopAfterRows));
  let totalRows = 0;
  for (const cell of cells) {
    // The fallback stacks cells vertically. Include a compact label row and
    // spacing for each cell instead of reusing the native table's max-cell
    // height, which would badly underestimate a wide fallback record.
    totalRows += 2;
    totalRows += estimateEditorialPdfTextRows(
      editorialPdfInlineVisibleText(cell),
      EDITORIAL_PDF_FALLBACK_COLUMNS,
      safeLimit - Math.min(totalRows, safeLimit)
    );
    if (totalRows > safeLimit) return safeLimit + 1;
  }
  return totalRows;
}

function appendEditorialPdfFallbackRow(
  ownerDocument: Document,
  parent: HTMLElement,
  cells: readonly EditorialInline[][],
  header: readonly EditorialInline[][],
  depth: number,
  options: { headerRow: boolean; oversized: boolean }
): void {
  const row = createHtmlElement(ownerDocument, "div");
  row.classList.add(EDITORIAL_PDF_TABLE_FALLBACK_ROW_CLASS);
  if (options.headerRow) {
    row.classList.add(EDITORIAL_PDF_TABLE_FALLBACK_HEADER_ROW_CLASS);
  }
  if (options.oversized) {
    row.classList.add(EDITORIAL_PDF_SPLITTABLE_CLASS);
  }

  for (let index = 0; index < cells.length; index += 1) {
    const cell = createHtmlElement(ownerDocument, "div");
    cell.className = EDITORIAL_PDF_TABLE_FALLBACK_CELL_CLASS;
    const label = createHtmlElement(ownerDocument, "p");
    label.className = EDITORIAL_PDF_TABLE_FALLBACK_LABEL_CLASS;
    label.textContent = options.headerRow
      ? `열 ${index + 1} 제목`
      : editorialPdfFallbackColumnLabel(header, index);
    const value = createHtmlElement(ownerDocument, "div");
    value.className = EDITORIAL_PDF_TABLE_FALLBACK_VALUE_CLASS;
    appendInlines(ownerDocument, value, cells[index], depth + 1);
    cell.appendChild(label);
    cell.appendChild(value);
    row.appendChild(cell);
  }
  parent.appendChild(row);
}

function appendEditorialPdfNormalTable(
  ownerDocument: Document,
  parent: HTMLElement,
  header: readonly EditorialInline[][],
  rows: readonly EditorialInline[][][],
  depth: number
): void {
  const table = createHtmlElement(ownerDocument, "table");
  const tableBlock: EditorialTableBlock = {
    type: "table",
    header: [...header],
    rows: [...rows]
  };
  if (
    estimateEditorialPdfTableRows(tableBlock) >
    EDITORIAL_PDF_TABLE_SPLIT_THRESHOLD_ROWS
  ) {
    markEditorialPdfSplittable(
      table,
      EDITORIAL_PDF_SPLITTABLE_TABLE_CLASS
    );
  }
  if (header.length > 0) {
    const tableHead = createHtmlElement(ownerDocument, "thead");
    const row = createHtmlElement(ownerDocument, "tr");
    for (const cell of header) {
      const heading = createHtmlElement(ownerDocument, "th");
      appendInlines(ownerDocument, heading, cell, depth + 1);
      row.appendChild(heading);
    }
    tableHead.appendChild(row);
    table.appendChild(tableHead);
  }
  const tableBody = createHtmlElement(ownerDocument, "tbody");
  for (const bodyRow of rows) {
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
}

function appendEditorialPdfTable(
  ownerDocument: Document,
  parent: HTMLElement,
  block: EditorialTableBlock,
  depth: number
): void {
  const columnCount = editorialPdfTableColumnCount(block);
  const headerRows = block.header.length > 0
    ? estimateEditorialPdfTableRowRows(
        block.header,
        columnCount,
        EDITORIAL_PDF_TABLE_PAGE_BUDGET_ROWS
      )
    : 0;
  const headerIsOversized =
    block.header.length > 0 &&
    headerRows >
      EDITORIAL_PDF_TABLE_ROW_SPLIT_THRESHOLD_ROWS;
  const useVerticalFallback =
    headerIsOversized ||
    columnCount > EDITORIAL_PDF_NATIVE_TABLE_MAX_COLUMNS;

  if (useVerticalFallback) {
    const fallback = createHtmlElement(ownerDocument, "section");
    fallback.className = EDITORIAL_PDF_TABLE_FALLBACK_CLASS;
    if (block.header.length > 0) {
      appendEditorialPdfFallbackRow(
        ownerDocument,
        fallback,
        block.header,
        block.header,
        depth,
        {
          headerRow: true,
          oversized:
            estimateEditorialPdfFallbackRowRows(block.header) >
            EDITORIAL_PDF_TABLE_PAGE_BUDGET_ROWS
        }
      );
    }
    for (const bodyRow of block.rows) {
      appendEditorialPdfFallbackRow(
        ownerDocument,
        fallback,
        bodyRow,
        block.header,
        depth,
        {
          headerRow: false,
          oversized:
            estimateEditorialPdfFallbackRowRows(bodyRow) >
            EDITORIAL_PDF_TABLE_PAGE_BUDGET_ROWS
        }
      );
    }
    parent.appendChild(fallback);
    return;
  }

  let normalRows: EditorialInline[][][] = [];
  let headerHasRendered = false;
  const flushNormalRows = (): void => {
    if (normalRows.length === 0) return;
    appendEditorialPdfNormalTable(
      ownerDocument,
      parent,
      block.header,
      normalRows,
      depth
    );
    normalRows = [];
    headerHasRendered = block.header.length > 0;
  };

  for (const bodyRow of block.rows) {
    const bodyRowRows = estimateEditorialPdfTableRowRows(
      bodyRow,
      columnCount,
      EDITORIAL_PDF_TABLE_PAGE_BUDGET_ROWS
    );
    const rowIsOversized =
      bodyRowRows > EDITORIAL_PDF_TABLE_ROW_SPLIT_THRESHOLD_ROWS ||
      headerRows + bodyRowRows >
        EDITORIAL_PDF_TABLE_PAGE_BUDGET_ROWS;
    if (!rowIsOversized) {
      normalRows.push(bodyRow);
      continue;
    }
    flushNormalRows();
    const fallback = createHtmlElement(ownerDocument, "section");
    fallback.className = EDITORIAL_PDF_TABLE_FALLBACK_CLASS;
    if (!headerHasRendered && block.header.length > 0) {
      appendEditorialPdfFallbackRow(
        ownerDocument,
        fallback,
        block.header,
        block.header,
        depth,
        {
          headerRow: true,
          oversized:
            estimateEditorialPdfFallbackRowRows(block.header) >
            EDITORIAL_PDF_TABLE_PAGE_BUDGET_ROWS
        }
      );
      headerHasRendered = true;
    }
    appendEditorialPdfFallbackRow(
      ownerDocument,
      fallback,
      bodyRow,
      block.header,
      depth,
      { headerRow: false, oversized: true }
    );
    parent.appendChild(fallback);
  }
  flushNormalRows();
  if (block.rows.length === 0) {
    appendEditorialPdfNormalTable(
      ownerDocument,
      parent,
      block.header,
      [],
      depth
    );
  }
}

function appendEditorialPdfContainerFallback(
  ownerDocument: Document,
  parent: HTMLElement,
  labelText: string,
  blocks: readonly EditorialBlock[],
  depth: number
): void {
  const container = createHtmlElement(ownerDocument, "section");
  container.className = EDITORIAL_PDF_CONTAINER_FALLBACK_CLASS;
  const label = createHtmlElement(ownerDocument, "p");
  label.className = EDITORIAL_PDF_CONTAINER_FALLBACK_LABEL_CLASS;
  label.textContent = truncateEditorialPdfFallbackLabel(
    labelText,
    "내용"
  );
  const body = createHtmlElement(ownerDocument, "div");
  body.className = EDITORIAL_PDF_CONTAINER_FALLBACK_BODY_CLASS;
  appendBlocks(ownerDocument, body, blocks, depth + 1);
  container.appendChild(label);
  container.appendChild(body);
  parent.appendChild(container);
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
        appendEditorialPdfTable(ownerDocument, parent, block, depth);
        break;
      }
      case "quote": {
        if (
          estimateEditorialPdfContainerRows(block.blocks) >
          EDITORIAL_PDF_CONTAINER_SPLIT_THRESHOLD_ROWS
        ) {
          appendEditorialPdfContainerFallback(
            ownerDocument,
            parent,
            "인용",
            block.blocks,
            depth
          );
          break;
        }
        const quote = createHtmlElement(ownerDocument, "blockquote");
        appendBlocks(ownerDocument, quote, block.blocks, depth + 1);
        parent.appendChild(quote);
        break;
      }
      case "callout": {
        if (
          estimateEditorialPdfContainerRows(block.blocks) >
          EDITORIAL_PDF_CONTAINER_SPLIT_THRESHOLD_ROWS
        ) {
          appendEditorialPdfContainerFallback(
            ownerDocument,
            parent,
            block.kind,
            block.blocks,
            depth
          );
          break;
        }
        const callout = createHtmlElement(ownerDocument, "aside");
        callout.className = "hanmark-editorial-pdf-callout";
        const label = createHtmlElement(ownerDocument, "p");
        label.className = "hanmark-editorial-pdf-callout-label";
        label.textContent = truncateEditorialPdfFallbackLabel(
          block.kind,
          "CALLOUT"
        );
        callout.appendChild(label);
        appendBlocks(ownerDocument, callout, block.blocks, depth + 1);
        parent.appendChild(callout);
        break;
      }
      case "code": {
        appendEditorialPdfCode(
          ownerDocument,
          parent,
          block.value,
          block.language
        );
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
  fileTitle: string,
  renderTheme?: EditorialPdfRenderTheme
): HTMLElement {
  const theme = renderTheme?.resolved.theme ?? BUILTIN_EDITORIAL_PDF_THEME;
  const root = createHtmlElement(ownerDocument, "section");
  // Obsidian's host print stylesheet hides every direct body child that does
  // not carry its reserved `print` class. Without this class the native print
  // dialog opens normally but receives an empty document.
  root.className =
    `${EDITORIAL_PDF_ROOT_CLASS} ${EDITORIAL_PDF_OBSIDIAN_PRINT_CLASS}`;

  const cover = createHtmlElement(ownerDocument, "section");
  cover.className = "hanmark-editorial-pdf-cover";

  const coverUpper = createHtmlElement(ownerDocument, "div");
  coverUpper.className = "hanmark-editorial-pdf-cover-upper";
  const coverKicker = createHtmlElement(ownerDocument, "p");
  coverKicker.className = "hanmark-editorial-pdf-cover-kicker";
  coverKicker.textContent = theme.cover.kicker;
  coverUpper.appendChild(coverKicker);
  const coverEdition = createHtmlElement(ownerDocument, "p");
  coverEdition.className = "hanmark-editorial-pdf-cover-edition";
  coverEdition.textContent = theme.cover.edition;
  coverUpper.appendChild(coverEdition);

  const coverTitleText = resolveEditorialPdfModeText(
    theme.cover.titleMode,
    theme.cover.titleText,
    fileTitle
  );
  const titleLayout = coverTitleText
    ? balanceEditorialPdfCoverTitle(coverTitleText)
    : { lines: [""], fontSizePt: 30 };
  const coverTitle = createHtmlElement(ownerDocument, "h1");
  coverTitle.className = "hanmark-editorial-pdf-cover-title";
  coverTitle.style.fontSize = `${titleLayout.fontSizePt}pt`;
  for (const line of titleLayout.lines) {
    const titleLine = createHtmlElement(ownerDocument, "span");
    titleLine.className = "hanmark-editorial-pdf-cover-title-line";
    titleLine.textContent = line;
    coverTitle.appendChild(titleLine);
  }
  coverUpper.appendChild(coverTitle);
  const coverSubtitle = createHtmlElement(ownerDocument, "p");
  coverSubtitle.className = "hanmark-editorial-pdf-cover-subtitle";
  coverSubtitle.textContent = theme.cover.subtitle;
  coverUpper.appendChild(coverSubtitle);
  cover.appendChild(coverUpper);

  const coverLower = createHtmlElement(ownerDocument, "div");
  coverLower.className = "hanmark-editorial-pdf-cover-lower";
  const coverBrand = createHtmlElement(ownerDocument, "p");
  coverBrand.className = "hanmark-editorial-pdf-cover-brand";
  coverBrand.textContent = theme.cover.brand;
  coverLower.appendChild(coverBrand);
  const coverSystem = createHtmlElement(ownerDocument, "p");
  coverSystem.className = "hanmark-editorial-pdf-cover-system";
  coverSystem.textContent = theme.cover.system;
  coverLower.appendChild(coverSystem);
  const coverDetail = createHtmlElement(ownerDocument, "p");
  coverDetail.className = "hanmark-editorial-pdf-cover-detail";
  coverDetail.textContent = theme.cover.detail;
  coverLower.appendChild(coverDetail);
  const coverTags = createHtmlElement(ownerDocument, "div");
  coverTags.className = "hanmark-editorial-pdf-cover-tags";
  for (const tag of theme.cover.tags) {
    const chip = createHtmlElement(ownerDocument, "span");
    chip.className = "hanmark-editorial-pdf-cover-tag";
    chip.textContent = tag;
    coverTags.appendChild(chip);
  }
  coverLower.appendChild(coverTags);
  cover.appendChild(coverLower);
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

function editorialPdfRemainingTimeout(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function waitForEditorialPdfPromise<T>(
  operation: Promise<T>,
  view: Window,
  deadline: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const remaining = editorialPdfRemainingTimeout(deadline);
    if (remaining <= 0) {
      reject(new Error(`Timed out waiting for ${label}.`));
      return;
    }

    let settled = false;
    const timeout = view.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Timed out waiting for ${label}.`));
    }, remaining);
    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        view.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        view.clearTimeout(timeout);
        reject(
          error instanceof Error
            ? error
            : new Error("Print asset preparation failed.")
        );
      }
    );
  });
}

function waitForEditorialPdfAnimationFrame(
  view: Window,
  deadline: number,
  label: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const remaining = editorialPdfRemainingTimeout(deadline);
    if (remaining <= 0) {
      reject(new Error(`Timed out waiting for ${label}.`));
      return;
    }

    let settled = false;
    let frame = 0;
    const timeout = view.setTimeout(() => {
      if (settled) return;
      settled = true;
      if (typeof view.cancelAnimationFrame === "function") {
        view.cancelAnimationFrame(frame);
      }
      reject(new Error(`Timed out waiting for ${label}.`));
    }, remaining);
    frame = view.requestAnimationFrame(() => {
      if (settled) return;
      settled = true;
      view.clearTimeout(timeout);
      resolve();
    });
  });
}

function editorialPdfStylesheetReady(style: HTMLStyleElement): boolean {
  const candidate = style as HTMLStyleElement &
    EditorialPdfStyleElementLike;
  if (candidate.isConnected === false || candidate.parentNode === null) {
    return false;
  }
  if (!candidate.sheet) return false;
  try {
    return (candidate.sheet.cssRules?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

async function waitForEditorialPdfStylesheet(
  style: HTMLStyleElement,
  view: Window,
  deadline: number
): Promise<void> {
  while (!editorialPdfStylesheetReady(style)) {
    await waitForEditorialPdfAnimationFrame(
      view,
      deadline,
      "the print stylesheet"
    );
  }
}

function editorialPdfFontFacesLoaded(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (
    typeof value === "object" &&
    value !== null &&
    "length" in value
  ) {
    const length = (value as { length?: unknown }).length;
    return typeof length === "number" && length > 0;
  }
  return false;
}

async function waitForEditorialPdfFonts(
  fonts: FontFaceSetLike,
  view: Window,
  deadline: number
): Promise<void> {
  if (typeof fonts.load !== "function") {
    throw new Error("The print document cannot verify its embedded fonts.");
  }

  while (true) {
    const loadedFaces = await Promise.all(
      EDITORIAL_PDF_FONT_PROBES.map((font) =>
        waitForEditorialPdfPromise(
          fonts.load?.(font, EDITORIAL_PDF_FONT_PROBE_TEXT) ??
            Promise.resolve([]),
          view,
          deadline,
          `${font} font`
        )
      )
    );
    if (loadedFaces.every(editorialPdfFontFacesLoaded)) break;
    await waitForEditorialPdfAnimationFrame(
      view,
      deadline,
      "the embedded print fonts"
    );
  }

  await Promise.all(
    EDITORIAL_PDF_FALLBACK_FONT_PROBES.map((font) =>
      waitForEditorialPdfPromise(
        fonts.load?.(font, EDITORIAL_PDF_FALLBACK_FONT_PROBE_TEXT) ??
          Promise.resolve([]),
        view,
        deadline,
        `${font} fallback font`
      )
    )
  );

  await waitForEditorialPdfPromise(
    fonts.ready,
    view,
    deadline,
    "the print font set"
  );
}

export async function waitForEditorialPdfAssets(
  ownerDocument: Document,
  root: HTMLElement,
  timeoutMs = DEFAULT_ASSET_TIMEOUT_MS,
  style?: HTMLStyleElement
): Promise<void> {
  const view = ownerDocument.defaultView;
  if (!view) throw new Error("The print document has no active window.");
  const deadline = Date.now() + Math.max(1, timeoutMs);

  if (style) {
    await waitForEditorialPdfStylesheet(style, view, deadline);
  }

  // The embedded HanMark face intentionally contains Latin glyphs only.
  // Lay out the hidden subtree with the real print stack first so Chromium
  // registers the Korean system fallback before `fonts.ready` is observed.
  primeEditorialPdfPrintLayout(root, view);

  const fonts = (ownerDocument as Document & { fonts?: FontFaceSetLike }).fonts;
  if (!fonts) throw new Error("The print document has no font set.");
  await waitForEditorialPdfFonts(fonts, view, deadline);

  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map(async (image) => {
    try {
      if (typeof image.decode === "function") {
        await waitForEditorialPdfPromise(
          image.decode(),
          view,
          deadline,
          `image ${image.alt || "untitled image"}`
        );
      } else if (!image.complete) {
        await waitForEventImage(
          image,
          editorialPdfRemainingTimeout(deadline),
          view
        );
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

export async function waitForEditorialPdfLayout(
  root: HTMLElement,
  view: Window,
  timeoutMs = DEFAULT_ASSET_TIMEOUT_MS
): Promise<void> {
  const deadline = Date.now() + Math.max(1, timeoutMs);
  await waitForEditorialPdfAnimationFrame(
    view,
    deadline,
    "the first print layout frame"
  );
  await waitForEditorialPdfAnimationFrame(
    view,
    deadline,
    "the second print layout frame"
  );
  root.getBoundingClientRect();
}

export function primeEditorialPdfPrintLayout(
  root: HTMLElement,
  view: Window
): void {
  let cover: HTMLElement | null = null;
  let body: HTMLElement | null = null;
  try {
    cover = root.querySelector<HTMLElement>(
      ".hanmark-editorial-pdf-cover"
    );
    body = root.querySelector<HTMLElement>(
      ".hanmark-editorial-pdf-body"
    );
  } catch {
    return;
  }

  for (const element of [root, cover, body]) {
    if (!element) continue;
    try {
      const computed = view.getComputedStyle(element);
      void computed.display;
      void computed.fontFamily;
      void computed.fontWeight;
      void computed.backgroundColor;
      void computed.getPropertyValue("page");
    } catch {
      // Priming is a best-effort safeguard; print must never be cancelled by
      // a transient computed-style failure from the host runtime.
    }
    try {
      const bounds = element.getBoundingClientRect();
      void bounds.width;
      void bounds.height;
      void bounds.top;
      void bounds.left;
    } catch {
      // Geometry priming is likewise non-fatal during `beforeprint`.
    }
  }
}

function editorialPdfUnsupportedMessage(support: EditorialPdfRuntimeSupport): string {
  if (support.chromiumMajor === null) {
    return `Achmage Editorial PDF requires Chromium ${support.minimum} or newer, but this Obsidian runtime could not be identified.`;
  }
  return `Achmage Editorial PDF requires Chromium ${support.minimum} or newer. This Obsidian runtime uses Chromium ${support.chromiumMajor}.`;
}

export function createEditorialPdfStageError(
  stage: EditorialPdfStage,
  cause: unknown
): Error {
  const safeName = safeEditorialPdfErrorName(cause);
  const error = new Error(
    `Editorial PDF ${stage} 단계에서 실패했습니다. (${safeName})`
  );
  Object.defineProperty(error, "cause", {
    configurable: true,
    value: cause
  });
  return error;
}

function safeEditorialPdfErrorName(cause: unknown): string {
  if ((typeof cause !== "object" && typeof cause !== "function") || cause === null) {
    return "UnknownError";
  }
  try {
    const name = (cause as { name?: unknown }).name;
    return typeof name === "string" && SAFE_EDITORIAL_PDF_ERROR_NAMES.has(name)
      ? name
      : "Error";
  } catch {
    return "Error";
  }
}

function sweepEditorialPdfArtifacts(ownerDocument: Document): void {
  const selector =
    `.${EDITORIAL_PDF_ROOT_CLASS}, .${EDITORIAL_PDF_STYLE_CLASS}`;
  for (const container of [ownerDocument.head, ownerDocument.body]) {
    if (!container) continue;
    const artifacts = container.querySelectorAll(selector);
    for (const artifact of Array.from(artifacts)) {
      artifact.remove();
    }
  }

  if (
    ownerDocument.body &&
    !ownerDocument.body.querySelector(`.${EDITORIAL_PDF_ROOT_CLASS}`)
  ) {
    ownerDocument.body?.classList.remove(EDITORIAL_PDF_BODY_CLASS);
  }
}

function runEditorialPdfStage<T>(
  stage: EditorialPdfStage,
  operation: () => T
): T {
  try {
    return operation();
  } catch (error) {
    throw createEditorialPdfStageError(stage, error);
  }
}

async function runEditorialPdfStageAsync<T>(
  stage: EditorialPdfStage,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw createEditorialPdfStageError(stage, error);
  }
}

export class EditorialPdfService {
  private activeCleanup: (() => void) | null = null;
  private printInProgress = false;

  async print(request: EditorialPdfRequest): Promise<HanmarkExportOutcome> {
    if (this.printInProgress) {
      throw new Error(
        "PDF 내보내기가 이미 진행 중입니다. 현재 인쇄 작업이 끝난 뒤 다시 시도하세요."
      );
    }

    this.dispose();
    this.printInProgress = true;

    try {
      const view = request.window ?? request.document?.defaultView ?? window;
      const ownerDocument = request.document ?? view.document;
      const support = getEditorialPdfRuntimeSupport(
        view.navigator.userAgent,
        request.chromiumMajor
      );
      if (!support.supported) {
        throw new Error(editorialPdfUnsupportedMessage(support));
      }

      sweepEditorialPdfArtifacts(ownerDocument);

      const fileTitle = normalizedFileTitle(request.fileName);
      const editorial = runEditorialPdfStage(
        "Markdown 파싱",
        () => parseEditorialDocument(request.markdown, fileTitle)
      );
      const prepared = runEditorialPdfStage("인쇄 트리 생성", () => {
        const renderTheme = prepareEditorialPdfRenderTheme(request.theme);
        const style = createHtmlElement(ownerDocument, "style");
        style.className = EDITORIAL_PDF_STYLE_CLASS;
        style.textContent = createEditorialPdfStyles(fileTitle, renderTheme);
        const root = buildEditorialPdfRoot(
          ownerDocument,
          editorial,
          fileTitle,
          renderTheme
        );
        return { root, style };
      });
      const { root, style } = prepared;

      runEditorialPdfStage("호스트 DOM 연결", () => {
        try {
          ownerDocument.head.appendChild(style);
          ownerDocument.body.appendChild(root);
          ownerDocument.body.classList.add(EDITORIAL_PDF_BODY_CLASS);
        } catch (error) {
          root.remove();
          style.remove();
          if (!ownerDocument.querySelector(`.${EDITORIAL_PDF_ROOT_CLASS}`)) {
            ownerDocument.body.classList.remove(EDITORIAL_PDF_BODY_CLASS);
          }
          throw error;
        }
      });

      let cleaned = false;
      let watchdog: number | undefined;
      let delayedCleanup: number | undefined;
      const primePrintLayout = (): void => {
        primeEditorialPdfPrintLayout(root, view);
      };
      const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        if (watchdog) view.clearTimeout(watchdog);
        if (delayedCleanup) view.clearTimeout(delayedCleanup);
        view.removeEventListener("beforeprint", primePrintLayout);
        view.removeEventListener("afterprint", schedulePostPrintCleanup);
        view.removeEventListener("error", cleanup);
        view.removeEventListener("beforeunload", cleanup);
        root.remove();
        style.remove();
        if (!ownerDocument.querySelector(`.${EDITORIAL_PDF_ROOT_CLASS}`)) {
          ownerDocument.body.classList.remove(EDITORIAL_PDF_BODY_CLASS);
        }
        if (this.activeCleanup === cleanup) this.activeCleanup = null;
      };
      const schedulePostPrintCleanup = (): void => {
        if (cleaned || delayedCleanup) return;
        delayedCleanup = view.setTimeout(cleanup, POST_PRINT_CLEANUP_DELAY_MS);
      };
      this.activeCleanup = cleanup;
      view.addEventListener("beforeprint", primePrintLayout, {
        once: true
      });
      view.addEventListener("afterprint", schedulePostPrintCleanup, {
        once: true
      });
      view.addEventListener("error", cleanup, { once: true });
      view.addEventListener("beforeunload", cleanup, { once: true });
      watchdog = view.setTimeout(
        cleanup,
        request.watchdogMs ?? DEFAULT_WATCHDOG_MS
      );

      try {
        await runEditorialPdfStageAsync(
          "글꼴·이미지 대기",
          () => waitForEditorialPdfAssets(
            ownerDocument,
            root,
            request.assetTimeoutMs ?? DEFAULT_ASSET_TIMEOUT_MS,
            style
          )
        );
        await runEditorialPdfStageAsync(
          "페이지 조판",
          () => waitForEditorialPdfLayout(
            root,
            view,
            request.assetTimeoutMs ?? DEFAULT_ASSET_TIMEOUT_MS
          )
        );
        runEditorialPdfStage("인쇄 호출", () => view.print());
        return {
          format: "pdf",
          status: "delegated"
        };
      } catch (error) {
        cleanup();
        throw error;
      }
    } finally {
      this.printInProgress = false;
    }
  }

  dispose(): void {
    this.activeCleanup?.();
  }
}
