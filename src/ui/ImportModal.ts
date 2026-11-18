import {
  AbstractInputSuggest,
  Modal,
  Notice,
  Setting,
  TFile,
  TFolder,
  type App
} from "obsidian";
import {
  IMPORT_TABLE_STYLES,
  normalizeImportTableStyle,
  initialImportOptions,
  rememberedImportOptions,
  type RememberedImportOptions,
  type ImportTableStyle,
  IMPORT_PRESET_IDS,
  IMPORT_PRESET_LABELS,
  normalizeImportPreset,
  normalizePageRange,
  type ImportOptions
} from "../io/importOptions";
import {
  IMPORT_EXTENSIONS,
  LARGE_IMPORT_BYTES,
  importOne,
  runImportJob,
  type ImportInput,
  type ImportJob,
  type ImportProgress,
  type ImportResult
} from "../io/importRunner";
import {
  chooseImportImageDestination,
  moveImportedImagesToCloud,
  type ImportCloudSettings
} from "../io/kordocImport";
import { readSelectedExternalFiles, type FileGateway } from "../io/fileGateway";
import { normalizeImportedImageFolder } from "../legacy-port/settings";
import { ImportReportModal } from "./ImportReportModal";
import { confirmAction, promptSecret } from "./dialogs";
import { errorMessage } from "../utils/errors";
import { t, tKey, type MessageKey } from "../i18n";
import { setPhase } from "./motion";

/** Ask before converting at least this many files in one go. */
const BULK_CONFIRM_THRESHOLD = 25;
const PAGE_RANGE_EXAMPLE = "1-3, 7";

const TABLE_STYLE_NAME: Readonly<Record<ImportTableStyle, MessageKey>> = {
  pipe: "import.modal.tables.option.pipe",
  mixed: "import.modal.tables.option.mixed",
  html: "import.modal.tables.option.html"
};
const TABLE_STYLE_DESC: Readonly<Record<ImportTableStyle, MessageKey>> = {
  pipe: "import.modal.tables.desc.pipe",
  mixed: "import.modal.tables.desc.mixed",
  html: "import.modal.tables.desc.html"
};

export interface ImportHost {
  app: App;
  gateway: FileGateway;
  /** Preset selected first (from settings). */
  defaultPreset(): unknown;
  /** Advanced options used last time (R-032); absent on hosts that keep nothing. */
  rememberedOptions?(): unknown;
  /** Stores the advanced options of an import that was started. */
  rememberOptions?(options: RememberedImportOptions): Promise<void> | void;
  /**
   * Destination policy from settings: the folder for the note made from `input`
   * (next to a Vault original, the open note's folder, or a fixed folder).
   */
  folderFor(input?: ImportInput): string;
  /** "Confirm every time": menu conversions open the import window first. */
  confirmEachImport(): boolean;
  cloudSettings(): ImportCloudSettings;
  /** Show a created note in the operating-system file manager (desktop only). */
  reveal?(notePath: string): Promise<void>;
  /** Marks the import as a running HanMark job (the toolbar's flowing edge, R-028). */
  trackJob?(): (succeeded?: boolean) => void;
}

class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(app: App, private readonly input: HTMLInputElement) {
    super(app, input);
  }

  protected getSuggestions(query: string): TFolder[] {
    const needle = query.trim().toLowerCase();
    return this.app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder && !file.isRoot())
      .filter((folder) => folder.path.toLowerCase().includes(needle))
      .slice(0, 50);
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder): void {
    this.input.value = folder.path;
    this.input.dispatchEvent(new Event("input"));
    this.close();
  }
}

async function filesFromEntry(entry: FileSystemEntry, output: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    output.push(file);
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    for (const child of batch) await filesFromEntry(child, output);
  }
}

