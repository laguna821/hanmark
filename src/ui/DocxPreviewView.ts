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

export const DOCX_PREVIEW_VIEW_TYPE = "hanmark-docx-preview";

export interface DocxPreviewViewOptions {
  exporter: DocxExportService;
  templateStore: WordTemplateStore;
  getPreviewMode: () => DocxPreviewMode;
  setPreviewMode?: (mode: DocxPreviewMode) => Promise<void>;
  getSource?: () => DocxSource | null;
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
  private previewEl: HTMLElement | null = null;
  private renderTimer: number | null = null;
  private renderVersion = 0;
  private objectUrl: string | null = null;

  constructor(leaf: WorkspaceLeaf, options: DocxPreviewViewOptions) {
    super(leaf);
    this.options = options;
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

    const mode = toolbar.createEl("select", {
      attr: { "aria-label": "DOCX 미리보기 방식" }
    });
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
        void this.renderFastPreview();
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
    this.registerEvent(
      this.app.workspace.on("editor-change", () => {
        if (this.options.getPreviewMode() === "word-pdf") {
          this.markExactPreviewStale();
        } else {
          this.scheduleFastRefresh();
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (this.options.getPreviewMode() === "fast-docx") {
          this.scheduleFastRefresh();
        }
      })
    );
    if (this.options.getPreviewMode() === "word-pdf") {
      this.renderExactPreviewPrompt();
    } else {
      await this.renderFastPreview();
    }
  }

  async onClose(): Promise<void> {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    this.renderTimer = null;
    this.revokeObjectUrl();
    this.previewEl = null;
  }

  forceRefresh(): void {
    if (this.options.getPreviewMode() === "word-pdf") {
      this.markExactPreviewStale();
    } else {
      this.scheduleFastRefresh(0);
    }
  }

  private source(): DocxSource | null {
    return this.options.getSource?.() ?? activeDocxSource(this);
  }

  private scheduleFastRefresh(delay = 300): void {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      void this.renderFastPreview();
    }, delay);
  }

  private renderExactPreviewPrompt(): void {
    const preview = this.previewEl;
    if (!preview) return;
    this.renderVersion += 1;
    this.revokeObjectUrl();
    preview.empty();
    preview.createDiv({
      cls: "hanmark-docx-preview-note",
      text:
        "Windows Word PDF 미리보기는 외부 Word 변환을 사용합니다. " +
        "위의 ‘새로 고침’을 눌렀을 때만 실행됩니다."
    });
  }

  private markExactPreviewStale(): void {
    const preview = this.previewEl;
    if (!preview) return;
    const existing = preview.querySelector(".hanmark-docx-preview-stale");
    if (existing) return;
    const notice = createDiv({
      cls: "hanmark-docx-preview-warning hanmark-docx-preview-stale",
      text: "문서 또는 템플릿이 바뀌었습니다. ‘새로 고침’을 눌러 Word PDF를 다시 만드세요."
    });
    preview.prepend(notice);
  }

  private async changeMode(mode: DocxPreviewMode): Promise<void> {
    try {
      await this.options.setPreviewMode?.(mode);
      if (mode === "word-pdf") {
        await this.renderExactPreview();
      } else {
        await this.renderFastPreview();
      }
    } catch (error) {
      new Notice(toErrorMessage(error));
      await this.renderFastPreview();
    }
  }

  private async renderFastPreview(message?: string): Promise<void> {
    const preview = this.previewEl;
    if (!preview) return;
    const version = ++this.renderVersion;
    const source = this.source();
    this.revokeObjectUrl();
    preview.empty();

    if (!source) {
      preview.createDiv({
        cls: "hanmark-docx-preview-empty",
        text: "DOCX로 미리 볼 Markdown 문서를 여세요."
      });
      return;
    }
    if (!source.markdown.trim()) {
      preview.createDiv({
        cls: "hanmark-docx-preview-empty",
        text: "문서에 내용을 입력하면 미리보기가 표시됩니다."
      });
      return;
    }
    if (message) {
      preview.createDiv({
        cls: "hanmark-docx-preview-warning",
        text: message
      });
    }
    const note = preview.createDiv({
      cls: "hanmark-docx-preview-note",
      text:
        "빠른 미리보기는 Word의 쪽 나눔과 완전히 같지 않습니다. " +
        "Windows Word PDF는 버튼을 눌렀을 때만 외부 변환을 실행합니다."
    });
    note.setAttribute("role", "note");

    try {
      const template = await this.options.templateStore.readActiveTemplate();
      if (!this.previewEl || version !== this.renderVersion) return;
      const paper = preview.createDiv({
        cls: "hanmark-docx-preview-paper word-template-preview-paper"
      });
      const rendered = paper.createDiv({
        cls: "markdown-preview-view hanmark-docx-preview-markdown"
      });
      await MarkdownRenderer.render(
        this.app,
        source.markdown,
        rendered,
        source.sourcePath ?? "",
        this
      );
      if (!this.previewEl || version !== this.renderVersion) return;
      applyWordTemplatePreview(paper, rendered, template);
    } catch (error) {
      if (!this.previewEl || version !== this.renderVersion) return;
      preview.empty();
      preview.createDiv({
        cls: "hanmark-docx-preview-error",
        text: `DOCX 미리보기 실패: ${toErrorMessage(error)}`
      });
    }
  }

  private async renderExactPreview(): Promise<void> {
    const preview = this.previewEl;
    if (!preview) return;
    const source = this.source();
    if (!source) {
      await this.renderFastPreview();
      return;
    }
    if (!Platform.isWin || !Platform.isDesktopApp) {
      await this.renderFastPreview(
        "Windows Word PDF 미리보기는 Windows 데스크톱에서만 사용할 수 있습니다."
      );
      return;
    }

    const version = ++this.renderVersion;
    this.revokeObjectUrl();
    preview.empty();
    preview.createDiv({
      cls: "hanmark-docx-preview-loading",
      text: "Word PDF 미리보기를 만드는 중…"
    });

    try {
      const result =
        await this.options.exporter.buildExactPdfPreviewUserInitiated(
          source,
          createUserInitiatedAction("toolbar")
        );
      if (!this.previewEl || version !== this.renderVersion) return;
      preview.empty();
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
    } catch (error) {
      await this.renderFastPreview(
        `Word PDF 미리보기를 만들 수 없어 빠른 미리보기로 전환했습니다: ${toErrorMessage(error)}`
      );
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
