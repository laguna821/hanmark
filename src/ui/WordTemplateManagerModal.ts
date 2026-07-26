import {
  Component,
  MarkdownRenderer,
  MarkdownView,
  Modal,
  Notice,
  Setting,
  type App
} from "obsidian";
import type { FileGateway } from "../io/fileGateway";
import {
  filterWordFontEntries,
  type WordFontCatalog,
  type WordFontCatalogEntry
} from "../legacy-port/wordFontCatalog";
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
import { applyWordTemplatePreview } from "./DocxPreviewView";

const WORD_TEMPLATE_PREVIEW_SAMPLE = `# 제목 1

첫 문단 예시입니다.

본문 문단 예시입니다.

## 제목 2

> 인용문 예시입니다.

\`\`\`ts
const greeting = "hello";
\`\`\`

| A | B |
|---|---|
| 1 | 2 |

[링크 예시](https://example.com)
`;

const MAX_VISIBLE_FONT_RESULTS = 200;

export interface WordTemplateManagerModalOptions {
  store: WordTemplateStore;
  fileGateway: FileGateway;
  fontCatalog: WordFontCatalog;
  /** Persist settings and refresh DOCX previews after a template mutation. */
  onChanged?: (activeTemplate: WordTemplateSpec) => Promise<void> | void;
  /** Persist custom-font settings and refresh the browser DOCX preview. */
  onFontCatalogChanged?: () => Promise<void> | void;
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
  return "알 수 없는 오류";
}

function normalizedTemplateName(value: string): string {
  return value.trim() || "이름 없는 템플릿";
}

function normalizedHexColor(value: string, fallback = "#000000"): string {
  const normalized = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    return normalized.toUpperCase();
  }
  if (/^[0-9a-f]{6}$/i.test(normalized)) {
    return `#${normalized.toUpperCase()}`;
  }
  return fallback;
}

function safeTemplateFilename(template: WordTemplateSpec): string {
  const stem = template.name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return `${stem || "hanmark-word-template"}.json`;
}

export function wordTemplateDraftIsDirty(
  persistedSnapshot: string,
  draft: WordTemplateSpec
): boolean {
  return JSON.stringify(draft) !== persistedSnapshot;
}

class WordFontCombobox {
  private readonly rootEl: HTMLElement;
  private readonly inputEl: HTMLInputElement;
  private readonly panelEl: HTMLElement;
  private readonly entries: readonly WordFontCatalogEntry[];
  private readonly sample: string;
  private readonly onValue: (value: string) => void;
  private filteredEntries: WordFontCatalogEntry[] = [];
  private matchingEntryCount = 0;
  private highlightedIndex = 0;
  private blurTimer: number | null = null;

