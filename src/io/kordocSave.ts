import { App, MarkdownView, Modal, Notice, TFile, normalizePath } from "obsidian";
import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { patchHwpx, patchHwp, validateHwpx } from "kordoc";
import { type HwpSourceContract, readSourceContract, extractEditableBody } from "./frontmatter";
import { sha256Bytes } from "./hash";
import { HwpSaveReportModal } from "./HwpSaveReportModal";
import { adaptMarkdownForKordoc } from "./markdownAdapter";
import { generateValidatedHwpxFromAdapted, type GeneratedHwpx } from "./kordocEngine";
import type { HanmarkKordocExportOptions } from "./exportTypes";
import { activeTableProfile } from "./tableStyle";
import { ImageResolutionError, type ImageFailure, type ImageProgress } from "./imageAssets";
import { createObsidianImageLoader } from "./obsidianImageLoader";
import { activeDocumentStyle } from "./documentStyleSettings";

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function toBuffer(out: any): Buffer {
  if (Buffer.isBuffer(out)) return out;
  if (out instanceof Uint8Array) return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  if (out instanceof ArrayBuffer) return Buffer.from(new Uint8Array(out));
  return Buffer.from(out?.buffer ?? out);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function uniqueFsPath(dir: string, stem: string, suffix: string, ext = ".hwpx"): Promise<string> {
  const base = `${stem}_${suffix}_${stamp()}`;
  let path = nodePath.join(dir, `${base}${ext}`);
  let index = 1;
  while (await pathExists(path)) path = nodePath.join(dir, `${base}_${index++}${ext}`);
  return path;
}

function confirm(app: App, title: string, message: string, yesText: string, noText: string): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const modal = new Modal(app);
    modal.titleEl.setText(title);
    message.split("\n").forEach((line) => modal.contentEl.createEl("p", { text: line }));
    const row = modal.contentEl.createDiv();
    row.setCssStyles({ marginTop: "12px" });
    const yes = row.createEl("button", { text: yesText });
    yes.classList.add("mod-cta");
    yes.onclick = () => {
      finish(true);
      modal.close();
    };
    const no = row.createEl("button", { text: noText });
    no.setCssStyles({ marginLeft: "8px" });
    no.onclick = () => {
      finish(false);
      modal.close();
    };
    modal.onClose = () => finish(false);
    modal.open();
  });
}

async function readActiveBody(app: App): Promise<{ file: TFile; body: string } | null> {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  const file = view?.file;
  if (!file) {
    new Notice("마크다운 노트를 열고 내보내세요.");
    return null;
  }
  const body = extractEditableBody(view.editor.getValue() || (await app.vault.read(file)));
  if (!body.trim()) {
    new Notice("내보낼 내용이 없습니다.");
    return null;
  }
  return { file, body };
}

async function generateBody(
  app: App,
  file: TFile,
  body: string,
  plugin: any,
  options: HanmarkKordocExportOptions,
  allowImageFailures = false,
  onImageProgress?: (progress: ImageProgress) => void
): Promise<GeneratedHwpx> {
  const adapted = adaptMarkdownForKordoc(body);
  return generateValidatedHwpxFromAdapted(adapted, {
    profile: activeTableProfile(plugin),
    gongmun:
      options.mode === "gongmun-hwpx"
        ? { preset: options.gongmunPreset ?? "report" }
        : undefined,
    documentStyle: options.mode === "quick-hwpx" ? activeDocumentStyle(plugin) : undefined,
    images: {
      loader: createObsidianImageLoader(app, file),
      allowFailures: allowImageFailures,
      onProgress: onImageProgress
    }
  });
}

function warningNote(result: GeneratedHwpx): string {
  const parts = [`Kordoc 구조 검증 완료 (${result.validation.entryCount}개 ZIP 항목)`];
  if (result.documentStyleName) parts.push(`문서 스타일 적용: ${result.documentStyleName}`);
  if (result.embeddedImageCount) {
    parts.push(
      `이미지 ${result.embeddedImageCount}개 포함${
        result.embeddedImageOccurrences > result.embeddedImageCount
          ? ` (${result.embeddedImageOccurrences}곳 배치)`
          : ""
      }`
    );
  }
  if (result.imageFailures.length) parts.push(`이미지 ${result.imageFailures.length}개 누락 표시`);
  for (const item of result.warnings) parts.push(`${item.message}${item.count > 1 ? ` (${item.count}건)` : ""}`);
  return parts.join(" · ");
}

type ImageFailureAction = "retry" | "continue" | "cancel";

