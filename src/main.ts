import {
  FileSystemAdapter,
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  type Editor,
  type WorkspaceLeaf
} from "obsidian";
import { registerEditorCompatibilityCommands } from "./editorCommands";
import { createWordTemplateStorage, DocxExportService, type DocxSource } from "./io/docxExport";
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
  defaultDocumentStyleProfile,
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
import { importDocument } from "./io/kordocImport";
import {
  exportKordocHwpx,
  exportKordocHwpxWithOutcome,
  patchSourceExperimental,
  patchSourceExperimentalWithOutcome
} from "./io/kordocSave";
import {
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
import { HanmarkExportModal } from "./ui/HanmarkExportModal";
import {
  HanmarkSettingTab
} from "./ui/HanmarkSettingTab";
import { HwpxTemplateManagerModal } from "./ui/HwpxTemplateManagerModal";
import {
  QuickHwpxPreviewView,
  QUICK_HWPX_PREVIEW_VIEW
} from "./ui/QuickHwpxPreviewView";
import {
  applyToolbarSkin,
  editorFormatting,
  ToolbarController
} from "./ui/ToolbarController";
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

function runtimePlatform(): HanmarkRuntimePlatform {
  if (Platform.isWin) return "windows";
  if (Platform.isMacOS) return "macos";
  return "linux";
}

function registerHeadingCommand(plugin: Plugin, level: number): void {
  plugin.addCommand({
    id: `set-heading-${level}`,
    name: `제목 ${level} 적용`,
    editorCallback: (editor: Editor) => editorFormatting.setHeading(editor, level)
  });
}

/**
 * HanMark 2.4.4 runtime.
 *
 * HWPX is generated in-process by Kordoc. The single external process boundary
 * is used only after an explicit user action: optional Pandoc/Word conversion
 * or revealing a newly saved Vault result in the operating-system file manager.
 */
export default class HanmarkPlugin extends Plugin {
  settings: HanmarkSettings = { ...DEFAULT_HANMARK_SETTINGS };

  private gateway!: FileGateway;
  private wordTemplateStore!: WordTemplateStore;
  private wordFontCatalog!: WordFontCatalog;
  private docxExporter!: DocxExportService;
  private toolbar: ToolbarController | null = null;
  private settingTab: HanmarkSettingTab | null = null;
  private lastMarkdownView: MarkdownView | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
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
    this.docxExporter = new DocxExportService({
      app: this.app,
      pluginId: this.manifest.id,
      fileGateway: this.gateway,
      templateStore: this.wordTemplateStore,
      getPandocPath: () => this.settings.pandocPath
    });

    this.registerViews();
    this.registerCommands();
    registerEditorCompatibilityCommands(this);
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof MarkdownView && leaf.view.file) {
          this.lastMarkdownView = leaf.view;
        }
      })
    );
    const initialMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (initialMarkdownView?.file) this.lastMarkdownView = initialMarkdownView;

    this.toolbar = new ToolbarController(
      this,
      {
        importDocument: () => void importDocument(this.app, this),
        openHwpxExport: () => this.openExportCenter("hwpx"),
        openDocxExport: () => this.openExportCenter("docx"),
        openHtmlExport: () => this.openExportCenter("html"),
        toggleHwpxPreview: () => void this.toggleQuickPreview(),
        openTemplateManager: () => this.openTemplateManager(),
        openSettings: () => this.openPluginSettings(),
        toggleDocxPreview: () => void this.toggleDocxPreview(),
        openWordTemplateEditor: () => this.openWordTemplateManager()
      },
      this.settings.showToolbarOnStartup,
      () => this.settings
    );
    this.toolbar.initialize();

    this.settingTab = new HanmarkSettingTab(
      this.app,
      this,
      {
        wordTemplateStore: this.wordTemplateStore,
        openHwpxTemplateManager: () => this.openTemplateManager(),
        openWordTemplateManager: () => this.openWordTemplateManager(),
        refreshPreviews: () => this.refreshPreviews(),
        refreshToolbar: () =>
          this.toolbar?.setVisible(this.settings.showToolbarOnStartup)
      }
    );
    this.addSettingTab(this.settingTab);

    this.addRibbonIcon("panel-top", "HanMark 툴바 표시·숨기기", () => {
      const visible = this.toolbar?.toggle() ?? false;
      this.settings.showToolbarOnStartup = visible;
      void this.saveSettings();
    });
    this.addRibbonIcon("file-output", "HanMark 내보내기", () => {
      this.openExportCenter("hwpx");
    });
  }

  onunload(): void {
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
    if (migrated) await this.saveData(this.settings);
  }

  private registerViews(): void {
    this.registerView(
      QUICK_HWPX_PREVIEW_VIEW,
      (leaf: WorkspaceLeaf) =>
        new QuickHwpxPreviewView(
          leaf,
          () => activeTableProfile(this),
          () => activeDocumentStyle(this),
          () => this.currentMarkdownView(),
          () => this.settings.enableLivePreview
        )
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
            this.wordFontCatalog.applyPreviewFonts(target)
        })
    );
  }

  private registerCommands(): void {
    this.addCommand({
      id: "import-hwp-document",
      name: "문서 불러오기 (HWP/HWPX/PDF/DOCX/XLS/XLSX → Markdown)",
      callback: () => void importDocument(this.app, this)
    });
    this.addCommand({
      id: "open-export-center",
      name: "내보내기",
      callback: () => this.openExportCenter("hwpx")
    });
    this.addCommand({
      id: "save-hwp-roundtrip",
      name: "한글로 다시 내보내기",
      callback: () => this.openExportCenter("hwpx")
    });
    this.addCommand({
      id: "quick-export-hwpx",
      name: "빠른 HWPX 내보내기 (설치 불필요)",
      callback: () => void exportKordocHwpx(this.app, this, { mode: "quick-hwpx" })
    });
    this.addCommand({
      id: "gongmun-export-hwpx",
      name: "공문서 HWPX 내보내기",
      callback: () => this.openExportCenter("hwpx")
    });
    this.addCommand({
      id: "patch-hwp-experimental",
      name: "원본 형식 보존 수정본 만들기",
      callback: () => void patchSourceExperimental(this.app, this)
    });
    this.addCommand({
      id: "quick-hwpx-preview",
      name: "빠른 HWPX 미리보기 열기·닫기",
      callback: () => void this.toggleQuickPreview()
    });
    this.addCommand({
      id: "manage-hwpx-templates",
      name: "HWPX 템플릿 관리",
      callback: () => this.openTemplateManager()
    });
    this.addCommand({
      id: "import-document-style",
      name: "HWPX를 사용자 템플릿으로 가져오기",
      callback: () => void this.importDocumentStyleAndRefresh()
    });
    this.addCommand({
      id: "edit-document-style",
      name: "현재 HWPX 템플릿 편집",
      callback: () => this.openDocumentStyleEditor()
    });

    // Public 1.x command IDs remain stable so hotkeys and mobile toolbar
    // configurations keep working after the legacy bundle is removed.
    this.addCommand({
      id: "export-hwpx",
      name: "HWPX 내보내기",
      callback: () => this.openExportCenter("hwpx")
    });
    this.addCommand({
      id: "export-docx",
      name: "DOCX 내보내기",
      callback: () => this.openExportCenter("docx")
    });
    this.addCommand({
      id: "export-html",
      name: "HTML 내보내기",
      callback: () => this.openExportCenter("html")
    });
    this.addCommand({
      id: "export-pdf",
      name: "PDF 내보내기",
      callback: () => this.openExportCenter("pdf")
    });
    this.addCommand({
      id: "select-template",
      name: "HWPX 템플릿 관리",
      callback: () => this.openTemplateManager()
    });
    this.addCommand({
      id: "select-hwpx-template",
      name: "HWPX 템플릿 관리",
      callback: () => this.openTemplateManager()
    });
    this.addCommand({
      id: "show-setup-guide",
      name: "DOCX·Pandoc 설정",
      callback: () => this.openPluginSettings()
    });
    this.addCommand({
      id: "toggle-preview",
      name: "빠른 HWPX 미리보기 열기·닫기",
      callback: () => void this.toggleQuickPreview()
    });
    this.addCommand({
      id: "toggle-hwp-preview",
      name: "빠른 HWPX 미리보기 열기·닫기",
      callback: () => void this.toggleQuickPreview()
    });
    this.addCommand({
      id: "toggle-docx-preview",
      name: "DOCX 미리보기 열기·닫기",
      callback: () => void this.toggleDocxPreview()
    });
    this.addCommand({
      id: "open-word-template-editor",
      name: "Word 템플릿 관리",
      callback: () => this.openWordTemplateManager()
    });
    this.addCommand({
      id: "toggle-toolbar",
      name: "도구 모음 표시·숨기기",
      callback: () => {
        const visible = this.toolbar?.toggle() ?? false;
        this.settings.showToolbarOnStartup = visible;
        void this.saveSettings();
      }
    });
    for (let level = 1; level <= 6; level += 1) registerHeadingCommand(this, level);
    this.addCommand({
      id: "set-paragraph",
      name: "본문 문단 적용",
      editorCallback: (editor) => editorFormatting.setParagraph(editor)
    });
  }

  private openExportCenter(initialFormat: HanmarkExportFormat): void {
    new HanmarkExportModal(
      this.app,
      {
        sourcePatchAvailable: () => {
          const file = this.app.workspace.getActiveFile();
          const contract = file ? readSourceContract(this.app, file) : null;
          return (
            contract?.["hwp-source-format"] === "hwp" ||
            contract?.["hwp-source-format"] === "hwpx"
          );
        },
        activeTemplateId: () => activeTemplateId(this),
        templateChoices: () =>
          availableDocumentTemplates(this).map(({ id, name }) => ({ id, name })),
        activeTemplateSummary: () => {
          const template = activeDocumentTemplate(this);
          const kind = template.builtIn ? "내장" : "사용자";
          const style = template.documentStyle ? "문서 스타일 포함" : "Kordoc 기본";
          const tables = template.tableStyle?.tables?.length
            ? `표 스타일 ${template.tableStyle.tables.length}개`
            : "표 스타일 없음";
          return `${kind} · ${style} · ${tables}`;
        },
        selectTemplate: async (id) => {
          await setActiveDocumentTemplate(this, id);
          this.refreshPreviews();
        },
        openTemplateManager: () => this.openTemplateManager(),
        exportKordoc: (mode, preset) =>
          exportKordocHwpxWithOutcome(this.app, this, {
            mode,
            gongmunPreset: preset
          }),
        patchSource: () =>
          patchSourceExperimentalWithOutcome(this.app, this),
        runOther: (mode) => this.runOtherExport(mode),
        openPreview: () => this.toggleQuickPreview(false),
        openDocxPreview: () => this.toggleDocxPreview(false),
        activeWordTemplateName: () =>
          this.settings.activeWordTemplateId === "default"
            ? "HanMark 기본 Word 템플릿"
            : this.settings.activeWordTemplateId,
        openPandocSettings: () => this.openPluginSettings(),
        exportPdf: async () => this.delegatePdfExport(),
        revealOutput: (outcome) => this.revealExportOutput(outcome),
        applySkin: (root) => applyToolbarSkin(root, this.settings)
      },
      initialFormat
    ).open();
  }

  private async runOtherExport(
    mode: "docx" | "html"
  ): Promise<HanmarkExportOutcome | null> {
    const source = this.currentDocxSource();
    if (!source) {
      new Notice("내보낼 Markdown 문서를 여세요.");
      return null;
    }
    if (mode === "docx") {
      const progress = new Notice("Pandoc으로 DOCX를 만드는 중…", 0);
      try {
        const result = await this.docxExporter.exportUserInitiated(
          source,
          createUserInitiatedAction("modal")
        );
        if (!result.saved.cancelled) {
          new Notice(`DOCX 저장 완료: ${result.saved.displayPath}`);
        }
        return {
          format: "docx",
          status: result.saved.cancelled ? "cancelled" : "saved",
          fileName: result.saved.fileName,
          displayPath: result.saved.displayPath,
          vaultPath: result.saved.vaultPath
        };
      } catch (error) {
        new Notice(`DOCX 내보내기 실패: ${errorMessage(error)}`, 8_000);
        return null;
      } finally {
        progress.hide();
      }
    }

    const bytes = renderStandaloneHtmlBytes(
      extractEditableBodyStrict(source.markdown),
      {
        title: source.title,
        documentStyle: activeDocumentStyle(this)
      }
    );
    const saved = source.sourcePath
      ? await this.gateway.saveVaultSibling(
          bytes,
          `${source.title}_html.html`,
          source.sourcePath
        )
      : await this.gateway.saveFile(bytes, `${source.title}_html.html`);
    if (!saved.cancelled) new Notice(`HTML 저장 완료: ${saved.displayPath}`);
    return {
      format: "html",
      status: saved.cancelled ? "cancelled" : "saved",
      fileName: saved.fileName,
      displayPath: saved.displayPath,
      vaultPath: saved.vaultPath
    };
  }

  private delegatePdfExport(): HanmarkExportOutcome | null {
    const source = this.currentMarkdownView();
    if (!source?.file) {
      new Notice("PDF로 내보낼 Markdown 문서를 여세요.");
      return null;
    }
    const commands = (this.app as unknown as AppWithCommands).commands;
    if (!commands.executeCommandById("workspace:export-pdf")) {
      new Notice(
        "Obsidian의 PDF 내보내기 명령을 열 수 없습니다. 데스크톱 앱을 업데이트한 뒤 다시 시도하세요.",
        8_000
      );
      return null;
    }
    return { format: "pdf", status: "delegated" };
  }

  private async revealExportOutput(
    outcome: HanmarkExportOutcome
  ): Promise<void> {
    if (!Platform.isDesktopApp) {
      throw new Error("파일 위치 보기는 Obsidian 데스크톱 앱에서만 사용할 수 있습니다.");
    }
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("현재 Vault에서는 운영체제 파일 위치를 확인할 수 없습니다.");
    }
    const output = trustSavedVaultOutput(outcome);
    if (!output) {
      throw new Error("Vault 안에 방금 저장한 파일만 위치를 열 수 있습니다.");
    }
    await revealVaultOutputUserInitiated(
      {
        output,
        platform: runtimePlatform(),
        resolveVaultPath: (vaultPath) => adapter.getFullPath(vaultPath)
      },
      createUserInitiatedAction("modal")
    );
    new Notice("파일 관리자에서 결과 위치를 열었습니다.");
  }

  private async toggleQuickPreview(closeWhenOpen = true): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(QUICK_HWPX_PREVIEW_VIEW);
    if (existing.length) {
      if (closeWhenOpen) {
        existing.forEach((leaf) => leaf.detach());
      } else {
        this.app.workspace.setActiveLeaf(existing[0], { focus: true });
      }
      return;
    }
    const leaf = this.app.workspace.getLeaf("split", "vertical");
    await leaf.setViewState({ type: QUICK_HWPX_PREVIEW_VIEW, active: true });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  private currentMarkdownView(): MarkdownView | null {
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
      }
      return;
    }
    const leaf = this.app.workspace.getLeaf("split", "vertical");
    await leaf.setViewState({ type: DOCX_PREVIEW_VIEW_TYPE, active: true });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
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

  private openDocumentStyleEditor(
    profile: DocumentStyleProfile =
      activeDocumentStyle(this) ?? defaultDocumentStyleProfile()
  ): void {
    new DocumentStyleModal(this.app, profile, async (savedProfile) => {
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
      }
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
