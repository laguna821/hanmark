import { Modal, Notice, Setting, type App } from "obsidian";
import type { FileGateway } from "../io/fileGateway";
import {
  cloneWordTemplate,
  WORD_STYLE_IDS,
  type WordAlignment,
  type WordLineSpacingMode,
  type WordStyleId,
  type WordStyleSpec,
  type WordTemplateSpec,
  type WordUnderline
} from "../legacy-port/wordTypes";
import type { WordTemplateStore } from "../legacy-port/wordTemplateStore";

export interface WordTemplateManagerModalOptions {
  store: WordTemplateStore;
  fileGateway: FileGateway;
  /** Persist settings and refresh DOCX previews after a template mutation. */
  onChanged?: (activeTemplate: WordTemplateSpec) => Promise<void> | void;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint"
  ) {
    return `${error}`;
  }
  return "Unknown error";
}

function finiteNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeTemplateFilename(template: WordTemplateSpec): string {
  const stem = template.name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return `${stem || "hanmark-word-template"}.json`;
}

function addNumberSetting(
  container: HTMLElement,
  name: string,
  description: string,
  value: number,
  update: (value: number) => void,
  options: { min?: number; max?: number; step?: number } = {}
): void {
  new Setting(container)
    .setName(name)
    .setDesc(description)
    .addText((text) => {
      text.inputEl.type = "number";
      if (options.min !== undefined) text.inputEl.min = String(options.min);
      if (options.max !== undefined) text.inputEl.max = String(options.max);
      if (options.step !== undefined) text.inputEl.step = String(options.step);
      text.setValue(String(value));
      text.onChange((next) => update(finiteNumber(next, value)));
    });
}

function addBooleanSetting(
  container: HTMLElement,
  name: string,
  value: boolean,
  update: (value: boolean) => void
): void {
  new Setting(container)
    .setName(name)
    .addToggle((toggle) => {
      toggle.setValue(value);
      toggle.onChange(update);
    });
}

export class WordTemplateManagerModal extends Modal {
  private readonly options: WordTemplateManagerModalOptions;
  private templates: WordTemplateSpec[] = [];
  private draft: WordTemplateSpec | null = null;
  private selectedStyleId: WordStyleId = "Normal";
  private deleteArmed = false;

  constructor(app: App, options: WordTemplateManagerModalOptions) {
    super(app);
    this.options = options;
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass(
      "hanmark-modal-resizable",
      "hanmark-word-template-manager-modal",
      "word-template-modal-shell"
    );
    await this.reload();
  }

  onClose(): void {
    this.contentEl.empty();
    this.templates = [];
    this.draft = null;
  }

  private async reload(preferredId?: string): Promise<void> {
    try {
      this.templates = await this.options.store.listTemplates();
      if (!this.templates.length) {
        throw new Error("No Word templates are available.");
      }
      const preferred = preferredId
        ? await this.options.store.readTemplate(preferredId)
        : null;
      const active = preferred ?? await this.options.store.readActiveTemplate();
      this.draft = cloneWordTemplate(active);
      this.deleteArmed = false;
      this.render();
    } catch (error) {
      this.renderError(error);
    }
  }

  private renderError(error: unknown): void {
    this.setTitle("Word 템플릿");
    this.contentEl.empty();
    this.contentEl.createDiv({
      cls: "hanmark-word-template-error",
      text: `Word 템플릿을 열 수 없습니다: ${errorMessage(error)}`
    });
  }

  private render(): void {
    const draft = this.draft;
    if (!draft) return;

    this.setTitle("Word 템플릿 관리");
    const content = this.contentEl;
    content.empty();
    content.addClass("hanmark-word-template-manager", "word-template-modal");

    content.createEl("p", {
      cls: "setting-item-description",
      text:
        "고급 DOCX 내보내기에 사용할 템플릿을 여러 개 저장할 수 있습니다. " +
        "JSON 가져오기·내보내기는 HanMark 스키마를 검증한 뒤 처리합니다."
    });

    this.renderTemplateChooser(content, draft);
    content.createEl("h3", { text: "템플릿 정보" });
    new Setting(content)
      .setName("이름")
      .addText((text) => {
        text.setValue(draft.name);
        text.onChange((value) => {
          draft.name = value;
        });
      });

    this.renderPageEditor(content, draft);
    this.renderStyleEditor(content, draft);
    this.renderFooter(content, draft);
  }