function chooseImageFailureAction(app: App, failures: ImageFailure[]): Promise<ImageFailureAction> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (action: ImageFailureAction) => {
      if (done) return;
      done = true;
      resolve(action);
    };
    const modal = new Modal(app);
    modal.titleEl.setText(`이미지 ${failures.length}개를 포함하지 못했습니다`);
    modal.contentEl.createEl("p", {
      text: "네트워크 또는 파일 경로를 확인한 뒤 다시 시도하거나, 누락 위치를 안내 텍스트로 바꾸어 계속할 수 있습니다."
    });
    const list = modal.contentEl.createEl("ul");
    failures.slice(0, 10).forEach((failure) => {
      list.createEl("li", { text: `${failure.alt || failure.source || "이미지"}: ${failure.message}` });
    });
    if (failures.length > 10) modal.contentEl.createEl("p", { text: `외 ${failures.length - 10}개` });
    const row = modal.contentEl.createDiv();
    row.setCssStyles({ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" });
    const retry = row.createEl("button", { text: "다시 시도" });
    retry.classList.add("mod-cta");
    retry.onclick = () => {
      finish("retry");
      modal.close();
    };
    const continueButton = row.createEl("button", { text: "누락 표시로 계속" });
    continueButton.onclick = () => {
      finish("continue");
      modal.close();
    };
    const cancel = row.createEl("button", { text: "취소" });
    cancel.onclick = () => {
      finish("cancel");
      modal.close();
    };
    modal.onClose = () => finish("cancel");
    modal.open();
  });
}

/** Default no-setup export. This compatibility function remains callable by older command IDs. */
export async function saveDocument(app: App, plugin?: any): Promise<void> {
  await exportKordocHwpx(app, plugin, { mode: "quick-hwpx" });
}

export async function exportKordocHwpx(
  app: App,
  plugin: any,
  options: HanmarkKordocExportOptions
): Promise<boolean> {
  const context = await readActiveBody(app);
  if (!context) return false;
  const progress = new Notice("Kordoc 4.2.5로 HWPX를 생성하고 검증하는 중…", 0);
  try {
    let result: GeneratedHwpx;
    let allowImageFailures = false;
    while (true) {
      try {
        result = await generateBody(
          app,
          context.file,
          context.body,
          plugin,
          options,
          allowImageFailures,
          (imageProgress) => {
            progress.setMessage(
              `이미지 불러오는 중 ${imageProgress.completed}/${imageProgress.total} · ${
                imageProgress.status === "embedded" ? "포함 준비" : "실패"
              }`
            );
          }
        );
        break;
      } catch (error) {
        if (!(error instanceof ImageResolutionError)) throw error;
        progress.setMessage("일부 이미지를 포함하지 못했습니다.");
        const action = await chooseImageFailureAction(app, error.failures);
        if (action === "cancel") return false;
        allowImageFailures = action === "continue";
        progress.setMessage(action === "retry" ? "이미지를 다시 불러오는 중…" : "누락 위치를 표시하고 HWPX를 만드는 중…");
      }
    }
    progress.setMessage("HWPX 구조를 검증하고 저장하는 중…");

    const contract = readSourceContract(app, context.file);
    if (contract) {
      const original = contract["hwp-source"];
      const dir = nodePath.dirname(original);
      const stem = nodePath.basename(original, nodePath.extname(original));
      const suffix = options.mode === "gongmun-hwpx" ? "공문서" : "변환";
      const outputPath = await uniqueFsPath(dir, stem, suffix);
      await fs.writeFile(outputPath, toBuffer(result.data));
      new HwpSaveReportModal(app, {
        title: options.mode === "gongmun-hwpx" ? "저장 완료 — 공문서 HWPX" : "저장 완료 — 빠른 HWPX",
        outputPath,
        note: `원본은 그대로 두고 새 파일을 만들었습니다. ${warningNote(result)}`
      }).open();
    } else {
      const folder = context.file.parent?.path && context.file.parent.path !== "/" ? `${context.file.parent.path}/` : "";
      const suffix = options.mode === "gongmun-hwpx" ? " 공문서" : "";
      let relative = normalizePath(`${folder}${context.file.basename}${suffix}.hwpx`);
      let index = 1;
      while (app.vault.getAbstractFileByPath(relative)) {
        relative = normalizePath(`${folder}${context.file.basename}${suffix} (${index++}).hwpx`);
      }
      await app.vault.createBinary(relative, result.data);
      new Notice(
        `HWPX 저장 완료: ${relative}${result.embeddedImageCount ? ` · 이미지 ${result.embeddedImageCount}개 포함` : ""}`
      );
      if (result.warnings.length || result.embeddedImageCount) {
        new HwpSaveReportModal(app, {
          title: "저장 완료 — 변환 안내",
          note: warningNote(result),
          outputPath: revealPathFor(app, relative)
        }).open();
      }
    }
    return true;
  } catch (error: any) {
    new Notice(`HWPX 내보내기 실패: ${error?.message || String(error)}`);
    console.error("[hanmark] kordoc export failed:", error);
    return false;
  } finally {
    progress.hide();
  }
}

