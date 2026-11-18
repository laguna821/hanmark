import { Menu, type MarkdownView, type TFile } from "obsidian";
import { t } from "../i18n";
import type { GongmunFormOption } from "../io/gongmunExport";
import { countText, visibleMarkdownText, type TextCount } from "../utils/textCount";

/**
 * HanMark's status bar (R-028): the note's characters with and without spaces and its
 * 200-character manuscript sheets (the selection's while text is selected), and the
 * official-document form of the note, which opens a menu to change it. The form item
 * shows only for notes that have an official-document context.
 */
export interface StatusBarHost {
  /** `Plugin.addStatusBarItem`. */
  addItem: () => HTMLElement;
  currentView: () => MarkdownView | null;
  showCount: () => boolean;
  showForm: () => boolean;
  /** The short list of forms; with `base`, frames keep that form's look where they can (R-030). */
  forms: (base?: string) => GongmunFormOption[];
  /** A form by id, including frame-and-look pairs the short list does not show. */
  describeForm?: (id: string) => GongmunFormOption | undefined;
  /** Opens the look chooser for the note's form. */
  chooseLook?: (file: TFile) => void;
  /** The form shown for the note, or null when the note has no official-document context. */
  formFor: (file: TFile) => string | null;
  selectForm: (id: string, file: TFile) => Promise<void>;
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

export class HanmarkStatusBar {
  private readonly countEl: HTMLElement;
  private readonly formEl: HTMLElement;
  private formFile: TFile | null = null;
  /** The note's count is reused while only the cursor moves. */
  private noteCount: { path: string; count: TextCount } | null = null;

  constructor(private readonly host: StatusBarHost) {
    this.countEl = host.addItem();
    this.countEl.addClass("hanmark-status-count");
    this.countEl.setAttribute("aria-label", t("status.count.tooltip"));
    this.formEl = host.addItem();
    this.formEl.addClass("hanmark-status-form", "mod-clickable");
    this.formEl.setAttribute("role", "button");
    this.formEl.setAttribute("tabindex", "0");
    this.formEl.setAttribute("aria-haspopup", "menu");
    this.formEl.setAttribute("aria-label", t("status.form.tooltip"));
    this.formEl.addEventListener("click", (event) => this.openFormMenu(event));
    this.formEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      this.openFormMenu();
    });
    this.refresh();
  }

  /** `textChanged` false reuses the note's count (only the cursor or the selection moved). */
  refresh(textChanged = true): void {
    const view = this.host.currentView();
    if (textChanged) this.noteCount = null;
    this.renderCount(view);
    this.renderForm(view?.file ?? null);
  }

  private renderCount(view: MarkdownView | null): void {
    const file = view?.file;
    const show = this.host.showCount() && Boolean(view && file);
    this.countEl.toggleClass("hanmark-is-hidden", !show);
    if (!show || !view || !file) return;
    const selection = view.editor.getSelection();
    if (selection) {
      const count = countText(visibleMarkdownText(selection, { frontmatter: false }));
      this.countEl.setText(
        t("status.count.selection", { chars: formatNumber(count.withSpaces), without: formatNumber(count.withoutSpaces) })
      );
      return;
    }
    if (this.noteCount?.path !== file.path) {
      this.noteCount = { path: file.path, count: countText(visibleMarkdownText(view.editor.getValue())) };
    }
    const count = this.noteCount.count;
    this.countEl.setText(
      t("status.count.note", {
        chars: formatNumber(count.withSpaces),
        without: formatNumber(count.withoutSpaces),
        sheets: formatNumber(count.manuscriptSheets)
      })
    );
  }

  private renderForm(file: TFile | null): void {
    const id = file && this.host.showForm() ? this.host.formFor(file) : null;
    const form = id ? (this.host.describeForm?.(id) ?? this.host.forms().find((item) => item.id === id)) : undefined;
    this.formFile = form && file ? file : null;
    this.formEl.toggleClass("hanmark-is-hidden", !form);
    if (form) this.formEl.setText(t("status.form.label", { name: form.name }));
  }

  private openFormMenu(event?: MouseEvent): void {
    const file = this.formFile;
    if (!file) return;
    const current = this.host.formFor(file);
    const menu = new Menu();
    let group: string | null = null;
    for (const form of this.host.forms(current ?? undefined)) {
      if (form.group !== group) {
        group = form.group;
        menu.addItem((item) => item.setTitle(form.group).setIsLabel(true));
      }
      menu.addItem((item) =>
        item
          .setTitle(form.name)
          .setChecked(form.id === current)
          .onClick(() => {
            void this.host.selectForm(form.id, file).then(() => this.refresh(false));
          })
      );
    }
    const chooseLook = this.host.chooseLook;
    if (chooseLook) {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle(t("status.form.chooseLook")).onClick(() => chooseLook(file)));
    }
    if (event) {
      menu.showAtMouseEvent(event);
      return;
    }
    const box = this.formEl.getBoundingClientRect();
    menu.showAtPosition({ x: box.left, y: box.top }, this.formEl.doc);
  }
}
