import {
  FileSystemAdapter,
  MarkdownView,
  Modal,
  Notice,
  Platform,
  Plugin,
  TFile,
  getLanguage,
  type App,
  type Editor,
  type WorkspaceLeaf
} from "obsidian";
import { registerEditorCompatibilityCommands } from "./editorCommands";
import { resolveOutputLocale, resolveUiLocale, setUiLocale, t } from "./i18n";
import { createWordTemplateStorage, DocxExportCancelled, DocxExportService, type DocxSource } from "./io/docxExport";
import { unpackBundledAssets } from "./io/assetUnpack";
import {
  activeDocumentStyle,
  activeDocumentTemplate,
  activeTemplateId,
  availableDocumentTemplates,
  importDocumentStyle,
  migrateDocumentStyleSettingsInMemory,
  saveDocumentStyle,
  setActiveDocumentTemplate
} from "./io/documentStyleSettings";
import {
  editableDocumentStyle,
  type DocumentStyleProfile
} from "./io/documentStyle";
import type {
  HanmarkExportFormat,
  HanmarkExportOutcome
} from "./io/exportTypes";
import { createFileGateway, type FileGateway } from "./io/fileGateway";
import {
  extractEditableBodyStrict,
  readSourceContract
} from "./io/frontmatter";
import {
  prepareSelfContainedHtmlMarkdown
} from "./io/htmlExportService";
import type { ImageFailure } from "./io/imageAssets";
import { EditorialPdfService, editorialPdfDiagramPaper } from "./io/editorialPdf";
import {
  activeEditorialPdfThemeSnapshot,
  listEditorialPdfThemeSnapshots,
  normalizeEditorialPdfThemeLibrary,
  setActiveEditorialPdfTheme,
  type EditorialPdfThemeLibraryV1
} from "./io/editorialPdfTheme";
import { importCloudSettings } from "./io/kordocImport";
import { isImportableExtension, type ImportInput } from "./io/importRunner";
import { assemblyNotice, diagramNotice, prepareExportMarkdown } from "./io/exportPreparation";
import { exportDiagramOptions } from "./ui/diagramEnvironment";
import type { DiagramPalette } from "./io/diagramSvg";
import { createVaultAssemblyHost } from "./io/vaultAssemblyHost";
import {
  createCleanLegacyImportCopy,
  hasHanmarkSourceMetadata
} from "./io/legacyImportMigration";
import { createObsidianImageLoader } from "./io/obsidianImageLoader";
import {
  chooseImageFailureAction,
  exportGongmunFormBesideNote,
  exportKordocHwpxWithOutcome,
  patchSourceExperimental,
  readExportSnapshot
} from "./io/kordocSave";
import { runGongmunBatch } from "./io/gongmunBatch";
import { ImageResolutionError } from "./io/imageAssets";
import { GongmunBatchModal } from "./ui/GongmunBatchModal";
import {
  forgetNotePaths,
  rememberNoteForm,
  rememberedNoteForm,
  renameNotePaths,
  type FormMemory
} from "./io/formMemory";
import {
  forgetRecentExports,
  isRecentExportFormat,
  recordRecentExport,
  renameRecentExports,
  type RecentExport
} from "./io/recentExports";
import {
  openVaultDocumentUserInitiated,
  revealVaultOutputUserInitiated,
  trustSavedVaultOutput
} from "./io/outputReveal";
import { activeTableProfile } from "./io/tableStyle";
import {
  createDefaultWordTemplate,
  createUserInitiatedAction,
  DEFAULT_HANMARK_SETTINGS,
  normalizeHanmarkSettings,
  renderStandaloneHtmlBytes,
  WordFontCatalog,
  WordTemplateStore,
  type HanmarkRuntimePlatform,
  type HanmarkSettings
} from "./legacy-port";
import {
  DocxPreviewView,
  DOCX_PREVIEW_VIEW_TYPE
} from "./ui/DocxPreviewView";
import { DocumentStyleModal } from "./ui/DocumentStyleModal";
import {
  EditorialPdfThemeManagerModal,
  activeEditorialPdfThemeSummary as describeActiveEditorialPdfTheme
} from "./ui/EditorialPdfThemeManagerModal";
import { HanmarkExportModal } from "./ui/HanmarkExportModal";
import {
  HanmarkSettingTab
} from "./ui/HanmarkSettingTab";
import { HwpxTemplateManagerModal } from "./ui/HwpxTemplateManagerModal";
import {
  HANGUL_DOCUMENT_EXTENSIONS,
  HanmarkDocumentView,
  HANMARK_DOCUMENT_VIEW
} from "./ui/HanmarkDocumentView";
import { ImportModal, importVaultFiles, type ImportHost } from "./ui/ImportModal";
import { CompareModal, type CompareHost } from "./ui/CompareModal";
import {
  createFormNoteFromBuiltin,
  createFormNoteFromFile,
  fillFormFromNote,
  pickFormAndCreateNote,
  type FormHost
} from "./ui/formFlow";
import { FORM_LINK_KEY } from "./io/formFill";
import {
  QuickHwpxPreviewView,
  QUICK_HWPX_PREVIEW_VIEW,
  type QuickPreviewMode
} from "./ui/QuickHwpxPreviewView";
import { GongmunCheckController } from "./ui/gongmunCheckController";
import { HanmarkStatusBar } from "./ui/statusBar";
import { StartPanels } from "./ui/startPanel";
import { GongmunStyleModal } from "./ui/GongmunStyleModal";
import {
  currentGongmunFormId,
  describeGongmunForm,
  isGongmunForm,
  listGongmunForms,
  noteLookHint,
  notePresetHint,
  planGongmunExport,
  selectGongmunFormInMemory
} from "./io/gongmunExport";
import { LOOK_BASIC, agencyOfLook, formatGongmunFormId, gongmunFormChoice } from "./io/gongmunFormId";
import { withGongmunLook } from "./io/gongmunForms";
import { migrateGongmunFormMemory } from "./io/gongmunFormMigration";
import { GongmunLookModal } from "./ui/GongmunLookModal";
import type { GongmunPickerHost } from "./ui/gongmunFormPicker";
import {
  GONGMUN_PRESET_KOREAN_NAMES,
  GONGMUN_PRESET_PROPERTY_KEY,
  GONGMUN_PROPERTIES,
  gongmunPropertyKeysFor
} from "./io/gongmunProperties";
import {
  recordGongmunLookUseInMemory,
  templateDisplayName,
  templateFontSubstitutions,
  toggleGongmunLookFavoriteInMemory
} from "./io/templateLibrary";
import type { GongmunPreset } from "kordoc";
import type { HwpxExportVariant } from "./io/exportTypes";
import {
  applyToolbarSkin,
  editorFormatting,
  ToolbarController
} from "./ui/ToolbarController";
import { EditorActivityHub } from "./ui/editorActivity";
import { JobTracker } from "./ui/jobTracker";
import { WordTemplateManagerModal } from "./ui/WordTemplateManagerModal";
import { errorMessage } from "./utils/errors";

interface SettingsController {
  open(): void;
  openTabById(id: string): void;
}

interface AppWithSettings {
  setting: SettingsController;
}

interface CommandManager {
  executeCommandById(id: string): boolean;
}

interface AppWithCommands {
  commands: CommandManager;
}

type HtmlImageFailureAction = "retry" | "continue" | "cancel";
type PdfImageFailureAction = "retry" | "cancel";

function chooseHtmlImageFailureAction(
  app: App,
  failures: ImageFailure[]
): Promise<HtmlImageFailureAction> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (action: HtmlImageFailureAction): void => {
      if (resolved) return;
      resolved = true;
      resolve(action);
    };
    const modal = new Modal(app);
    modal.titleEl.setText(t("exportFlow.htmlImageFailure.title", { count: failures.length }));
    modal.contentEl.createEl("p", {
      text: t("exportFlow.htmlImageFailure.desc")
    });
    const list = modal.contentEl.createEl("ul");
    for (const failure of failures.slice(0, 10)) {
      list.createEl("li", {
        text: `${failure.alt || failure.source || t("save.imageFailure.image")}: ${failure.message}`
      });
    }
    if (failures.length > 10) {
      modal.contentEl.createEl("p", {
        text: t("exportFlow.imageFailure.more", { count: failures.length - 10 })
      });
    }
    const controls = modal.contentEl.createDiv({
      cls: "hanmark-export-secondary-actions"
    });
    const retry = controls.createEl("button", {
      text: t("import.report.retry"),
      cls: "mod-cta",
      attr: { type: "button" }
    });
    retry.onclick = () => {
      finish("retry");
      modal.close();
    };
    const continueButton = controls.createEl("button", {
      text: t("save.imageFailure.continue"),
      attr: { type: "button" }
    });
    continueButton.onclick = () => {
      finish("continue");
      modal.close();
    };
    const cancel = controls.createEl("button", {
      text: t("common.cancel"),
      attr: { type: "button" }
    });
    cancel.onclick = () => {
      finish("cancel");
      modal.close();
    };
    modal.onClose = () => finish("cancel");
    modal.open();
  });
}

