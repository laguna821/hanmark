import type { App, TFile } from "obsidian";
import { parse, type FileType, type ParseResult } from "kordoc";
import { persistImportedImages, type PersistedCloudImage } from "./importImages";
import type { ImportCloudSettings } from "./kordocImport";
import { bytesAsArrayBuffer, splitFilename } from "./fileGateway";
import { describeImportFailure, describeImportWarning } from "./messageCatalog";
import { kordocParseOptions, toParseOptions, type ImportOptions } from "./importOptions";
import { errorMessage } from "../utils/errors";
import { t } from "../i18n";

/** Extensions HanMark offers to convert (Kordoc detects the real format by content). */
export const IMPORT_EXTENSIONS: readonly string[] = ["hwp", "hwpx", "hwpml", "hml", "docx", "pdf", "xlsx", "xls"];

/** Files above this size need an explicit confirmation before conversion. */
export const LARGE_IMPORT_BYTES = 50 * 1024 * 1024;

export function isImportableExtension(extension: string): boolean {
  return IMPORT_EXTENSIONS.includes(extension.toLowerCase());
}

/** One document to convert, already read into memory. */
export interface ImportInput {
  /** File name with extension, as the user saw it. */
  name: string;
  bytes: Uint8Array;
  /** Vault path when the document already lives in the Vault. */
  vaultPath?: string;
}

export interface ImportWarning {
  /** Kordoc warning code, or "image" / "cloud" for HanMark's own steps. */
  code: string;
  page?: number;
  text: string;
  /** Kordoc's original sentence, kept for bug reports. */
  original?: string;
}

/** Outcome of one document: a created note, a failure, or a skipped (cancelled) file. */
export interface ImportResult {
  ok: boolean;
  source: string;
  notePath?: string;
  fileType?: FileType;
  pageCount?: number;
  /** "layout" = real pages; "section" = approximated by document sections. */
  pageMode?: "layout" | "section";
  tables?: number;
  images?: number;
  cloudImages?: number;
  warnings: ImportWarning[];
  errorCode?: string;
  errorTitle?: string;
  errorFix?: string;
  errorOriginal?: string;
  /** Entering the open password can make a retry succeed. */
  passwordHelps?: boolean;
  cancelled?: boolean;
  /** Kept only for failures so the report can retry without re-picking the file. */
  input?: ImportInput;
}

export interface ImportJob {
  inputs: readonly ImportInput[];
  options: ImportOptions;
  /** Vault folder for the note created from `input` ("" = Vault root). */
  folderFor(input: ImportInput): string;
  imageDestination: "vault" | "cmds-eagle-r2";
  cloudSettings: ImportCloudSettings;
  /**
   * Cloud hand-off for "cmds-eagle-r2" (see kordocImport.moveImportedImagesToCloud).
   * Injected so this module stays free of Obsidian runtime imports and testable.
   */
  moveImagesToCloud?(note: TFile, candidates: readonly PersistedCloudImage[]): Promise<{ uploaded: number; warnings: string[] }>;
}

export interface ImportProgress {
  /** Files finished so far (success, failure, or skipped). */
  done: number;
  total: number;
  /** File currently being read, with its page/section progress when known. */
  current?: { name: string; page?: number; pages?: number };
}

export interface ImportControl {
  onProgress?(progress: ImportProgress): void;
  /** Checked before each file starts; a running conversion always finishes. */
  isCancelled?(): boolean;
}

function looksLikePdf(input: ImportInput): boolean {
  if (splitFilename(input.name).extension.toLowerCase() === "pdf") return true;
  const head = input.bytes.subarray(0, 5);
  return head.length === 5 && String.fromCharCode(...head) === "%PDF-";
}

