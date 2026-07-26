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
  HanmarkSettings
} from "../legacy-port/settings";
import type { WordTemplateStore } from "../legacy-port/wordTemplateStore";
import { errorMessage } from "../utils/errors";

export const HWPX_ENGINE_VERSION = "4.2.5";

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
        "빠른 미리보기는 Obsidian 안에서 즉시 표시합니다. Word PDF는 Windows의 Microsoft Word를 사용자 요청 시에만 실행합니다."
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