function choosePdfImageFailureAction(
  app: App,
  failures: ImageFailure[]
): Promise<PdfImageFailureAction> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (action: PdfImageFailureAction): void => {
      if (resolved) return;
      resolved = true;
      resolve(action);
    };
    const modal = new Modal(app);
    modal.titleEl.setText(t("exportFlow.pdfImageFailure.title", { count: failures.length }));
    modal.contentEl.createEl("p", {
      text: t("exportFlow.pdfImageFailure.desc")
    });
    const list = modal.contentEl.createEl("ul");
    for (const failure of failures.slice(0, 10)) {
      list.createEl("li", {
        text: `${failure.alt || failure.source || t("save.imageFailure.image")}: ${failure.message}`
      });
    }
    if (failures.length > 10) {
      modal.contentEl.createEl("p", {
        text: t("exportFlow.imageFailure.more", { count: failures.length - 10 })
      });
    }
    const controls = modal.contentEl.createDiv({
      cls: "hanmark-export-secondary-actions"
    });
    const retry = controls.createEl("button", {
      text: t("import.report.retry"),
      cls: "mod-cta",
      attr: { type: "button" }
    });
    retry.onclick = () => {
      finish("retry");
      modal.close();
    };
    const cancel = controls.createEl("button", {
      text: t("exportFlow.pdfImageFailure.cancel"),
      attr: { type: "button" }
    });
    cancel.onclick = () => {
      finish("cancel");
      modal.close();
    };
    modal.onClose = () => finish("cancel");
    modal.open();
  });
}

function runtimePlatform(): HanmarkRuntimePlatform {
  if (Platform.isWin) return "windows";
  if (Platform.isMacOS) return "macos";
  return "linux";
}

/** Obsidian's configured language code ("ko", "en", ...); "en" if unavailable. */
function obsidianLanguage(): string {
  try {
    return typeof getLanguage === "function" ? getLanguage() : "en";
  } catch {
    return "en";
  }
}

function registerHeadingCommand(plugin: Plugin, level: number): void {
  plugin.addCommand({
    id: `set-heading-${level}`,
    name: t("command.setHeading", { level }),
    editorCallback: (editor: Editor) => editorFormatting.setHeading(editor, level)
  });
}

/**
 * HanMark 2.5.5 runtime.
 *
 * HWPX is generated in-process by Kordoc. The single external process boundary
 * is used only after an explicit user action: optional Pandoc/Word conversion
 * or revealing a newly saved Vault result in the operating-system file manager.
 */
export default class HanmarkPlugin extends Plugin {
  settings: HanmarkSettings = { ...DEFAULT_HANMARK_SETTINGS };

  private gateway!: FileGateway;
  private wordTemplateStore!: WordTemplateStore;
  /** Name of the active custom Word template for display; its id is an internal UUID. */
  private wordTemplateLabel: { id: string; name: string } | null = null;
  private wordFontCatalog!: WordFontCatalog;
  private docxExporter!: DocxExportService;
  private readonly editorialPdf = new EditorialPdfService();
  private toolbar: ToolbarController | null = null;
  private statusBar: HanmarkStatusBar | null = null;
  private readonly gongmunCheck = new GongmunCheckController({
    app: this.app,
    families: () => this.settings.gongmunCheckFamilies,
    preflightEnabled: () => this.settings.gongmunPreflight,
    currentView: () => this.currentMarkdownView(),
    presetOf: (file) => notePresetHint(this.app, file) ?? describeGongmunForm(this, this.currentGongmunForm(file ?? undefined))?.preset ?? "report",
    addStatusItem: () => this.addStatusBarItem()
  });
  private startPanels: StartPanels | null = null;
  private settingTab: HanmarkSettingTab | null = null;
  private lastMarkdownView: MarkdownView | null = null;
  /** Cursor and text changes of every editor, fanned out to the toolbar, status bar, and preview (R-028). */
  private readonly activity = new EditorActivityHub();
  /** Exports and imports the user started; the toolbar edge flows while one runs (R-028). */
  readonly jobs = new JobTracker();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.applyUiLanguage();
    await unpackBundledAssets(this);

    this.gateway = createFileGateway(this.app, this);
    this.wordFontCatalog = new WordFontCatalog(() => this.settings, this.gateway);
    this.wordTemplateStore = new WordTemplateStore({
      storage: createWordTemplateStorage(this.app.vault.adapter),
      rootPath: `${this.app.vault.configDir}/plugins/${this.manifest.id}`,
      getActiveTemplateId: () => this.settings.activeWordTemplateId,
      setActiveTemplateId: (id) => {
        this.settings.activeWordTemplateId = id;
      }
    });
    await this.wordTemplateStore.ensureDefaultTemplate(createDefaultWordTemplate());
    this.refreshWordTemplateLabel();
    this.docxExporter = new DocxExportService({
      app: this.app,
      pluginId: this.manifest.id,
      fileGateway: this.gateway,
      templateStore: this.wordTemplateStore,
      getPandocPath: () => this.settings.pandocPath,
      getEngine: () => this.settings.docxEngine,
      imageLoader: (sourcePath) => {
        const file = sourcePath ? this.app.vault.getAbstractFileByPath(sourcePath) : null;
        return file instanceof TFile ? createObsidianImageLoader(this.app, file) : null;
      },
      onImageFailures: (failures) => chooseHtmlImageFailureAction(this.app, failures),
      getOutputLanguage: () => this.settings.outputLanguage,
      prepareMarkdown: async (body, sourcePath) => {
        if (!sourcePath) return body;
        const prepared = await prepareExportMarkdown(createVaultAssemblyHost(this.app), body, sourcePath, {
          assembleEmbeds: this.settings.assembleEmbeds,
          outputLanguage: this.settings.outputLanguage,
          diagrams: exportDiagramOptions(this.settings, "docx")
        });
        const notice = assemblyNotice(prepared.warnings);
        if (notice) new Notice(notice, 8_000);
        const diagrams = diagramNotice(prepared.warnings);
        if (diagrams) new Notice(diagrams, 8_000);
        return prepared.markdown;
      }
    });

