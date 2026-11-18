import { shouldPauseLivePreview } from "./previewPolicy";
import { ItemView, MarkdownView, Notice, Platform, WorkspaceLeaf, type TFile, type ViewStateResult } from "obsidian";
import type { FormatProfile, GongmunPreset } from "kordoc";
import { extractEditableBody } from "../io/frontmatter";
import { renderQuickHwpxPreview, type GenerateHwpxOptions } from "../io/kordocEngine";
import { createObsidianImageLoader } from "../io/obsidianImageLoader";
import { documentStyleSummary, type DocumentStyleProfile } from "../io/documentStyle";
import { errorMessage } from "../utils/errors";
import { t, type LanguagePreference } from "../i18n";
import { appendSanitizedSvg, sanitizeSvg } from "./svgSanitize";
import { prepareExportMarkdown, type ExportDiagramOptions } from "../io/exportPreparation";
import { createVaultAssemblyHost } from "../io/vaultAssemblyHost";
import { gongmunGenerateOptions, type GongmunExportPlan, type GongmunFormOption } from "../io/gongmunExport";
import { renderGongmunFormPicker, type GongmunPickerHost } from "./gongmunFormPicker";
import { flashDone, setPhase } from "./motion";
import type { EditorActivity } from "./editorActivity";
import { PreviewNav } from "./previewNav";
import {
  alignHeadings,
  anchorAt,
  followTarget,
  indexKordocSvg,
  isPreviewZoom,
  noteHeadings,
  offsetFor,
  pageAt,
  PREVIEW_ZOOM_STEPS,
  stepZoom,
  type AlignedHeading,
  type PreviewAnchor,
  type PreviewIndex,
  type PreviewZoom
} from "./previewIndex";

export const QUICK_HWPX_PREVIEW_VIEW = "hanmark-quick-hwpx-preview";

/**
 * Quick HWPX (document template) or an official document. \`formId\` is the form
 * chosen in the export window, so the preview shows that form even when the note
 * names another type.
 */
export type QuickPreviewMode = { kind: "quick" } | { kind: "gongmun"; preset: GongmunPreset; formId?: string };

export interface QuickPreviewOptions {
  profile(): FormatProfile | undefined;
  documentStyle(): DocumentStyleProfile | undefined;
  /** Opt-in font substitutions of the active template. */
  fontRules?(): Record<string, string>;
  sourceView?(): MarkdownView | null;
  livePreviewEnabled?(): boolean;
  autoPauseEnabled?(): boolean;
  outputLanguage?(): LanguagePreference;
  assembleEmbeds?(): boolean;
  /** Diagram drawing for the preview (R-033); undefined keeps Mermaid blocks as code. */
  diagrams?(): ExportDiagramOptions | undefined;
  gongmunPlan?(file: TFile, preset: GongmunPreset, formId?: string): GongmunExportPlan;
  /** Official-document forms for the toolbar: institutions', standard, the user's (R-026). */
  gongmunForms?(): GongmunFormOption[];
  /** Frame and look picker of the toolbar (R-030). */
  gongmunPicker?(): GongmunPickerHost;
  /** A form by id, including frame-and-look pairs the short list does not show. */
  describeGongmunForm?(id: string): GongmunFormOption | undefined;
  /** The form a note starts with (active institution form, else the note's type, else the last type). */
  currentGongmunForm?(file: TFile): string;
  /** Makes a form active everywhere, remembers it for the note, and returns its document type. */
  selectGongmunForm?(id: string, file?: TFile): Promise<GongmunPreset>;
  /** Remembers what the preview shows when it opens next time. */
  rememberMode?(kind: QuickPreviewMode["kind"]): Promise<void>;
  /** Saves the note as HWPX exactly as the preview shows it (the export flow and its report); true when saved. */
  exportHwpx?(mode: QuickPreviewMode): Promise<boolean | void>;
  /** Cursor moves and edits in Markdown editors, for following the cursor (R-028). Returns an unsubscribe function. */
  subscribeActivity?(listener: (activity: EditorActivity) => void, delayMs: number): () => void;
  /** Whether previews follow the cursor (R-028). */
  followCursor?(): boolean;
  setFollowCursor?: (on: boolean) => Promise<void>;
}

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