  constructor(
    container: HTMLElement,
    options: {
      value: string;
      entries: readonly WordFontCatalogEntry[];
      sample: string;
      placeholder: string;
      onValue: (value: string) => void;
    }
  ) {
    this.entries = options.entries;
    this.sample = options.sample;
    this.onValue = options.onValue;
    this.rootEl = container.createDiv({ cls: "word-font-combobox" });
    this.inputEl = this.rootEl.createEl("input", {
      cls: "word-font-combobox-input",
      type: "text",
      attr: {
        placeholder: options.placeholder,
        "aria-label": options.placeholder,
        "aria-autocomplete": "list",
        autocomplete: "off"
      }
    });
    this.inputEl.value = options.value;
    const toggle = this.rootEl.createEl("button", {
      cls: "word-font-combobox-toggle",
      text: "▾",
      attr: { type: "button", "aria-label": "글꼴 목록 열기" }
    });
    this.panelEl = this.rootEl.createDiv({
      cls: "word-font-combobox-panel",
      attr: { role: "listbox" }
    });
    this.updateFilter();
    this.renderPanel();

    this.inputEl.addEventListener("focus", () => this.open());
    this.inputEl.addEventListener("input", () => {
      this.updateFilter();
      this.renderPanel();
      this.open();
      this.onValue(this.inputEl.value);
    });
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.open();
        this.moveHighlight(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        this.open();
        this.moveHighlight(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        this.commit(
          this.filteredEntries[this.highlightedIndex]?.family ??
            this.inputEl.value
        );
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.closePanel();
      }
    });
    this.inputEl.addEventListener("blur", () => {
      this.blurTimer = window.setTimeout(() => this.closePanel(), 120);
    });
    toggle.addEventListener("mousedown", (event) => event.preventDefault());
    toggle.addEventListener("click", () => {
      if (this.rootEl.hasClass("is-open")) {
        this.closePanel();
      } else {
        this.open();
        this.inputEl.focus();
      }
    });
  }

  private updateFilter(): void {
    const matches = filterWordFontEntries(this.entries, this.inputEl.value);
    this.matchingEntryCount = matches.length;
    this.filteredEntries = matches.slice(0, MAX_VISIBLE_FONT_RESULTS);
    this.highlightedIndex = 0;
  }

  private moveHighlight(delta: number): void {
    if (!this.filteredEntries.length) return;
    this.highlightedIndex =
      (this.highlightedIndex + delta + this.filteredEntries.length) %
      this.filteredEntries.length;
    this.renderPanel();
    this.panelEl
      .querySelector(".is-highlighted")
      ?.scrollIntoView({ block: "nearest" });
  }

  private commit(value: string): void {
    const family = value.trim();
    if (family) this.inputEl.value = family;
    this.onValue(this.inputEl.value);
    this.closePanel();
  }

  private renderManualRow(): void {
    const value = this.inputEl.value.trim();
    if (!value) return;
    const row = this.panelEl.createDiv({
      cls: "word-font-option word-font-option-manual",
      attr: { role: "option" }
    });
    row.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.commit(value);
    });
    row.createDiv({
      cls: "word-font-option-name",
      text: `직접 입력한 “${value}” 사용`
    });
    row.createDiv({
      cls: "word-font-option-sample",
      text: this.sample
    }).style.fontFamily = `"${value.replace(/["\\]/g, "")}", sans-serif`;
  }

  private renderPanel(): void {
    this.panelEl.empty();
    const typed = this.inputEl.value.trim().toLocaleLowerCase();
    const exact = this.filteredEntries.some(
      (entry) => entry.family.toLocaleLowerCase() === typed
    );
    if (!exact) this.renderManualRow();
    if (!this.filteredEntries.length) {
      this.panelEl.createDiv({
        cls: "word-font-empty",
        text: typed
          ? "일치하는 글꼴이 없습니다. 입력한 이름을 그대로 사용할 수 있습니다."
          : "표시할 글꼴이 없습니다."
      });
      return;
    }
    if (this.matchingEntryCount > this.filteredEntries.length) {
      this.panelEl.createDiv({
        cls: "word-font-empty",
        text:
          `${this.matchingEntryCount.toLocaleString()}개 중 ` +
          `${this.filteredEntries.length}개만 표시합니다. 검색어를 더 입력하세요.`
      });
    }
    this.filteredEntries.forEach((entry, index) => {
      const row = this.panelEl.createDiv({
        cls:
          `word-font-option${index === this.highlightedIndex ? " is-highlighted" : ""}`,
        attr: { role: "option" }
      });
      row.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.commit(entry.family);
      });
      const name = row.createDiv({
        cls: "word-font-option-name",
        text: entry.displayName
      });
      name.title = `${entry.family} · ${entry.sourceLabel ?? entry.source}`;
      row.createDiv({
        cls: "word-font-option-sample",
        text: this.sample
      }).style.fontFamily =
        `"${entry.previewFamily.replace(/["\\]/g, "")}", ` +
        `"${entry.family.replace(/["\\]/g, "")}", sans-serif`;
    });
  }

  private open(): void {
    if (this.blurTimer !== null) {
      window.clearTimeout(this.blurTimer);
      this.blurTimer = null;
    }
    this.rootEl.addClass("is-open");
  }

  private closePanel(): void {
    this.rootEl.removeClass("is-open");
  }
}

export class WordTemplateManagerModal extends Modal {
  private readonly options: WordTemplateManagerModalOptions;
  private templates: WordTemplateSpec[] = [];
  private activeTemplateId = "default";
  private draft: WordTemplateSpec | null = null;
  private persistedSnapshot = "";
  private selectedStyleId: WordStyleId = "Normal";
  private dirtyStatusEl: HTMLElement | null = null;
  private previewTab: "sample" | "current" = "sample";
  private previewPaperEl: HTMLElement | null = null;
  private previewTimer: number | null = null;
  private previewRenderVersion = 0;
  private bypassCloseGuard = false;
  private readonly previewComponent = new Component();

  constructor(app: App, options: WordTemplateManagerModalOptions) {
    super(app);
    this.options = options;
  }

  async onOpen(): Promise<void> {
    this.previewComponent.load();
    this.modalEl.addClass(
      "hanmark-resizable-workspace-modal",
      "hanmark-word-template-manager-modal",
      "word-template-modal-shell"
    );
    this.contentEl.addClass(
      "hanmark-word-template-manager",
      "word-template-modal"
    );
    await this.options.fontCatalog.applyPreviewFonts(
      this.contentEl.ownerDocument
    );
    await this.reload();
  }

  onClose(): void {
    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    this.modalEl.removeClass(
      "hanmark-resizable-workspace-modal",
      "hanmark-word-template-manager-modal",
      "word-template-modal-shell"
    );
    this.contentEl.empty();
    this.templates = [];
    this.draft = null;
    this.previewPaperEl = null;
    this.previewComponent.unload();
  }

