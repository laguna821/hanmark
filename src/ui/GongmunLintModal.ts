import { Modal, Notice, type App, type Editor, type TFile } from "obsidian";
import type { GongmunPreset } from "kordoc";
import { gongmunAutoCleanups, type AutoCleanupKind } from "../io/gongmunStyle";
import { bodyLineOffset, extractEditableBody } from "../io/frontmatter";
import {
  CHECK_FAMILIES,
  DEFAULT_CHECK_FAMILIES,
  addIgnoreEntry,
  fixEdit,
  ignoreEntry,
  isMechanicalFix,
  mechanicalFixEdits,
  readIgnoreList,
  runGongmunCheck,
  summarizeCheck,
  type CheckFamily,
  type CheckFamilySwitches,
  type CheckFinding,
  type CheckResult
} from "../io/gongmunCheck";
import { t, tKey, type MessageKey } from "../i18n";

const CLEANUP_LABELS: Readonly<Record<AutoCleanupKind, MessageKey>> = {
  "law-code": "gongmun.lint.cleanup.law-code",
  "system-code": "gongmun.lint.cleanup.system-code",
  "region-code": "gongmun.lint.cleanup.region-code",
  "tool-note": "gongmun.lint.cleanup.tool-note"
};

export const CHECK_FAMILY_LABELS: Readonly<Record<CheckFamily, MessageKey>> = {
  notation: "gongmun.lint.notation",
  munche: "gongmun.lint.munche",
  budget: "gongmun.lint.family.budget",
  logic: "gongmun.lint.family.logic",
  slop: "gongmun.lint.family.slop"
};

const MAX_SHOWN = 300;

export interface GongmunLintModalOptions {
  /** Families switched on in the settings. */
  families?: CheckFamilySwitches;
  /** The note being checked; needed to store ignored findings in its properties. */
  file?: TFile | null;
  /** Pre-flight before an export: adds "그래도 내보내기" and reports the choice. */
  preflight?: { onProceed: () => void; onCancel?: () => void };
}

/** One line for reports: "점검 12건(고칠 것 5): 표기법 9, 예산 3". */
export function checkSummaryLine(findings: readonly CheckFinding[]): string {
  const summary = summarizeCheck(findings);
  if (!summary.total) return t("gongmun.lint.summary.none");
  const parts = CHECK_FAMILIES.filter((family) => summary.byFamily[family]).map(
    (family) => `${tKey(CHECK_FAMILY_LABELS[family])} ${summary.byFamily[family]}`
  );
  return t("gongmun.lint.summary", { total: summary.total, errors: summary.errors, parts: parts.join(", ") });
}

/**
 * Official-document check window (2.7.0 W5, reworked in 3.0.0 R-035): findings of
 * every enabled family with their exact place in the note. Advisory; nothing is
 * changed unless the user presses a fix button.
 */
export class GongmunLintModal extends Modal {
  private result: CheckResult | null = null;
  private familyFilter: CheckFamily | "all" = "all";
  private errorsOnly = false;
  private proceeded = false;
  private readonly sessionIgnored = new Set<string>();

