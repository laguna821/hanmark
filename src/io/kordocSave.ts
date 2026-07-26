import {
  App,
  MarkdownView,
  Modal,
  Notice,
  Platform,
  TFile,
  normalizePath,
  type Plugin
} from "obsidian";
import { patchHwpx, patchHwp, validateHwpx, type PatchResult } from "kordoc";
import {
  type HwpSourceContract,
  readSourceContract,
  extractEditableBody
} from "./frontmatter";
import { HwpSaveReportModal } from "./HwpSaveReportModal";
import { adaptMarkdownForKordoc } from "./markdownAdapter";
import {
  generateValidatedHwpxFromAdapted,
  type GeneratedHwpx
} from "./kordocEngine";
import type {
  HanmarkExportOutcome,
  HanmarkKordocExportOptions
} from "./exportTypes";
import { activeTableProfile } from "./tableStyle";
import {
  ImageResolutionError,
  type ImageFailure,
  type ImageProgress
} from "./imageAssets";
import { createObsidianImageLoader } from "./obsidianImageLoader";
import { activeDocumentStyle } from "./documentStyleSettings";
import {
  bytesAsArrayBuffer,
  createFileGateway,
  filenameFromDisplayPath,
  safeSuggestedName,
  sourceBytesMatchContract,
  splitFilename,
  type FileGateway,
  type SavedFileResult
} from "./fileGateway";
import type { TemplateLibraryHost } from "./templateLibrary";

interface HanmarkPluginIdentity extends TemplateLibraryHost {
  manifest?: Pick<Plugin["manifest"], "id">;
}

const TRANSIENT_TEMPLATE_HOST: TemplateLibraryHost = {
  settings: {},
  saveSettings: async () => {}
};

function templateHost(
  plugin: HanmarkPluginIdentity | undefined
): TemplateLibraryHost {
  return plugin ?? TRANSIENT_TEMPLATE_HOST;
}

function runtimePlatform(): NodeJS.Platform {
  if (Platform.isWin) return "win32";
  if (Platform.isMacOS) return "darwin";
  return "linux";
}

function stamp(): string {
  const date = new Date();
  const twoDigits = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}${twoDigits(date.getMonth() + 1)}${twoDigits(
    date.getDate()
  )}_${twoDigits(date.getHours())}${twoDigits(date.getMinutes())}${twoDigits(
    date.getSeconds()
  )}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint"
  ) return `${error}`;
  return "알 수 없는 오류";
}

function asUint8Array(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function suffixedName(
  sourceName: string,
  suffix: string,
  extensionOverride?: string
): string {
  const { stem, extension } = splitFilename(sourceName);
  const outputExtension = extensionOverride ?? (extension || ".hwpx");
  return safeSuggestedName(`${stem}_${suffix}_${stamp()}${outputExtension}`);
}

function confirm(
  app: App,
  title: string,
  message: string,
  yesText: string,
  noText: string
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: boolean): void => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const modal = new Modal(app);
    modal.titleEl.setText(title);
    for (const line of message.split("\n")) modal.contentEl.createEl("p", { text: line });
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
  plugin: HanmarkPluginIdentity | undefined,
  options: HanmarkKordocExportOptions,
  allowImageFailures = false,
  onImageProgress?: (progress: ImageProgress) => void
): Promise<GeneratedHwpx> {
  const adapted = adaptMarkdownForKordoc(body);
  return generateValidatedHwpxFromAdapted(adapted, {
    profile: activeTableProfile(templateHost(plugin)),
    gongmun:
      options.mode === "gongmun-hwpx"
        ? { preset: options.gongmunPreset ?? "report" }
        : undefined,
    documentStyle:
      options.mode === "quick-hwpx"
        ? activeDocumentStyle(templateHost(plugin))
        : undefined,
    fontResolver: { platform: runtimePlatform() },
    images: {
      loader: createObsidianImageLoader(app, file),
      allowFailures: allowImageFailures,
      onProgress: onImageProgress
    }
  });
}

function warningNote(result: GeneratedHwpx): string {
  const parts = [
    `Kordoc 구조 검증 완료 (${result.validation.entryCount}개 ZIP 항목)`
  ];
  if (result.documentStyleName) {
    parts.push(`문서 스타일 적용: ${result.documentStyleName}`);
  }
  if (result.embeddedImageCount) {
    parts.push(
      `이미지 ${result.embeddedImageCount}개 포함${
        result.embeddedImageOccurrences > result.embeddedImageCount
          ? ` (${result.embeddedImageOccurrences}곳 배치)`
          : ""
      }`
    );
  }
  if (result.imageFailures.length) {
    parts.push(`이미지 ${result.imageFailures.length}개 누락 표시`);
  }
  for (const item of result.warnings) {
    parts.push(`${item.message}${item.count > 1 ? ` (${item.count}건)` : ""}`);
  }
  return parts.join(" · ");
}

