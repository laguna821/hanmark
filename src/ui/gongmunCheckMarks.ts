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

interface Mark {
  from: number;
  to: number;
  finding: CheckFinding;
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
      const from = transaction.changes.mapPos(mark.from, 1);
      const to = transaction.changes.mapPos(mark.to, -1);
      if (to > from) marks.push({ from, to, finding: mark.finding });
    }
    return { marks, decorations: value.decorations.map(transaction.changes) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
});

function decorate(marks: readonly Mark[]): DecorationSet {
  return Decoration.set(
    marks.map((mark) =>
      Decoration.mark({
        class: `hanmark-check-mark is-${mark.finding.severity}`,
        attributes: { "data-hanmark-check-rule": mark.finding.rule }
      }).range(mark.from, mark.to)
    ),
    true
  );
}

/** Document positions of findings; a finding outside the document is dropped. */
export function marksOf(doc: Text, findings: readonly CheckFinding[]): Mark[] {
  const marks: Mark[] = [];
  for (const finding of findings) {
    if (finding.line + 1 > doc.lines || finding.length <= 0) continue;
    const line = doc.line(finding.line + 1);
    const from = line.from + finding.ch;
    const to = from + finding.length;
    if (to > line.to) continue;
    marks.push({ from, to, finding });
  }
  return marks;
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
    const marks = view.state.field(marksField, false)?.marks ?? [];
    const mark = marks.find((item) => pos >= item.from && pos <= item.to);
    if (!mark) return null;
    return {
      pos: mark.from,
      end: mark.to,
      above: true,
      create: () => ({ dom: tooltipDom(view, mark, host) })
    };
  });

  return [enabledField, marksField, runner, tooltip];
}

function tooltipDom(view: EditorView, mark: Mark, host: CheckMarksHost): HTMLElement {
  const { finding } = mark;
  const dom = createDiv({ cls: "hanmark-check-tooltip" });
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
  if (finding.replacement !== undefined) {
    const replacement = finding.replacement;
    button(t("gongmun.lint.fix"), "fix", () => {
      const current = view.state.field(marksField, false)?.marks.find((item) => item.finding === finding);
      // Refused when the marked text is no longer what was checked.
      if (!current || view.state.sliceDoc(current.from, current.to) !== finding.match) return;
      view.dispatch({ changes: { from: current.from, to: current.to, insert: replacement }, userEvent: "input.hanmark-check" });
    });
  }
  button(t("gongmun.lint.ignore"), "ignore", () => {
    host.ignore(view, ignoreEntry(finding));
    const kept = (view.state.field(marksField, false)?.marks ?? []).filter(
      (item) => ignoreEntry(item.finding) !== ignoreEntry(finding)
    );
    view.dispatch({ effects: setMarks.of(kept) });
  });
  return dom;
}
