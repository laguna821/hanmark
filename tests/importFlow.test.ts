import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import type { App } from "obsidian";
import { markdownToHwpx, type ErrorCode, type WarningCode } from "kordoc";
import {
  ALLOWED_PARSE_OPTION_KEYS,
  DEFAULT_IMPORT_OPTIONS,
  IMPORT_PRESET_IDS,
  normalizePageRange,
  toParseOptions,
  type ImportOptions
} from "../src/io/importOptions";
import {
  describeImportFailure,
  describeImportWarning,
  KORDOC_ERROR_CODES,
  KORDOC_WARNING_CODES
} from "../src/io/messageCatalog";
import {
  importOne,
  isImportableExtension,
  runImportJob,
  uniqueNotePath,
  type ImportInput,
  type ImportJob
} from "../src/io/importRunner";
import { normalizeHanmarkSettings } from "../src/legacy-port/settings";
import { setUiLocale } from "../src/i18n";
import { makeKoreanCMapPdf } from "./fixtures/koreanCMapPdf";

// The whitelist never carries these; "ocr" and "hancomFallback" are added later, forced to
// false, by kordocParseOptions (tests/kordocPins.test.ts).
const FORBIDDEN_OPTIONS = ["ocr", "formulaOcr", "filePath", "inlineImages", "hancomFallback"];

interface MockNote {
  path: string;
  content: string;
}

function mockApp(existing: string[] = []): { app: App; notes: Map<string, MockNote>; folders: Set<string> } {
  const notes = new Map<string, MockNote>();
  const folders = new Set<string>();
  for (const path of existing) notes.set(path, { path, content: "" });
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath(path: string): unknown {
        if (notes.has(path)) return notes.get(path);
        return folders.has(path) ? { path, children: [] } : null;
      },
      async create(path: string, content: string): Promise<MockNote> {
        if (notes.has(path)) throw new Error(`exists: ${path}`);
        const note = { path, content };
        notes.set(path, note);
        return note;
      },
      async createFolder(path: string): Promise<void> {
        folders.add(path);
      },
      async createBinary(path: string): Promise<{ path: string }> {
        notes.set(path, { path, content: "<binary>" });
        return { path };
      }
    },
    fileManager: {
      async getAvailablePathForAttachment(name: string): Promise<string> {
        return `attachments/${name}`;
      }
    }
  };
  return { app: app as unknown as App, notes, folders };
}

function job(options: Partial<ImportOptions> = {}, folder = "Imported"): Omit<ImportJob, "inputs"> {
  return {
    options: { ...DEFAULT_IMPORT_OPTIONS, ...options },
    folderFor: () => folder,
    imageDestination: "vault",
    cloudSettings: { destination: "vault", localFolder: "", workerUrl: "", publicUrl: "" }
  };
}

async function hwpxInput(name: string, markdown: string): Promise<ImportInput> {
  const data = await markdownToHwpx(markdown);
  return { name, bytes: new Uint8Array(data) };
}

/** What the 3.0.0 defaults send: Obsidian tables, script tags, layout tables kept. */
const NOTATION = { layoutTables: "keep", scriptTags: true, tableFormat: "gfm" } as const;