  close(): void {
    if (this.bypassCloseGuard || !this.isDirty()) {
      super.close();
      return;
    }
    if (this.confirm("저장하지 않은 변경을 버리고 닫을까요?")) {
      this.bypassCloseGuard = true;
      super.close();
      this.bypassCloseGuard = false;
    }
  }

  private confirm(message: string): boolean {
    return this.contentEl.ownerDocument.defaultView?.confirm(message) ?? false;
  }

  private prompt(message: string, value: string): string | null {
    return this.contentEl.ownerDocument.defaultView?.prompt(message, value) ?? null;
  }

  private async reload(preferredId?: string): Promise<void> {
    try {
      this.templates = await this.options.store.listTemplates();
      if (!this.templates.length) {
        throw new Error("사용할 수 있는 Word 템플릿이 없습니다.");
      }
      const active = await this.options.store.readActiveTemplate();
      this.activeTemplateId = active.id;
      const preferred = preferredId
        ? await this.options.store.readTemplate(preferredId)
        : null;
      this.markPersisted(preferred ?? active);
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

  private isDirty(): boolean {
    return this.draft
      ? wordTemplateDraftIsDirty(this.persistedSnapshot, this.draft)
      : false;
  }

  private markDirty(): void {
    this.updateDirtyState();
    this.schedulePreviewRender();
  }

  private markPersisted(template: WordTemplateSpec): void {
    this.draft = cloneWordTemplate(template);
    if (!this.draft.styles[this.selectedStyleId]) {
      this.selectedStyleId = "Normal";
    }
    this.persistedSnapshot = JSON.stringify(this.draft);
    this.updateDirtyState();
    this.schedulePreviewRender();
  }

  private updateDirtyState(): void {
    if (!this.dirtyStatusEl) return;
    if (this.isDirty()) {
      this.dirtyStatusEl.setText("저장하지 않은 변경");
      this.dirtyStatusEl.addClass("is-dirty");
    } else {
      this.dirtyStatusEl.setText("저장됨");
      this.dirtyStatusEl.removeClass("is-dirty");
    }
  }

  private schedulePreviewRender(): void {
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      void this.renderPreview();
    }, 250);
  }

  private render(): void {
    if (!this.draft) return;
    this.setTitle("Word 템플릿 관리");
    this.contentEl.empty();
    this.renderHeader(this.contentEl);
    const layout = this.contentEl.createDiv({ cls: "word-template-layout" });
    this.renderSidebar(layout);
    this.renderEditor(layout);
    this.renderPreviewPanel(layout);
  }

  private createButton(
    container: HTMLElement,
    text: string,
    className: string,
    action: () => void
  ): HTMLButtonElement {
    const button = container.createEl("button", {
      text,
      cls: className,
      attr: { type: "button" }
    });
    button.addEventListener("click", action);
    return button;
  }

  private renderHeader(content: HTMLElement): void {
    const draft = this.draft;
    if (!draft) return;
    const header = content.createDiv({ cls: "word-template-header" });
    const chooser = header.createDiv({ cls: "word-template-header-group" });
    chooser.createDiv({
      cls: "word-template-header-label",
      text: "템플릿"
    });
    const select = chooser.createEl("select", {
      cls: "dropdown word-template-template-select",
      attr: { "aria-label": "편집할 Word 템플릿" }
    });
    for (const template of this.templates) {
      const option = select.createEl("option", {
        text:
          template.id === this.activeTemplateId
            ? `${template.name} · 사용 중`
            : template.name
      });
      option.value = template.id;
    }
    select.value = draft.id;
    select.addEventListener("change", () => {
      void this.onTemplateSelected(select.value);
    });
    this.dirtyStatusEl = header.createSpan({
      cls: "word-template-dirty-status"
    });

    const actions = header.createDiv({ cls: "word-template-actions" });
    this.createButton(actions, "새로 만들기", "mod-muted", () => {
      void this.createTemplate();
    });
    this.createButton(actions, "복제", "mod-muted", () => {
      void this.duplicateTemplate();
    });
    this.createButton(actions, "이름 변경", "mod-muted", () => {
      void this.renameTemplate();
    });
    const deleteButton = this.createButton(
      actions,
      "삭제",
      "mod-warning",
      () => void this.deleteTemplate()
    );
    deleteButton.disabled = draft.id === "default";
    this.createButton(actions, "가져오기", "mod-muted", () => {
      void this.importJson();
    });
    this.createButton(actions, "내보내기", "mod-muted", () => {
      void this.exportJson();
    });
    this.createButton(actions, "저장", "mod-cta", () => {
      void this.saveDraft(false);
    });
    this.createButton(actions, "저장하고 사용", "mod-cta", () => {
      void this.saveDraft(true);
    });
    this.createButton(actions, "되돌리기", "mod-muted", () => {
      void this.resetDraft();
    });
    this.createButton(actions, "닫기", "mod-muted", () => this.close());
    this.updateDirtyState();
  }

