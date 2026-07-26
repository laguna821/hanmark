import {
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  Platform,
  type WorkspaceLeaf
} from "obsidian";
import type { DocxExportService, DocxSource } from "../io/docxExport";
import type { DocxPreviewMode } from "../legacy-port/settings";
import { createUserInitiatedAction } from "../legacy-port/userProcess";
import type { WordTemplateStore } from "../legacy-port/wordTemplateStore";
import type {
  WordFontSpec,
  WordParagraphSpec,
  WordStyleId,
  WordStyleSpec,
  WordTemplateSpec
} from "../legacy-port/wordTypes";
import {
  calculateDocxPreviewFitPercent,
  isUserInitiatedFastPreviewTrigger,
  UserInitiatedDocxPackagePreview,
  type FastDocxPreviewTrigger
} from "./docxPackagePreview";

export const DOCX_PREVIEW_VIEW_TYPE = "hanmark-docx-preview";

export interface DocxPreviewViewOptions {
  exporter: DocxExportService;
  templateStore: WordTemplateStore;
  getPreviewMode: () => DocxPreviewMode;
  setPreviewMode?: (mode: DocxPreviewMode) => Promise<void>;
  getSource?: () => DocxSource | null;
  /** Loads only fonts that the user explicitly selected into the browser preview. */
  preparePreviewFonts?: (target: Document) => Promise<void>;
}

const BODY_STYLE_IDS: readonly WordStyleId[] = [
  "Normal",
  "Body Text",
  "First Paragraph"
];

function toErrorMessage(error: unknown): string {
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

function activeDocxSource(view: DocxPreviewView): DocxSource | null {
  const markdownView = view.app.workspace.getActiveViewOfType(MarkdownView);
  if (!markdownView?.file) return null;
  return {
    markdown: markdownView.editor.getValue(),
    title: markdownView.file.basename,
    sourcePath: markdownView.file.path
  };
}

function cssFontFamily(font: WordFontSpec): string {
  const families = [
    font.eastAsiaFamily,
    font.family,
    font.asciiFamily,
    "Malgun Gothic",
    "sans-serif"
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => `"${value.replace(/["\\]/g, "")}"`);
  return Array.from(new Set(families)).join(", ");
}

function lineHeight(paragraph: WordParagraphSpec): string {
  if (paragraph.lineSpacingMode === "single") return "1";
  if (paragraph.lineSpacingMode === "multiple") {
    return String(Math.max(0.5, paragraph.lineSpacingValue));
  }
  return `${Math.max(1, paragraph.lineSpacingValue)}pt`;
}

function applyFont(element: HTMLElement, font: WordFontSpec | undefined): void {
  if (!font) return;
  element.style.fontFamily = cssFontFamily(font);
  element.style.fontSize = `${font.sizePt}pt`;
  element.style.fontWeight = font.bold ? "700" : "400";
  element.style.fontStyle = font.italic ? "italic" : "normal";
  element.style.textDecorationLine =
    font.underline === "none" ? "none" : "underline";
  if (font.color && /^#[0-9A-Fa-f]{6}$/.test(font.color)) {
    element.style.color = font.color;
  }
  if (font.charSpacingPt !== undefined) {
    element.style.letterSpacing = `${font.charSpacingPt}pt`;
  }
}

function applyParagraph(
  element: HTMLElement,
  paragraph: WordParagraphSpec | undefined
): void {
  if (!paragraph) return;
  element.style.textAlign =
    paragraph.align === "justify" ? "justify" : paragraph.align;
  element.style.lineHeight = lineHeight(paragraph);
  element.style.marginLeft = `${paragraph.leftIndentPt}pt`;
  element.style.marginRight = `${paragraph.rightIndentPt}pt`;
  element.style.textIndent = `${paragraph.firstLineIndentPt}pt`;
  element.style.marginTop = `${paragraph.spacingBeforePt}pt`;
  element.style.marginBottom = `${paragraph.spacingAfterPt}pt`;
  element.toggleClass(
    "hanmark-docx-page-break-before",
    paragraph.pageBreakBefore === true
  );
  element.toggleClass(
    "hanmark-docx-keep-with-next",
    paragraph.keepWithNext === true
  );
}

function applyStyle(element: HTMLElement, style: WordStyleSpec | undefined): void {
  if (!style) return;
  applyFont(element, style.font);
  applyParagraph(element, style.paragraph);
}

function elements(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll(selector)).filter(
    (element): element is HTMLElement => element.instanceOf(HTMLElement)
  );
}