function revealPathFor(app: App, relative: string): string | undefined {
  try {
    const adapter: any = app.vault.adapter;
    const base = adapter?.basePath || adapter?.getBasePath?.() || "";
    return base ? nodePath.join(base, relative) : undefined;
  } catch {
    return undefined;
  }
}

/** Source-format-preserving patch. Kept under the old exported name for command compatibility. */
export async function patchSourceExperimental(app: App, plugin?: any): Promise<void> {
  const context = await readActiveBody(app);
  if (!context) return;
  const contract = readSourceContract(app, context.file);
  const format = contract?.["hwp-source-format"];
  if (!contract || (format !== "hwpx" && format !== "hwp")) {
    new Notice("원본 형식 보존은 HWP/HWPX에서 불러온 노트에만 사용할 수 있습니다.");
    return;
  }
  try {
    await patchSource(app, context.file, contract, context.body, plugin);
  } catch (error: any) {
    new Notice(`원본 형식 보존 실패: ${error?.message || String(error)}`);
    console.error("[hanmark] source patch failed:", error);
  }
}

async function patchSource(
  app: App,
  file: TFile,
  contract: HwpSourceContract,
  body: string,
  plugin: any
): Promise<void> {
  const sourcePath = contract["hwp-source"];
  let original: Buffer;
  try {
    original = await fs.readFile(sourcePath);
  } catch {
    const generate = await confirm(
      app,
      "원본 파일을 찾을 수 없습니다",
      `기록된 원본 경로가 존재하지 않습니다:\n${sourcePath}\n\n대신 새 HWPX로 저장할까요?`,
      "새 HWPX로 저장",
      "취소"
    );
    if (generate) await exportKordocHwpx(app, plugin, { mode: "quick-hwpx" });
    return;
  }

  const expectedHash = (contract["hwp-source-hash"] || "").replace(/^sha256:/, "");
  const sizeMismatch = contract["hwp-source-bytes"] > 0 && original.byteLength !== contract["hwp-source-bytes"];
  if (expectedHash && (sha256Bytes(original) !== expectedHash || sizeMismatch)) {
    const generate = await confirm(
      app,
      "원본이 변경되었습니다",
      `불러온 뒤 원본 파일이 디스크에서 바뀌었습니다:\n${sourcePath}\n\n충돌을 피하기 위해 패치를 중단합니다. 새 HWPX로 저장할까요?`,
      "새 HWPX로 저장",
      "취소"
    );
    if (generate) await exportKordocHwpx(app, plugin, { mode: "quick-hwpx" });
    return;
  }

  const sourceBytes = new Uint8Array(original.buffer, original.byteOffset, original.byteLength);
  const patch = contract["hwp-source-format"] === "hwpx" ? patchHwpx : patchHwp;
  const result: any = await patch(sourceBytes, body, { verify: true });
  if (!result || result.success === false || !result.data) {
    new HwpSaveReportModal(app, {
      title: "원본 형식 보존 실패 — 원본은 그대로입니다",
      applied: result?.applied ?? 0,
      skipped: result?.skipped ?? [],
      note: result?.error || "문단·표 구조가 크게 바뀌었거나 암호화된 문서는 패치할 수 없습니다.",
      generateFull: () => generateFullBeside(app, file, sourcePath, body, plugin)
    }).open();
    return;
  }

  if (contract["hwp-source-format"] === "hwpx") {
    const validation = await validateHwpx(result.data);
    if (!validation.ok) {
      new HwpSaveReportModal(app, {
        title: "패치 결과 검증 실패 — 파일을 저장하지 않았습니다",
        applied: result.applied ?? 0,
        skipped: result.skipped ?? [],
        note: validation.issues.map((issue) => issue.message).join(" / ")
      }).open();
      return;
    }
  }

  const dir = nodePath.dirname(sourcePath);
  const ext = nodePath.extname(sourcePath);
  const stem = nodePath.basename(sourcePath, ext);
  const outputPath = await uniqueFsPath(dir, stem, "수정", ext);
  await fs.writeFile(outputPath, toBuffer(result.data));

  new HwpSaveReportModal(app, {
    title: "저장 완료 — 원본 형식 보존",
    applied: result.applied ?? 0,
    skipped: result.skipped ?? [],
    verification: result.verification,
    outputPath,
    note: "원본 파일은 그대로 두고 수정본만 새로 만들었습니다. 중복 원본 백업은 생성하지 않았습니다.",
    generateFull: () => generateFullBeside(app, file, sourcePath, body, plugin)
  }).open();
}

async function generateFullBeside(app: App, file: TFile, originalPath: string, body: string, plugin: any): Promise<string> {
  const generated = await generateBody(app, file, body, plugin, { mode: "quick-hwpx" });
  const dir = nodePath.dirname(originalPath);
  const stem = nodePath.basename(originalPath, nodePath.extname(originalPath));
  const outputPath = await uniqueFsPath(dir, stem, "전체내용");
  await fs.writeFile(outputPath, toBuffer(generated.data));
  return outputPath;
}