type ImageFailureAction = "retry" | "continue" | "cancel";

function chooseImageFailureAction(
  app: App,
  failures: ImageFailure[]
): Promise<ImageFailureAction> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (action: ImageFailureAction): void => {
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
    for (const failure of failures.slice(0, 10)) {
      list.createEl("li", {
        text: `${failure.alt || failure.source || "이미지"}: ${failure.message}`
      });
    }
    if (failures.length > 10) {
      modal.contentEl.createEl("p", { text: `외 ${failures.length - 10}개` });
    }
    const row = modal.contentEl.createDiv();
    row.setCssStyles({
      display: "flex",
      gap: "8px",
      flexWrap: "wrap",
      marginTop: "12px"
    });
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

function savedDisplayName(result: SavedFileResult): string {
  return result.displayPath || result.fileName;
}

async function saveGeneratedExternally(
  gateway: FileGateway,
  result: GeneratedHwpx,
  suggestedName: string
): Promise<SavedFileResult | null> {
  const saved = await gateway.saveFile(result.data, suggestedName);
  return saved.cancelled ? null : saved;
}

/** Default no-setup export. This compatibility function remains callable by older command IDs. */
export async function saveDocument(
  app: App,
  plugin?: HanmarkPluginIdentity
): Promise<void> {
  await exportKordocHwpx(app, plugin, { mode: "quick-hwpx" });
}

export async function exportKordocHwpx(
  app: App,
  plugin: HanmarkPluginIdentity | undefined,
  options: HanmarkKordocExportOptions
): Promise<boolean> {
  const outcome = await exportKordocHwpxWithOutcome(app, plugin, options, true);
  return outcome?.status === "saved";
}

/**
 * Result-producing HWPX path used by the unified export center.
 *
 * Older command IDs continue to call `exportKordocHwpx()` and receive their
 * familiar notices/report modal. The export center asks for a quiet result so
 * it can keep one modal open and offer "파일 위치 보기" when the file lives in
 * the Vault.
 */
export async function exportKordocHwpxWithOutcome(
  app: App,
  plugin: HanmarkPluginIdentity | undefined,
  options: HanmarkKordocExportOptions,
  presentReport = false
): Promise<HanmarkExportOutcome | null> {
  const context = await readActiveBody(app);
  if (!context) return null;
  const gateway = createFileGateway(app, plugin);
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
              `이미지 불러오는 중 ${imageProgress.completed}/${
                imageProgress.total
              } · ${imageProgress.status === "embedded" ? "포함 준비" : "실패"}`
            );
          }
        );
        break;
      } catch (error) {
        if (!(error instanceof ImageResolutionError)) throw error;
        progress.setMessage("일부 이미지를 포함하지 못했습니다.");
        const action = await chooseImageFailureAction(app, error.failures);
        if (action === "cancel") {
          return { format: "hwpx", status: "cancelled" };
        }
        allowImageFailures = action === "continue";
        progress.setMessage(
          action === "retry"
            ? "이미지를 다시 불러오는 중…"
            : "누락 위치를 표시하고 HWPX를 만드는 중…"
        );
      }
    }
    progress.setMessage("HWPX 구조를 검증하고 저장하는 중…");

    const contract = readSourceContract(app, context.file);
    if (contract) {
      const suffix = options.mode === "gongmun-hwpx" ? "공문서" : "변환";
      const suggestedName = suffixedName(
        filenameFromDisplayPath(contract["hwp-source"]),
        suffix,
        ".hwpx"
      );
      const saved = await saveGeneratedExternally(gateway, result, suggestedName);
      if (!saved) return { format: "hwpx", status: "cancelled" };
      if (presentReport) {
        new HwpSaveReportModal(app, {
          title:
            options.mode === "gongmun-hwpx"
              ? "저장 완료 — 공문서 HWPX"
              : "저장 완료 — 빠른 HWPX",
          outputPath: savedDisplayName(saved),
          note: `원본은 그대로 두고 새 파일을 만들었습니다. ${warningNote(result)}`
        }).open();
      }
      return {
        format: "hwpx",
        status: "saved",
        fileName: saved.fileName,
        displayPath: savedDisplayName(saved),
        vaultPath: saved.vaultPath,
        warnings: result.warnings.map((warning) =>
          `${warning.message}${warning.count > 1 ? ` (${warning.count}건)` : ""}`
        )
      };
    } else {
      const folder =
        context.file.parent?.path && context.file.parent.path !== "/"
          ? `${context.file.parent.path}/`
          : "";
      const suffix = options.mode === "gongmun-hwpx" ? " 공문서" : "";
      let relative = normalizePath(
        `${folder}${context.file.basename}${suffix}.hwpx`
      );
      let index = 1;
      while (app.vault.getAbstractFileByPath(relative)) {
        relative = normalizePath(
          `${folder}${context.file.basename}${suffix} (${index++}).hwpx`
        );
      }
      await app.vault.createBinary(relative, result.data);
      if (presentReport) {
        new Notice(
          `HWPX 저장 완료: ${relative}${
            result.embeddedImageCount
              ? ` · 이미지 ${result.embeddedImageCount}개 포함`
              : ""
          }`
        );
      }
      if (
        presentReport &&
        (result.warnings.length || result.embeddedImageCount)
      ) {
        new HwpSaveReportModal(app, {
          title: "저장 완료 — 변환 안내",
          note: warningNote(result),
          outputPath: relative
        }).open();
      }
      return {
        format: "hwpx",
        status: "saved",
        fileName: filenameFromDisplayPath(relative),
        displayPath: relative,
        vaultPath: relative,
        warnings: result.warnings.map((warning) =>
          `${warning.message}${warning.count > 1 ? ` (${warning.count}건)` : ""}`
        )
      };
    }
  } catch (error) {
    new Notice(`HWPX 내보내기 실패: ${errorMessage(error)}`);
    return null;
  } finally {
    progress.hide();
  }
}