function effectiveBodyStyle(template: WordTemplateSpec): WordStyleSpec | undefined {
  for (const id of BODY_STYLE_IDS) {
    const style = template.styles[id];
    if (style) return style;
  }
  return undefined;
}

/** Applies Word-template semantics to an Obsidian-rendered Markdown tree. */
export function applyWordTemplatePreview(
  paper: HTMLElement,
  content: HTMLElement,
  template: WordTemplateSpec
): void {
  const page = template.page;
  paper.style.width = `${page.widthPt}pt`;
  paper.style.minHeight = `${page.heightPt}pt`;
  paper.style.padding =
    `${page.marginTopPt}pt ${page.marginRightPt}pt ` +
    `${page.marginBottomPt}pt ${page.marginLeftPt}pt`;

  const bodyStyle = effectiveBodyStyle(template);
  applyStyle(content, bodyStyle);
  for (const element of elements(content, "p, li")) applyStyle(element, bodyStyle);
  for (const element of elements(content, "blockquote")) {
    applyStyle(element, template.styles["Block Text"]);
  }
  for (const element of elements(content, "pre, code")) {
    applyStyle(element, template.styles["Source Code"]);
  }
  for (const element of elements(content, "table, th, td")) {
    applyStyle(element, template.styles.Table);
  }
  for (let level = 1; level <= 6; level += 1) {
    const id = `Heading ${level}` as WordStyleId;
    for (const element of elements(content, `h${level}`)) {
      applyStyle(element, template.styles[id]);
    }
  }
}

export class DocxPreviewView extends ItemView {
  private readonly options: DocxPreviewViewOptions;
  private readonly fastPreview: UserInitiatedDocxPackagePreview<
    DocxSource,
    ReturnType<typeof createUserInitiatedAction>
  >;
  private previewEl: HTMLElement | null = null;
  private modeSelect: HTMLSelectElement | null = null;
  private statusEl: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private renderVersion = 0;
  private objectUrl: string | null = null;
  private renderedSourceKey: string | null = null;

  constructor(leaf: WorkspaceLeaf, options: DocxPreviewViewOptions) {
    super(leaf);
    this.options = options;
    this.fastPreview = new UserInitiatedDocxPackagePreview(
      (source, action) =>
        this.options.exporter.buildDocxBytesUserInitiated(source, action)
    );
  }

  getViewType(): string {
    return DOCX_PREVIEW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "빠른 DOCX 미리보기";
  }

  getIcon(): string {
    return "file-text";
  }

