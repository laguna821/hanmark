import { Modal, type App } from "obsidian";
import type { GongmunFormOption } from "../io/gongmunExport";
import type { BatchEntry, BatchHooks } from "../io/gongmunBatch";
import type { HanmarkExportOutcome } from "../io/exportTypes";
import type { GongmunFrame } from "../io/gongmunFormId";
import { AGENCY_FRAMES, gongmunFrameLabel } from "../io/gongmunForms";
import { t } from "../i18n";
import { setPhase } from "./motion";

/**
 * Exports one note to several official-document forms at once (R-028): check the
 * forms, then each is made and saved next to the note, named after its form. One
 * summary lists every file; a stop request takes effect between forms.
 */
export interface GongmunBatchHost {
  forms: GongmunFormOption[];
  /** The short list again with the frames in another look (R-030). */
  listForms?: (look: string) => GongmunFormOption[];
  /**
   * Opens the look chooser; `pick` gets the chosen look id and its name. With a
   * `frame` the chooser lists that frame's looks (one row's look); without, every
   * frame's (the look for all rows).
   */
  chooseLook?: (current: string, pick: (look: string, name: string) => void, frame?: GongmunFrame) => void;
  /** The form the note starts with; checked first. */
  currentFormId?: string;
  noteName: string;
  run: (
    forms: GongmunFormOption[],
    hooks: BatchHooks<GongmunFormOption, HanmarkExportOutcome>
  ) => Promise<Array<BatchEntry<GongmunFormOption, HanmarkExportOutcome>>>;
  /** Opens a saved HWPX in HanMark's viewer. */
  open: (vaultPath: string) => void;
  /** Shows a saved file in the operating-system file manager (desktop only). */
  reveal?: (vaultPath: string) => Promise<void>;
}

type Stage = "choose" | "running" | "done";

export class GongmunBatchModal extends Modal {
  /** Checked rows by position: a row keeps its place when its look changes. */
  private readonly checked = new Set<number>();
  private stage: Stage = "choose";
  private stopRequested = false;
  private readonly rows = new Map<string, HTMLElement>();
  private progressEl: HTMLElement | null = null;
  private entries: Array<BatchEntry<GongmunFormOption, HanmarkExportOutcome>> = [];
  private forms: GongmunFormOption[];
  /** Look every frame is made in ("basic" until the user picks one). */
  private look = "basic";
  private lookName = "";
  /** Looks picked for single frames; they win over the look for every frame. */
  private readonly rowLooks = new Map<GongmunFrame, { look: string; name: string }>();

  constructor(app: App, private readonly host: GongmunBatchHost) {
    super(app);
    this.forms = host.forms;
    const first = host.forms.findIndex((form) => form.id === host.currentFormId);
    if (host.forms.length) this.checked.add(Math.max(0, first));
  }

  onOpen(): void {
    this.modalEl.addClass("hanmark-gongmun-batch");
    this.titleEl.setText(t("gongmun.batch.title"));
    this.render();
  }

  close(): void {
    if (this.stage === "running") return;
    super.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { cls: "hanmark-gongmun-batch-note", text: t("gongmun.batch.note", { name: this.host.noteName }) });
    if (this.stage === "done") {
      this.renderResults(contentEl);
      return;
    }
    contentEl.createEl("p", { cls: "setting-item-description", text: t("gongmun.batch.desc") });
    const chooseLook = this.host.chooseLook;
    const listForms = this.host.listForms;
    if (chooseLook && listForms) {
      const lookRow = contentEl.createDiv({ cls: "hanmark-gongmun-batch-look" });
      const button = lookRow.createEl("button", {
        text: t("gongmun.batch.look", { name: this.lookName || t("gongmun.look.basic") }),
        attr: { type: "button", id: "hanmark-batch-look" }
      });
      button.disabled = this.stage === "running";
      button.onclick = () =>
        chooseLook(this.look, (look, name) => {
          this.look = look;
          this.lookName = name;
          // One look for every frame replaces the looks picked row by row.
          this.rowLooks.clear();
          this.rebuildForms();
          this.render();
        });
      lookRow.createEl("small", { text: t("gongmun.batch.lookHelp") });
    }
    const list = contentEl.createDiv({ cls: "hanmark-gongmun-batch-list" });
    this.rows.clear();
    let group: string | null = null;
    this.forms.forEach((form, index) => {
      if (form.group !== group) {
        group = form.group;
        list.createDiv({ cls: "hanmark-gongmun-batch-group", text: form.group });
      }
      const line = list.createDiv({ cls: "hanmark-gongmun-batch-line" });
      const row = line.createEl("label", { cls: "hanmark-gongmun-batch-row" });
      const box = row.createEl("input", { type: "checkbox" });
      box.checked = this.checked.has(index);
      box.disabled = this.stage === "running";
      box.onchange = () => {
        if (box.checked) this.checked.add(index);
        else this.checked.delete(index);
        this.render();
      };
      row.createSpan({ cls: "hanmark-gongmun-batch-name", text: form.name });
      // A frame row carries its own look (R-030): 보고서 in 국세청, 보도자료 in 교육부, at once.
      if (chooseLook && listForms && form.kind === "standard" && AGENCY_FRAMES.includes(form.frame)) {
        const own = this.rowLooks.get(form.frame);
        const current = own?.look ?? form.look;
        const pickLook = line.createEl("button", {
          cls: "hanmark-gongmun-batch-rowlook",
          text: t("gongmun.batch.rowLook", { name: own?.name || (form.look === this.look && this.lookName ? this.lookName : t("gongmun.look.basic")) }),
          attr: { type: "button", "data-frame": form.frame, title: t("gongmun.batch.rowLookTitle", { frame: gongmunFrameLabel(form.frame) }) }
        });
        pickLook.disabled = this.stage === "running";
        pickLook.onclick = () =>
          chooseLook(
            current,
            (look, name) => {
              this.rowLooks.set(form.frame, { look, name });
              this.rebuildForms();
              this.render();
            },
            form.frame
          );
      }
      this.rows.set(form.id, row);
    });
    this.progressEl = contentEl.createDiv({ cls: "hanmark-gongmun-batch-progress", attr: { role: "status", "aria-live": "polite" } });

