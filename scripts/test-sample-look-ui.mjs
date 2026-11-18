import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

// "견본으로 내 모양 만들기" end to end (R-036): the real form window, look chooser and
// sample panel in Chromium with styles.css, and the real engine in Node. The page's
// Kordoc calls are passed to the installed engine, and the preview is drawn by
// HanMark's real preview function, so what the screenshots show is engine output.
// Run with: node --import tsx scripts/test-sample-look-ui.mjs
//
// HANMARK_SAMPLE_UI_FILES may list real sample HWPX files (separated by "|"); they are
// read at run time and never copied into the repository. Without it a sample is made.
const out = process.env.HANMARK_SAMPLE_UI_OUTPUT || "test-artifacts/sample-look-ui";
mkdirSync(out, { recursive: true });

const pick = (module) => module.default && Object.keys(module).length === 1 ? module.default : module;
const kordocNode = pick(await import("kordoc"));
const engine = pick(await import("../src/io/kordocEngine.ts"));
const measureModule = pick(await import("../src/io/sampleMeasure.ts"));

const b64 = (bytes) => Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes).toString("base64");
const bytesOf = (text) => new Uint8Array(Buffer.from(text, "base64"));
const buffer = (text) => {
  const bytes = bytesOf(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const SAMPLE_NOTE = [
  "# 2026년 교육과정 운영 보고", "",
  "> 공통과목을 다섯 개로 줄인다.", "",
  "## 추진 배경", "",
  "- 평가 기준을 다시 설계한다", "- 운영 기준을 새로 마련한다",
  "  - 실습과목 열두 개 가운데 아홉 개가 해당한다", "  - 공통과목 일곱 개 가운데 두 개를 합친다", "",
  "이 보고는 교과과정위원회 심의를 거쳐 확정한다. 시행 시기는 다음 학기다.", "",
  "세부 운영 기준은 학과 회의에서 따로 정해 알린다. 의견은 이번 달 말까지 받는다.", "",
  "※ 세부 일정은 붙임과 같다", "",
  "| 구분 | 올해 | 내년 |", "|---|---|---|", "| 공통과목 | 7개 | 5개 |"
].join("\n");
const LETTER_NOTE = ["# 안내문", "", "이 문서는 본문 문단만으로 이루어진 안내문입니다.", "", "둘째 문단도 본문 모양으로 충분히 길게 적습니다.", "", "셋째 문단도 본문 모양으로 충분히 길게 적습니다.", "", "| 구분 | 내용 |", "|---|---|", "| 일시 | 3월 |"].join("\n");
const USER_NOTE = ["## 장소", "", "- 가평과 홍천을 검토한다", "- 춘천 근교도 함께 검토한다", "  - 객실 다섯 개", "  - 세미나실 한 곳", "", "회의에서 정한 뒤 예약한다. 참석 인원은 열 명 안팎이다.", "", "| 후보 | 거리 |", "|---|---|", "| 가평 | 1시간 |", "| 홍천 | 1시간 30분 |"].join("\n");

const made = {
  "우리 기관 보고서.hwpx": new Uint8Array(await kordocNode.markdownToHwpx(SAMPLE_NOTE, { gongmun: { preset: "report", margins: { top: 20, bottom: 15, left: 25, right: 25 } } })),
  // A form letter: no item shapes, and a body font this computer does not have.
  "안내문 견본.hwpx": new Uint8Array(await kordocNode.markdownToHwpx(LETTER_NOTE, { gongmun: { preset: "notice", bodyPt: 13, lineSpacing: 170, margins: { top: 22, bottom: 14, left: 26, right: 24 }, fonts: { body: "한마크 없는 글꼴" } } }))
};
const real = (process.env.HANMARK_SAMPLE_UI_FILES || "").split("|").map((item) => item.trim()).filter((item) => item && existsSync(item));
const samples = { ...made };
for (const file of real) samples[basename(file)] = new Uint8Array(readFileSync(file));
const firstSample = real.length ? basename(real[0]) : "우리 기관 보고서.hwpx";
const letterSample = real.length > 1 ? basename(real[1]) : "안내문 견본.hwpx";

// Engine values the page reads synchronously (the chooser's agencies, preset aliases).
const docs = {};
for (const name of kordocNode.agencyNames()) {
  const count = kordocNode.agencyStyle(name)?.report?.docs;
  docs[name] = typeof count === "number" ? count : null;
}
const engineData = { common: kordocNode.AGENCY_COMMON_NAME, names: kordocNode.agencyNames(), docs, alias: kordocNode.PRESET_ALIAS, version: kordocNode.VERSION };
const PRESETS = ["official", "report", "plan", "notice", "minutes", "gaejosik", "press", "ministry", "bangchim"];

/** Kordoc calls of the page, run by the installed engine. Bytes travel as base64. */
async function kordocCall(name, args) {
  if (name === "buildAgencyPack") {
    const result = await kordocNode.buildAgencyPack(args.name, args.samples.map((item) => ({ data: bytesOf(item) })));
    return { pack: b64(result.pack), manifest: result.manifest, guide: result.guide };
  }
  if (name === "loadAgencyPack") {
    const pack = await kordocNode.loadAgencyPack(bytesOf(args.data));
    return { manifest: pack.manifest, guide: pack.guide, templates: Object.fromEntries([...pack.templates].map(([kind, data]) => [kind, b64(data)])) };
  }
  if (name === "markdownToHwpx") {
    const warnings = [];
    const { template, ...rest } = args.options ?? {};
    const data = await kordocNode.markdownToHwpx(args.markdown, { ...rest, ...(template ? { template: bytesOf(template) } : {}), warnings });
    return { data: b64(data), warnings };
  }
  if (name === "hwpxToProfile") return kordocNode.hwpxToProfile(buffer(args.data));
  if (name === "renderHwpxToSvg") return kordocNode.renderHwpxToSvg(buffer(args.data), args.options);
  if (name === "packRoleWarnings") return kordocNode.packRoleWarnings(args.info, args.markdown);
  if (name === "measurePdfLayout") {
    const spec = await kordocNode.measurePdfLayout(bytesOf(args.data));
    return { spec, applied: Object.fromEntries(PRESETS.map((preset) => [preset, kordocNode.applyMeasuredLayout({ preset }, spec)])) };
  }
  if (name === "preview") {
    const result = await engine.renderQuickHwpxPreview(args.markdown, args.options);
    return { render: result.render, warnings: result.warnings, data: b64(result.data) };
  }
  if (name === "generate") {
    const result = await engine.generateValidatedHwpx(args.markdown, args.options);
    const measure = await measureModule.measureSample(new Uint8Array(result.data));
    const parsed = await kordocNode.parse(result.data, { hancomFallback: false, ocr: false });
    return { bytes: result.data.byteLength, measure, markdown: parsed.success ? parsed.markdown : "", warnings: result.warnings };
  }
  throw new Error(`Unexpected engine call: ${name}`);
}

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
export class Notice { constructor(message) { (globalThis.notices ||= []).push(String(message)); } }
export const Platform = { isWin: true, isMacOS: false, isDesktopApp: true };
export const normalizePath = (value) => value;
`;

const kordoc = `
const engine = ${JSON.stringify(engineData)};
const call = (name, args) => globalThis.__kordoc(name, args);
const toB64 = (input) => {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  let text = ""; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export const VERSION = engine.version;
export const AGENCY_COMMON_NAME = engine.common;
export const PRESET_ALIAS = engine.alias;
export const agencyNames = () => [...engine.names];
export const agencyStyle = (name) => {
  if (!(name in engine.docs)) throw new Error("agency: " + name);
  return engine.docs[name] === null ? {} : { report: { docs: engine.docs[name] } };
};
export const normalizeGongmunPreset = (value) => engine.alias[String(value ?? "").trim()] ?? "official";
export const incompatibleGongmunWarnings = () => [];
export const measureTextWidth = () => 0;
export const simulateWrap = () => ({ lines: 1 });
export async function buildAgencyPack(name, samples) {
  const result = await call("buildAgencyPack", { name, samples: samples.map((item) => toB64(item.data)) });
  return { pack: fromB64(result.pack), manifest: result.manifest, guide: result.guide };
}
export async function loadAgencyPack(data) {
  const result = await call("loadAgencyPack", { data: toB64(data) });
  return { manifest: result.manifest, guide: result.guide, templates: new Map(Object.entries(result.templates).map(([kind, text]) => [kind, fromB64(text)])) };
}
export const resolvePackKind = (pack, kind) => {
  const kinds = Object.keys(pack.manifest.kinds);
  return kind && kinds.includes(kind) ? kind : kinds.length === 1 ? kinds[0] : "report";
};
export const packTemplate = (pack, kind) => pack.templates.get(resolvePackKind(pack, kind));
// Synchronous in the engine; the unit tests cover it with the real engine.
export const packRoleWarnings = () => [];
export async function markdownToHwpx(markdown, options = {}) {
  const { warnings, template, ...rest } = options;
  const result = await call("markdownToHwpx", { markdown, options: { ...rest, ...(template ? { template: toB64(template) } : {}) } });
  if (warnings) warnings.push(...result.warnings);
  return fromB64(result.data).buffer;
}
export const hwpxToProfile = (data) => call("hwpxToProfile", { data: toB64(data) });
export const renderHwpxToSvg = (data, options) => call("renderHwpxToSvg", { data: toB64(data), options });
const measuredApplied = new WeakMap();
export async function measurePdfLayout(data) {
  const result = await call("measurePdfLayout", { data: toB64(data) });
  measuredApplied.set(result.spec, result.applied);
  return result.spec;
}
export const applyMeasuredLayout = (base, spec) => measuredApplied.get(spec)[normalizeGongmunPreset(base.preset)];
`;

const fixtures = {
  kordocEngine: `export async function renderQuickHwpxPreview(markdown, options = {}) {
    const { images, ...rest } = options;
    (globalThis.previewCalls ||= []).push({ markdown, options: rest });
    return globalThis.__kordoc("preview", { markdown, options: rest });
  }`,
  obsidianImageLoader: "export function createObsidianImageLoader() { return async () => null; }",
  exportPreparation: "export async function prepareExportMarkdown(host, body) { return { markdown: body, warnings: [] }; }",
  vaultAssemblyHost: "export function createVaultAssemblyHost() { return {}; }",
  fileGateway: "export const bytesAsArrayBuffer = (data) => (data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));"
};

const bundle = await build({
  stdin: {
    contents: [
      "export { GongmunStyleModal } from './src/ui/GongmunStyleModal';",
      "export { GongmunLookModal } from './src/ui/GongmunLookModal';",
      "export * as forms from './src/io/gongmunExport';",
      "export * as looks from './src/io/gongmunForms';",
      "export * as library from './src/io/templateLibrary';"
    ].join("\n"),
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "SampleUi",
  platform: "browser",
  plugins: [{
    name: "host-fixture",
    setup(build) {
      build.onResolve({ filter: /^(obsidian|kordoc)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      build.onResolve({ filter: /\/io\/(kordocEngine|exportPreparation|vaultAssemblyHost|obsidianImageLoader|fileGateway)$/ }, (args) => ({ path: args.path.split("/").pop(), namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: args.path === "obsidian" ? host : args.path === "kordoc" ? kordoc : fixtures[args.path], loader: "js" }));
    }
  }]
});

const css = readFileSync("styles.css", "utf8");
const browser = await chromium.launch({ executablePath: process.env.HANMARK_BROWSER_EXECUTABLE || undefined, headless: true });

const REPORT_PDF_NOTE = [
  "# 2027학년도 교육과정 개편 계획", "", "## 추진 배경", "",
  ...Array.from({ length: 4 }, (_, index) => [`- 평가 기준을 다시 설계할 필요가 있음 (${index + 1})`, "  - 실습과목 열두 개 가운데 아홉 개가 해당함", "    - 설문 기간은 10월 5일부터 16일까지임"]).flat(),
  ""
].join("\n");
/** A PDF with real text: a Kordoc official document drawn to SVG, one page per sheet, printed by Chromium. */
async function printedPdf(markdown, gongmun) {
  const render = await kordocNode.renderHwpxToSvg(await kordocNode.markdownToHwpx(markdown, { gongmun }), { reflow: true });
  const pageHeight = 841.88;
  const gap = render.pageCount > 1 ? (render.height - render.pageCount * pageHeight) / (render.pageCount - 1) : 0;
  const sheets = Array.from({ length: render.pageCount }, (_, index) =>
    render.svg.replace(/^<svg\b[^>]*>/u, (open) =>
      open.replace(/viewBox="[^"]*"/u, `viewBox="0 ${index * (pageHeight + gap)} 595.28 ${pageHeight}"`).replace(/\swidth="[^"]*"/u, ' width="210mm"').replace(/\sheight="[^"]*"/u, ' height="297mm"')
    )
  );
  const sheet = await browser.newPage();
  try {
    await sheet.setContent(`<!doctype html><style>@page{size:210mm 297mm;margin:0}html,body{margin:0}svg{display:block;break-after:page}</style>${sheets.join("")}`);
    return new Uint8Array(await sheet.pdf({ preferCSSPageSize: true, printBackground: true }));
  } finally {
    await sheet.close();
  }
}
try {
  const page = await browser.newPage({ viewport: { width: 1560, height: 1200 }, deviceScaleFactor: 1.5 });
  await page.exposeFunction("__kordoc", kordocCall);
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light"><div id="stage" style="margin:16px"></div></body></html>`);
  await page.addStyleTag({ content: css });
  await page.addStyleTag({
    content: "body{--interactive-accent:#7c3aed;--text-on-accent:#fff;--background-primary:#fff;--background-secondary:#f5f5f7;--background-modifier-border:#ddd;--background-modifier-hover:#eee;--text-muted:#666;--text-faint:#999;--text-normal:#222;--text-error:#c62828;--font-ui-small:13px;--font-ui-smaller:12px;--font-semibold:600;font-family:'Malgun Gothic',system-ui,sans-serif;font-size:14px;color:#222;background:#e9e9ee}" +
      ".modal{padding:18px;border:1px solid #ddd;border-radius:10px;background:#fff;margin-bottom:16px}.modal-title{font-size:18px;font-weight:700;margin-bottom:10px}button,select,input{font:inherit}button{padding:4px 10px;border:1px solid #ccc;border-radius:6px;background:#f7f7f8;cursor:pointer}select,input[type=search],input[type=text]{padding:4px 8px;border:1px solid #ccc;border-radius:6px;background:#fff}.mod-cta{background:#7c3aed;color:#fff;border-color:#7c3aed}.mod-warning{color:#c62828}.setting-item{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 0;border-top:1px solid #eee}.setting-item-info{flex:1 1 auto;min-width:0}.setting-item-name{font-weight:600}.setting-item-description{color:#666;font-size:12px;line-height:1.45}.setting-item-control{flex:0 0 auto;display:flex;gap:6px}.setting-item-heading{border-top:0}.hanmark-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}"
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  const queue = async (name, bytes) => page.evaluate(({ name, data }) => { files.push({ name, bytes: Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) }); }, { name, data: b64(bytes) });
  await page.evaluate(({ note }) => {
    // setContent pages are not secure contexts, where Chromium hides randomUUID.
    if (typeof crypto.randomUUID !== "function") { let serial = 0; crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`; }
    globalThis.notices = [];
    globalThis.files = [];
    globalThis.saved = [];
    globalThis.changed = [];
    globalThis.plugin = { settings: {}, saveSettings: async () => {} };
    globalThis.app = {
      metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
      vault: {
        getFiles: () => (globalThis.vaultFiles || []).map((item) => ({ name: item.name, path: "견본/" + item.name, extension: item.name.split(".").pop(), stat: { mtime: 1 } })),
        readBinary: async (file) => globalThis.vaultFiles.find((item) => item.name === file.name).bytes.buffer
      }
    };
    globalThis.gateway = {
      pickFiles: async (options) => {
        const at = files.findIndex((item) => options.extensions.includes(item.name.split(".").pop().toLowerCase()));
        return at < 0 ? [] : files.splice(at, 1);
      },
      saveFile: async (data, name) => { saved.push({ name, bytes: data instanceof Uint8Array ? data : new Uint8Array(data) }); return { cancelled: false, fileName: name }; }
    };
    globalThis.pickerHost = () => ({ library: plugin, toggleFavorite: async () => {} });
    globalThis.openStyle = (id, startFromSample = false) => {
      globalThis.modal = new SampleUi.GongmunStyleModal(app, {
        templateHost: plugin, gateway, lookPicker: pickerHost, startFromSample,
        currentNote: () => ({ markdown: note, title: "워크숍 준비안" }),
        changed: (activeId) => changed.push(activeId)
      }, id, "report");
      modal.open();
    };
    openStyle(null, true);
  }, { note: USER_NOTE });

  const panel = page.locator(".hanmark-sample-look");
  const settled = async () => {
    await page.waitForFunction(() => !document.querySelector(".hanmark-sample-look-busy"), null, { timeout: 60000 });
  };
  const papers = async () => {
    await page.waitForFunction(() => document.querySelector("#hanmark-sample-paper svg") && document.querySelector("#hanmark-sample-note-paper svg"), null, { timeout: 60000 });
  };

  // 01: the panel is the first thing in the window, with four ways in.
  await panel.waitFor();
  assert.equal(await panel.locator("h3").innerText(), "견본으로 내 모양 만들기");
  assert.deepEqual(await panel.locator(".hanmark-sample-look-actions").first().locator("button").allInnerTexts(), ["견본 HWPX 고르기…", "Vault에서 고르기…", "보고서 PDF에서 배우기…", "파일에서 가져오기…"]);
  assert.equal(await page.locator("#hanmark-sample-summary").count(), 0);
  await page.locator(".modal").first().screenshot({ path: join(out, "01-pick-sample.png") });

  // Caps give clear messages and learn nothing.
  await queue("너무 큰 견본.hwpx", new Uint8Array(20 * 1024 * 1024 + 1));
  await page.locator("#hanmark-sample-pick-file").click();
  await settled();
  assert.match(await page.locator("#hanmark-sample-message").innerText(), /견본이 20MB를 넘어 읽지 않았습니다/u);
  await queue("글이 아닌 파일.hwpx", new Uint8Array([1, 2, 3, 4, 5]));
  await page.locator("#hanmark-sample-pick-file").click();
  await settled();
  assert.match(await page.locator("#hanmark-sample-message").innerText(), /HWPX 파일이 아니거나 읽을 수 없습니다/u);
  await queue("너무 큰 모양.kpack", new Uint8Array(1024 * 1024 + 1));
  await page.locator("#hanmark-sample-import-pack").click();
  await settled();
  assert.match(await page.locator("#hanmark-sample-message").innerText(), /모양 파일이 1MB를 넘어 가져오지 않았습니다/u);
  assert.equal(await page.locator("#hanmark-sample-summary").count(), 0);

  // 02: learn from a sample; the summary says what was taken and what was not.
  await queue(firstSample, samples[firstSample]);
  await page.locator("#hanmark-sample-pick-file").click();
  await settled();
  await page.locator("#hanmark-sample-summary").waitFor();
  assert.match(await page.locator("#hanmark-sample-message").innerText(), /견본에서 모양을 배웠습니다/u);
  const taken = await page.locator("#hanmark-sample-taken").innerText();
  assert.match(taken, /쪽 210×297mm, 여백 위 [\d.]+ · 아래 [\d.]+ · 왼쪽 [\d.]+ · 오른쪽 [\d.]+mm/u);
  assert.match(taken, /견본에 있는 부분: /u);
  const firstUse = await page.locator("#hanmark-sample-use").inputValue();
  assert.ok(["template", "measured"].includes(firstUse));
  const nameInput = page.locator(".hanmark-gongmun-style-form .setting-item").filter({ hasText: "양식 이름" }).locator("input").first();
  assert.equal(await nameInput.inputValue(), firstSample.replace(/\.[^.]+$/u, "").slice(0, 60));
  if (!real.length) {
    assert.match(taken, /본문 글꼴·크기: /u);
    assert.match(taken, /□ 1단계 항목: □ /u);
    assert.match(taken, /표 머리 음영: #[0-9A-F]{6}/u);
  }
  await panel.screenshot({ path: join(out, "02-learned-summary.png") });

  // 03: the sample's first page next to the user's note in the look.
  await papers();
  const drawn = await page.evaluate(() => ({ calls: previewCalls.length, last: previewCalls.at(-1), sample: document.querySelector("#hanmark-sample-paper svg").getAttribute("viewBox"), leftover: [...document.querySelectorAll("#hanmark-sample-leftover li")].map((item) => item.textContent), note: document.querySelector("#hanmark-sample-note-paper svg").textContent }));
  assert.match(drawn.sample, /^0 0 [\d.]+ [\d.]+$/u);
  const [, , sampleWidth, sampleHeight] = drawn.sample.split(" ").map(Number);
  assert.ok(Math.abs(sampleHeight / sampleWidth - 297 / 210) < 0.01, "the sample paper shows one page");
  assert.match(drawn.note.replace(/\s+/gu, ""), /가평과홍천을검토한다/u, "the user's own note is drawn");
  assert.equal(drawn.last.options.gongmunTitle, "워크숍 준비안");
  assert.equal(Boolean(drawn.last.options.sampleLook), firstUse === "template");
  await page.locator(".modal").first().screenshot({ path: join(out, "03-side-by-side.png") });

  // The other way of making it, and another frame: the preview is drawn again each time.
  const otherUse = firstUse === "template" ? "measured" : "template";
  await page.locator("#hanmark-sample-use").selectOption(otherUse);
  await papers();
  await page.waitForFunction((count) => previewCalls.length > count, drawn.calls);
  assert.equal(Boolean((await page.evaluate(() => previewCalls.at(-1))).options.sampleLook), otherUse === "template");
  await page.locator("#hanmark-sample-use").selectOption("measured");
  await papers();
  const before = await page.evaluate(() => previewCalls.length);
  await page.locator("#hanmark-style-frame").selectOption("gaejosik");
  await papers();
  await page.waitForFunction((count) => previewCalls.length > count, before);
  assert.equal((await page.evaluate(() => previewCalls.at(-1))).options.gongmun.preset, "gaejosik");
  await page.locator("#hanmark-style-frame").selectOption("report");
  await page.locator("#hanmark-sample-use").selectOption(firstUse);
  await papers();

  // Save: one of 내 양식, with the pack inside the settings.
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.waitForFunction(() => changed.length === 1);
  const stored = await page.evaluate(() => {
    const record = Object.values(SampleUi.library.getTemplateLibrary(plugin).gongmunTemplates)[0];
    return { id: record.id, name: record.name, preset: record.preset, use: record.sample.use, pack: record.sample.pack.length, leftover: record.sample.leftover, options: record.options, json: JSON.stringify(plugin.settings).length };
  });
  assert.equal(stored.preset, "report");
  assert.equal(stored.use, firstUse);
  assert.ok(stored.pack > 1000 && stored.pack < 1_400_000);
  assert.ok(stored.leftover.every((text) => text.trim().length <= 1), "fixed text longer than a mark was removed on save");
  if (drawn.leftover.length) {
    const noteText = drawn.note.replace(/\s+/gu, "");
    for (const text of drawn.leftover.filter((item) => item.trim().length > 6)) assert.ok(!noteText.includes(text.replace(/\s+/gu, "")), `fixed text is not in the preview: ${text}`);
  }

  // 04: the look in the chooser like any other, and an export made with it.
  const listed = await page.evaluate((id) => {
    const { forms, looks } = SampleUi;
    const entry = looks.listGongmunLooks(plugin, "report").find((item) => item.id === id || item.name === Object.values(SampleUi.library.getTemplateLibrary(plugin).gongmunTemplates)[0].name);
    const form = forms.listGongmunForms(plugin).find((item) => item.kind === "custom");
    const plan = forms.planGongmunExport(app, { basename: "워크숍 준비안", path: "워크숍 준비안.md" }, plugin, undefined, form.id);
    return { entry, form, label: forms.gongmunFileLabel(plugin, form.id, "ko"), options: JSON.parse(JSON.stringify(forms.gongmunGenerateOptions(plan))) };
  }, stored.id);
  assert.ok(listed.entry, "the look is listed for its frame");
  assert.equal(listed.entry.kind, "custom");
  assert.ok(listed.label.includes(stored.name.replace(/\s+/gu, " ").slice(0, 8)), `file label ${listed.label}`);
  await page.evaluate(() => {
    new SampleUi.GongmunLookModal(app, { host: pickerHost(), frame: "report", current: "", pick: (look, name) => { globalThis.pickedLook = { look, name }; } }).open();
  });
  const chooser = page.locator(".hanmark-look-modal");
  await chooser.getByText(stored.name, { exact: false }).first().waitFor();
  await chooser.screenshot({ path: join(out, "04-chooser-with-new-look.png") });
  await chooser.getByText(stored.name, { exact: false }).first().click();
  assert.equal((await page.evaluate(() => pickedLook)).name, stored.name);
  const exported = await kordocCall("generate", { markdown: USER_NOTE, options: listed.options });
  const sampleMeasure = await measureModule.measureSample(samples[firstSample]);
  assert.deepEqual(exported.measure.marginsMm, sampleMeasure.marginsMm, "the export has the sample's margins");
  assert.match(exported.markdown, /가평과 홍천을 검토한다/u);

  // Rename, and share as a file.
  await page.evaluate((id) => openStyle(id), stored.id);
  await page.locator("#hanmark-sample-summary").waitFor();
  await papers();
  const renamed = "미디어스쿨 보고서";
  await page.locator(".hanmark-gongmun-style-form .setting-item").filter({ hasText: "양식 이름" }).locator("input").first().fill(renamed);
  await page.locator("#hanmark-sample-export-pack").click();
  await page.waitForFunction(() => saved.length === 1);
  const packFile = await page.evaluate(() => ({ name: saved[0].name, size: saved[0].bytes.length, data: btoa(String.fromCharCode(...saved[0].bytes)) }));
  assert.equal(packFile.name, `${renamed}.kpack`);
  assert.ok(packFile.size < 1024 * 1024);
  await kordocNode.loadAgencyPack(bytesOf(packFile.data));
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.waitForFunction(() => changed.length === 2);
  assert.equal(await page.evaluate(() => Object.values(SampleUi.library.getTemplateLibrary(plugin).gongmunTemplates)[0].name), renamed);

  // 05: import the file on "another computer" (fresh settings): same values, missing fonts listed.
  await page.evaluate(() => { plugin.settings = {}; openStyle(null); });
  await queue(`${renamed}.kpack`, bytesOf(packFile.data));
  await page.locator("#hanmark-sample-import-pack").click();
  await settled();
  await page.locator("#hanmark-sample-summary").waitFor();
  assert.match(await page.locator("#hanmark-sample-message").innerText(), /모양을 가져왔습니다/u);
  assert.equal(await page.locator(".hanmark-gongmun-style-form .setting-item").filter({ hasText: "양식 이름" }).locator("input").first().inputValue(), renamed);
  assert.equal(await page.locator("#hanmark-sample-use").inputValue(), firstUse);
  await papers();
  await page.locator(".modal").last().screenshot({ path: join(out, "05-pack-import.png") });
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.waitForFunction(() => changed.length === 3);
  const imported = await page.evaluate(() => Object.values(SampleUi.library.getTemplateLibrary(plugin).gongmunTemplates)[0]);
  assert.deepEqual(imported.options, { ...stored.options }, "the imported form has the maker's values");
  assert.equal(imported.sample.use, firstUse);

  // A sample without item shapes, in a font this computer lacks: measured values, and the font guide.
  await page.evaluate(() => openStyle(null));
  await page.evaluate((files) => { globalThis.vaultFiles = files.map((item) => ({ name: item.name, bytes: Uint8Array.from(atob(item.data), (c) => c.charCodeAt(0)) })); }, [{ name: letterSample, data: b64(samples[letterSample]) }]);
  await page.locator("#hanmark-sample-pick-vault").click();
  const vault = page.locator(".hanmark-sample-vault-modal");
  await vault.locator("#hanmark-sample-vault-filter").fill(letterSample.slice(0, 2));
  await vault.locator(".hanmark-sample-vault-item").first().click();
  await settled();
  await page.locator("#hanmark-sample-summary").waitFor();
  if (!real.length) {
    assert.equal(await page.locator("#hanmark-sample-use").inputValue(), "measured");
    assert.match(await page.locator("#hanmark-sample-not-taken").innerText(), /□ 1단계 항목: 견본에 없어 본문 글꼴\(한마크 없는 글꼴\)을 씁니다/u);
    assert.match(await page.locator("#hanmark-sample-fonts").innerText(), /한마크 없는 글꼴/u);
    assert.match(await panel.innerText(), /견본에 본문이나 항목 모양이 부족해/u);
  }
  await papers();
  await page.locator(".modal").last().screenshot({ path: join(out, "06-measured-look.png") });

  // A report PDF: what was measured is listed and lands in the options, to be checked before saving.
  await page.evaluate(() => { for (const node of document.querySelectorAll(".modal")) node.remove(); openStyle(null); });
  await queue("기관 보고서.pdf", await printedPdf(REPORT_PDF_NOTE, { preset: "gaejosik", margins: { top: 20, bottom: 15, left: 22, right: 22 } }));
  await page.locator("#hanmark-sample-pick-pdf").click();
  await settled();
  assert.match(await page.locator("#hanmark-sample-message").innerText(), /PDF에서 잰 값을 아래 옵션에 채웠습니다/u);
  const applied = await page.locator("#hanmark-sample-pdf-applied li").allInnerTexts();
  assert.ok(applied.length >= 3, applied.join(" / "));
  assert.ok(applied.some((line) => /^□ 1단계 항목: .+ \d+pt$/u.test(line)), applied.join(" / "));
  assert.ok(applied.includes("여백: 왼쪽 22mm (줄이 오른쪽 끝까지 닿지 않아 오른쪽은 틀의 값)"), applied.join(" / "));
  const levelFont = await page.locator(".hanmark-gongmun-style-group").filter({ hasText: "1단계" }).locator("input[type=text]").first().inputValue();
  assert.ok(levelFont.length > 0, "a measured level font is in the form");
  const marginInputs = await page.locator(".hanmark-gongmun-style-group").filter({ hasText: "여백" }).last().locator("input[type=text]").evaluateAll((nodes) => nodes.map((node) => node.value));
  const frameMargins = (await measureModule.measureSample(new Uint8Array(await kordocNode.markdownToHwpx("", { gongmun: { preset: "report" } })))).marginsMm;
  assert.deepEqual(marginInputs.slice(0, 4), [String(frameMargins.top), String(frameMargins.bottom), "22", String(frameMargins.right)], "only the left margin comes from this PDF");
  assert.equal(await page.locator("#hanmark-sample-summary").count(), 0, "a PDF leaves no sample in the form");
  await page.locator(".hanmark-gongmun-style-group").filter({ hasText: "1단계" }).evaluate((node) => { node.open = true; });
  await panel.last().screenshot({ path: join(out, "07-pdf-learned.png") });
  await queue("항목 없는 안내문.pdf", await printedPdf(LETTER_NOTE, { preset: "notice" }));
  await page.locator("#hanmark-sample-pick-pdf").click();
  await settled();
  assert.match(await page.locator("#hanmark-sample-message").innerText(), /이 PDF에서는 모양을 재지 못했습니다/u);

  // Delete.
  await page.evaluate(() => { for (const node of document.querySelectorAll(".modal")) node.remove(); });
  const keptId = await page.evaluate(() => Object.keys(SampleUi.library.getTemplateLibrary(plugin).gongmunTemplates)[0]);
  await page.evaluate((id) => openStyle(id), keptId);
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await page.locator(".modal").last().getByRole("button", { name: "삭제", exact: true }).click();
  await page.waitForFunction(() => Object.keys(SampleUi.library.getTemplateLibrary(plugin).gongmunTemplates).length === 0);

  console.log(JSON.stringify({ firstSample, firstUse, storedPackChars: stored.pack, settingsChars: stored.json, packFileBytes: packFile.size, exportMargins: exported.measure.marginsMm }));
  console.log("Sample look UI: pick, caps, summary, side-by-side preview, both ways of making, frame change, save, chooser, export, rename, pack export and import, vault pick, measured look with missing font, report PDF, and delete passed.");
} finally {
  await browser.close();
}