  private renderSidebar(layout: HTMLElement): void {
    const sidebar = layout.createDiv({ cls: "word-template-sidebar" });
    sidebar.createEl("h3", { text: "스타일" });
    const list = sidebar.createDiv({ cls: "word-template-style-list" });
    for (const id of WORD_STYLE_IDS) {
      const button = list.createEl("button", {
        text: id,
        cls:
          `word-style-button${id === this.selectedStyleId ? " is-active" : ""}`,
        attr: { type: "button" }
      });
      button.addEventListener("click", () => {
        if (id === this.selectedStyleId) return;
        this.selectedStyleId = id;
        this.render();
      });
    }
  }

  private renderEditor(layout: HTMLElement): void {
    const draft = this.draft;
    if (!draft) return;
    const editor = layout.createDiv({ cls: "word-template-editor" });

    const identity = this.createSection(editor, "템플릿 정보");
    this.createTextInput(
      this.createFieldRow(identity, "이름"),
      draft.name,
      (value) => {
        draft.name = normalizedTemplateName(value);
        this.markDirty();
      }
    );

    const style = draft.styles[this.selectedStyleId];
    const fontSection = this.createSection(
      editor,
      `${style.displayName} · 글자`
    );
    this.renderFontEditor(fontSection, style);

    const links = this.createSection(editor, "스타일 연결");
    this.createSelect(
      this.createFieldRow(links, "바탕 스타일"),
      ["", ...WORD_STYLE_IDS],
      style.basedOn ?? "",
      (value) => {
        style.basedOn = value
          ? (value as WordStyleId)
          : undefined;
        this.markDirty();
      }
    );
    this.createSelect(
      this.createFieldRow(links, "다음 스타일"),
      ["", ...WORD_STYLE_IDS],
      style.nextStyle ?? "",
      (value) => {
        style.nextStyle = value
          ? (value as WordStyleId)
          : undefined;
        this.markDirty();
      }
    );

    if (style.paragraph) {
      const paragraph = this.createSection(
        editor,
        `${style.displayName} · 문단`
      );
      this.renderParagraphEditor(paragraph, style);
    }

    const page = this.createSection(editor, "페이지");
    this.renderPageEditor(page, draft);
    this.renderFontCatalog(editor, draft);
  }

  private createSection(container: HTMLElement, title: string): HTMLElement {
    const section = container.createDiv({ cls: "word-template-section" });
    section.createEl("h4", { text: title });
    return section;
  }

  private createFieldRow(container: HTMLElement, label: string): HTMLElement {
    const row = container.createDiv({ cls: "word-template-field" });
    row.createDiv({ cls: "word-template-field-label", text: label });
    return row.createDiv({ cls: "word-template-field-control" });
  }

  private createTextInput(
    container: HTMLElement,
    value: string,
    update: (value: string) => void,
    placeholder = "",
    extraClass = ""
  ): HTMLInputElement {
    const input = container.createEl("input", {
      cls: `word-template-input ${extraClass}`.trim(),
      type: "text"
    });
    input.value = value;
    input.placeholder = placeholder;
    input.addEventListener("input", () => update(input.value));
    return input;
  }

  private createNumberInput(
    container: HTMLElement,
    value: number,
    update: (value: number) => void,
    step = "0.1"
  ): HTMLInputElement {
    const input = container.createEl("input", {
      cls: "word-template-input word-template-input-number",
      type: "number"
    });
    input.value = String(value);
    input.step = step;
    input.addEventListener("input", () => {
      const parsed = Number(input.value);
      if (Number.isFinite(parsed)) update(parsed);
    });
    return input;
  }

  private createSelect(
    container: HTMLElement,
    values: readonly string[],
    selected: string,
    update: (value: string) => void
  ): HTMLSelectElement {
    const select = container.createEl("select", {
      cls: "dropdown word-template-select"
    });
    for (const value of values) {
      const option = select.createEl("option", {
        text: value || "없음"
      });
      option.value = value;
    }
    select.value = selected;
    select.addEventListener("change", () => update(select.value));
    return select;
  }

  private createToggleChip(
    container: HTMLElement,
    label: string,
    selected: boolean,
    update: (value: boolean) => void
  ): void {
    const button = container.createEl("button", {
      text: label,
      cls: `word-template-chip${selected ? " is-active" : ""}`,
      attr: { type: "button", "aria-pressed": String(selected) }
    });
    button.addEventListener("click", () => {
      const next = !button.hasClass("is-active");
      button.toggleClass("is-active", next);
      button.setAttribute("aria-pressed", String(next));
      update(next);
    });
  }

  private documentFontFamilies(draft: WordTemplateSpec): string[] {
    const families = new Set<string>();
    for (const style of Object.values(draft.styles)) {
      const font = style.font;
      if (!font) continue;
      for (const family of [
        font.family,
        font.eastAsiaFamily,
        font.asciiFamily,
        font.hAnsiFamily,
        font.csFamily
      ]) {
        if (family?.trim()) families.add(family.trim());
      }
    }
    return [...families];
  }

