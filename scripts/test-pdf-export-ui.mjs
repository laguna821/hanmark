import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

// Only the host UI primitives are replaced; the export modal is the real source.
const host = `
HTMLElement.prototype.createEl = function(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.text) node.textContent = options.text;
  if (options.cls) node.className = options.cls;
  for (const [key, value] of Object.entries(options.attr || {})) node.setAttribute(key, value);
  for (const key of ['type','value','href']) if (options[key]) node.setAttribute(key, options[key]);
  this.append(node); return node;
};
HTMLElement.prototype.createDiv = function(options) { return this.createEl('div', options); };
HTMLElement.prototype.createSpan = function(options) { return this.createEl('span', options); };
HTMLElement.prototype.empty = function() { this.replaceChildren(); };
Element.prototype.addClass = function(...values) { this.classList.add(...values); };
Element.prototype.removeClass = function(...values) { this.classList.remove(...values); };
globalThis.createSpan = options => document.createElement('div').createSpan(options);
globalThis.createDiv = options => document.createElement('div').createDiv(options);
export class Modal {
  constructor(app) { this.app = app; this.modalEl = document.createElement('div'); this.contentEl = this.modalEl.createDiv(); }
  open() { document.body.append(this.modalEl); this.onOpen?.(); }
  close() { this.onClose?.(); this.modalEl.remove(); }
}
export class Notice { constructor(message) { globalThis.notices.push(message); } }
`;
const bundle = await build({
  stdin: { contents: "export { HanmarkExportModal } from './src/ui/HanmarkExportModal';", resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, format: "iife", globalName: "PdfUi",
  plugins: [{ name: "host-fixture", setup(build) {
    build.onResolve({ filter: /^(obsidian|kordoc)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "obsidian" ? host : 'export const VERSION = "4.2.5";' }));
  } }]
});
const browser = await chromium.launch({ executablePath: process.env.HANMARK_BROWSER_EXECUTABLE || undefined, headless: true });
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    globalThis.notices = [];
    globalThis.calls = { exports: [], saves: 0, activation: [], nativeClosed: false };
    const modal = new PdfUi.HanmarkExportModal({}, {
      activeTemplateId: () => "default", templateChoices: () => [], activeTemplateSummary: () => "",
      selectTemplate: async () => {}, exportKordoc: async () => {}, runOther: async () => {}, openPreview: async () => {},
      exportPdf: async (layout, nativePrint) => {
        calls.exports.push({ layout, nativePrint });
        if (nativePrint) { calls.nativeClosed = !modal.modalEl.isConnected; return { format: "pdf", status: "delegated", delivery: "print" }; }
        return { format: "pdf", status: "ready", fileName: "sample.pdf", bytes: new Uint8Array([1,2,3]) };
      },
      savePdf: async prepared => {
        calls.saves++; calls.activation.push(navigator.userActivation.isActive);
        if (prepared.bytes.length !== 3) throw new Error("Prepared bytes were lost");
        return { format: "pdf", status: calls.saves === 1 ? "cancelled" : "delegated", delivery: "download", fileName: prepared.fileName };
      }
    }, "pdf");
    modal.open();
  });
  await page.locator("#hanmark-pdf-layout").selectOption("two-column-a");
  await page.locator("#hanmark-pdf-gap").selectOption("12");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "PDF로 저장", exact: true }).click();
  await page.getByRole("button", { name: "파일로 저장", exact: true }).click();
  await page.getByRole("button", { name: "파일로 저장", exact: true }).click();
  assert.match(await page.locator(".hanmark-export-result").innerText(), /다운로드를 요청/u);
  const calls = await page.evaluate(() => globalThis.calls);
  assert.equal(calls.exports.length, 1, "A cancelled save reuses the generated PDF");
  assert.deepEqual(calls.activation, [true, true], "The picker runs within a fresh user gesture");
  assert.deepEqual(calls.exports[0].layout, { mode: "two-column-a", columnGapMm: 12, sectionPageBreaks: true });
  await page.getByRole("button", { name: "같은 형식 다시 내보내기", exact: true }).click();
  await page.getByRole("button", { name: "프린터로 인쇄", exact: true }).click();
  assert.equal(await page.evaluate(() => globalThis.calls.nativeClosed), true);
  assert.deepEqual(await page.evaluate(() => globalThis.notices), []);
  console.log("PDF UI: layout snapshot, save cancellation/retry, user activation, download result and native print focus passed.");
} finally { await browser.close(); }
