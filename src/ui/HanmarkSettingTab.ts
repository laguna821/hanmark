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
import type { TemplateLibraryHost } from "../io/templateLibrary";
import type {
  DocxPreviewMode,
  HanmarkSettings,
  HtmlExportTheme,
  ImportedImageDestination,
  ToolbarSkin,
  ToolbarSkinMode,
  ToolbarSkinPaletteKey
} from "../legacy-port/settings";
import {
  cloneToolbarSkin,
  normalizeToolbarHex,
  normalizeToolbarSkin,
  normalizeToolbarSkinMode,
  TOOLBAR_SKIN_DARK_PRESETS,
  TOOLBAR_SKIN_DEFAULTS
} from "../legacy-port/settings";
import type { WordTemplateStore } from "../legacy-port/wordTemplateStore";
import { errorMessage } from "../utils/errors";

export const HWPX_ENGINE_VERSION = "4.2.5";

const TOOLBAR_SKIN_COLOR_FIELDS: ReadonlyArray<{
  key: ToolbarSkinPaletteKey;
  name: string;
  description: string;
}> = [
  { key: "toolbarBg", name: "툴바 배경", description: "툴바 전체 배경색" },
  { key: "toolbarEdge", name: "툴바 아래 경계", description: "툴바 아래쪽 강조선" },
  { key: "buttonBorder", name: "버튼 테두리", description: "툴바 버튼과 메뉴 테두리" },
  { key: "logoBody", name: "로고 기본 색", description: "HWP·Word 로고의 기본 색" },
  { key: "logoAccent", name: "로고 강조 색", description: "HWP·Word 로고의 강조 색" },
  { key: "logoMuted", name: "로고 보조 색", description: "HWP·Word 로고의 보조 색" },
  { key: "logoText", name: "로고 글자 색", description: "HWP·Word 로고 안 글자 색" }
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
  refreshPreviews(): void | Promise<void>;
  refreshToolbar(): void | Promise<void>;
}

