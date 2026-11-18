import { Modal, Notice, SuggestModal, TFile, type App, type MarkdownView } from "obsidian";
import {
  BUILTIN_FORM_PREFIX,
  FORM_FORMAT_KEY,
  FORM_HASH_KEY,
  FORM_LINK_KEY,
  collectFormValues,
  fillFormHwpx,
  formHash,
  formLinkTarget,
  formNoteBody,
  formNoteProperties,
  readFormFields,
  type FormFieldSpec,
  type FormOverflow
} from "../io/formFill";
import { isHwpxBytes } from "../io/hwpConvert";
import { BUILTIN_FORMS, builtinFormBytes, isBuiltinFormId, type BuiltinForm } from "../io/builtinForms";
import { uniqueNotePath } from "../io/importRunner";
import { safeBaseName } from "../io/compareNote";
import { bytesAsArrayBuffer, type FileGateway } from "../io/fileGateway";
import { normalizeImportedImageFolder } from "../legacy-port/settings";
import { errorMessage } from "../utils/errors";
import { resolveOutputLocale, t, tKey, tOut, type LanguagePreference } from "../i18n";

/**
 * Form filling (2.7.0 W8): make a form note from an HWPX form (or a built-in
 * standard draft letter), fill in its properties, and save a filled copy.
 */
export interface FormHost {
  app: App;
  gateway: FileGateway;
  /** Folder for notes made from built-in forms (import destination policy). */
  defaultFolder(): string;
  outputLanguage(): LanguagePreference;
  /** Open a Hangul document in HanMark's viewer. */
  openDocument(file: TFile): Promise<void>;
}

