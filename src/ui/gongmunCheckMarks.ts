import { StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, hoverTooltip, type DecorationSet, type Tooltip, type ViewUpdate } from "@codemirror/view";
import {
  ignoreEntry,
  runGongmunCheckAsync,
  type CheckFinding,
  type CheckOptions
} from "../io/gongmunCheck";
import { t } from "../i18n";

/**
 * Official-document findings as underlines in the Markdown editor (3.0.0, R-035).
 * Off until the user switches it on for a note view. A change of the note starts a
 * delayed check that yields between slices and is dropped when the note changes
 * again, so typing never waits for it. Reading view shows no marks.
 */
export interface CheckMarksHost {
  /** Families, form type and ignore list for the note shown in this editor. */
  options(view: EditorView): CheckOptions;
  /** Stores an ignore entry in the note's properties. */
  ignore(view: EditorView, entry: string): void;
  /** Called after each finished check (status bar count). */
  checked?(view: EditorView, findings: readonly CheckFinding[] | null): void;
}

/** One finding and the text it is about. */
interface MarkItem {
  from: number;
  to: number;
  finding: CheckFinding;
}

/**
 * One underline. Findings of different rules on overlapping text (for example
 * "200달러": won first, and the missing exchange rate) share one underline whose
 * tooltip gives every piece of advice; the status bar counts underlines.
 */
interface Mark {
  from: number;
  to: number;
  items: MarkItem[];
}

export const setCheckMarksEnabled = StateEffect.define<boolean>();
const setMarks = StateEffect.define<Mark[]>();

const enabledField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setCheckMarksEnabled)) return effect.value;
    return value;
  }
});

const marksField = StateField.define<{ marks: Mark[]; decorations: DecorationSet }>({
  create: () => ({ marks: [], decorations: Decoration.none }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setMarks)) return { marks: effect.value, decorations: decorate(effect.value) };
      if (effect.is(setCheckMarksEnabled) && !effect.value) return { marks: [], decorations: Decoration.none };
    }
    if (!transaction.docChanged || !value.marks.length) return value;
    // Keep marks in place while the user types; the next check replaces them.
    const marks: Mark[] = [];
    for (const mark of value.marks) {
      const items: MarkItem[] = [];
      for (const item of mark.items) {
        const from = transaction.changes.mapPos(item.from, 1);
        const to = transaction.changes.mapPos(item.to, -1);
        if (to > from) items.push({ from, to, finding: item.finding });
      }
      const from = transaction.changes.mapPos(mark.from, 1);
      const to = transaction.changes.mapPos(mark.to, -1);
      if (to > from && items.length) marks.push({ from, to, items });
    }
    return { marks, decorations: value.decorations.map(transaction.changes) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
});

function decorate(marks: readonly Mark[]): DecorationSet {
  return Decoration.set(
    marks.map((mark) => {
      const severity = mark.items.some((item) => item.finding.severity === "error") ? "error" : "warning";
      return Decoration.mark({
        class: `hanmark-check-mark is-${severity}`,
        attributes: {
          "data-hanmark-check-rule": mark.items.map((item) => item.finding.rule).join(" "),
          ...(mark.items.length > 1 ? { "data-hanmark-check-count": String(mark.items.length) } : {})
        }
      }).range(mark.from, mark.to);
    }),
    true
  );
}

/**
 * Underlines from items: items of one family (notation, budget, …) whose text overlaps
 * share one underline over their union. Families stay apart, so a sentence-wide wording
 * finding does not swallow the number and notation findings inside that sentence.
 */
function groupItems(items: readonly MarkItem[]): Mark[] {
  const marks: Mark[] = [];
  const families = new Map<string, MarkItem[]>();
  for (const item of items) families.set(item.finding.family, [...(families.get(item.finding.family) ?? []), item]);
  for (const group of families.values()) {
    const sorted = [...group].sort((left, right) => left.from - right.from || right.to - left.to);
    let last: Mark | undefined;
    for (const item of sorted) {
      if (last && item.from < last.to) {
        last.items.push(item);
        last.to = Math.max(last.to, item.to);
      } else {
        last = { from: item.from, to: item.to, items: [item] };
        marks.push(last);
      }
    }
  }
  return marks.sort((left, right) => left.from - right.from || right.to - left.to);
}

/** Document positions of findings, grouped into underlines; a finding outside the document is dropped. */
export function marksOf(doc: Text, findings: readonly CheckFinding[]): Mark[] {
  const items: MarkItem[] = [];
  for (const finding of findings) {
    if (finding.line + 1 > doc.lines || finding.length <= 0) continue;
    const line = doc.line(finding.line + 1);
    const from = line.from + finding.ch;
    const to = from + finding.length;
    if (to > line.to) continue;
    items.push({ from, to, finding });
  }
  return groupItems(items);
}

