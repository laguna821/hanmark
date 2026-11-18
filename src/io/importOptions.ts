import type { ParseOptions } from "kordoc";
import type { MessageKey } from "../i18n";

/**
 * Import presets and advanced options (2.7.0 W3).
 *
 * Presets only switch on documented, offline Kordoc parse options. Since 3.0.0
 * (R-032) the notation of the imported note is chosen by the user: table style,
 * sub/superscript tags, and whether borderless layout tables are unwrapped.
 */
export type ImportPresetId = "default" | "text" | "form" | "exam";

export const IMPORT_PRESET_IDS: readonly ImportPresetId[] = ["default", "text", "form", "exam"];

export const IMPORT_PRESET_LABELS: Readonly<Record<ImportPresetId, { name: MessageKey; desc: MessageKey }>> = {
  default: { name: "import.preset.default.name", desc: "import.preset.default.desc" },
  text: { name: "import.preset.text.name", desc: "import.preset.text.desc" },
  form: { name: "import.preset.form.name", desc: "import.preset.form.desc" },
  exam: { name: "import.preset.exam.name", desc: "import.preset.exam.desc" }
};

export type ImportTableStyle = "pipe" | "mixed" | "html";

export const IMPORT_TABLE_STYLES: readonly ImportTableStyle[] = ["pipe", "mixed", "html"];

export interface ImportAdvancedOptions {
  /** Page (PDF) or section (HWP/HWPX) range such as "1-3,7"; empty means all. */
  pages: string;
  /** Extract images into the Vault (default true). */
  images: boolean;
  /**
   * How tables are written (R-032). "pipe": every table as an Obsidian pipe table
   * (merged cells are flattened); "mixed": merged or nested tables as HTML, the
   * rest as pipe tables (the 2.7.x output); "html": every table as HTML.
   */
  tables: ImportTableStyle;
  /** Write superscripts and subscripts as <sup>/<sub> (default true). */
  scriptTags: boolean;
  /** Unwrap borderless layout tables into text (default false: keep them as tables). */
  flattenLayout: boolean;
  /** HWP/HWPX: append the document's memos as a section at the end (default false). */
  memos: boolean;
  /** PDF: put pictures where they are read instead of at the end of the page (default false). */
  imagesInFlow: boolean;
  /** PDF: remove running headers and footers. */
  removeHeaderFooter: boolean;
  /** HWP5: keep only the first copy of repeated running headings. */
  dedupeRunningHeaders: boolean;
}

export interface ImportOptions extends ImportAdvancedOptions {
  preset: ImportPresetId;
}

export const DEFAULT_IMPORT_OPTIONS: Readonly<ImportOptions> = Object.freeze({
  preset: "default",
  pages: "",
  images: true,
  tables: "pipe",
  scriptTags: true,
  flattenLayout: false,
  memos: false,
  imagesInFlow: false,
  removeHeaderFooter: false,
  dedupeRunningHeaders: false
});

/**
 * The only Kordoc parse options HanMark ever passes. OCR, formula OCR (model
 * downloads), file paths (external COM conversion), and inline images are excluded
 * by type so no call site can reach them (offline contract, R-018).
 */
export type HanmarkParseOptions = Pick<
  ParseOptions,
  | "pages"
  | "plain"
  | "htmlTables"
  | "tableFormat"
  | "htmlCellLinks"
  | "layoutTables"
  | "scriptTags"
  | "memos"
  | "imagePlacement"
  | "keepTrailingEmptyCols"
  | "keepEmptyParagraphs"
  | "includeFieldPlaceholders"
  | "password"
  | "images"
  | "tables"
  | "removeHeaderFooter"
  | "dedupeRunningHeaders"
  | "onProgress"
>;

export const ALLOWED_PARSE_OPTION_KEYS: ReadonlySet<string> = new Set<keyof HanmarkParseOptions>([
  "pages",
  "plain",
  "htmlTables",
  "tableFormat",
  "htmlCellLinks",
  "layoutTables",
  "scriptTags",
  "memos",
  "imagePlacement",
  "keepTrailingEmptyCols",
  "keepEmptyParagraphs",
  "includeFieldPlaceholders",
  "password",
  "images",
  "tables",
  "removeHeaderFooter",
  "dedupeRunningHeaders",
  "onProgress"
]);

/**
 * Values HanMark sets on every Kordoc parse() call, whatever the caller chose
 * (R-029). They keep the offline contract and cannot be overridden.
 * - hancomFallback: never start Hancom Office (PowerShell/COM). The code is also
 *   removed from the bundle.
 * - ocr: never run OCR. Kordoc 4.25.0 turns built-in OCR on by itself for image
 *   input and for scanned pages when a model is cached.
 */
export const FORCED_PARSE_OPTIONS = Object.freeze({
  hancomFallback: false,
  ocr: false
} as const);

/**
 * Notation used when a caller does not choose one (document comparison, form
 * reading): the Kordoc 4.15.7 output, pinned in R-029. The import window always
 * chooses explicitly (R-032), so these never apply to imported notes.
 * - layoutTables "keep": borderless layout tables stay tables.
 * - scriptTags false: superscripts and subscripts stay plain text.
 */
export const PINNED_PARSE_DEFAULTS = Object.freeze({
  layoutTables: "keep",
  scriptTags: false
} as const);

/** What actually reaches Kordoc: the whitelist plus the forced values. */
export type KordocParseOptions = HanmarkParseOptions &
  typeof FORCED_PARSE_OPTIONS &
  Required<Pick<HanmarkParseOptions, "layoutTables" | "scriptTags">>;