function safeNoteBase(name: string): string {
  const stem = splitFilename(name).stem.replace(/[\\/:*?"<>|#^[\]]/gu, "_").trim();
  return stem || t("import.defaultNoteName");
}

/**
 * Resolve a free note path. `reserved` holds paths already claimed by sibling imports
 * running in parallel — vault.create is async so getAbstractFileByPath alone would race.
 */
export function uniqueNotePath(app: App, folder: string, base: string, reserved: Set<string>): string {
  const directory = folder ? `${folder}/` : "";
  let relative = normalizeNotePath(`${directory}${base}.md`);
  let index = 1;
  while (app.vault.getAbstractFileByPath(relative) || reserved.has(relative)) {
    relative = normalizeNotePath(`${directory}${base} (${index++}).md`);
  }
  reserved.add(relative);
  return relative;
}

/** Obsidian-compatible path normalization (NFC, forward slashes, no empty segments). */
function normalizeNotePath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .join("/")
    .normalize("NFC");
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  if (!folder) return;
  const existing = app.vault.getAbstractFileByPath(folder);
  if (existing && "children" in existing) return;
  if (existing) throw new Error(t("import.error.destinationNotFolder", { path: folder }));
  await app.vault.createFolder(folder);
}

function countTables(result: Extract<ParseResult, { success: true }>): number {
  return result.blocks.filter((block) => block.type === "table").length;
}

function failure(input: ImportInput, parsed: Extract<ParseResult, { success: false }> | null, error?: unknown): ImportResult {
  const code = parsed?.code;
  const described = describeImportFailure(code, parsed?.fileType);
  return {
    ok: false,
    source: input.name,
    fileType: parsed?.fileType,
    warnings: [],
    errorCode: code,
    errorTitle: described.title,
    errorFix: described.fix,
    errorOriginal: parsed ? parsed.error : errorMessage(error),
    passwordHelps: described.passwordHelps,
    input
  };
}

/**
 * Convert one document into a new note. Kordoc runs in-process with the offline
 * options whitelist; the note body is exactly the parsed Markdown plus attachment
 * links (no source contract, no frontmatter).
 */
export async function importOne(
  app: App,
  input: ImportInput,
  job: Omit<ImportJob, "inputs">,
  reserved: Set<string>,
  password?: string,
  onPage?: (page: number, pages: number) => void
): Promise<ImportResult> {
  let result: ParseResult;
  try {
    result = await parse(
          bytesAsArrayBuffer(input.bytes),
          kordocParseOptions(toParseOptions(job.options, { password, onProgress: onPage }))
        );
  } catch (error) {
    return failure(input, null, error);
  }
  if (result.success === false) return failure(input, result);

  try {
    const folder = job.folderFor(input);
    await ensureFolder(app, folder);
    const relative = uniqueNotePath(app, folder, safeNoteBase(input.name), reserved);
    const persisted = await persistImportedImages(
      app,
      relative,
      result.markdown.trim(),
      result.images,
      { destination: job.imageDestination, localFolder: job.cloudSettings.localFolder }
    );
    const note = await app.vault.create(relative, persisted.markdown.trim() + "\n");

    let cloud = { uploaded: 0, warnings: [] as string[] };
    if (job.imageDestination === "cmds-eagle-r2" && persisted.cloudCandidates.length && job.moveImagesToCloud) {
      cloud = await job.moveImagesToCloud(note, persisted.cloudCandidates);
    }

    const warnings: ImportWarning[] = [
      ...(result.warnings ?? []).map((warning) => ({
        code: warning.code,
        page: warning.page,
        text: describeImportWarning(warning),
        original: warning.message
      })),
      ...persisted.warnings.map((text) => ({ code: "image", text })),
      ...cloud.warnings.map((text) => ({ code: "cloud", text }))
    ];
    return {
      ok: true,
      source: input.name,
      notePath: relative,
      fileType: result.fileType,
      pageCount: result.metadata?.pageCount ?? result.pageCount,
      pageMode: result.metadata?.pageMode,
      tables: countTables(result),
      images: persisted.saved,
      cloudImages: cloud.uploaded,
      warnings
    };
  } catch (error) {
    return {
      ok: false,
      source: input.name,
      fileType: result.fileType,
      warnings: [],
      errorCode: "note",
      errorTitle: t("import.error.noteCreate.title"),
      errorFix: t("import.error.noteCreate.fix"),
      errorOriginal: errorMessage(error),
      input
    };
  }
}

/**
 * Convert many documents. PDFs run one at a time (their parser holds the most
 * memory); other formats run two at a time; cloud uploads run strictly in order.
 */
export async function runImportJob(app: App, job: ImportJob, control: ImportControl = {}): Promise<ImportResult[]> {
  const results: ImportResult[] = new Array<ImportResult>(job.inputs.length);
  const reserved = new Set<string>();
  const limit = job.imageDestination === "cmds-eagle-r2" ? 1 : 2;
  let next = 0;
  let done = 0;
  let pdfBusy: Promise<void> = Promise.resolve();

  const report = (current?: ImportProgress["current"]): void => {
    control.onProgress?.({ done, total: job.inputs.length, current });
  };

  const runOne = async (index: number): Promise<void> => {
    const input = job.inputs[index];
    if (control.isCancelled?.()) {
      results[index] = { ok: false, source: input.name, warnings: [], cancelled: true };
      done += 1;
      report();
      return;
    }
    const convert = async (): Promise<void> => {
      report({ name: input.name });
      results[index] = await importOne(app, input, job, reserved, undefined, (page, pages) =>
        report({ name: input.name, page, pages })
      );
    };
    if (looksLikePdf(input)) {
      const previous = pdfBusy;
      let release = (): void => {};
      pdfBusy = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        if (control.isCancelled?.()) {
          results[index] = { ok: false, source: input.name, warnings: [], cancelled: true };
        } else {
          await convert();
        }
      } finally {
        release();
      }
    } else {
      await convert();
    }
    done += 1;
    report();
  };

  const worker = async (): Promise<void> => {
    while (next < job.inputs.length) {
      const index = next;
      next += 1;
      await runOne(index);
    }
  };
  report();
  await Promise.all(Array.from({ length: Math.min(limit, job.inputs.length) }, worker));
  return results;
}