/** Files and folders dropped on the zone, filtered to importable documents. */
async function droppedInputs(transfer: DataTransfer): Promise<{ inputs: ImportInput[]; skipped: number }> {
  const files: File[] = [];
  const entries = Array.from(transfer.items)
    .map((item) => (item.kind === "file" ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null);
  if (entries.length) {
    for (const entry of entries) await filesFromEntry(entry, files);
  } else {
    files.push(...Array.from(transfer.files));
  }
  const selected = await readSelectedExternalFiles(files, { extensions: [...IMPORT_EXTENSIONS] });
  return {
    inputs: selected.map((file) => ({ name: file.name, bytes: file.bytes })),
    skipped: files.length - selected.length
  };
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

/**
 * The import window (2.7.0 W3): drop zone, file and folder pickers, conversion
 * style, advanced options, destination, progress, and stop between files.
 */
export class ImportModal extends Modal {
  private inputs: ImportInput[];
  private options: ImportOptions;
  private folder: string;
  private running = false;
  private cancelled = false;
  private progressEl: HTMLElement | null = null;

  constructor(private readonly host: ImportHost, initialInputs: ImportInput[] = []) {
    super(host.app);
    this.inputs = [...initialInputs];
    this.options = initialImportOptions(host);
    this.folder = host.folderFor(this.inputs[0]);
  }

  onOpen(): void {
    this.modalEl.addClass("hanmark-import-modal");
    this.titleEl.setText(t("import.modal.title"));
    this.render();
  }

  onClose(): void {
    this.cancelled = true;
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.renderDropZone(contentEl);
    this.renderSelection(contentEl);

    new Setting(contentEl)
      .setName(t("import.modal.preset"))
      .setDesc(tKey(IMPORT_PRESET_LABELS[this.options.preset].desc))
      .addDropdown((dropdown) => {
        for (const id of IMPORT_PRESET_IDS) dropdown.addOption(id, tKey(IMPORT_PRESET_LABELS[id].name));
        dropdown.setValue(this.options.preset).onChange((value) => {
          this.options.preset = normalizeImportPreset(value);
          this.render();
        });
        dropdown.setDisabled(this.running);
      });

    this.renderAdvanced(contentEl);

    new Setting(contentEl)
      .setName(t("import.modal.destination.name"))
      .setDesc(t("import.modal.destination.desc"))
      .addText((text) => {
        text.setValue(this.folder).setPlaceholder("/").onChange((value) => {
          this.folder = value;
        });
        text.setDisabled(this.running);
        new FolderSuggest(this.app, text.inputEl);
      });

    this.progressEl = contentEl.createDiv({ cls: "hanmark-import-progress" });
    setPhase(this.progressEl, this.running ? "waiting" : null);
    const actions = contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    if (this.running) {
      const stop = actions.createEl("button", { text: t("import.modal.stop") });
      stop.classList.add("mod-warning");
      stop.onclick = () => {
        this.cancelled = true;
        stop.disabled = true;
        stop.setText(t("import.modal.stopping"));
      };
      return;
    }
    actions.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    const start = actions.createEl("button", { text: t("import.modal.start") });
    start.classList.add("mod-cta");
    start.disabled = this.inputs.length === 0;
    start.onclick = () => void this.start();
  }

  private renderDropZone(container: HTMLElement): void {
    const zone = container.createDiv({ cls: "hanmark-import-drop", attr: { tabindex: "0" } });
    zone.createEl("p", { text: t("import.modal.drop") });
    const buttons = zone.createDiv({ cls: "hanmark-import-drop-buttons" });
    const pickFiles = buttons.createEl("button", { text: t("import.modal.pickFiles") });
    pickFiles.classList.add("mod-cta");
    pickFiles.disabled = this.running;
    pickFiles.onclick = () => void this.pick(false);
    const pickFolder = buttons.createEl("button", { text: t("import.modal.pickFolder") });
    pickFolder.disabled = this.running;
    pickFolder.onclick = () => void this.pick(true);

    zone.addEventListener("dragover", (event) => {
      if (this.running) return;
      event.preventDefault();
      zone.addClass("is-dragover");
    });
    zone.addEventListener("dragleave", () => zone.removeClass("is-dragover"));
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.removeClass("is-dragover");
      if (this.running || !event.dataTransfer) return;
      void droppedInputs(event.dataTransfer)
        .then(({ inputs, skipped }) => this.addInputs(inputs, skipped))
        .catch((error: unknown) => new Notice(errorMessage(error)));
    });
  }

  private renderSelection(container: HTMLElement): void {
    const box = container.createDiv({ cls: "hanmark-import-selection" });
    if (!this.inputs.length) {
      box.createEl("p", { cls: "setting-item-description", text: t("import.modal.noneSelected") });
      return;
    }
    const header = box.createDiv({ cls: "hanmark-import-selection-header" });
    header.createEl("strong", { text: t("import.modal.selected", { count: this.inputs.length }) });
    const clear = header.createEl("button", { text: t("import.modal.clear") });
    clear.disabled = this.running;
    clear.onclick = () => {
      this.inputs = [];
      this.render();
    };
    const list = box.createEl("ul");
    for (const input of this.inputs.slice(0, 8)) {
      const size = input.bytes.byteLength >= LARGE_IMPORT_BYTES ? ` (${megabytes(input.bytes.byteLength)})` : "";
      list.createEl("li", { text: `${input.name}${size}` });
    }
    if (this.inputs.length > 8) {
      list.createEl("li", { text: t("import.report.more", { count: this.inputs.length - 8 }) });
    }
  }

  private renderAdvanced(container: HTMLElement): void {
    const details = container.createEl("details", { cls: "hanmark-import-advanced" });
    details.createEl("summary", { text: t("import.modal.advanced") });
    const pageSetting = new Setting(details)
      .setName(t("import.modal.pages.name"))
      .setDesc(t("import.modal.pages.desc", { example: PAGE_RANGE_EXAMPLE }))
      .addText((text) => {
        text.setPlaceholder(PAGE_RANGE_EXAMPLE).setValue(this.options.pages).onChange((value) => {
          this.options.pages = value;
          const valid = normalizePageRange(value) !== null;
          text.inputEl.toggleClass("is-invalid", !valid);
          pageSetting.setDesc(
            valid
              ? t("import.modal.pages.desc", { example: PAGE_RANGE_EXAMPLE })
              : t("import.modal.pages.invalid", { example: PAGE_RANGE_EXAMPLE })
          );
        });
        text.setDisabled(this.running);
      });
    const preset = this.options.preset;
    const group = (title: string): HTMLElement => {
      const section = details.createDiv({ cls: "hanmark-import-option-group" });
      section.createEl("h4", { text: title, cls: "hanmark-import-option-title" });
      return section;
    };
    const toggle = (
      parent: HTMLElement,
      key: "images" | "scriptTags" | "flattenLayout" | "memos" | "imagesInFlow" | "removeHeaderFooter" | "dedupeRunningHeaders",
      name: string,
      desc: string,
      locked?: string
    ): void => {
      new Setting(parent).setName(name).setDesc(locked ?? desc).addToggle((control) => {
        control.setValue(locked ? false : this.options[key]).onChange((value) => {
          this.options[key] = value;
        });
        control.setDisabled(this.running || locked !== undefined);
        control.toggleEl.dataset.hanmarkImportOption = key;
      });
    };

    // How the note is written: the three choices of R-032.
    const notation = group(t("import.modal.group.notation"));
    new Setting(notation)
      .setName(t("import.modal.tables.name"))
      .setDesc(
        preset === "exam"
          ? t("import.modal.tables.lockedExam")
          : preset === "form" && this.options.tables === "pipe"
            ? t("import.modal.tables.lockedForm")
            : tKey(TABLE_STYLE_DESC[this.options.tables])
      )
      .addDropdown((dropdown) => {
        for (const style of IMPORT_TABLE_STYLES) dropdown.addOption(style, tKey(TABLE_STYLE_NAME[style]));
        dropdown.setValue(this.options.tables).onChange((value) => {
          this.options.tables = normalizeImportTableStyle(value);
          this.render();
        });
        dropdown.setDisabled(this.running || preset === "exam");
        dropdown.selectEl.dataset.hanmarkImportOption = "tables";
      });
    toggle(
      notation,
      "scriptTags",
      t("import.modal.scriptTags.name"),
      t("import.modal.scriptTags.desc"),
      preset === "text" ? t("import.modal.scriptTags.lockedText") : undefined
    );
    toggle(
      notation,
      "flattenLayout",
      t("import.modal.flattenLayout.name"),
      t("import.modal.flattenLayout.desc"),
      preset === "form" ? t("import.modal.flattenLayout.lockedForm") : undefined
    );

    const pictures = group(t("import.modal.group.images"));
    toggle(
      pictures,
      "images",
      t("import.modal.images.name"),
      t("import.modal.images.desc"),
      preset === "text" ? t("import.modal.images.lockedText") : undefined
    );
    toggle(pictures, "imagesInFlow", t("import.modal.imagesInFlow.name"), t("import.modal.imagesInFlow.desc"));

    const byFormat = group(t("import.modal.group.format"));
    toggle(byFormat, "memos", t("import.modal.memos.name"), t("import.modal.memos.desc"));
    toggle(byFormat, "removeHeaderFooter", t("import.modal.headerFooter.name"), t("import.modal.headerFooter.desc"));
    toggle(byFormat, "dedupeRunningHeaders", t("import.modal.dedupe.name"), t("import.modal.dedupe.desc"));
  }

  private addInputs(inputs: readonly ImportInput[], skipped: number): void {
    const known = new Set(this.inputs.map((input) => `${input.name}:${input.bytes.byteLength}`));
    for (const input of inputs) {
      const key = `${input.name}:${input.bytes.byteLength}`;
      if (known.has(key)) continue;
      known.add(key);
      this.inputs.push(input);
    }
    if (skipped > 0) new Notice(t("import.modal.skipped", { count: skipped }));
    this.render();
  }

  private async pick(directory: boolean): Promise<void> {
    try {
      const selected = await this.host.gateway.pickFiles({
        title: directory ? t("import.modal.pickFolder") : t("import.modal.pickFiles"),
        extensions: [...IMPORT_EXTENSIONS],
        multiple: true,
        directory
      });
      this.addInputs(selected.map((file) => ({ name: file.name, bytes: file.bytes })), 0);
    } catch (error: unknown) {
      new Notice(errorMessage(error));
    }
  }

  private async confirmBeforeStart(): Promise<boolean> {
    const large = this.inputs.filter((input) => input.bytes.byteLength > LARGE_IMPORT_BYTES);
    if (large.length) {
      const files = large.map((input) => `${input.name} (${megabytes(input.bytes.byteLength)})`).join(", ");
      const proceed = await confirmAction(this.app, {
        title: t("import.modal.largeFiles.title"),
        message: t("import.modal.largeFiles.message", { files }),
        confirmText: t("import.modal.continue")
      });
      if (!proceed) return false;
    }
    if (this.inputs.length >= BULK_CONFIRM_THRESHOLD) {
      return confirmAction(this.app, {
        title: t("import.modal.bulk.title"),
        message: t("import.modal.bulk.message", { count: this.inputs.length }),
        confirmText: t("import.modal.bulk.confirm", { count: this.inputs.length })
      });
    }
    return true;
  }

  private showProgress(progress: ImportProgress): void {
    if (!this.progressEl) return;
    this.progressEl.empty();
    const bar = this.progressEl.createEl("progress", {
      attr: { max: String(progress.total), value: String(progress.done) }
    });
    bar.addClass("hanmark-import-progress-bar");
    let text = t("import.modal.progress", { done: progress.done, total: progress.total });
    if (progress.current) {
      text += ` · ${progress.current.name}`;
      if (progress.current.page && progress.current.pages) {
        text += ` · ${progress.current.page}/${progress.current.pages}`;
      }
    }
    this.progressEl.createEl("p", { text });
  }

  private async start(): Promise<void> {
    if (this.running || !this.inputs.length) return;
    if (normalizePageRange(this.options.pages) === null) {
      new Notice(t("import.modal.pages.invalid", { example: PAGE_RANGE_EXAMPLE }));
      return;
    }
    const requestedFolder = this.folder.trim() === "/" ? "" : this.folder.trim();
    const folder = normalizeImportedImageFolder(requestedFolder);
    if (requestedFolder && !folder) {
      new Notice(t("import.modal.destination.invalid"));
      return;
    }
    if (!(await this.confirmBeforeStart())) return;
    const cloudSettings = this.host.cloudSettings();
    const imageDestination =
      cloudSettings.destination === "ask"
        ? await chooseImportImageDestination(this.app)
        : cloudSettings.destination;
    if (!imageDestination) return;

    const job: ImportJob = {
      inputs: [...this.inputs],
      options: { ...this.options },
      folderFor: () => folder,
      imageDestination,
      cloudSettings,
      moveImagesToCloud: (note, candidates) => moveImportedImagesToCloud(this.app, note, candidates, cloudSettings)
    };
    this.running = true;
    this.cancelled = false;
    this.render();
    const endJob = this.host.trackJob?.();
    let results: ImportResult[];
    try {
      await this.host.rememberOptions?.(rememberedImportOptions(this.options));
      results = await runImportJob(this.app, job, {
        onProgress: (progress) => this.showProgress(progress),
        isCancelled: () => this.cancelled
      });
    } catch (error: unknown) {
      endJob?.(false);
      this.running = false;
      this.render();
      new Notice(errorMessage(error));
      return;
    }
    endJob?.(true);
    this.running = false;
    this.close();
    await presentImportResults(this.host, job, results);
  }
}

