import {
  Notice,
  PluginSettingTab,
  Setting,
  type App,
  type Plugin
} from "obsidian";
import {
  activeDocumentTemplate,
  availableDocumentTemplates,
  setActiveDocumentTemplate
} from "../io/documentStyleSettings";
import { templateDisplayName, type TemplateLibraryHost } from "../io/templateLibrary";
import type {
  DocxEngine,
  DocxPreviewMode,
  HanmarkSettings,
  HtmlExportTheme,
  ImportedImageDestination,
  ToolbarSkin,
  ToolbarSkinMode,
  ToolbarSkinPaletteKey
} from "../legacy-port/settings";
import {
  IMPORT_PRESET_IDS,
  IMPORT_PRESET_LABELS,
  normalizeImportPreset
} from "../io/importOptions";
import {
  cloneToolbarSkin,
  normalizeImportDestination,
  normalizeImportedImageFolder,
  normalizeToolbarHex,
  normalizeToolbarSkin,
  normalizeToolbarSkinMode,
  TOOLBAR_SKIN_DARK_PRESETS,
  TOOLBAR_SKIN_DEFAULTS
} from "../legacy-port/settings";
import type { WordTemplateStore } from "../legacy-port/wordTemplateStore";
import { errorMessage } from "../utils/errors";
import {
  editorialPdfLayoutChoices,
  editorialPdfTableWidthChoices,
  normalizeEditorialPdfLayout
} from "../io/editorialPdfLayout";
import {
  normalizeLanguagePreference,
  t,
  tKey,
  type LanguagePreference,
  type MessageKey
} from "../i18n";
import { VERSION as KORDOC_VERSION } from "kordoc";
import { CHECK_FAMILIES, type CheckFamily } from "../io/gongmunCheck";
import { CHECK_FAMILY_LABELS } from "./GongmunLintModal";

const CHECK_FAMILY_DESCRIPTIONS: Readonly<Record<CheckFamily, MessageKey>> = {
  notation: "settings.gongmunCheck.notation",
  munche: "settings.gongmunCheck.munche",
  budget: "settings.gongmunCheck.budget",
  logic: "settings.gongmunCheck.logic",
  slop: "settings.gongmunCheck.slop"
};

/** The bundled Kordoc engine version, read from the engine itself. */
export const HWPX_ENGINE_VERSION: string = String(KORDOC_VERSION);

/** Language names are shown in their own language in every interface language. */
const LANGUAGE_NAMES: Readonly<Record<"ko" | "en", string>> = {
  ko: "한국어", // i18n-data
  en: "English"
};

const TOOLBAR_SKIN_COLOR_FIELDS: ReadonlyArray<{
  key: ToolbarSkinPaletteKey;
  name: MessageKey;
  description: MessageKey;
}> = [
  { key: "toolbarBg", name: "settings.skin.toolbarBg.name", description: "settings.skin.toolbarBg.desc" },
  { key: "toolbarEdge", name: "settings.skin.toolbarEdge.name", description: "settings.skin.toolbarEdge.desc" },
  { key: "buttonBorder", name: "settings.skin.buttonBorder.name", description: "settings.skin.buttonBorder.desc" },
  { key: "logoBody", name: "settings.skin.logoBody.name", description: "settings.skin.logoBody.desc" },
  { key: "logoAccent", name: "settings.skin.logoAccent.name", description: "settings.skin.logoAccent.desc" },
  { key: "logoMuted", name: "settings.skin.logoMuted.name", description: "settings.skin.logoMuted.desc" },
  { key: "logoText", name: "settings.skin.logoText.name", description: "settings.skin.logoText.desc" }
];

export interface HanmarkSettingsHost extends TemplateLibraryHost {
  app: App;
  manifest?: { id: string };
  settings: HanmarkSettings;
  saveSettings(): Promise<void>;
}

export type HanmarkSettingsPlugin = Plugin & HanmarkSettingsHost;

export interface HanmarkSettingTabActions {
  wordTemplateStore: WordTemplateStore;
  openHwpxTemplateManager(): void | Promise<void>;
  openWordTemplateManager(): void | Promise<void>;
  openEditorialPdfThemeManager(): void | Promise<void>;
  activeEditorialPdfThemeSummary(): string;
  refreshPreviews(): void | Promise<void>;
  /** Runs Pandoc's version check after the user picked the Pandoc DOCX engine. */
  checkPandoc?(): Promise<string>;
  /** Redraws the previews' navigation rows (the follow setting changed). */
  refreshPreviewControls?(): void;
  /** Redraws the status bar items (their settings changed). */
  refreshStatusBar?(): void;
  /** Adds or removes HanMark's section on empty tabs. */
  refreshStartPanels?(): void;
  refreshToolbar(): void | Promise<void>;
  /** Re-resolve the interface language after the language setting changed. */
  applyUiLanguage(): void;
}

/**
 * HanMark's settings surface, in the interface language (Korean or English).
 *
 * HWPX is always handled by the bundled Kordoc engine. Pandoc settings are
 * deliberately isolated in the optional advanced DOCX section.
 */
export class HanmarkSettingTab extends PluginSettingTab {
  private readonly host: HanmarkSettingsHost;
  private readonly actions: HanmarkSettingTabActions;
  private renderVersion = 0;

