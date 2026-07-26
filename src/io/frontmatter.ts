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
export function stripFrontmatter(md: string): string {
  const m = md.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? md.slice(m[0].length) : md;
}

/**
 * Remove the injected `> [!hwp-source] …` callout (a contiguous run of blockquote
 * lines) plus one trailing blank line. Leaves the user's real body intact.
 */
export function stripSourceCallout(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
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
