import type { App, TFile } from "obsidian";

/** kordoc-supported source formats we record in the note's frontmatter. */
export type HwpSourceFormat =
  | "hwpx"
  | "hwp"
  | "hwp3"
  | "hwpml"
  | "docx"
  | "pdf"
  | "xlsx"
  | "xls";

/**
 * The "source contract" — written by 불러오기, read by the 저장 router.
 * Keys are stable; do not rename (the router depends on them).
 */
export interface HwpSourceContract {
  "hwp-source": string; // original absolute path (forward-slash normalized)
  /**
   * SHA-keyed copy held in HanMark's private plugin cache. Optional so notes
   * imported by HanMark 2.4.2 and earlier continue to open unchanged.
   */
  "hwp-source-cache"?: string;
  "hwp-source-format": HwpSourceFormat; // routing key: hwpx|hwp -> patch, else -> generate
  "hwp-source-hash": string; // "sha256:…" of original bytes at import time
  "hwp-source-bytes": number; // original byte length (cheap pre-check)
  "hwp-imported-at": string; // ISO-8601 import timestamp
  "hwp-kordoc": string; // kordoc version that produced the markdown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSourceFormat(value: unknown): value is HwpSourceFormat {
  return (
    value === "hwpx" ||
    value === "hwp" ||
    value === "hwp3" ||
    value === "hwpml" ||
    value === "docx" ||
    value === "pdf" ||
    value === "xlsx" ||
    value === "xls"
  );
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Read the source contract from a note's frontmatter, or null if absent/incomplete. */
export function readSourceContract(app: App, file: TFile): HwpSourceContract | null {
  const raw: unknown = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!isRecord(raw)) return null;
  const fm = raw;
  const src = fm["hwp-source"];
  const fmt = fm["hwp-source-format"];
  if (typeof src !== "string" || !src || !isSourceFormat(fmt)) return null;
  return {
    "hwp-source": src,
    "hwp-source-cache": typeof fm["hwp-source-cache"] === "string"
      ? fm["hwp-source-cache"]
      : undefined,
    "hwp-source-format": fmt,
    "hwp-source-hash": stringValue(fm["hwp-source-hash"]),
    "hwp-source-bytes": numberValue(fm["hwp-source-bytes"]),
    "hwp-imported-at": stringValue(fm["hwp-imported-at"]),
    "hwp-kordoc": stringValue(fm["hwp-kordoc"])
  };
}

/** Remove a leading YAML frontmatter block (--- … ---). */
interface LeadingFrontmatter {
  bodyOffset: number;
  hasOpeningDelimiter: boolean;
}

function leadingFrontmatter(md: string): LeadingFrontmatter {
  const bomOffset = md.startsWith("\uFEFF") ? 1 : 0;
  const firstLineEnd = md.indexOf("\n", bomOffset);
  const firstLine = md
    .slice(bomOffset, firstLineEnd === -1 ? md.length : firstLineEnd)
    .replace(/\r$/, "");

  if (!/^---[ \t]*$/.test(firstLine)) {
    return { bodyOffset: bomOffset, hasOpeningDelimiter: false };
  }

  if (firstLineEnd === -1) {
    return { bodyOffset: -1, hasOpeningDelimiter: true };
  }

  let lineStart = firstLineEnd + 1;
  while (lineStart <= md.length) {
    const lineEnd = md.indexOf("\n", lineStart);
    const line = md
      .slice(lineStart, lineEnd === -1 ? md.length : lineEnd)
      .replace(/\r$/, "");
    if (/^(?:---|\.\.\.)[ \t]*$/.test(line)) {
      return {
        bodyOffset: lineEnd === -1 ? md.length : lineEnd + 1,
        hasOpeningDelimiter: true
      };
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }

  return { bodyOffset: -1, hasOpeningDelimiter: true };
}

export function stripFrontmatter(md: string): string {
  const result = leadingFrontmatter(md);
  return result.bodyOffset >= 0 && result.hasOpeningDelimiter
    ? md.slice(result.bodyOffset)
    : md;
}

/**
 * Remove a leading YAML block for an external converter.
 *
 * Unlike `stripFrontmatter`, this fails closed when a note starts a YAML block
 * without closing it. Passing that malformed metadata to Pandoc produces an
 * opaque YAML parser error and, before HanMark 2.4.4, soft-line normalization
 * could merge its keys into an invalid single line.
 */
export function stripFrontmatterStrict(md: string): string {
  const result = leadingFrontmatter(md);
  if (result.hasOpeningDelimiter && result.bodyOffset < 0) {
    throw new Error(
      "문서 맨 앞의 YAML 속성 영역이 닫히지 않았습니다. 닫는 구분선(---)을 추가한 뒤 다시 내보내세요."
    );
  }
  return md.slice(result.bodyOffset);
}

/**
 * Remove the injected `> [!hwp-source] …` callout (a contiguous run of blockquote
 * lines) plus one trailing blank line. Leaves the user's real body intact.
 */
export function stripSourceCallout(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let fenceMarker = "";
  while (i < lines.length) {
    const fence = lines[i].match(/^\s*(`{3,}|~{3,})/)?.[1] ?? "";
    if (fence) {
      if (!fenceMarker) fenceMarker = fence[0];
      else if (fence[0] === fenceMarker) fenceMarker = "";
      out.push(lines[i]);
      i++;
      continue;
    }
    if (fenceMarker) {
      out.push(lines[i]);
      i++;
      continue;
    }
    if (/^>\s*\[!hwp-source\]/i.test(lines[i])) {
      i++;
      while (i < lines.length && /^>/.test(lines[i])) i++;
      if (i < lines.length && lines[i].trim() === "") i++;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

/**
 * The body text to feed kordoc patch/generate: note content minus the frontmatter
 * and the injected source callout. (Both would corrupt patch unit alignment.)
 */
export function extractEditableBody(raw: string): string {
  return stripSourceCallout(stripFrontmatter(raw)).replace(/^\s+/, "");
}

/**
 * Strict body extraction for DOCX and other external converters.
 *
 * A UTF-8 BOM, the source contract, and HanMark's generated source callout are
 * removed before any Markdown line normalization runs.
 */
export function extractEditableBodyStrict(raw: string): string {
  return stripSourceCallout(stripFrontmatterStrict(raw)).replace(/^\s+/, "");
}