describe("import options (2.7.0 W3)", () => {
  it("passes only the chosen notation for the default preset (R-032)", () => {
    assert.deepEqual(toParseOptions(DEFAULT_IMPORT_OPTIONS), NOTATION);
  });

  it("maps each preset to documented offline parse options", () => {
    assert.deepEqual(toParseOptions({ ...DEFAULT_IMPORT_OPTIONS, preset: "text" }), {
      ...NOTATION,
      scriptTags: false,
      plain: true,
      images: false
    });
    assert.deepEqual(toParseOptions({ ...DEFAULT_IMPORT_OPTIONS, preset: "form" }), {
      layoutTables: "keep",
      scriptTags: true,
      htmlCellLinks: true,
      keepTrailingEmptyCols: true,
      includeFieldPlaceholders: true,
      keepEmptyParagraphs: true
    });
    assert.deepEqual(toParseOptions({ ...DEFAULT_IMPORT_OPTIONS, preset: "exam" }), { ...NOTATION, tables: false });
  });

  it("never produces OCR, model-download, file-path, or inline-image options", () => {
    const onProgress = (): void => {};
    for (const preset of IMPORT_PRESET_IDS) {
      for (const flags of [false, true]) {
        const options = toParseOptions(
          {
            ...DEFAULT_IMPORT_OPTIONS,
            preset,
            pages: "1-2",
            images: !flags,
            tables: flags ? "html" : "pipe",
            flattenLayout: flags,
            memos: flags,
            imagesInFlow: flags,
            removeHeaderFooter: flags,
            dedupeRunningHeaders: flags
          },
          { password: "secret", onProgress }
        );
        for (const key of Object.keys(options)) {
          assert.ok(ALLOWED_PARSE_OPTION_KEYS.has(key), `${preset}: ${key} is not whitelisted`);
          assert.ok(!FORBIDDEN_OPTIONS.includes(key), `${preset}: ${key} is forbidden`);
        }
      }
    }
  });

  it("normalizes page ranges and rejects invalid ones", () => {
    assert.equal(normalizePageRange(""), "");
    assert.equal(normalizePageRange(" 1 - 3 , 5 "), "1-3,5");
    assert.equal(normalizePageRange("7-7"), "7");
    assert.equal(normalizePageRange("3-1"), null);
    assert.equal(normalizePageRange("0"), null);
    assert.equal(normalizePageRange("1,,2"), null);
    assert.equal(normalizePageRange("a"), null);
    assert.equal(toParseOptions({ ...DEFAULT_IMPORT_OPTIONS, pages: "2- 4" }).pages, "2-4");
    assert.equal(toParseOptions({ ...DEFAULT_IMPORT_OPTIONS, pages: "bad" }).pages, undefined);
  });

  it("accepts .hml alongside the other supported extensions", () => {
    for (const extension of ["hwp", "HWPX", "hwpml", "hml", "pdf", "docx", "pptx", "xlsx", "xls"]) {
      assert.ok(isImportableExtension(extension), extension);
    }
    assert.equal(isImportableExtension("png"), false);
  });

  it("stores the import preset and destination safely in settings v12", () => {
    const settings = normalizeHanmarkSettings({
      importPreset: "form",
      importDestination: { mode: "folder", folder: "Imports\\HanMark" }
    });
    assert.equal(settings.importPreset, "form");
    assert.deepEqual(settings.importDestination, { mode: "folder", folder: "Imports/HanMark" });
    assert.equal(settings.openHangulFilesInHanmark, true);
    const unsafe = normalizeHanmarkSettings({ importPreset: "ocr", importDestination: { mode: "x", folder: ".obsidian/plugins" } });
    assert.equal(unsafe.importPreset, "default");
    assert.deepEqual(unsafe.importDestination, { mode: "note-folder", folder: "" });
  });
});

describe("import messages", () => {
  afterEach(() => setUiLocale("ko"));

  it("explains every Kordoc error and warning code in Korean and English", () => {
    for (const locale of ["ko", "en"] as const) {
      setUiLocale(locale);
      for (const code of KORDOC_ERROR_CODES as ErrorCode[]) {
        const text = describeImportFailure(code, "hwpx");
        assert.ok(text.title.trim(), `${locale} ${code} title`);
        assert.ok(text.fix?.trim(), `${locale} ${code} fix`);
      }
      for (const code of KORDOC_WARNING_CODES as WarningCode[]) {
        const text = describeImportWarning({ code, message: "raw" });
        assert.ok(text.trim() && text !== "raw", `${locale} ${code}`);
      }
    }
    assert.equal(KORDOC_ERROR_CODES.length, 13);
    assert.equal(KORDOC_WARNING_CODES.length, 17);
  });

  it("offers a password only for formats Kordoc can decrypt", () => {
    assert.equal(describeImportFailure("ENCRYPTED", "hwpx").passwordHelps, true);
    assert.equal(describeImportFailure("ENCRYPTED", "hwp3").passwordHelps, true);
    const pdf = describeImportFailure("ENCRYPTED", "pdf");
    assert.equal(pdf.passwordHelps, false);
    assert.match(pdf.fix ?? "", /PDF/u);
    assert.equal(describeImportFailure("CORRUPTED", "hwpx").passwordHelps, false);
    assert.equal(describeImportFailure("SOMETHING_NEW").title, describeImportFailure("PARSE_ERROR").title);
    assert.equal(describeImportWarning({ code: "FUTURE_CODE" as WarningCode, message: "원문" }), "원문");
  });
});