  private renderTemplateChooser(
    content: HTMLElement,
    draft: WordTemplateSpec
  ): void {
    new Setting(content)
      .setName("활성 템플릿")
      .setDesc("DOCX 내보내기와 미리보기에 함께 적용됩니다.")
      .addDropdown((dropdown) => {
        for (const template of this.templates) {
          dropdown.addOption(template.id, template.name);
        }
        dropdown.setValue(draft.id);
        dropdown.onChange((id) => void this.activateTemplate(id));
      })
      .addButton((button) => {
        button.setButtonText("복제");
        button.onClick(() => void this.duplicateTemplate());
      })
      .addButton((button) => {
        button.setButtonText(this.deleteArmed ? "삭제 확인" : "삭제");
        button.buttonEl.addClass("mod-warning");
        button.setDisabled(draft.id === "default");
        button.onClick(() => void this.deleteTemplate());
      });

    let newTemplateName = "";
    new Setting(content)
      .setName("새 템플릿")
      .setDesc("현재 템플릿을 바탕으로 새 슬롯을 만듭니다.")
      .addText((text) => {
        text.setPlaceholder("예: 학회 논문");
        text.onChange((value) => {
          newTemplateName = value.trim();
        });
      })
      .addButton((button) => {
        button.setButtonText("만들기");
        button.setCta();
        button.onClick(() => void this.createTemplate(newTemplateName));
      });

    new Setting(content)
      .setName("JSON 가져오기·내보내기")
      .setDesc("불러온 JSON은 전체 Word 템플릿 스키마를 검증합니다.")
      .addButton((button) => {
        button.setButtonText("가져오기");
        button.onClick(() => void this.importJson());
      })
      .addButton((button) => {
        button.setButtonText("내보내기");
        button.onClick(() => void this.exportJson());
      });
  }

  private renderPageEditor(
    content: HTMLElement,
    draft: WordTemplateSpec
  ): void {
    const section = content.createEl("details", {
      cls: "hanmark-word-template-section"
    });
    section.open = true;
    section.createEl("summary", { text: "용지와 여백" });

    new Setting(section)
      .setName("방향")
      .addDropdown((dropdown) => {
        dropdown.addOption("portrait", "세로");
        dropdown.addOption("landscape", "가로");
        dropdown.setValue(draft.page.orientation);
        dropdown.onChange((value) => {
          draft.page.orientation =
            value === "landscape" ? "landscape" : "portrait";
        });
      });
    addNumberSetting(section, "용지 너비", "pt", draft.page.widthPt, (value) => {
      draft.page.widthPt = value;
    }, { min: 1, step: 0.1 });
    addNumberSetting(section, "용지 높이", "pt", draft.page.heightPt, (value) => {
      draft.page.heightPt = value;
    }, { min: 1, step: 0.1 });
    addNumberSetting(section, "위 여백", "pt", draft.page.marginTopPt, (value) => {
      draft.page.marginTopPt = value;
    }, { min: 0, step: 0.1 });
    addNumberSetting(section, "오른쪽 여백", "pt", draft.page.marginRightPt, (value) => {
      draft.page.marginRightPt = value;
    }, { min: 0, step: 0.1 });
    addNumberSetting(section, "아래 여백", "pt", draft.page.marginBottomPt, (value) => {
      draft.page.marginBottomPt = value;
    }, { min: 0, step: 0.1 });
    addNumberSetting(section, "왼쪽 여백", "pt", draft.page.marginLeftPt, (value) => {
      draft.page.marginLeftPt = value;
    }, { min: 0, step: 0.1 });
    addNumberSetting(section, "머리말 거리", "pt", draft.page.headerDistancePt, (value) => {
      draft.page.headerDistancePt = value;
    }, { min: 0, step: 0.1 });
    addNumberSetting(section, "꼬리말 거리", "pt", draft.page.footerDistancePt, (value) => {
      draft.page.footerDistancePt = value;
    }, { min: 0, step: 0.1 });
  }

  private renderStyleEditor(
    content: HTMLElement,
    draft: WordTemplateSpec
  ): void {
    const section = content.createEl("details", {
      cls: "hanmark-word-template-section"
    });
    section.open = true;
    section.createEl("summary", { text: "스타일" });

    new Setting(section)
      .setName("편집할 스타일")
      .addDropdown((dropdown) => {
        for (const id of WORD_STYLE_IDS) dropdown.addOption(id, id);
        dropdown.setValue(this.selectedStyleId);
        dropdown.onChange((value) => {
          if (!WORD_STYLE_IDS.some((id) => id === value)) return;
          this.selectedStyleId = value as WordStyleId;
          this.render();
        });
      });

    const style = draft.styles[this.selectedStyleId];
    section.createEl("h4", { text: `${style.displayName} · 글자` });
    this.renderFontEditor(section, style);
    if (style.paragraph) {
      section.createEl("h4", { text: `${style.displayName} · 문단` });
      this.renderParagraphEditor(section, style);
    }
  }

