import { Modal, Notice, TFile, type App } from "obsidian";
import { HwpConvertError, convertHwpToHwpx } from "../io/hwpConvert";
import { promptSecret } from "./dialogs";
import { errorMessage } from "../utils/errors";
import { t } from "../i18n";

/**
 * "HWPX로 변환" (3.0.0, R-034): an HWPX copy of an HWP document, written next to
 * it under a free name. The original is only read. Several files run one after
 * another and can be stopped between files.
 */
export interface HwpConvertHost {
  app: App;
  /** Open a Hangul document in HanMark's viewer. */
  openDocument(file: TFile): Promise<void>;
}

export interface HwpConvertItem {
  source: string;
  /** Vault path of the HWPX that was written. */
  path?: string;
  mode?: "preserve" | "content";
  notes: string[];
  error?: string;
  /** The engine's own words, for the details of a failure. */
  original?: string;
}

const MAX_PASSWORD_ATTEMPTS = 3;

/** A path next to the source that does not exist yet: "name.hwpx", "name (1).hwpx", … */
export function freeHwpxPath(app: App, source: TFile, reserved: Set<string> = new Set()): string {
  const folder = source.path.split("/").slice(0, -1).join("/");
  const base = source.name.replace(/\.[^.]+$/u, "");
  const at = (suffix: string): string => (folder ? `${folder}/` : "") + `${base}${suffix}.hwpx`;
  let path = at("");
  for (let index = 1; app.vault.getAbstractFileByPath(path) || reserved.has(path); index += 1) path = at(` (${index})`);
  reserved.add(path);
  return path;
}

/** Converts one file; asks for the open password when that can help. Returns the written file. */
export async function convertOneHwp(
  host: Pick<HwpConvertHost, "app">,
  file: TFile,
  reserved: Set<string> = new Set()
): Promise<{ item: HwpConvertItem; saved?: TFile; cancelled?: boolean }> {
  const { app } = host;
  const bytes = new Uint8Array(await app.vault.readBinary(file));
  let password: string | undefined;
  let wrong: string | undefined;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const converted = await convertHwpToHwpx(bytes, password);
      // Validated in memory above; only now is anything written, and never over a file.
      const saved = await app.vault.createBinary(freeHwpxPath(app, file, reserved), converted.data);
      return { item: { source: file.path, path: saved.path, mode: converted.mode, notes: converted.notes }, saved };
    } catch (error: unknown) {
      const known = error instanceof HwpConvertError ? error : null;
      if (known?.passwordHelps && attempt < MAX_PASSWORD_ATTEMPTS) {
        // Held in memory for this attempt only; never stored or logged.
        const entered = await promptSecret(app, {
          title: t("import.password.title"),
          label: t("import.password.label", { file: file.name }),
          description: t("import.password.desc"),
          error: wrong,
          confirmText: t("import.password.submit")
        });
        if (entered === null) {
          return { item: { source: file.path, notes: [], error: known.message, original: known.original }, cancelled: true };
        }
        password = entered;
        wrong = t("import.password.wrong");
        continue;
      }
      return {
        item: { source: file.path, notes: [], error: known?.message ?? errorMessage(error), original: known?.original }
      };
    }
  }
}

export class HwpConvertReportModal extends Modal {
  constructor(
    app: App,
    private readonly items: readonly HwpConvertItem[],
    private readonly stopped: number,
    private readonly open_: (path: string) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(t("convert.report.title"));
    const { contentEl } = this;
    contentEl.addClass("hanmark-convert-report");
    const done = this.items.filter((item) => item.path).length;
    const failed = this.items.length - done;
    contentEl.createEl("p", { text: t("convert.report.summary", { done, failed }) });
    if (this.stopped) contentEl.createEl("p", { text: t("convert.report.stopped", { count: this.stopped }) });
    const list = contentEl.createEl("ul");
    for (const item of this.items) {
      const row = list.createEl("li", { attr: { "data-hanmark-convert": item.path ? "saved" : "failed" } });
      row.createEl("strong", { text: item.source });
      if (item.path) {
        const path = item.path;
        row.createDiv({ text: t("convert.report.saved", { path }) });
        // HWP 3.x says in its own note that only text and tables came over.
        if (item.mode === "preserve") row.createDiv({ text: t("convert.report.modePreserve") });
        for (const note of item.notes) row.createDiv({ text: note });
        row.createEl("button", { text: t("convert.report.view"), attr: { type: "button" } }).onclick = () => {
          this.close();
          this.open_(path);
        };
      } else {
        row.createDiv({ text: item.error ?? "" });
        if (item.original && item.original !== item.error) {
          const details = row.createEl("details");
          details.createEl("summary", { text: t("import.report.originalMessage") });
          details.createEl("code", { text: item.original });
        }
      }
    }
    const actions = contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    actions.createEl("button", { text: t("common.close"), attr: { type: "button" } }).onclick = () => this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Converts HWP files one after another, then shows what was written and what was not. */
export async function convertHwpFiles(host: HwpConvertHost, files: readonly TFile[]): Promise<HwpConvertItem[]> {
  const targets = files.filter((file) => file.extension.toLowerCase() === "hwp");
  if (!targets.length) {
    new Notice(t("convert.noHwp"));
    return [];
  }
  const items: HwpConvertItem[] = [];
  const reserved = new Set<string>();
  let stop = false;
  const progress = new Notice("", 0);
  const stopButton = targets.length > 1
    ? progress.messageEl.createEl("button", { text: t("convert.progress.stop"), attr: { type: "button" } })
    : null;
  const label = progress.messageEl.createSpan();
  if (stopButton) {
    progress.messageEl.insertBefore(label, stopButton);
    stopButton.onclick = () => {
      stop = true;
      stopButton.disabled = true;
    };
  }
  let lastSaved: TFile | undefined;
  try {
    for (const [index, file] of targets.entries()) {
      // Stopping takes effect between files; a file that started is finished.
      if (stop) break;
      label.setText(t("convert.progress.file", { current: index + 1, total: targets.length, file: file.name }));
      const result = await convertOneHwp(host, file, reserved);
      items.push(result.item);
      if (result.saved) lastSaved = result.saved;
    }
  } finally {
    progress.hide();
  }
  const opener = (path: string): void => {
    const file = host.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) void host.openDocument(file);
  };
  if (targets.length === 1 && lastSaved && !items[0]?.notes.length) {
    // One clean conversion: show the result itself.
    new Notice(t("convert.done", { path: lastSaved.path }));
    await host.openDocument(lastSaved);
  } else {
    new HwpConvertReportModal(host.app, items, targets.length - items.length, opener).open();
  }
  return items;
}
