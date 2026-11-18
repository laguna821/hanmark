import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { markdownToHwpx, parse, type GongmunOptions } from "kordoc";
import {
  ALLOWED_PARSE_OPTION_KEYS,
  FORCED_PARSE_OPTIONS,
  IMPORT_PRESET_IDS,
  kordocParseOptions,
  toParseOptions
} from "../src/io/importOptions";
import { pinGongmunDefaults } from "../src/io/kordocEngine";
import { PATCH_OPTIONS } from "../src/io/patchOptions";

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

async function sectionXml(data: ArrayBuffer): Promise<string> {
  const entry = (await JSZip.loadAsync(data)).file("Contents/section0.xml");
  assert.ok(entry);
  return entry.async("text");
}

describe("Kordoc 4.25.0 forced options and behaviour pins (R-029)", () => {
  it("forces the offline values and the 4.15.7 output on every parse options object", () => {
    assert.deepEqual({ ...FORCED_PARSE_OPTIONS }, {
      hancomFallback: false,
      ocr: false,
      layoutTables: "keep",
      scriptTags: false
    });
    assert.ok(Object.isFrozen(FORCED_PARSE_OPTIONS));
    for (const preset of IMPORT_PRESET_IDS) {
      const whitelisted = toParseOptions(
        { preset, pages: "", images: true, htmlTables: false, removeHeaderFooter: false, dedupeRunningHeaders: false },
        { password: "secret" }
      );
      const sent = kordocParseOptions(whitelisted) as Record<string, unknown>;
      assert.equal(sent.hancomFallback, false, preset);
      assert.equal(sent.ocr, false, preset);
      assert.equal(sent.layoutTables, "keep", preset);
      assert.equal(sent.scriptTags, false, preset);
      for (const key of Object.keys(sent)) {
        assert.ok(
          ALLOWED_PARSE_OPTION_KEYS.has(key) || key in FORCED_PARSE_OPTIONS,
          `${preset}: ${key} is neither whitelisted nor forced`
        );
      }
      for (const forbidden of ["formulaOcr", "filePath", "inlineImages", "imageFormat", "qrCodes", "dropBlankImages"]) {
        assert.ok(!(forbidden in sent), `${preset}: ${forbidden} must never be sent`);
      }
    }
    // A caller cannot switch a forced value back on.
    const hostile = kordocParseOptions({ ocr: true, hancomFallback: true } as never) as Record<string, unknown>;
    assert.equal(hostile.ocr, false);
    assert.equal(hostile.hancomFallback, false);
  });

  it("routes every Kordoc parse() call in src through kordocParseOptions", async () => {
    const calls: string[] = [];
    for (const file of await sourceFiles("src")) {
      const source = await readFile(file, "utf8");
      if (!/import\s*\{[^}]*\bparse\b[^}]*\}\s*from\s*"kordoc"/u.test(source)) continue;
      for (const match of source.matchAll(/(?<![\w.])parse\(([\s\S]*?)\);/gu)) {
        calls.push(file);
        assert.match(match[1], /\bkordocParseOptions\(/u, `${file}: parse() must receive kordocParseOptions(...)`);
      }
    }
    assert.deepEqual(
      calls.map((file) => file.replaceAll("\\", "/")).sort(),
      ["src/io/documentDiff.ts", "src/io/formFill.ts", "src/io/importRunner.ts"]
    );
  });

  it("parses with the forced options without changing a plain document", async () => {
    // No fixture with real superscript runs or a borderless layout table exists yet, so
    // this only proves the forced options are accepted; the pins themselves are checked
    // on the options object above (R-029, open question 3).
    const hwpx = await markdownToHwpx("# 제목\n\n본문입니다.\n\n| 가 | 나 |\n| --- | --- |\n| 1 | 2 |\n");
    const pinned = await parse(hwpx, kordocParseOptions());
    const upstream = await parse(hwpx);
    assert.equal(pinned.success, true);
    assert.equal(upstream.success, true);
    if (pinned.success && upstream.success) {
      assert.equal(pinned.markdown, upstream.markdown);
      assert.doesNotMatch(pinned.markdown, /<sup>|<sub>/u);
    }
  });

  it("pins the official-document defaults Kordoc changed, and lets explicit values win", () => {
    assert.equal(pinGongmunDefaults(undefined), undefined);
    assert.deepEqual(pinGongmunDefaults({ preset: "report" }), { preset: "report", totalRow: "keep" });
    assert.deepEqual(pinGongmunDefaults({ preset: "report", totalRow: "top" }), { preset: "report", totalRow: "top" });
    assert.deepEqual(pinGongmunDefaults({ preset: "gaejosik", cover: false }), {
      preset: "gaejosik",
      cover: false,
      totalRow: "keep",
      bodyTitleBox: false
    });
    assert.deepEqual(pinGongmunDefaults({ preset: "개조식" as GongmunOptions["preset"], cover: false })?.bodyTitleBox, false);
    assert.equal(pinGongmunDefaults({ preset: "gaejosik", cover: false, bodyTitleBox: true })?.bodyTitleBox, true);
    assert.equal(pinGongmunDefaults({ preset: "gaejosik" })?.bodyTitleBox, undefined, "with a cover the title box is unchanged");
    assert.equal(pinGongmunDefaults({ preset: "report", cover: false })?.bodyTitleBox, undefined);
    const input: GongmunOptions = { preset: "plan" };
    pinGongmunDefaults(input);
    assert.deepEqual(input, { preset: "plan" }, "the caller's object is not mutated");
  });

  it("keeps a total row where the note has it", async () => {
    const markdown = "□ 예산\n\n| 구분 | 금액 |\n| --- | --- |\n| 인건비 | 10 |\n| 운영비 | 20 |\n| 합계 | 30 |\n";
    const order = (xml: string): number[] =>
      ["인건비", "운영비", "합계"].map((word) => xml.indexOf(`>${word}<`));
    const pinned = order(await sectionXml(await markdownToHwpx(markdown, { gongmun: pinGongmunDefaults({ preset: "report" }) })));
    const upstream = order(await sectionXml(await markdownToHwpx(markdown, { gongmun: { preset: "report" } })));
    assert.ok(pinned.every((index) => index > 0), "all three rows are present");
    assert.ok(pinned[0] < pinned[1] && pinned[1] < pinned[2], "pinned: the total stays last");
    assert.ok(upstream[2] < upstream[0], "Kordoc 4.25.0 would move the total under the header");
  });

  it("saves back with the 4.15.7 patch behaviour", async () => {
    assert.deepEqual({ ...PATCH_OPTIONS }, { verify: true, structure: false, keepLineseg: true });
    assert.ok(Object.isFrozen(PATCH_OPTIONS));
    const save = await readFile("src/io/kordocSave.ts", "utf8");
    const calls = [...save.matchAll(/await patch\(([^;]*)\);/gu)].map((match) => match[1]);
    assert.deepEqual(calls, ["original, body, PATCH_OPTIONS"]);
  });
});