/** Retry one failed file with the same options (and an optional password). */
function retryImport(host: ImportHost, job: Omit<ImportJob, "inputs">) {
  const reserved = new Set<string>();
  return async (result: ImportResult, password?: string): Promise<ImportResult> => {
    if (!result.input) return result;
    return importOne(host.app, result.input, job, reserved, password);
  };
}

async function openNote(app: App, path: string | undefined): Promise<void> {
  const file = path ? app.vault.getAbstractFileByPath(path) : null;
  if (file instanceof TFile && app.workspace.getActiveFile()?.path !== file.path) {
    await app.workspace.getLeaf(true).openFile(file);
  }
}

/**
 * After an import: a clean single result opens its note with a short notice;
 * anything else (warnings, failures, several files) opens the report.
 */
export async function presentImportResults(
  host: ImportHost,
  job: Omit<ImportJob, "inputs">,
  results: ImportResult[]
): Promise<void> {
  const retry = retryImport(host, job);
  if (results.length === 1) {
    let only = results[0];
    if (!only.ok && only.passwordHelps && only.input) {
      only = await askPasswordAndRetry(host.app, only, retry);
      results[0] = only;
    }
    if (only.ok) {
      await openNote(host.app, only.notePath);
      let message = t("import.notice.done", { path: only.notePath ?? only.source });
      if (only.images) message += t("import.notice.doneImages", { count: only.images });
      new Notice(message);
      if (!only.warnings.length) return;
    }
  } else {
    const ok = results.filter((result) => result.ok).length;
    const warned = results.filter((result) => result.ok && result.warnings.length).length;
    const failed = results.filter((result) => !result.ok && !result.cancelled).length;
    new Notice(t("import.notice.bulk", { ok, warned, failed }));
    if (!warned && !failed && !results.some((result) => result.cancelled)) return;
  }
  const reveal = host.reveal ? (path: string) => host.reveal?.(path) ?? Promise.resolve() : undefined;
  new ImportReportModal(host.app, { results, retry, reveal }).open();
}