function parentFolder(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function stem(name: string): string {
  return name.replace(/\.[^.]+$/u, "");
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
}

async function createFormNote(
  host: FormHost,
  fields: readonly FormFieldSpec[],
  title: string,
  link: string,
  hash: string,
  folder: string,
  format?: "hwpx" | "hwp"
): Promise<TFile> {
  const sample = fields.map((field) => `${field.name}${field.hint ?? ""}`).join(" ") || title;
  const locale = resolveOutputLocale(host.outputLanguage(), sample);
  await ensureFolder(host.app, folder);
  const base = safeBaseName(tOut(locale, "output.form.title", { form: title })) || safeBaseName(title);
  const path = uniqueNotePath(host.app, folder, base, new Set());
  const note = await host.app.vault.create(path, formNoteBody(fields, title, locale));
  const { properties } = formNoteProperties(fields, link, hash, {}, format);
  await host.app.fileManager.processFrontMatter(note, (frontmatter: Record<string, unknown>) => {
    Object.assign(frontmatter, properties);
  });
  await host.app.workspace.getLeaf(true).openFile(note);
  new Notice(t("form.noteCreated", { count: fields.length, path }));
  return note;
}

const FORM_EXTENSIONS: readonly string[] = ["hwpx", "hwp"];

/** Form note from an HWPX or HWP 5.x form that lives in the Vault; the note goes next to the form unless `folder` is given. */
export async function createFormNoteFromFile(host: FormHost, file: TFile, folder?: string): Promise<void> {
  if (!FORM_EXTENSIONS.includes(file.extension.toLowerCase())) {
    new Notice(t("form.hwpOnly"), 8_000);
    return;
  }
  try {
    const bytes = new Uint8Array(await host.app.vault.readBinary(file));
    const fields = await readFormFields(bytes);
    await createFormNote(
      host,
      fields,
      stem(file.name),
      `[[${file.path}]]`,
      formHash(bytes),
      folder ?? parentFolder(file.path),
      isHwpxBytes(bytes) ? "hwpx" : "hwp"
    );
  } catch (error: unknown) {
    new Notice(t("form.readFailed", { detail: errorMessage(error) }), 8_000);
  }
}

/** Form note from an HWPX form outside the Vault: the form is copied in first. */
export async function createFormNoteFromExternal(host: FormHost, notePath: string | undefined): Promise<void> {
  try {
    const [picked] = await host.gateway.pickFiles({ extensions: ["hwpx", "hwp"], multiple: false });
    if (!picked) return;
    if (!/\.hwpx?$/iu.test(picked.name)) {
      new Notice(t("form.hwpOnly"), 8_000);
      return;
    }
    const target = await host.app.fileManager.getAvailablePathForAttachment(picked.name, notePath ?? "");
    await ensureFolder(host.app, parentFolder(target));
    const copied = await host.app.vault.createBinary(target, bytesAsArrayBuffer(picked.bytes));
    new Notice(t("form.copied", { path: copied.path }));
    await createFormNoteFromFile(host, copied, normalizeImportedImageFolder(host.defaultFolder()));
  } catch (error: unknown) {
    new Notice(t("form.readFailed", { detail: errorMessage(error) }), 8_000);
  }
}

class BuiltinFormSuggest extends SuggestModal<BuiltinForm> {
  constructor(app: App, private readonly choose: (form: BuiltinForm) => void) {
    super(app);
    this.setPlaceholder(t("form.builtin.placeholder"));
  }

  getSuggestions(query: string): BuiltinForm[] {
    const needle = query.trim().toLowerCase();
    return BUILTIN_FORMS.filter((form) =>
      `${tKey(form.label)} ${form.documentName}`.toLowerCase().includes(needle)
    );
  }

  renderSuggestion(form: BuiltinForm, el: HTMLElement): void {
    el.createDiv({ text: tKey(form.label) });
  }

  onChooseSuggestion(form: BuiltinForm): void {
    this.choose(form);
  }
}

/** Form note from a built-in standard draft letter (별지 제1·2호서식). */
export function createFormNoteFromBuiltin(host: FormHost): void {
  new BuiltinFormSuggest(host.app, (form) => {
    void (async () => {
      try {
        const bytes = builtinFormBytes(form.id);
        const fields = await readFormFields(bytes);
        await createFormNote(
          host,
          fields,
          form.documentName,
          `${BUILTIN_FORM_PREFIX}${form.id}`,
          formHash(bytes),
          normalizeImportedImageFolder(host.defaultFolder())
        );
      } catch (error: unknown) {
        new Notice(t("form.readFailed", { detail: errorMessage(error) }), 8_000);
      }
    })();
  }).open();
}

class FormFillReportModal extends Modal {
  constructor(
    app: App,
    private readonly report: {
      path: string;
      filled: string[];
      unmatched: string[];
      overflow: FormOverflow[];
      warnings: string[];
      refreshed: string[];
    },
    private readonly openResult: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(t("form.report.title"));
    const { contentEl } = this;
    contentEl.createEl("p", { text: t("form.report.saved", { path: this.report.path }) });
    contentEl.createEl("p", { text: t("form.report.filled", { count: this.report.filled.length }) });
    if (this.report.refreshed.length) {
      contentEl.createEl("p", { text: t("form.report.refreshed", { names: this.report.refreshed.join(", ") }) });
    }
    if (this.report.unmatched.length) {
      contentEl.createEl("p", { text: t("form.report.unmatched") });
      const list = contentEl.createEl("ul");
      for (const name of this.report.unmatched) list.createEl("li", { text: name });
    }
    if (this.report.overflow.length || this.report.warnings.length) {
      const list = contentEl.createEl("ul");
      for (const item of this.report.overflow) list.createEl("li", { text: t("form.report.overflow", { ...item }) });
      for (const warning of this.report.warnings) list.createEl("li", { text: warning });
    }
    const actions = contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    const view = actions.createEl("button", { text: t("form.report.view") });
    view.classList.add("mod-cta");
    view.onclick = () => {
      this.close();
      this.openResult();
    };
    actions.createEl("button", { text: t("common.close") }).onclick = () => this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Fill the note's form with its properties and save "<form> (filled).hwpx" next to the note. */
export async function fillFormFromNote(host: FormHost, view: MarkdownView | null): Promise<void> {
  const note = view?.file;
  if (!note) {
    new Notice(t("form.noNote"));
    return;
  }
  const { app } = host;
  const frontmatter = app.metadataCache.getFileCache(note)?.frontmatter ?? {};
  const link = formLinkTarget(frontmatter[FORM_LINK_KEY]);
  if (!link) {
    new Notice(t("form.noLink", { key: FORM_LINK_KEY }), 8_000);
    return;
  }
  try {
    let bytes: Uint8Array;
    let formName: string;
    if (link.startsWith(BUILTIN_FORM_PREFIX)) {
      const id = link.slice(BUILTIN_FORM_PREFIX.length);
      if (!isBuiltinFormId(id)) throw new Error(t("form.missingForm", { link }));
      bytes = builtinFormBytes(id);
      formName = BUILTIN_FORMS.find((form) => form.id === id)?.documentName ?? id;
    } else {
      const form = app.metadataCache.getFirstLinkpathDest(link, note.path) ?? app.vault.getAbstractFileByPath(link);
      if (!(form instanceof TFile)) throw new Error(t("form.missingForm", { link }));
      if (!FORM_EXTENSIONS.includes(form.extension.toLowerCase())) {
        new Notice(t("form.hwpOnly"), 8_000);
        return;
      }
      bytes = new Uint8Array(await app.vault.readBinary(form));
      formName = stem(form.name);
    }

    // The form changed since the note was made: add its new fields, keep every value.
    let refreshed: string[] = [];
    const hash = formHash(bytes);
    if (typeof frontmatter[FORM_HASH_KEY] === "string" && frontmatter[FORM_HASH_KEY] !== hash) {
      const fields = await readFormFields(bytes);
      const { properties, added } = formNoteProperties(
        fields,
        String(frontmatter[FORM_LINK_KEY]),
        hash,
        frontmatter,
        frontmatter[FORM_FORMAT_KEY] === "hwp" || !isHwpxBytes(bytes) ? "hwp" : "hwpx"
      );
      await app.fileManager.processFrontMatter(note, (current: Record<string, unknown>) => {
        Object.assign(current, properties);
      });
      refreshed = added;
    }

    const values = collectFormValues(frontmatter);
    const filled = await fillFormHwpx(bytes, values);
    const folder = parentFolder(note.path);
    const sample = `${formName} ${Object.keys(values).join(" ")}`;
    const locale = resolveOutputLocale(host.outputLanguage(), sample);
    const base = safeBaseName(tOut(locale, "output.form.filledName", { form: formName })) || "form";
    let path = folder ? `${folder}/${base}.hwpx` : `${base}.hwpx`;
    for (let index = 1; app.vault.getAbstractFileByPath(path); index += 1) {
      path = folder ? `${folder}/${base} (${index}).hwpx` : `${base} (${index}).hwpx`;
    }
    const saved = await app.vault.createBinary(path, filled.data);
    new FormFillReportModal(app, { path: saved.path, ...filled, refreshed }, () => void host.openDocument(saved)).open();
  } catch (error: unknown) {
    new Notice(t("form.fillFailed", { detail: errorMessage(error) }), 8_000);
  }
}

type FormSourceChoice = { kind: "external" } | { kind: "vault"; file: TFile };

class FormSourceSuggest extends SuggestModal<FormSourceChoice> {
  constructor(app: App, private readonly choose: (choice: FormSourceChoice) => void) {
    super(app);
    this.setPlaceholder(t("form.pickPlaceholder"));
  }

  getSuggestions(query: string): FormSourceChoice[] {
    const needle = query.trim().toLowerCase();
    const files = this.app.vault
      .getFiles()
      .filter((file) => FORM_EXTENSIONS.includes(file.extension.toLowerCase()) && file.path.toLowerCase().includes(needle))
      .slice(0, 100)
      .map((file): FormSourceChoice => ({ kind: "vault", file }));
    return [{ kind: "external" }, ...files];
  }

  renderSuggestion(choice: FormSourceChoice, el: HTMLElement): void {
    el.setText(choice.kind === "external" ? t("form.pickExternal") : choice.file.path);
  }

  onChooseSuggestion(choice: FormSourceChoice): void {
    this.choose(choice);
  }
}

/** Command entry: choose an HWPX form in the Vault or outside it. */
export function pickFormAndCreateNote(host: FormHost, notePath: string | undefined): void {
  new FormSourceSuggest(host.app, (choice) => {
    if (choice.kind === "external") void createFormNoteFromExternal(host, notePath);
    else void createFormNoteFromFile(host, choice.file);
  }).open();
}