/** Source-format-preserving patch. Kept under the old exported name for compatibility. */
export async function patchSourceExperimental(
  app: App,
  plugin?: HanmarkPluginIdentity
): Promise<void> {
  await patchSourceExperimentalWithOutcome(app, plugin, true);
}

export async function patchSourceExperimentalWithOutcome(
  app: App,
  plugin: HanmarkPluginIdentity | undefined,
  presentReport = false
): Promise<HanmarkExportOutcome | null> {
  const context = await readActiveBody(app);
  if (!context) return null;
  const contract = readSourceContract(app, context.file);
  const format = contract?.["hwp-source-format"];
  if (!contract || (format !== "hwpx" && format !== "hwp")) {
    new Notice("원본 형식 보존은 HWP/HWPX에서 불러온 노트에만 사용할 수 있습니다.");
    return null;
  }
  try {
    return await patchSource(
      app,
      context.file,
      contract,
      context.body,
      plugin,
      createFileGateway(app, plugin),
      presentReport
    );
  } catch (error) {
    new Notice(`원본 형식 보존 실패: ${errorMessage(error)}`);
    return null;
  }
}

async function updateSourceCacheContract(
  app: App,
  file: TFile,
  contract: HwpSourceContract,
  gateway: FileGateway,
  bytes: Uint8Array
): Promise<string> {
  const cacheId = await gateway.cacheSource(bytes, {
    hash: contract["hwp-source-hash"],
    byteLength: contract["hwp-source-bytes"],
    sourceName: filenameFromDisplayPath(contract["hwp-source"])
  });
  await app.fileManager.processFrontMatter(file, (frontmatter) => {
    const record = frontmatter as unknown as Record<string, unknown>;
    record["hwp-source-cache"] = cacheId;
  });
  contract["hwp-source-cache"] = cacheId;
  return cacheId;
}

async function reselectLegacySource(
  app: App,
  file: TFile,
  contract: HwpSourceContract,
  gateway: FileGateway
): Promise<Uint8Array | null> {
  const shouldSelect = await confirm(
    app,
    "원본 파일을 다시 선택해 주세요",
    "이 노트는 HanMark 2.4.2 이전에 만들어져 안전한 원본 캐시가 없습니다.\n원본을 한 번 선택하면 해시와 크기를 검증한 뒤 HanMark 전용 캐시에 보관합니다.",
    "원본 선택",
    "취소"
  );
  if (!shouldSelect) return null;
  const selected = await gateway.pickFiles({
    title: "가져올 때 사용한 원본 파일 다시 선택",
    extensions: [contract["hwp-source-format"]],
    multiple: false
  });
  const bytes = selected[0]?.bytes;
  if (!bytes) return null;
  if (
    !sourceBytesMatchContract(
      bytes,
      contract["hwp-source-hash"],
      contract["hwp-source-bytes"]
    )
  ) {
    new Notice(
      "선택한 파일의 해시 또는 크기가 가져올 때의 원본과 다릅니다. 원본 보호를 위해 패치를 중단했습니다.",
      8_000
    );
    return null;
  }
  await updateSourceCacheContract(app, file, contract, gateway, bytes);
  return bytes;
}