  constructor(
    app: App,
    private readonly editor: Editor,
    private readonly preset: GongmunPreset,
    private readonly options: GongmunLintModalOptions = {}
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("hanmark-gongmun-lint");
    this.titleEl.setText(t(this.options.preflight ? "gongmun.lint.preflight.title" : "gongmun.lint.title"));
    this.refresh();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.proceeded) this.options.preflight?.onCancel?.();
  }

  private ignoredEntries(): string[] {
    const file = this.options.file;
    const stored = file ? readIgnoreList(this.app.metadataCache.getFileCache(file)?.frontmatter) : [];
    return [...new Set([...stored, ...this.sessionIgnored])];
  }

  private refresh(): void {
    this.result = runGongmunCheck(this.editor.getValue(), {
      families: this.options.families ?? DEFAULT_CHECK_FAMILIES,
      preset: this.preset,
      ignored: this.ignoredEntries()
    });
    this.render();
  }

  private shown(): CheckFinding[] {
    return (this.result?.findings ?? []).filter(
      (finding) =>
        (this.familyFilter === "all" || finding.family === this.familyFilter) &&
        (!this.errorsOnly || finding.severity === "error")
    );
  }

  private render(): void {
    const { contentEl } = this;
    const result = this.result;
    contentEl.empty();
    if (!result) return;
    contentEl.createEl("p", { cls: "setting-item-description", text: t("gongmun.lint.subtitle") });
    if (result.tooLarge) {
      contentEl.createEl("p", { text: t("gongmun.lint.tooLarge") });
      this.renderFooter([]);
      return;
    }
    const summary = contentEl.createEl("p", { cls: "hanmark-gongmun-lint-summary", text: checkSummaryLine(result.findings) });
    summary.dataset.hanmarkLintSummary = "true";
    if (result.ignored) {
      contentEl.createEl("p", { cls: "setting-item-description", text: t("gongmun.lint.ignoredCount", { count: result.ignored }) });
    }
    if (result.partial) contentEl.createEl("p", { cls: "setting-item-description", text: t("gongmun.lint.partial") });

    this.renderFilters(result.findings);
    this.renderCleanups();

    const shown = this.shown();
    if (!result.findings.length) contentEl.createEl("p", { text: t("gongmun.lint.none") });
    for (const family of CHECK_FAMILIES) {
      const items = shown.filter((finding) => finding.family === family);
      if (!items.length) continue;
      contentEl.createEl("h4", { text: `${tKey(CHECK_FAMILY_LABELS[family])} (${items.length})` });
      const list = contentEl.createEl("ul", { cls: "hanmark-gongmun-lint-list" });
      list.dataset.hanmarkLintFamily = family;
      for (const finding of items.slice(0, MAX_SHOWN)) this.renderFinding(list, finding);
      if (items.length > MAX_SHOWN) list.createEl("li", { text: t("gongmun.lint.more", { count: items.length - MAX_SHOWN }) });
    }
    this.renderFooter(result.findings);
  }

  private renderFilters(findings: readonly CheckFinding[]): void {
    const bar = this.contentEl.createDiv({ cls: "hanmark-gongmun-lint-filters" });
    const summary = summarizeCheck(findings);
    const chip = (label: string, active: boolean, key: string, onClick: () => void): void => {
      const button = bar.createEl("button", { text: label, cls: active ? "mod-cta" : "" });
      button.dataset.hanmarkLintFilter = key;
      button.setAttribute("aria-pressed", String(active));
      button.onclick = onClick;
    };
    chip(`${t("gongmun.lint.filter.all")} ${summary.total}`, this.familyFilter === "all", "all", () => {
      this.familyFilter = "all";
      this.render();
    });
    for (const family of CHECK_FAMILIES) {
      if (!summary.byFamily[family]) continue;
      chip(`${tKey(CHECK_FAMILY_LABELS[family])} ${summary.byFamily[family]}`, this.familyFilter === family, family, () => {
        this.familyFilter = family;
        this.render();
      });
    }
    const label = bar.createEl("label", { cls: "hanmark-gongmun-lint-errors-only" });
    const box = label.createEl("input", { attr: { type: "checkbox" } });
    box.checked = this.errorsOnly;
    box.dataset.hanmarkLintFilter = "errors";
    box.onchange = () => {
      this.errorsOnly = box.checked;
      this.render();
    };
    label.appendText(` ${t("gongmun.lint.filter.errorsOnly", { count: summary.errors })}`);
  }

  private renderCleanups(): void {
    const raw = this.editor.getValue();
    const cleanups = gongmunAutoCleanups(extractEditableBody(raw));
    if (!cleanups.length) return;
    const offset = bodyLineOffset(raw);
    this.contentEl.createEl("h4", { text: t("gongmun.lint.cleanups") });
    const list = this.contentEl.createEl("ul", { cls: "hanmark-gongmun-lint-list" });
    for (const cleanup of cleanups) {
      const item = list.createEl("li");
      const button = item.createEl("button", {
        cls: "hanmark-gongmun-lint-line",
        text: t("gongmun.lint.line", { line: cleanup.line }),
        attr: { "aria-label": t("gongmun.lint.goTo") }
      });
      const line = offset + cleanup.line - 1;
      button.onclick = () => this.select(line, 0, 0);
      item.createSpan({ text: ` ${tKey(CLEANUP_LABELS[cleanup.kind])}: ` });
      item.createEl("code", { text: cleanup.match });
    }
  }

  private renderFinding(list: HTMLElement, finding: CheckFinding): void {
    const item = list.createEl("li", { cls: `is-${finding.severity}` });
    item.dataset.hanmarkLintRule = finding.rule;
    const jump = item.createEl("button", {
      cls: "hanmark-gongmun-lint-line",
      text: t("gongmun.lint.line", { line: finding.line + 1 }),
      attr: { "aria-label": t("gongmun.lint.goTo") }
    });
    jump.onclick = () => this.select(finding.line, finding.ch, finding.length);
    item.createSpan({
      cls: "hanmark-gongmun-lint-severity",
      text: ` ${finding.severity === "error" ? t("gongmun.lint.error") : t("gongmun.lint.warning")} · `
    });
    item.createSpan({ text: finding.message });
    if (finding.match) {
      item.createEl("code", { text: finding.match.length > 60 ? `${finding.match.slice(0, 60)}…` : finding.match });
    }
    const actions = item.createDiv({ cls: "hanmark-gongmun-lint-suggest" });
    if (finding.replacement !== undefined) {
      actions.createSpan({ text: t("gongmun.lint.suggest", { text: finding.replacement }) });
      const apply = actions.createEl("button", { text: t("gongmun.lint.fix") });
      apply.dataset.hanmarkLintAction = "fix";
      apply.onclick = () => this.applyFix(finding);
    } else if (finding.advice) {
      actions.createSpan({ text: finding.advice });
    }
    const ignore = actions.createEl("button", { text: t("gongmun.lint.ignore") });
    ignore.dataset.hanmarkLintAction = "ignore";
    ignore.onclick = () => void this.ignore(ignoreEntry(finding));
    const ignoreRule = actions.createEl("button", { text: t("gongmun.lint.ignoreRule") });
    ignoreRule.dataset.hanmarkLintAction = "ignore-rule";
    ignoreRule.title = finding.rule;
    ignoreRule.onclick = () => void this.ignore(finding.rule);
  }

  private renderFooter(findings: readonly CheckFinding[]): void {
    const footer = this.contentEl.createDiv({ cls: "hanmark-export-secondary-actions" });
    const mechanical = findings.filter((finding) => isMechanicalFix(finding)).length;
    if (mechanical) {
      const all = footer.createEl("button", { text: t("gongmun.lint.fixAll", { count: mechanical }) });
      all.dataset.hanmarkLintAction = "fix-all";
      all.title = t("gongmun.lint.fixAllDesc");
      all.onclick = () => this.applyAllMechanical();
    }
    const again = footer.createEl("button", { text: t("gongmun.lint.recheck") });
    again.dataset.hanmarkLintAction = "recheck";
    again.onclick = () => this.refresh();
    if (this.options.preflight) {
      const proceed = footer.createEl("button", { text: t("gongmun.lint.preflight.proceed"), cls: "mod-cta" });
      proceed.dataset.hanmarkLintAction = "proceed";
      proceed.onclick = () => {
        const onProceed = this.options.preflight?.onProceed;
        this.proceeded = true;
        this.close();
        onProceed?.();
      };
    }
  }

  /** Moves to the finding and selects exactly the checked text. */
  private select(line: number, ch: number, length: number): void {
    if (line >= this.editor.lineCount()) return;
    const from = { line, ch };
    const to = { line, ch: ch + length };
    this.editor.setSelection(from, to);
    this.editor.scrollIntoView({ from, to }, true);
    this.editor.focus();
  }

  private applyFix(finding: CheckFinding): void {
    const text = finding.line < this.editor.lineCount() ? this.editor.getLine(finding.line) : undefined;
    const edit = fixEdit(text, finding);
    if (!edit) {
      new Notice(t("gongmun.lint.stale"));
      this.refresh();
      return;
    }
    this.editor.replaceRange(edit.text, { line: edit.line, ch: edit.ch }, { line: edit.line, ch: edit.ch + edit.length });
    new Notice(t("gongmun.lint.applied", { line: finding.line + 1 }));
    this.refresh();
  }

  /** Spacing-and-mark fixes only, as one undo step. */
  private applyAllMechanical(): void {
    const lines = this.editor.getValue().split("\n");
    const edits = mechanicalFixEdits(lines, this.result?.findings ?? []);
    if (!edits.length) {
      new Notice(t("gongmun.lint.stale"));
      this.refresh();
      return;
    }
    this.editor.transaction({
      changes: edits.map((edit) => ({
        from: { line: edit.line, ch: edit.ch },
        to: { line: edit.line, ch: edit.ch + edit.length },
        text: edit.text
      }))
    });
    new Notice(t("gongmun.lint.fixedAll", { count: edits.length }));
    this.refresh();
  }

  private async ignore(entry: string): Promise<void> {
    this.sessionIgnored.add(entry);
    const file = this.options.file;
    if (file) {
      try {
        await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
          addIgnoreEntry(frontmatter, entry);
        });
      } catch {
        new Notice(t("gongmun.lint.ignoreFailed"));
      }
    }
    // The property write may add lines above the body; wait for the editor to follow.
    window.setTimeout(() => this.refresh(), 120);
  }
}
