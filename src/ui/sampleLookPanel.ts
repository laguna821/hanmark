import { Modal, type App, type TFile } from "obsidian";
import type { MissingFont } from "../io/fontResolver";
import { fontGuideLines } from "../io/fontGuide";
import type { SampleLookRecord, SampleLookUse } from "../io/sampleLook";
import type { MeasuredItem } from "../io/sampleMeasure";
import { t, tKey, type MessageKey } from "../i18n";

/**
 * "견본으로 내 모양 만들기" inside the form window (R-036): where a sample is picked,
 * what was taken from it and what was not, how the look is made, fixed text left in
 * the sample, missing fonts, and sharing the look as a file.
 */
export type SampleSource = "file" | "vault" | "pdf" | "pack";

export interface SampleLookPanelInput {
  sample?: SampleLookRecord;
  /** File name of the sample or pack the look came from, for this session. */
  sampleName?: string;
  missingFonts: readonly MissingFont[];
  /** Fixed text the user chose to remove on save. */
  removeChoices: ReadonlySet<string>;
  busy: boolean;
  /** A message about the last attempt (error or note), already translated. */
  message?: { text: string; error: boolean };
  /** Lines the PDF measuring applied (engine wording), shown after learning from a PDF. */
  pdfApplied?: readonly string[];
  onPick(source: SampleSource): void;
  onUse(use: SampleLookUse): void;
  onLeftover(text: string, remove: boolean): void;
  onExport(): void;
  onDetach(): void;
}

const ROLE_LABELS: Readonly<Record<string, MessageKey>> = {
  title: "gongmun.sample.role.title",
  contact: "gongmun.sample.role.contact",
  summary: "gongmun.sample.role.summary",
  chapter: "gongmun.sample.role.chapter",
  band: "gongmun.sample.role.band",
  L0: "gongmun.sample.role.L0",
  L1: "gongmun.sample.role.L1",
  L2: "gongmun.sample.role.L2",
  L3: "gongmun.sample.role.L3",
  body: "gongmun.sample.role.body",
  ref: "gongmun.sample.role.ref",
  table: "gongmun.sample.role.table"
};

const PART_LABELS: Readonly<Record<MeasuredItem["part"], MessageKey>> = {
  margins: "gongmun.sample.part.margins",
  body: "gongmun.sample.part.body",
  lineSpacing: "gongmun.sample.part.lineSpacing",
  level0: "gongmun.sample.role.L0",
  level1: "gongmun.sample.role.L1",
  level2: "gongmun.sample.role.L2",
  level3: "gongmun.sample.role.L3",
  ref: "gongmun.sample.role.ref",
  tableFont: "gongmun.sample.part.tableFont",
  tableHeaderFill: "gongmun.sample.part.tableHeaderFill"
};

/** A role key of the engine in plain words. */
export function sampleRoleLabel(role: string): string {
  const key = ROLE_LABELS[role];
  if (key) return tKey(key);
  return role.startsWith("sym:") ? t("gongmun.sample.role.sym", { mark: role.slice(4) }) : role;
}

function button(parent: HTMLElement, id: string, text: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const element = parent.createEl("button", { text, attr: { type: "button", id } });
  element.disabled = disabled;
  element.onclick = onClick;
  return element;
}