  private renderFontEditor(
    container: HTMLElement,
    style: WordStyleSpec
  ): void {
    const font = style.font;
    const draft = this.draft;
    if (!font || !draft) {
      container.createEl("p", {
        cls: "setting-item-description",
        text: "이 스타일에는 글자 설정이 없습니다."
      });
      return;
    }
    const entries = this.options.fontCatalog.listFamilies(
      this.documentFontFamilies(draft)
    );
    const korean = this.createFieldRow(container, "한글 글꼴");
    new WordFontCombobox(korean, {
      value: font.eastAsiaFamily ?? font.family,
      entries,
      sample: this.options.fontCatalog.getPreviewSample(),
      placeholder: "글꼴 검색 또는 정확한 이름 입력",
      onValue: (value) => {
        const family = value.trim();
        font.eastAsiaFamily = family;
        font.family = family;
        this.markDirty();
      }
    });
    const latin = this.createFieldRow(container, "영문 글꼴");
    new WordFontCombobox(latin, {
      value: font.asciiFamily ?? font.hAnsiFamily ?? font.family,
      entries,
      sample: this.options.fontCatalog.getPreviewSample(),
      placeholder: "글꼴 검색 또는 정확한 이름 입력",
      onValue: (value) => {
        const family = value.trim();
        font.asciiFamily = family;
        font.hAnsiFamily = family;
        font.csFamily = family;
        this.markDirty();
      }
    });
    this.createNumberInput(
      this.createFieldRow(container, "크기 (pt)"),
      font.sizePt,
      (value) => {
        font.sizePt = value;
        this.markDirty();
      }
    );
    const emphasis = this.createFieldRow(container, "강조").createDiv({
      cls: "word-template-inline-group"
    });
    this.createToggleChip(emphasis, "굵게", font.bold, (value) => {
      font.bold = value;
      this.markDirty();
    });
    this.createToggleChip(emphasis, "기울임", font.italic, (value) => {
      font.italic = value;
      this.markDirty();
    });
    this.createSelect(
      emphasis,
      ["none", "single", "double"],
      font.underline,
      (value) => {
        const underline: WordUnderline =
          value === "single" || value === "double" ? value : "none";
        font.underline = underline;
        this.markDirty();
      }
    );

    const colorGroup = this.createFieldRow(container, "글자색").createDiv({
      cls: "word-template-inline-group word-template-color-group"
    });
    const initialColor = normalizedHexColor(font.color ?? "#000000");
    const colorPicker = colorGroup.createEl("input", {
      cls: "word-template-color-picker",
      type: "color",
      attr: { "aria-label": "글자색 선택" }
    });
    colorPicker.value = initialColor;
    const colorText = this.createTextInput(
      colorGroup,
      initialColor,
      (value) => {
        const color = normalizedHexColor(value, colorPicker.value);
        font.color = color;
        if (/^#?[0-9a-f]{6}$/i.test(value.trim())) {
          colorPicker.value = color;
        }
        this.markDirty();
      },
      "#000000",
      "word-template-input-color"
    );
    colorPicker.addEventListener("input", () => {
      const color = colorPicker.value.toUpperCase();
      colorText.value = color;
      font.color = color;
      this.markDirty();
    });
    this.createNumberInput(
      this.createFieldRow(container, "자간 (pt)"),
      font.charSpacingPt ?? 0,
      (value) => {
        font.charSpacingPt = value;
        this.markDirty();
      }
    );
    this.createNumberInput(
      this.createFieldRow(container, "장평 (%)"),
      font.widthScalePct ?? 100,
      (value) => {
        font.widthScalePct = value;
        this.markDirty();
      },
      "1"
    );
  }

