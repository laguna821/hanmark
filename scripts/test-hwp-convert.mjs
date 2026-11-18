import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename } from "node:path";
import { parse, renderHwpxToSvg, validateHwpx } from "kordoc";

// End-to-end check of HWP to HWPX conversion on real documents (R-034). The documents
// are read from the paths given in HANMARK_HWP_TEST_FILES (separated by "|") and are
// never copied into the repository; only numbers are printed. Run with:
//   node --import tsx scripts/test-hwp-convert.mjs
const { convertHwpToHwpx } = await import("../src/io/hwpConvert.ts");
const { readFormFields } = await import("../src/io/formFill.ts");
const { kordocParseOptions } = await import("../src/io/importOptions.ts");

const files = (process.env.HANMARK_HWP_TEST_FILES || "tests/fixtures/hwp5/textbox-nested.hwp").split("|").filter(Boolean);
const out = process.env.HANMARK_HWP_TEST_OUTPUT;
if (out) await mkdir(out, { recursive: true });
const password = process.env.HANMARK_HWP_TEST_PASSWORD || undefined;

const buffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
// Words only: pictures (a BMP comes back as PNG) and the readers' own marks aside.
const letters = (text) => text.replace(/!\[[^\]]*\]\([^)]*\)/gu, "").replace(/<\/?[a-z][^>]*>/giu, "").replace(/[^\p{L}\p{N}]/gu, "");
const grids = (blocks) => blocks.filter((block) => block.type === "table").map((block) => `${block.table.rows}x${block.table.cols}`);
const read = async (data, extra = {}) => {
  const parsed = await parse(data, kordocParseOptions({ layoutTables: "keep", ...extra }));
  assert.equal(parsed.success, true, parsed.error);
  return parsed;
};

const report = [];
for (const file of files) {
  const source = new Uint8Array(await readFile(file));
  const started = Date.now();
  const first = await convertHwpToHwpx(source, password);
  const milliseconds = Date.now() - started;
  const second = await convertHwpToHwpx(source, password);
  const sameBytes = Buffer.compare(Buffer.from(first.data), Buffer.from(second.data)) === 0;
  assert.equal(sameBytes, true, "the same document converts to the same bytes");
  const validation = await validateHwpx(first.data.slice(0));
  assert.equal(validation.ok, true);
  const before = await read(buffer(source), password ? { password } : {});
  const after = await read(first.data.slice(0));
  const sourceLetters = letters(before.markdown);
  const resultLetters = letters(after.markdown);
  const render = await renderHwpxToSvg(first.data.slice(0), { reflow: true });
  const fields = first.mode === "preserve" ? await readFormFields(source) : [];
  const row = {
    file: basename(file).replace(/[^\x20-\x7e]+/gu, "*"),
    sourceBytes: source.length,
    hwpxBytes: first.data.byteLength,
    mode: first.mode,
    milliseconds,
    sameBytesTwice: sameBytes,
    valid: validation.ok,
    letters: [sourceLetters.length, resultLetters.length],
    lettersEqual: sourceLetters === resultLetters,
    tables: [grids(before.blocks).length, grids(after.blocks).length],
    gridsEqual: grids(before.blocks).join() === grids(after.blocks).join(),
    images: [(before.images ?? []).length, (after.images ?? []).length],
    renderedPages: render.pageCount,
    formFields: fields.length,
    notes: first.notes.length
  };
  if (!row.lettersEqual) {
    let at = 0;
    while (at < sourceLetters.length && sourceLetters[at] === resultLetters[at]) at += 1;
    console.log("first difference at", at, "of", sourceLetters.length, "(text not shown)");
    row.firstDifference = at;
  }
  assert.equal(row.lettersEqual, true, "same words in the same order");
  assert.equal(row.gridsEqual, true, "same table grids");
  assert.equal(row.images[0], row.images[1], "same number of pictures");
  report.push(row);
  if (out) await writeFile(`${out}/${report.length}.hwpx`, Buffer.from(first.data));
}
console.log(JSON.stringify(report, null, 1));
console.log(`HWP conversion: ${report.length} document(s) converted, validated, re-read and rendered.`);