export function renderSampleLookPanel(container: HTMLElement, input: SampleLookPanelInput): void {
  container.empty();
  container.addClass("hanmark-sample-look");
  container.createEl("h3", { text: t("gongmun.sample.title") });
  container.createEl("p", { cls: "setting-item-description", text: t("gongmun.sample.desc") });

  const picks = container.createDiv({ cls: "hanmark-sample-look-actions" });
  button(picks, "hanmark-sample-pick-file", t("gongmun.sample.pickFile"), () => input.onPick("file"), input.busy).addClass("mod-cta");
  button(picks, "hanmark-sample-pick-vault", t("gongmun.sample.pickVault"), () => input.onPick("vault"), input.busy);
  button(picks, "hanmark-sample-pick-pdf", t("gongmun.sample.pickPdf"), () => input.onPick("pdf"), input.busy);
  button(picks, "hanmark-sample-import-pack", t("gongmun.sample.importPack"), () => input.onPick("pack"), input.busy);

  if (input.busy) container.createEl("p", { cls: "hanmark-sample-look-busy", text: t("gongmun.sample.busy") });
  if (input.message) {
    container.createEl("p", {
      cls: input.message.error ? "hanmark-sample-look-error" : "hanmark-sample-look-note",
      text: input.message.text,
      attr: { id: "hanmark-sample-message" }
    });
  }
  if (input.pdfApplied?.length) {
    const list = container.createEl("ul", { cls: "hanmark-sample-look-list", attr: { id: "hanmark-sample-pdf-applied" } });
    for (const line of input.pdfApplied) list.createEl("li", { text: line });
  }

  const sample = input.sample;
  if (!sample) return;
  const summary = container.createDiv({ cls: "hanmark-sample-look-summary", attr: { id: "hanmark-sample-summary" } });
  if (input.sampleName) summary.createEl("p", { cls: "hanmark-sample-look-from", text: t("gongmun.sample.from", { name: input.sampleName }) });

  // How the look is made, and why that way was chosen.
  const use = summary.createDiv({ cls: "hanmark-sample-look-use" });
  use.createEl("strong", { text: t("gongmun.sample.use.name") });
  const select = use.createEl("select", { cls: "dropdown", attr: { id: "hanmark-sample-use" } });
  select.createEl("option", { value: "template", text: t("gongmun.sample.use.template") });
  select.createEl("option", { value: "measured", text: t("gongmun.sample.use.measured") });
  select.value = sample.use;
  select.onchange = () => input.onUse(select.value === "template" ? "template" : "measured");
  summary.createEl("p", {
    cls: "setting-item-description",
    text: sample.use === "template" ? t("gongmun.sample.use.templateDesc") : t("gongmun.sample.use.measuredDesc")
  });
  if (sample.templateFits !== undefined) {
    summary.createEl("p", {
      cls: "setting-item-description",
      text: sample.templateFits ? t("gongmun.sample.use.autoTemplate") : t("gongmun.sample.use.autoMeasured")
    });
  }

  // What was taken.
  const facts = sample.facts;
  const taken = summary.createDiv();
  taken.createEl("strong", { text: t("gongmun.sample.summary.taken") });
  const takenList = taken.createEl("ul", { cls: "hanmark-sample-look-list", attr: { id: "hanmark-sample-taken" } });
  takenList.createEl("li", {
    text: t("gongmun.sample.summary.page", {
      width: facts.pageMm.width,
      height: facts.pageMm.height,
      top: facts.marginsMm.top,
      bottom: facts.marginsMm.bottom,
      left: facts.marginsMm.left,
      right: facts.marginsMm.right
    })
  });
  const measured = sample.measured ?? [];
  for (const item of measured.filter((entry) => entry.source === "sample" && entry.part !== "margins")) {
    takenList.createEl("li", { text: `${tKey(PART_LABELS[item.part])}: ${item.value}` });
  }
  if (sample.roles.length) {
    takenList.createEl("li", { text: t("gongmun.sample.roles.found", { roles: sample.roles.map(sampleRoleLabel).join(", ") }) });
  }

  // What was not.
  const lacking = measured.filter((entry) => entry.source !== "sample");
  if (lacking.length || sample.missing.length) {
    const not = summary.createDiv();
    not.createEl("strong", { text: t("gongmun.sample.summary.notTaken") });
    const notList = not.createEl("ul", { cls: "hanmark-sample-look-list", attr: { id: "hanmark-sample-not-taken" } });
    for (const item of lacking) {
      const why = item.source === "body" ? t("gongmun.sample.source.body", { font: item.value }) : t("gongmun.sample.source.none");
      notList.createEl("li", { text: `${tKey(PART_LABELS[item.part])}: ${why}` });
    }
    if (sample.missing.length) {
      notList.createEl("li", { text: t("gongmun.sample.roles.missing", { roles: sample.missing.map(sampleRoleLabel).join(", ") }) });
    }
  }

  if (input.missingFonts.length) {
    const fonts = summary.createDiv({ cls: "hanmark-sample-look-fonts" });
    fonts.createEl("strong", { text: t("gongmun.sample.fonts.missing") });
    const list = fonts.createEl("ul", { cls: "hanmark-sample-look-list", attr: { id: "hanmark-sample-fonts" } });
    for (const line of fontGuideLines(input.missingFonts)) list.createEl("li", { text: line });
  }

  if (sample.leftover.length) {
    const left = summary.createDiv({ cls: "hanmark-sample-look-leftover" });
    left.createEl("strong", { text: t("gongmun.sample.leftover.name", { count: sample.leftover.length }) });
    left.createEl("p", { cls: "setting-item-description", text: t("gongmun.sample.leftover.desc") });
    const all = left.createEl("label", { cls: "hanmark-sample-look-check" });
    const allBox = all.createEl("input", { attr: { type: "checkbox", id: "hanmark-sample-leftover-all" } });
    allBox.checked = sample.leftover.every((text) => input.removeChoices.has(text));
    allBox.onchange = () => {
      for (const text of sample.leftover) input.onLeftover(text, allBox.checked);
    };
    all.createSpan({ text: t("gongmun.sample.leftover.removeAll") });
    const list = left.createEl("ul", { cls: "hanmark-sample-look-list", attr: { id: "hanmark-sample-leftover" } });
    for (const text of sample.leftover) {
      const row = list.createEl("li").createEl("label", { cls: "hanmark-sample-look-check" });
      const box = row.createEl("input", { attr: { type: "checkbox" } });
      box.checked = input.removeChoices.has(text);
      box.onchange = () => input.onLeftover(text, box.checked);
      row.createSpan({ text });
    }
  }

  const share = summary.createDiv({ cls: "hanmark-sample-look-actions" });
  button(share, "hanmark-sample-export-pack", t("gongmun.sample.exportPack"), () => input.onExport(), input.busy);
  button(share, "hanmark-sample-detach", t("gongmun.sample.detach"), () => input.onDetach(), input.busy);
}