async function askPasswordAndRetry(
  app: App,
  result: ImportResult,
  retry: (result: ImportResult, password?: string) => Promise<ImportResult>
): Promise<ImportResult> {
  let current = result;
  let error: string | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const password = await promptSecret(app, {
      title: t("import.password.title"),
      label: t("import.password.label", { file: current.source }),
      description: `${current.errorTitle ?? ""} ${t("import.password.desc")}`.trim(),
      error,
      confirmText: t("import.password.submit")
    });
    if (password === null) return current;
    current = await retry(current, password);
    if (current.ok || !current.passwordHelps) return current;
    error = t("import.password.wrong");
  }
  return current;
}

/**
 * Convert documents that already live in the Vault (file-explorer menu, viewer).
 * The notes go next to the originals unless a fixed folder is configured.
 */
export async function importVaultFiles(host: ImportHost, files: readonly TFile[], options?: Partial<ImportOptions>): Promise<void> {
  const inputs: ImportInput[] = [];
  for (const file of files) {
    inputs.push({ name: file.name, bytes: new Uint8Array(await host.app.vault.readBinary(file)), vaultPath: file.path });
  }
  if (!inputs.length) return;
  if (host.confirmEachImport()) {
    new ImportModal(host, inputs).open();
    return;
  }
  const cloudSettings = host.cloudSettings();
  const imageDestination =
    cloudSettings.destination === "ask"
      ? await chooseImportImageDestination(host.app)
      : cloudSettings.destination;
  if (!imageDestination) return;
  const job: ImportJob = {
    inputs,
    options: { ...initialImportOptions(host), ...options },
    folderFor: (input) => normalizeImportedImageFolder(host.folderFor(input)),
    imageDestination,
    cloudSettings,
    moveImagesToCloud: (note, candidates) => moveImportedImagesToCloud(host.app, note, candidates, cloudSettings)
  };
  const progress = new Notice(t("import.modal.progress", { done: 0, total: inputs.length }), 0);
  const endJob = host.trackJob?.();
  try {
    const results = await runImportJob(host.app, job, {
      onProgress: (state) => progress.setMessage(t("import.modal.progress", { done: state.done, total: state.total }))
    });
    progress.hide();
    endJob?.(true);
    await presentImportResults(host, job, results);
  } catch (error: unknown) {
    progress.hide();
    endJob?.(false);
    new Notice(errorMessage(error));
  }
}
