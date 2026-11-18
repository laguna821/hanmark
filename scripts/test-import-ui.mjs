import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

// The real import window and import report (R-032) in Chromium with styles.css. Only
// Obsidian's host primitives and the conversion itself are replaced: the script checks
// what the window shows, locks, remembers, and hands to the import job. Screenshots land
// in test-artifacts/import-ui (or HANMARK_IMPORT_UI_OUTPUT) for review.
const out = process.env.HANMARK_IMPORT_UI_OUTPUT || "test-artifacts/import-ui";
mkdirSync(out, { recursive: true });

const host = `
const proto = HTMLElement.prototype;
proto.createEl = function(tag, options = {}) {
  const node = this.ownerDocument.createElement(tag);
  if (typeof options === "string") options = { cls: options };
  if (options.text) node.textContent = options.text;
  if (options.cls) node.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
  for (const [key, value] of Object.entries(options.attr || {})) node.setAttribute(key, String(value));
  for (const key of ["type", "value", "href"]) if (options[key] !== undefined) node.setAttribute(key, options[key]);
  this.append(node); return node;
};
proto.createDiv = function(options) { return this.createEl("div", options); };
proto.createSpan = function(options) { return this.createEl("span", options); };
proto.empty = function() { this.replaceChildren(); };
proto.setText = function(text) { this.textContent = text; };
Element.prototype.addClass = function(...values) { this.classList.add(...values); };
Element.prototype.removeClass = function(...values) { this.classList.remove(...values); };
Element.prototype.toggleClass = function(value, on) { this.classList.toggle(value, on); };
Element.prototype.setCssProps = function(props) { for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value); };
export class Modal {
  constructor(app) {
    this.app = app;
    this.modalEl = document.createElement("div"); this.modalEl.className = "modal";
    this.titleEl = this.modalEl.createDiv({ cls: "modal-title" });
    this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
  }
  open() { document.getElementById("stage").append(this.modalEl); this.onOpen?.(); }
  close() { this.onClose?.(); this.modalEl.remove(); }
}
export class Setting {
  constructor(container) {
    this.settingEl = container.createDiv({ cls: "setting-item" });
    const info = this.settingEl.createDiv({ cls: "setting-item-info" });
    this.nameEl = info.createDiv({ cls: "setting-item-name" });
    this.descEl = info.createDiv({ cls: "setting-item-description" });
    this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
  }
  setName(value) { this.nameEl.textContent = value; return this; }
  setDesc(value) { this.descEl.textContent = value; return this; }
  setHeading() { this.settingEl.classList.add("setting-item-heading"); return this; }
  addText(build) {
    const inputEl = this.controlEl.createEl("input", { type: "text" });
    const control = { inputEl, setValue(value) { inputEl.value = value ?? ""; return control; }, setPlaceholder(value) { inputEl.placeholder = value; return control; }, setDisabled(value) { inputEl.disabled = Boolean(value); return control; }, onChange(listener) { inputEl.addEventListener("input", () => listener(inputEl.value)); return control; } };
    build(control); return this;
  }
  addDropdown(build) {
    const selectEl = this.controlEl.createEl("select");
    const control = { selectEl, addOption(value, label) { selectEl.createEl("option", { text: label }).value = value; return control; }, setValue(value) { selectEl.value = value; return control; }, setDisabled(value) { selectEl.disabled = Boolean(value); return control; }, onChange(listener) { selectEl.addEventListener("change", () => listener(selectEl.value)); return control; } };
    build(control); return this;
  }
  addToggle(build) {
    const toggleEl = this.controlEl.createEl("input", { type: "checkbox" });
    const control = { toggleEl, setValue(value) { toggleEl.checked = Boolean(value); return control; }, setDisabled(value) { toggleEl.disabled = Boolean(value); return control; }, onChange(listener) { toggleEl.addEventListener("change", () => listener(toggleEl.checked)); return control; } };
    build(control); return this;
  }
  addButton(build) {
    const buttonEl = this.controlEl.createEl("button", { attr: { type: "button" } });
    const control = { buttonEl, setButtonText(value) { buttonEl.textContent = value; return control; }, setCta() { buttonEl.classList.add("mod-cta"); return control; }, setDisabled(value) { buttonEl.disabled = Boolean(value); return control; }, onClick(listener) { buttonEl.addEventListener("click", listener); return control; } };
    build(control); return this;
  }
}
export class AbstractInputSuggest { constructor(app, input) { this.app = app; this.input = input; } close() {} }
export class TFile {}
export class TFolder {}
export class Notice { constructor(message) { (globalThis.notices ||= []).push(String(message)); } setMessage() {} hide() {} }
export const Platform = { isWin: true, isMacOS: false, isDesktopApp: true };
`;

