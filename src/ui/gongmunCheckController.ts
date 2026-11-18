import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Notice, editorInfoField, type App, type MarkdownView, type TFile } from "obsidian";
import type { GongmunPreset } from "kordoc";
import {
  addIgnoreEntry,
  readIgnoreList,
  runGongmunCheck,
  type CheckFamilySwitches,
  type CheckFinding,
  type CheckOptions
} from "../io/gongmunCheck";
import { checkMarkCount, checkMarksEnabled, gongmunCheckMarks, setCheckMarksEnabled } from "./gongmunCheckMarks";
import { GongmunLintModal } from "./GongmunLintModal";
import { t } from "../i18n";

export interface GongmunCheckHost {
  app: App;
  families(): CheckFamilySwitches;
  preflightEnabled(): boolean;
  currentView(): MarkdownView | null;
  /** Form type of the note (decides whether bullet-style rules apply). */
  presetOf(file: TFile | null | undefined): GongmunPreset;
  addStatusItem(): HTMLElement;
}

/**
 * Glue between the check (io/gongmunCheck), its window, the editor underlines and the
 * export pre-flight (3.0.0, R-035). The plugin owns one controller.
 */
export class GongmunCheckController {
  readonly extension: Extension;
  private statusEl: HTMLElement | null = null;

  constructor(private readonly host: GongmunCheckHost) {
    this.extension = gongmunCheckMarks({
      options: (view) => this.optionsFor(this.fileOf(view)),
      ignore: (view, entry) => void this.storeIgnore(this.fileOf(view), entry),
      checked: (_view, findings) => {
        if (findings === null) new Notice(t("gongmun.lint.marks.tooLarge"));
        this.refreshStatus();
      }
    });
  }

  private fileOf(view: EditorView): TFile | null {
    return view.state.field(editorInfoField, false)?.file ?? null;
  }

  private ignoredOf(file: TFile | null | undefined): string[] {
    return file ? readIgnoreList(this.host.app.metadataCache.getFileCache(file)?.frontmatter) : [];
  }

  private optionsFor(file: TFile | null | undefined, preset?: GongmunPreset): CheckOptions {
    return { families: this.host.families(), preset: preset ?? this.host.presetOf(file), ignored: this.ignoredOf(file) };
  }

  private async storeIgnore(file: TFile | null, entry: string): Promise<void> {
    if (!file) return;
    try {
      await this.host.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        addIgnoreEntry(frontmatter, entry);
      });
    } catch {
      new Notice(t("gongmun.lint.ignoreFailed"));
    }
  }

  private editorView(view: MarkdownView | null): EditorView | null {
    return (view?.editor as unknown as { cm?: EditorView } | undefined)?.cm ?? null;
  }

  /** The check window for the active note. */
  openWindow(preset: GongmunPreset): void {
    const view = this.host.currentView();
    if (!view?.file) {
      new Notice(t("gongmun.lint.noNote"));
      return;
    }
    new GongmunLintModal(this.host.app, view.editor, preset, { families: this.host.families(), file: view.file }).open();
  }

  /** Switches the underlines of the active note's editor on or off. */
  toggleMarks(): void {
    const cm = this.editorView(this.host.currentView());
    if (!cm) {
      new Notice(t("gongmun.lint.noNote"));
      return;
    }
    const next = !checkMarksEnabled(cm);
    cm.dispatch({ effects: setCheckMarksEnabled.of(next) });
    new Notice(t(next ? "gongmun.lint.marks.on" : "gongmun.lint.marks.off"));
    this.refreshStatus();
  }

  /** Status-bar item: the count while underlines are on; a click toggles them. */
  installStatus(): void {
    this.statusEl = this.host.addStatusItem();
    this.statusEl.addClass("hanmark-status-check", "mod-clickable");
    this.statusEl.onclick = () => this.toggleMarks();
    this.refreshStatus();
  }

  refreshStatus(): void {
    const element = this.statusEl;
    if (!element) return;
    const cm = this.editorView(this.host.currentView());
    if (!cm) {
      element.hide();
      return;
    }
    element.show();
    const on = checkMarksEnabled(cm);
    element.setText(on ? t("gongmun.lint.marks.status", { count: checkMarkCount(cm) }) : t("gongmun.lint.marks.statusOff"));
    element.toggleClass("is-on", on);
  }

  /**
   * Pre-flight of an official-document export: resolves true when nothing needs
   * fixing, the setting is off, or the user chose to export anyway.
   */
  preflight(preset: GongmunPreset | undefined): Promise<boolean> {
    if (!this.host.preflightEnabled()) return Promise.resolve(true);
    const view = this.host.currentView();
    if (!view?.file) return Promise.resolve(true);
    const kind = preset ?? this.host.presetOf(view.file);
    const blocking = blockingFindings(runGongmunCheck(view.editor.getValue(), this.optionsFor(view.file, kind)).findings);
    if (!blocking.length) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      new GongmunLintModal(this.host.app, view.editor, kind, {
        families: this.host.families(),
        file: view.file,
        preflight: { onProceed: () => resolve(true), onCancel: () => resolve(false) }
      }).open();
    });
  }
}

/** Findings that stop the pre-flight: the ones the rulebook marks as errors. */
export function blockingFindings(findings: readonly CheckFinding[]): CheckFinding[] {
  return findings.filter((finding) => finding.severity === "error");
}
