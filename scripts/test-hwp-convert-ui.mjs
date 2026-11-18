import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

// The real Hangul document viewer toolbar, the "HWPX로 변환" flow, its password prompt
// and its report (R-034) in Chromium with styles.css. Only Obsidian's host primitives,
// the page renderer and the converter itself are replaced: the script checks what the
// user sees and what is written to the vault. Screenshots land in
// test-artifacts/hwp-convert-ui (or HANMARK_CONVERT_UI_OUTPUT).
const out = process.env.HANMARK_CONVERT_UI_OUTPUT || "test-artifacts/hwp-convert-ui";
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
proto.setCssStyles = function(styles) { Object.assign(this.style, styles); };
Element.prototype.addClass = function(...values) { this.classList.add(...values); };
Element.prototype.removeClass = function(...values) { this.classList.remove(...values); };
export class Modal {
  constructor(app) {
    this.app = app;
    this.modalEl = document.createElement("div"); this.modalEl.className = "modal";
    this.titleEl = this.modalEl.createDiv({ cls: "modal-title" });
    this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
  }
  open() { document.getElementById("dialogs").append(this.modalEl); this.onOpen?.(); }
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
  addText(build) {
    const inputEl = this.controlEl.createEl("input", { type: "text" });
    const control = { inputEl, setValue(value) { inputEl.value = value ?? ""; return control; }, setPlaceholder(value) { inputEl.placeholder = value; return control; }, onChange(listener) { inputEl.addEventListener("input", () => listener(inputEl.value)); return control; } };
    build(control); return this;
  }
  addButton(build) {
    const buttonEl = this.controlEl.createEl("button", { attr: { type: "button" } });
    const control = { buttonEl, setButtonText(value) { buttonEl.textContent = value; return control; }, setCta() { buttonEl.classList.add("mod-cta"); return control; }, setWarning() { return control; }, setDisabled(value) { buttonEl.disabled = Boolean(value); return control; }, onClick(listener) { buttonEl.addEventListener("click", listener); return control; } };
    build(control); return this;
  }
}
export class TFile { constructor(path) { this.path = path; this.name = path.split("/").pop(); this.extension = this.name.split(".").pop(); } }
export class FileView {
  constructor(leaf) { this.leaf = leaf; this.app = leaf.app; this.contentEl = document.createElement("div"); document.getElementById("stage").append(this.contentEl); }
}
export class Notice {
  constructor(message) {
    this.messageEl = document.createElement("div"); this.messageEl.className = "notice"; this.messageEl.textContent = String(message ?? "");
    document.getElementById("notices").append(this.messageEl); (globalThis.noticeLog ||= []).push(this);
  }
  setMessage(message) { this.messageEl.textContent = String(message); }
  hide() { this.messageEl.remove(); }
}
`;

const fixtures = {
  kordoc: `
    export const VERSION = "4.25.0";
    export async function renderDocumentToScene() {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842"><rect width="595" height="842" fill="#fff"/><text x="60" y="90" font-size="20">결재 문서 (HWP)</text></svg>';
      return { scene: { pages: [{}] }, pageSvgs: new Map([[1, svg]]) };
    }`,
  hwpConvert: `
    export class HwpConvertError extends Error {
      constructor(message, passwordHelps, original) { super(message); this.passwordHelps = passwordHelps; this.original = original; }
    }
    export async function convertHwpToHwpx(bytes, password) {
      const name = new TextDecoder().decode(bytes);
      (globalThis.calls ||= []).push({ name, password: password ? "(given)" : undefined });
      if (name.includes("잠긴") && password !== "123456") throw new HwpConvertError("암호가 걸린 문서입니다. 암호를 입력하면 다시 시도합니다. 암호는 저장하지 않습니다.", true, "encrypted");
      if (name.includes("깨진")) throw new HwpConvertError("이 문서는 HWPX로 변환하지 못했습니다. (signature)", false, "bad signature at 0");
      const old = name.includes("옛");
      return { data: new TextEncoder().encode("hwpx:" + name).buffer, mode: old ? "content" : "preserve", notes: old ? ["HWP 3.x 문서는 서식을 그대로 옮길 수 없어 글과 표만 기본 서식으로 옮겼습니다."] : [] };
    }`
};

const bundle = await build({
  stdin: {
    contents: [
      "export { HanmarkDocumentView } from './src/ui/HanmarkDocumentView';",
      "export { convertHwpFiles, freeHwpxPath } from './src/ui/hwpConvertFlow';",
      "export { TFile } from 'obsidian';"
    ].join("\n"),
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "ConvertUi",
  plugins: [{
    name: "host-fixture",
    setup(build) {
      build.onResolve({ filter: /^(obsidian|kordoc)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      build.onResolve({ filter: /\/io\/hwpConvert$/ }, () => ({ path: "hwpConvert", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: args.path === "obsidian" ? host : fixtures[args.path], loader: "js" }));
    }
  }]
});

const css = readFileSync("styles.css", "utf8");
const browser = await chromium.launch({ executablePath: process.env.HANMARK_BROWSER_EXECUTABLE || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light">
    <div id="notices" style="position:fixed;right:16px;top:12px;display:flex;flex-direction:column;gap:6px;z-index:5"></div>
    <div id="stage" style="width:760px;margin:20px;padding:16px;border:1px solid #ddd;border-radius:10px;background:#fff"></div>
    <div id="dialogs" style="width:620px;margin:20px"></div></body></html>`);
  await page.addStyleTag({ content: css });
  await page.addStyleTag({
    content: "body{--interactive-accent:#7c3aed;--text-on-accent:#fff;--background-primary:#fff;--background-secondary:#f3f3f5;--background-modifier-border:#ddd;--text-normal:#222;--text-muted:#666;font-family:'Malgun Gothic',sans-serif;font-size:15px;color:#222}" +
      "button,input{font:inherit}button{padding:4px 10px;border:1px solid #ccc;border-radius:6px;background:#f7f7f8;margin-right:6px}.mod-cta{background:#7c3aed;color:#fff;border-color:#7c3aed}" +
      ".modal{padding:16px;border:1px solid #ccc;border-radius:10px;background:#fff;box-shadow:0 6px 24px rgba(0,0,0,.12)}.modal-title{font-size:18px;font-weight:700;margin-bottom:8px}" +
      ".notice{padding:8px 12px;border-radius:8px;background:#222;color:#fff;font-size:13px}.notice button{margin-left:8px}" +
      ".hanmark-document-page{max-width:320px;border:1px solid #ddd;margin-top:8px}.hanmark-convert-report li{margin:8px 0}"
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  await page.evaluate(() => {
    globalThis.calls = [];
    globalThis.opened = [];
    const files = new Map();
    const add = (path) => { const file = new ConvertUi.TFile(path); files.set(path, file); return file; };
    globalThis.vault = {
      files,
      getAbstractFileByPath: (path) => files.get(path) ?? null,
      readBinary: async (file) => new TextEncoder().encode(file.name).buffer,
      createBinary: async (path, data) => { if (files.has(path)) throw new Error("exists " + path); const file = add(path); file.bytes = new TextDecoder().decode(data); return file; }
    };
    globalThis.app = { vault: globalThis.vault };
    globalThis.addFile = add;
    globalThis.convertHost = { app: globalThis.app, openDocument: async (file) => { globalThis.opened.push(file.path); } };
    globalThis.showViewer = async (path) => {
      document.getElementById("stage").replaceChildren();
      const view = new ConvertUi.HanmarkDocumentView({ app: globalThis.app }, {
        convertToNote: () => {},
        convertToHwpx: async (file) => { await ConvertUi.convertHwpFiles(globalThis.convertHost, [file]); },
        formNote: () => {}
      });
      await view.onLoadFile(globalThis.vault.getAbstractFileByPath(path));
    };
    for (const path of ["문서/결재 문서.hwp", "문서/결재 문서.hwpx", "문서/잠긴 문서.hwp", "문서/옛 문서.hwp", "문서/깨진 문서.hwp", "문서/보고서.hwpx"]) add(path);
  });

  // 1) The viewer shows "HWPX로 변환" for an HWP document only.
  await page.evaluate(() => showViewer("문서/보고서.hwpx"));
  assert.equal(await page.locator('#stage [data-hanmark-action="convert-to-hwpx"]').count(), 0, "no button on an HWPX document");
  await page.evaluate(() => showViewer("문서/결재 문서.hwp"));
  const convert = page.locator('#stage [data-hanmark-action="convert-to-hwpx"]');
  assert.equal(await convert.innerText(), "HWPX로 변환");
  assert.ok((await page.locator("#stage .hanmark-document-toolbar button").allInnerTexts()).includes("양식 입력 노트 만들기"), "HWP forms can make a form note");
  await page.locator("#stage").screenshot({ path: `${out}/01-viewer-hwp-toolbar.png` });

  // 2) One clean conversion: written beside the source under a free name, then opened.
  await convert.click();
  await page.waitForFunction(() => globalThis.opened.length === 1, null, { timeout: 5000 }).catch(async (error) => {
    throw new Error(`conversion did not finish: ${await page.locator("#notices").innerText()} / ${error.message}`);
  });
  assert.deepEqual(await page.evaluate(() => globalThis.opened), ["문서/결재 문서 (1).hwpx"], "never over the existing 결재 문서.hwpx");
  assert.equal(await page.evaluate(() => vault.files.get("문서/결재 문서.hwpx").bytes), undefined, "the existing file is untouched");
  assert.equal(await page.evaluate(() => vault.files.get("문서/결재 문서 (1).hwpx").bytes), "hwpx:결재 문서.hwp");
  assert.equal(await page.locator("#dialogs .modal").count(), 0, "a clean single conversion needs no report");

  // 3) A locked document: the password is asked, a wrong one is said to be wrong, the right one converts.
  const locked = page.evaluate(() => ConvertUi.convertHwpFiles(convertHost, [vault.getAbstractFileByPath("문서/잠긴 문서.hwp")]));
  const secret = page.locator('#dialogs .modal input[type="password"]');
  await secret.waitFor();
  assert.match(await page.locator("#dialogs .modal").innerText(), /잠긴 문서\.hwp의 열기 암호/u);
  assert.match(await page.locator("#dialogs .modal").innerText(), /저장하거나 기록하지 않습니다/u);
  await secret.fill("0000");
  await page.locator("#dialogs .modal .mod-cta").click();
  await page.locator("#dialogs .modal").filter({ hasText: "암호가 맞지 않거나" }).waitFor();
  await page.locator("#dialogs").screenshot({ path: `${out}/02-password-prompt-wrong.png` });
  await page.locator('#dialogs .modal input[type="password"]').fill("123456");
  await page.locator("#dialogs .modal .mod-cta").click();
  const lockedItems = await locked;
  assert.equal(lockedItems[0].path, "문서/잠긴 문서.hwpx");
  assert.equal(await page.evaluate(() => JSON.stringify(globalThis.calls).includes("123456")), false, "the password is not kept in what the flow reports");

  // 4) Several files: progress with a stop button, then a report of what was written and what was not.
  await page.evaluate(() => { globalThis.opened = []; document.getElementById("dialogs").replaceChildren(); });
  const many = await page.evaluate(async () => {
    const files = ["문서/결재 문서.hwp", "문서/옛 문서.hwp", "문서/깨진 문서.hwp", "문서/보고서.hwpx"].map((path) => vault.getAbstractFileByPath(path));
    return ConvertUi.convertHwpFiles(convertHost, files);
  });
  assert.equal(many.length, 3, "the HWPX file in the selection is not converted");
  assert.deepEqual(many.map((item) => item.path), ["문서/결재 문서 (2).hwpx", "문서/옛 문서.hwpx", undefined]);
  const report = page.locator("#dialogs .modal");
  assert.equal(await report.locator(".modal-title").innerText(), "HWPX 변환 결과");
  const text = await report.innerText();
  assert.match(text, /변환 2개, 실패 1개\. 원본 HWP는 그대로 있습니다\./u);
  assert.match(text, /글꼴·문단 모양·표·그림을 그대로 옮겼습니다/u);
  assert.match(text, /HWP 3\.x 문서는 서식을 그대로 옮길 수 없어/u);
  assert.match(text, /이 문서는 HWPX로 변환하지 못했습니다/u);
  assert.equal(await report.locator('[data-hanmark-convert="saved"]').count(), 2);
  assert.equal(await report.locator('[data-hanmark-convert="failed"]').count(), 1);
  await page.locator("#dialogs").screenshot({ path: `${out}/03-convert-report.png` });
  await report.locator('[data-hanmark-convert="saved"] button').nth(1).click();
  assert.deepEqual(await page.evaluate(() => globalThis.opened), ["문서/옛 문서.hwpx"], "the report opens the converted document");

  // 5) Stopping takes effect between files.
  await page.evaluate(() => { document.getElementById("dialogs").replaceChildren(); });
  const stopped = await page.evaluate(async () => {
    const files = ["문서/결재 문서.hwp", "문서/옛 문서.hwp", "문서/깨진 문서.hwp"].map((path) => vault.getAbstractFileByPath(path));
    const running = ConvertUi.convertHwpFiles(convertHost, files);
    document.querySelector("#notices .notice button").click();
    return running;
  });
  assert.equal(stopped.length, 1, "the file that had started is finished, the rest are left");
  assert.match(await page.locator("#dialogs .modal").innerText(), /멈춰서 변환하지 않은 파일 2개/u);
  assert.equal(await page.locator("#notices .notice button").count(), 0, "the progress notice is gone");

  console.log("HWP convert UI: viewer button for HWP only, free name beside the source, password prompt with a wrong try, report for several files, and stopping between files passed.");
} finally {
  await browser.close();
}
