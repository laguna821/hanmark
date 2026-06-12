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
  "hwp-source-format": HwpSourceFormat; // routing key: hwpx|hwp -> patch, else -> generate
  "hwp-source-hash": string; // "sha256:…" of original bytes at import time
  "hwp-source-bytes": number; // original byte length (cheap pre-check)
  "hwp-imported-at": string; // ISO-8601 import timestamp
  "hwp-kordoc": string; // kordoc version that produced the markdown
}

/** Read the source contract from a note's frontmatter, or null if absent/incomplete. */
export function readSourceContract(app: App, file: TFile): HwpSourceContract | null {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm) return null;
  const src = fm["hwp-source"];
  const fmt = fm["hwp-source-format"];
  if (typeof src !== "string" || !src || typeof fmt !== "string" || !fmt) return null;
  return {
    "hwp-source": src,
    "hwp-source-format": fmt as HwpSourceFormat,
    "hwp-source-hash": String(fm["hwp-source-hash"] ?? ""),
    "hwp-source-bytes": Number(fm["hwp-source-bytes"] ?? 0),
    "hwp-imported-at": String(fm["hwp-imported-at"] ?? ""),
    "hwp-kordoc": String(fm["hwp-kordoc"] ?? "")
  };
}

/** Remove a leading YAML frontmatter block (--- … ---). */
export function stripFrontmatter(md: string): string {
  const m = md.match(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
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
