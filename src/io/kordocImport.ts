import { App, Modal, Notice, TFile, normalizePath } from "obsidian";
import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { parse, detectFormat, VERSION } from "kordoc";
import type { HwpSourceContract, HwpSourceFormat } from "./frontmatter";
import { renderSourceCallout } from "./sourceCallout";
import { sha256Bytes } from "./hash";
import { BulkImportReportModal } from "./BulkImportReportModal";
import { persistImportedImages } from "./importImages";

const KORDOC_VERSION: string = (VERSION as unknown as string) || "4.2.5";
const IMPORT_EXTENSIONS = ["hwp", "hwpx", "hwpml", "docx", "pdf", "xlsx", "xls"];
const KNOWN_FORMATS = new Set<string>(["hwpx", "hwp", "hwp3", "hwpml", "docx", "pdf", "xlsx", "xls"]);
/** Ask for confirmation before bulk-converting at least this many files. */
const BULK_CONFIRM_THRESHOLD = 25;

/** Result of converting one document — a created note (ok) or a captured failure. */
export interface ImportResult {
  ok: boolean;
  rel?: string;
  warnings?: number;
  images?: number;
  file?: string;
  error?: string;
}

/** Native Electron open dialog with multi-select, falling back to a <input type=file multiple>. */
function pickFiles(): Promise<string[]> {
  try {
    const req: any = (window as any).require;
    const dialog =
      req?.("@electron/remote")?.dialog ??
      req?.("electron")?.remote?.dialog ??
      req?.("electron")?.dialog;
    if (dialog?.showOpenDialog) {
      return dialog
        .showOpenDialog({
          title: "한글/문서 불러오기 (여러 개 선택 가능)",
          properties: ["openFile", "multiSelections"],
          filters: [
            { name: "한글·문서", extensions: IMPORT_EXTENSIONS },
            { name: "모든 파일", extensions: ["*"] }
          ]
        })
        .then((r: any) => (r?.canceled || !r?.filePaths?.length ? [] : (r.filePaths as string[])));
    }
  } catch {
    /* fall through to <input type=file> */
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = IMPORT_EXTENSIONS.map((e) => "." + e).join(",");
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []) as any[];
      const paths: string[] = [];
      for (const f of files) {
        let p: string | null = f.path || null;
        if (!p) {
          try {
            p = (window as any).require("electron").webUtils.getPathForFile(f);
          } catch {
            p = null;
          }
        }
        if (p) paths.push(p);
      }
      resolve(paths);
    });
    input.click();
  });
}

/** Prefer kordoc's magic-byte detection; fall back to the file extension. */
function resolveFormat(ab: ArrayBuffer, ext: string): HwpSourceFormat {
  try {
    const d = String(detectFormat(ab) || "").toLowerCase();
    if (KNOWN_FORMATS.has(d)) return d as HwpSourceFormat;
  } catch {
    /* ignore — fall back to extension */
  }
  const e = ext.replace(/^\./, "").toLowerCase();
  if (KNOWN_FORMATS.has(e)) return e as HwpSourceFormat;
  return "hwpx";
}

function preferredFolder(app: App): string {
  const p = app.workspace.getActiveFile()?.parent?.path;
  return p && p !== "/" ? p : "";
}

/**
 * Resolve a free note path. `reserved` holds paths already claimed by sibling imports running
 * in parallel — vault.create is async so getAbstractFileByPath alone would race; we also reserve
 * the path synchronously the moment it's chosen.
 */
function uniqueNotePath(app: App, folder: string, base: string, reserved: Set<string>): string {
  const dir = folder ? folder + "/" : "";
  let rel = normalizePath(`${dir}${base}.md`);
  let i = 1;
  while (app.vault.getAbstractFileByPath(rel) || reserved.has(rel)) {
    rel = normalizePath(`${dir}${base} (${i++}).md`);
  }
  reserved.add(rel);
  return rel;
}