  async onOpen(): Promise<void> {
    const content = this.contentEl;
    content.empty();
    content.addClass("hanmark-docx-preview-container", "docx-preview-container");

    const toolbar = content.createDiv({ cls: "hanmark-docx-preview-toolbar" });
    toolbar.createSpan({
      cls: "hanmark-docx-preview-label",
      text: "DOCX 미리보기"
    });
    this.statusEl = toolbar.createSpan({
      cls: "hanmark-docx-preview-status",
      text: "간이 미리보기",
      attr: {
        role: "status",
        "aria-live": "polite",
        "aria-atomic": "true",
        "data-state": "semantic"
      }
    });

    const mode = toolbar.createEl("select", {
      attr: { "aria-label": "DOCX 미리보기 방식" }
    });
    this.modeSelect = mode;
    mode.createEl("option", { text: "빠른 미리보기", value: "fast-docx" });
    mode.createEl("option", { text: "Windows Word PDF", value: "word-pdf" });
    mode.value = this.options.getPreviewMode();
    mode.disabled = !this.options.setPreviewMode;
    mode.addEventListener("change", () => {
      const selected: DocxPreviewMode =
        mode.value === "word-pdf" ? "word-pdf" : "fast-docx";
      void this.changeMode(selected);
    });

    const refreshButton = toolbar.createEl("button", {
      text: "새로 고침",
      attr: { type: "button" }
    });
    refreshButton.addEventListener("click", () => {
      if (this.options.getPreviewMode() === "word-pdf") {
        void this.renderExactPreview();
      } else {
        void this.handleFastPreviewTrigger("toolbar-refresh");
      }
    });

    const saveButton = toolbar.createEl("button", {
      text: "DOCX 저장",
      attr: { type: "button" }
    });
    saveButton.addEventListener("click", () => void this.exportDocx());

    this.previewEl = content.createDiv({
      cls: "hanmark-docx-preview-content docx-preview-content"
    });
    this.installPreviewFitObserver();
    this.registerEvent(
      this.app.workspace.on("editor-change", () => {
        if (this.options.getPreviewMode() === "word-pdf") {
          this.markExactPreviewStale();
        } else {
          void this.handleFastPreviewTrigger("document-change");
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (
          this.options.getPreviewMode() === "fast-docx" &&
          this.activeSourceChanged()
        ) {
          void this.handleFastPreviewTrigger("active-document-change");
        }
      })
    );
    await this.handleFastPreviewTrigger("view-open");
  }

  /**
   * Starts the external preview only after the caller has received a direct
   * user gesture. Workspace restoration calls onOpen(), but never this method.
   */
  async showUserInitiatedPreview(): Promise<void> {
    if (this.options.getPreviewMode() === "word-pdf") {
      await this.renderExactPreview();
      return;
    }
    await this.handleFastPreviewTrigger("explicit-open");
  }

  async onClose(): Promise<void> {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.revokeObjectUrl();
    this.previewEl = null;
    this.modeSelect = null;
    this.statusEl = null;
    this.renderedSourceKey = null;
  }

  forceRefresh(): void {
    if (this.options.getPreviewMode() === "word-pdf") {
      this.markExactPreviewStale();
    } else {
      void this.handleFastPreviewTrigger("template-change");
    }
  }

  private source(): DocxSource | null {
    return this.options.getSource?.() ?? activeDocxSource(this);
  }

  private sourceKey(source: DocxSource | null = this.source()): string | null {
    if (!source) return null;
    return `${source.sourcePath ?? ""}\u0000${source.markdown}`;
  }

  private activeSourceChanged(): boolean {
    return (
      this.renderedSourceKey !== null &&
      this.sourceKey() !== this.renderedSourceKey
    );
  }

  private setPreviewStatus(
    text: "생성 중" | "실제 DOCX" | "간이 미리보기" | "변경됨" | "Word PDF",
    state: "building" | "actual" | "semantic" | "stale" | "exact"
  ): void {
    if (!this.statusEl) return;
    this.statusEl.setText(text);
    this.statusEl.dataset.state = state;
  }

  private installPreviewFitObserver(): void {
    const preview = this.previewEl;
    if (!preview || typeof ResizeObserver === "undefined") return;
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.updatePreviewFit());
    this.resizeObserver.observe(preview);
  }

  private updatePreviewFit(): void {
    const preview = this.previewEl;
    if (!preview) return;
    preview.dataset.fit = "100";
    const page = preview.querySelector<HTMLElement>(
      ".docx-preview-docx section.docx, .hanmark-docx-preview-paper"
    );
    if (!page) return;

    const view = preview.ownerDocument.defaultView;
    const previewStyle = view?.getComputedStyle(preview);
    const horizontalPadding =
      Number.parseFloat(previewStyle?.paddingLeft ?? "0") +
      Number.parseFloat(previewStyle?.paddingRight ?? "0");
    let pageWidth = page.getBoundingClientRect().width;
    const wrapper = page.closest<HTMLElement>(".docx-wrapper");
    if (wrapper) {
      const wrapperStyle = view?.getComputedStyle(wrapper);
      pageWidth +=
        Number.parseFloat(wrapperStyle?.paddingLeft ?? "0") +
        Number.parseFloat(wrapperStyle?.paddingRight ?? "0");
    }
    preview.dataset.fit = String(
      calculateDocxPreviewFitPercent(
        Math.max(0, preview.clientWidth - horizontalPadding),
        pageWidth
      )
    );
  }

