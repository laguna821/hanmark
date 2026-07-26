import { App, Modal, Notice, TFile, normalizePath } from "obsidian";
import { parse, detectFormat, VERSION } from "kordoc";
import type { HwpSourceContract, HwpSourceFormat } from "./frontmatter";
import { renderSourceCallout } from "./sourceCallout";
import { sha256Bytes } from "./hash";
import { BulkImportReportModal } from "./BulkImportReportModal";
import { persistImportedImages } from "./importImages";
import {
  bytesAsArrayBuffer,
  createFileGateway,
  splitFilename,
  type FileGateway,
  type SelectedExternalFile
} from "./fileGateway";

const KORDOC_VERSION = typeof VERSION === "string" ? VERSION : "4.2.5";
const IMPORT_EXTENSIONS = ["hwp", "hwpx", "hwpml", "docx", "pdf", "xlsx", "xls"];
const KNOWN_FORMATS = new Set<string>([
  "hwpx",
  "hwp",
  "hwp3",
  "hwpml",
  "docx",
  "pdf",
  "xlsx",
  "xls"
]);
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

/** Prefer Kordoc's magic-byte detection; fall back to the file extension. */
function resolveFormat(buffer: ArrayBuffer, extension: string): HwpSourceFormat {
  try {
    const detected = String(detectFormat(buffer) || "").toLowerCase();
    if (KNOWN_FORMATS.has(detected)) return detected as HwpSourceFormat;
  } catch {
    // Fall back to the selected file's extension.
  }
  const normalized = extension.replace(/^\./, "").toLowerCase();
  if (KNOWN_FORMATS.has(normalized)) return normalized as HwpSourceFormat;
  return "hwpx";
}

function preferredFolder(app: App): string {
  const path = app.workspace.getActiveFile()?.parent?.path;
  return path && path !== "/" ? path : "";
}

/**
 * Resolve a free note path. `reserved` holds paths already claimed by sibling imports running
 * in parallel — vault.create is async so getAbstractFileByPath alone would race.
 */
function uniqueNotePath(app: App, folder: string, base: string, reserved: Set<string>): string {
  const directory = folder ? `${folder}/` : "";
  let relative = normalizePath(`${directory}${base}.md`);
  let index = 1;
  while (app.vault.getAbstractFileByPath(relative) || reserved.has(relative)) {
    relative = normalizePath(`${directory}${base} (${index++}).md`);
  }
  reserved.add(relative);
  return relative;
}

/** Convert one selected document to a note without direct filesystem access. */
async function importOne(
  app: App,
  selected: SelectedExternalFile,
  gateway: FileGateway,
  reserved: Set<string>
): Promise<ImportResult> {
  try {
    const arrayBuffer = bytesAsArrayBuffer(selected.bytes);
    const parsedName = splitFilename(selected.name);
    const format = resolveFormat(arrayBuffer, parsedName.extension);
    const result = await parse(arrayBuffer);
    if (result.success === false) {
      throw new Error(result.error || "문서를 파싱하지 못했습니다.");
    }

    const digest = sha256Bytes(selected.bytes);
    const cacheId = await gateway.cacheSource(selected.bytes, {
      hash: digest,
      byteLength: selected.bytes.byteLength,
      sourceName: selected.name
    });
    const contract: HwpSourceContract = {
      "hwp-source": (selected.displayPath || selected.name).replace(/\\/g, "/"),
      "hwp-source-cache": cacheId,
      "hwp-source-format": format,
      "hwp-source-hash": `sha256:${digest}`,
      "hwp-source-bytes": selected.bytes.byteLength,
      "hwp-imported-at": new Date().toISOString(),
      "hwp-kordoc": KORDOC_VERSION
    };

    const base = parsedName.stem
      .replace(/[\\/:*?"<>|#^[\]]/g, "_")
      .trim() || "불러온 문서";
    const relative = uniqueNotePath(app, preferredFolder(app), base, reserved);
    const persisted = await persistImportedImages(
      app,
      relative,
      result.markdown.trim(),
      result.images
    );
    const noteBody = renderSourceCallout(contract) + persisted.markdown.trim() + "\n";
    const file = await app.vault.create(relative, noteBody);
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      Object.assign(frontmatter, contract);
    });

    const warnings = (result.warnings?.length ?? 0) + persisted.warnings.length;
    return { ok: true, rel: relative, warnings, images: persisted.saved };
  } catch (error) {
    return {
      ok: false,
      file: selected.name,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/** Run `worker` over `items` with at most `limit` in flight at once. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const runner = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
}

/** Confirm before a large bulk import. Resolves false on cancel/close. */
function confirmBulk(app: App, count: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const modal = new Modal(app);
    modal.titleEl.setText("여러 파일 불러오기");
    modal.contentEl.createEl("p", {
      text: `${count}개 파일을 변환해 각각 새 노트로 만듭니다. 계속할까요?`
    });
    const row = modal.contentEl.createDiv();
    row.setCssStyles({ marginTop: "12px" });
    const yes = row.createEl("button", { text: `네, ${count}개 변환` });
    yes.classList.add("mod-cta");
    yes.onclick = () => {
      finish(true);
      modal.close();
    };
    const no = row.createEl("button", { text: "취소" });
    no.setCssStyles({ marginLeft: "8px" });
    no.onclick = () => {
      finish(false);
      modal.close();
    };
    modal.onClose = () => finish(false);
    modal.open();
  });
}

/**
 * Pick one or many Kordoc-supported documents and convert each to a Markdown note.
 * The browser File API supplies bytes; absolute paths are never opened by HanMark.
 */
export async function importDocument(app: App, plugin?: unknown): Promise<void> {
  const gateway = createFileGateway(app, plugin);
  const selectedFiles = await gateway.pickFiles({
    title: "한글·문서 불러오기 (여러 개 선택 가능)",
    extensions: IMPORT_EXTENSIONS,
    multiple: true
  });
  if (!selectedFiles.length) return;
  const reserved = new Set<string>();

  if (selectedFiles.length === 1) {
    const progress = new Notice("문서를 변환하는 중…", 0);
    try {
      const result = await importOne(app, selectedFiles[0], gateway, reserved);
      if (result.ok) {
        const file = app.vault.getAbstractFileByPath(result.rel ?? "");
        if (file instanceof TFile) await app.workspace.getLeaf(true).openFile(file);
        new Notice(
          `불러오기 완료: ${result.rel}${
            result.images ? ` · 이미지 ${result.images}개 저장` : ""
          }${result.warnings ? ` (경고 ${result.warnings}건)` : ""}`
        );
      } else {
        new Notice(`불러오기 실패: ${result.error}`);
      }
    } finally {
      progress.hide();
    }
    return;
  }

  if (
    selectedFiles.length >= BULK_CONFIRM_THRESHOLD &&
    !(await confirmBulk(app, selectedFiles.length))
  ) return;

  const limit = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
  const progress = new Notice(`변환 중 0/${selectedFiles.length}…`, 0);
  const results: ImportResult[] = [];
  let done = 0;
  try {
    await runPool(selectedFiles, limit, async (selected, index) => {
      results[index] = await importOne(app, selected, gateway, reserved);
      done++;
      progress.setMessage(`변환 중 ${done}/${selectedFiles.length}…`);
    });
  } finally {
    progress.hide();
  }

  const succeeded = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  const warned = succeeded.filter((result) => (result.warnings ?? 0) > 0);
  new Notice(`불러오기: ✅ ${succeeded.length} · ⚠️ ${warned.length} · ❌ ${failed.length}`);
  if (failed.length || warned.length) new BulkImportReportModal(app, { results }).open();
}
