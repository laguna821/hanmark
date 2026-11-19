import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

// The real export window, the real HWPX preview toolbar, and the real frame and look
// picker (R-030) in Chromium with styles.css. Only Obsidian's host primitives, the
// preview's render call, and Kordoc are replaced; Kordoc's agency list, sample sizes,
// and preset aliases are read from the installed engine first, so the chooser shows
// the engine's 52 agencies. Screenshots land in test-artifacts/gongmun-form-ui (or
// HANMARK_FORM_UI_OUTPUT) for review.
const out = process.env.HANMARK_FORM_UI_OUTPUT || "test-artifacts/gongmun-form-ui";
mkdirSync(out, { recursive: true });
mkdirSync("test-artifacts/gongmun-form-ui", { recursive: true });

writeFileSync(
  "test-artifacts/gongmun-form-ui/engine-fixture.ts",
  `import { writeFileSync } from "node:fs";
import { AGENCY_COMMON_NAME, agencyNames, agencyStyle, PRESET_ALIAS, VERSION } from "kordoc";
const styles: Record<string, unknown> = {};
for (const name of agencyNames()) styles[name] = agencyStyle(name);
writeFileSync(process.argv[2], JSON.stringify({ common: AGENCY_COMMON_NAME, names: agencyNames(), styles, alias: PRESET_ALIAS, version: VERSION }));
`
);
execFileSync(process.execPath, ["--import", "tsx", "test-artifacts/gongmun-form-ui/engine-fixture.ts", "test-artifacts/gongmun-form-ui/engine.json"], { stdio: "inherit" });
const engine = JSON.parse(readFileSync("test-artifacts/gongmun-form-ui/engine.json", "utf8"));
assert.equal(engine.names.filter((name) => name !== engine.common).length, 52, "Kordoc lists 52 central agencies");

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
Object.defineProperty(Node.prototype, "doc", { get() { return this.ownerDocument || this; } });
Object.defineProperty(Node.prototype, "win", { get() { return (this.ownerDocument || this).defaultView; } });
globalThis.createDiv = (options) => document.createElement("div").createDiv(options);
globalThis.createSpan = (options) => document.createElement("div").createSpan(options);
export function setIcon() {}
export class Modal {
  constructor(app) {
    this.app = app;
    this.modalEl = document.createElement("div"); this.modalEl.className = "modal";
    this.titleEl = this.modalEl.createDiv({ cls: "modal-title" });
    this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
  }
  open() { (document.getElementById("stage") || document.body).append(this.modalEl); this.onOpen?.(); }
  close() { this.onClose?.(); this.modalEl.remove(); }
}
export class ItemView {
  constructor(leaf) {
    this.leaf = leaf; this.app = leaf.app;
    this.containerEl = document.createElement("div");
    this.containerEl.className = "workspace-leaf-content";
    this.containerEl.createDiv({ cls: "view-header" });
    this.contentEl = this.containerEl.createDiv({ cls: "view-content" });
  }
  registerEvent() {}
  registerDomEvent(target, type, callback, options) { target.addEventListener(type, callback, options); }
  register() {}
  getState() { return {}; }
  async setState() {}
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
    const control = { inputEl, setValue(value) { inputEl.value = value ?? ""; return control; }, setPlaceholder(value) { inputEl.placeholder = value; return control; }, onChange(listener) { inputEl.addEventListener("input", () => listener(inputEl.value)); return control; } };
    build(control); return this;
  }
  addDropdown(build) {
    const selectEl = this.controlEl.createEl("select");
    const control = { selectEl, addOption(value, label) { selectEl.createEl("option", { text: label }).value = value; return control; }, setValue(value) { selectEl.value = value; return control; }, onChange(listener) { selectEl.addEventListener("change", () => listener(selectEl.value)); return control; } };
    build(control); return this;
  }
  addButton(build) {
    const buttonEl = this.controlEl.createEl("button", { attr: { type: "button" } });
    const control = { buttonEl, setButtonText(value) { buttonEl.textContent = value; return control; }, setIcon() { return control; }, setTooltip(value) { buttonEl.title = value; return control; }, onClick(listener) { buttonEl.addEventListener("click", listener); return control; } };
    build(control); return this;
  }
  addExtraButton(build) { return this.addButton(build); }
  addToggle(build) {
    const toggleEl = this.controlEl.createEl("input", { type: "checkbox" });
    const control = { toggleEl, setValue(value) { toggleEl.checked = Boolean(value); return control; }, setTooltip(value) { toggleEl.title = value; return control; }, onChange(listener) { toggleEl.addEventListener("change", () => listener(toggleEl.checked)); return control; } };
    build(control); return this;
  }
  addColorPicker(build) {
    const colorEl = this.controlEl.createEl("input", { type: "color" });
    const control = { setValue(value) { if (value) colorEl.value = value; return control; }, onChange(listener) { colorEl.addEventListener("input", () => listener(colorEl.value)); return control; } };
    build(control); return this;
  }
}
export class MarkdownView {}
export class WorkspaceLeaf {}
export class Menu {}
export class Notice { constructor(message) { (globalThis.notices ||= []).push(String(message)); } }
export const Platform = { isWin: true, isMacOS: false, isDesktopApp: true };
`;

const kordoc = `
const engine = ${JSON.stringify(engine)};
export const VERSION = engine.version;
export const AGENCY_COMMON_NAME = engine.common;
export const PRESET_ALIAS = engine.alias;
export const agencyNames = () => [...engine.names];
export const agencyStyle = (name) => {
  if (!(name in engine.styles)) throw new Error("agency: " + name);
  return JSON.parse(JSON.stringify(engine.styles[name]));
};
export const normalizeGongmunPreset = (value) => engine.alias[String(value ?? "").trim()] ?? "official";
export const incompatibleGongmunWarnings = () => [];
export const measureTextWidth = () => 0;
export const simulateWrap = () => ({ lines: 1 });
export const hwpxToProfile = async () => ({ tables: [] });
// Making a look from a sample has its own script with the real engine.
const sampleLookOnly = (name) => () => { throw new Error("Kordoc " + name + " is covered by test-sample-look-ui.mjs"); }; export const applyMeasuredLayout = sampleLookOnly("applyMeasuredLayout"); export const buildAgencyPack = sampleLookOnly("buildAgencyPack"); export const loadAgencyPack = sampleLookOnly("loadAgencyPack"); export const markdownToHwpx = sampleLookOnly("markdownToHwpx"); export const measurePdfLayout = sampleLookOnly("measurePdfLayout"); export const packRoleWarnings = sampleLookOnly("packRoleWarnings"); export const packTemplate = sampleLookOnly("packTemplate"); export const resolvePackKind = sampleLookOnly("resolvePackKind"); export const renderHwpxToSvg = sampleLookOnly("renderHwpxToSvg");
`;

const fixtures = {
  kordocEngine: `export async function renderQuickHwpxPreview() {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842" width="595pt" height="842pt"><g data-page="1"><rect width="595" height="842" fill="#fff"/></g></svg>';
    return { render: { svg, warnings: [], pageCount: 1, width: 595, height: 842 }, warnings: [], imageCount: 0, embeddedImageCount: 0, embeddedImageOccurrences: 0, imageFailures: [] };
  }`,
  exportPreparation: "export async function prepareExportMarkdown(host, body) { return { markdown: body, warnings: [] }; }",
  vaultAssemblyHost: "export function createVaultAssemblyHost() { return {}; }",
  obsidianImageLoader: "export function createObsidianImageLoader() { return async () => null; }",
  fileGateway: "export const bytesAsArrayBuffer = (bytes) => bytes.buffer;"
};

const bundle = await build({
  stdin: {
    contents: [
      "export { HanmarkExportModal } from './src/ui/HanmarkExportModal';",
      "export { QuickHwpxPreviewView } from './src/ui/QuickHwpxPreviewView';",
      "export { GongmunBatchModal } from './src/ui/GongmunBatchModal';",
      "export { GongmunLookModal } from './src/ui/GongmunLookModal';",
      "export { GongmunStyleModal } from './src/ui/GongmunStyleModal';",
      "export * as forms from './src/io/gongmunExport';",
      "export * as looks from './src/io/gongmunForms';",
      "export * as ids from './src/io/gongmunFormId';",
      "export * as library from './src/io/templateLibrary';",
      "export * as switches from './src/io/exportSwitches';"
    ].join("\n"),
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "FormUi",
  plugins: [{
    name: "host-fixture",
    setup(build) {
      build.onResolve({ filter: /^(obsidian|kordoc)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      build.onResolve({ filter: /\/io\/(kordocEngine|exportPreparation|vaultAssemblyHost|obsidianImageLoader|fileGateway)$/ }, (args) => ({
        path: args.path.split("/").pop(),
        namespace: "fixture"
      }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
        contents: args.path === "obsidian" ? host : args.path === "kordoc" ? kordoc : fixtures[args.path],
        loader: "js"
      }));
    }
  }]
});

const css = readFileSync("styles.css", "utf8");
const browser = await chromium.launch({ executablePath: process.env.HANMARK_BROWSER_EXECUTABLE || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light">
    <div id="stage" style="width:760px;margin:20px;padding:16px;border:1px solid #ddd;border-radius:10px;background:#fff"></div>
    <div id="pane" style="width:760px;height:260px;margin:20px;border:1px solid #ddd;background:#fff"></div></body></html>`);
  await page.addStyleTag({ content: css });
  await page.addStyleTag({
    content: "body{--interactive-accent:#7c3aed;--interactive-accent-hover:#8b5cf6;--text-accent:#7c3aed;--text-on-accent:#fff;--background-primary:#fff;--background-secondary:#f3f3f5;--background-modifier-border:#ddd;--background-modifier-hover:#eee;--text-muted:#666;--text-faint:#999;--text-normal:#222;--text-error:#c62828;--font-ui-small:13px;--font-ui-smaller:12px;--font-semibold:600;--shadow-s:0 4px 16px rgba(0,0,0,.16);font-family:'Malgun Gothic',system-ui,sans-serif;font-size:14px;color:#222}" +
      ".workspace-leaf-content{height:100%}.view-header{display:none}.view-content{position:relative}button,select,input{font:inherit}button{padding:4px 10px;border:1px solid #ccc;border-radius:6px;background:#f7f7f8}select,input[type=search]{padding:4px 8px;border:1px solid #ccc;border-radius:6px;background:#fff}.mod-cta{background:#7c3aed;color:#fff;border-color:#7c3aed}.setting-item{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 0;border-top:1px solid #eee}.setting-item-info{flex:1 1 auto;min-width:0}.setting-item-name{font-weight:600}.setting-item-description{color:#666;font-size:12px;line-height:1.4}.setting-item-control{flex:0 0 auto;display:flex;gap:6px}.setting-item-heading{border-top:0}"
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  await page.evaluate(() => {
    const { forms, library } = FormUi;
    globalThis.notices = [];
    globalThis.calls = { exports: [], saves: 0, selected: [], switches: [] };
    // One plugin state for the export window, the preview, and "several forms at once".
    globalThis.plugin = { settings: {}, saveSettings: async () => { calls.saves += 1; } };
    globalThis.memory = {};
    const note = "note.md";
    globalThis.pickerHost = () => ({
      library: plugin,
      toggleFavorite: async (look) => { library.toggleGongmunLookFavoriteInMemory(plugin, look); await plugin.saveSettings(); }
    });
    globalThis.currentForm = () => (memory[note] && forms.isGongmunForm(plugin, memory[note]) ? memory[note] : forms.currentGongmunFormId(plugin));
    globalThis.selectForm = async (id) => {
      const preset = forms.selectGongmunFormInMemory(plugin, id);
      memory[note] = forms.describeGongmunForm(plugin, id).id;
      calls.selected.push(memory[note]);
      await plugin.saveSettings();
      globalThis.preview?.settingsChanged?.();
      return preset;
    };
    globalThis.openExport = () => {
      globalThis.modal = new FormUi.HanmarkExportModal({}, {
        activeTemplateId: () => "default", templateChoices: () => [], activeTemplateSummary: () => "",
        selectTemplate: async () => {}, runOther: async () => {}, openPreview: async () => {},
        openDocxPreview: async () => {},
        exportSwitch: (id) => FormUi.switches.exportSwitchValue(plugin.settings, id),
        setExportSwitch: async (id, value) => { plugin.settings[id] = value; await plugin.saveSettings(); calls.switches.push([id, value]); },
        gongmunForms: () => forms.listGongmunForms(plugin),
        gongmunPicker: pickerHost,
        describeGongmunForm: (id) => forms.describeGongmunForm(plugin, id),
        currentGongmunForm: currentForm,
        selectGongmunForm: selectForm,
        notePresetHint: () => undefined,
        noteLookHint: () => globalThis.noteLook,
        exportKordoc: async (mode, preset, formId) => {
          calls.exports.push({ mode, preset, formId, label: forms.gongmunFileLabel(plugin, formId, "ko") });
          // What the plugin does after a saved export: remember the form and the look.
          const form = forms.describeGongmunForm(plugin, formId);
          memory[note] = form.id;
          library.recordGongmunLookUseInMemory(plugin, form.look);
          await plugin.saveSettings();
          return { format: "hwpx", status: "saved", fileName: "note - " + calls.exports.at(-1).label + ".hwpx", displayPath: "note.hwpx" };
        }
      }, "hwpx", "gongmun");
      modal.open();
    };
    openExport();
  });

  const frame = page.locator("#hanmark-export-gongmun-frame");
  const lookButton = page.locator("#hanmark-export-gongmun-look");
  const search = page.locator("#hanmark-export-gongmun-look-search");
  const options = page.locator("#hanmark-export-gongmun-look-list .hanmark-look-option");
  const sections = () => page.locator("#hanmark-export-gongmun-look-list .hanmark-look-group-name").allInnerTexts();
  const activeForm = () => page.evaluate(() => FormUi.library.getTemplateLibrary(plugin).activeGongmunForm);

  // Two choices instead of one list of ten forms.
  assert.deepEqual(await frame.locator("option").allInnerTexts(), ["기안문", "일반 문서", "보고서", "개조식 보고서", "업무보고", "보도자료", "서울방침"]);
  assert.equal(await frame.inputValue(), "report");
  assert.equal((await lookButton.innerText()).replace(/\s*▾\s*/u, ""), "기본");
  assert.equal(await page.locator("#stage select").count(), 1, "the look is not a dropdown");

  // A frame that cannot use agency looks still shows all of them, under a line saying
  // that choosing one switches the frame to 보고서 (a user could not find them before).
  await frame.selectOption("official");
  await lookButton.click();
  assert.equal(await options.count(), 1 + 1 + 52, "기본, 공통, and 52 agencies");
  assert.match(await page.locator("#hanmark-export-gongmun-look-list .hanmark-look-frame-hint").innerText(), /아래 중앙행정기관 모양은 기안문 틀에 쓰지 않습니다\. 고르면 틀이 보고서로 바뀝니다/u);
  assert.equal(await page.locator("#hanmark-export-gongmun-look-list .hanmark-look-option.is-other-frame").count(), 53);
  // Each agency row says what it puts on paper: body font and size, and its band colour.
  assert.match(await page.locator('[data-look="agency:국세청"] .hanmark-look-detail').innerText(), /^바탕 13pt$/u);
  assert.equal(await page.locator('[data-look="agency:국세청"] .hanmark-look-chip').evaluate((node) => getComputedStyle(node).backgroundColor), "rgb(62, 87, 165)");
  await page.locator("#stage").screenshot({ path: `${out}/11-official-frame-shows-agencies.png` });
  await search.fill("국세");
  assert.deepEqual(await options.locator(".hanmark-look-name").allInnerTexts(), ["국세청"]);
  await search.press("Enter");
  assert.equal(await activeForm(), "form:report/agency:국세청", "choosing an agency from 기안문 switches the frame to 보고서");
  assert.equal(await frame.inputValue(), "report");
  await frame.selectOption("official");
  assert.equal((await lookButton.innerText()).replace(/\s*▾\s*/u, ""), "기본", "back on 기안문 the look returns to 기본");
  await lookButton.click();
  await search.press("Escape");
  assert.equal(await page.locator(".hanmark-look-panel").isHidden(), true);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "hanmark-export-gongmun-look", "Escape returns to the look button");
  assert.equal(await page.locator("#stage .hanmark-form-picker-switch").count(), 0);

  // 보고서: 표지 and 목차 switches, and the engine's 52 agencies in groups.
  await frame.selectOption("report");
  assert.deepEqual(await page.locator("#stage .hanmark-form-picker-switch").allInnerTexts(), ["표지", "목차"]);
  await lookButton.click();
  assert.deepEqual(await sections(), ["기본", "한림대학교", "부", "처", "청", "위원회", "그 밖의 기관"]);
  assert.equal(await options.count(), 2 + 1 + 52, "기본, 공통, the Hallym report form, and 52 agencies");
  // Agency groups say how many agencies they hold; the five groups add up to the engine's 52.
  const counts = await page.locator("#hanmark-export-gongmun-look-list .hanmark-look-group-count").allInnerTexts();
  assert.equal(counts.length, 5, counts.join(" | "));
  assert.ok(counts.every((text) => /^\d+곳$/u.test(text)), counts.join(" | "));
  assert.equal(counts.reduce((sum, text) => sum + Number.parseInt(text, 10), 0), 52);
  // The open chooser stays inside the window and leaves the export button visible (M10).
  const placement = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const panel = rect("#stage .hanmark-look-panel");
    const modal = rect("#stage .modal");
    const exportButton = [...document.querySelectorAll("#stage button")].find((button) => button.textContent.trim() === "공문서 HWPX 내보내기").getBoundingClientRect();
    const overlaps = !(panel.right <= exportButton.left || panel.left >= exportButton.right || panel.bottom <= exportButton.top || panel.top >= exportButton.bottom);
    return { overlaps, inside: panel.top >= modal.top - 1 && panel.bottom <= modal.bottom + 1, up: document.querySelector("#stage .hanmark-look-panel").classList.contains("is-up") };
  });
  // Up or down depends on the room the window has; either way the button stays visible.
  assert.deepEqual({ overlaps: placement.overlaps, inside: placement.inside }, { overlaps: false, inside: true });
  await page.locator("#stage").screenshot({ path: `${out}/06-chooser-leaves-export-button.png` });
  assert.equal(await page.locator('[data-look="agency:경찰청"] .hanmark-look-badge').innerText(), "표본 적음");
  assert.equal(await page.locator('[data-look="agency:국세청"] .hanmark-look-badge').count(), 0);

  // Typing part of a name filters; the keyboard picks.
  await search.fill("국세");
  assert.deepEqual(await options.locator(".hanmark-look-name").allInnerTexts(), ["국세청"]);
  await page.locator("#stage").screenshot({ path: `${out}/02-look-chooser-filtered.png` });
  await search.fill("청");
  const filtered = await options.count();
  assert.ok(filtered > 5 && filtered < 30, "a broader query keeps several agencies");
  await search.press("ArrowDown");
  await search.press("ArrowUp");
  assert.equal(await options.first().evaluate((node) => node.classList.contains("is-active")), true);
  await search.fill("국세");
  await search.press("Enter");
  assert.equal(await activeForm(), "form:report/agency:국세청");
  assert.equal((await lookButton.innerText()).replace(/\s*▾\s*/u, ""), "국세청");

  // Keyboard only (R-037): open from the button, move with the arrows, type ahead, Enter picks, Escape gives the focus back.
  const activeLook = () => page.evaluate(() => {
    const field = document.querySelector("#hanmark-export-gongmun-look-search");
    const option = document.getElementById(field?.getAttribute("aria-activedescendant") ?? "");
    return option ? (option.closest("[data-look]") ?? option.querySelector("[data-look]"))?.getAttribute("data-look") ?? option.textContent.trim() : null;
  });
  await lookButton.focus();
  await page.keyboard.press("Enter");
  assert.equal(await search.evaluate((node) => node === document.activeElement), true, "opening moves the focus to the search field");
  assert.equal(await activeLook(), "agency:국세청", "the list starts on the chosen look, so Enter keeps it");
  await page.keyboard.press("ArrowDown");
  const next = await activeLook();
  assert.notEqual(next, "agency:국세청");
  assert.equal(await page.evaluate(() => {
    const field = document.querySelector("#hanmark-export-gongmun-look-search");
    const option = document.getElementById(field.getAttribute("aria-activedescendant"));
    const list = document.querySelector("#hanmark-export-gongmun-look-list").getBoundingClientRect();
    const box = option.getBoundingClientRect();
    return box.top >= list.top - 1 && box.bottom <= list.bottom + 1;
  }), true, "the active row is scrolled into view");
  await page.keyboard.press("ArrowUp");
  assert.equal(await activeLook(), "agency:국세청");
  // Type ahead: letters go to the search field and the first match becomes active.
  await page.keyboard.type("교육");
  assert.equal(await search.inputValue(), "교육");
  assert.equal(await activeLook(), "agency:교육부");
  await page.keyboard.press("Enter");
  assert.equal(await activeForm(), "form:report/agency:교육부");
  assert.equal(await search.isVisible(), false, "picking closes the list");
  await lookButton.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  assert.equal(await search.isVisible(), false, "Escape closes the list");
  assert.equal(await lookButton.evaluate((node) => node === document.activeElement), true, "Escape gives the focus back to the button");
  assert.equal(await activeForm(), "form:report/agency:교육부", "Escape changes nothing");
  assert.equal(await page.locator("#stage .modal").count(), 1, "Escape closes the list, not the export window");
  await lookButton.click();
  await search.fill("국세");
  await search.press("Enter");
  assert.equal(await activeForm(), "form:report/agency:국세청");
  await page.locator("#hanmark-export-gongmun-option-cover").check();
  await page.locator("#hanmark-export-gongmun-option-toc").check();
  assert.equal(await activeForm(), "form:report/agency:국세청;cover=1;toc=1");
  assert.equal(await page.locator("#hanmark-export-gongmun-option-cover").isChecked(), true);
  await page.locator("#stage").screenshot({ path: `${out}/01-export-window-frame-and-look.png` });

  // A favorite is saved and pinned on top.
  const savesBefore = await page.evaluate(() => calls.saves);
  await lookButton.click();
  await page.locator('[data-look="agency:교육부"] .hanmark-look-star').click();
  assert.equal(await page.evaluate(() => calls.saves), savesBefore + 1, "the star saves the settings");
  assert.deepEqual(await page.evaluate(() => FormUi.library.getTemplateLibrary(plugin).gongmunLookFavorites), ["agency:교육부"]);
  assert.equal((await sections())[0], "즐겨찾기");
  assert.equal(await page.locator('[data-section="favorite"] .hanmark-look-name').innerText(), "교육부");
  assert.equal(await page.locator('[data-section="favorite"] .hanmark-look-star').getAttribute("aria-pressed"), "true");
  await search.press("Escape");

  // Switching to a frame that cannot use the look drops it; the frame's own looks come
  // first, and the agencies follow, marked as switching the frame (recent and favorite
  // agencies stay pinned on top so they can still be found).
  await frame.selectOption("general");
  assert.equal(await activeForm(), "form:general/basic");
  assert.deepEqual(await page.locator("#stage .hanmark-form-picker-switch").allInnerTexts(), ["맺음 줄"]);
  await lookButton.click();
  const own = page.locator("#hanmark-export-gongmun-look-list .hanmark-look-option:not(.is-other-frame) .hanmark-look-name");
  assert.deepEqual(await own.allInnerTexts(), ["기본", "한림대 일송자유교양대학 (회의록·회의자료)"]);
  assert.equal(await page.locator('#hanmark-export-gongmun-look-list .hanmark-look-option.is-other-frame:not([data-section="recent"]):not([data-section="favorite"])').count(), 53);
  await page.locator("#stage").screenshot({ path: `${out}/12-general-frame-shows-agencies.png` });
  await page.locator('#hanmark-export-gongmun-look-list [data-look="builtin:hallym-ilsong"] .hanmark-look-pick').click();
  assert.equal(await activeForm(), "form:general/builtin:hallym-ilsong");
  assert.equal(await page.locator("#stage .hanmark-form-picker-switch").count(), 0, "a look made for one type has no switches");
  assert.match(await page.locator("#stage .hanmark-form-picker").innerText(), /'회의록' 종류로 만듭니다/u);

  // The user's case (2026-11-18): with the Hallym minutes look, which fixes the type, the
  // chooser still lists the 52 agencies, and picking one leaves the Hallym look for 보고서.
  await lookButton.click();
  assert.equal(await page.locator('#hanmark-export-gongmun-look-list .hanmark-look-option.is-other-frame:not([data-section="recent"]):not([data-section="favorite"])').count(), 53);
  await search.fill("행정안전");
  assert.deepEqual(await options.locator(".hanmark-look-name").allInnerTexts(), ["행정안전부"]);
  await search.press("Enter");
  assert.equal(await activeForm(), "form:report/agency:행정안전부");
  assert.equal(await frame.inputValue(), "report");

  // Back to the agency look with a cover and contents, then export: the file is named 틀_모양.
  await frame.selectOption("report");
  await lookButton.click();
  await search.fill("국세");
  await search.press("Enter");
  await page.locator("#hanmark-export-gongmun-option-cover").check();
  await page.locator("#hanmark-export-gongmun-option-toc").check();
  await page.getByRole("button", { name: "공문서 HWPX 내보내기", exact: true }).click();
  await page.waitForFunction(() => calls.exports.length === 1);
  assert.deepEqual(await page.evaluate(() => calls.exports[0]), {
    mode: "gongmun-hwpx",
    preset: "plan",
    formId: "form:report/agency:국세청;cover=1;toc=1",
    label: "보고서_국세청"
  });
  assert.deepEqual(await page.evaluate(() => FormUi.library.getTemplateLibrary(plugin).gongmunLookRecent), ["agency:국세청"]);

  // Reopened for the same note: frame, look, and switches come back; pinned sections show.
  await page.evaluate(() => {
    modal.close();
    // The global form moves elsewhere; the note's memory must win.
    FormUi.forms.selectGongmunFormInMemory(plugin, "form:press/basic");
    openExport();
  });
  assert.equal(await frame.inputValue(), "report");
  assert.equal((await lookButton.innerText()).replace(/\s*▾\s*/u, ""), "국세청");
  assert.equal(await page.locator("#hanmark-export-gongmun-option-cover").isChecked(), true);
  assert.equal(await page.locator("#hanmark-export-gongmun-option-toc").isChecked(), true);
  await lookButton.click();
  assert.deepEqual((await sections()).slice(0, 2), ["최근 사용", "즐겨찾기"]);
  assert.equal(await page.locator('[data-section="recent"] .hanmark-look-name').innerText(), "국세청");
  assert.equal(await page.locator('[data-section="favorite"] .hanmark-look-name').innerText(), "교육부");
  await page.locator("#stage").screenshot({ path: `${out}/03-look-chooser-pinned.png` });
  // Unstar and the pin goes away.
  await page.locator('[data-section="favorite"] .hanmark-look-star').click();
  assert.deepEqual(await page.evaluate(() => FormUi.library.getTemplateLibrary(plugin).gongmunLookFavorites), []);
  assert.deepEqual((await sections()).slice(0, 2), ["최근 사용", "기본"]);
  await search.press("Escape");

  // The note names another look: the window says which one it uses.
  await page.evaluate(() => { globalThis.noteLook = "교육부"; modal.close(); openExport(); });
  assert.match(await page.locator("#stage .hanmark-export-form-row").innerText(), /노트의 공문_기관서식는 '교육부'이지만, 지금 고른 모양은 '국세청'입니다/u);
  await page.evaluate(() => { globalThis.noteLook = undefined; modal.close(); });

  // "내보낼 때" switches (R-037): one group per format, each box a stored setting.
  await page.evaluate(() => openExport());
  const switchGroup = (format) => page.locator(`#stage [data-hanmark-export-switches="${format}"]`);
  const switchBox = (format, id) => switchGroup(format).locator(`[data-hanmark-export-switch="${id}"]`);
  const switchIds = (format) => switchGroup(format).locator("[data-hanmark-export-switch]").evaluateAll((nodes) => nodes.map((node) => node.dataset.hanmarkExportSwitch));
  assert.equal(await switchGroup("hwpx").locator("legend").innerText(), "내보낼 때");
  assert.deepEqual(await switchIds("hwpx"), ["mermaidDiagrams", "commentsAsMemos", "hwpxEquations"]);
  // A profile that never chose: diagrams on, memos and equation objects off.
  assert.equal(await switchBox("hwpx", "mermaidDiagrams").isChecked(), true);
  assert.equal(await switchBox("hwpx", "commentsAsMemos").isChecked(), false);
  assert.equal(await switchBox("hwpx", "hwpxEquations").isChecked(), false);
  assert.deepEqual(await switchGroup("hwpx").locator("label").allInnerTexts(), ["Mermaid 도식을 그림으로", "주석을 한글 메모로", "수식을 한글 수식 개체로"]);
  const switchSaves = await page.evaluate(() => calls.saves);
  await switchBox("hwpx", "commentsAsMemos").check();
  await switchBox("hwpx", "hwpxEquations").check();
  await switchBox("hwpx", "mermaidDiagrams").uncheck();
  assert.equal(await page.evaluate(() => calls.saves), switchSaves + 3, "each switch saves the settings");
  assert.deepEqual(await page.evaluate(() => [plugin.settings.mermaidDiagrams, plugin.settings.commentsAsMemos, plugin.settings.hwpxEquations]), [false, true, true]);
  assert.deepEqual(await page.evaluate(() => calls.switches), [["commentsAsMemos", true], ["hwpxEquations", true], ["mermaidDiagrams", false]]);
  await page.locator("#stage").screenshot({ path: `${out}/09-export-window-switches-hwpx.png` });
  // The quick variant shows the same group; the other formats show only what applies to them.
  await page.locator("#stage .hanmark-export-variant-grid button").first().click();
  assert.deepEqual(await switchIds("hwpx"), ["mermaidDiagrams", "commentsAsMemos", "hwpxEquations"]);
  assert.equal(await switchBox("hwpx", "hwpxEquations").isChecked(), true);
  const formatCards = page.locator("#stage .hanmark-export-format-card");
  await formatCards.nth(1).click();
  assert.deepEqual(await switchIds("docx"), ["mermaidDiagrams"]);
  assert.equal(await switchBox("docx", "mermaidDiagrams").isChecked(), false, "the same stored value in every format");
  await switchBox("docx", "mermaidDiagrams").check();
  await page.locator("#stage").screenshot({ path: `${out}/10-export-window-switches-docx.png` });
  await formatCards.nth(2).click();
  assert.deepEqual(await switchIds("html"), ["mermaidDiagrams"]);
  assert.equal(await switchBox("html", "mermaidDiagrams").isChecked(), true);
  // Reopened: the choices come back.
  await page.evaluate(() => { modal.close(); openExport(); });
  assert.equal(await switchBox("hwpx", "mermaidDiagrams").isChecked(), true);
  assert.equal(await switchBox("hwpx", "commentsAsMemos").isChecked(), true);
  assert.equal(await switchBox("hwpx", "hwpxEquations").isChecked(), true);
  await page.evaluate(() => { delete plugin.settings.commentsAsMemos; delete plugin.settings.hwpxEquations; delete plugin.settings.mermaidDiagrams; modal.close(); });

  // The real HWPX preview toolbar shows the same picker for the note's form.
  await page.evaluate(async () => {
    const workspace = { on() { return {}; }, requestSaveLayout() {}, getActiveViewOfType() { return null; } };
    const sourceView = { file: { path: "note.md", basename: "note" }, editor: { getValue: () => "# 제목\n\n본문", getCursor: () => ({ line: 0, ch: 0 }) } };
    globalThis.preview = new FormUi.QuickHwpxPreviewView({ app: { workspace } }, {
      profile: () => undefined,
      documentStyle: () => undefined,
      sourceView: () => sourceView,
      livePreviewEnabled: () => false,
      autoPauseEnabled: () => false,
      gongmunPlan: () => ({ preset: "report", options: {}, warnings: [], title: "note", formId: currentForm() }),
      gongmunForms: () => FormUi.forms.listGongmunForms(plugin),
      gongmunPicker: pickerHost,
      describeGongmunForm: (id) => FormUi.forms.describeGongmunForm(plugin, id),
      currentGongmunForm: () => currentForm(),
      selectGongmunForm: (id) => selectForm(id),
      rememberMode: async (kind) => { globalThis.previewKind = kind; },
      exportHwpx: async () => true,
      followCursor: () => false,
      setFollowCursor: async () => {}
    });
    document.getElementById("pane").append(preview.containerEl);
    await preview.onOpen();
  });
  const toolbar = page.locator("#pane .hanmark-hwpx-preview-toolbar");
  const kind = toolbar.locator("select").first();
  assert.deepEqual(await kind.locator("option").allInnerTexts(), ["빠른 HWPX (문서 템플릿)", "공문서 (틀과 모양)"]);
  assert.equal(await toolbar.locator(".hanmark-form-picker").count(), 0, "quick HWPX has no frame or look");
  await kind.selectOption("gongmun");
  await page.waitForFunction(() => globalThis.previewKind === "gongmun");
  const previewFrame = page.locator("#hanmark-preview-gongmun-frame");
  assert.equal(await previewFrame.inputValue(), "report", "the preview opens on the note's remembered form");
  assert.equal((await page.locator("#hanmark-preview-gongmun-look").innerText()).replace(/\s*▾\s*/u, ""), "국세청");
  assert.equal(await page.locator("#hanmark-preview-gongmun-option-toc").isChecked(), true);
  await previewFrame.selectOption("press");
  await page.waitForFunction(() => calls.selected.at(-1) === "form:press/agency:국세청");
  assert.equal((await page.locator("#hanmark-preview-gongmun-look").innerText()).replace(/\s*▾\s*/u, ""), "국세청", "the look stays where the new frame can use it");
  await page.locator("#hanmark-preview-gongmun-look").click();
  await page.locator("#hanmark-preview-gongmun-look-search").fill("과학");
  await page.locator("#pane").screenshot({ path: `${out}/04-preview-toolbar.png` });
  await page.locator("#hanmark-preview-gongmun-look-search").press("Enter");
  await page.waitForFunction(() => calls.selected.at(-1) === "form:press/agency:과학기술정보통신부");

  // Several forms at once: the frames in one look, picked from the same chooser.
  await page.evaluate(() => {
    const { forms, ids } = FormUi;
    globalThis.batch = new FormUi.GongmunBatchModal({}, {
      forms: forms.listGongmunForms(plugin),
      listForms: (look) => forms.listGongmunForms(plugin, ids.formatGongmunFormId(ids.gongmunFormChoice("report", look))),
      chooseLook: (current, pick, frame) => new FormUi.GongmunLookModal({}, { host: pickerHost(), frame: frame ?? "report", current, filter: (look) => ["basic", "common", "agency"].includes(look.kind), pick }).open(),
      currentFormId: "form:report/basic",
      noteName: "note",
      run: async (chosen) => { calls.batch = chosen.map((form) => form.id); return chosen.map((form) => ({ form, status: "saved", result: { format: "hwpx", status: "saved", fileName: form.name + ".hwpx" } })); },
      open: () => {}
    });
    batch.open();
  });
  await page.locator("#hanmark-batch-look").click();
  await page.locator("#hanmark-look-modal-look-search").fill("국세");
  await page.locator("#hanmark-look-modal-look-search").press("Enter");
  assert.equal(await page.locator("#hanmark-batch-look").innerText(), "모든 틀의 모양: 국세청");
  const rows = await page.locator(".hanmark-gongmun-batch-name").allInnerTexts();
  assert.ok(rows.includes("보고서 · 국세청") && rows.includes("기안문") && rows.includes("보도자료 · 국세청"), rows.join(" | "));
  await page.locator(".hanmark-gongmun-batch").screenshot({ path: `${out}/05-several-forms-at-once.png` });
  // Each frame row carries its own look (M10): 보도자료 in 교육부 while 보고서 stays in 국세청.
  assert.equal(await page.locator('.hanmark-gongmun-batch-rowlook[data-frame="official"]').count(), 0, "a frame without agency looks has no look button");
  await page.locator('.hanmark-gongmun-batch-rowlook[data-frame="press"]').click();
  assert.equal(await page.locator("#hanmark-look-modal-look-list .hanmark-look-name").filter({ hasText: "한림대" }).count(), 0, "a row's look is 기본, 공통, or an agency");
  await page.locator("#hanmark-look-modal-look-search").fill("교육");
  await page.locator("#hanmark-look-modal-look-search").press("Enter");
  const mixed = await page.locator(".hanmark-gongmun-batch-name").allInnerTexts();
  assert.ok(mixed.includes("보고서 · 국세청") && mixed.includes("보도자료 · 교육부") && mixed.includes("업무보고 · 국세청"), mixed.join(" | "));
  assert.equal(await page.locator('.hanmark-gongmun-batch-rowlook[data-frame="press"]').innerText(), "모양: 교육부");
  await page.locator(".hanmark-gongmun-batch-row", { hasText: "보도자료 · 교육부" }).locator("input").check();
  await page.locator(".hanmark-gongmun-batch").screenshot({ path: `${out}/07-several-forms-two-looks.png` });
  await page.getByRole("button", { name: /내보내기|시작/u }).last().click();
  await page.waitForFunction(() => Array.isArray(calls.batch));
  assert.deepEqual(await page.evaluate(() => calls.batch), ["form:report/agency:국세청", "form:press/agency:교육부"], "each checked row keeps its own look");
  await page.evaluate(() => batch.close());

  // The style window in the new model (M10): a form of the user's own is a look for a frame.
  await page.evaluate(() => {
    // about:blank is not a secure context, so the page has no crypto.randomUUID.
    if (!crypto.randomUUID) crypto.randomUUID = () => "00000000-0000-4000-8000-" + String(Date.now()).padStart(12, "0").slice(-12);
    globalThis.styleChanged = [];
    globalThis.styleModal = new FormUi.GongmunStyleModal({}, {
      templateHost: plugin,
      gateway: {},
      lookPicker: pickerHost,
      changed: (id) => styleChanged.push(id)
    }, null, "report");
    styleModal.open();
  });
  const styleFrame = page.locator("#hanmark-style-frame");
  assert.deepEqual(await styleFrame.locator("option").allInnerTexts(), ["기안문", "일반 문서", "보고서", "개조식 보고서", "업무보고", "보도자료", "서울방침"]);
  assert.equal(await styleFrame.inputValue(), "report");
  assert.deepEqual(await page.locator("#hanmark-style-kind option").allInnerTexts(), ["보고서", "계획서"]);
  assert.equal(await page.locator("#hanmark-style-base").innerText(), "기본");
  // The starting look: 기본, 공통, or an agency; never another form.
  await page.locator("#hanmark-style-base").click();
  const baseNames = await page.locator("#hanmark-look-modal-look-list .hanmark-look-name").allInnerTexts();
  assert.equal(new Set(baseNames).size, 2 + 52, "기본, 공통, and 52 agencies (a recent look is listed twice)");
  assert.ok(!baseNames.some((name) => name.includes("한림대")));
  await page.locator("#hanmark-look-modal-look-search").fill("국세");
  await page.locator("#hanmark-look-modal-look-search").press("Enter");
  assert.equal(await page.locator("#hanmark-style-base").innerText(), "국세청");
  // A frame without agency looks has no starting look to choose; the choice comes back with the frame.
  await styleFrame.selectOption("official");
  assert.equal(await page.locator("#hanmark-style-base").count(), 0);
  assert.equal(await page.locator("#hanmark-style-kind").count(), 0, "a frame with one document type asks for none");
  await styleFrame.selectOption("general");
  assert.equal(await page.locator("#hanmark-style-kind option").count(), 2);
  await styleFrame.selectOption("report");
  await page.locator("#hanmark-style-kind").selectOption("plan");
  assert.equal(await page.locator("#hanmark-style-base").innerText(), "국세청");
  await page.locator(".hanmark-gongmun-style-form input[type=text]").first().fill("학과 계획서");
  await page.waitForSelector(".hanmark-gongmun-style-paper svg");
  await page.locator(".hanmark-gongmun-style-modal").screenshot({ path: `${out}/08-style-window-frame-and-look.png` });
  await page.locator(".hanmark-gongmun-style-modal .hanmark-dialog-actions .mod-cta").click();
  await page.waitForFunction(() => styleChanged.length === 1);
  const savedStyle = await page.evaluate(() => {
    const record = FormUi.library.listGongmunTemplates(plugin).at(-1);
    return { name: record.name, preset: record.preset, agency: record.options.agency, look: FormUi.looks.listGongmunLooks(plugin, "report").some((look) => look.id === record.id) };
  });
  assert.deepEqual(savedStyle, { name: "학과 계획서", preset: "plan", agency: "국세청", look: true });

  assert.deepEqual(await page.evaluate(() => globalThis.notices), ["내 양식을 저장했습니다: 학과 계획서"]);
  console.log("Form UI: frame select, searchable look chooser (filter, keyboard, small-sample mark), switches, favorites, recent looks, per-note memory, preview toolbar, several forms at once with a look per frame, chooser placement, and the style window in the frame-and-look model passed.");
} finally {
  await browser.close();
}