/** Convert ONE document to a note. Never throws — failures are returned as { ok:false }. */
async function importOne(app: App, absPath: string, reserved: Set<string>): Promise<ImportResult> {
  const fileName = nodePath.basename(absPath);
  try {
    const buf = await fs.readFile(absPath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const format = resolveFormat(ab, nodePath.extname(absPath));
    const res: any = await parse(ab);
    if (!res || res.success === false || typeof res.markdown !== "string") {
      throw new Error(res?.error || "문서를 파싱하지 못했습니다.");
    }

    const contract: HwpSourceContract = {
      "hwp-source": absPath.replace(/\\/g, "/"),
      "hwp-source-format": format,
      "hwp-source-hash": "sha256:" + sha256Bytes(buf),
      "hwp-source-bytes": buf.byteLength,
      "hwp-imported-at": new Date().toISOString(),
      "hwp-kordoc": KORDOC_VERSION
    };

    const base =
      nodePath
        .basename(absPath, nodePath.extname(absPath))
        .replace(/[\\/:*?"<>|#^[\]]/g, "_")
        .trim() || "불러온 문서";
    const rel = uniqueNotePath(app, preferredFolder(app), base, reserved);

    const persisted = await persistImportedImages(app, rel, res.markdown.trim(), res.images);
    const noteBody = renderSourceCallout(contract) + persisted.markdown.trim() + "\n";
    const file = (await app.vault.create(rel, noteBody)) as TFile;
    await app.fileManager.processFrontMatter(file, (fm: any) => Object.assign(fm, contract));

    const warnings = (Array.isArray(res.warnings) ? res.warnings.length : 0) + persisted.warnings.length;
    return { ok: true, rel, warnings, images: persisted.saved };
  } catch (e: any) {
    console.error("[hwp-writer] import failed:", absPath, e);
    return { ok: false, file: fileName, error: e?.message || String(e) };
  }
}

/** Run `worker` over `items` with at most `limit` in flight at once. */
async function runPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const runner = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
}

/** Confirm before a large bulk import. Resolves false on cancel/close. */
function confirmBulk(app: App, count: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const m = new Modal(app);
    m.titleEl.setText("여러 파일 불러오기");
    m.contentEl.createEl("p", { text: `${count}개 파일을 변환해 각각 새 노트로 만듭니다. 계속할까요?` });
    const row = m.contentEl.createDiv();
    row.setCssStyles({ marginTop: "12px" });
    const yes = row.createEl("button", { text: `네, ${count}개 변환` });
    yes.classList.add("mod-cta");
    yes.onclick = () => {
      finish(true);
      m.close();
    };
    const no = row.createEl("button", { text: "취소" });
    no.setCssStyles({ marginLeft: "8px" });
    no.onclick = () => {
      finish(false);
      m.close();
    };
    m.onClose = () => finish(false);
    m.open();
  });
}

function revealPathFor(app: App, rel: string): string | undefined {
  try {
    const adapter: any = app.vault.adapter;
    const base: string = adapter?.basePath || adapter?.getBasePath?.() || "";
    return base ? nodePath.join(base, rel) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 불러오기 — pick one or many kordoc-supported documents and convert each to a Markdown note.
 * A single pick opens the note (unchanged behavior); multiple picks convert in a bounded-
 * concurrency pool, report progress, and surface a hybrid summary (Notice + modal on issues).
 */
export async function importDocument(app: App, _plugin?: any): Promise<void> {
  const paths = await pickFiles();
  if (!paths.length) return;
  const reserved = new Set<string>();

  // Single file — keep the original UX (convert, open, notify).
  if (paths.length === 1) {
    const progress = new Notice("문서를 변환하는 중…", 0);
    try {
      const r = await importOne(app, paths[0], reserved);
      if (r.ok) {
        const file = app.vault.getAbstractFileByPath(r.rel);
        if (file instanceof TFile) await app.workspace.getLeaf(true).openFile(file);
        new Notice(
          `불러오기 완료: ${r.rel}${r.images ? ` · 이미지 ${r.images}개 저장` : ""}${
            r.warnings ? ` (경고 ${r.warnings}건)` : ""
          }`
        );
      } else {
        new Notice(`불러오기 실패: ${r.error}`);
      }
    } finally {
      progress.hide();
    }
    return;
  }

  // Multiple files — confirm if large, then convert in parallel with a progress notice.
  if (paths.length >= BULK_CONFIRM_THRESHOLD && !(await confirmBulk(app, paths.length))) return;

  const limit = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
  const progress = new Notice(`변환 중 0/${paths.length}…`, 0);
  const results: ImportResult[] = new Array(paths.length);
  let done = 0;
  try {
    await runPool(paths, limit, async (p, i) => {
      results[i] = await importOne(app, p, reserved);
      done++;
      progress.setMessage(`변환 중 ${done}/${paths.length}…`);
    });
  } finally {
    progress.hide();
  }

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const warned = ok.filter((r) => (r.warnings ?? 0) > 0);
  new Notice(`불러오기: ✅ ${ok.length} · ⚠️ ${warned.length} · ❌ ${failed.length}`);

  if (failed.length || warned.length) {
    const revealPath = ok.length ? revealPathFor(app, ok[0].rel ?? "") : undefined;
    new BulkImportReportModal(app, { results, revealPath }).open();
  }
}