  constructor(
    app: App,
    plugin: HanmarkSettingsPlugin,
    actions: HanmarkSettingTabActions
  ) {
    super(app, plugin);
    this.host = plugin;
    this.actions = actions;
  }

  /**
   * Keep the imperative fallback for Obsidian 1.5.7 while allowing current
   * Obsidian versions to index the tab without relying on unsupported controls.
   */
  getSettingDefinitions(): [] {
    return [];
  }

  display(): void {
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    const version = ++this.renderVersion;
    const { containerEl } = this;
    containerEl.empty();
    this.renderLanguageSettings(containerEl);
    this.renderCommonExportSettings(containerEl);

    new Setting(containerEl).setName(t("settings.hwpx.heading")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.hwpx.engineName", { version: HWPX_ENGINE_VERSION }))
      .setDesc(t("settings.hwpx.engineDesc"));

    this.renderHwpxSettings(containerEl);
    this.renderImportSettings(containerEl);
    this.renderImportedImageSettings(containerEl);
    this.renderHtmlExportSettings(containerEl);
    this.renderEditorialPdfSettings(containerEl);
    this.renderPdfLayoutSettings(containerEl);
    this.renderToolbarSettings(containerEl);
    this.renderAdvancedDocxSettings(containerEl, version);
  }

  private renderLanguageSettings(container: HTMLElement): void {
    new Setting(container).setName(t("settings.language.heading")).setHeading();

    new Setting(container)
      .setName(t("settings.language.ui.name"))
      .setDesc(t("settings.language.ui.desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("auto", t("settings.language.ui.auto"))
          .addOption("ko", LANGUAGE_NAMES.ko)
          .addOption("en", LANGUAGE_NAMES.en)
          .setValue(this.host.settings.uiLanguage)
          .onChange((value) => {
            void this.changeUiLanguage(normalizeLanguagePreference(value));
          });
      });

    new Setting(container)
      .setName(t("settings.language.output.name"))
      .setDesc(t("settings.language.output.desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("auto", t("settings.language.output.auto"))
          .addOption("ko", LANGUAGE_NAMES.ko)
          .addOption("en", LANGUAGE_NAMES.en)
          .setValue(this.host.settings.outputLanguage)
          .onChange((value) => {
            void this.changeOutputLanguage(normalizeLanguagePreference(value));
          });
      });
  }

  private renderCommonExportSettings(container: HTMLElement): void {
    new Setting(container).setName(t("settings.export.heading")).setHeading();
    new Setting(container)
      .setName(t("settings.assembleEmbeds.name"))
      .setDesc(t("settings.assembleEmbeds.desc"))
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.assembleEmbeds).onChange((enabled) => {
          void this.changeAssembleEmbeds(enabled);
        });
      });
    new Setting(container)
      .setName(t("settings.mermaidDiagrams.name"))
      .setDesc(t("settings.mermaidDiagrams.desc"))
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.mermaidDiagrams).onChange((enabled) => {
          void this.changeDiagramSetting("mermaidDiagrams", enabled);
        });
      });
    new Setting(container)
      .setName(t("settings.mermaidPalette.name"))
      .setDesc(t("settings.mermaidPalette.desc"))
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.mermaidPaperPalette).onChange((enabled) => {
          void this.changeDiagramSetting("mermaidPaperPalette", enabled);
        });
      });
    this.renderCheckSettings(container);
  }

  /** Official-document checks: which families run, and the pre-flight before export (R-035). */
  private renderCheckSettings(container: HTMLElement): void {
    for (const family of CHECK_FAMILIES) {
      new Setting(container)
        .setName(t("settings.gongmunCheck.family", { family: tKey(CHECK_FAMILY_LABELS[family]) }))
        .setDesc(tKey(CHECK_FAMILY_DESCRIPTIONS[family]))
        .addToggle((toggle) => {
          toggle.setValue(this.host.settings.gongmunCheckFamilies[family]).onChange((enabled) => {
            this.host.settings.gongmunCheckFamilies = { ...this.host.settings.gongmunCheckFamilies, [family]: enabled };
            void this.host.saveSettings();
          });
        });
    }
    new Setting(container)
      .setName(t("settings.gongmunPreflight.name"))
      .setDesc(t("settings.gongmunPreflight.desc"))
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.gongmunPreflight).onChange((enabled) => {
          this.host.settings.gongmunPreflight = enabled;
          void this.host.saveSettings();
        });
      });
  }

  private async changeDiagramSetting(key: "mermaidDiagrams" | "mermaidPaperPalette", enabled: boolean): Promise<void> {
    const previous = this.host.settings[key];
    try {
      this.host.settings[key] = enabled;
      await this.host.saveSettings();
      await this.actions.refreshPreviews();
    } catch (error: unknown) {
      this.host.settings[key] = previous;
      new Notice(t("settings.mermaidDiagrams.saveFailed", { detail: errorMessage(error) }));
      this.render();
    }
  }

  private async changeAssembleEmbeds(enabled: boolean): Promise<void> {
    const previous = this.host.settings.assembleEmbeds;
    try {
      this.host.settings.assembleEmbeds = enabled;
      await this.host.saveSettings();
      await this.actions.refreshPreviews();
    } catch (error) {
      this.host.settings.assembleEmbeds = previous;
      new Notice(t("settings.assembleEmbeds.saveFailed", { detail: errorMessage(error) }));
      this.render();
    }
  }

  private renderHwpxSettings(container: HTMLElement): void {
    new Setting(container).setName(t("settings.hwpxTemplate.heading")).setHeading();

    const active = activeDocumentTemplate(this.host);
    const templates = availableDocumentTemplates(this.host);
    new Setting(container)
      .setName(t("settings.hwpxTemplate.name"))
      .setDesc(
        active.builtIn
          ? t("settings.hwpxTemplate.builtIn", { name: templateDisplayName(active) })
          : t("settings.hwpxTemplate.custom", { name: active.name })
      )
      .addDropdown((dropdown) => {
        for (const template of templates) {
          dropdown.addOption(template.id, templateDisplayName(template));
        }
        dropdown.setValue(active.id);
        dropdown.onChange((id) => {
          void this.changeHwpxTemplate(id);
        });
      })
      .addButton((button) => {
        button
          .setButtonText(t("settings.manageTemplates"))
          .setCta()
          .onClick(() => {
            void this.runAction(() => this.actions.openHwpxTemplateManager());
          });
      });
  }

  private renderImportSettings(container: HTMLElement): void {
    new Setting(container).setName(t("settings.import.heading")).setHeading();

    new Setting(container)
      .setName(t("settings.import.preset.name"))
      .setDesc(t("settings.import.preset.desc"))
      .addDropdown((dropdown) => {
        for (const id of IMPORT_PRESET_IDS) dropdown.addOption(id, tKey(IMPORT_PRESET_LABELS[id].name));
        dropdown.setValue(this.host.settings.importPreset).onChange((value) => {
          void this.saveImportSetting(() => {
            this.host.settings.importPreset = normalizeImportPreset(value);
          });
        });
      });

    const destination = this.host.settings.importDestination;
    new Setting(container)
      .setName(t("settings.import.destination.name"))
      .setDesc(t("settings.import.destination.desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("note-folder", t("settings.import.destination.noteFolder"))
          .addOption("folder", t("settings.import.destination.folder"))
          .addOption("ask", t("settings.import.destination.ask"))
          .setValue(destination.mode)
          .onChange((value) => {
            void this.saveImportSetting(() => {
              this.host.settings.importDestination = normalizeImportDestination({
                ...this.host.settings.importDestination,
                mode: value
              });
            }, true);
          });
      });

    if (destination.mode === "folder") {
      new Setting(container)
        .setName(t("settings.import.folder.name"))
        .setDesc(t("settings.import.folder.desc", { example: "Imports/HanMark" }))
        .addText((text) => {
          text
            .setPlaceholder("Imports/HanMark")
            .setValue(destination.folder)
            .onChange((value) => {
              void this.saveImportSetting(() => {
                this.host.settings.importDestination = normalizeImportDestination({
                  ...this.host.settings.importDestination,
                  folder: value
                });
              });
            });
        });
    }

    new Setting(container)
      .setName(t("settings.import.viewer.name"))
      .setDesc(t("settings.import.viewer.desc"))
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.openHangulFilesInHanmark).onChange((enabled) => {
          void this.saveImportSetting(() => {
            this.host.settings.openHangulFilesInHanmark = enabled;
          });
        });
      });
  }

  private async saveImportSetting(apply: () => void, rerender = false): Promise<void> {
    const previous = {
      importPreset: this.host.settings.importPreset,
      importDestination: this.host.settings.importDestination,
      openHangulFilesInHanmark: this.host.settings.openHangulFilesInHanmark
    };
    try {
      apply();
      await this.host.saveSettings();
      if (rerender) this.render();
    } catch (error) {
      Object.assign(this.host.settings, previous);
      new Notice(t("settings.import.saveFailed", { detail: errorMessage(error) }));
      this.render();
    }
  }

  private renderImportedImageSettings(container: HTMLElement): void {
    new Setting(container).setName(t("settings.importImages.heading")).setHeading();

    new Setting(container)
      .setName(t("settings.importImages.destination.name"))
      .setDesc(t("settings.importImages.destination.desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("vault", t("settings.importImages.destination.vault"))
          .addOption("cmds-eagle-r2", t("settings.importImages.destination.cmds"))
          .addOption("ask", t("settings.importImages.destination.ask"))
          .setValue(this.host.settings.importedImageDestination)
          .onChange((value) => {
            const destination: ImportedImageDestination =
              value === "cmds-eagle-r2" || value === "ask" ? value : "vault";
            void this.changeImportedImageDestination(destination);
          });
      });

    new Setting(container)
      .setName(t("settings.importImages.folder.name"))
      .setDesc(t("settings.importImages.folder.desc", { example: "Attachments/HanMark" }))
      .addText((text) => {
        text
          .setPlaceholder("Attachments/HanMark")
          .setValue(this.host.settings.importedImageFolder)
          .onChange((value) => {
            void this.changeImportedImageFolder(value);
          });
      });

    const fallback = container.createEl("details", {
      cls: "hanmark-r2-fallback-settings"
    });
    fallback.createEl("summary", { text: t("settings.r2.summary") });
    fallback.createEl("p", {
      cls: "setting-item-description",
      text: t("settings.r2.desc")
    });

    new Setting(fallback)
      .setName(t("settings.r2.workerUrl.name"))
      .setDesc(t("settings.r2.workerUrl.desc", { example: "https://example.workers.dev" }))
      .addText((text) => {
        text
          .setPlaceholder("https://…workers.dev")
          .setValue(this.host.settings.cmdsEagleWorkerUrl)
          .onChange((value) => {
            void this.changeR2FallbackUrl("cmdsEagleWorkerUrl", value);
          });
      });

    new Setting(fallback)
      .setName(t("settings.r2.publicUrl.name"))
      .setDesc(t("settings.r2.publicUrl.desc"))
      .addText((text) => {
        text
          .setPlaceholder("https://…r2.dev")
          .setValue(this.host.settings.cmdsEaglePublicUrl)
          .onChange((value) => {
            void this.changeR2FallbackUrl("cmdsEaglePublicUrl", value);
          });
      });
  }

  private renderHtmlExportSettings(container: HTMLElement): void {
    new Setting(container).setName(t("settings.html.heading")).setHeading();

    new Setting(container)
      .setName(t("settings.html.theme.name"))
      .setDesc(t("settings.html.theme.desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("achmage-editorial", t("settings.html.theme.editorial"))
          .addOption("classic", t("settings.html.theme.classic"))
          .setValue(this.host.settings.htmlExportTheme)
          .onChange((value) => {
            const theme: HtmlExportTheme =
              value === "classic" ? "classic" : "achmage-editorial";
            void this.changeHtmlExportTheme(theme);
          });
      });
  }

  private renderEditorialPdfSettings(container: HTMLElement): void {
    new Setting(container).setName(t("settings.pdf.heading")).setHeading();

    new Setting(container)
      .setName(t("settings.pdf.theme.name"))
      .setDesc(
        t("settings.pdf.theme.desc", {
          summary: this.actions.activeEditorialPdfThemeSummary()
        })
      )
      .addButton((button) => {
        button
          .setButtonText(t("settings.pdf.theme.manage"))
          .setCta()
          .onClick(() => {
            void this.runAction(() =>
              this.actions.openEditorialPdfThemeManager()
            );
          });
      });
  }

  private renderPdfLayoutSettings(container: HTMLElement): void {
    const update = async (patch: Record<string, unknown>): Promise<void> => {
      const previous = this.host.settings.editorialPdfLayout;
      this.host.settings.editorialPdfLayout = normalizeEditorialPdfLayout({ ...previous, ...patch });
      try { await this.host.saveSettings(); }
      catch (error) { this.host.settings.editorialPdfLayout = previous; throw error; }
    };
    new Setting(container).setName(t("settings.pdf.layout.name"))
      .setDesc(t("settings.pdf.layout.desc"))
      .addDropdown(dropdown => dropdown.addOptions(editorialPdfLayoutChoices())
        .setValue(this.host.settings.editorialPdfLayout.mode)
        .onChange(mode => { void this.runAction(() => update({ mode })); }));
    new Setting(container).setName(t("settings.pdf.gap.name"))
      .addDropdown(dropdown => dropdown.addOptions({ "8": "8mm", "10": "10mm", "12": "12mm" })
        .setValue(String(this.host.settings.editorialPdfLayout.columnGapMm))
        .onChange(value => { void this.runAction(() => update({ columnGapMm: Number(value) })); }));
    new Setting(container).setName(t("settings.pdf.tableWidth.name"))
      .setDesc(t("settings.pdf.tableWidth.desc"))
      .addDropdown(dropdown => dropdown.addOptions(editorialPdfTableWidthChoices())
        .setValue(this.host.settings.editorialPdfLayout.tableWidth)
        .onChange(tableWidth => { void this.runAction(() => update({ tableWidth })); }));
    new Setting(container).setName(t("settings.pdf.sectionBreaks.name"))
      .setDesc(t("settings.pdf.sectionBreaks.desc"))
      .addToggle(toggle => toggle.setValue(this.host.settings.editorialPdfLayout.sectionPageBreaks)
        .onChange(sectionPageBreaks => { void this.runAction(() => update({ sectionPageBreaks })); }));
  }

  private renderToolbarSettings(container: HTMLElement): void {
    new Setting(container).setName(t("settings.screen.heading")).setHeading();
    new Setting(container)
      .setName(t("settings.toolbarOnStartup.name"))
      .setDesc(t("settings.toolbarOnStartup.desc"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.host.settings.showToolbarOnStartup)
          .onChange((enabled) => {
            void this.changeToolbarVisibility(enabled);
          });
      });
    new Setting(container)
      .setName(t("settings.toolbarLook.name"))
      .setDesc(t("settings.toolbarLook.desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("classic", t("settings.toolbarLook.classic"))
          .addOption("minimal", t("settings.toolbarLook.minimal"))
          .setValue(this.host.settings.toolbarLook)
          .onChange((value) => {
            void this.changeToolbarDisplay("toolbarLook", value === "minimal" ? "minimal" : "classic");
          });
      });
    new Setting(container)
      .setName(t("settings.toolbarPeek.name"))
      .setDesc(t("settings.toolbarPeek.desc"))
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.toolbarPeek).onChange((enabled) => {
          void this.changeToolbarDisplay("toolbarPeek", enabled);
        });
      });
    new Setting(container)
      .setName(t("settings.toolbarReading.name"))
      .setDesc(t("settings.toolbarReading.desc"))
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.toolbarFoldFormatInReading).onChange((enabled) => {
          void this.changeToolbarDisplay("toolbarFoldFormatInReading", enabled);
        });
      });
    new Setting(container)
      .setName(t("settings.livePreview.name"))
      .setDesc(t("settings.livePreview.desc"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.host.settings.enableLivePreview)
          .onChange((enabled) => {
            void this.changeLivePreview(enabled);
          });
      });
    new Setting(container)
      .setName(t("settings.previewAutoPause.name"))
      .setDesc(t("settings.previewAutoPause.desc"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.host.settings.previewAutoPause)
          .onChange((enabled) => {
            void this.changePreviewAutoPause(enabled);
          });
      });
    new Setting(container)
      .setName(t("settings.previewFollow.name"))
      .setDesc(t("settings.previewFollow.desc"))
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.previewFollowCursor).onChange((enabled) => {
          void this.changePreviewFollow(enabled);
        });
      });
    new Setting(container)
      .setName(t("settings.statusCharCount.name"))
      .setDesc(t("settings.statusCharCount.desc"))
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.statusCharCount).onChange((enabled) => {
          void this.changeStatusBar("statusCharCount", enabled);
        });
      });
    new Setting(container)
      .setName(t("settings.statusGongmunForm.name"))
      .setDesc(t("settings.statusGongmunForm.desc"))
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.statusGongmunForm).onChange((enabled) => {
          void this.changeStatusBar("statusGongmunForm", enabled);
        });
      });
    new Setting(container)
      .setName(t("settings.startPanel.name"))
      .setDesc(t("settings.startPanel.desc"))
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.showStartPanel).onChange((enabled) => {
          void this.changeStartPanel(enabled);
        });
      });
    this.renderToolbarSkinSettings(container);
  }

  private renderToolbarSkinSettings(container: HTMLElement): void {
    new Setting(container).setName(t("settings.skin.heading")).setHeading();
    new Setting(container)
      .setName(t("settings.skin.mode.name"))
      .setDesc(t("settings.skin.mode.desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("auto", t("settings.skin.mode.auto"))
          .addOption("light", t("settings.skin.mode.light"))
          .addOption("dark", t("settings.skin.mode.dark"))
          .setValue(this.host.settings.toolbarSkinMode)
          .onChange((value) => {
            void this.changeToolbarSkinMode(normalizeToolbarSkinMode(value));
          });
      });

    let selected: keyof ToolbarSkin = "dark";
    const tabs = container.createDiv({ cls: "hwp-toolbar-skin-tabs" });
    const tabList = tabs.createDiv({ cls: "hwp-toolbar-skin-tab-list" });
    const panel = tabs.createDiv({ cls: "hwp-toolbar-skin-tab-panel" });
    const lightButton = tabList.createEl("button", {
      cls: "hwp-toolbar-skin-tab",
      text: t("settings.skin.light"),
      attr: { type: "button" }
    });
    const darkButton = tabList.createEl("button", {
      cls: "hwp-toolbar-skin-tab",
      text: t("settings.skin.dark"),
      attr: { type: "button" }
    });

    const renderPanel = (): void => {
      lightButton.classList.toggle("is-active", selected === "light");
      darkButton.classList.toggle("is-active", selected === "dark");
      panel.empty();
      new Setting(panel)
        .setName(selected === "light" ? t("settings.skin.light") : t("settings.skin.dark"))
        .setHeading();
      for (const field of TOOLBAR_SKIN_COLOR_FIELDS) {
        this.renderToolbarSkinColor(
          panel,
          selected,
          field.key,
          tKey(field.name),
          tKey(field.description)
        );
      }

      if (selected === "dark") {
        new Setting(panel)
          .setName(t("settings.skin.presets.name"))
          .setDesc(t("settings.skin.presets.desc"))
          .addButton((button) => {
            button.setButtonText("Charcoal Minimal").onClick(() => {
              void this.applyToolbarDarkPreset("charcoal-minimal", renderPanel);
            });
          })
          .addButton((button) => {
            button.setButtonText("Neo Lime Dark").onClick(() => {
              void this.applyToolbarDarkPreset("neo-lime-dark", renderPanel);
            });
          })
          .addButton((button) => {
            button.setButtonText("Olive Deck").onClick(() => {
              void this.applyToolbarDarkPreset("olive-deck", renderPanel);
            });
          });
      }

      new Setting(panel)
        .setName(t("settings.skin.reset.name"))
        .setDesc(t("settings.skin.reset.desc"))
        .addButton((button) => {
          button.setButtonText(t("settings.skin.reset.button")).onClick(() => {
            void this.resetToolbarSkin(renderPanel);
          });
        });
    };

    lightButton.addEventListener("click", () => {
      selected = "light";
      renderPanel();
    });
    darkButton.addEventListener("click", () => {
      selected = "dark";
      renderPanel();
    });
    renderPanel();
  }

  private renderToolbarSkinColor(
    container: HTMLElement,
    variant: keyof ToolbarSkin,
    key: ToolbarSkinPaletteKey,
    name: string,
    description: string
  ): void {
    const current = this.host.settings.toolbarSkin[variant][key];
    let textInput: HTMLInputElement | null = null;
    new Setting(container)
      .setName(name)
      .setDesc(description)
      .addColorPicker((picker) => {
        picker.setValue(current).onChange((value) => {
          const normalized = normalizeToolbarHex(value, current);
          if (textInput) textInput.value = normalized;
          void this.changeToolbarSkinColor(variant, key, normalized);
        });
      })
      .addText((text) => {
        text.setValue(current);
        text.inputEl.classList.add("hwp-toolbar-skin-hex-input");
        textInput = text.inputEl;
        text.onChange((value) => {
          const normalized = normalizeToolbarHex(value, "");
          if (normalized) void this.changeToolbarSkinColor(variant, key, normalized);
        });
        text.inputEl.addEventListener("blur", () => {
          const stored = this.host.settings.toolbarSkin[variant][key];
          text.setValue(normalizeToolbarHex(text.inputEl.value, stored));
        });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            text.inputEl.blur();
          }
        });
      });
  }

  private renderAdvancedDocxSettings(
    container: HTMLElement,
    version: number
  ): void {
    const details = container.createEl("details", {
      cls: "hanmark-docx-settings"
    });
    details.createEl("summary", { text: t("settings.docx.summary") });
    details.createEl("p", {
      cls: "setting-item-description",
      text: t("settings.docx.desc")
    });

    new Setting(details)
      .setName(t("settings.docx.engine.name"))
      .setDesc(t("settings.docx.engine.desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("builtin", t("settings.docx.engine.builtin"));
        dropdown.addOption("pandoc", t("settings.docx.engine.pandoc"));
        dropdown.setValue(this.host.settings.docxEngine).onChange((value) => {
          void this.changeDocxEngine(value === "pandoc" ? "pandoc" : "builtin", dropdown);
        });
      });

    new Setting(details)
      .setName(t("settings.docx.pandoc.name"))
      .setDesc(t("settings.docx.pandoc.desc", { command: "pandoc" }))
      .addText((text) => {
        text
          .setPlaceholder("pandoc")
          .setValue(this.host.settings.pandocPath)
          .onChange((value) => {
            void this.changePandocPath(value);
          });
      });

    const wordTemplateContainer = details.createDiv({
      cls: "hanmark-word-template-setting"
    });
    new Setting(wordTemplateContainer)
      .setName(t("settings.docx.wordTemplate.name"))
      .setDesc(t("settings.docx.wordTemplate.loading"));

    void this.renderWordTemplateSetting(
      wordTemplateContainer,
      version
    ).catch((error: unknown) => {
      if (version !== this.renderVersion) return;
      wordTemplateContainer.empty();
      new Setting(wordTemplateContainer)
        .setName(t("settings.docx.wordTemplate.name"))
        .setDesc(t("settings.docx.wordTemplate.loadFailed", { detail: errorMessage(error) }))
        .addButton((button) => {
          button.setButtonText(t("settings.manageTemplates")).onClick(() => {
            void this.runAction(() => this.actions.openWordTemplateManager());
          });
        });
    });

    new Setting(details)
      .setName(t("settings.docx.previewMode.name"))
      .setDesc(t("settings.docx.previewMode.desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("fast-docx", t("settings.docx.previewMode.fast"))
          .addOption("word-pdf", t("settings.docx.previewMode.wordPdf"))
          .setValue(this.host.settings.docxPreviewMode)
          .onChange((value) => {
            const mode: DocxPreviewMode =
              value === "word-pdf" ? "word-pdf" : "fast-docx";
            void this.changeDocxPreviewMode(mode);
          });
      });
  }

  private async renderWordTemplateSetting(
    container: HTMLElement,
    version: number
  ): Promise<void> {
    const templates = await this.actions.wordTemplateStore.listTemplates();
    if (version !== this.renderVersion) return;

    container.empty();
    if (!templates.length) {
      new Setting(container)
        .setName(t("settings.docx.wordTemplate.name"))
        .setDesc(t("settings.docx.wordTemplate.empty"))
        .addButton((button) => {
          button.setButtonText(t("settings.manageTemplates")).setCta().onClick(() => {
            void this.runAction(() => this.actions.openWordTemplateManager());
          });
        });
      return;
    }

    const activeId = this.host.settings.activeWordTemplateId;
    const activeExists = templates.some((template) => template.id === activeId);
    const selectedId = activeExists ? activeId : templates[0].id;
    new Setting(container)
      .setName(t("settings.docx.wordTemplate.active.name"))
      .setDesc(t("settings.docx.wordTemplate.active.desc"))
      .addDropdown((dropdown) => {
        for (const template of templates) {
          dropdown.addOption(template.id, template.name);
        }
        dropdown.setValue(selectedId);
        dropdown.onChange((id) => {
          void this.changeWordTemplate(id);
        });
      })
      .addButton((button) => {
        button.setButtonText(t("settings.manageTemplates")).setCta().onClick(() => {
          void this.runAction(() => this.actions.openWordTemplateManager());
        });
      });
  }

  private async changeUiLanguage(value: LanguagePreference): Promise<void> {
    const previous = this.host.settings.uiLanguage;
    if (previous === value) return;
    try {
      this.host.settings.uiLanguage = value;
      await this.host.saveSettings();
    } catch (error) {
      this.host.settings.uiLanguage = previous;
      new Notice(t("settings.language.saveFailed", { detail: errorMessage(error) }));
      this.render();
      return;
    }
    this.actions.applyUiLanguage();
    new Notice(t("settings.language.restartNotice"));
    this.render();
    await this.runAction(() => this.refreshAllUi());
  }

  private async changeOutputLanguage(value: LanguagePreference): Promise<void> {
    const previous = this.host.settings.outputLanguage;
    try {
      this.host.settings.outputLanguage = value;
      await this.host.saveSettings();
      await this.actions.refreshPreviews();
    } catch (error) {
      this.host.settings.outputLanguage = previous;
      new Notice(t("settings.language.saveFailed", { detail: errorMessage(error) }));
      this.render();
    }
  }

  private async changeHwpxTemplate(id: string): Promise<void> {
    try {
      await setActiveDocumentTemplate(this.host, id);
      await this.refreshAllUi();
      this.render();
    } catch (error) {
      new Notice(t("settings.hwpxTemplate.saveFailed", { detail: errorMessage(error) }));
    }
  }

  private async changeWordTemplate(id: string): Promise<void> {
    try {
      const template = await this.actions.wordTemplateStore.setActiveTemplate(id);
      this.host.settings.activeWordTemplateId = template.id;
      await this.host.saveSettings();
      await this.refreshAllUi();
      this.render();
    } catch (error) {
      new Notice(t("settings.docx.wordTemplate.saveFailed", { detail: errorMessage(error) }));
    }
  }

  private async changeToolbarVisibility(enabled: boolean): Promise<void> {
    try {
      this.host.settings.showToolbarOnStartup = enabled;
      await this.host.saveSettings();
      await this.actions.refreshToolbar();
    } catch (error) {
      new Notice(t("settings.toolbarOnStartup.saveFailed", { detail: errorMessage(error) }));
    }
  }

  /** Toolbar look, peek, and reading-view folding (R-028); rolls back when saving fails. */
  private async changeToolbarDisplay<K extends "toolbarLook" | "toolbarPeek" | "toolbarFoldFormatInReading">(
    key: K,
    value: HanmarkSettings[K]
  ): Promise<void> {
    const previous = this.host.settings[key];
    try {
      this.host.settings[key] = value;
      await this.host.saveSettings();
      await this.actions.refreshToolbar();
    } catch (error) {
      this.host.settings[key] = previous;
      new Notice(t("settings.toolbarOnStartup.saveFailed", { detail: errorMessage(error) }));
      this.render();
    }
  }

  private async changeLivePreview(enabled: boolean): Promise<void> {
    try {
      this.host.settings.enableLivePreview = enabled;
      await this.host.saveSettings();
      if (enabled) await this.actions.refreshPreviews();
    } catch (error) {
      new Notice(t("settings.livePreview.saveFailed", { detail: errorMessage(error) }));
    }
  }

  private async changePreviewAutoPause(enabled: boolean): Promise<void> {
    const previous = this.host.settings.previewAutoPause;
    try {
      this.host.settings.previewAutoPause = enabled;
      await this.host.saveSettings();
      await this.actions.refreshPreviews();
    } catch (error) {
      this.host.settings.previewAutoPause = previous;
      new Notice(t("settings.previewAutoPause.saveFailed", { detail: errorMessage(error) }));
      this.render();
    }
  }

  private async changeStatusBar(key: "statusCharCount" | "statusGongmunForm", enabled: boolean): Promise<void> {
    const previous = this.host.settings[key];
    try {
      this.host.settings[key] = enabled;
      await this.host.saveSettings();
      this.actions.refreshStatusBar?.();
    } catch (error) {
      this.host.settings[key] = previous;
      new Notice(t("settings.statusBar.saveFailed", { detail: errorMessage(error) }));
      this.render();
    }
  }

  private async changeStartPanel(enabled: boolean): Promise<void> {
    const previous = this.host.settings.showStartPanel;
    try {
      this.host.settings.showStartPanel = enabled;
      await this.host.saveSettings();
      this.actions.refreshStartPanels?.();
    } catch (error) {
      this.host.settings.showStartPanel = previous;
      new Notice(t("settings.startPanel.saveFailed", { detail: errorMessage(error) }));
      this.render();
    }
  }

  private async changePreviewFollow(enabled: boolean): Promise<void> {
    const previous = this.host.settings.previewFollowCursor;
    try {
      this.host.settings.previewFollowCursor = enabled;
      await this.host.saveSettings();
      this.actions.refreshPreviewControls?.();
    } catch (error) {
      this.host.settings.previewFollowCursor = previous;
      new Notice(t("settings.previewFollow.saveFailed", { detail: errorMessage(error) }));
      this.render();
    }
  }

  private async changeToolbarSkinMode(mode: ToolbarSkinMode): Promise<void> {
    try {
      this.host.settings.toolbarSkinMode = mode;
      await this.host.saveSettings();
      await this.actions.refreshToolbar();
    } catch (error) {
      new Notice(t("settings.skin.mode.saveFailed", { detail: errorMessage(error) }));
    }
  }

  private async changeToolbarSkinColor(
    variant: keyof ToolbarSkin,
    key: ToolbarSkinPaletteKey,
    value: string
  ): Promise<void> {
    try {
      this.host.settings.toolbarSkin = normalizeToolbarSkin(
        this.host.settings.toolbarSkin
      );
      const palette = this.host.settings.toolbarSkin[variant];
      palette[key] = normalizeToolbarHex(value, palette[key]);
      await this.host.saveSettings();
      await this.actions.refreshToolbar();
    } catch (error) {
      new Notice(t("settings.skin.color.saveFailed", { detail: errorMessage(error) }));
    }
  }

  private async applyToolbarDarkPreset(
    preset: keyof typeof TOOLBAR_SKIN_DARK_PRESETS,
    refreshPanel: () => void
  ): Promise<void> {
    try {
      const current = normalizeToolbarSkin(this.host.settings.toolbarSkin);
      this.host.settings.toolbarSkin = {
        light: { ...current.light },
        dark: { ...TOOLBAR_SKIN_DARK_PRESETS[preset] }
      };
      await this.host.saveSettings();
      await this.actions.refreshToolbar();
      refreshPanel();
    } catch (error) {
      new Notice(t("settings.skin.presets.saveFailed", { detail: errorMessage(error) }));
    }
  }

  private async resetToolbarSkin(refreshPanel: () => void): Promise<void> {
    try {
      this.host.settings.toolbarSkin = cloneToolbarSkin(TOOLBAR_SKIN_DEFAULTS);
      await this.host.saveSettings();
      await this.actions.refreshToolbar();
      refreshPanel();
    } catch (error) {
      new Notice(t("settings.skin.reset.saveFailed", { detail: errorMessage(error) }));
    }
  }

  /**
   * Pandoc is offered as the engine only when it can actually run: choosing it
   * checks the configured executable first and keeps the built-in writer otherwise.
   */
  private async changeDocxEngine(
    engine: DocxEngine,
    dropdown: { setValue(value: string): unknown }
  ): Promise<void> {
    const previous = this.host.settings.docxEngine;
    try {
      if (engine === "pandoc") {
        if (!this.actions.checkPandoc) throw new Error(t("settings.docx.engine.pandocUnavailable"));
        const version = await this.actions.checkPandoc();
        new Notice(t("settings.docx.engine.pandocFound", { version: version.split(/\r?\n/)[0] }));
      }
      this.host.settings.docxEngine = engine;
      await this.host.saveSettings();
      await this.actions.refreshPreviews();
    } catch (error) {
      this.host.settings.docxEngine = previous;
      dropdown.setValue(previous);
      new Notice(t("settings.docx.engine.pandocMissing", { detail: errorMessage(error) }), 8_000);
    }
  }

  private async changePandocPath(value: string): Promise<void> {
    try {
      this.host.settings.pandocPath = value.trim() || "pandoc";
      await this.host.saveSettings();
      await this.actions.refreshPreviews();
    } catch (error) {
      new Notice(t("settings.docx.pandoc.saveFailed", { detail: errorMessage(error) }));
    }
  }

  private async changeDocxPreviewMode(mode: DocxPreviewMode): Promise<void> {
    try {
      this.host.settings.docxPreviewMode = mode;
      await this.host.saveSettings();
      await this.actions.refreshPreviews();
    } catch (error) {
      new Notice(t("settings.docx.previewMode.saveFailed", { detail: errorMessage(error) }));
    }
  }

  private async changeHtmlExportTheme(theme: HtmlExportTheme): Promise<void> {
    const previous = this.host.settings.htmlExportTheme;
    try {
      this.host.settings.htmlExportTheme = theme;
      await this.host.saveSettings();
    } catch (error) {
      this.host.settings.htmlExportTheme = previous;
      new Notice(t("settings.html.theme.saveFailed", { detail: errorMessage(error) }));
      this.render();
    }
  }

  private async changeImportedImageDestination(
    destination: ImportedImageDestination
  ): Promise<void> {
    const previous = this.host.settings.importedImageDestination;
    try {
      this.host.settings.importedImageDestination = destination;
      await this.host.saveSettings();
    } catch (error) {
      this.host.settings.importedImageDestination = previous;
      new Notice(t("settings.importImages.destination.saveFailed", { detail: errorMessage(error) }));
      this.render();
    }
  }

  private async changeImportedImageFolder(value: string): Promise<void> {
    const previous = this.host.settings.importedImageFolder;
    try {
      this.host.settings.importedImageFolder =
        normalizeImportedImageFolder(value);
      await this.host.saveSettings();
    } catch (error) {
      this.host.settings.importedImageFolder = previous;
      new Notice(t("settings.importImages.folder.saveFailed", { detail: errorMessage(error) }));
      this.render();
    }
  }

  private async changeR2FallbackUrl(
    key: "cmdsEagleWorkerUrl" | "cmdsEaglePublicUrl",
    value: string
  ): Promise<void> {
    const previous = this.host.settings[key];
    try {
      this.host.settings[key] = value.trim();
      await this.host.saveSettings();
    } catch (error) {
      this.host.settings[key] = previous;
      new Notice(t("settings.r2.saveFailed", { detail: errorMessage(error) }));
      this.render();
    }
  }

  private async refreshAllUi(): Promise<void> {
    await this.actions.refreshPreviews();
    await this.actions.refreshToolbar();
  }

  private async runAction(
    action: () => void | Promise<void>
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      new Notice(errorMessage(error));
    }
  }
}