  private renderParagraphEditor(
    container: HTMLElement,
    style: WordStyleSpec
  ): void {
    const paragraph = style.paragraph;
    if (!paragraph) return;
    this.createSelect(
      this.createFieldRow(container, "정렬"),
      ["left", "center", "right", "justify"],
      paragraph.align,
      (value) => {
        const align: WordAlignment =
          value === "center" || value === "right" || value === "justify"
            ? value
            : "left";
        paragraph.align = align;
        this.markDirty();
      }
    );
    this.createSelect(
      this.createFieldRow(container, "줄 간격 방식"),
      ["single", "multiple", "exact", "atLeast"],
      paragraph.lineSpacingMode,
      (value) => {
        const mode: WordLineSpacingMode =
          value === "single" || value === "exact" || value === "atLeast"
            ? value
            : "multiple";
        paragraph.lineSpacingMode = mode;
        this.markDirty();
      }
    );
    this.createNumberInput(
      this.createFieldRow(container, "줄 간격 값"),
      paragraph.lineSpacingValue,
      (value) => {
        paragraph.lineSpacingValue = value;
        this.markDirty();
      }
    );
    const numbers: Array<[string, keyof typeof paragraph]> = [
      ["왼쪽 들여쓰기 (pt)", "leftIndentPt"],
      ["오른쪽 들여쓰기 (pt)", "rightIndentPt"],
      ["첫 줄 들여쓰기 (pt)", "firstLineIndentPt"],
      ["문단 위 (pt)", "spacingBeforePt"],
      ["문단 아래 (pt)", "spacingAfterPt"]
    ];
    for (const [label, key] of numbers) {
      const value = paragraph[key];
      if (typeof value !== "number") continue;
      this.createNumberInput(
        this.createFieldRow(container, label),
        value,
        (next) => {
          paragraph[key] = next as never;
          this.markDirty();
        }
      );
    }
    const flow = this.createFieldRow(container, "흐름").createDiv({
      cls: "word-template-inline-group"
    });
    this.createToggleChip(
      flow,
      "다음 문단과 함께",
      paragraph.keepWithNext ?? false,
      (value) => {
        paragraph.keepWithNext = value;
        this.markDirty();
      }
    );
    this.createToggleChip(
      flow,
      "앞에서 쪽 나누기",
      paragraph.pageBreakBefore ?? false,
      (value) => {
        paragraph.pageBreakBefore = value;
        this.markDirty();
      }
    );
    this.createToggleChip(
      flow,
      "과부·고아 제어",
      paragraph.widowControl ?? true,
      (value) => {
        paragraph.widowControl = value;
        this.markDirty();
      }
    );
  }

  private renderPageEditor(
    container: HTMLElement,
    draft: WordTemplateSpec
  ): void {
    this.createSelect(
      this.createFieldRow(container, "방향"),
      ["portrait", "landscape"],
      draft.page.orientation,
      (value) => {
        draft.page.orientation =
          value === "landscape" ? "landscape" : "portrait";
        this.markDirty();
      }
    );
    const numbers: Array<[string, keyof typeof draft.page]> = [
      ["용지 너비 (pt)", "widthPt"],
      ["용지 높이 (pt)", "heightPt"],
      ["위 여백 (pt)", "marginTopPt"],
      ["오른쪽 여백 (pt)", "marginRightPt"],
      ["아래 여백 (pt)", "marginBottomPt"],
      ["왼쪽 여백 (pt)", "marginLeftPt"],
      ["머리말 거리 (pt)", "headerDistancePt"],
      ["꼬리말 거리 (pt)", "footerDistancePt"]
    ];
    for (const [label, key] of numbers) {
      const value = draft.page[key];
      if (typeof value !== "number") continue;
      this.createNumberInput(
        this.createFieldRow(container, label),
        value,
        (next) => {
          draft.page[key] = next as never;
          this.markDirty();
        }
      );
    }
  }

  private renderFontCatalog(
    container: HTMLElement,
    draft: WordTemplateSpec
  ): void {
    const details = container.createEl("details", {
      cls: "hanmark-word-template-section"
    });
    details.createEl("summary", { text: "글꼴 카탈로그" });
    const choices = this.options.fontCatalog.listFamilies(
      this.documentFontFamilies(draft)
    );
    details.createEl("p", {
      cls: "setting-item-description",
      text:
        `${choices.length.toLocaleString()}개 글꼴을 검색할 수 있습니다. ` +
        "설치 글꼴 검색은 버튼을 누를 때만 브라우저 권한을 요청합니다."
    });
    new Setting(details)
      .setName("설치된 글꼴")
      .setDesc("브라우저가 허용하는 설치 글꼴 목록을 사용자가 직접 불러옵니다.")
      .addButton((button) => {
        button.setButtonText("설치 글꼴 찾기");
        button.onClick(() => void this.discoverInstalledFonts());
      });
    new Setting(details)
      .setName("사용자 글꼴 추가")
      .setDesc("TTF·OTF·TTC·WOFF·WOFF2 파일 또는 폴더를 선택합니다.")
      .addButton((button) => {
        button.setButtonText("파일 선택");
        button.onClick(() => void this.importFontFiles(false));
      })
      .addButton((button) => {
        button.setButtonText("폴더 선택");
        button.onClick(() => void this.importFontFiles(true));
      });
    const custom = this.options.fontCatalog.listCustomFonts();
    if (!custom.length) {
      details.createEl("p", {
        cls: "setting-item-description",
        text: "추가한 사용자 글꼴이 없습니다. 글꼴 이름은 위에서 직접 입력할 수도 있습니다."
      });
      return;
    }
    const list = details.createDiv({ cls: "word-font-custom-list" });
    for (const entry of custom) {
      const row = list.createDiv({ cls: "word-font-custom-row" });
      const label = row.createDiv();
      label.createDiv({
        cls: "word-font-option-name",
        text: entry.displayName
      });
      label.createDiv({
        cls: "word-font-option-sample",
        text:
          `${this.options.fontCatalog.getPreviewSample()} · ` +
          `${entry.sourceLabel ?? "사용자 파일"}`
      }).style.fontFamily =
        `"${entry.previewFamily.replace(/["\\]/g, "")}", sans-serif`;
      const remove = row.createEl("button", {
        text: "제거",
        attr: {
          type: "button",
          "aria-label": `${entry.family} 사용자 글꼴 제거`
        }
      });
      remove.addEventListener("click", () => {
        void this.removeCustomFont(entry);
      });
    }
  }