  private schedulePreviewFit(): void {
    const view = this.previewEl?.ownerDocument.defaultView;
    if (view) {
      view.requestAnimationFrame(() => this.updatePreviewFit());
      return;
    }
    this.updatePreviewFit();
  }

  private markExactPreviewStale(): void {
    this.renderVersion += 1;
    this.previewEl?.removeAttribute("aria-busy");
    this.setPreviewStatus("변경됨", "stale");
  }

  private markFastPreviewStale(): void {
    this.renderVersion += 1;
    this.previewEl?.removeAttribute("aria-busy");
    this.setPreviewStatus("변경됨", "stale");
  }

  private async handleFastPreviewTrigger(
    trigger: FastDocxPreviewTrigger
  ): Promise<void> {
    if (!isUserInitiatedFastPreviewTrigger(trigger)) {
      if (trigger === "document-change") {
        this.markFastPreviewStale();
      } else {
        await this.renderSemanticFallback();
      }
      return;
    }
    if (trigger === "mode-selection") {
      await this.renderSemanticFallback();
    }
    await this.renderFastPreviewUserInitiated(trigger);
  }

  private async changeMode(mode: DocxPreviewMode): Promise<void> {
    try {
      await this.setPreviewMode(mode);
      if (mode === "word-pdf") {
        await this.renderExactPreview();
      } else {
        await this.handleFastPreviewTrigger("mode-selection");
      }
    } catch (error) {
      new Notice(toErrorMessage(error));
      await this.renderSemanticFallback();
    }
  }

  private async setPreviewMode(mode: DocxPreviewMode): Promise<void> {
    await this.options.setPreviewMode?.(mode);
    if (this.modeSelect) this.modeSelect.value = mode;
  }

  private async renderFastPreviewUserInitiated(
    trigger: "explicit-open" | "toolbar-refresh" | "mode-selection"
  ): Promise<void> {
    const preview = this.previewEl;
    if (!preview) return;
    const source = this.source();
    if (!source || !source.markdown.trim()) {
      await this.renderSemanticFallback();
      return;
    }
    if (!this.fastPreview.canHandle(trigger)) return;
    const version = ++this.renderVersion;
    this.renderedSourceKey = this.sourceKey(source);
    this.revokeObjectUrl();
    preview.setAttribute("aria-busy", "true");
    this.setPreviewStatus("생성 중", "building");

    try {
      const rendered = createDiv({ cls: "docx-preview-docx" });
      await this.options.preparePreviewFonts?.(this.containerEl.ownerDocument);
      if (!this.previewEl || version !== this.renderVersion) return;
      const upgraded = await this.fastPreview.handle(trigger, {
        source,
        action: createUserInitiatedAction("toolbar"),
        container: rendered
      });
      if (!this.previewEl || version !== this.renderVersion) return;
      if (!upgraded) {
        preview.removeAttribute("aria-busy");
        return;
      }
      preview.empty();
      preview.append(rendered);
      preview.removeAttribute("aria-busy");
      this.setPreviewStatus("실제 DOCX", "actual");
      this.schedulePreviewFit();
    } catch (error) {
      if (!this.previewEl || version !== this.renderVersion) return;
      preview.removeAttribute("aria-busy");
      new Notice(
        `실제 DOCX 미리보기를 만들 수 없어 간이 미리보기를 유지합니다: ${toErrorMessage(error)}`
      );
      await this.renderSemanticFallback();
    }
  }

