import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { markdownToHwpx, parse } from "kordoc";
import {
  ALLOWED_PARSE_OPTION_KEYS,
  DEFAULT_IMPORT_OPTIONS,
  FORCED_PARSE_OPTIONS,
  IMPORT_PRESET_IDS,
  IMPORT_TABLE_STYLES,
  initialImportOptions,
  kordocParseOptions,
  normalizeRememberedImportOptions,
  PINNED_PARSE_DEFAULTS,
  rememberedImportOptions,
  toParseOptions,
  type ImportOptions
} from "../src/io/importOptions";
import { IMPORT_EXTENSIONS, isImportableExtension } from "../src/io/importRunner";
import { describeImportWarning } from "../src/io/messageCatalog";
import { normalizeHanmarkSettings } from "../src/legacy-port/settings";

const FORBIDDEN = ["ocr", "formulaOcr", "filePath", "inlineImages", "imageFormat", "qrCodes", "dropBlankImages", "hancomFallback"];

function buffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  return data instanceof Uint8Array ? (data.slice().buffer as ArrayBuffer) : data;
}

async function importMarkdown(bytes: ArrayBuffer, options: Partial<ImportOptions> = {}): Promise<string> {
  const result = await parse(bytes, kordocParseOptions(toParseOptions({ ...DEFAULT_IMPORT_OPTIONS, ...options })));
  assert.equal(result.success, true);
  return result.success ? result.markdown : "";
}

const MERGED_AND_SIMPLE = [
  "# 표 시험",
  "",
  "표 두 개가 있는 문서입니다.",
  "",
  "<table>",
  '<tr><th>구분</th><th colspan="2">내용</th></tr>',
  '<tr><td rowspan="2">담당</td><td>책임자</td><td>김하나</td></tr>',
  "<tr><td>담당자</td><td>이두리</td></tr>",
  "</table>",
  "",
  "| 이름 | 값 |",
  "| --- | --- |",
  "| 가 | 1 |",
  "| 나 | 2 |"
].join("\n");

