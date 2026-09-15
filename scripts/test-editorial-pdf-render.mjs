import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";

let markdownOverride;
let title = "Flow";
let expectedImages = 8;
const sourcePath = process.env.HANMARK_PDF_TEST_MARKDOWN;
const outputDirectory = process.env.HANMARK_PDF_TEST_OUTPUT || "test-artifacts/pdf";
if (sourcePath) {
  const { extractEditableBodyStrict } = await import("../src/io/frontmatter.ts");
  const { prepareSelfContainedHtmlMarkdown } = await import("../src/io/htmlExportService.ts");
  const source = await readFile(sourcePath);
  const prepared = await prepareSelfContainedHtmlMarkdown(extractEditableBodyStrict(source.toString("utf8")), {
    loader: async source => {
      if (!/^https?:\/\//u.test(source)) throw new Error("This private fixture runner accepts HTTP image references only.");
      const response = await fetch(source, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Image response: ${response.status}`);
      return { data: await response.arrayBuffer(), contentType: response.headers.get("content-type") || undefined };
    }
  });
  assert.equal(prepared.failures.length, 0, "All fixture images must load");
  markdownOverride = prepared.markdown;
  title = basename(sourcePath, ".md");
  expectedImages = prepared.embeddedOccurrences;
  console.log("Private fixture", { sha256: createHash("sha256").update(source).digest("hex"), bytes: source.length, images: expectedImages });
}

const bundle = await build({
  stdin: { contents: `export { parseEditorialDocument } from './src/io/editorialDocument'; export { buildEditorialPdfRoot, createEditorialPdfStyles, waitForEditorialPdfAssets } from './src/io/editorialPdf'; export { createPdfMeasurementStyle, PdfMeasurer } from './src/io/editorialPdfMeasure'; export { layoutEditorialPdf, collectEditorialPdfFlow } from './src/io/editorialPdfFlow'; export { pdfTableCellOverflows } from './src/io/editorialPdfTables';`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, format: "iife", globalName: "HanmarkPdfTest", platform: "browser"
});
const browser = await chromium.launch({ executablePath: process.env.HANMARK_BROWSER_EXECUTABLE || undefined, headless: true });
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const fontCss = (await readFile("styles.css", "utf8")).split("/* HANMARK_PRETENDARD_GENERATED_END */")[0];
  await page.addStyleTag({ content: fontCss });
  const result = await page.evaluate(async () => {
    const api = globalThis.HanmarkPdfTest;
    const text = "한글 본문과 English words 링크를 보존하며 줄 경계에서 나눕니다. ".repeat(100);
    const style = document.createElement("style");
    style.textContent = api.createEditorialPdfStyles("Measurement");
    document.head.append(style);
    const root = api.buildEditorialPdfRoot(document, api.parseEditorialDocument(`# Measurement\n\n${text}`, "Measurement"), "Measurement");
    document.body.append(root);
    root.setAttribute("data-pdf-measuring", "true");
    const measuringStyle = api.createPdfMeasurementStyle(style);
    document.head.append(measuringStyle);
    await document.fonts.ready;
    const body = root.querySelector(".hanmark-editorial-pdf-body");
    const paragraph = body.querySelector("p");
    const measurer = new api.PdfMeasurer(body);
    const height = measurer.height(paragraph, 80 * 96 / 25.4);
    const split = measurer.split(paragraph, 80 * 96 / 25.4, 200);
    const preserved = split && split.map(part => part.textContent).join("") === paragraph.textContent;
    const headHeight = split ? measurer.height(split[0], 80 * 96 / 25.4) : 0;
    measurer.dispose();
    root.remove(); style.remove(); measuringStyle.remove();
    return { height, preserved, headHeight, hostVisible: getComputedStyle(document.body).display !== "none" };
  });
  assert.equal(result.preserved, true);
  assert.ok(result.height > 200 && result.headHeight <= 200 && result.headHeight > 50);
  assert.equal(result.hostVisible, true);
  console.log("Measured paragraph fragmentation:", result);
  await mkdir(outputDirectory, { recursive: true });
  for (const mode of sourcePath ? ["single", "two-column-a", "two-column-b"] : ["two-column-a", "two-column-b"]) {
   for (const tableWidth of mode === "single" ? ["auto"] : (process.env.HANMARK_PDF_TEST_TABLE_WIDTH ? [process.env.HANMARK_PDF_TEST_TABLE_WIDTH] : ["auto", "column", "full"])) {
   for (const sectionPageBreaks of [false, true]) {
    const result = await page.evaluate(async ({ mode, sectionPageBreaks, tableWidth, markdownOverride, title }) => {
      const api = globalThis.HanmarkPdfTest;
      const canvas = document.createElement("canvas");
      canvas.width = 1000; canvas.height = 700;
      const context = canvas.getContext("2d");
      context.fillStyle = "#006b73"; context.fillRect(0, 0, 1000, 700);
      context.fillStyle = "#ffffff"; context.font = "80px sans-serif"; context.fillText("Figure 1", 100, 250);
      const image = canvas.toDataURL();
      canvas.width = 32; canvas.height = 32;
      context.fillStyle = "#b40020"; context.fillRect(0, 0, 32, 32);
      const iconImage = canvas.toDataURL();
      canvas.width = 100; canvas.height = 1800;
      context.fillStyle = "#c17822"; context.fillRect(0, 0, 100, 1800);
      const tallImage = canvas.toDataURL();
      const paragraphs = Array.from({ length: 42 }, (_, i) => `P${i}BEGIN ` + "한글 본문과 English words **강조** [링크](https://example.com) 읽는 순서를 확인합니다. ".repeat(8) + ` P${i}END`);
      paragraphs.splice(3, 0, `![Figure 1](${image})`);
      paragraphs.splice(14, 0, `![Figure 2](${image})\n![Figure 3](${image})`);
      paragraphs.splice(29, 0, "## 다음 절\n## 연속 제목\n\n### 작은 제목");
      paragraphs.push(`3. Ordered item\n\n   ![List figure](${image})\n\n   Continued item\n4. Next item\n\n> Quote before\n>\n> ![Quote figure](${image})\n>\n> Quote after`);
      paragraphs.push(`Inline ![Inline icon](${iconImage}) remains in this paragraph.`);
      paragraphs.push(`| Image cell | Value |\n|---|---|\n| ![Cell](${iconImage}) | Kept inside the table |`);
      paragraphs.push("```text\n" + Array.from({ length: 100 }, (_, i) => `CODE${i} ` + "long code line ".repeat(10)).join("\n") + "\n```");
      paragraphs.push(`![Tall](${tallImage})`);
      paragraphs.push("| Long cell | Value |\n|---|---|\n| " + "Long cell 내용 ".repeat(500) + " | tail |");
      paragraphs.push("| Narrow-column row | Value |\n|---|---|\n| " + "Width aware 긴 셀 ".repeat(140) + " | end |");
      paragraphs.push("## Small numeric table\n\n| Type | Count | Total |\n|---|---|---|\n| A | 3 | 16 |\n| B | 51 | 384 |\n| Sum | 54 | 400 |");
      paragraphs.push("## Dense explanation\n\n| Situation | Treatment | Meaning |\n|---|---|---|\n" +
        Array.from({ length: 9 }, (_, i) => "| " + ["상황별 판단을 유지하며 텍스트가 겹치지 않아야 합니다. ", "열 너비를 결정한 다음 실제 줄바꿈을 측정합니다. ", "앞뒤 셀과 본문에 글자가 침범하지 않아야 합니다. "].map((text, c) => `T${i}C${c} ` + text.repeat(4)).join(" | ") + " |").join("\n"));
      paragraphs.push("## Long appendix\n\n| 고유 식별 번호 | 교수 소속 대학과 학과 | 담당 전공과 세부 연구 분야 | 최종 발송 처리 결과 | 발송된 전체 수신자 수 | 중복된 수신자 제외 건수 |\n|---|---|---|---|---|---|\n" +
        Array.from({ length: 70 }, (_, i) => `| R${i} | 인문사회과학대학 | 미디어커뮤니케이션학과 | 처리 완료 | ${i} | 0 |`).join("\n"));
      paragraphs.push("> [!note]\n> Nested context\n>\n> | Quote table | Value |\n> |---|---|\n> | Original label | " + "인용문 안의 표 내용 ".repeat(35) + " |");
      paragraphs.push("1. List context\n\n   | List table | Value |\n   |---|---|\n   | Original item | " + "목록 안의 표 내용 ".repeat(35) + " |");
      paragraphs.push("| Links and breaks | Empty |\n|---|---|\n| **Bold** [link](https://example.com) https://example.com/" + "longpath".repeat(30) + "<br>Second line | |\n| End | |");
      const style = document.createElement("style"); style.className = "hanmark-editorial-pdf-style";
      style.textContent = api.createEditorialPdfStyles(title); document.head.append(style);
      const layout = { mode, columnGapMm: 10, sectionPageBreaks, tableWidth };
      const root = api.buildEditorialPdfRoot(document, api.parseEditorialDocument(markdownOverride || "# Flow\n\n## 첫 절\n\n" + paragraphs.join("\n\n"), title), title, undefined, layout);
      document.body.append(root); document.body.classList.add("hanmark-editorial-pdf-active");
      await document.fonts.ready;
      await Promise.all(Array.from(root.querySelectorAll("img"), img => img.decode()));
      await api.waitForEditorialPdfAssets(document, root, 20000, style);
      const body = root.querySelector(".hanmark-editorial-pdf-body");
      const expected = body.textContent;
      const sourceUnits = mode === "single" ? [] : api.collectEditorialPdfFlow(body).filter(unit => unit.kind !== "boundary");
      const expectedUnits = Object.fromEntries(sourceUnits.map(unit => [unit.node.dataset.pdfSourceId, unit.node.textContent.replace(/\s/gu, "")]));
      const expectedCells = {};
      Array.from(body.querySelectorAll("table")).forEach((table, index) => {
        Array.from(table.rows).forEach((row, r) => Array.from(row.cells).forEach((cell, c) => {
          expectedCells[`t${index + 1}:r${r}:c${c}`] = cell.textContent.replace(/\s/gu, "");
        }));
      });
      const children = Array.from(body.children);
      const level = node => /^H[1-6]$/u.test(node?.tagName || "") ? Number(node.tagName[1]) : 0;
      const highest = Math.min(...children.map(level).filter(Boolean));
      const sectionStarts = [];
      children.forEach((node, index) => {
        if (level(node)) node.dataset.testHeading = String(index);
        if (level(node) === highest && !level(children[index - 1])) sectionStarts.push(index);
      });
      await api.layoutEditorialPdf(root, style, layout);
      if (sectionPageBreaks && mode !== "single") {
        const pageNumbers = sectionStarts.map(index => body.querySelector(`[data-test-heading="${index}"]`)?.closest(".hanmark-pdf-page")?.dataset.pdfPage);
        if (pageNumbers.some(value => !value) || new Set(pageNumbers).size !== pageNumbers.length) throw new Error("Section groups must open distinct pages");
      }
      const figureOrder = Array.from(body.querySelectorAll("figure"), node => Number(node.dataset.pdfSourceId));
      if (figureOrder.some((value, i) => i > 0 && figureOrder[i - 1] >= value)) throw new Error("Figure order changed");
      for (const figure of body.querySelectorAll("figure")) {
        const anchor = body.querySelector(`[data-pdf-anchor="${figure.dataset.pdfSourceId}"]`);
        const figurePage = Number(figure.closest(".hanmark-pdf-page")?.dataset.pdfPage);
        const anchorPage = Number(anchor?.closest(".hanmark-pdf-page")?.dataset.pdfPage);
        if (!anchorPage || Math.abs(figurePage - anchorPage) > 1) throw new Error("Figure moved more than one page from its anchor");
      }
      if (!markdownOverride) {
        if (body.querySelector("td img")?.classList.contains("hanmark-pdf-inline-icon")) throw new Error("A table-cell image changed into an inline icon");
        if (!body.querySelector('img[alt="Inline icon"]')?.classList.contains("hanmark-pdf-inline-icon")) throw new Error("Inline icon context was lost");
      }
      const output = body.cloneNode(true);
      output.querySelectorAll("[data-pdf-repeated-header]").forEach(node => node.remove());
      const actualCells = {};
      for (const cell of output.querySelectorAll("[data-pdf-cell-id]")) {
        const id = cell.dataset.pdfCellId;
        actualCells[id] = (actualCells[id] || "") + cell.textContent.replace(/\s/gu, "");
      }
      const actualUnits = {};
      const cellOrder = {};
      for (const cell of output.querySelectorAll("[data-pdf-cell-id]")) {
        const id = cell.dataset.pdfCellId;
        const tableId = id.split(":")[0];
        const order = cellOrder[tableId] ||= [];
        if (order.at(-1) !== id) order.push(id);
      }
      for (const [id, order] of Object.entries(cellOrder)) {
        if (JSON.stringify(order) !== JSON.stringify(Object.keys(expectedCells).filter(key => key.startsWith(id + ":")))) throw new Error("Table row/cell order changed: " + id);
      }
      const tablePages = {};
      for (const node of body.querySelectorAll("[data-pdf-table-width]")) {
        const pages = tablePages[node.dataset.pdfTableId] ||= [];
        const number = Number(node.closest(".hanmark-pdf-page").dataset.pdfPage);
        if (pages.at(-1) !== number) pages.push(number);
      }
      for (const pages of Object.values(tablePages)) {
        if (pages.some((number, i) => i > 0 && number !== pages[i - 1] + 1)) throw new Error("Table continuations are not consecutive");
      }
      for (const table of body.querySelectorAll(".hanmark-pdf-wide-table")) {
        const anchor = body.querySelector(`[data-pdf-anchor="${table.dataset.pdfSourceId}"]`);
        const first = body.querySelector(`.hanmark-pdf-wide-table[data-pdf-source-id="${table.dataset.pdfSourceId}"]`);
        const anchorPage = Number(anchor?.closest(".hanmark-pdf-page")?.dataset.pdfPage);
        const firstPage = Number(first.closest(".hanmark-pdf-page").dataset.pdfPage);
        if (!anchorPage || Math.abs(firstPage - anchorPage) > 1) throw new Error("Table starts too far from its anchor");
      }
      const actualOrder = [];
      for (const node of output.querySelectorAll("[data-pdf-source-id]")) {
        if (node.parentElement?.closest("[data-pdf-source-id]")) continue;
        const id = node.dataset.pdfSourceId;
        actualUnits[id] = (actualUnits[id] || "") + node.textContent.replace(/\s/gu, "");
        if (sourceUnits.find(unit => unit.node.dataset.pdfSourceId === id)?.kind === "text" && actualOrder[actualOrder.length - 1] !== id) actualOrder.push(id);
      }
      return { expected, actual: output.textContent, expectedCells, actualCells, expectedUnits, actualUnits,
        expectedOrder: sourceUnits.filter(unit => unit.kind === "text").map(unit => unit.node.dataset.pdfSourceId), actualOrder,
        tableChoices: Array.from(body.querySelectorAll("[data-pdf-table-width]"), node => ({ id: node.dataset.pdfTableId, width: node.dataset.pdfTableWidth })),
        pages: body.querySelectorAll(".hanmark-pdf-page").length, figures: body.querySelectorAll("img").length };
    }, { mode, sectionPageBreaks, tableWidth, markdownOverride, title });
    if (mode === "single") assert.equal(result.actual.replace(/\s/gu, ""), result.expected.replace(/\s/gu, ""));
    else {
      assert.deepEqual(result.actualUnits, result.expectedUnits, "All source blocks survive; floated tables may change position");
      assert.deepEqual(result.actualOrder, result.expectedOrder, "Body blocks stay in source order");
    }
    assert.equal(result.figures, expectedImages);
    if (mode !== "single") assert.deepEqual(result.actualCells, result.expectedCells, "Every table cell survives fragmentation exactly once");
    await page.emulateMedia({ media: "print" });
    if (mode !== "single") {
      const overflow = await page.evaluate(() => HanmarkPdfTest.pdfTableCellOverflows(document.querySelector(".hanmark-editorial-pdf-body")));
      assert.deepEqual(overflow, [], "Cell text and images stay within their own cells");
      const changedWidths = await page.evaluate(() => {
        const widths = new Map(); const failures = [];
        for (const table of document.querySelectorAll("table[data-pdf-table-id]")) {
          const value = Array.from(table.rows[0]?.cells || [], cell => cell.getBoundingClientRect().width);
          const prior = widths.get(table.dataset.pdfTableId);
          if (prior && prior.some((width, index) => Math.abs(width - value[index]) > 0.5)) failures.push(table.dataset.pdfTableId);
          widths.set(table.dataset.pdfTableId, value);
        }
        return failures;
      });
      assert.deepEqual(changedWidths, [], "All fragments of a table use identical column widths");
      if (!sourcePath && tableWidth === "auto") {
        const choices = Object.fromEntries(result.tableChoices.map(table => [table.id, table.width]));
        assert.equal(choices.t4, "column", "Small numeric tables stay in one column");
        assert.equal(choices.t5, "full", "Dense explanation tables expand");
        assert.equal(choices.t6, "full", "The six-column appendix expands");
      }
    }
    const failures = await page.evaluate(() => Array.from(document.querySelectorAll(".hanmark-pdf-page"), page => {
      const bounds = page.getBoundingClientRect();
      return Array.from(page.querySelectorAll(".hanmark-pdf-unit, figure, .hanmark-pdf-wide-table"), item => {
        const r = item.getBoundingClientRect();
        const okay = r.left >= bounds.left - 1 && r.right <= bounds.right + 1 && r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1;
        const measurement = Number(item.dataset.pdfMeasuredHeight);
        return okay && (!measurement || Math.abs(measurement-r.height) < 1) ? null : { page: page.dataset.pdfPage, type: item.firstElementChild?.tagName, source: item.firstElementChild?.dataset.pdfSourceId, x: r.left-bounds.left, y:r.top-bounds.top, width:r.width, height:r.height, measured:measurement, available:bounds.height };
      }).filter(Boolean);
    }).flat());
    const overlaps = await page.evaluate(() => Array.from(document.querySelectorAll(".hanmark-pdf-page"), page => {
      const figures = Array.from(page.querySelectorAll("figure, .hanmark-pdf-wide-table"), node => node.getBoundingClientRect());
      const intersects = (a, b) => Math.min(a.right, b.right)-Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom)-Math.max(a.top, b.top) > 1;
      return figures.some((a, i) => figures.slice(i + 1).some(b => intersects(a, b))) || Array.from(page.querySelectorAll(".hanmark-pdf-unit"), node => node.getBoundingClientRect()).some(text => figures.some(figure => intersects(text, figure)));
    }).some(Boolean));
    assert.equal(overlaps, false, "Tables, figures, and body text must not overlap");
    const printedCells = await page.evaluate(() => Array.from(document.querySelectorAll(".hanmark-pdf-page [data-pdf-cell-id]"), cell => {
      const page = cell.closest(".hanmark-pdf-page");
      const bounds = page.getBoundingClientRect(); const box = cell.getBoundingClientRect();
      return { id: cell.dataset.pdfCellId, page: Number(page.dataset.pdfPage) + 1, text: cell.textContent.replace(/\s/gu, ""),
        left: (box.left - bounds.left) * 0.75 + 20 * 72 / 25.4, right: (box.right - bounds.left) * 0.75 + 20 * 72 / 25.4,
        top: (box.top - bounds.top) * 0.75 + 22 * 72 / 25.4, bottom: (box.bottom - bounds.top) * 0.75 + 22 * 72 / 25.4 };
    }));
    const bytes = await page.pdf({ path: join(outputDirectory, `${sourcePath ? "private-" : ""}${mode}-${tableWidth}${sectionPageBreaks ? "-sections" : ""}.pdf`), printBackground: true, preferCSSPageSize: true });
    const pdf = await getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false }).promise;
    const physicalPages = pdf.numPages;
    try {
      if (mode !== "single") assert.equal(physicalPages, result.pages + 1, "Each wrapper prints once, plus one cover");
      const pdfItems = new Map();
      for (const cell of printedCells) {
        if (!pdfItems.has(cell.page)) {
          const pdfPage = await pdf.getPage(cell.page);
          const height = pdfPage.getViewport({ scale: 1 }).height;
          const content = await pdfPage.getTextContent();
          pdfItems.set(cell.page, content.items.filter(item => item.str?.trim()).map(item => ({ text: item.str,
            x: item.transform[4] + item.width / 2, y: height - item.transform[5] })));
        }
        const actual = pdfItems.get(cell.page).filter(item => item.x >= cell.left - 0.8 && item.x <= cell.right + 0.8 && item.y >= cell.top - 0.8 && item.y <= cell.bottom + 0.8)
          .map(item => item.text).join("").replace(/\s/gu, "");
        assert.equal(actual, cell.text, `Printed cell ${cell.id}, page ${cell.page} preserves its own text`);
      }
      if (!sourcePath) {
        let text = "";
        for (let i = 2; i <= physicalPages; i++) {
          const content = await (await pdf.getPage(i)).getTextContent();
          text += content.items.map(item => item.str || "").join("");
        }
        assert.deepEqual(text.match(/P\d+(?:BEGIN|END)/gu), Array.from({ length: 42 }, (_, i) => [`P${i}BEGIN`, `P${i}END`]).flat());
        assert.deepEqual(text.match(/CODE\d+/gu), Array.from({ length: 100 }, (_, i) => `CODE${i}`));
      }
    } finally { await pdf.destroy(); }
    if (failures.length) console.log("Geometry failures", failures);
    const geometry = failures.length === 0;
    assert.equal(geometry, true, `${mode}: content stays inside page bounds`);
    console.log(mode, { tableWidth, sectionPageBreaks, pages: physicalPages, figures: result.figures, textPreserved: true, geometry, tables: result.tableChoices });
    await page.evaluate(() => { document.querySelectorAll(".hanmark-editorial-pdf-root, .hanmark-editorial-pdf-style").forEach(node => node.remove()); });
    await page.emulateMedia({ media: "screen" });
   }
   }
  }
} finally { await browser.close(); }
