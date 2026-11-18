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
import { patchHwpx, patchHwp, validateHwpx, VERSION as KORDOC_VERSION, type PatchResult } from "kordoc";
import { PATCH_OPTIONS } from "./patchOptions";
import { importedByCurrentEngine, legacyEngineNote } from "./legacyEngine";
import { normalizeLanguagePreference, resolveOutputLocale, t, type LanguagePreference } from "../i18n";
import {
  type HwpSourceContract,
  readSourceContract,
  extractEditableBody
} from "./frontmatter";
import { HwpSaveReportModal } from "./HwpSaveReportModal";
import { adaptMarkdownForKordoc } from "./markdownAdapter";
import { assembleEmbedsSetting, prepareExportMarkdown } from "./exportPreparation";
import { exportDiagramOptions } from "../ui/diagramEnvironment";
import { createVaultAssemblyHost } from "./vaultAssemblyHost";
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
import { templateFontSubstitutions, type TemplateLibraryHost } from "./templateLibrary";
import { gongmunFileLabel, gongmunGenerateOptions, planGongmunExport } from "./gongmunExport";
import { freeVaultPath, gongmunVaultStem, sourceContractGongmunName } from "./exportFileNames";

interface HanmarkPluginIdentity extends TemplateLibraryHost {
  manifest?: Pick<Plugin["manifest"], "id">;
  /**
   * The Markdown note the user is exporting. Shared with DOCX/HTML/PDF so HWPX export
   * keeps working after a preview pane takes focus (2.7.0 W10).
   */
  currentMarkdownView?: () => MarkdownView | null;
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

/** The user's document-label language setting ("auto" when unset). */
function outputLanguage(plugin: HanmarkPluginIdentity | undefined): LanguagePreference {
  return normalizeLanguagePreference(templateHost(plugin).settings.outputLanguage);
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
  return t("common.unknownError");
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

async function readActiveBody(
  app: App,
  plugin?: HanmarkPluginIdentity
): Promise<{ file: TFile; body: string } | null> {
  const view = plugin?.currentMarkdownView?.() ?? app.workspace.getActiveViewOfType(MarkdownView);
  const file = view?.file;
  if (!file) {
    new Notice(t("save.openNote"));
    return null;
  }
  const body = extractEditableBody(view.editor.getValue() || (await app.vault.read(file)));
  if (!body.trim()) {
    new Notice(t("save.empty"));
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
  const host = templateHost(plugin);
  const prepared = await prepareExportMarkdown(createVaultAssemblyHost(app), body, file.path, {
    assembleEmbeds: assembleEmbedsSetting(host.settings),
    outputLanguage: outputLanguage(plugin),
    diagrams: exportDiagramOptions(host.settings, "hwpx")
  });
  // Official documents: window preset > note properties > institution style (2.7.0 W5).
  const gongmun = options.mode === "gongmun-hwpx"
    ? planGongmunExport(app, file, host, options.gongmunPreset, options.gongmunFormId)
    : undefined;
  const adapted = adaptMarkdownForKordoc(prepared.markdown, { outputLanguage: outputLanguage(plugin) });
  adapted.warnings.unshift(...prepared.warnings, ...(gongmun?.warnings ?? []));
  return generateValidatedHwpxFromAdapted(adapted, {
    profile: gongmun ? gongmun.profile : activeTableProfile(host),
    ...(gongmun ? gongmunGenerateOptions(gongmun) : {}),
    documentStyle:
      options.mode === "quick-hwpx"
        ? activeDocumentStyle(host)
        : undefined,
    fontResolver: {
      platform: runtimePlatform(),
      rules: options.mode === "quick-hwpx" ? templateFontSubstitutions(host) : undefined
    },
    images: {
      loader: createObsidianImageLoader(app, file),
      allowFailures: allowImageFailures,
      onProgress: onImageProgress
    }
  });
}

/**
 * A free vault path for an HWPX beside the note: "{note}.hwpx", or "{note} - {form}.hwpx"
 * for an official document, then " (1)", " (2)"… Names beside the note are compared
 * without case, so case-insensitive disks never see two files differing only in case.
 */
function hwpxPathBesideNote(app: App, file: TFile, label: string): string {
  const folder = file.parent?.path && file.parent.path !== "/" ? `${file.parent.path}/` : "";
  const taken = new Set((file.parent?.children ?? []).map((child) => child.path.toLowerCase()));
  return normalizePath(
    freeVaultPath(
      folder,
      label ? gongmunVaultStem(file.basename, label) : file.basename,
      ".hwpx",
      (path) => taken.has(normalizePath(path).toLowerCase()) || app.vault.getAbstractFileByPath(normalizePath(path)) !== null
    )
  );
}

/** The note an export works on, read once (several forms at once use one snapshot, R-028). */
export interface ExportNoteSnapshot {
  file: TFile;
  body: string;
}

export async function readExportSnapshot(app: App, plugin?: HanmarkPluginIdentity): Promise<ExportNoteSnapshot | null> {
  return readActiveBody(app, plugin);
}

/**
 * One form of "several forms at once" (R-028): made from the snapshot with the form
 * named explicitly (the global form stays as it is) and saved beside the note in the
 * vault — also for notes imported from a Hangul file, so no save dialog interrupts the
 * run. Missing images raise ImageResolutionError unless `allowImageFailures`.
 */
export async function exportGongmunFormBesideNote(
  app: App,
  plugin: HanmarkPluginIdentity | undefined,
  snapshot: ExportNoteSnapshot,
  formId: string,
  allowImageFailures: boolean
): Promise<HanmarkExportOutcome> {
  const options: HanmarkKordocExportOptions = { mode: "gongmun-hwpx", gongmunFormId: formId };
  const result = await generateBody(app, snapshot.file, snapshot.body, plugin, options, allowImageFailures);
  const relative = hwpxPathBesideNote(app, snapshot.file, gongmunExportLabel(app, snapshot.file, snapshot.body, plugin, options));
  await app.vault.createBinary(relative, result.data);
  return {
    format: "hwpx",
    status: "saved",
    fileName: filenameFromDisplayPath(relative),
    displayPath: relative,
    vaultPath: relative,
    warnings: exportOutcomeNotes(result)
  };
}

/**
 * The form's name for an official document's file name (R-028), in the note's output
 * language; "" for quick HWPX.
 */
function gongmunExportLabel(
  app: App,
  file: TFile,
  body: string,
  plugin: HanmarkPluginIdentity | undefined,
  options: HanmarkKordocExportOptions
): string {
  if (options.mode !== "gongmun-hwpx") return "";
  const host = templateHost(plugin);
  const plan = planGongmunExport(app, file, host, options.gongmunPreset, options.gongmunFormId);
  return gongmunFileLabel(host, plan.formId, resolveOutputLocale(outputLanguage(plugin), body));
}

function warningNote(result: GeneratedHwpx): string {
  const parts = [t("save.note.verified", { count: result.validation.entryCount })];
  if (result.documentStyleName) {
    parts.push(t("save.note.style", { name: result.documentStyleName }));
  }
  parts.push(...exportOutcomeNotes(result));
  return parts.join(" · ");
}

function exportOutcomeNotes(result: GeneratedHwpx): string[] {
  const notes: string[] = [];
  if (result.embeddedImageCount) {
    notes.push(
      `${t("save.note.images", { count: result.embeddedImageCount })}${
        result.embeddedImageOccurrences > result.embeddedImageCount
          ? t("preview.quick.imagePlacements", { count: result.embeddedImageOccurrences })
          : ""
      }`
    );
  }
  if (result.imageFailures.length) {
    notes.push(t("save.note.imagesMissing", { count: result.imageFailures.length }));
  }
  for (const warning of result.warnings) {
    notes.push(
      `${warning.message}${warning.count > 1 ? t("save.note.repeat", { count: warning.count }) : ""}`
    );
  }
  return notes;
}

type ImageFailureAction = "retry" | "continue" | "cancel";

export function chooseImageFailureAction(
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
    modal.titleEl.setText(t("save.imageFailure.title", { count: failures.length }));
    modal.contentEl.createEl("p", {
      text: t("save.imageFailure.desc")
    });
    const list = modal.contentEl.createEl("ul");
    for (const failure of failures.slice(0, 10)) {
      list.createEl("li", {
        text: `${failure.alt || failure.source || t("save.imageFailure.image")}: ${failure.message}`
      });
    }
    if (failures.length > 10) {
      modal.contentEl.createEl("p", { text: t("import.report.more", { count: failures.length - 10 }) });
    }
    const row = modal.contentEl.createDiv();
    row.setCssStyles({
      display: "flex",
      gap: "8px",
      flexWrap: "wrap",
      marginTop: "12px"
    });
    const retry = row.createEl("button", { text: t("import.report.retry") });
    retry.classList.add("mod-cta");
    retry.onclick = () => {
      finish("retry");
      modal.close();
    };
    const continueButton = row.createEl("button", { text: t("save.imageFailure.continue") });
    continueButton.onclick = () => {
      finish("continue");
      modal.close();
    };
    const cancel = row.createEl("button", { text: t("common.cancel") });
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
  const context = await readActiveBody(app, plugin);
  if (!context) return null;
  const gateway = createFileGateway(app, plugin);
  const progress = new Notice(t("save.progress.generating", { version: String(KORDOC_VERSION) }), 0);
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
            const counts = { completed: imageProgress.completed, total: imageProgress.total };
            progress.setMessage(
              imageProgress.status === "embedded"
                ? t("preview.quick.imageProgressEmbedded", counts)
                : t("save.progress.imagesFailed", counts)
            );
          }
        );
        break;
      } catch (error) {
        if (!(error instanceof ImageResolutionError)) throw error;
        progress.setMessage(t("save.progress.someMissing"));
        const action = await chooseImageFailureAction(app, error.failures);
        if (action === "cancel") {
          return { format: "hwpx", status: "cancelled" };
        }
        allowImageFailures = action === "continue";
        progress.setMessage(
          action === "retry"
            ? t("save.progress.retrying")
            : t("save.progress.marking")
        );
      }
    }
    progress.setMessage(t("save.progress.saving"));

    const contract = readSourceContract(app, context.file);
    // Official documents name their form: "원본_업무보고_시각.hwpx", "노트 - 업무보고.hwpx" (R-028).
    const label = gongmunExportLabel(app, context.file, context.body, plugin, options);
    if (contract) {
      const sourceName = filenameFromDisplayPath(contract["hwp-source"]);
      const suggestedName = label
        ? safeSuggestedName(sourceContractGongmunName(splitFilename(sourceName).stem, label, stamp()))
        : suffixedName(sourceName, t("save.suffix.converted"), ".hwpx");
      const saved = await saveGeneratedExternally(gateway, result, suggestedName);
      if (!saved) return { format: "hwpx", status: "cancelled" };
      if (presentReport) {
        new HwpSaveReportModal(app, {
          title:
            options.mode === "gongmun-hwpx"
              ? t("save.report.gongmun")
              : t("save.report.quick"),
          outputPath: savedDisplayName(saved),
          note: t("save.report.newFile", { notes: warningNote(result) })
        }).open();
      }
      return {
        format: "hwpx",
        status: "saved",
        fileName: saved.fileName,
        displayPath: savedDisplayName(saved),
        vaultPath: saved.vaultPath,
        warnings: exportOutcomeNotes(result)
      };
    } else {
      const relative = hwpxPathBesideNote(app, context.file, label);
      await app.vault.createBinary(relative, result.data);
      if (presentReport) {
        new Notice(
          `${t("save.notice.saved", { path: relative })}${
            result.embeddedImageCount
              ? t("preview.quick.imagesEmbedded", { count: result.embeddedImageCount })
              : ""
          }`
        );
      }
      if (
        presentReport &&
        (result.warnings.length || result.embeddedImageCount)
      ) {
        new HwpSaveReportModal(app, {
          title: t("save.report.conversion"),
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
        warnings: exportOutcomeNotes(result)
      };
    }
  } catch (error) {
    new Notice(t("save.failed", { detail: errorMessage(error) }));
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
  const context = await readActiveBody(app, plugin);
  if (!context) return null;
  const contract = readSourceContract(app, context.file);
  const format = contract?.["hwp-source-format"];
  if (!contract || (format !== "hwpx" && format !== "hwp")) {
    new Notice(t("save.patch.onlyImported"));
    return null;
  }
  if (!importedByCurrentEngine(contract)) {
    // R-018: the note was imported by an older Kordoc. The current engine reads the same
    // original differently, so patching would write engine-output differences into the
    // original as if they were the user's edits. Create a new HWPX from the note instead.
    try {
      const displayPath = await generateFullBeside(
        app,
        context.file,
        contract["hwp-source"],
        context.body,
        plugin,
        createFileGateway(app, plugin)
      );
      new Notice(t("save.legacyEngine.notice", { path: displayPath }), 10_000);
      return { format: "hwpx", status: "saved", displayPath, warnings: [legacyEngineNote()] };
    } catch (error) {
      new Notice(t("save.legacy.failed", { detail: errorMessage(error) }));
      return null;
    }
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
    new Notice(t("save.patch.failed", { detail: errorMessage(error) }));
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
    t("save.reselect.title"),
    t("save.reselect.message"),
    t("save.reselect.choose"),
    t("common.cancel")
  );
  if (!shouldSelect) return null;
  const selected = await gateway.pickFiles({
    title: t("save.reselect.pickTitle"),
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
    new Notice(t("save.reselect.mismatch"), 8_000);
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
  const result: PatchResult = await patch(original, body, PATCH_OPTIONS);
  if (!result.success || !result.data) {
    new HwpSaveReportModal(app, {
      title: t("save.patch.failedTitle"),
      applied: result.applied,
      skipped: result.skipped,
      note:
        result.error ||
        t("save.patch.failedNote"),
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
        title: t("save.patch.invalidTitle"),
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
  const suggestedName = suffixedName(sourceName, t("save.suffix.edited"), extension);
  const saved = await gateway.saveFile(result.data, suggestedName);
  if (saved.cancelled) return { format: "hwpx", status: "cancelled" };

  if (presentReport) {
    new HwpSaveReportModal(app, {
      title: t("save.patch.savedTitle"),
      applied: result.applied,
      skipped: result.skipped,
      verification: result.verification,
      outputPath: savedDisplayName(saved),
      note: t("save.patch.savedNote"),
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
    warnings: result.skipped.map((skipped) => skipped.reason || t("save.patch.skipped"))
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
    t("save.suffix.full"),
    ".hwpx"
  );
  const saved = await gateway.saveFile(
    bytesAsArrayBuffer(asUint8Array(generated.data)),
    suggestedName
  );
  if (saved.cancelled) throw new Error(t("save.cancelled"));
  return savedDisplayName(saved);
}