/** The only way HanMark builds the options object it hands to Kordoc's parse(). */
export function kordocParseOptions(options: HanmarkParseOptions = {}): KordocParseOptions {
  return { ...PINNED_PARSE_DEFAULTS, ...options, ...FORCED_PARSE_OPTIONS };
}

export function normalizeImportTableStyle(value: unknown): ImportTableStyle {
  return value === "mixed" || value === "html" ? value : "pipe";
}

/** The advanced options HanMark remembers between imports (not the page range). */
export type RememberedImportOptions = Omit<ImportAdvancedOptions, "pages">;

/**
 * Stored advanced options, tolerant of every earlier shape: 2.7.x kept nothing,
 * and a stored `htmlTables: true` (all tables as HTML) becomes the "html" style.
 * Everything else gets the 3.0.0 defaults.
 */
export function normalizeRememberedImportOptions(value: unknown): RememberedImportOptions {
  const data = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const flag = (key: keyof RememberedImportOptions): boolean =>
    typeof data[key] === "boolean" ? data[key] : (DEFAULT_IMPORT_OPTIONS[key] as boolean);
  return {
    images: flag("images"),
    tables: data.tables === undefined && data.htmlTables === true ? "html" : normalizeImportTableStyle(data.tables),
    scriptTags: flag("scriptTags"),
    flattenLayout: flag("flattenLayout"),
    memos: flag("memos"),
    imagesInFlow: flag("imagesInFlow"),
    removeHeaderFooter: flag("removeHeaderFooter"),
    dedupeRunningHeaders: flag("dedupeRunningHeaders")
  };
}

/** Defaults, then what the user chose last time, then the preset from settings (R-032). */
export function initialImportOptions(host: {
  defaultPreset(): unknown;
  rememberedOptions?(): unknown;
}): ImportOptions {
  return {
    ...DEFAULT_IMPORT_OPTIONS,
    ...normalizeRememberedImportOptions(host.rememberedOptions?.()),
    preset: normalizeImportPreset(host.defaultPreset())
  };
}

export function rememberedImportOptions(options: ImportOptions): RememberedImportOptions {
  return normalizeRememberedImportOptions(options);
}

const MAX_PAGE_NUMBER = 100_000;

export function normalizeImportPreset(value: unknown): ImportPresetId {
  return value === "text" || value === "form" || value === "exam" ? value : "default";
}

/**
 * Canonical page range ("1-3,5,7-9"), "" for the whole document, or null when the
 * input is not a valid range. Whitespace is ignored; ranges must ascend.
 */
export function normalizePageRange(value: string): string | null {
  const compact = value.replace(/\s+/gu, "");
  if (!compact) return "";
  const parts: string[] = [];
  for (const part of compact.split(",")) {
    const match = /^(\d{1,6})(?:-(\d{1,6}))?$/u.exec(part);
    if (!match) return null;
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (start < 1 || end < start || end > MAX_PAGE_NUMBER) return null;
    parts.push(start === end ? String(start) : `${start}-${end}`);
  }
  return parts.join(",");
}

export interface ParseExtras {
  /** Held in memory for one attempt; never stored or logged. */
  password?: string;
  onProgress?: (current: number, total: number) => void;
}

/**
 * Translate user choices into the Kordoc options whitelist (R-032).
 *
 * Presets and notation:
 * - default: the user's table style, script tags, and layout choice.
 * - text: plain text, so no script tags; tables in the user's style.
 * - form: the document's structure is the point, so layout tables are always
 *   kept and merged tables stay HTML ("mixed") unless the user asked for all HTML.
 * - exam: tables are off; script tags and layout follow the user's choice.
 */
export function toParseOptions(options: ImportOptions, extras: ParseExtras = {}): HanmarkParseOptions {
  const parse: HanmarkParseOptions = {};
  const form = options.preset === "form";
  parse.layoutTables = options.flattenLayout && !form ? "visual" : "keep";
  parse.scriptTags = options.scriptTags && options.preset !== "text";
  const tables: ImportTableStyle = form && options.tables === "pipe" ? "mixed" : options.tables;
  if (tables === "pipe") {
    // Kordoc rejects htmlTables together with tableFormat "gfm"; never send both.
    parse.tableFormat = "gfm";
  } else {
    if (tables === "html") parse.htmlTables = true;
    // Links inside HTML table cells become real <a href> links.
    parse.htmlCellLinks = true;
  }
  if (options.memos) parse.memos = true;
  if (options.imagesInFlow) parse.imagePlacement = "flow";
  switch (options.preset) {
    case "text":
      // Text only: placeholders, link URLs and emphasis marks are dropped, so the
      // image bytes would have nowhere to go.
      parse.plain = true;
      parse.images = false;
      break;
    case "form":
      parse.keepTrailingEmptyCols = true;
      parse.includeFieldPlaceholders = true;
      parse.keepEmptyParagraphs = true;
      break;
    case "exam":
      parse.tables = false;
      break;
    default:
      break;
  }
  const pages = normalizePageRange(options.pages);
  if (pages) parse.pages = pages;
  if (!options.images) parse.images = false;
  if (options.removeHeaderFooter) parse.removeHeaderFooter = true;
  if (options.dedupeRunningHeaders) parse.dedupeRunningHeaders = true;
  if (extras.password) parse.password = extras.password;
  if (extras.onProgress) parse.onProgress = extras.onProgress;
  return parse;
}

/** Folder policy for new notes created by an import. */
export type ImportDestinationMode = "note-folder" | "folder" | "ask";

export interface ImportDestination {
  mode: ImportDestinationMode;
  /** Vault-relative folder used by "folder" mode; "" means the Vault root. */
  folder: string;
}

export const DEFAULT_IMPORT_DESTINATION: Readonly<ImportDestination> = Object.freeze({
  mode: "note-folder",
  folder: ""
});