  private renderPreviewPanel(layout: HTMLElement): void {
    const preview = layout.createDiv({ cls: "word-template-preview" });
    const header = preview.createDiv({
      cls: "word-template-preview-header"
    });
    header.createEl("h3", { text: "미리보기" });
    const tabs = header.createDiv({ cls: "word-preview-tabs" });
    this.createButton(
      tabs,
      "샘플",
      this.previewTab === "sample" ? "is-active" : "",
      () => {
        this.previewTab = "sample";
        this.render();
      }
    );
    this.createButton(
      tabs,
      "현재 문서",
      this.previewTab === "current" ? "is-active" : "",
      () => {
        this.previewTab = "current";
        this.render();
      }
    );
    const stage = preview.createDiv({
      cls: "word-template-preview-stage"
    });
    this.previewPaperEl = stage.createDiv({
      cls: "word-template-preview-paper"
    });
    void this.renderPreview();
  }

  private async renderPreview(): Promise<void> {
    const paper = this.previewPaperEl;
    const draft = this.draft;
    if (!paper || !draft) return;
    const version = ++this.previewRenderVersion;
    paper.empty();
    const activeView =
      this.app.workspace.getActiveViewOfType(MarkdownView);
    const markdown =
      this.previewTab === "current"
        ? activeView?.editor.getValue() ||
          "미리 볼 마크다운 문서를 열어 주세요."
        : WORD_TEMPLATE_PREVIEW_SAMPLE;
    const sourcePath = activeView?.file?.path ?? "";
    const rendered = paper.createDiv({
      cls: "word-template-preview-markdown"
    });
    try {
      await this.options.fontCatalog.applyPreviewFonts(paper.ownerDocument);
      await MarkdownRenderer.render(
        this.app,
        markdown,
        rendered,
        sourcePath,
        this.previewComponent
      );
      if (
        version !== this.previewRenderVersion ||
        paper !== this.previewPaperEl
      ) {
        return;
      }
      applyWordTemplatePreview(paper, rendered, draft);
    } catch (error) {
      if (version !== this.previewRenderVersion) return;
      paper.empty();
      paper.createDiv({
        cls: "docx-preview-error",
        text: `템플릿 미리보기를 만들 수 없습니다: ${errorMessage(error)}`
      });
    }
  }

  private async onTemplateSelected(id: string): Promise<void> {
    const draft = this.draft;
    if (!draft || id === draft.id) return;
    if (
      this.isDirty() &&
      !this.confirm("현재 변경을 저장하지 않고 다른 템플릿을 열까요?")
    ) {
      this.render();
      return;
    }
    const template = await this.options.store.readTemplate(id);
    if (!template) {
      new Notice(`템플릿을 찾을 수 없습니다: ${id}`);
      this.render();
      return;
    }
    this.markPersisted(template);
    this.render();
  }