    const actions = contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    if (this.stage === "running") {
      const stop = actions.createEl("button", { text: this.stopRequested ? t("gongmun.batch.stopping") : t("gongmun.batch.stop") });
      stop.addClass("mod-warning");
      stop.disabled = this.stopRequested;
      stop.onclick = () => {
        this.stopRequested = true;
        stop.disabled = true;
        stop.setText(t("gongmun.batch.stopping"));
      };
      return;
    }
    const all = actions.createEl("button", { text: t("gongmun.batch.all") });
    all.onclick = () => {
      this.forms.forEach((_form, index) => this.checked.add(index));
      this.render();
    };
    const none = actions.createEl("button", { text: t("gongmun.batch.none") });
    none.onclick = () => {
      this.checked.clear();
      this.render();
    };
    actions.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    const start = actions.createEl("button", { text: t("gongmun.batch.start", { count: this.checked.size }) });
    start.addClass("mod-cta");
    start.disabled = this.checked.size === 0;
    start.onclick = () => void this.start();
  }

  /**
   * The list in the look for every frame, with each frame that has a look of its own
   * taken from the list in that look. The order never changes, so checks stay in place.
   */
  private rebuildForms(): void {
    const listForms = this.host.listForms;
    if (!listForms) return;
    const base = listForms(this.look);
    const lists = new Map<string, GongmunFormOption[]>();
    this.forms = base.map((form, index) => {
      const own = form.kind === "standard" ? this.rowLooks.get(form.frame) : undefined;
      if (!own) return form;
      let list = lists.get(own.look);
      if (!list) lists.set(own.look, (list = listForms(own.look)));
      // The list has the same rows in every look, so the same position is the same frame and variant.
      const same = list[index];
      return same && same.kind === "standard" && same.frame === form.frame ? same : form;
    });
  }

  private async start(): Promise<void> {
    const forms = this.forms.filter((_form, index) => this.checked.has(index));
    if (!forms.length) return;
    this.stage = "running";
    this.stopRequested = false;
    this.render();
    try {
      this.entries = await this.host.run(forms, {
        isCancelled: () => this.stopRequested,
        onProgress: (index, total, form) => {
          for (const [id, row] of this.rows) setPhase(row, id === form.id ? "waiting" : null);
          this.progressEl?.setText(t("gongmun.batch.progress", { done: index + 1, total, form: form.name }));
        },
        onEntry: (entry) => {
          const row = this.rows.get(entry.form.id);
          if (!row) return;
          setPhase(row, entry.status === "saved" ? "done" : null);
          row.toggleClass("is-failed", entry.status === "failed");
        }
      });
    } finally {
      this.stage = "done";
      this.render();
    }
  }

  private renderResults(root: HTMLElement): void {
    const count = (status: string): number => this.entries.filter((entry) => entry.status === status).length;
    root.createEl("p", {
      cls: "hanmark-gongmun-batch-summary hanmark-arrive",
      text: t("gongmun.batch.summary", { saved: count("saved"), failed: count("failed"), cancelled: count("cancelled") })
    });
    const list = root.createDiv({ cls: "hanmark-gongmun-batch-results" });
    for (const entry of this.entries) {
      const item = list.createDiv({ cls: `hanmark-gongmun-batch-result is-${entry.status}` });
      item.createEl("strong", { text: entry.form.name, cls: entry.status === "saved" ? "hanmark-done-mark" : undefined });
      const path = entry.result?.vaultPath;
      if (entry.status === "saved" && path) {
        const link = item.createEl("a", { text: entry.result?.fileName ?? path, attr: { href: "#" } });
        link.onclick = (event) => {
          event.preventDefault();
          this.host.open(path);
        };
        const warnings = entry.result?.warnings ?? [];
        if (warnings.length) {
          const details = item.createEl("details");
          details.createEl("summary", { text: t("gongmun.batch.warnings", { count: warnings.length }) });
          const lines = details.createEl("ul");
          for (const warning of warnings) lines.createEl("li", { text: warning });
        }
      } else if (entry.status === "failed") {
        item.createSpan({ text: t("gongmun.batch.failed", { detail: entry.error ?? "" }) });
      } else if (entry.status === "cancelled") {
        item.createSpan({ text: t("gongmun.batch.skipped") });
      }
    }
    const actions = root.createDiv({ cls: "hanmark-dialog-actions" });
    const first = this.entries.find((entry) => entry.status === "saved" && entry.result?.vaultPath)?.result?.vaultPath;
    const reveal = this.host.reveal;
    if (first && reveal) {
      actions.createEl("button", { text: t("gongmun.batch.reveal") }).onclick = () => void reveal(first);
    }
    const close = actions.createEl("button", { text: t("common.close") });
    close.addClass("mod-cta");
    close.onclick = () => this.close();
    close.focus();
  }
}