describe("import runner", () => {
  it("creates a note from parsed Markdown with format, page and table facts", async () => {
    const { app, notes, folders } = mockApp();
    const input = await hwpxInput("보고서.hwpx", "# 사업 개요\n\n본문 문단입니다.\n\n| 항목 | 값 |\n|---|---|\n| 가 | 1 |\n");
    const result = await importOne(app, input, job(), new Set());
    assert.equal(result.ok, true, result.errorOriginal);
    assert.equal(result.notePath, "Imported/보고서.md");
    assert.equal(result.fileType, "hwpx");
    assert.equal(result.tables, 1);
    assert.equal(result.input, undefined, "successful results drop the source bytes");
    assert.ok(folders.has("Imported"));
    const note = notes.get("Imported/보고서.md")?.content ?? "";
    assert.match(note, /사업 개요/u);
    assert.match(note, /\| 항목 \| 값 \|/u);
    assert.doesNotMatch(note, /^---/u, "no frontmatter or source contract");
  });

  it("reads real PDF pages and reports the page basis", async () => {
    const { app } = mockApp();
    const result = await importOne(app, { name: "cmap.pdf", bytes: new Uint8Array(makeKoreanCMapPdf()) }, job(), new Set());
    assert.equal(result.ok, true, result.errorOriginal);
    assert.equal(result.fileType, "pdf");
    assert.equal(result.pageCount, 1);
  });

  it("asks for the password of an encrypted HWPX and never passes a wrong one as success", async () => {
    const { app, notes } = mockApp();
    const bytes = new Uint8Array(readFileSync("tests/fixtures/password/HWP5-password-123456.hwpx"));
    const input = { name: "암호 문서.hwpx", bytes };
    const options = job({ images: false });

    const locked = await importOne(app, input, options, new Set());
    assert.equal(locked.ok, false);
    assert.equal(locked.errorCode, "ENCRYPTED");
    assert.equal(locked.passwordHelps, true);
    assert.equal(locked.input, input, "failures keep the input for retry");

    const wrong = await importOne(app, input, options, new Set(), "000000");
    assert.equal(wrong.ok, false);
    assert.equal(wrong.errorCode, "ENCRYPTED");

    const opened = await importOne(app, input, options, new Set(), "123456");
    assert.equal(opened.ok, true, opened.errorOriginal);
    assert.ok((notes.get(opened.notePath ?? "")?.content.length ?? 0) > 100);
    assert.equal(notes.size, 1, "only the successful attempt creates a note");
  });

  it("reports an unreadable file as a failure with plain-language text", async () => {
    const { app } = mockApp();
    const result = await importOne(app, { name: "빈.hwpx", bytes: new Uint8Array() }, job(), new Set());
    assert.equal(result.ok, false);
    assert.ok(result.errorTitle?.trim());
    assert.ok(result.errorOriginal?.trim());
  });

  it("keeps result order, reports progress, and stops between files", async () => {
    const { app } = mockApp();
    const inputs = [
      await hwpxInput("첫째.hwpx", "# 하나\n"),
      await hwpxInput("둘째.hwpx", "# 둘\n"),
      await hwpxInput("셋째.hwpx", "# 셋\n")
    ];
    const seen: number[] = [];
    let stop = false;
    const results = await runImportJob(app, { ...job(), inputs }, {
      onProgress: (progress) => {
        seen.push(progress.done);
        if (progress.done >= 1) stop = true;
      },
      isCancelled: () => stop
    });
    assert.deepEqual(results.map((result) => result.source), ["첫째.hwpx", "둘째.hwpx", "셋째.hwpx"]);
    assert.ok(results[0].ok);
    assert.ok(results.some((result) => result.cancelled), "files not yet started are skipped");
    assert.ok(seen.every((value, index) => index === 0 || value >= seen[index - 1]), "progress never goes backwards");
    assert.equal(seen[seen.length - 1], 3);
  });

  it("never overwrites an existing note", () => {
    const { app } = mockApp(["Imported/보고서.md"]);
    const reserved = new Set<string>();
    assert.equal(uniqueNotePath(app, "Imported", "보고서", reserved), "Imported/보고서 (1).md");
    assert.equal(uniqueNotePath(app, "Imported", "보고서", reserved), "Imported/보고서 (2).md");
  });
});