  private async saveDraft(useTemplate: boolean): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    try {
      draft.name = normalizedTemplateName(draft.name);
      const saved = await this.options.store.writeTemplate(draft);
      let active = await this.options.store.readActiveTemplate();
      if (useTemplate) {
        active = await this.options.store.setActiveTemplate(saved.id);
        this.activeTemplateId = active.id;
      } else if (active.id === saved.id) {
        active = saved;
      }
      await this.changed(active);
      this.templates = await this.options.store.listTemplates();
      this.markPersisted(saved);
      this.render();
      new Notice(
        useTemplate
          ? `저장하고 적용했습니다: ${saved.name}`
          : `저장했습니다: ${saved.name}`
      );
    } catch (error) {
      new Notice(`Word 템플릿 저장 실패: ${errorMessage(error)}`);
    }
  }

  private async resetDraft(): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    if (
      this.isDirty() &&
      !this.confirm("저장하지 않은 변경을 마지막 저장 상태로 되돌릴까요?")
    ) {
      return;
    }
    const stored = await this.options.store.readTemplate(draft.id);
    if (!stored) {
      new Notice("저장된 템플릿을 찾을 수 없습니다.");
      return;
    }
    this.markPersisted(stored);
    this.render();
  }

  private async createTemplate(): Promise<void> {
    if (
      this.isDirty() &&
      !this.confirm("현재 변경을 저장하지 않고 새 템플릿을 만들까요?")
    ) {
      return;
    }
    const name = this.prompt("새 템플릿 이름", "새 Word 템플릿")?.trim();
    if (!name) return;
    try {
      const source =
        (await this.options.store.readTemplate("default")) ??
        (await this.options.store.readActiveTemplate());
      const created = await this.options.store.createTemplate(name, source);
      await this.reload(created.id);
    } catch (error) {
      new Notice(`템플릿 만들기 실패: ${errorMessage(error)}`);
    }
  }

  private async duplicateTemplate(): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    if (
      this.isDirty() &&
      !this.confirm("현재 변경을 저장하지 않고 마지막 저장본을 복제할까요?")
    ) {
      return;
    }
    const name = this.prompt(
      "복제할 템플릿 이름",
      `${draft.name} 복사본`
    )?.trim();
    if (!name) return;
    try {
      const duplicate = await this.options.store.duplicateTemplate(
        draft.id,
        name
      );
      await this.reload(duplicate.id);
    } catch (error) {
      new Notice(`템플릿 복제 실패: ${errorMessage(error)}`);
    }
  }

  private async renameTemplate(): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    const name = this.prompt("템플릿 이름 변경", draft.name)?.trim();
    if (!name) return;
    try {
      const saved = await this.options.store.renameTemplate(draft.id, name);
      draft.name = saved.name;
      const active = await this.options.store.readActiveTemplate();
      await this.changed(active);
      this.templates = await this.options.store.listTemplates();
      this.persistedSnapshot = JSON.stringify(saved);
      this.updateDirtyState();
      this.schedulePreviewRender();
      this.render();
    } catch (error) {
      new Notice(`템플릿 이름 변경 실패: ${errorMessage(error)}`);
    }
  }

  private async deleteTemplate(): Promise<void> {
    const draft = this.draft;
    if (!draft || draft.id === "default") return;
    if (this.templates.length <= 1) {
      new Notice("최소 한 개의 템플릿은 남아 있어야 합니다.");
      return;
    }
    if (!this.confirm(`“${draft.name}” 템플릿을 삭제할까요?`)) return;
    try {
      await this.options.store.deleteTemplate(draft.id);
      const active = await this.options.store.readActiveTemplate();
      await this.changed(active);
      await this.reload(active.id);
    } catch (error) {
      new Notice(`템플릿 삭제 실패: ${errorMessage(error)}`);
    }
  }

  private async importJson(): Promise<void> {
    if (
      this.isDirty() &&
      !this.confirm("현재 변경을 저장하지 않고 템플릿을 가져올까요?")
    ) {
      return;
    }
    try {
      const [file] = await this.options.fileGateway.pickFiles({
        title: "HanMark Word 템플릿 JSON 가져오기",
        extensions: ["json"],
        maxFiles: 1,
        maxFileBytes: 5 * 1024 * 1024,
        maxTotalBytes: 5 * 1024 * 1024
      });
      if (!file) return;
      const imported = await this.options.store.importTemplateJson(
        new TextDecoder().decode(file.bytes)
      );
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

  private async discoverInstalledFonts(): Promise<void> {
    try {
      const result = await this.options.fontCatalog.discoverInstalledFonts();
      this.render();
      new Notice(
        result.method === "local-font-access"
          ? `설치 글꼴 ${result.entries.length.toLocaleString()}개를 불러왔습니다.`
          : `확인 가능한 글꼴 ${result.entries.length.toLocaleString()}개를 찾았습니다.`
      );
    } catch (error) {
      new Notice(
        `설치 글꼴을 불러오지 못했습니다. 이름을 직접 입력하거나 ` +
          `글꼴 파일을 선택할 수 있습니다: ${errorMessage(error)}`
      );
    }
  }

  private async importFontFiles(directory: boolean): Promise<void> {
    try {
      const imported = directory
        ? await this.options.fontCatalog.pickFontDirectory()
        : await this.options.fontCatalog.pickFontFiles();
      if (!imported.length) return;
      await this.options.fontCatalog.applyPreviewFonts(
        this.contentEl.ownerDocument
      );
      await this.options.onFontCatalogChanged?.();
      this.render();
      new Notice(`미리보기 글꼴 ${imported.length}개를 추가했습니다.`);
    } catch (error) {
      new Notice(`글꼴을 추가하지 못했습니다: ${errorMessage(error)}`);
    }
  }

  private async removeCustomFont(
    entry: WordFontCatalogEntry
  ): Promise<void> {
    if (!this.options.fontCatalog.removeCustomFont(entry)) return;
    await this.options.onFontCatalogChanged?.();
    this.render();
    new Notice(`사용자 글꼴을 제거했습니다: ${entry.family}`);
  }

  private async changed(active: WordTemplateSpec): Promise<void> {
    await this.options.onChanged?.(cloneWordTemplate(active));
  }
}