const fixtures = {
  importRunner: `
    export const IMPORT_EXTENSIONS = ["hwp", "hwpx", "hml", "pdf", "docx", "xlsx", "xls", "pptx"];
    export const LARGE_IMPORT_BYTES = 50 * 1024 * 1024;
    export async function runImportJob(app, job, hooks) {
      hooks.onProgress({ done: 0, total: job.inputs.length, current: { name: job.inputs[0].name } });
      globalThis.calls.jobs.push(JSON.parse(JSON.stringify(job.options)));
      return globalThis.nextResults(job);
    }
    export async function importOne(app, input) { return { ok: true, source: input.name, warnings: [] }; }`,
  kordocImport: `
    export async function chooseImportImageDestination() { return "vault"; }
    export async function moveImportedImagesToCloud() { return { uploaded: 0, warnings: [] }; }`,
  fileGateway: "export async function readSelectedExternalFiles() { return []; }",
  settings: "export function normalizeImportedImageFolder(value) { return String(value ?? '').trim(); }"
};

const bundle = await build({
  stdin: {
    contents: [
      "export { ImportModal } from './src/ui/ImportModal';",
      "export { ImportReportModal } from './src/ui/ImportReportModal';",
      "export * as options from './src/io/importOptions';"
    ].join("\n"),
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "ImportUi",
  plugins: [{
    name: "host-fixture",
    setup(build) {
      build.onResolve({ filter: /^(obsidian|kordoc)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      build.onResolve({ filter: /\/(io\/(importRunner|kordocImport|fileGateway)|legacy-port\/settings)$/ }, (args) => ({
        path: args.path.split("/").pop(),
        namespace: "fixture"
      }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
        contents: args.path === "obsidian" ? host : args.path === "kordoc" ? 'export const VERSION = "4.25.0";' : fixtures[args.path],
        loader: "js"
      }));
    }
  }]
});

const css = readFileSync("styles.css", "utf8");
const browser = await chromium.launch({ executablePath: process.env.HANMARK_BROWSER_EXECUTABLE || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1500 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light">
    <div id="stage" style="width:720px;margin:20px;padding:16px;border:1px solid #ddd;border-radius:10px;background:#fff"></div></body></html>`);
  await page.addStyleTag({ content: css });
  await page.addStyleTag({
    content: "body{--interactive-accent:#7c3aed;--interactive-accent-hover:#8b5cf6;--text-accent:#7c3aed;--text-on-accent:#fff;--background-primary:#fff;--background-secondary:#f3f3f5;--background-modifier-border:#ddd;--background-modifier-hover:#eee;--text-muted:#666;--text-faint:#999;--text-normal:#222;--text-error:#c62828;--font-ui-small:13px;--font-ui-smaller:12px;--font-semibold:600;font-family:'Malgun Gothic',system-ui,sans-serif;font-size:14px;color:#222}" +
      "button,select,input{font:inherit}button{padding:4px 10px;border:1px solid #ccc;border-radius:6px;background:#f7f7f8}select,input[type=text]{padding:4px 8px;border:1px solid #ccc;border-radius:6px;background:#fff}.mod-cta{background:#7c3aed;color:#fff;border-color:#7c3aed}.modal-title{font-size:18px;font-weight:700;margin-bottom:8px}" +
      ".setting-item{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 0;border-top:1px solid #eee}.setting-item-info{flex:1 1 auto;min-width:0}.setting-item-name{font-weight:600}.setting-item-description{color:#666;font-size:12px;line-height:1.45}.setting-item-control{flex:0 0 auto;display:flex;gap:6px}"
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  await page.evaluate(() => {
    globalThis.notices = [];
    globalThis.calls = { jobs: [], remembered: [] };
    globalThis.remembered = undefined;
    globalThis.preset = "default";
    globalThis.nextResults = () => [];
    const app = {
      vault: { getAllLoadedFiles: () => [], getAbstractFileByPath: () => null },
      workspace: { getActiveFile: () => null, getLeaf: () => ({ openFile: async () => {} }) }
    };
    globalThis.openImport = () => {
      globalThis.modal = new ImportUi.ImportModal({
        app,
        gateway: { pickFiles: async () => [] },
        defaultPreset: () => globalThis.preset,
        rememberedOptions: () => globalThis.remembered,
        rememberOptions: async (options) => { globalThis.remembered = options; calls.remembered.push(options); },
        folderFor: () => "가져온 문서",
        confirmEachImport: () => false,
        cloudSettings: () => ({ destination: "vault" })
      }, [{ name: "보도자료.hwpx", bytes: new Uint8Array(1200).buffer }]);
      modal.open();
    };
    openImport();
  });

  const option = (key) => page.locator(`#stage [data-hanmark-import-option="${key}"]`);
  const descOf = (key) => option(key).evaluate((node) => node.closest(".setting-item").querySelector(".setting-item-description").textContent);
  const presetSelect = page.locator("#stage .modal-content > .setting-item select").first();
  const advanced = page.locator("#stage details.hanmark-import-advanced");

  // The default preset no longer claims to keep the original structure.
  assert.match(await page.locator("#stage .modal-content > .setting-item .setting-item-description").first().innerText(), /옵시디언에서 고치기 쉬운 노트/u);
  await advanced.locator("summary").click();

  // Defaults decided on 2026-11-18: Obsidian tables, script tags on, layout tables unwrapped.
  assert.equal(await option("tables").inputValue(), "pipe");
  assert.deepEqual(await option("tables").locator("option").allInnerTexts(), await page.evaluate(() => ["pipe", "mixed", "html"].map((id) => document.querySelector(`[data-hanmark-import-option="tables"] option[value="${id}"]`).textContent)));
  assert.equal(await option("scriptTags").isChecked(), true);
  assert.equal(await option("flattenLayout").isChecked(), true);
  assert.equal(await option("memos").isChecked(), false);
  assert.equal(await option("imagesInFlow").isChecked(), false);
  // Each choice says what it costs on re-export; none mentions saving into the original.
  assert.match(await descOf("tables"), /합쳐진 칸은 풀립니다.*다시 HWPX로 내보내도 칸은 합쳐지지 않습니다/u);
  assert.match(await descOf("flattenLayout"), /다시 HWPX로 내보내도 원래 배치는 되살아나지 않습니다/u);
  assert.match(await descOf("scriptTags"), /다시 내보낼 때도 첨자로 들어갑니다/u);
  assert.doesNotMatch(await page.locator("#stage").innerText(), /원본에 저장|원본 한글 파일에 다시 저장/u);
  assert.deepEqual(await page.locator("#stage .hanmark-import-option-title").allInnerTexts().then((titles) => titles.length), 3, "three option groups");
  await page.locator("#stage").screenshot({ path: `${out}/01-import-window-default.png` });

  // Changing an option redraws the window; the advanced section stays open.
  await option("tables").selectOption("mixed");
  assert.equal(await advanced.evaluate((node) => node.open), true, "the advanced section stays open");
  assert.match(await descOf("tables"), /합쳐진 칸이 그대로 남습니다/u);
  await option("scriptTags").uncheck();
  await option("flattenLayout").check();
  await option("memos").check();
  await option("imagesInFlow").check();

  // Preset locks say why.
  await presetSelect.selectOption("form");
  assert.equal(await advanced.evaluate((node) => node.open), true);
  assert.equal(await option("flattenLayout").isDisabled(), true);
  assert.equal(await option("flattenLayout").isChecked(), false);
  assert.match(await descOf("flattenLayout"), /서식·양식 프리셋은 원본 구조를 항상 그대로 둡니다/u);
  await option("tables").selectOption("pipe");
  assert.match(await descOf("tables"), /서식·양식 프리셋은 칸 구조가 중요해서 합쳐진 표를 HTML로 씁니다/u);
  await page.locator("#stage").screenshot({ path: `${out}/02-import-window-form-preset-locked.png` });
  await presetSelect.selectOption("text");
  assert.equal(await option("scriptTags").isDisabled(), true);
  assert.match(await descOf("scriptTags"), /글만 가져오는 프리셋에서는 첨자 표시를 쓰지 않습니다/u);
  assert.equal(await option("images").isDisabled(), true);
  await presetSelect.selectOption("exam");
  assert.equal(await option("tables").isDisabled(), true);
  await presetSelect.selectOption("default");
  await option("tables").selectOption("mixed");
  assert.equal(await option("flattenLayout").isChecked(), true, "a choice hidden by a preset lock comes back");
  assert.equal(await option("scriptTags").isChecked(), false);

  // Start: the job gets the choices, they are remembered, and the report tells what was done.
  await page.evaluate(() => {
    globalThis.nextResults = (job) => [
      {
        ok: true, source: job.inputs[0].name, notePath: "가져온 문서/보도자료.md", fileType: "hwpx", pageCount: 3, pageMode: "section", tables: 9, images: 6,
        warnings: [
          { code: "HIDDEN_TEXT_FILTERED", text: "숨은 글 2곳은 가져오지 않았습니다." },
          { code: "SKIPPED_IMAGE", page: 2, text: "그림 1개는 지원하지 않는 형식이라 자리 표시만 남겼습니다." }
        ]
      }
    ];
  });
  await page.locator("#stage .hanmark-dialog-actions .mod-cta").click();
  await page.waitForFunction(() => calls.jobs.length === 1 && document.querySelector("#stage .hanmark-import-report"));
  const job = await page.evaluate(() => calls.jobs[0]);
  assert.equal(job.preset, "default");
  assert.equal(job.tables, "mixed");
  assert.equal(job.scriptTags, false);
  assert.equal(job.flattenLayout, true);
  assert.equal(job.memos, true);
  assert.equal(job.imagesInFlow, true);
  const rememberedOnce = await page.evaluate(() => calls.remembered[0]);
  assert.deepEqual(
    { tables: rememberedOnce.tables, scriptTags: rememberedOnce.scriptTags, flattenLayout: rememberedOnce.flattenLayout, memos: rememberedOnce.memos, imagesInFlow: rememberedOnce.imagesInFlow },
    { tables: "mixed", scriptTags: false, flattenLayout: true, memos: true, imagesInFlow: true }
  );
  // The window's choices are translated into the engine's options by the whitelist.
  const parseOptions = await page.evaluate(() => ImportUi.options.toParseOptions(calls.jobs[0]));
  assert.equal(parseOptions.htmlCellLinks, true, "links in HTML table cells stay links");
  assert.equal(parseOptions.layoutTables, "visual");
  assert.equal(parseOptions.scriptTags, false);
  assert.equal(parseOptions.memos, true);
  assert.equal(parseOptions.imagePlacement, "flow");
  assert.equal("tableFormat" in parseOptions, false, "mixed tables are the engine's own default");
  const report = await page.locator("#stage .hanmark-import-report").innerText();
  assert.match(report, /보도자료/u);
  assert.match(report, /숨은 글 2곳은 가져오지 않았습니다/u);
  assert.match(report, /자리 표시만 남겼습니다/u);
  assert.doesNotMatch(report, /HIDDEN_TEXT_FILTERED|SKIPPED_IMAGE/u, "no raw engine code in the report");
  await page.locator("#stage .hanmark-import-report").screenshot({ path: `${out}/03-import-report.png` });
  await page.evaluate(() => document.querySelector("#stage .hanmark-import-report")?.remove());

  // Reopened: the choices come back.
  await page.evaluate(() => openImport());
  await advanced.locator("summary").click();
  assert.equal(await option("tables").inputValue(), "mixed");
  assert.equal(await option("scriptTags").isChecked(), false);
  assert.equal(await option("flattenLayout").isChecked(), true);
  assert.equal(await option("memos").isChecked(), true);
  assert.equal(await option("imagesInFlow").isChecked(), true);

  // A fresh profile starts from the decided defaults and passes the pipe-table option to the engine.
  const fresh = await page.evaluate(() => ImportUi.options.toParseOptions(ImportUi.options.initialImportOptions({ defaultPreset: () => "default" })));
  assert.equal(fresh.tableFormat, "gfm");
  assert.equal(fresh.scriptTags, true);
  assert.equal(fresh.layoutTables, "visual");
  assert.equal("htmlTables" in fresh, false);

  console.log("Import UI: defaults, re-export cost texts, preset locks with reasons, the advanced section staying open, remembered options, the job's options, and the report passed.");
} finally {
  await browser.close();
}