  private async renderSemanticFallback(): Promise<void> {
    const preview = this.previewEl;
    if (!preview) return;
    const version = ++this.renderVersion;
    const source = this.source();
    this.renderedSourceKey = this.sourceKey(source);
    this.revokeObjectUrl();
    preview.removeAttribute("aria-busy");
    this.setPreviewStatus("간이 미리보기", "semantic");

    if (!source) {
      preview.empty();
      preview.createDiv({
        cls: "hanmark-docx-preview-empty",
        text: "DOCX로 미리 볼 Markdown 문서를 여세요."
      });
      return;
    }
    if (!source.markdown.trim()) {
      preview.empty();
      preview.createDiv({
        cls: "hanmark-docx-preview-empty",
        text: "문서에 내용을 입력하면 미리보기가 표시됩니다."
      });
      return;
    }
    const staged = createDiv({
      cls: "hanmark-docx-preview-stage"
    });
    const paper = staged.createDiv({
      cls: "hanmark-docx-preview-paper word-template-preview-paper"
    });
    const rendered = paper.createDiv({
      cls: "markdown-preview-view hanmark-docx-preview-markdown"
    });

    try {
      await MarkdownRenderer.render(
        this.app,
        source.markdown,
        rendered,
        source.sourcePath ?? "",
        this
      );
      if (!this.previewEl || version !== this.renderVersion) return;
    } catch (error) {
      if (!this.previewEl || version !== this.renderVersion) return;
      preview.empty();
      preview.createDiv({
        cls: "hanmark-docx-preview-error",
        text: `DOCX 미리보기 실패: ${toErrorMessage(error)}`
      });
      new Notice(`DOCX 간이 미리보기 실패: ${toErrorMessage(error)}`);
      return;
    }

    try {
      const template = await this.options.templateStore.readActiveTemplate();
      await this.options.preparePreviewFonts?.(this.containerEl.ownerDocument);
      if (!this.previewEl || version !== this.renderVersion) return;
      applyWordTemplatePreview(paper, rendered, template);
    } catch (error) {
      if (!this.previewEl || version !== this.renderVersion) return;
      new Notice(
        `Word 템플릿 스타일을 적용하지 못해 기본 간이 미리보기를 표시합니다: ${toErrorMessage(error)}`
      );
    }

    if (!this.previewEl || version !== this.renderVersion) return;
    preview.empty();
    while (staged.firstChild) preview.append(staged.firstChild);
    this.schedulePreviewFit();
  }

  private async renderExactPreview(): Promise<void> {
    const preview = this.previewEl;
    if (!preview) return;
    const source = this.source();
    if (!source) {
      await this.renderSemanticFallback();
      return;
    }
    if (!Platform.isWin || !Platform.isDesktopApp) {
      await this.setPreviewMode("fast-docx");
      new Notice(
        "Windows Word PDF 미리보기는 Windows 데스크톱에서만 사용할 수 있습니다."
      );
      await this.renderSemanticFallback();
      return;
    }

    const version = ++this.renderVersion;
    this.renderedSourceKey = this.sourceKey(source);
    this.revokeObjectUrl();
    preview.setAttribute("aria-busy", "true");
    this.setPreviewStatus("생성 중", "building");

    try {
      const result =
        await this.options.exporter.buildExactPdfPreviewUserInitiated(
          source,
          createUserInitiatedAction("toolbar")
        );
      if (!this.previewEl || version !== this.renderVersion) return;
      preview.empty();
      preview.removeAttribute("aria-busy");
      const blob = new Blob([result.pdfBytes.slice().buffer], {
        type: "application/pdf"
      });
      this.objectUrl = URL.createObjectURL(blob);
      preview.createEl("iframe", {
        cls: "hanmark-docx-preview-pdf-frame docx-preview-pdf-frame",
        attr: {
          title: `${source.title} Word PDF 미리보기`,
          src: this.objectUrl
        }
      });
      this.setPreviewStatus("Word PDF", "exact");
      preview.dataset.fit = "100";
    } catch (error) {
      if (!this.previewEl || version !== this.renderVersion) return;
      preview.removeAttribute("aria-busy");
      await this.setPreviewMode("fast-docx");
      new Notice(
        `Word PDF 미리보기를 만들 수 없어 간이 미리보기를 유지합니다: ${toErrorMessage(error)}`
      );
      await this.renderSemanticFallback();
    }
  }

  private async exportDocx(): Promise<void> {
    const source = this.source();
    if (!source) {
      new Notice("DOCX로 내보낼 Markdown 문서를 여세요.");
      return;
    }
    try {
      const result = await this.options.exporter.exportUserInitiated(
        source,
        createUserInitiatedAction("toolbar")
      );
      if (!result.saved.cancelled) {
        new Notice(`DOCX를 저장했습니다: ${result.saved.fileName}`);
      }
    } catch (error) {
      new Notice(`DOCX 내보내기 실패: ${toErrorMessage(error)}`);
    }
  }

  private revokeObjectUrl(): void {
    if (!this.objectUrl) return;
    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}
