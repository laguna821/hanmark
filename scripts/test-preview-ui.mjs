import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

// The real HWPX preview view and styles.css in Chromium, showing real Kordoc renders of
// a 업무보고 (cover, table of contents, body) made in Node first; only Obsidian's host
// primitives and the render call are replaced (R-028). Screenshots land in
// test-artifacts/preview-ui for review.
const out = "test-artifacts/preview-ui";
mkdirSync(out, { recursive: true });

const body = (word) => [
  "# 2027년 업무 추진 계획",
  "",
  "## 추진 배경",
  "",
  "배경 설명 문단입니다.",
  "",
  "### 현황",
  "",
  "- 첫째 항목",
  "- 둘째 항목",
  "",
  "## 추진 내용",
  "",
  `${word} `.repeat(420),
  "",
  "### 세부 과제",
  "",
  "| 과제 | 담당 |",
  "|---|---|",
  "| 가 | 나 |",
  "",
  "## 기대 효과",
  "",
  "효과 설명."
].join("\n");
// The edit keeps the text length, so the redraw has the same number of pages as before
// (Kordoc 4.25.0 breaks pages closer to Hancom Office; a longer word used to add a page).
const notes = { v1: body("내용 문단입니다."), v2: body("내용 문단입니까.") };

writeFileSync(`${out}/notes.json`, JSON.stringify(notes));
writeFileSync(
  `${out}/render-fixture.ts`,
  `import { readFileSync, writeFileSync } from "node:fs";
import { renderQuickHwpxPreview } from "../../src/io/kordocEngine";
import { gongmunGenerateOptions, planGongmunExport } from "../../src/io/gongmunExport";
const notes = JSON.parse(readFileSync(process.argv[2], "utf8")) as Record<string, string>;
const app = { metadataCache: { getFileCache: () => ({ frontmatter: {} }) } } as never;
const file = { basename: "note", path: "note.md" } as never;
const plan = planGongmunExport(app, file, { settings: {}, saveSettings: async () => {} }, undefined, "preset:ministry");
void (async () => {
  const svgs: Record<string, string> = {};
  for (const markdown of Object.values(notes)) {
    svgs[markdown] = (await renderQuickHwpxPreview(markdown, gongmunGenerateOptions(plan))).render.svg;
  }
  writeFileSync(process.argv[3], JSON.stringify(svgs));
})();
`
);
execFileSync(process.execPath, ["--import", "tsx", `${out}/render-fixture.ts`, `${out}/notes.json`, `${out}/svgs.json`], { stdio: "inherit" });
const svgs = JSON.parse(readFileSync(`${out}/svgs.json`, "utf8"));

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
export function setIcon(element, name) {
  element.querySelector("svg")?.remove();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("data-icon", name);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", name === "chevron-left" ? "M10 3 5 8l5 5" : name === "chevron-right" ? "M6 3l5 5-5 5" : name === "minus" ? "M3 8h10" : name === "plus" ? "M3 8h10M8 3v10" : "M8 2v3M8 11v3M2 8h3M11 8h3");
  path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.6");
  svg.append(path);
  element.prepend(svg);
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
export class MarkdownView {}
export class WorkspaceLeaf {}
export class Notice { constructor(message) { (globalThis.notices ||= []).push(message); } }
export const Platform = { isWin: true, isMacOS: false, isDesktopApp: true };
`;

const fixtures = {
  kordocEngine: `export async function renderQuickHwpxPreview(markdown) {
    const delay = globalThis.renderDelay || 0;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (globalThis.failNext) { globalThis.failNext = false; throw new Error("fixture failure"); }
    const svg = globalThis.svgs[markdown];
    return { render: { svg, warnings: ["fixture note"], pageCount: svg.split("data-page=").length - 1 }, warnings: [], imageCount: 0, embeddedImageCount: 0, embeddedImageOccurrences: 0, imageFailures: [] };
  }`,
  exportPreparation: "export async function prepareExportMarkdown(host, body) { return { markdown: body, warnings: [] }; }",
  vaultAssemblyHost: "export function createVaultAssemblyHost() { return {}; }",
  obsidianImageLoader: "export function createObsidianImageLoader() { return async () => null; }",
  documentStyle: "export function documentStyleSummary() { return \"\"; }",
  // The toolbar's frame and look picker (R-030) reads the real form model; only the engine is a stand-in.
  kordoc: 'export const VERSION = "fixture"; export const AGENCY_COMMON_NAME = "공통"; export const agencyNames = () => []; export const agencyStyle = () => ({}); export const PRESET_ALIAS = {}; export const normalizeGongmunPreset = (value) => value; export const incompatibleGongmunWarnings = () => []; export const measureTextWidth = () => 0; export const simulateWrap = () => ({ lines: 1 }); export const markdownToHwpx = () => { throw new Error("not part of this harness"); }; export const measurePdfLayout = markdownToHwpx; export const applyMeasuredLayout = markdownToHwpx; export const buildAgencyPack = markdownToHwpx; export const loadAgencyPack = markdownToHwpx; export const packTemplate = markdownToHwpx; export const resolvePackKind = markdownToHwpx; export const packRoleWarnings = () => [];'
};

const bundle = await build({
  stdin: {
    contents: "export { QuickHwpxPreviewView } from './src/ui/QuickHwpxPreviewView';",
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "PreviewUi",
  plugins: [{
    name: "host-fixture",
    setup(build) {
      build.onResolve({ filter: /^(obsidian|kordoc)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      build.onResolve({ filter: /^\.\.\/io\/(kordocEngine|exportPreparation|vaultAssemblyHost|obsidianImageLoader|documentStyle)$/ }, (args) => ({
        path: args.path.split("/").pop(),
        namespace: "fixture"
      }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
        contents: args.path === "obsidian" ? host : fixtures[args.path],
        loader: "js"
      }));
    }
  }]
});

const css = readFileSync("styles.css", "utf8");
const browser = await chromium.launch({ executablePath: process.env.HANMARK_BROWSER_EXECUTABLE || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 760, height: 700 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light">
    <div id="pane" style="width:720px;height:640px;margin:20px;border:1px solid #ddd;background:#fff"></div></body></html>`);
  await page.addStyleTag({ content: css });
  await page.addStyleTag({
    content: "body{--interactive-accent:#7c3aed;--interactive-accent-hover:#8b5cf6;--text-accent:#7c3aed;--background-primary:#fff;--background-secondary:#f3f3f5;--background-modifier-border:#ddd;--background-modifier-hover:#eee;--text-muted:#666;--text-normal:#222;--text-error:#c62828;--text-warning:#b26a00;--color-yellow:#e0ac00;--font-ui-small:13px;--font-ui-smaller:12px;font-family:system-ui,sans-serif}" +
      ".workspace-leaf-content{height:100%}.view-header{display:none}.view-content{position:relative}button{font:inherit}"
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(({ svgs, notes }) => {
    globalThis.svgs = svgs;
    globalThis.notes = notes;
    globalThis.events = {};
    globalThis.settings = { follow: true };
    globalThis.noteText = notes.v1;
    globalThis.cursor = { line: 0, ch: 0 };
    const workspace = {
      on(name, callback) { (events[name] ||= []).push(callback); return { name }; },
      requestSaveLayout() { globalThis.layoutSaves = (globalThis.layoutSaves || 0) + 1; },
      getActiveViewOfType() { return null; }
    };
    globalThis.sourceView = {
      file: { path: "note.md", basename: "note" },
      editor: { getValue: () => noteText, getCursor: () => cursor }
    };
    globalThis.view = new PreviewUi.QuickHwpxPreviewView({ app: { workspace } }, {
      profile: () => undefined,
      documentStyle: () => undefined,
      sourceView: () => sourceView,
      livePreviewEnabled: () => true,
      autoPauseEnabled: () => false,
      gongmunForms: () => [],
      subscribeActivity: (listener) => { globalThis.activity = listener; return () => {}; },
      followCursor: () => settings.follow,
      setFollowCursor: async (on) => { settings.follow = on; }
    });
    document.getElementById("pane").append(view.containerEl);
  }, { svgs, notes });

  const root = () => page.locator("#pane .hanmark-quick-preview");
  const probe = () => page.evaluate(() => {
    const element = view.containerEl.children[1];
    const chip = element.querySelector(".hanmark-preview-chip");
    return {
      page: element.querySelector(".hanmark-preview-nav-page")?.textContent,
      chip: chip?.dataset.state,
      ring: chip?.dataset.phase ?? null,
      flow: element.querySelector(".hanmark-flow-line")?.dataset.active,
      loading: element.querySelector(".hanmark-preview-loading") !== null,
      papers: element.querySelectorAll(".hanmark-preview-paper").length,
      banner: element.querySelector(".hanmark-preview-banner")?.textContent ?? null,
      width: element.querySelector(".hanmark-preview-paper svg")?.getAttribute("width"),
      zoomed: element.querySelector(".hanmark-preview-paper")?.classList.contains("is-zoomed") ?? false,
      zoom: element.querySelector(".hanmark-preview-nav-zoom")?.textContent,
      y: view.visibleY(0)
    };
  });
  const settle = async (predicate, timeout = 4000) => {
    const started = Date.now();
    for (;;) {
      const state = await probe();
      if (predicate(state)) return state;
      if (Date.now() - started > timeout) throw new Error(`timed out: ${JSON.stringify(state)}`);
      await page.waitForTimeout(50);
    }
  };

  // First picture: the loading box, then the pages with the navigation row.
  await page.evaluate(() => { globalThis.renderDelay = 250; void view.onOpen(); });
  await page.waitForTimeout(80);
  let state = await probe();
  assert.equal(state.loading, true, "the first picture shows the loading box");
  assert.equal(state.chip, "working");
  state = await settle((item) => item.papers === 1 && item.chip === "ready");
  const total = await page.evaluate(() => view.shown.index.pages.length);
  assert.ok(total >= 5, `cover, contents, and body pages: ${total}`);
  assert.equal(state.page, `1 / ${total}쪽`);
  assert.equal(state.zoom, "폭 맞춤");
  await page.screenshot({ path: `${out}/1-first.png` });

  // Page buttons move one page at a time.
  await page.locator("#pane .hanmark-preview-nav-button[aria-label='다음 쪽']").click();
  state = await settle((item) => item.page === `2 / ${total}쪽`);
  await page.locator("#pane .hanmark-preview-nav-button[aria-label='다음 쪽']").click();
  state = await settle((item) => item.page === `3 / ${total}쪽`);
  await root().evaluate((element) => { element.scrollTop += 180; });
  await page.waitForTimeout(80);

  // A redraw keeps the old picture on screen, rings while drawing, never empties the
  // stage, and returns to the same place. The open warnings stay open.
  await page.locator("#pane .hanmark-preview-warnings summary").evaluate((summary) => { summary.parentElement.open = true; });
  const before = (await probe()).y;
  await page.evaluate(() => {
    globalThis.emptied = 0;
    globalThis.mutations = 0;
    const stage = view.containerEl.querySelector(".hanmark-preview-stage");
    new MutationObserver(() => {
      mutations += 1;
      if (!stage.querySelector(".hanmark-preview-paper")) emptied += 1;
    }).observe(stage, { childList: true });
    globalThis.renderDelay = 700;
    noteText = notes.v2;
    view.forceRefresh();
  });
  await page.waitForTimeout(200);
  state = await probe();
  assert.deepEqual([state.papers, state.loading, state.flow, state.chip, state.ring], [1, false, "true", "working", "waiting"]);
  await page.screenshot({ path: `${out}/2-redrawing.png` });
  await page.locator("#pane .hanmark-hwpx-preview-header").screenshot({ path: `${out}/2-redrawing-header.png` });
  await page.locator("#pane .hanmark-preview-chip").screenshot({ path: `${out}/2-redrawing-chip.png` });
  state = await settle((item) => item.chip === "ready");
  assert.equal(await page.evaluate(() => emptied), 0, "the stage never goes blank");
  assert.ok(Math.abs(state.y - before) < 2, `same place after the redraw: ${before} → ${state.y}`);
  assert.equal(state.page, `3 / ${total}쪽`);
  assert.equal(await page.evaluate(() => view.containerEl.querySelector(".hanmark-preview-warnings").open), true);

  // Nothing changed: activating the pane or typing without a change does not redraw.
  await page.evaluate(() => { mutations = 0; renderDelay = 0; for (const callback of events["active-leaf-change"] || []) callback(); });
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => mutations), 0, "the same picture is not drawn again");

  // Zoom steps from the fitted scale, keeps the place, and is saved with the pane.
  const fitted = (await probe()).y;
  await page.locator("#pane .hanmark-preview-nav-button[aria-label='확대']").click();
  state = await probe();
  assert.equal(state.zoom, "90%");
  assert.equal(state.width, String(Math.round(595.28 * (4 / 3) * 0.9)));
  assert.equal(state.zoomed, true);
  assert.ok(Math.abs(state.y - fitted) < 2, `zoom keeps the place: ${fitted} → ${state.y}`);
  assert.equal(await page.evaluate(() => view.getState().zoom), 90);
  await page.locator("#pane .hanmark-preview-nav-button[aria-label='확대']").click();
  assert.equal((await probe()).zoom, "100%");
  await page.screenshot({ path: `${out}/3-zoomed.png` });
  await page.locator("#pane .hanmark-preview-nav-zoom").click();
  state = await probe();
  assert.deepEqual([state.zoom, state.width, state.zoomed], ["폭 맞춤", "100%", false]);

  // Follow: the cursor in the last section brings the last page into view; a scroll by
  // hand pauses following for a moment.
  const lastHeading = (await page.evaluate(() => noteText.split("\n").indexOf("## 기대 효과")));
  await page.evaluate((line) => {
    view.lastUserScroll = 0;
    cursor = { line, ch: 0 };
    activity({ view: sourceView, path: "note.md", selectionSet: true, docChanged: false, focusChanged: false });
  }, lastHeading);
  state = await settle((item) => item.page === `${total} / ${total}쪽`);
  await root().dispatchEvent("wheel");
  await page.evaluate(() => {
    cursor = { line: 0, ch: 0 };
    activity({ view: sourceView, path: "note.md", selectionSet: true, docChanged: false, focusChanged: false });
  });
  await page.waitForTimeout(600);
  assert.equal((await probe()).page, `${total} / ${total}쪽`, "a scroll by hand pauses following");
  await page.evaluate(() => {
    view.lastUserScroll = 0;
    activity({ view: sourceView, path: "note.md", selectionSet: true, docChanged: false, focusChanged: false });
  });
  await settle((item) => item.page === `1 / ${total}쪽`);
  await page.evaluate(() => { settings.follow = false; view.refreshControls(); });
  assert.equal(await page.locator("#pane .hanmark-preview-nav-button[aria-label='편집 위치 따라가기']").getAttribute("aria-pressed"), "false");

  // A failed redraw keeps the picture under a notice.
  await page.evaluate(() => { failNext = true; view.forceRefresh(); });
  state = await settle((item) => item.chip === "failed");
  assert.equal(state.papers, 1);
  assert.match(state.banner, /이전 미리보기/u);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/4-failed.png` });
  await page.evaluate(() => view.forceRefresh());
  state = await settle((item) => item.chip === "ready");
  assert.equal(state.banner, null, "the next picture clears the notice");

  // Reduced motion: the chip's ring stands still.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => { renderDelay = 500; view.forceRefresh(); });
  await page.waitForTimeout(150);
  assert.equal(
    await page.evaluate(() => getComputedStyle(view.containerEl.querySelector(".hanmark-preview-chip"), "::before").animationName),
    "none"
  );
  await settle((item) => item.chip === "ready");
  console.log(`Preview UI: first picture, page buttons, redraw without blanking at the same place, no redraw without change, zoom with place kept, follow with pause, kept picture on failure, and reduced motion passed (${total} pages).`);
} finally {
  await browser.close();
}