    this.registerViews();
    this.registerCommands();
    registerEditorCompatibilityCommands(this);
    this.registerEditorExtension(this.activity.extension);
    this.registerEditorExtension(this.gongmunCheck.extension);
    this.gongmunCheck.installStatus();
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.gongmunCheck.refreshStatus()));
    this.followVaultChanges();
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof MarkdownView && leaf.view.file) {
          this.lastMarkdownView = leaf.view;
        }
      })
    );
    const initialMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (initialMarkdownView?.file) this.lastMarkdownView = initialMarkdownView;
    this.installStatusBar();
    this.installStartPanels();

    this.toolbar = new ToolbarController(
      this,
      {
        importDocument: () => this.openImportModal(),
        openHwpxExport: () => this.openExportCenter("hwpx"),
        openDocxExport: () => this.openExportCenter("docx"),
        openHtmlExport: () => this.openExportCenter("html"),
        openPdfExport: () => this.openExportCenter("pdf"),
        toggleHwpxPreview: () => void this.toggleQuickPreview(),
        openTemplateManager: () => this.openTemplateManager(),
        openSettings: () => this.openPluginSettings(),
        toggleDocxPreview: () => void this.toggleDocxPreview(),
        openWordTemplateEditor: () => this.openWordTemplateManager()
      },
      this.settings.showToolbarOnStartup,
      () => this.settings,
      {
        persist: () => this.saveSettings(),
        currentMarkdownView: () => this.currentMarkdownView(),
        activity: this.activity,
        jobs: this.jobs
      }
    );
    this.toolbar.initialize();

    this.settingTab = new HanmarkSettingTab(
      this.app,
      this,
      {
        wordTemplateStore: this.wordTemplateStore,
        openHwpxTemplateManager: () => this.openTemplateManager(),
        openWordTemplateManager: () => this.openWordTemplateManager(),
        openEditorialPdfThemeManager: () =>
          this.openEditorialPdfThemeManager("manage"),
        activeEditorialPdfThemeSummary: () =>
          describeActiveEditorialPdfTheme(
            this.settings.editorialPdfThemeLibrary
          ),
        refreshPreviews: () => this.refreshPreviews(),
      checkPandoc: () => this.docxExporter.pandocVersionUserInitiated(createUserInitiatedAction("modal")),
        refreshPreviewControls: () => this.refreshPreviewControls(),
        refreshStatusBar: () => this.statusBar?.refresh(),
        refreshStartPanels: () => this.startPanels?.sync(),
        refreshToolbar: () => {
          this.toolbar?.setVisible(this.settings.showToolbarOnStartup);
          this.toolbar?.refreshSettings();
        },
        applyUiLanguage: () => this.applyUiLanguage()
      }
    );
    this.addSettingTab(this.settingTab);

    this.addRibbonIcon("panel-top", t("ribbon.toggleToolbar"), () => {
      const visible = this.toolbar?.toggle() ?? false;
      this.settings.showToolbarOnStartup = visible;
      void this.saveSettings();
    });
    this.addRibbonIcon("file-input", t("ribbon.import"), () => {
      this.openImportModal();
    });
    this.addRibbonIcon("file-output", t("ribbon.export"), () => {
      this.openExportCenter("hwpx");
    });
    this.registerImportMenus();
  }

  /** The import window (command, ribbon, toolbar). */
  openImportModal(inputs: ImportInput[] = []): void {
    new ImportModal(this.importHost(), inputs).open();
  }

  private importHost(): ImportHost {
    return {
      app: this.app,
      gateway: this.gateway,
      defaultPreset: () => this.settings.importPreset,
      rememberedOptions: () => this.settings.importAdvanced,
      rememberOptions: async (options) => {
        this.settings.importAdvanced = options;
        await this.saveSettings();
      },
      folderFor: (input) => this.importFolderFor(input),
      confirmEachImport: () => this.settings.importDestination.mode === "ask",
      cloudSettings: () => importCloudSettings(this),
      reveal: Platform.isDesktopApp ? (path) => this.revealVaultNote(path) : undefined,
      trackJob: () => this.jobs.begin()
    };
  }

  /** Destination policy: fixed folder, else next to a Vault original, else the open note's folder. */
  private importFolderFor(input?: ImportInput): string {
    const destination = this.settings.importDestination;
    if (destination.mode === "folder") return destination.folder;
    if (input?.vaultPath) return input.vaultPath.split("/").slice(0, -1).join("/");
    const parent = this.app.workspace.getActiveFile()?.parent?.path;
    return parent && parent !== "/" ? parent : "";
  }

  /** File explorer: "Convert to Markdown note" on documents, "View in HanMark" on HWP/HWPX. */
  private registerImportMenus(): void {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || !isImportableExtension(file.extension)) return;
        menu.addItem((item) =>
          item
            .setTitle(t("menu.convertToNote"))
            .setIcon("file-input")
            .onClick(() => void importVaultFiles(this.importHost(), [file]))
        );
        if (HANGUL_DOCUMENT_EXTENSIONS.includes(file.extension.toLowerCase())) {
          menu.addItem((item) =>
            item
              .setTitle(t("menu.viewInHanmark"))
              .setIcon("file-text")
              .onClick(() => void this.openDocumentView(file))
          );
        }
        menu.addItem((item) =>
          item
            .setTitle(t("menu.compare"))
            .setIcon("git-compare")
            .onClick(() => this.openCompare(file))
        );
        if (file.extension.toLowerCase() === "hwpx") {
          menu.addItem((item) =>
            item
              .setTitle(t("menu.formNote"))
              .setIcon("clipboard-list")
              .onClick(() => void createFormNoteFromFile(this.formHost(), file))
          );
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("files-menu", (menu, files) => {
        const documents = files.filter(
          (file): file is TFile => file instanceof TFile && isImportableExtension(file.extension)
        );
        if (!documents.length) return;
        menu.addItem((item) =>
          item
            .setTitle(t("menu.convertManyToNotes", { count: documents.length }))
            .setIcon("file-input")
            .onClick(() => void importVaultFiles(this.importHost(), documents))
        );
      })
    );
  }

  private compareHost(): CompareHost {
    return {
      app: this.app,
      gateway: this.gateway,
      folderFor: (source) => this.importFolderFor(source),
      outputLanguage: () => this.settings.outputLanguage
    };
  }

  /** Old–new comparison of two documents; `first` preselects the current version. */
  openCompare(first?: TFile): void {
    new CompareModal(this.compareHost(), first).open();
  }

  private formHost(): FormHost {
    return {
      app: this.app,
      gateway: this.gateway,
      defaultFolder: () => this.importFolderFor(),
      outputLanguage: () => this.settings.outputLanguage,
      openDocument: (file) => this.openDocumentView(file)
    };
  }

  private async openDocumentView(file: TFile): Promise<void> {
    await this.app.workspace.getLeaf(true).setViewState({
      type: HANMARK_DOCUMENT_VIEW,
      state: { file: file.path },
      active: true
    });
  }

  /** Note assembly for HTML and PDF; DOCX and HWPX run the same step internally. */
  private async prepareExportBody(file: TFile, body: string, paper?: DiagramPalette): Promise<string> {
    const prepared = await prepareExportMarkdown(createVaultAssemblyHost(this.app), body, file.path, {
      assembleEmbeds: this.settings.assembleEmbeds,
      outputLanguage: this.settings.outputLanguage,
      diagrams: exportDiagramOptions(this.settings, "markup", paper)
    });
    const notice = assemblyNotice(prepared.warnings);
    if (notice) new Notice(notice, 8_000);
    const diagrams = diagramNotice(prepared.warnings);
    if (diagrams) new Notice(diagrams, 8_000);
    return prepared.markdown;
  }

  private async revealVaultNote(vaultPath: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error(t("reveal.unavailable"));
    const output = trustSavedVaultOutput({ status: "saved", vaultPath });
    if (!output) throw new Error(t("reveal.unavailable"));
    await revealVaultOutputUserInitiated(
      {
        output,
        platform: runtimePlatform(),
        resolveVaultPath: (path) => adapter.getFullPath(path)
      },
      createUserInitiatedAction("modal")
    );
  }

  private async openWithDefaultApp(file: TFile): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error(t("reveal.unavailable"));
    await openVaultDocumentUserInitiated(
      {
        vaultPath: file.path,
        platform: runtimePlatform(),
        resolveVaultPath: (path) => adapter.getFullPath(path)
      },
      createUserInitiatedAction("toolbar")
    );
  }

  onunload(): void {
    this.activity.dispose();
    this.editorialPdf.dispose();
    this.toolbar?.destroy();
    this.toolbar = null;
    this.app.workspace
      .getLeavesOfType(QUICK_HWPX_PREVIEW_VIEW)
      .forEach((leaf) => leaf.detach());
    this.app.workspace
      .getLeavesOfType(DOCX_PREVIEW_VIEW_TYPE)
      .forEach((leaf) => leaf.detach());
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeHanmarkSettings(this.settings, runtimePlatform());
    await this.saveData(this.settings);
  }

  /**
   * Resolves the interface language from the setting and Obsidian's language. New
   * windows and notices switch at once; command names and ribbon tooltips were
   * registered at load time and switch after a restart.
   */
  applyUiLanguage(): void {
    setUiLocale(resolveUiLocale(this.settings.uiLanguage, obsidianLanguage()));
  }

  private async loadSettings(): Promise<void> {
    const loaded: unknown = await this.loadData();
    const migrationInput: Record<string, unknown> =
      typeof loaded === "object" && loaded !== null && !Array.isArray(loaded)
        ? { ...(loaded as Record<string, unknown>) }
        : {};
    const migrated = migrateDocumentStyleSettingsInMemory({
      settings: migrationInput
    });
    this.settings = normalizeHanmarkSettings(migrationInput, runtimePlatform());
    const forms = migrateGongmunFormMemory(this, this.settings.gongmunFormByNote);
    this.settings.gongmunFormByNote = forms.memory;
    if (
      migrated ||
      forms.changed ||
      migrationInput.settingsVersion !== this.settings.settingsVersion
    ) {
      await this.saveData(this.settings);
    }
  }

  private registerViews(): void {
    this.registerView(
      QUICK_HWPX_PREVIEW_VIEW,
      (leaf: WorkspaceLeaf) =>
        new QuickHwpxPreviewView(leaf, {
          profile: () => activeTableProfile(this),
          documentStyle: () => activeDocumentStyle(this),
          fontRules: () => templateFontSubstitutions(this),
          sourceView: () => this.currentMarkdownView(),
          livePreviewEnabled: () => this.settings.enableLivePreview,
          autoPauseEnabled: () => this.settings.previewAutoPause,
          outputLanguage: () => this.settings.outputLanguage,
          assembleEmbeds: () => this.settings.assembleEmbeds,
      diagrams: () => exportDiagramOptions(this.settings, "hwpx"),
          gongmunPlan: (file, preset, formId) => planGongmunExport(this.app, file, this, preset, formId),
          gongmunForms: () => listGongmunForms(this),
          gongmunPicker: () => this.gongmunPickerHost(),
          describeGongmunForm: (id) => describeGongmunForm(this, id),
          currentGongmunForm: (file) => this.currentGongmunForm(file),
          selectGongmunForm: (id, file) => this.selectGongmunForm(id, file),
          rememberMode: (kind) => this.rememberPreviewMode(kind),
          subscribeActivity: (listener, delay) => this.activity.subscribe(listener, delay),
          followCursor: () => this.settings.previewFollowCursor,
          setFollowCursor: (on) => this.setPreviewFollow(on),
          exportHwpx: async (mode) => {
            const note = this.currentMarkdownView()?.file?.path;
            const outcome = await this.jobs.run(() =>
              exportKordocHwpxWithOutcome(
                this.app,
                this,
                mode.kind === "quick"
                  ? { mode: "quick-hwpx" }
                  : { mode: "gongmun-hwpx", gongmunPreset: mode.preset, gongmunFormId: mode.formId },
                true
              )
            );
            await this.afterExport(outcome, mode.kind === "gongmun" ? mode.formId : undefined, note);
            return outcome?.status === "saved";
          }
        })
    );
    this.registerView(
      DOCX_PREVIEW_VIEW_TYPE,
      (leaf: WorkspaceLeaf) =>
        new DocxPreviewView(leaf, {
          exporter: this.docxExporter,
          templateStore: this.wordTemplateStore,
          getPreviewMode: () => this.settings.docxPreviewMode,
          setPreviewMode: async (mode) => {
            this.settings.docxPreviewMode = mode;
            await this.saveSettings();
          },
          getSource: () => this.currentDocxSource(),
          preparePreviewFonts: (target) =>
            this.wordFontCatalog.applyPreviewFonts(target),
          onSaved: (saved) =>
            void this.afterExport({ format: "docx", status: "saved", vaultPath: saved.vaultPath }),
          subscribeActivity: (listener, delay) => this.activity.subscribe(listener, delay),
          followCursor: () => this.settings.previewFollowCursor,
          setFollowCursor: (on) => this.setPreviewFollow(on)
        })
    );
    this.registerView(
      HANMARK_DOCUMENT_VIEW,
      (leaf: WorkspaceLeaf) =>
        new HanmarkDocumentView(leaf, {
          convertToNote: (file) => importVaultFiles(this.importHost(), [file]),
          compare: (file) => this.openCompare(file),
          formNote: (file) => createFormNoteFromFile(this.formHost(), file),
          openWithDefaultApp: Platform.isDesktopApp ? (file) => this.openWithDefaultApp(file) : undefined
        })
    );
    if (this.settings.openHangulFilesInHanmark) {
      try {
        this.registerExtensions([...HANGUL_DOCUMENT_EXTENSIONS], HANMARK_DOCUMENT_VIEW);
      } catch {
        // Another plugin already opens these extensions; "View in HanMark" in the
        // file menu still works.
      }
    }
  }

  private registerCommands(): void {
    this.addCommand({
      id: "import-hwp-document",
      name: t("command.import"),
      callback: () => this.openImportModal()
    });
    this.addCommand({
      id: "compare-documents",
      name: t("command.compare"),
      callback: () => this.openCompare()
    });
    this.addCommand({
      id: "form-note-from-hwpx",
      name: t("command.formNote"),
      callback: () => pickFormAndCreateNote(this.formHost(), this.currentMarkdownView()?.file?.path)
    });
    this.addCommand({
      id: "form-note-from-builtin",
      name: t("command.formBuiltin"),
      callback: () => createFormNoteFromBuiltin(this.formHost())
    });
    this.addCommand({
      id: "fill-form",
      name: t("command.fillForm"),
      checkCallback: (checking) => {
        const view = this.currentMarkdownView();
        const file = view?.file;
        const linked = file ? Boolean(this.app.metadataCache.getFileCache(file)?.frontmatter?.[FORM_LINK_KEY]) : false;
        if (!linked) return false;
        if (!checking) void fillFormFromNote(this.formHost(), view);
        return true;
      }
    });
    this.addCommand({
      id: "open-export-center",
      name: t("command.openExportCenter"),
      callback: () => this.openExportCenter("hwpx")
    });
    this.addCommand({
      id: "save-hwp-roundtrip",
      name: t("command.exportToHangul"),
      callback: () => this.openExportCenter("hwpx")
    });
    this.addCommand({
      id: "quick-export-hwpx",
      name: t("command.quickExportHwpx"),
      callback: () =>
        void this.jobs.run(async () => {
          const outcome = await exportKordocHwpxWithOutcome(this.app, this, { mode: "quick-hwpx" }, true);
          await this.afterExport(outcome);
          return outcome;
        })
    });
    this.addCommand({
      id: "gongmun-export-hwpx",
      name: t("command.exportGongmun"),
      callback: () => this.openExportCenter("hwpx", "gongmun")
    });
    this.addCommand({
      id: "patch-hwp-experimental",
      name: t("command.patchOriginal"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const contract = file ? readSourceContract(this.app, file) : null;
        const available =
          contract?.["hwp-source-format"] === "hwp" ||
          contract?.["hwp-source-format"] === "hwpx";
        if (available && !checking) {
          void patchSourceExperimental(this.app, this);
        }
        return available;
      }
    });
    this.addCommand({
      id: "create-clean-markdown-copy",
      name: t("command.cleanLegacyCopy"),
      checkCallback: (checking) => {
        const view = this.currentMarkdownView();
        const available = Boolean(
          view?.file && hasHanmarkSourceMetadata(view.editor.getValue())
        );
        if (available && !checking) {
          void this.createCleanLegacyMarkdownCopy();
        }
        return available;
      }
    });
    this.addCommand({
      id: "quick-hwpx-preview",
      name: t("command.toggleQuickPreview"),
      callback: () => void this.toggleQuickPreview()
    });
    this.addCommand({
      id: "manage-hwpx-templates",
      name: t("command.manageHwpxTemplates"),
      callback: () => this.openTemplateManager()
    });
    this.addCommand({
      id: "import-document-style",
      name: t("command.importHwpxTemplate"),
      callback: () => void this.importDocumentStyleAndRefresh()
    });
    this.addCommand({
      id: "edit-document-style",
      name: t("command.editHwpxTemplate"),
      callback: () => this.openDocumentStyleEditor()
    });

    // Public 1.x command IDs remain stable so hotkeys and mobile toolbar
    // configurations keep working after the legacy bundle is removed.
    this.addCommand({
      id: "export-hwpx",
      name: t("command.exportHwpx"),
      callback: () => this.openExportCenter("hwpx")
    });
    this.addCommand({
      id: "export-docx",
      name: t("command.exportDocx"),
      callback: () => this.openExportCenter("docx")
    });
    this.addCommand({
      id: "export-html",
      name: t("command.exportHtml"),
      callback: () => this.openExportCenter("html")
    });
    this.addCommand({
      id: "export-pdf",
      name: t("command.exportPdf"),
      callback: () => this.openExportCenter("pdf")
    });
    this.addCommand({
      id: "select-template",
      name: t("command.manageHwpxTemplates"),
      callback: () => this.openTemplateManager()
    });
    this.addCommand({
      id: "select-hwpx-template",
      name: t("command.manageHwpxTemplates"),
      callback: () => this.openTemplateManager()
    });
    this.addCommand({
      id: "show-setup-guide",
      name: t("command.docxSettings"),
      callback: () => this.openPluginSettings()
    });
    this.addCommand({
      id: "toggle-preview",
      name: t("command.toggleQuickPreview"),
      callback: () => void this.toggleQuickPreview()
    });
    this.addCommand({
      id: "toggle-hwp-preview",
      name: t("command.toggleQuickPreview"),
      callback: () => void this.toggleQuickPreview()
    });
    this.addCommand({
      id: "toggle-docx-preview",
      name: t("command.toggleDocxPreview"),
      callback: () => void this.toggleDocxPreview()
    });
    this.addCommand({
      id: "open-word-template-editor",
      name: t("command.manageWordTemplates"),
      callback: () => this.openWordTemplateManager()
    });
    this.addCommand({
      id: "toggle-gongmun-check-marks",
      name: t("command.toggleCheckMarks"),
      callback: () => this.gongmunCheck.toggleMarks()
    });
    this.addCommand({
      id: "toggle-toolbar",
      name: t("command.toggleToolbar"),
      callback: () => {
        const visible = this.toolbar?.toggle() ?? false;
        this.settings.showToolbarOnStartup = visible;
        void this.saveSettings();
      }
    });
    this.addCommand({
      id: "gongmun-export-all-forms",
      name: t("command.gongmunExportAllForms"),
      callback: () => void this.openGongmunBatch()
    });
    this.addCommand({
      id: "toggle-toolbar-collapse",
      name: t("command.toggleToolbarCollapse"),
      callback: () => this.toolbar?.toggleCollapsed()
    });
    for (let level = 1; level <= 6; level += 1) registerHeadingCommand(this, level);
    this.addCommand({
      id: "set-paragraph",
      name: t("command.setParagraph"),
      editorCallback: (editor) => editorFormatting.setParagraph(editor)
    });
  }

  /** Reads the active Word template's name in the background (the store is asynchronous). */
  private refreshWordTemplateLabel(): void {
    const id = this.settings.activeWordTemplateId;
    if (id === "default") return;
    void this.wordTemplateStore
      .readActiveTemplate()
      .then((template) => {
        this.wordTemplateLabel = { id: template.id, name: template.name };
      })
      .catch(() => {
        this.wordTemplateLabel = null;
      });
  }

  /** Never shows the internal id: the built-in name, the stored name, or a generic label. */
  private activeWordTemplateName(): string {
    const id = this.settings.activeWordTemplateId;
    if (id === "default") return t("exportFlow.defaultWordTemplate");
    return this.wordTemplateLabel?.id === id ? this.wordTemplateLabel.name : t("export.docx.currentTemplate");
  }

  private openExportCenter(initialFormat: HanmarkExportFormat, initialVariant: HwpxExportVariant = "quick"): void {
    this.refreshWordTemplateLabel();
    new HanmarkExportModal(
      this.app,
      {
        activeTemplateId: () => activeTemplateId(this),
        templateChoices: () =>
          availableDocumentTemplates(this).map(({ id, name }) => ({ id, name })),
        activeTemplateSummary: () => {
          const template = activeDocumentTemplate(this);
          const kind = template.builtIn
            ? t("exportFlow.template.builtIn")
            : t("exportFlow.template.custom");
          const style = template.documentStyle
            ? t("exportFlow.template.withStyle")
            : t("exportFlow.template.kordocDefault");
          const tables = template.tableStyle?.tables?.length
            ? t("exportFlow.template.tableStyles", { count: template.tableStyle.tables.length })
            : t("exportFlow.template.noTableStyles");
          return `${kind} · ${style} · ${tables}`;
        },
        selectTemplate: async (id) => {
          await setActiveDocumentTemplate(this, id);
          this.refreshPreviews();
        },
        openTemplateManager: () => this.openTemplateManager(),
        exportKordoc: (mode, preset, formId) =>
          this.jobs.run(async () => {
            const note = this.currentMarkdownView()?.file?.path;
            if (mode === "gongmun-hwpx" && !(await this.gongmunCheck.preflight(preset))) return { format: "hwpx", status: "cancelled" };
            const outcome = await exportKordocHwpxWithOutcome(this.app, this, {
              mode,
              gongmunPreset: preset,
              gongmunFormId: mode === "gongmun-hwpx" ? formId : undefined
            });
            await this.afterExport(outcome, mode === "gongmun-hwpx" ? formId : undefined, note);
            return outcome;
          }),
        runOther: (mode) =>
          this.jobs.run(async () => {
            const outcome = await this.runOtherExport(mode);
            await this.afterExport(outcome);
            return outcome;
          }),
        openPreview: () => this.toggleQuickPreview(false, { kind: "quick" }),
        openDocxPreview: () => this.toggleDocxPreview(false),
        activeWordTemplateName: () => this.activeWordTemplateName(),
        openPandocSettings: () => this.openPluginSettings(),
        activeHtmlTheme: () => this.settings.htmlExportTheme,
        setHtmlTheme: async (theme) => {
          const previous = this.settings.htmlExportTheme;
          this.settings.htmlExportTheme = theme;
          try {
            await this.saveSettings();
          } catch (error) {
            this.settings.htmlExportTheme = previous;
            throw error;
          }
        },
        pdfThemeChoices: () =>
          listEditorialPdfThemeSnapshots(
            this.settings.editorialPdfThemeLibrary
          ),
        activePdfTheme: () =>
          activeEditorialPdfThemeSnapshot(
            this.settings.editorialPdfThemeLibrary
          ),
        selectPdfTheme: async (id) => {
          await this.replaceEditorialPdfThemeLibrary(
            setActiveEditorialPdfTheme(
              this.settings.editorialPdfThemeLibrary,
              id
            )
          );
        },
        openPdfThemeManager: (mode) =>
          this.openEditorialPdfThemeManager(mode),
        activePdfLayout: () => normalizeEditorialPdfLayout(this.settings.editorialPdfLayout),
        exportPdf: async (layout, nativePrint) => this.jobs.run(() => this.exportEditorialPdf(layout, nativePrint)),
        savePdf: async (prepared) => {
          const saved = await this.gateway.saveFile(prepared.bytes, prepared.fileName);
          return {
            format: "pdf",
            status: saved.cancelled ? "cancelled" : saved.method === "download" ? "delegated" : "saved",
            fileName: saved.fileName, displayPath: saved.displayPath,
            delivery: saved.method === "download" ? "download" : undefined
          };
        },
        revealOutput: (outcome) => this.revealExportOutput(outcome),
        gongmunForms: () => listGongmunForms(this),
        gongmunPicker: () => this.gongmunPickerHost(),
        describeGongmunForm: (id) => describeGongmunForm(this, id),
        noteLookHint: () => noteLookHint(this.app, this.currentMarkdownView()?.file),
        currentGongmunForm: () => this.currentGongmunForm(this.currentMarkdownView()?.file),
        selectGongmunForm: (id) => this.selectGongmunForm(id),
        editGongmunForm: (id, preset, changed) => this.openGongmunStyle(id, changed, preset),
        notePresetHint: () => notePresetHint(this.app, this.currentMarkdownView()?.file),
        insertGongmunProperties: (preset) => this.insertGongmunProperties(preset),
        lintGongmun: (preset) => this.openGongmunLint(preset),
        openGongmunPreview: (preset, formId) => this.toggleQuickPreview(false, { kind: "gongmun", preset, formId }),
        openGongmunBatch: () => void this.openGongmunBatch(),
        applySkin: (root) => applyToolbarSkin(root, this.settings)
      },
      initialFormat,
      initialVariant
    ).open();
  }

  private openGongmunStyle(id: string | null, changed: (activeId: string) => void = () => {}, initialPreset?: GongmunPreset): void {
    new GongmunStyleModal(
      this.app,
      {
        templateHost: this,
        gateway: this.gateway,
        lookPicker: () => this.gongmunPickerHost(),
        changed: (activeId) => {
          changed(activeId);
          this.refreshPreviews();
        }
      },
      id,
      initialPreset
    ).open();
  }

  /**
   * The official-document form a note starts with: the form last chosen for this note
   * (R-028) while it still exists, else the active institution form, the note's type,
   * or the last type (R-026).
   */
  private currentGongmunForm(file: TFile | null | undefined): string {
    if (file) {
      const remembered = rememberedNoteForm(this.settings.gongmunFormByNote, file.path, (id) => isGongmunForm(this, id));
      const form = remembered ? describeGongmunForm(this, remembered) : undefined;
      if (form) return form.id;
    }
    return currentGongmunFormId(this, notePresetHint(this.app, file), noteLookHint(this.app, file));
  }

  /** The frame and look picker's host (R-030): this plugin's library, and favorites that save. */
  private gongmunPickerHost(): GongmunPickerHost {
    return {
      library: this,
      toggleFavorite: async (look) => {
        toggleGongmunLookFavoriteInMemory(this, look);
        await this.saveSettings();
      }
    };
  }

  /**
   * Makes a form active everywhere (export window and preview), remembers it for the
   * note (the given one, else the note being edited), and returns its type.
   */
  private async selectGongmunForm(id: string, file?: TFile | null): Promise<GongmunPreset> {
    const preset = selectGongmunFormInMemory(this, id);
    const note = file ?? this.currentMarkdownView()?.file;
    const formId = describeGongmunForm(this, id)?.id ?? id;
    if (note) this.settings.gongmunFormByNote = rememberNoteForm(this.settings.gongmunFormByNote, note.path, formId);
    await this.saveSettings();
    this.refreshPreviews();
    this.statusBar?.refresh(false);
    return preset;
  }

  /**
   * After an export: a file HanMark wrote into the vault joins the recent exports, and
   * an official document remembers its form for the note (R-028).
   */
  private async afterExport(outcome: unknown, formId?: string, notePath?: string): Promise<void> {
    if (!outcome || typeof outcome !== "object") return;
    const result = outcome as Partial<HanmarkExportOutcome> & { format?: string };
    if (result.status !== "saved") return;
    let changed = false;
    if (result.vaultPath && isRecentExportFormat(result.format)) {
      this.settings.recentExports = recordRecentExport(this.settings.recentExports, {
        path: result.vaultPath,
        format: result.format,
        at: Date.now()
      });
      changed = true;
    }
    const exported = formId ? describeGongmunForm(this, formId) : undefined;
    if (exported && notePath) {
      this.settings.gongmunFormByNote = rememberNoteForm(this.settings.gongmunFormByNote, notePath, exported.id);
      changed = true;
    }
    if (exported && recordGongmunLookUseInMemory(this, exported.look)) changed = true;
    if (changed) {
      await this.saveSettings();
      this.startPanels?.sync();
    }
  }

  /**
   * Several forms at once (R-028): one snapshot of the note, each checked form saved
   * beside it and named after the form; the global and remembered forms stay as they are.
   */
  private async openGongmunBatch(): Promise<void> {
    // One check for the note, whatever the number of forms.
    if (!(await this.gongmunCheck.preflight(undefined))) return;
    const snapshot = await readExportSnapshot(this.app, this);
    if (!snapshot) return;
    new GongmunBatchModal(this.app, {
      forms: listGongmunForms(this),
      listForms: (look) => listGongmunForms(this, formatGongmunFormId(gongmunFormChoice("report", look))),
      chooseLook: (current, pick, frame) =>
        new GongmunLookModal(this.app, {
          host: this.gongmunPickerHost(),
          frame: frame ?? "report",
          current,
          // A row's own look is 기본, 공통, or an agency; forms made for one type have rows of their own.
          filter: (look) => look.kind === "basic" || look.kind === "common" || look.kind === "agency",
          pick
        }).open(),
      currentFormId: this.currentGongmunForm(snapshot.file),
      noteName: snapshot.file.basename,
      run: async (forms, hooks) => {
        const entries = await this.jobs.run(() =>
          runGongmunBatch(forms, (form, allow) => exportGongmunFormBesideNote(this.app, this, snapshot, form.id, allow), {
            ...hooks,
            isImageFailure: (error) => error instanceof ImageResolutionError,
            decideImageFailures: async (error) =>
              (await chooseImageFailureAction(this.app, (error as ImageResolutionError).failures)) === "cancel" ? "cancel" : "continue",
            describeError: (error) => errorMessage(error),
            onEntry: (entry, index) => {
              hooks.onEntry?.(entry, index);
              const path = entry.result?.vaultPath;
              if (entry.status === "saved" && path) {
                this.settings.recentExports = recordRecentExport(this.settings.recentExports, { path, format: "hwpx", at: Date.now() });
                if (entry.form.look !== LOOK_BASIC) recordGongmunLookUseInMemory(this, entry.form.look);
              }
            }
          })
        );
        await this.saveSettings();
        return entries;
      },
      open: (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) void this.app.workspace.getLeaf(true).openFile(file);
      },
      reveal: Platform.isDesktopApp ? (path) => this.revealVaultNote(path) : undefined
    }).open();
  }

  /** Remembered forms and recent exports follow renamed and deleted notes and folders. */
  private followVaultChanges(): void {
    let pending: number | null = null;
    const saveSoon = (): void => {
      if (pending !== null) window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        pending = null;
        void this.saveSettings();
      }, 1000);
    };
    const apply = (forms: FormMemory, recent: RecentExport[]): void => {
      const before = JSON.stringify([this.settings.gongmunFormByNote, this.settings.recentExports]);
      if (before === JSON.stringify([forms, recent])) return;
      this.settings.gongmunFormByNote = forms;
      this.settings.recentExports = recent;
      saveSoon();
      this.startPanels?.sync();
    };
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        apply(
          renameNotePaths(this.settings.gongmunFormByNote, oldPath, file.path),
          renameRecentExports(this.settings.recentExports, oldPath, file.path)
        );
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        apply(
          forgetNotePaths(this.settings.gongmunFormByNote, file.path),
          forgetRecentExports(this.settings.recentExports, file.path)
        );
      })
    );
    this.register(() => {
      if (pending !== null) window.clearTimeout(pending);
    });
  }

  /** The preview opens as it was last used: quick HWPX, or the current official-document form. */
  private rememberedPreviewMode(): QuickPreviewMode {
    if (this.settings.hwpxPreviewMode !== "gongmun") return { kind: "quick" };
    const id = this.currentGongmunForm(this.currentMarkdownView()?.file);
    const preset = describeGongmunForm(this, id)?.preset ?? "report";
    return { kind: "gongmun", preset, formId: id };
  }

  private async rememberPreviewMode(kind: QuickPreviewMode["kind"]): Promise<void> {
    this.statusBar?.refresh(false);
    if (this.settings.hwpxPreviewMode === kind) return;
    this.settings.hwpxPreviewMode = kind;
    await this.saveSettings();
  }

  /** Adds the empty properties an official-document type uses (never overwrites). */
  private async insertGongmunProperties(preset: GongmunPreset): Promise<void> {
    const file = this.currentMarkdownView()?.file;
    if (!file) {
      new Notice(t("gongmun.lint.noNote"));
      return;
    }
    const keys = new Set(gongmunPropertyKeysFor(preset));
    let added = 0;
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      const presetSpec = GONGMUN_PROPERTIES.find((spec) => spec.key === GONGMUN_PRESET_PROPERTY_KEY);
      if (!(GONGMUN_PRESET_PROPERTY_KEY in frontmatter) && !(presetSpec && presetSpec.alias in frontmatter)) {
        frontmatter[GONGMUN_PRESET_PROPERTY_KEY] = GONGMUN_PRESET_KOREAN_NAMES[preset];
        added += 1;
      }
      for (const spec of GONGMUN_PROPERTIES) {
        if (!keys.has(spec.key) || spec.key in frontmatter || spec.alias in frontmatter) continue;
        // 공문_기관서식 starts with the agency look chosen for this note, when there is one (R-030).
        frontmatter[spec.key] =
          spec.kind === "list" || spec.kind === "people"
            ? []
            : spec.kind === "look"
              ? (agencyOfLook(describeGongmunForm(this, this.currentGongmunForm(file))?.look ?? "") ?? "")
              : "";
        added += 1;
      }
    });
    new Notice(added ? t("gongmun.export.propertiesInserted", { count: added }) : t("gongmun.export.propertiesAlready"));
  }

  private openGongmunLint(preset: GongmunPreset): void {
    this.gongmunCheck.openWindow(preset);
  }

  private openEditorialPdfThemeManager(
    mode: "manage" | "create" = "manage"
  ): void {
    new EditorialPdfThemeManagerModal(this.app, {
      fileGateway: this.gateway,
      getLibrary: () => this.settings.editorialPdfThemeLibrary,
      replaceLibrary: (library) =>
        this.replaceEditorialPdfThemeLibrary(library),
      onChanged: () => this.settingTab?.refresh(),
      startInCreate: mode === "create"
    }).open();
  }

  private async replaceEditorialPdfThemeLibrary(
    library: EditorialPdfThemeLibraryV1
  ): Promise<void> {
    const previous = this.settings.editorialPdfThemeLibrary;
    this.settings.editorialPdfThemeLibrary =
      normalizeEditorialPdfThemeLibrary(library);
    try {
      await this.saveSettings();
    } catch (error) {
      this.settings.editorialPdfThemeLibrary = previous;
      throw error;
    }
  }

  private async runOtherExport(
    mode: "docx" | "html"
  ): Promise<HanmarkExportOutcome | null> {
    const source = this.currentDocxSource();
    if (!source) {
      new Notice(t("exportFlow.openNote"));
      return null;
    }
    if (mode === "docx") {
      const progress = new Notice(
        t(this.docxExporter.engine === "pandoc" ? "exportFlow.docx.creatingPandoc" : "exportFlow.docx.creating"),
        0
      );
      try {
        const result = await this.docxExporter.exportUserInitiated(
          source,
          createUserInitiatedAction("modal")
        );
        if (!result.saved.cancelled) {
          new Notice(t("exportFlow.docx.saved", { path: String(result.saved.displayPath) }));
        }
        return {
          format: "docx",
          status: result.saved.cancelled ? "cancelled" : "saved",
          fileName: result.saved.fileName,
          displayPath: result.saved.displayPath,
          vaultPath: result.saved.vaultPath,
          ...(result.warnings.length ? { warnings: result.warnings } : {})
        };
      } catch (error) {
        if (error instanceof DocxExportCancelled) return { format: "docx", status: "cancelled" };
        new Notice(t("exportFlow.docx.failed", { detail: errorMessage(error) }), 8_000);
        return null;
      } finally {
        progress.hide();
      }
    }

    const view = this.currentMarkdownView();
    if (!view?.file) {
      new Notice(t("exportFlow.html.openNote"));
      return null;
    }
    const body = await this.prepareExportBody(view.file, extractEditableBodyStrict(source.markdown));
    const progress = new Notice(t("exportFlow.html.embedding"), 0);
    try {
      let prepared: Awaited<
        ReturnType<typeof prepareSelfContainedHtmlMarkdown>
      >;
      while (true) {
        prepared = await prepareSelfContainedHtmlMarkdown(body, {
          loader: createObsidianImageLoader(this.app, view.file),
          outputLanguage: this.settings.outputLanguage,
          onProgress: (imageProgress) => {
            const counts = { completed: imageProgress.completed, total: imageProgress.total };
            progress.setMessage(
              imageProgress.status === "embedded"
                ? t("exportFlow.html.progressEmbedded", counts)
                : t("exportFlow.html.progressFailed", counts)
            );
          }
        });
        if (!prepared.failures.length) break;
        progress.setMessage(t("exportFlow.html.someMissing"));
        const action = await chooseHtmlImageFailureAction(
          this.app,
          prepared.failures
        );
        if (action === "cancel") {
          return { format: "html", status: "cancelled" };
        }
        if (action === "continue") break;
        progress.setMessage(t("exportFlow.html.retrying"));
      }
      progress.setMessage(t("exportFlow.html.saving"));
      const bytes = renderStandaloneHtmlBytes(prepared.markdown, {
        title: source.title,
        documentStyle: activeDocumentStyle(this),
        theme: this.settings.htmlExportTheme,
        language: resolveOutputLocale(this.settings.outputLanguage, prepared.markdown)
      });
      const saved = source.sourcePath
        ? await this.gateway.saveVaultSibling(
            bytes,
            `${source.title}_html.html`,
            source.sourcePath
          )
        : await this.gateway.saveFile(bytes, `${source.title}_html.html`);
      if (!saved.cancelled) {
        new Notice(t("exportFlow.html.saved", { path: String(saved.displayPath) }));
      }
      const warnings: string[] = [];
      if (prepared.embeddedCount) {
        warnings.push(
          `${t("save.note.images", { count: prepared.embeddedCount })}${
            prepared.embeddedOccurrences > prepared.embeddedCount
              ? t("preview.quick.imagePlacements", { count: prepared.embeddedOccurrences })
              : ""
          }`
        );
      }
      if (prepared.failures.length) {
        warnings.push(t("save.note.imagesMissing", { count: prepared.failures.length }));
      }
      return {
        format: "html",
        status: saved.cancelled ? "cancelled" : "saved",
        fileName: saved.fileName,
        displayPath: saved.displayPath,
        vaultPath: saved.vaultPath,
        warnings
      };
    } finally {
      progress.hide();
    }
  }

  private async exportEditorialPdf(
    layout = normalizeEditorialPdfLayout(this.settings.editorialPdfLayout),
    nativePrint = false
  ): Promise<HanmarkExportOutcome | PreparedPdf | null> {
    const view = this.currentMarkdownView();
    if (!view?.file) {
      new Notice(t("exportFlow.pdf.openNote"));
      return null;
    }
    const file = view.file;
    const theme = activeEditorialPdfThemeSnapshot(this.settings.editorialPdfThemeLibrary);
    const body = await this.prepareExportBody(file, extractEditableBodyStrict(view.editor.getValue()), editorialPdfDiagramPaper(theme));
    const fileName = file.basename;
    const layoutSnapshot: EditorialPdfLayout = normalizeEditorialPdfLayout(layout);
    const progress = new Notice(t("exportFlow.pdf.preparingImages"), 0);
    try {
      let prepared: Awaited<
        ReturnType<typeof prepareSelfContainedHtmlMarkdown>
      >;
      while (true) {
        prepared = await prepareSelfContainedHtmlMarkdown(body, {
          loader: createObsidianImageLoader(this.app, file),
          outputLanguage: this.settings.outputLanguage,
          onProgress: (imageProgress) => {
            const counts = { completed: imageProgress.completed, total: imageProgress.total };
            progress.setMessage(
              imageProgress.status === "embedded"
                ? t("exportFlow.pdf.progressEmbedded", counts)
                : t("exportFlow.pdf.progressFailed", counts)
            );
          }
        });
        if (!prepared.failures.length) break;
        progress.setMessage(t("exportFlow.pdf.someMissing"));
        const action = await choosePdfImageFailureAction(
          this.app,
          prepared.failures
        );
        if (action === "cancel") {
          return { format: "pdf", status: "cancelled" };
        }
        progress.setMessage(t("exportFlow.pdf.retrying"));
      }
      progress.setMessage(nativePrint ? t("exportFlow.pdf.openingPrint") : t("exportFlow.pdf.generating"));
      const request = {
        markdown: prepared.markdown,
        fileName, theme, layout: layoutSnapshot,
        outputLanguage: this.settings.outputLanguage
      };
      if (nativePrint) return { ...await this.editorialPdf.print(request), delivery: "print" };
      const bytes = await this.editorialPdf.generate(request, createDesktopPdfOutputAdapter());
      return { format: "pdf", status: "ready", fileName: `${fileName}_pdf.pdf`, bytes };
    } catch (error) {
      new Notice(t("exportFlow.pdf.failed", { detail: errorMessage(error) }), 8_000);
      return null;
    } finally {
      progress.hide();
    }
  }

  /**
   * One audited boundary for Obsidian's registered-command dispatcher.
   * Import integrations receive this bound plugin method instead of reaching
   * into another plugin object or command registry themselves.
   */
  executeCommandById(id: string): boolean {
    const commands = (this.app as unknown as AppWithCommands).commands;
    return commands.executeCommandById(id);
  }

  private async revealExportOutput(
    outcome: HanmarkExportOutcome
  ): Promise<void> {
    if (!Platform.isDesktopApp) {
      throw new Error(t("exportFlow.reveal.desktopOnly"));
    }
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error(t("exportFlow.reveal.noFileSystem"));
    }
    const output = trustSavedVaultOutput(outcome);
    if (!output) {
      throw new Error(t("exportFlow.reveal.notSavedInVault"));
    }
    await revealVaultOutputUserInitiated(
      {
        output,
        platform: runtimePlatform(),
        resolveVaultPath: (vaultPath) => adapter.getFullPath(vaultPath)
      },
      createUserInitiatedAction("modal")
    );
  }

  /**
   * Opens (or closes) the HWPX preview. Without `mode` it opens as it was last used;
   * a mode chosen in the export window is remembered for the next time.
   */
  private async toggleQuickPreview(closeWhenOpen = true, mode?: QuickPreviewMode): Promise<void> {
    if (mode) await this.rememberPreviewMode(mode.kind);
    const target = mode ?? this.rememberedPreviewMode();
    const existing = this.app.workspace.getLeavesOfType(QUICK_HWPX_PREVIEW_VIEW);
    if (existing.length) {
      if (closeWhenOpen) {
        existing.forEach((leaf) => leaf.detach());
      } else {
        this.app.workspace.setActiveLeaf(existing[0], { focus: true });
        if (existing[0].view instanceof QuickHwpxPreviewView) existing[0].view.setMode(target);
      }
      return;
    }
    const leaf = this.app.workspace.getLeaf("split", "vertical");
    await leaf.setViewState({ type: QUICK_HWPX_PREVIEW_VIEW, active: true });
    if (leaf.view instanceof QuickHwpxPreviewView) leaf.view.setMode(target);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  currentMarkdownView(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active?.file) {
      this.lastMarkdownView = active;
      return active;
    }
    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    if (
      this.lastMarkdownView?.file &&
      markdownLeaves.some((leaf) => leaf === this.lastMarkdownView?.leaf)
    ) {
      return this.lastMarkdownView;
    }
    const fallback = markdownLeaves
      .map((leaf) => leaf.view)
      .find((view): view is MarkdownView => view instanceof MarkdownView && Boolean(view.file));
    if (fallback) this.lastMarkdownView = fallback;
    else this.lastMarkdownView = null;
    return fallback ?? null;
  }

  private currentDocxSource(): DocxSource | null {
    const view = this.currentMarkdownView();
    if (!view?.file) return null;
    return {
      markdown: view.editor.getValue(),
      title: view.file.basename,
      sourcePath: view.file.path
    };
  }

  private async toggleDocxPreview(closeWhenOpen = true): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DOCX_PREVIEW_VIEW_TYPE);
    if (existing.length) {
      if (closeWhenOpen) {
        existing.forEach((leaf) => leaf.detach());
      } else {
        this.app.workspace.setActiveLeaf(existing[0], { focus: true });
        if (existing[0].view instanceof DocxPreviewView) {
          await existing[0].view.showUserInitiatedPreview();
        }
      }
      return;
    }
    const leaf = this.app.workspace.getLeaf("split", "vertical");
    await leaf.setViewState({ type: DOCX_PREVIEW_VIEW_TYPE, active: true });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (leaf.view instanceof DocxPreviewView) {
      await leaf.view.showUserInitiatedPreview();
    }
  }

  private async createCleanLegacyMarkdownCopy(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension.toLowerCase() !== "md") {
      new Notice(t("legacy.openNote"));
      return;
    }
    try {
      const result = await createCleanLegacyImportCopy(this.app, file);
      await this.app.workspace.getLeaf().openFile(result.file);
      new Notice(t("legacy.copyCreated", { path: result.file.path }));
    } catch (error) {
      new Notice(t("legacy.copyFailed", { detail: errorMessage(error) }));
    }
  }

  /**
   * The status bar (R-028): the note's character count, recounted after edits and
   * reused while only the cursor moves, and the note's official-document form.
   */
  private installStatusBar(): void {
    this.statusBar = new HanmarkStatusBar({
      addItem: () => this.addStatusBarItem(),
      currentView: () => this.currentMarkdownView(),
      showCount: () => this.settings.statusCharCount,
      showForm: () => this.settings.statusGongmunForm,
      forms: (base) => listGongmunForms(this, base),
      describeForm: (id) => describeGongmunForm(this, id),
      chooseLook: (file) => {
        const form = describeGongmunForm(this, this.currentGongmunForm(file));
        if (!form) return;
        new GongmunLookModal(this.app, {
          host: this.gongmunPickerHost(),
          frame: form.frame,
          current: form.look,
          pick: (look) => void this.selectGongmunForm(withGongmunLook(this, form.id, look), file)
        }).open();
      },
      formFor: (file) => this.statusFormFor(file),
      selectForm: async (id, file) => {
        await this.selectGongmunForm(id, file);
      }
    });
    this.register(
      this.activity.subscribe((activity) => {
        if (activity.view && activity.view === this.currentMarkdownView()) this.statusBar?.refresh(activity.docChanged);
      }, 250)
    );
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.statusBar?.refresh()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.statusBar?.refresh()));
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file === this.currentMarkdownView()?.file) this.statusBar?.refresh(false);
      })
    );
  }

  /** HanMark's section on empty tabs: import, a new note, and recent exports (R-028). */
  private installStartPanels(): void {
    const panels = new StartPanels({
      app: this.app,
      enabled: () => this.settings.showStartPanel,
      recentExports: () => this.settings.recentExports,
      importDocument: () => this.openImportModal(),
      newNote: () => {
        this.executeCommandById("file-explorer:new-file");
      },
      openHwpx: (file, leaf) =>
        void leaf.setViewState({ type: HANMARK_DOCUMENT_VIEW, state: { file: file.path }, active: true }),
      reveal: Platform.isDesktopApp
        ? (path) => {
            void this.revealVaultNote(path).catch((error: unknown) => new Notice(errorMessage(error)));
          }
        : undefined
    });
    this.startPanels = panels;
    const sync = (): void => panels.sync();
    this.app.workspace.onLayoutReady(sync);
    this.registerEvent(this.app.workspace.on("layout-change", sync));
    this.registerEvent(this.app.workspace.on("active-leaf-change", sync));
    this.register(() => panels.removeAll());
  }

  /**
   * The form for the status bar, only for a note with an official-document context: a
   * form remembered for it, a document-type property, or a preview showing a form.
   */
  private statusFormFor(file: TFile): string | null {
    const remembered = rememberedNoteForm(this.settings.gongmunFormByNote, file.path, (id) => isGongmunForm(this, id));
    const previewing = this.app.workspace
      .getLeavesOfType(QUICK_HWPX_PREVIEW_VIEW)
      .some((leaf) => leaf.view instanceof QuickHwpxPreviewView && leaf.view.showsForm());
    if (!remembered && !notePresetHint(this.app, file) && !previewing) return null;
    return this.currentGongmunForm(file);
  }

  /** Turns following the cursor on or off for every preview (R-028). */
  private async setPreviewFollow(on: boolean): Promise<void> {
    this.settings.previewFollowCursor = on;
    await this.saveSettings();
    this.refreshPreviewControls();
  }

  /** Redraws the previews' navigation rows without redrawing the previews. */
  private refreshPreviewControls(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(QUICK_HWPX_PREVIEW_VIEW)) {
      if (leaf.view instanceof QuickHwpxPreviewView) leaf.view.refreshControls();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(DOCX_PREVIEW_VIEW_TYPE)) {
      if (leaf.view instanceof DocxPreviewView) leaf.view.refreshControls();
    }
  }

  private refreshPreviews(): void {
    this.app.workspace
      .getLeavesOfType(QUICK_HWPX_PREVIEW_VIEW)
      .forEach((leaf) => {
        if (leaf.view instanceof QuickHwpxPreviewView) leaf.view.forceRefresh();
      });
    this.app.workspace
      .getLeavesOfType(DOCX_PREVIEW_VIEW_TYPE)
      .forEach((leaf) => {
        if (leaf.view instanceof DocxPreviewView) leaf.view.forceRefresh();
      });
  }

  private async importDocumentStyleAndRefresh(): Promise<void> {
    if (await importDocumentStyle(this)) {
      this.refreshPreviews();
      this.settingTab?.refresh();
    }
  }

  /** Opens the style editor on `profile`, or on the active template under its displayed name. */
  private openDocumentStyleEditor(profile?: DocumentStyleProfile): void {
    const active = activeDocumentTemplate(this);
    const name = templateDisplayName(active);
    const initial = profile ?? editableDocumentStyle({
      name,
      documentStyle: active.documentStyle && { ...active.documentStyle, name }
    });
    new DocumentStyleModal(this.app, initial, async (savedProfile) => {
      await saveDocumentStyle(this, savedProfile);
      this.refreshPreviews();
      this.settingTab?.refresh();
    }).open();
  }

  private openTemplateManager(): void {
    new HwpxTemplateManagerModal(
      this.app,
      this,
      (profile) => this.openDocumentStyleEditor(profile),
      () => {
        this.refreshPreviews();
        this.settingTab?.refresh();
      },
      this.gateway
    ).open();
  }

  private openWordTemplateManager(): void {
    new WordTemplateManagerModal(this.app, {
      store: this.wordTemplateStore,
      fileGateway: this.gateway,
      fontCatalog: this.wordFontCatalog,
      onChanged: async () => {
        await this.saveSettings();
        this.refreshPreviews();
        this.settingTab?.refresh();
      },
      onFontCatalogChanged: async () => {
        await this.saveSettings();
        this.refreshPreviews();
        this.settingTab?.refresh();
      }
    }).open();
  }

  private openPluginSettings(): void {
    const controller = (this.app as unknown as AppWithSettings).setting;
    controller.open();
    controller.openTabById(this.manifest.id);
  }
}
import { createDesktopPdfOutputAdapter, type PreparedPdf } from "./io/pdfOutputAdapter";
import { normalizeEditorialPdfLayout, type EditorialPdfLayout } from "./io/editorialPdfLayout";