  private renderFontEditor(container: HTMLElement, style: WordStyleSpec): void {
    const font = style.font;
    if (!font) {
      container.createEl("p", {
        cls: "setting-item-description",
        text: "이 스타일에는 글자 설정이 없습니다."
      });
      return;
    }
    new Setting(container)
      .setName("한글 글꼴")
      .addText((text) => {
        text.setValue(font.eastAsiaFamily ?? font.family);
        text.onChange((value) => {
          const family = value.trim();
          font.eastAsiaFamily = family;
          font.family = family;
        });
      });
    new Setting(container)
      .setName("영문 글꼴")
      .addText((text) => {
        text.setValue(font.asciiFamily ?? font.hAnsiFamily ?? font.family);
        text.onChange((value) => {
          const family = value.trim();
          font.asciiFamily = family;
          font.hAnsiFamily = family;
          font.csFamily = family;
        });
      });
    addNumberSetting(container, "크기", "pt", font.sizePt, (value) => {
      font.sizePt = value;
    }, { min: 1, max: 200, step: 0.1 });
    addBooleanSetting(container, "굵게", font.bold, (value) => {
      font.bold = value;
    });
    addBooleanSetting(container, "기울임", font.italic, (value) => {
      font.italic = value;
    });
    new Setting(container)
      .setName("밑줄")
      .addDropdown((dropdown) => {
        dropdown.addOption("none", "없음");
        dropdown.addOption("single", "한 줄");
        dropdown.addOption("double", "두 줄");
        dropdown.setValue(font.underline);
        dropdown.onChange((value) => {
          const underline: WordUnderline =
            value === "single" || value === "double" ? value : "none";
          font.underline = underline;
        });
      });
    new Setting(container)
      .setName("글자색")
      .setDesc("#RRGGBB")
      .addText((text) => {
        text.setValue(font.color ?? "#000000");
        text.onChange((value) => {
          font.color = value.trim();
        });
      });
    addNumberSetting(
      container,
      "자간",
      "pt",
      font.charSpacingPt ?? 0,
      (value) => {
        font.charSpacingPt = value;
      },
      { step: 0.1 }
    );
    addNumberSetting(
      container,
      "장평",
      "%",
      font.widthScalePct ?? 100,
      (value) => {
        font.widthScalePct = value;
      },
      { min: 1, max: 600, step: 1 }
    );
  }

  private renderParagraphEditor(
    container: HTMLElement,
    style: WordStyleSpec
  ): void {
    const paragraph = style.paragraph;
    if (!paragraph) return;
    new Setting(container)
      .setName("정렬")
      .addDropdown((dropdown) => {
        dropdown.addOption("left", "왼쪽");
        dropdown.addOption("center", "가운데");
        dropdown.addOption("right", "오른쪽");
        dropdown.addOption("justify", "양쪽");
        dropdown.setValue(paragraph.align);
        dropdown.onChange((value) => {
          const align: WordAlignment =
            value === "center" || value === "right" || value === "justify"
              ? value
              : "left";
          paragraph.align = align;
        });
      });
    new Setting(container)
      .setName("줄 간격 방식")
      .addDropdown((dropdown) => {
        dropdown.addOption("single", "한 줄");
        dropdown.addOption("multiple", "배수");
        dropdown.addOption("exact", "고정");
        dropdown.addOption("atLeast", "최소");
        dropdown.setValue(paragraph.lineSpacingMode);
        dropdown.onChange((value) => {
          const mode: WordLineSpacingMode =
            value === "single" ||
            value === "exact" ||
            value === "atLeast"
              ? value
              : "multiple";
          paragraph.lineSpacingMode = mode;
        });
      });
    addNumberSetting(
      container,
      "줄 간격 값",
      "배수 또는 pt",
      paragraph.lineSpacingValue,
      (value) => {
        paragraph.lineSpacingValue = value;
      },
      { min: 0.1, step: 0.1 }
    );
    addNumberSetting(container, "왼쪽 들여쓰기", "pt", paragraph.leftIndentPt, (value) => {
      paragraph.leftIndentPt = value;
    }, { step: 0.1 });
    addNumberSetting(container, "오른쪽 들여쓰기", "pt", paragraph.rightIndentPt, (value) => {
      paragraph.rightIndentPt = value;
    }, { step: 0.1 });
    addNumberSetting(container, "첫 줄 들여쓰기", "pt", paragraph.firstLineIndentPt, (value) => {
      paragraph.firstLineIndentPt = value;
    }, { step: 0.1 });
    addNumberSetting(container, "문단 앞", "pt", paragraph.spacingBeforePt, (value) => {
      paragraph.spacingBeforePt = value;
    }, { min: 0, step: 0.1 });
    addNumberSetting(container, "문단 뒤", "pt", paragraph.spacingAfterPt, (value) => {
      paragraph.spacingAfterPt = value;
    }, { min: 0, step: 0.1 });
    addBooleanSetting(container, "다음 문단과 함께", paragraph.keepWithNext ?? false, (value) => {
      paragraph.keepWithNext = value;
    });
    addBooleanSetting(container, "앞에서 쪽 나누기", paragraph.pageBreakBefore ?? false, (value) => {
      paragraph.pageBreakBefore = value;
    });
    addBooleanSetting(container, "외톨이 줄 방지", paragraph.widowControl ?? true, (value) => {
      paragraph.widowControl = value;
    });
  }

