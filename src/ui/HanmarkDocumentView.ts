import { FileView, Notice, type TFile, type WorkspaceLeaf } from "obsidian";
import { renderDocumentToScene } from "kordoc";
import { appendSanitizedSvg } from "./svgSanitize";
import { describeImportFailure } from "../io/messageCatalog";
import { errorMessage } from "../utils/errors";
import { t } from "../i18n";

export const HANMARK_DOCUMENT_VIEW = "hanmark-document-view";
export const HANGUL_DOCUMENT_EXTENSIONS: readonly string[] = ["hwp", "hwpx"];

/** Pages rendered per step; each step re-reads the document, so keep it modest. */
const PAGE_BATCH = 5;

export interface HanmarkDocumentViewActions {
  convertToNote(file: TFile): void | Promise<void>;
  /** Old–new comparison with this document preselected as the current version. */
  compare?(file: TFile): void;
  /** HWPX copy of this HWP document, next to it (HWP only). */
  convertToHwpx?(file: TFile): void | Promise<void>;
  /** Form note from this HWPX or HWP 5.x form. */
  formNote?(file: TFile): void | Promise<void>;
  /** Present only on desktop, where the operating system can open the file. */
  openWithDefaultApp?(file: TFile): Promise<void>;
}

/**
 * Read-only Hangul document viewer (2.7.0 W4). Kordoc lays out HWP and HWPX pages
 * as SVG in-process; nothing is written back to the original.
 */
export class HanmarkDocumentView extends FileView {
  private renderVersion = 0;
  private bytes: Uint8Array | null = null;
  private shownPages = 0;
  private totalPages = 0;
  private pagesEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private moreEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly actions: HanmarkDocumentViewActions) {
    super(leaf);
  }

  getViewType(): string {
    return HANMARK_DOCUMENT_VIEW;
  }

  getIcon(): string {
    return "file-text";
  }

  canAcceptExtension(extension: string): boolean {
    return HANGUL_DOCUMENT_EXTENSIONS.includes(extension.toLowerCase());
  }

  async onLoadFile(file: TFile): Promise<void> {
    const version = ++this.renderVersion;
    this.bytes = null;
    this.shownPages = 0;
    this.totalPages = 0;
    const root = this.contentEl;
    root.empty();
    root.addClass("hanmark-document-view");

    const toolbar = root.createDiv({ cls: "hanmark-document-toolbar" });
    const convert = toolbar.createEl("button", { text: t("viewer.convert") });
    convert.classList.add("mod-cta");
    convert.onclick = () => void Promise.resolve(this.actions.convertToNote(file)).catch(
      (error: unknown) => new Notice(errorMessage(error))
    );
    if (this.actions.compare) {
      toolbar.createEl("button", { text: t("viewer.compare") }).onclick = () => this.actions.compare?.(file);
    }
    if (this.actions.convertToHwpx && file.extension.toLowerCase() === "hwp") {
      const toHwpx = toolbar.createEl("button", { text: t("viewer.convertToHwpx"), attr: { "data-hanmark-action": "convert-to-hwpx" } });
      toHwpx.onclick = () => {
        void Promise.resolve(this.actions.convertToHwpx?.(file)).catch((error: unknown) => new Notice(errorMessage(error)));
      };
    }
    if (this.actions.formNote) {
      toolbar.createEl("button", { text: t("viewer.formNote") }).onclick = () => {
        void Promise.resolve(this.actions.formNote?.(file)).catch((error: unknown) => new Notice(errorMessage(error)));
      };
    }
    if (this.actions.openWithDefaultApp) {
      toolbar.createEl("button", { text: t("viewer.openDefault") }).onclick = () => {
        void this.actions.openWithDefaultApp?.(file).catch((error: unknown) => new Notice(errorMessage(error)));
      };
    }
    root.createEl("p", { cls: "hanmark-document-note", text: `${t("viewer.readOnly")} · ${t("viewer.fontNote")}` });
    this.statusEl = root.createEl("p", { cls: "hanmark-document-status", text: t("viewer.loading") });
    this.pagesEl = root.createDiv({ cls: "hanmark-document-pages" });
    this.moreEl = root.createDiv({ cls: "hanmark-document-more" });

    try {
      const bytes = new Uint8Array(await this.app.vault.readBinary(file));
      if (version !== this.renderVersion) return;
      this.bytes = bytes;
      await this.renderNextPages(version);
    } catch (error: unknown) {
      if (version === this.renderVersion) this.showFailure(error);
    }
  }

  async onUnloadFile(): Promise<void> {
    this.renderVersion += 1;
    this.bytes = null;
    this.contentEl.empty();
  }

  private showFailure(error: unknown): void {
    const code = (error as { code?: unknown } | null)?.code;
    const described = typeof code === "string" ? describeImportFailure(code) : null;
    this.statusEl?.setText(
      described ? `${described.title} ${described.fix ?? ""}`.trim() : t("viewer.failed", { detail: errorMessage(error) })
    );
    this.moreEl?.empty();
  }

  private async renderNextPages(version: number): Promise<void> {
    if (!this.bytes || !this.pagesEl) return;
    const start = this.shownPages + 1;
    const end = this.totalPages ? Math.min(this.totalPages, start + PAGE_BATCH - 1) : start + PAGE_BATCH - 1;
    this.moreEl?.empty();
    try {
      const { scene, pageSvgs } = await renderDocumentToScene(this.bytes, { pages: `${start}-${end}` });
      if (version !== this.renderVersion || !this.pagesEl) return;
      this.totalPages = scene.pages.length;
      for (const page of [...pageSvgs.keys()].sort((a, b) => a - b)) {
        const paper = this.pagesEl.createDiv({ cls: "hanmark-document-page", attr: { "data-page": String(page) } });
        const svg = appendSanitizedSvg(paper, pageSvgs.get(page) ?? "");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "auto");
        svg.setAttribute("preserveAspectRatio", "xMidYMin meet");
        this.shownPages = Math.max(this.shownPages, page);
      }
    } catch (error: unknown) {
      if (version === this.renderVersion) this.showFailure(error);
      return;
    }
    this.statusEl?.setText(t("viewer.pages", { shown: this.shownPages, total: this.totalPages }));
    const remaining = this.totalPages - this.shownPages;
    if (remaining > 0 && this.moreEl) {
      const more = this.moreEl.createEl("button", {
        text: t("viewer.more", { count: Math.min(PAGE_BATCH, remaining) })
      });
      more.onclick = () => {
        more.disabled = true;
        void this.renderNextPages(version);
      };
    }
  }
}
