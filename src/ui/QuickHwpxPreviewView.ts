import { ItemView, MarkdownView, WorkspaceLeaf } from "obsidian";
import type { FormatProfile } from "kordoc";
import { extractEditableBody } from "../io/frontmatter";
import { renderQuickHwpxPreview } from "../io/kordocEngine";
import { createObsidianImageLoader } from "../io/obsidianImageLoader";
import { documentStyleSummary, type DocumentStyleProfile } from "../io/documentStyle";

export const QUICK_HWPX_PREVIEW_VIEW = "hanmark-quick-hwpx-preview";

interface PreviewCacheEntry {
  svg: string;
  warnings: string[];
  adapterWarnings: string[];
  imageCount: number;
  embeddedImageCount: number;
  embeddedImageOccurrences: number;
  imageFailureCount: number;
  documentStyleName?: string;
  documentStyleSummary?: string;
  pages: number;
}

function cacheKey(
  sourcePath: string,
  markdown: string,
  profile: FormatProfile | undefined,
  documentStyle: DocumentStyleProfile | undefined
): string {
  let hash = 2166136261;
  const value = `${sourcePath}\u0000${markdown}\u0000${profile ? JSON.stringify(profile) : ""}\u0000${
    documentStyle ? JSON.stringify(documentStyle) : ""
  }`;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function sanitizeSvg(svg: string): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  document.querySelectorAll("script, foreignObject").forEach((node) => node.remove());
  document.querySelectorAll("*").forEach((node) => {
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on")) node.removeAttribute(attribute.name);
      if ((name === "href" || name === "xlink:href") && !value.startsWith("#") && !value.startsWith("data:image/")) {
        node.removeAttribute(attribute.name);
      }
    }
  });
  return new XMLSerializer().serializeToString(document.documentElement);
}

export class QuickHwpxPreviewView extends ItemView {
  private renderVersion = 0;
  private timer: number | null = null;
  private previewEl: HTMLElement | null = null;
  private readonly cache = new Map<string, PreviewCacheEntry>();

  constructor(
    leaf: WorkspaceLeaf,
    private readonly profile: () => FormatProfile | undefined,
    private readonly documentStyle: () => DocumentStyleProfile | undefined
  ) {
    super(leaf);
  }

  getViewType(): string {
    return QUICK_HWPX_PREVIEW_VIEW;
  }

  getDisplayText(): string {
    return "빠른 HWPX 미리보기";
  }

  getIcon(): string {
    return "file-search";
  }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("hanmark-quick-preview");
    const caution = root.createDiv({ cls: "hanmark-preview-caution" });
    caution.setText("빠른 HWPX 미리보기 · 한컴오피스와 완전히 동일한 화면이 아닙니다. 수식·차트·머리말은 다르게 보일 수 있습니다.");
    this.previewEl = root.createDiv({ cls: "hanmark-preview-stage" });
    this.registerEvent(this.app.workspace.on("editor-change", () => this.schedule()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.schedule()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.schedule()));
    await this.updatePreview();
  }

  forceRefresh(): void {
    this.cache.clear();
    this.schedule(true);
  }

  private schedule(immediate = false): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.updatePreview();
    }, immediate ? 0 : 500);
  }

  private async updatePreview(): Promise<void> {
    if (!this.previewEl) return;
    const version = ++this.renderVersion;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) {
      this.previewEl.setText("미리볼 마크다운 노트를 여세요.");
      return;
    }
    const markdown = extractEditableBody(view.editor.getValue());
    if (!markdown.trim()) {
      this.previewEl.setText("미리볼 내용이 없습니다.");
      return;
    }

    const profile = this.profile();
    const documentStyle = this.documentStyle();
    const key = cacheKey(view.file.path, markdown, profile, documentStyle);
    let entry = this.cache.get(key);
    if (!entry) {
      this.previewEl.empty();
      const loading = this.previewEl.createDiv({ cls: "hanmark-preview-loading", text: "Kordoc으로 HWPX를 만들고 미리보는 중…" });
      try {
        const result = await renderQuickHwpxPreview(markdown, {
          profile,
          documentStyle,
          images: {
            loader: createObsidianImageLoader(this.app, view.file),
            allowFailures: true,
            onProgress: (progress) => {
              if (version === this.renderVersion && loading.isConnected) {
                loading.setText(
                  `이미지 불러오는 중 ${progress.completed}/${progress.total} · ${
                    progress.status === "embedded" ? "포함 준비" : "누락"
                  }`
                );
              }
            }
          }
        });
        entry = {
          svg: sanitizeSvg(result.render.svg),
          warnings: result.render.warnings,
          adapterWarnings: result.warnings.map((warning) => warning.message),
          imageCount: result.imageCount,
          embeddedImageCount: result.embeddedImageCount,
          embeddedImageOccurrences: result.embeddedImageOccurrences,
          imageFailureCount: result.imageFailures.length,
          documentStyleName: result.documentStyleName,
          documentStyleSummary: documentStyle ? documentStyleSummary(documentStyle) : undefined,
          pages: result.render.pageCount
        };
        this.cache.set(key, entry);
        if (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value);
      } catch (error: any) {
        if (version !== this.renderVersion || !this.previewEl) return;
        this.previewEl.empty();
        this.previewEl.createDiv({ cls: "hanmark-preview-error", text: `미리보기 실패: ${error?.message || String(error)}` });
        return;
      }
    }

    if (version !== this.renderVersion || !this.previewEl) return;
    this.previewEl.empty();
    const summary = this.previewEl.createDiv({ cls: "hanmark-preview-summary" });
    const imageSummary = entry.imageCount
      ? ` · 이미지 ${entry.embeddedImageCount}개 포함${
          entry.embeddedImageOccurrences > entry.embeddedImageCount
            ? ` (${entry.embeddedImageOccurrences}곳 배치)`
            : ""
        }${entry.imageFailureCount ? ` · ${entry.imageFailureCount}개 누락` : ""}`
      : "";
    summary.setText(
      `${entry.pages}쪽 · Kordoc 구조 검증 완료${entry.documentStyleName ? ` · ${entry.documentStyleName} 적용` : ""}${imageSummary}`
    );
    if (entry.documentStyleSummary) {
      const styleDetails = this.previewEl.createEl("details", { cls: "hanmark-preview-style-details" });
      styleDetails.createEl("summary", { text: "실제 HWPX에서 읽은 적용 스타일" });
      styleDetails.createEl("p", { text: entry.documentStyleSummary });
    }
    const warnings = [...new Set([...entry.adapterWarnings, ...entry.warnings])];
    if (warnings.length) {
      const details = this.previewEl.createEl("details", { cls: "hanmark-preview-warnings" });
      details.createEl("summary", { text: `변환 안내 ${warnings.length}건` });
      const list = details.createEl("ul");
      warnings.slice(0, 20).forEach((warning) => list.createEl("li", { text: warning }));
    }
    const paper = this.previewEl.createDiv({ cls: "hanmark-preview-paper" });
    paper.innerHTML = entry.svg;
    const svg = paper.querySelector("svg");
    if (svg) {
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "auto");
      svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
    }
  }

  async onClose(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.previewEl = null;
    this.cache.clear();
  }
}