  private renderFooter(
    content: HTMLElement,
    draft: WordTemplateSpec
  ): void {
    const footer = content.createDiv({
      cls: "hanmark-word-template-footer"
    });
    const save = footer.createEl("button", {
      text: "템플릿 저장",
      cls: "mod-cta",
      attr: { type: "button" }
    });
    save.addEventListener("click", () => void this.saveDraft(draft));
    const close = footer.createEl("button", {
      text: "닫기",
      attr: { type: "button" }
    });
    close.addEventListener("click", () => this.close());
  }

  private async activateTemplate(id: string): Promise<void> {
    try {
      const active = await this.options.store.setActiveTemplate(id);
      await this.changed(active);
      await this.reload(active.id);
    } catch (error) {
      new Notice(errorMessage(error));
    }
  }

  private async createTemplate(name: string): Promise<void> {
    if (!name) {
      new Notice("새 Word 템플릿 이름을 입력하세요.");
      return;
    }
    try {
      const created = await this.options.store.createTemplate(name, this.draft ?? undefined);
      await this.options.store.setActiveTemplate(created.id);
      await this.changed(created);
      await this.reload(created.id);
    } catch (error) {
      new Notice(errorMessage(error));
    }
  }

  private async duplicateTemplate(): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    try {
      const duplicate = await this.options.store.duplicateTemplate(
        draft.id,
        `${draft.name} 복사본`
      );
      await this.options.store.setActiveTemplate(duplicate.id);
      await this.changed(duplicate);
      await this.reload(duplicate.id);
    } catch (error) {
      new Notice(errorMessage(error));
    }
  }

  private async deleteTemplate(): Promise<void> {
    const draft = this.draft;
    if (!draft || draft.id === "default") return;
    if (!this.deleteArmed) {
      this.deleteArmed = true;
      this.render();
      new Notice("같은 삭제 버튼을 한 번 더 누르면 템플릿이 삭제됩니다.");
      return;
    }
    try {
      await this.options.store.deleteTemplate(draft.id);
      const active = await this.options.store.readActiveTemplate();
      await this.changed(active);
      await this.reload(active.id);
    } catch (error) {
      new Notice(errorMessage(error));
    }
  }

  private async importJson(): Promise<void> {
    try {
      const [file] = await this.options.fileGateway.pickFiles({
        title: "HanMark Word 템플릿 JSON 가져오기",
        extensions: ["json"]
      });
      if (!file) return;
      const imported = await this.options.store.importTemplateJson(
        new TextDecoder().decode(file.bytes)
      );
      await this.options.store.setActiveTemplate(imported.id);
      await this.changed(imported);
      await this.reload(imported.id);
      new Notice(`Word 템플릿을 가져왔습니다: ${imported.name}`);
    } catch (error) {
      new Notice(`Word 템플릿 가져오기 실패: ${errorMessage(error)}`);
    }
  }

  private async exportJson(): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    try {
      const json = await this.options.store.exportTemplateJson(draft.id);
      const result = await this.options.fileGateway.saveFile(
        new TextEncoder().encode(json),
        safeTemplateFilename(draft)
      );
      if (!result.cancelled) {
        new Notice(`Word 템플릿을 내보냈습니다: ${result.fileName}`);
      }
    } catch (error) {
      new Notice(`Word 템플릿 내보내기 실패: ${errorMessage(error)}`);
    }
  }

  private async saveDraft(draft: WordTemplateSpec): Promise<void> {
    try {
      const saved = await this.options.store.writeTemplate(draft);
      await this.options.store.setActiveTemplate(saved.id);
      await this.changed(saved);
      await this.reload(saved.id);
      new Notice(`Word 템플릿을 저장했습니다: ${saved.name}`);
    } catch (error) {
      new Notice(`Word 템플릿 저장 실패: ${errorMessage(error)}`);
    }
  }

  private async changed(active: WordTemplateSpec): Promise<void> {
    await this.options.onChanged?.(cloneWordTemplate(active));
  }
}