/** A small chooser of vault files by extension, filtered by name. */
export class VaultFilePickModal extends Modal {
  private picked = false;

  constructor(
    app: App,
    private readonly extensions: readonly string[],
    private readonly done: (file: TFile | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("hanmark-sample-vault-modal");
    this.titleEl.setText(t("gongmun.sample.vault.title"));
    const files = this.app.vault
      .getFiles()
      .filter((file) => this.extensions.includes(file.extension.toLowerCase()))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
    if (!files.length) {
      this.contentEl.createEl("p", { text: t("gongmun.sample.vault.empty") });
      return;
    }
    const filter = this.contentEl.createEl("input", {
      attr: { type: "search", id: "hanmark-sample-vault-filter", placeholder: t("gongmun.sample.vault.filter") }
    });
    const list = this.contentEl.createDiv({ cls: "hanmark-sample-vault-list" });
    const draw = (): void => {
      list.empty();
      const needle = filter.value.normalize("NFC").trim().toLowerCase();
      for (const file of files.filter((item) => !needle || item.path.normalize("NFC").toLowerCase().includes(needle)).slice(0, 200)) {
        const row = list.createEl("button", { cls: "hanmark-sample-vault-item", text: file.path, attr: { type: "button" } });
        row.onclick = () => {
          this.picked = true;
          this.close();
          this.done(file);
        };
      }
    };
    filter.oninput = draw;
    draw();
    filter.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.picked) this.done(null);
  }
}