describe("import notation chosen by the user (R-032)", () => {
  it("defaults to Obsidian tables, script tags on, layout tables kept", () => {
    assert.equal(DEFAULT_IMPORT_OPTIONS.tables, "pipe");
    assert.equal(DEFAULT_IMPORT_OPTIONS.scriptTags, true);
    assert.equal(DEFAULT_IMPORT_OPTIONS.flattenLayout, false);
    assert.equal(DEFAULT_IMPORT_OPTIONS.memos, false);
    assert.equal(DEFAULT_IMPORT_OPTIONS.imagesInFlow, false);
    assert.deepEqual(toParseOptions(DEFAULT_IMPORT_OPTIONS), {
      layoutTables: "keep",
      scriptTags: true,
      tableFormat: "gfm"
    });
  });

  it("maps the three table styles and never sends htmlTables with tableFormat gfm", () => {
    assert.deepEqual(toParseOptions({ ...DEFAULT_IMPORT_OPTIONS, tables: "mixed" }), {
      layoutTables: "keep",
      scriptTags: true,
      htmlCellLinks: true
    });
    assert.deepEqual(toParseOptions({ ...DEFAULT_IMPORT_OPTIONS, tables: "html" }), {
      layoutTables: "keep",
      scriptTags: true,
      htmlTables: true,
      htmlCellLinks: true
    });
    for (const preset of IMPORT_PRESET_IDS) {
      for (const tables of IMPORT_TABLE_STYLES) {
        for (const flag of [false, true]) {
          const sent = kordocParseOptions(
            toParseOptions({
              ...DEFAULT_IMPORT_OPTIONS,
              preset,
              tables,
              scriptTags: flag,
              flattenLayout: flag,
              memos: flag,
              imagesInFlow: flag,
              images: !flag,
              removeHeaderFooter: flag,
              dedupeRunningHeaders: flag
            })
          ) as Record<string, unknown>;
          assert.ok(!(sent.tableFormat === "gfm" && sent.htmlTables), `${preset}/${tables}: gfm with htmlTables`);
          assert.equal(sent.hancomFallback, false);
          assert.equal(sent.ocr, false);
          for (const key of Object.keys(sent)) {
            assert.ok(ALLOWED_PARSE_OPTION_KEYS.has(key) || key in FORCED_PARSE_OPTIONS, `${preset}: ${key} not whitelisted`);
          }
          for (const key of FORBIDDEN.filter((item) => !(item in FORCED_PARSE_OPTIONS))) {
            assert.ok(!(key in sent), `${preset}: ${key} must never be sent`);
          }
          // HTML tables can only appear without gfm, and then cell links are real links.
          if (sent.tableFormat !== "gfm" && sent.tables !== false) assert.equal(sent.htmlCellLinks, true);
        }
      }
    }
  });

  it("keeps each preset meaningful under the new options", () => {
    const all: ImportOptions = { ...DEFAULT_IMPORT_OPTIONS, flattenLayout: true, scriptTags: true, tables: "pipe" };
    // Text only: plain text carries no script tags.
    const text = toParseOptions({ ...all, preset: "text" });
    assert.equal(text.plain, true);
    assert.equal(text.scriptTags, false);
    assert.equal(text.images, false);
    // Form: structure first, whatever the user chose for ordinary imports.
    const form = toParseOptions({ ...all, preset: "form" });
    assert.equal(form.layoutTables, "keep");
    assert.equal(form.tableFormat, undefined);
    assert.equal(form.htmlCellLinks, true);
    assert.equal(form.keepTrailingEmptyCols, true);
    assert.equal(toParseOptions({ ...all, preset: "form", tables: "html" }).htmlTables, true);
    // Exam: no tables; the user's layout and script choices still apply.
    const exam = toParseOptions({ ...all, preset: "exam" });
    assert.equal(exam.tables, false);
    assert.equal(exam.layoutTables, "visual");
    // Default: exactly the user's choices.
    assert.equal(toParseOptions(all).layoutTables, "visual");
    assert.equal(toParseOptions({ ...all, memos: true }).memos, true);
    assert.equal(toParseOptions({ ...all, imagesInFlow: true }).imagePlacement, "flow");
    assert.equal(toParseOptions(all).imagePlacement, undefined);
  });

  it("keeps the 2.7.x notation for callers that choose none (comparison, form reading)", () => {
    assert.deepEqual({ ...PINNED_PARSE_DEFAULTS }, { layoutTables: "keep", scriptTags: false });
    const pinned = kordocParseOptions({ images: false }) as Record<string, unknown>;
    assert.equal(pinned.layoutTables, "keep");
    assert.equal(pinned.scriptTags, false);
    assert.equal(pinned.tableFormat, undefined);
    // A caller cannot switch a forced value back on.
    const hostile = kordocParseOptions({ ocr: true, hancomFallback: true } as never) as Record<string, unknown>;
    assert.equal(hostile.ocr, false);
    assert.equal(hostile.hancomFallback, false);
  });

  it("migrates stored options: htmlTables true becomes all HTML, everything else gets the new defaults", () => {
    assert.deepEqual(normalizeRememberedImportOptions(undefined), rememberedImportOptions(DEFAULT_IMPORT_OPTIONS));
    assert.equal(normalizeRememberedImportOptions({ htmlTables: true }).tables, "html");
    assert.equal(normalizeRememberedImportOptions({ htmlTables: false }).tables, "pipe");
    assert.equal(normalizeRememberedImportOptions({ htmlTables: true, tables: "mixed" }).tables, "mixed");
    assert.equal(normalizeRememberedImportOptions({ tables: "nonsense" }).tables, "pipe");
    assert.equal(normalizeRememberedImportOptions({ scriptTags: false }).scriptTags, false);
    assert.equal(normalizeRememberedImportOptions({ scriptTags: "yes" }).scriptTags, true);
    assert.ok(!("pages" in normalizeRememberedImportOptions({ pages: "1-3" })));

    // A 2.7.1 data.json has no importAdvanced: it loads with the 3.0.0 defaults.
    const old = normalizeHanmarkSettings({ importPreset: "form" });
    assert.equal(old.importPreset, "form");
    assert.deepEqual(old.importAdvanced, rememberedImportOptions(DEFAULT_IMPORT_OPTIONS));
    const stored = normalizeHanmarkSettings({ importAdvanced: { tables: "mixed", flattenLayout: true, scriptTags: false } });
    assert.equal(stored.importAdvanced.tables, "mixed");
    assert.equal(stored.importAdvanced.flattenLayout, true);
    assert.equal(stored.importAdvanced.scriptTags, false);
  });

  it("opens the import window with what the user chose last time", () => {
    const options = initialImportOptions({
      defaultPreset: () => "exam",
      rememberedOptions: () => ({ tables: "html", scriptTags: false, flattenLayout: true, memos: true })
    });
    assert.equal(options.preset, "exam");
    assert.equal(options.tables, "html");
    assert.equal(options.scriptTags, false);
    assert.equal(options.flattenLayout, true);
    assert.equal(options.memos, true);
    assert.equal(options.pages, "");
    assert.equal(initialImportOptions({ defaultPreset: () => undefined }).tables, "pipe");
  });

  it("writes the same document in the notation the user chose", async () => {
    const hwpx = await markdownToHwpx(MERGED_AND_SIMPLE);
    const pipe = await importMarkdown(hwpx);
    assert.ok(!pipe.includes("<table"), "Obsidian tables: no HTML table");
    assert.match(pipe, /\| 구분 \| 내용 \|/u);

    const mixed = await importMarkdown(hwpx, { tables: "mixed" });
    assert.equal((mixed.match(/<table/gu) ?? []).length, 1, "only the merged table is HTML");
    assert.match(mixed, /colspan="2"/u);
    assert.match(mixed, /rowspan="2"/u);
    assert.match(mixed, /\| 이름 \| 값 \|/u);

    const html = await importMarkdown(hwpx, { tables: "html" });
    assert.equal((html.match(/<table/gu) ?? []).length, 2, "every table is HTML");
    assert.ok(!/^\|/mu.test(html));
  });
});