/** What is on screen, and where its pages and the note's headings are (R-028). */
interface ShownPreview {
  /** The render key plus the paused state: the same key means the same picture. */
  key: string;
  /** The note and the mode; the reading position carries over only within one. */
  identity: string;
  path: string;
  svg: SVGElement;
  paper: HTMLElement;
  index: PreviewIndex;
  aligned: AlignedHeading[];
  lineCount: number;
}

interface PaneGeometry {
  root: HTMLElement;
  /** Screen pixels per SVG unit (pt). */
  scale: number;
  /** Where the canvas starts inside the scrolling pane. */
  canvasTop: number;
  /** The sticky header's height: the visible area starts below it. */
  header: number;
  viewHeight: number;
}

/** Toolbar values of the kind select; form ids look like "form:<frame>/<look>…". */
const QUICK_VALUE = "quick";
const GONGMUN_VALUE = "gongmun";

/** A user scroll or click in the preview pauses following the cursor this long (ms). */
const FOLLOW_PAUSE = 1500;

/** 100% draws 1 pt as 4/3 CSS pixels, like the paper size in Hancom Office. */
const PX_PER_PT = 4 / 3;

function cacheKey(sourcePath: string, markdown: string, settings: unknown): string {
  let hash = 2166136261;
  const value = `${sourcePath}\u0000${markdown}\u0000${JSON.stringify(settings)}`;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export class QuickHwpxPreviewView extends ItemView {
  private renderVersion = 0;
  /** Automatic refresh stops for a slow or very large note until the note changes. */
  private autoPausedPath: string | null = null;
  private timer: number | null = null;
  private rootEl: HTMLElement | null = null;
  private headerEl: HTMLElement | null = null;
  private toolbarEl: HTMLElement | null = null;
  private previewEl: HTMLElement | null = null;
  private cautionEl: HTMLElement | null = null;
  private flowEl: HTMLElement | null = null;
  private nav: PreviewNav | null = null;
  private mode: QuickPreviewMode = { kind: "quick" };
  /** Note the toolbar was last drawn for. */
  private toolbarPath: string | null | undefined = undefined;
  private readonly cache = new Map<string, PreviewCacheEntry>();
  private shown: ShownPreview | null = null;
  /** null fits the pane width; else a step of PREVIEW_ZOOM_STEPS, kept per pane. */
  private zoom: PreviewZoom | null = null;
  private lastUserScroll = 0;
  private scrollFrame: number | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly options: QuickPreviewOptions) {
    super(leaf);
  }

  getViewType(): string {
    return QUICK_HWPX_PREVIEW_VIEW;
  }

  getDisplayText(): string {
    return t("preview.hwpx.label");
  }

  getIcon(): string {
    return "file-search";
  }

  getState(): Record<string, unknown> {
    return { ...super.getState(), zoom: this.zoom };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const zoom = state && typeof state === "object" ? (state as { zoom?: unknown }).zoom : undefined;
    this.zoom = isPreviewZoom(zoom) ? zoom : null;
    this.applyZoom();
    await super.setState(state, result);
  }

  /** Switch between quick HWPX and an official document (from the plugin or the export window). */
  setMode(mode: QuickPreviewMode): void {
    this.mode = mode;
    this.cache.clear();
    this.renderToolbar();
    this.schedule(true);
  }

  private livePreviewEnabled(): boolean {
    return this.options.livePreviewEnabled?.() ?? true;
  }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("hanmark-quick-preview");
    this.rootEl = root;
    const header = root.createDiv({ cls: "hanmark-hwpx-preview-header" });
    this.headerEl = header;
    this.toolbarEl = header.createDiv({ cls: "hanmark-hwpx-preview-toolbar" });
    const setFollow = this.options.setFollowCursor;
    this.nav = new PreviewNav(header, {
      page: (delta) => this.movePage(delta),
      zoom: (direction) => this.changeZoom(direction),
      follow: setFollow && this.options.subscribeActivity ? (on) => void setFollow(on) : undefined
    });
    this.cautionEl = header.createDiv({ cls: "hanmark-preview-caution" });
    this.flowEl = header.createDiv({ cls: "hanmark-flow-line", attr: { "aria-hidden": "true" } });
    this.previewEl = root.createDiv({ cls: "hanmark-preview-stage" });

    this.registerDomEvent(root, "scroll", () => this.onScroll(), { passive: true });
    // Scrolling or clicking the preview yourself pauses following the cursor for a moment.
    const touched = (): void => {
      this.lastUserScroll = Date.now();
    };
    this.registerDomEvent(root, "wheel", touched, { passive: true });
    this.registerDomEvent(root, "pointerdown", touched, { passive: true });
    this.registerDomEvent(root, "keydown", touched);
    const unsubscribe = this.options.subscribeActivity?.((activity) => this.follow(activity), 200);
    if (unsubscribe) this.register(unsubscribe);

    this.registerEvent(
      this.app.workspace.on("editor-change", () => this.scheduleIfEnabled())
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () =>
        this.scheduleIfEnabled()
      )
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.scheduleIfEnabled())
    );
    this.renderToolbar();
    this.syncNav();
    await this.updatePreview();
  }

  /** Called when templates, forms, or settings change elsewhere. */
  forceRefresh(): void {
    this.cache.clear();
    this.renderToolbar();
    this.syncNav();
    this.schedule(true);
  }

  /** Redraws the navigation row only (the follow setting changed elsewhere). */
  refreshControls(): void {
    this.syncNav();
  }

  /** Whether the preview shows an official-document form (the status bar then shows the form). */
  showsForm(): boolean {
    return this.mode.kind === "gongmun";
  }

  private sourceView(): MarkdownView | null {
    return this.options.sourceView?.() ?? this.app.workspace.getActiveViewOfType(MarkdownView);
  }

  /** The form the preview shows for a note: the one remembered for it, else its starting form (R-028). */
  private formId(file: TFile | null | undefined): string | undefined {
    return file ? this.options.currentGongmunForm?.(file) : undefined;
  }

  private form(file: TFile | null | undefined): GongmunFormOption | undefined {
    const id = this.formId(file);
    if (!id) return undefined;
    return this.options.describeGongmunForm?.(id) ?? this.options.gongmunForms?.().find((item) => item.id === id);
  }

  /** The mode with the form shown for this note, so the render and a save use exactly that form. */
  private effectiveMode(file: TFile): QuickPreviewMode {
    if (this.mode.kind === "quick") return this.mode;
    const form = this.form(file);
    return { kind: "gongmun", preset: form?.preset ?? this.mode.preset, formId: form?.id };
  }

  private renderToolbar(): void {
    const toolbar = this.toolbarEl;
    if (!toolbar) return;
    const file = this.sourceView()?.file ?? null;
    this.toolbarPath = file?.path ?? null;
    toolbar.empty();
    toolbar.createSpan({ cls: "hanmark-hwpx-preview-label", text: t("preview.hwpx.label") });

    // Quick HWPX or an official document; an official document then shows its
    // frame, look, and switches right here (R-026, R-030).
    const select = toolbar.createEl("select", {
      cls: "dropdown",
      attr: { "aria-label": t("preview.hwpx.kind") }
    });
    select.createEl("option", { value: QUICK_VALUE, text: t("preview.hwpx.quick") });
    select.createEl("option", { value: GONGMUN_VALUE, text: t("preview.hwpx.gongmun") });
    const form = this.mode.kind === "gongmun" ? this.form(file) : undefined;
    select.value = form ? GONGMUN_VALUE : QUICK_VALUE;
    select.onchange = () => void this.choose(select.value);
    const picker = this.options.gongmunPicker?.();
    if (form && picker) {
      renderGongmunFormPicker(toolbar, {
        host: picker,
        formId: form.id,
        idPrefix: "hanmark-preview-gongmun",
        compact: true,
        onChange: (id) => void this.choose(id)
      });
    }

    const refresh = toolbar.createEl("button", { text: t("preview.hwpx.refresh"), attr: { type: "button" } });
    refresh.onclick = () => this.forceRefresh();
    if (this.options.exportHwpx) {
      const save = toolbar.createEl("button", {
        text: t("preview.hwpx.save"),
        cls: "mod-cta",
        attr: { type: "button" }
      });
      save.onclick = () => void this.save(save);
    }

    const caution = t("preview.quick.caution");
    this.cautionEl?.setText(form?.description ? `${form.description} · ${caution}` : caution);
  }

  private async choose(value: string): Promise<void> {
    try {
      if (value === QUICK_VALUE) {
        this.mode = { kind: "quick" };
      } else {
        const fallback = this.mode.kind === "gongmun" ? this.mode.preset : "report";
        const file = this.sourceView()?.file ?? undefined;
        // "gongmun" switches to official documents on the form the note starts with.
        const id = value === GONGMUN_VALUE ? (file ? this.options.currentGongmunForm?.(file) : undefined) : value;
        if (!id) throw new Error(t("preview.quick.openNote"));
        const preset = (await this.options.selectGongmunForm?.(id, file)) ?? fallback;
        this.mode = { kind: "gongmun", preset, formId: id };
      }
      await this.options.rememberMode?.(this.mode.kind);
    } catch (error: unknown) {
      new Notice(errorMessage(error));
    }
    this.cache.clear();
    this.renderToolbar();
    this.schedule(true);
  }

  private async save(button?: HTMLElement): Promise<void> {
    const file = this.sourceView()?.file;
    if (!file) {
      new Notice(t("preview.quick.openNote"));
      return;
    }
    if (button) setPhase(button, "waiting");
    let saved: boolean | void = false;
    try {
      saved = await this.options.exportHwpx?.(this.effectiveMode(file));
    } finally {
      if (button) {
        if (saved) flashDone(button);
        else setPhase(button, null);
      }
    }
  }

  private scheduleIfEnabled(): void {
    if (!this.livePreviewEnabled()) return;
    if (this.autoPausedPath !== null) {
      const path = this.sourceView()?.file?.path ?? null;
      if (path === this.autoPausedPath) return;
      this.autoPausedPath = null;
    }
    this.schedule();
  }

  private schedule(immediate = false): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.updatePreview();
    }, immediate ? 0 : 500);
  }

  private generationOptions(file: TFile): { options: GenerateHwpxOptions; notes: string[]; styleSummary?: string } {
    const outputLanguage = this.options.outputLanguage?.() ?? "auto";
    const platform = Platform.isWin ? "win32" : Platform.isMacOS ? "darwin" : "linux";
    const mode = this.effectiveMode(file);
    if (mode.kind === "gongmun" && this.options.gongmunPlan) {
      const plan = this.options.gongmunPlan(file, mode.preset, mode.formId);
      return {
        options: { ...gongmunGenerateOptions(plan), outputLanguage, fontResolver: { platform } },
        notes: plan.warnings.map((warning) => warning.message)
      };
    }
    const documentStyle = this.options.documentStyle();
    return {
      options: {
        profile: this.options.profile(),
        documentStyle,
        outputLanguage,
        fontResolver: { platform, rules: this.options.fontRules?.() }
      },
      notes: [],
      styleSummary: documentStyle ? documentStyleSummary(documentStyle) : undefined
    };
  }

  /** The same key means the same picture: the render, and whether the paused notice shows. */
  private shownKey(key: string, path: string): string {
    return `${key}\u0000${this.autoPausedPath === path ? "paused" : ""}`;
  }

  private async updatePreview(): Promise<void> {
    if (!this.previewEl) return;
    const version = ++this.renderVersion;
    const view = this.sourceView();
    // Another note may start with another form; redraw the toolbar for it.
    if ((view?.file?.path ?? null) !== this.toolbarPath) this.renderToolbar();
    if (!view?.file) {
      this.showMessage(t("preview.quick.openNote"));
      return;
    }
    const text = view.editor.getValue();
    const body = extractEditableBody(text);
    if (!body.trim()) {
      this.showMessage(t("preview.quick.empty"));
      return;
    }

    const file = view.file;
    const generation = this.generationOptions(file);
    const prepared = await prepareExportMarkdown(createVaultAssemblyHost(this.app), body, file.path, {
      assembleEmbeds: this.options.assembleEmbeds?.() ?? true,
      outputLanguage: generation.options.outputLanguage ?? "auto",
      diagrams: this.options.diagrams?.()
    });
    if (version !== this.renderVersion || !this.previewEl) return;
    const markdown = prepared.markdown;
    const mode = this.effectiveMode(file);
    const key = cacheKey(file.path, markdown, {
      mode,
      gongmun: generation.options.gongmun,
      finish: generation.options.gongmunFinish,
      outline: generation.options.gongmunOutline,
      profile: generation.options.profile,
      documentStyle: generation.options.documentStyle,
      outputLanguage: generation.options.outputLanguage,
      rules: generation.options.fontResolver?.rules
    });
    const identity = `${file.path}\u0000${JSON.stringify(mode)}`;
    let entry = this.cache.get(key);
    const shown = this.shown;
    if (entry && shown?.key === this.shownKey(key, file.path) && shown.paper.isConnected) {
      // The same picture is already on screen: keep it (no flicker, no jump). Only the
      // note's lines may have moved, for following the cursor.
      Object.assign(shown, this.headingsFor(text, shown.index));
      this.setWorking(false);
      return;
    }
    if (!entry) {
      // Keep the previous picture while the new one is drawn; the loading box is only
      // for the first picture.
      const stage = this.previewEl;
      const keep = Boolean(shown?.paper.isConnected);
      let loading: HTMLElement | null = null;
      if (!keep) {
        stage.empty();
        loading = stage.createDiv({ cls: "hanmark-preview-loading", text: t("preview.quick.loading") });
      }
      this.setWorking(true);
      try {
        const started = performance.now();
        const result = await renderQuickHwpxPreview(markdown, {
          ...generation.options,
          images: {
            loader: createObsidianImageLoader(this.app, file),
            allowFailures: true,
            onProgress: (progress) => {
              if (version !== this.renderVersion) return;
              const counts = { completed: progress.completed, total: progress.total };
              const message =
                progress.status === "embedded"
                  ? t("preview.quick.imageProgressEmbedded", counts)
                  : t("preview.quick.imageProgressMissing", counts);
              if (loading?.isConnected) loading.setText(message);
              else this.nav?.setStatus("working", message);
            }
          }
        });
        if (
          (this.options.autoPauseEnabled?.() ?? true) &&
          shouldPauseLivePreview(performance.now() - started, markdown.length)
        ) {
          this.autoPausedPath = file.path;
        }
        entry = {
          svg: sanitizeSvg(result.render.svg),
          warnings: result.render.warnings,
          adapterWarnings: [
            ...generation.notes,
            ...[...prepared.warnings, ...result.warnings].map((warning) => warning.message)
          ],
          imageCount: result.imageCount,
          embeddedImageCount: result.embeddedImageCount,
          embeddedImageOccurrences: result.embeddedImageOccurrences,
          imageFailureCount: result.imageFailures.length,
          documentStyleName: result.documentStyleName,
          documentStyleSummary: generation.styleSummary,
          pages: result.render.pageCount
        };
        this.cache.set(key, entry);
        if (this.cache.size > 4) {
          const oldest: unknown = this.cache.keys().next().value;
          if (typeof oldest === "string") this.cache.delete(oldest);
        }
      } catch (error: unknown) {
        if (version !== this.renderVersion || !this.previewEl) return;
        this.showFailure(errorMessage(error), keep);
        return;
      }
    }

    if (version !== this.renderVersion || !this.previewEl) return;
    this.show(entry, file, key, identity, text);
  }

  /**
   * Draws the picture off screen and swaps it in at once, keeping the reading position
   * and the open sections when the note and the mode are the same.
   */
  private show(entry: PreviewCacheEntry, file: TFile, key: string, identity: string, text: string): void {
    const stage = this.previewEl;
    if (!stage) return;
    const previous = this.shown;
    const samePlace = previous?.identity === identity && previous.paper.isConnected;
    const anchor = samePlace ? this.visibleAnchor() : null;
    const open = samePlace ? this.openSections() : new Set<string>();

    const next = createDiv();
    if (this.autoPausedPath === file.path) {
      const paused = next.createDiv({ cls: "hanmark-preview-paused" });
      paused.createSpan({ text: t("preview.quick.paused") });
      const refresh = paused.createEl("button", { text: t("preview.quick.refreshNow") });
      refresh.onclick = () => this.forceRefresh();
    }
    const summary = next.createDiv({ cls: "hanmark-preview-summary" });
    const imageSummary = entry.imageCount
      ? `${t("preview.quick.imagesEmbedded", { count: entry.embeddedImageCount })}${
          entry.embeddedImageOccurrences > entry.embeddedImageCount
            ? t("preview.quick.imagePlacements", { count: entry.embeddedImageOccurrences })
            : ""
        }${entry.imageFailureCount ? t("preview.quick.imagesMissing", { count: entry.imageFailureCount }) : ""}`
      : "";
    summary.setText(
      `${t("preview.quick.pagesVerified", { count: entry.pages })}${
        entry.documentStyleName ? t("preview.quick.styleApplied", { name: entry.documentStyleName }) : ""
      }${imageSummary}`
    );
    if (entry.documentStyleSummary) {
      const styleDetails = next.createEl("details", { cls: "hanmark-preview-style-details" });
      styleDetails.open = open.has("hanmark-preview-style-details");
      styleDetails.createEl("summary", { text: t("preview.quick.styleDetails") });
      styleDetails.createEl("p", { text: entry.documentStyleSummary });
    }
    const warnings = [...new Set([...entry.adapterWarnings, ...entry.warnings])];
    if (warnings.length) {
      const details = next.createEl("details", { cls: "hanmark-preview-warnings" });
      details.open = open.has("hanmark-preview-warnings");
      details.createEl("summary", { text: t("preview.quick.warnings", { count: warnings.length }) });
      const list = details.createEl("ul");
      warnings.slice(0, 20).forEach((warning) => list.createEl("li", { text: warning }));
    }
    const paper = next.createDiv({ cls: "hanmark-preview-paper" });
    const svg = appendSanitizedSvg(paper, entry.svg);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "auto");
    svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
    const index = indexKordocSvg(svg);

    stage.replaceChildren(...Array.from(next.childNodes));
    this.clearBanner();
    this.shown = { key: this.shownKey(key, file.path), identity, path: file.path, svg, paper, index, ...this.headingsFor(text, index) };
    this.applyZoom();
    if (anchor) this.scrollToCanvas(offsetFor(index, anchor));
    this.setWorking(false);
  }

  private headingsFor(text: string, index: PreviewIndex): { aligned: AlignedHeading[]; lineCount: number } {
    return { aligned: alignHeadings(noteHeadings(text), index.paragraphs), lineCount: text.split("\n").length };
  }

  private openSections(): Set<string> {
    const open = new Set<string>();
    this.previewEl?.querySelectorAll("details").forEach((details) => {
      if (details.open) details.classList.forEach((name) => open.add(name));
    });
    return open;
  }

  private clearBanner(): void {
    this.headerEl?.querySelector(".hanmark-preview-banner")?.remove();
  }

  private showMessage(text: string): void {
    this.clearBanner();
    this.previewEl?.setText(text);
    this.shown = null;
    this.setWorking(false);
  }

  /** A failed redraw keeps the previous picture under a notice; without one, the error takes its place. */
  private showFailure(detail: string, keep: boolean): void {
    const stage = this.previewEl;
    if (!stage) return;
    this.clearBanner();
    if (keep && this.shown?.paper.isConnected) {
      // In the sticky header, so the notice shows wherever the preview is scrolled.
      const banner = createDiv({
        cls: "hanmark-preview-banner hanmark-arrive",
        text: t("preview.quick.keptPrevious", { detail }),
        attr: { role: "alert" }
      });
      if (this.cautionEl) this.cautionEl.before(banner);
      else this.headerEl?.append(banner);
    } else {
      stage.empty();
      stage.createDiv({ cls: "hanmark-preview-error", text: t("preview.quick.failed", { detail }) });
      this.shown = null;
    }
    if (this.flowEl) this.flowEl.dataset.active = "false";
    this.syncNav();
    this.nav?.setStatus("failed");
  }

  private setWorking(working: boolean): void {
    if (this.flowEl) this.flowEl.dataset.active = String(working);
    this.syncNav();
    const paused = this.shown !== null && this.autoPausedPath === this.shown.path;
    this.nav?.setStatus(working ? "working" : paused ? "paused" : "ready");
  }

  private geometry(): PaneGeometry | null {
    const root = this.rootEl;
    const shown = this.shown;
    if (!root || !shown?.svg.isConnected || shown.index.width <= 0) return null;
    const box = shown.svg.getBoundingClientRect();
    const scale = box.width / shown.index.width;
    if (!(scale > 0)) return null;
    const header = this.headerEl?.offsetHeight ?? 0;
    return {
      root,
      scale,
      canvasTop: box.top - root.getBoundingClientRect().top + root.scrollTop,
      header,
      viewHeight: Math.max(1, root.clientHeight - header)
    };
  }

  /** The canvas position (pt) `share` of the way down the visible area. */
  private visibleY(share = 0): number | null {
    const pane = this.geometry();
    if (!pane) return null;
    return (pane.root.scrollTop + pane.header + share * pane.viewHeight - pane.canvasTop) / pane.scale;
  }

  private visibleAnchor(): PreviewAnchor | null {
    const y = this.visibleY();
    return y === null || !this.shown ? null : anchorAt(this.shown.index, y);
  }

  /** Scrolls so canvas position `y` (pt) sits `share` of the way down the visible area. */
  private scrollToCanvas(y: number, share = 0, smooth = false, gap = 0): void {
    const pane = this.geometry();
    if (!pane) return;
    const top = pane.canvasTop + y * pane.scale - pane.header - share * pane.viewHeight - gap;
    const reduced = pane.root.win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    pane.root.scrollTo({ top: Math.max(0, top), behavior: smooth && !reduced ? "smooth" : "auto" });
  }

  private onScroll(): void {
    if (this.scrollFrame !== null || !this.rootEl) return;
    this.scrollFrame = this.rootEl.win.requestAnimationFrame(() => {
      this.scrollFrame = null;
      this.syncPages();
    });
  }

  private syncPages(): void {
    const shown = this.shown;
    const total = shown?.index.pages.length ?? 0;
    const y = this.visibleY(0.3);
    this.nav?.setPages(shown && y !== null ? pageAt(shown.index, y) : Math.min(1, total), total);
  }

  private syncNav(): void {
    const nav = this.nav;
    if (!nav) return;
    this.syncPages();
    const pane = this.geometry();
    const percent = this.zoom ?? (pane ? (pane.scale / PX_PER_PT) * 100 : 100);
    nav.setZoom(this.zoom === null, percent, percent > PREVIEW_ZOOM_STEPS[0] + 0.5, percent < 199.5);
    nav.setZoomVisible(this.shown !== null);
    nav.setFollow(this.options.followCursor?.() ?? false);
  }

  private movePage(delta: -1 | 1): void {
    const shown = this.shown;
    const y = this.visibleY(0.3);
    if (!shown || y === null) return;
    const target = shown.index.pages.find((page) => page.page === pageAt(shown.index, y) + delta);
    if (!target) return;
    this.lastUserScroll = Date.now();
    this.scrollToCanvas(target.top, 0, true, 10);
  }

  private applyZoom(): void {
    const shown = this.shown;
    if (shown) {
      const zoom = this.zoom;
      shown.paper.toggleClass("is-zoomed", zoom !== null);
      shown.svg.setAttribute("width", zoom === null ? "100%" : String(Math.round((shown.index.width * PX_PER_PT * zoom) / 100)));
    }
    this.syncNav();
  }

  private changeZoom(direction: -1 | 0 | 1): void {
    const anchor = this.visibleAnchor();
    const pane = this.geometry();
    const current = this.zoom ?? (pane ? (pane.scale / PX_PER_PT) * 100 : 100);
    this.zoom = direction === 0 ? null : stepZoom(current, direction);
    this.applyZoom();
    if (anchor && this.shown) this.scrollToCanvas(offsetFor(this.shown.index, anchor));
    this.app.workspace.requestSaveLayout();
  }

  /**
   * Follow mode (R-028): after the cursor moves, bring the matching place into view,
   * only when it is outside the comfortable middle of the pane and the preview was not
   * scrolled by hand a moment ago.
   */
  private follow(activity: EditorActivity): void {
    const shown = this.shown;
    if (!shown || (!activity.selectionSet && !activity.docChanged)) return;
    if (!(this.options.followCursor?.() ?? false)) return;
    const editor = activity.view?.editor;
    if (!editor || activity.path !== shown.path) return;
    if (Date.now() - this.lastUserScroll < FOLLOW_PAUSE) return;
    const pane = this.geometry();
    if (!pane) return;
    const target = followTarget(editor.getCursor("head").line, shown.aligned, shown.lineCount, shown.index.height);
    const at = pane.canvasTop + target * pane.scale - pane.root.scrollTop - pane.header;
    if (at >= pane.viewHeight * 0.12 && at <= pane.viewHeight * 0.72) return;
    this.scrollToCanvas(target, 0.3, true);
  }

  async onClose(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.scrollFrame !== null) this.rootEl?.win.cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = null;
    this.rootEl = null;
    this.headerEl = null;
    this.toolbarEl = null;
    this.previewEl = null;
    this.cautionEl = null;
    this.flowEl = null;
    this.nav = null;
    this.shown = null;
    this.cache.clear();
  }
}