async function sourceBytesForPatch(
  app: App,
  file: TFile,
  contract: HwpSourceContract,
  gateway: FileGateway
): Promise<Uint8Array | null> {
  const cacheId = contract["hwp-source-cache"];
  if (cacheId) {
    try {
      const cached = await gateway.readCachedSource(cacheId);
      if (
        cached &&
        sourceBytesMatchContract(
          cached,
          contract["hwp-source-hash"],
          contract["hwp-source-bytes"]
        )
      ) {
        return cached;
      }
    } catch {
      // A missing/unreadable private cache follows the same safe reselect path
      // as a note imported by an older HanMark version.
    }
  }
  return reselectLegacySource(app, file, contract, gateway);
}

async function patchSource(
  app: App,
  file: TFile,
  contract: HwpSourceContract,
  body: string,
  plugin: HanmarkPluginIdentity | undefined,
  gateway: FileGateway,
  presentReport = true
): Promise<HanmarkExportOutcome | null> {
  const original = await sourceBytesForPatch(app, file, contract, gateway);
  if (!original) return { format: "hwpx", status: "cancelled" };

  const patch = contract["hwp-source-format"] === "hwpx" ? patchHwpx : patchHwp;
  const result: PatchResult = await patch(original, body, { verify: true });
  if (!result.success || !result.data) {
    new HwpSaveReportModal(app, {
      title: "원본 형식 보존 실패 — 원본은 그대로입니다",
      applied: result.applied,
      skipped: result.skipped,
      note:
        result.error ||
        "문단·표 구조가 크게 바뀌었거나 암호화된 문서는 패치할 수 없습니다.",
      generateFull: () =>
        generateFullBeside(
          app,
          file,
          contract["hwp-source"],
          body,
          plugin,
          gateway
        )
    }).open();
    return null;
  }

  if (contract["hwp-source-format"] === "hwpx") {
    const validation = await validateHwpx(result.data);
    if (!validation.ok) {
      new HwpSaveReportModal(app, {
        title: "패치 결과 검증 실패 — 파일을 저장하지 않았습니다",
        applied: result.applied,
        skipped: result.skipped,
        note: validation.issues.map((issue) => issue.message).join(" / ")
      }).open();
      return null;
    }
  }

  const sourceName = filenameFromDisplayPath(contract["hwp-source"]);
  const extension = splitFilename(sourceName).extension ||
    (contract["hwp-source-format"] === "hwp" ? ".hwp" : ".hwpx");
  const suggestedName = suffixedName(sourceName, "수정", extension);
  const saved = await gateway.saveFile(result.data, suggestedName);
  if (saved.cancelled) return { format: "hwpx", status: "cancelled" };

  if (presentReport) {
    new HwpSaveReportModal(app, {
      title: "저장 완료 — 원본 형식 보존",
      applied: result.applied,
      skipped: result.skipped,
      verification: result.verification,
      outputPath: savedDisplayName(saved),
      note: "원본 파일은 그대로 두고 수정본만 새로 만들었습니다. 중복 원본 백업은 생성하지 않았습니다.",
      generateFull: () =>
        generateFullBeside(
          app,
          file,
          contract["hwp-source"],
          body,
          plugin,
          gateway
        )
    }).open();
  }
  return {
    format: "hwpx",
    status: "saved",
    fileName: saved.fileName,
    displayPath: savedDisplayName(saved),
    vaultPath: saved.vaultPath,
    warnings: result.skipped.map((skipped) => skipped.reason || "일부 변경을 건너뛰었습니다.")
  };
}

async function generateFullBeside(
  app: App,
  file: TFile,
  originalPath: string,
  body: string,
  plugin: HanmarkPluginIdentity | undefined,
  gateway: FileGateway
): Promise<string> {
  const generated = await generateBody(
    app,
    file,
    body,
    plugin,
    { mode: "quick-hwpx" }
  );
  const suggestedName = suffixedName(
    filenameFromDisplayPath(originalPath),
    "전체내용",
    ".hwpx"
  );
  const saved = await gateway.saveFile(
    bytesAsArrayBuffer(asUint8Array(generated.data)),
    suggestedName
  );
  if (saved.cancelled) throw new Error("저장을 취소했습니다.");
  return savedDisplayName(saved);
}
