import { App, Notice, TFile, normalizePath } from "obsidian";
import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { parse, detectFormat, VERSION } from "kordoc";
import type { HwpSourceContract, HwpSourceFormat } from "./frontmatter";
import { renderSourceCallout } from "./sourceCallout";
import { sha256Bytes } from "./hash";

const KORDOC_VERSION: string = (VERSION as unknown as string) || "3.0.1";
const IMPORT_EXTENSIONS = ["hwp", "hwpx", "hwpml", "docx", "pdf", "xlsx", "xls"];
const KNOWN_FORMATS = new Set<string>(["hwpx", "hwp", "hwp3", "hwpml", "docx", "pdf", "xlsx", "xls"]);

/** Native Electron open dialog (returns an absolute path), with a <input type=file> fallback. */
function pickFile(): Promise<string | null> {
  try {
    const req: any = (window as any).require;
    const dialog =
      req?.("@electron/remote")?.dialog ??
      req?.("electron")?.remote?.dialog ??
      req?.("electron")?.dialog;
    if (dialog?.showOpenDialog) {
      return dialog
        .showOpenDialog({
          title: "한글/문서 불러오기",
          properties: ["openFile"],
          filters: [
            { name: "한글·문서", extensions: IMPORT_EXTENSIONS },
            { name: "모든 파일", extensions: ["*"] }
          ]
        })
        .then((r: any) => (r?.canceled || !r?.filePaths?.length ? null : r.filePaths[0]));
    }
  } catch {
    /* fall through to <input type=file> */
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMPORT_EXTENSIONS.map((e) => "." + e).join(",");
    input.addEventListener("change", () => {
      const f: any = input.files?.[0];
      if (!f) return resolve(null);
      let p: string | null = f.path || null;
      if (!p) {
        try {
          p = (window as any).require("electron").webUtils.getPathForFile(f);
        } catch {
          p = null;
        }
      }
      resolve(p);
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

async function uniqueNotePath(app: App, folder: string, base: string): Promise<string> {
  const dir = folder ? folder + "/" : "";
  let rel = normalizePath(`${dir}${base}.md`);
  let i = 1;
  while (app.vault.getAbstractFileByPath(rel)) rel = normalizePath(`${dir}${base} (${i++}).md`);
  return rel;
}

/**
 * 불러오기 — open any kordoc-supported document, convert to Markdown, deliver it as
 * a new note in the vault with the source contract recorded in frontmatter.
 */
export async function importDocument(app: App, _plugin?: any): Promise<void> {
  const absPath = await pickFile();
  if (!absPath) return;

  const progress = new Notice("문서를 변환하는 중…", 0);
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
    const rel = await uniqueNotePath(app, preferredFolder(app), base);

    const noteBody = renderSourceCallout(contract) + res.markdown.trim() + "\n";
    const file = (await app.vault.create(rel, noteBody)) as TFile;
    await app.fileManager.processFrontMatter(file, (fm: any) => Object.assign(fm, contract));
    await app.workspace.getLeaf(true).openFile(file);

    const warn = Array.isArray(res.warnings) && res.warnings.length ? ` (경고 ${res.warnings.length}건)` : "";
    new Notice(`불러오기 완료: ${rel}${warn}`);
  } catch (e: any) {
    new Notice(`불러오기 실패: ${e?.message || String(e)}`);
    console.error("[hwp-writer] import failed:", e);
  } finally {
    progress.hide();
  }
}