/**
 * HanMark's Korean-first settings surface.
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
    new Setting(containerEl).setName("HWPX 내보내기").setHeading();

    new Setting(containerEl)
      .setName(`HWPX 엔진 · Kordoc ${HWPX_ENGINE_VERSION}`)
      .setDesc(
        "빠른 HWPX, 공문서 HWPX, 이미지 포함과 미리보기를 내장 엔진으로 처리합니다. HWPX 내보내기에는 별도 설치가 필요하지 않습니다."
      );

    this.renderHwpxSettings(containerEl);
    this.renderImportedImageSettings(containerEl);
    this.renderHtmlExportSettings(containerEl);
    this.renderToolbarSettings(containerEl);
    this.renderAdvancedDocxSettings(containerEl, version);
  }

  private renderHwpxSettings(container: HTMLElement): void {
    new Setting(container).setName("HWPX 템플릿").setHeading();

    const active = activeDocumentTemplate(this.host);
    const templates = availableDocumentTemplates(this.host);
    new Setting(container)
      .setName("사용할 HWPX 템플릿")
      .setDesc(
        active.builtIn
          ? `현재 내장 템플릿: ${active.name}`
          : `현재 사용자 템플릿: ${active.name}`
      )
      .addDropdown((dropdown) => {
        for (const template of templates) {
          dropdown.addOption(template.id, template.name);
        }
        dropdown.setValue(active.id);
        dropdown.onChange((id) => {
          void this.changeHwpxTemplate(id);
        });
      })
      .addButton((button) => {
        button
          .setButtonText("템플릿 관리")
          .setCta()
          .onClick(() => {
            void this.runAction(() => this.actions.openHwpxTemplateManager());
          });
      });
  }

  private renderImportedImageSettings(container: HTMLElement): void {
    new Setting(container).setName("문서 가져오기 이미지").setHeading();

    new Setting(container)
      .setName("가져온 이미지 저장 방식")
      .setDesc(
        "HWPX·DOCX·PDF에서 꺼낸 이미지를 어디에 둘지 정합니다. " +
        "CMDS Eagle 현재 클라우드는 공개 브리지 또는 등록 명령을 먼저 사용합니다."
      )
      .addDropdown((dropdown) => {
        dropdown
          .addOption("vault", "Vault 첨부 파일 (기본)")
          .addOption(
            "cmds-eagle-r2",
            "CMDS Eagle 현재 클라우드 (R2 폴백 가능)"
          )
          .addOption("ask", "가져올 때마다 묻기")
          .setValue(this.host.settings.importedImageDestination)
          .onChange((value) => {
            const destination: ImportedImageDestination =
              value === "cmds-eagle-r2" || value === "ask" ? value : "vault";
            void this.changeImportedImageDestination(destination);
          });
      });

    const fallback = container.createEl("details", {
      cls: "hanmark-r2-fallback-settings"
    });
    fallback.createEl("summary", { text: "직접 R2 폴백 설정 (선택)" });
    fallback.createEl("p", {
      cls: "setting-item-description",
      text:
        "정상적으로 CMDS Eagle가 응답하면 아래 정보는 사용하지 않습니다. " +
        "브리지를 사용할 수 없을 때만 HanMark가 같은 Worker 계약으로 업로드하며, " +
        "API 키는 필요할 때 묻고 인증 성공 뒤 세션 메모리에만 두며 설정 파일에는 저장하지 않습니다."
    });

    new Setting(fallback)
      .setName("Worker URL")
      .setDesc("예: https://example.workers.dev")
      .addText((text) => {
        text
          .setPlaceholder("https://…workers.dev")
          .setValue(this.host.settings.cmdsEagleWorkerUrl)
          .onChange((value) => {
            void this.changeR2FallbackUrl("cmdsEagleWorkerUrl", value);
          });
      });

    new Setting(fallback)
      .setName("Public URL")
      .setDesc("업로드한 파일을 읽을 공개 R2 주소입니다.")
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
    new Setting(container).setName("HTML 내보내기").setHeading();

    new Setting(container)
      .setName("HTML 테마")
      .setDesc(
        "새 HTML 파일에 적용할 화면·인쇄 스타일입니다. 스크립트나 외부 폰트 없이 독립형 파일로 저장합니다."
      )
      .addDropdown((dropdown) => {
        dropdown
          .addOption("achmage-editorial", "Achmage Editorial (권장)")
          .addOption("classic", "Classic (기존 스타일)")
          .setValue(this.host.settings.htmlExportTheme)
          .onChange((value) => {
            const theme: HtmlExportTheme =
              value === "classic" ? "classic" : "achmage-editorial";
            void this.changeHtmlExportTheme(theme);
          });
      });
  }

  private renderToolbarSettings(container: HTMLElement): void {
    new Setting(container).setName("화면").setHeading();
    new Setting(container)
      .setName("시작할 때 HanMark 툴바 표시")
      .setDesc("Obsidian을 열면 Markdown 편집기 위에 HanMark 툴바를 표시합니다.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.host.settings.showToolbarOnStartup)
          .onChange((enabled) => {
            void this.changeToolbarVisibility(enabled);
          });
      });
    new Setting(container)
      .setName("실시간 HWPX 미리보기")
      .setDesc(
        "끄면 노트 입력·전환 때 HWPX 미리보기를 자동 갱신하지 않습니다. 미리보기 명령을 다시 실행하면 수동으로 갱신할 수 있습니다."
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.host.settings.enableLivePreview)
          .onChange((enabled) => {
            void this.changeLivePreview(enabled);
          });
      });
    this.renderToolbarSkinSettings(container);
  }

  private renderToolbarSkinSettings(container: HTMLElement): void {
    new Setting(container).setName("툴바 색상").setHeading();
    new Setting(container)
      .setName("색상 모드")
      .setDesc("자동은 Obsidian의 밝은·어두운 테마 전환을 그대로 따릅니다.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("auto", "Obsidian 테마에 맞춤")
          .addOption("light", "항상 밝은 팔레트")
          .addOption("dark", "항상 어두운 팔레트")
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
      text: "밝은 팔레트",
      attr: { type: "button" }
    });
    const darkButton = tabList.createEl("button", {
      cls: "hwp-toolbar-skin-tab",
      text: "어두운 팔레트",
      attr: { type: "button" }
    });

    const renderPanel = (): void => {
      lightButton.classList.toggle("is-active", selected === "light");
      darkButton.classList.toggle("is-active", selected === "dark");
      panel.empty();
      new Setting(panel)
        .setName(selected === "light" ? "밝은 팔레트" : "어두운 팔레트")
        .setHeading();
      for (const field of TOOLBAR_SKIN_COLOR_FIELDS) {
        this.renderToolbarSkinColor(
          panel,
          selected,
          field.key,
          field.name,
          field.description
        );
      }

      if (selected === "dark") {
        new Setting(panel)
          .setName("기존 팔레트")
          .setDesc("HanMark 2.4.2에서 제공하던 어두운 툴바 팔레트입니다.")
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
        .setName("전체 색상 초기화")
        .setDesc("밝은·어두운 팔레트를 HanMark 기본값으로 되돌립니다.")
        .addButton((button) => {
          button.setButtonText("초기화").onClick(() => {
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
    details.createEl("summary", { text: "고급 DOCX / Pandoc 설정" });
    details.createEl("p", {
      cls: "setting-item-description",
      text:
        "DOCX 파일 생성과 Windows Word PDF 미리보기용 선택 설정입니다. " +
        "HWPX 내보내기에는 영향을 주지 않습니다."
    });

    new Setting(details)
      .setName("Pandoc 실행 파일 경로")
      .setDesc(
        "고급 DOCX 내보내기에서만 사용합니다. 명령 이름(pandoc) 또는 실행 파일의 전체 경로를 입력하세요."
      )
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
      .setName("Word 템플릿")
      .setDesc("템플릿 목록을 불러오는 중입니다.");

    void this.renderWordTemplateSetting(
      wordTemplateContainer,
      version
    ).catch((error: unknown) => {
      if (version !== this.renderVersion) return;
      wordTemplateContainer.empty();
      new Setting(wordTemplateContainer)
        .setName("Word 템플릿")
        .setDesc(`템플릿 목록을 불러오지 못했습니다: ${errorMessage(error)}`)
        .addButton((button) => {
          button.setButtonText("템플릿 관리").onClick(() => {
            void this.runAction(() => this.actions.openWordTemplateManager());
          });
        });
    });

    new Setting(details)
      .setName("DOCX 미리보기 방식")
      .setDesc(
        "실제 DOCX 빠른 미리보기는 새로고침하거나 이 모드를 선택할 때만 Pandoc을 실행합니다. " +
        "Pandoc을 사용할 수 없으면 설치 없이 의미 기반 미리보기로 전환합니다. " +
        "Word PDF는 Windows의 Microsoft Word를 사용자 요청 시에만 실행합니다."
      )
      .addDropdown((dropdown) => {
        dropdown
          .addOption("fast-docx", "빠른 미리보기")
          .addOption("word-pdf", "Windows Word PDF")
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
        .setName("Word 템플릿")
        .setDesc("저장된 Word 템플릿이 없습니다. 템플릿 관리자에서 만들어 주세요.")
        .addButton((button) => {
          button.setButtonText("템플릿 관리").setCta().onClick(() => {
            void this.runAction(() => this.actions.openWordTemplateManager());
          });
        });
      return;
    }

    const activeId = this.host.settings.activeWordTemplateId;
    const activeExists = templates.some((template) => template.id === activeId);
    const selectedId = activeExists ? activeId : templates[0].id;
    new Setting(container)
      .setName("사용할 Word 템플릿")
      .setDesc("고급 DOCX 내보내기와 DOCX 미리보기에 적용합니다.")
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
        button.setButtonText("템플릿 관리").setCta().onClick(() => {
          void this.runAction(() => this.actions.openWordTemplateManager());
        });
      });
  }

  private async changeHwpxTemplate(id: string): Promise<void> {
    try {
      await setActiveDocumentTemplate(this.host, id);
      await this.refreshAllUi();
      this.render();
    } catch (error) {
      new Notice(`HWPX 템플릿을 바꾸지 못했습니다: ${errorMessage(error)}`);
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
      new Notice(`Word 템플릿을 바꾸지 못했습니다: ${errorMessage(error)}`);
    }
  }

  private async changeToolbarVisibility(enabled: boolean): Promise<void> {
    try {
      this.host.settings.showToolbarOnStartup = enabled;
      await this.host.saveSettings();
      await this.actions.refreshToolbar();
    } catch (error) {
      new Notice(`툴바 설정을 저장하지 못했습니다: ${errorMessage(error)}`);
    }
  }

  private async changeLivePreview(enabled: boolean): Promise<void> {
    try {
      this.host.settings.enableLivePreview = enabled;
      await this.host.saveSettings();
      if (enabled) await this.actions.refreshPreviews();
    } catch (error) {
      new Notice(
        `실시간 미리보기 설정을 저장하지 못했습니다: ${errorMessage(error)}`
      );
    }
  }

  private async changeToolbarSkinMode(mode: ToolbarSkinMode): Promise<void> {
    try {
      this.host.settings.toolbarSkinMode = mode;
      await this.host.saveSettings();
      await this.actions.refreshToolbar();
    } catch (error) {
      new Notice(`툴바 색상 모드를 저장하지 못했습니다. ${errorMessage(error)}`);
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
      new Notice(`툴바 색상을 저장하지 못했습니다. ${errorMessage(error)}`);
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
      new Notice(`툴바 팔레트를 적용하지 못했습니다. ${errorMessage(error)}`);
    }
  }

  private async resetToolbarSkin(refreshPanel: () => void): Promise<void> {
    try {
      this.host.settings.toolbarSkin = cloneToolbarSkin(TOOLBAR_SKIN_DEFAULTS);
      await this.host.saveSettings();
      await this.actions.refreshToolbar();
      refreshPanel();
    } catch (error) {
      new Notice(`툴바 색상을 초기화하지 못했습니다. ${errorMessage(error)}`);
    }
  }

  private async changePandocPath(value: string): Promise<void> {
    try {
      this.host.settings.pandocPath = value.trim() || "pandoc";
      await this.host.saveSettings();
      await this.actions.refreshPreviews();
    } catch (error) {
      new Notice(`Pandoc 경로를 저장하지 못했습니다: ${errorMessage(error)}`);
    }
  }

  private async changeDocxPreviewMode(mode: DocxPreviewMode): Promise<void> {
    try {
      this.host.settings.docxPreviewMode = mode;
      await this.host.saveSettings();
      await this.actions.refreshPreviews();
    } catch (error) {
      new Notice(`DOCX 미리보기 설정을 저장하지 못했습니다: ${errorMessage(error)}`);
    }
  }

  private async changeHtmlExportTheme(theme: HtmlExportTheme): Promise<void> {
    const previous = this.host.settings.htmlExportTheme;
    try {
      this.host.settings.htmlExportTheme = theme;
      await this.host.saveSettings();
    } catch (error) {
      this.host.settings.htmlExportTheme = previous;
      new Notice(`HTML 테마 설정을 저장하지 못했습니다: ${errorMessage(error)}`);
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
      new Notice(`이미지 저장 방식을 저장하지 못했습니다: ${errorMessage(error)}`);
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
      new Notice(`R2 폴백 설정을 저장하지 못했습니다: ${errorMessage(error)}`);
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
