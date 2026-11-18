// Renders the built-in DOCX of the fixture notes with docx-preview (the library the
// DOCX preview pane uses) in a real browser and checks what a reader would see.
// Run: node --import tsx scripts/test-docx-writer.mjs
// HANMARK_BROWSER_EXECUTABLE selects the browser; HANMARK_DOCX_TEST_OUTPUT keeps screenshots.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const { writeDocx } = await import("../src/io/docxWriter.ts");
const { createDefaultWordTemplate } = await import("../src/legacy-port/defaultWordTemplate.ts");
const notes = await import("../tests/fixtures/docxNotes.ts");

const outputDirectory = process.env.HANMARK_DOCX_TEST_OUTPUT || "test-artifacts/docx";
await mkdir(outputDirectory, { recursive: true });

const bundle = await build({
  stdin: { contents: "export { renderAsync } from 'docx-preview';", resolveDir: process.cwd(), loader: "js" },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "DocxPreview",
  platform: "browser"
});

const cases = [
  { name: "korean-report", markdown: notes.KOREAN_REPORT_NOTE, tables: 1, images: 2, footnotes: 2, headings: 5 },
  { name: "english-paper", markdown: notes.ENGLISH_PAPER_NOTE, tables: 1, images: 0, footnotes: 1, headings: 3 },
  { name: "plain-memo", markdown: notes.PLAIN_MEMO_NOTE, tables: 0, images: 0, footnotes: 0, headings: 1 }
];

const browser = await chromium.launch({
  executablePath: process.env.HANMARK_BROWSER_EXECUTABLE || undefined,
  headless: true
});
try {
  for (const item of cases) {
    const written = await writeDocx(item.markdown, { template: createDefaultWordTemplate(), title: item.name });
    const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.setContent('<!doctype html><html><body style="margin:0;background:#888"><div id="host"></div></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const seen = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const host = document.getElementById("host");
      await globalThis.DocxPreview.renderAsync(bytes, host, undefined, {
        inWrapper: true,
        ignoreLastRenderedPageBreak: true,
        renderFootnotes: true,
        experimental: false
      });
      await Promise.all(Array.from(host.querySelectorAll("img"), (image) => image.decode().catch(() => undefined)));
      const text = host.textContent ?? "";
      return {
        pages: host.querySelectorAll("section.docx").length,
        tables: host.querySelectorAll("table").length,
        headerCells: host.querySelectorAll("table tr:first-child td").length,
        images: Array.from(host.querySelectorAll("img"), (image) => ({ width: image.naturalWidth, shown: image.getBoundingClientRect().width })),
        links: host.querySelectorAll("a[href^='http']").length,
        footnoteMarks: host.querySelectorAll("sup").length,
        text
      };
    }, Buffer.from(written.bytes).toString("base64"));
    assert.deepEqual(errors, [], `${item.name}: docx-preview raised no page error`);
    assert.ok(seen.pages >= 1, `${item.name}: at least one page`);
    assert.equal(seen.tables, item.tables, `${item.name}: tables`);
    assert.equal(seen.images.length, item.images, `${item.name}: images`);
    for (const image of seen.images) {
      assert.ok(image.width > 0, `${item.name}: image decoded`);
      assert.ok(image.shown > 0 && image.shown <= 800, `${item.name}: image fits the text width`);
    }
    if (item.footnotes) assert.ok(seen.footnoteMarks >= item.footnotes, `${item.name}: footnote marks`);
    const firstLine = item.markdown.split("\n").find((line) => line.trim() && !line.startsWith("#")) ?? "";
    const probe = firstLine.replace(/[*_~=`[\]^<>$]|\(.*?\)|!\[.*?\]/g, "").trim().slice(0, 8);
    assert.ok(probe && seen.text.includes(probe), `${item.name}: body text is shown (${probe})`);
    const shot = join(outputDirectory, `${item.name}.preview.png`);
    await page.screenshot({ path: shot, fullPage: false });
    await writeFile(join(outputDirectory, `${item.name}.docx`), written.bytes);
    console.log(`${item.name}: pages=${seen.pages} tables=${seen.tables} images=${seen.images.length} links=${seen.links} sup=${seen.footnoteMarks} -> ${shot}`);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log("Built-in DOCX preview render check passed.");