export function checkMarksEnabled(view: EditorView): boolean {
  return view.state.field(enabledField, false) ?? false;
}

export function checkMarkCount(view: EditorView): number {
  return view.state.field(marksField, false)?.marks.length ?? 0;
}

export const CHECK_MARKS_DELAY_MS = 700;

export function gongmunCheckMarks(host: CheckMarksHost, delayMs = CHECK_MARKS_DELAY_MS): Extension {
  const runner = ViewPlugin.fromClass(
    class {
      private timer: number | null = null;
      private run = 0;

      constructor(private readonly view: EditorView) {}

      update(update: ViewUpdate): void {
        const now = update.state.field(enabledField);
        const before = update.startState.field(enabledField);
        if (!now) {
          if (before) this.cancel();
          return;
        }
        if (!before || update.docChanged) this.schedule(before ? delayMs : 0);
      }

      destroy(): void {
        this.cancel();
      }

      private cancel(): void {
        this.run += 1;
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
      }

      private schedule(delay: number): void {
        this.cancel();
        const run = this.run;
        this.timer = window.setTimeout(() => {
          this.timer = null;
          void this.check(run);
        }, delay);
      }

      private async check(run: number): Promise<void> {
        const view = this.view;
        const text = view.state.doc.toString();
        const result = await runGongmunCheckAsync(text, {
          ...host.options(view),
          cancelled: () => run !== this.run,
          pause: () => new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        });
        if (!result || run !== this.run || !view.state.field(enabledField, false)) return;
        view.dispatch({ effects: setMarks.of(marksOf(view.state.doc, result.findings)) });
        host.checked?.(view, result.tooLarge ? null : result.findings);
      }
    }
  );

  const tooltip = hoverTooltip((view, pos): Tooltip | null => {
    // Every underline under the pointer, narrowest first: a span inside a sentence-wide
    // wording finding shows its own advice first, then the sentence's.
    const covering = (view.state.field(marksField, false)?.marks ?? [])
      .filter((item) => pos >= item.from && pos <= item.to)
      .sort((left, right) => left.to - left.from - (right.to - right.from));
    if (!covering.length) return null;
    return {
      pos: covering[0].from,
      end: covering[0].to,
      above: true,
      create: () => ({ dom: tooltipDom(view, covering, host) })
    };
  });

  return [enabledField, marksField, runner, tooltip];
}

function tooltipDom(view: EditorView, marks: readonly Mark[], host: CheckMarksHost): HTMLElement {
  const dom = createDiv({ cls: "hanmark-check-tooltip" });
  for (const mark of marks) {
    for (const item of mark.items) adviceDom(dom.createDiv({ cls: "hanmark-check-tooltip-item" }), view, item.finding, host);
  }
  return dom;
}

/** One piece of advice in a tooltip: message, suggestion, and its own fix and ignore. */
function adviceDom(dom: HTMLElement, view: EditorView, finding: CheckFinding, host: CheckMarksHost): void {
  dom.createDiv({ cls: "hanmark-check-tooltip-message", text: finding.message });
  if (finding.replacement !== undefined || finding.advice) {
    dom.createDiv({
      cls: "hanmark-check-tooltip-hint",
      text: finding.replacement !== undefined ? t("gongmun.lint.suggest", { text: finding.replacement }) : (finding.advice ?? "")
    });
  }
  const actions = dom.createDiv({ cls: "hanmark-check-tooltip-actions" });
  const button = (label: string, action: string, onClick: () => void): void => {
    const element = actions.createEl("button", { text: label });
    element.dataset.hanmarkCheckAction = action;
    element.onclick = (event) => {
      event.preventDefault();
      onClick();
    };
  };
  const items = (): MarkItem[] => (view.state.field(marksField, false)?.marks ?? []).flatMap((item) => item.items);
  if (finding.replacement !== undefined) {
    const replacement = finding.replacement;
    button(t("gongmun.lint.fix"), "fix", () => {
      const current = items().find((item) => item.finding === finding);
      // Refused when the marked text is no longer what was checked.
      if (!current || view.state.sliceDoc(current.from, current.to) !== finding.match) return;
      view.dispatch({ changes: { from: current.from, to: current.to, insert: replacement }, userEvent: "input.hanmark-check" });
    });
  }
  button(t("gongmun.lint.ignore"), "ignore", () => {
    host.ignore(view, ignoreEntry(finding));
    const kept = items().filter((item) => ignoreEntry(item.finding) !== ignoreEntry(finding));
    view.dispatch({ effects: setMarks.of(groupItems(kept)) });
  });
}