const NS =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function shape(type: string, text: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="ko-KR"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
  );
}

function slide(shapes: string, attrs = ""): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<p:sld ${NS}${attrs}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    `${shapes}</p:spTree></p:cSld></p:sld>`
  );
}

async function makePptx(slides: string[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      "</Types>"
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
  );
  const ids = slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 10}"/>`).join("");
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS}><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      slides.map((_, index) => `<Relationship Id="rId${index + 10}" Type="${REL}/slide" Target="slides/slide${index + 1}.xml"/>`).join("") +
      "</Relationships>"
  );
  slides.forEach((xml, index) => zip.file(`ppt/slides/slide${index + 1}.xml`, xml));
  return buffer(await zip.generateAsync({ type: "uint8array" }));
}

describe("new import inputs (R-032)", () => {
  it("offers PPTX everywhere importable types are listed and never offers image files", () => {
    assert.ok(IMPORT_EXTENSIONS.includes("pptx"));
    assert.equal(isImportableExtension("PPTX"), true);
    // Image inputs need OCR, which HanMark never runs.
    for (const extension of ["png", "jpg", "jpeg", "webp", "tif", "tiff", "gif", "bmp", "avif", "heic", "pcx"]) {
      assert.equal(isImportableExtension(extension), false, extension);
    }
  });

  it("imports a PowerPoint file slide by slide and reports hidden slides in plain words", async () => {
    const pptx = await makePptx([
      slide(shape("title", "첫 번째 슬라이드") + shape("body", "본문 한 줄")),
      slide(shape("title", "숨긴 슬라이드"), ' show="0"'),
      slide(shape("title", "세 번째 슬라이드"))
    ]);
    const result = await parse(pptx, kordocParseOptions(toParseOptions(DEFAULT_IMPORT_OPTIONS)));
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.fileType, "pptx");
    assert.match(result.markdown, /첫 번째 슬라이드/u);
    assert.match(result.markdown, /본문 한 줄/u);
    assert.match(result.markdown, /세 번째 슬라이드/u);
    assert.ok(!result.markdown.includes("숨긴 슬라이드"));
    const hidden = (result.warnings ?? []).find((warning) => warning.code === "HIDDEN_TEXT_FILTERED");
    assert.ok(hidden, "hidden slides are reported");
    const text = describeImportWarning(hidden);
    assert.ok(text.length > 0);
    assert.ok(!text.includes("HIDDEN_TEXT_FILTERED"), "no raw code in the report");
  });
});
