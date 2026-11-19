import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";
import { lintBlocks, normalizeGongmunPreset, usesGaejosikMunche } from "kordoc";
const ENGINE = { lintBlocks, normalizeGongmunPreset, usesGaejosikMunche };

// The real check window, the real editor underlines in a real CodeMirror editor, and
// the pre-flight (R-035) in Chromium with styles.css. Kordoc's lint runs for real in
// this Node process: the page calls it through a synchronous request, because the
// engine itself is bundled only by the production build. Screenshots land in
// test-artifacts/check-ui (or HANMARK_CHECK_UI_OUTPUT).
const out = process.env.HANMARK_CHECK_UI_OUTPUT || "test-artifacts/check-ui";
mkdirSync(out, { recursive: true });

const server = createServer((request, response) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "text/plain; charset=utf-8" };
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    try {
      const { call, args } = JSON.parse(body);
      const value = ENGINE[call](...args);
      response.writeHead(200, headers).end(JSON.stringify(value));
    } catch (error) {
      response.writeHead(500, headers).end(String(error));
    }
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const engineUrl = `http://127.0.0.1:${server.address().port}/`;

const host = `
const proto = HTMLElement.prototype;
proto.createEl = function(tag, options = {}) {
  const node = this.ownerDocument.createElement(tag);
  if (typeof options === "string") options = { cls: options };
  if (options.text) node.textContent = options.text;
  if (options.cls) node.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
  for (const [key, value] of Object.entries(options.attr || {})) node.setAttribute(key, String(value));
  this.append(node); return node;
};
proto.createDiv = function(options) { return this.createEl("div", options); };
proto.createSpan = function(options) { return this.createEl("span", options); };
proto.empty = function() { this.replaceChildren(); };
proto.setText = function(text) { this.textContent = text; };
proto.appendText = function(text) { this.append(this.ownerDocument.createTextNode(text)); };
Element.prototype.addClass = function(...values) { this.classList.add(...values); };
globalThis.createDiv = (options) => { const holder = document.createElement("div"); const node = holder.createDiv(options); node.remove(); return node; };
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
export class Notice { constructor(message) { (globalThis.notices ||= []).push(String(message)); } }
`;
const engine = `
function call(name, args) {
  const request = new XMLHttpRequest();
  request.open("POST", ${JSON.stringify(engineUrl)}, false);
  request.send(JSON.stringify({ call: name, args }));
  if (request.status !== 200) throw new Error(request.responseText);
  return JSON.parse(request.responseText);
}
export const lintBlocks = (blocks, options) => call("lintBlocks", [blocks, options]);
export const usesGaejosikMunche = (preset) => call("usesGaejosikMunche", [preset]);
export const normalizeGongmunPreset = (preset) => call("normalizeGongmunPreset", [preset]);
`;

const bundle = await build({
  stdin: {
    contents: [
      "export { GongmunLintModal } from './src/ui/GongmunLintModal';",
      "export { gongmunCheckMarks, setCheckMarksEnabled, checkMarkCount } from './src/ui/gongmunCheckMarks';",
      "export { EditorView } from '@codemirror/view';",
      "export { EditorState } from '@codemirror/state';",
      "export { setUiLocale } from './src/i18n';"
    ].join("\n"),
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "CheckUi",
  plugins: [{
    name: "host-fixture",
    setup(build) {
      build.onResolve({ filter: /^(obsidian|kordoc)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: args.path === "obsidian" ? host : engine, loader: "js" }));
    }
  }]
});

const NOTE = [
  "---",
  "공문_종류: 보고서",
  "---",
  "# 2027년 교육과정 개편 계획",
  "",
  "- 일시: 2026. 11. 18.(목) 14:00",
  "- 기간: 2026.11.3부터 진행",
  "- 강사료: 200,000원 × 2회 = 500,000원",
  "",
  "| 구분 | 금액 |",
  "|---|---|",
  "| 인건비 | 100 |",
  "| 운영비 | 200 |",
  "| 합계 | 350 |",
  "",
  "```mermaid",
  "timeline",
  "    2026.11.3 : 코드 안의 날짜",
  "```"
].join("\n");

const css = readFileSync("styles.css", "utf8");
const browser = await chromium.launch({ executablePath: process.env.HANMARK_BROWSER_EXECUTABLE || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => { throw error; });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light">
    <div style="display:flex;gap:16px;margin:16px;align-items:flex-start">
      <div id="editor" style="width:640px;border:1px solid #ddd;border-radius:8px;background:#fff"></div>
      <div id="stage" style="width:760px;padding:16px;border:1px solid #ddd;border-radius:10px;background:#fff"></div>
    </div></body></html>`);
  await page.addStyleTag({ content: css });
  await page.addStyleTag({
    content: "body{--interactive-accent:#7c3aed;--text-accent:#7c3aed;--text-on-accent:#fff;--background-primary:#fff;--background-secondary:#f3f3f5;--background-modifier-border:#ddd;--text-muted:#666;--text-normal:#222;--text-error:#c62828;--text-warning:#b7791f;--font-ui-small:13px;--font-semibold:600;font-family:'Malgun Gothic',system-ui,sans-serif;font-size:14px;color:#222}" +
      "button{font:inherit;padding:3px 9px;border:1px solid #ccc;border-radius:6px;background:#fafafa;cursor:pointer}button.mod-cta{background:#7c3aed;color:#fff;border-color:#7c3aed}.modal-title{font-size:18px;font-weight:700;margin-bottom:6px}" +
      ".cm-editor{font-size:14px}.cm-tooltip{background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.15)}"
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate((note) => {
    CheckUi.setUiLocale("ko");
    globalThis.ignored = [];
    const marks = CheckUi.gongmunCheckMarks({
      options: () => ({ preset: "report", ignored: [...globalThis.ignored, ...(globalThis.storedProperties?.["공문_점검무시"] ?? [])] }),
      ignore: (_view, entry) => globalThis.ignored.push(entry),
      checked: (_view, findings) => { globalThis.lastChecked = findings ? findings.length : -1; }
    }, 150);
    const view = new CheckUi.EditorView({ state: CheckUi.EditorState.create({ doc: note, extensions: [marks, CheckUi.EditorView.lineWrapping] }), parent: document.getElementById("editor") });
    globalThis.view = view;
    const position = ({ line, ch }) => view.state.doc.line(line + 1).from + ch;
    // Obsidian's Editor interface on top of the CodeMirror view.
    globalThis.editor = {
      getValue: () => view.state.doc.toString(),
      getLine: (line) => view.state.doc.line(line + 1).text,
      lineCount: () => view.state.doc.lines,
      setSelection: (from, to) => view.dispatch({ selection: { anchor: position(from), head: position(to) } }),
      scrollIntoView: () => {},
      focus: () => view.focus(),
      replaceRange: (text, from, to) => view.dispatch({ changes: { from: position(from), to: position(to), insert: text } }),
      transaction: ({ changes }) => view.dispatch({ changes: changes.map((change) => ({ from: position(change.from), to: position(change.to), insert: change.text })) })
    };
    const stored = {};
    globalThis.storedProperties = stored;
    globalThis.app = {
      metadataCache: { getFileCache: () => ({ frontmatter: stored }) },
      fileManager: { processFrontMatter: async (_file, change) => change(stored) }
    };
    globalThis.openCheck = (options = {}) => new CheckUi.GongmunLintModal(globalThis.app, globalThis.editor, "report", { file: {}, ...options }).open();
  }, NOTE);

  // 1. The window: groups with counts, filters, the summary line.
  await page.evaluate(() => openCheck());
  const stage = page.locator("#stage");
  const summary = await stage.locator("[data-hanmark-lint-summary]").innerText();
  assert.match(summary, /^점검 \d+건\(고칠 것 \d+\): 표기법 \d+, 예산·산출근거 \d+$/u, summary);
  assert.deepEqual(await stage.locator("[data-hanmark-lint-family]").evaluateAll((lists) => lists.map((list) => list.dataset.hanmarkLintFamily)), ["notation", "budget"]);
  assert.doesNotMatch(await stage.innerText(), /코드 안의 날짜/u, "code blocks are not checked");
  const rules = () => stage.locator("[data-hanmark-lint-rule]").evaluateAll((items) => items.map((item) => item.dataset.hanmarkLintRule));
  assert.ok((await rules()).includes("WEEKDAY_MISMATCH") && (await rules()).includes("BUDGET_TOTAL_MISMATCH"));
  await page.screenshot({ path: `${out}/01-check-window-groups-and-filters.png` });
  await stage.locator('[data-hanmark-lint-filter="budget"]').click();
  assert.ok((await rules()).every((rule) => rule.startsWith("BUDGET_")), (await rules()).join(","));
  await stage.locator('[data-hanmark-lint-filter="all"]').click();
  const all = (await rules()).length;
  await stage.locator('[data-hanmark-lint-filter="errors"]').check();
  assert.ok((await rules()).length <= all);
  await stage.locator('[data-hanmark-lint-filter="errors"]').uncheck();

  // 2. Jump: the exact text is selected in the editor.
  await stage.locator('[data-hanmark-lint-rule="WEEKDAY_MISMATCH"] .hanmark-gongmun-lint-line').click();
  assert.equal(await page.evaluate(() => { const { from, to } = view.state.selection.main; return view.state.sliceDoc(from, to); }), "2026. 11. 18.(목)");
  await page.screenshot({ path: `${out}/02-jump-and-select.png` });

  // 3. Fix one finding: exactly that range, one undo step; a stale finding is refused.
  await page.evaluate(() => { globalThis.staleFix = [...document.querySelectorAll('[data-hanmark-lint-rule="BUDGET_TOTAL_MISMATCH"] [data-hanmark-lint-action="fix"]')][0]; });
  await stage.locator('[data-hanmark-lint-rule="WEEKDAY_MISMATCH"] [data-hanmark-lint-action="fix"]').click();
  assert.match(await page.evaluate(() => editor.getLine(5)), /2026\. 11\. 18\.\(수\) 14:00$/u);
  assert.ok(!(await rules()).includes("WEEKDAY_MISMATCH"));
  await page.evaluate(() => {
    // The note changes under an open window: the old button must refuse.
    const line = view.state.doc.line(14);
    view.dispatch({ changes: { from: line.from, to: line.to, insert: "| 합계 | 999 |" } });
    globalThis.staleFix.click();
  });
  assert.equal(await page.evaluate(() => editor.getLine(13)), "| 합계 | 999 |", "a stale fix changes nothing");
  assert.match((await page.evaluate(() => notices)).at(-1), /다시 점검하세요/u);

  // 4. Ignore: by text and by rule, stored in the note property.
  const before = (await rules()).length;
  await stage.locator('[data-hanmark-lint-rule="DATE_NO_SPACE"] [data-hanmark-lint-action="ignore-rule"]').first().click();
  await page.waitForFunction((count) => document.querySelectorAll("#stage [data-hanmark-lint-rule]").length < count, before);
  assert.deepEqual(await page.evaluate(() => storedProperties["공문_점검무시"]), ["DATE_NO_SPACE"]);
  assert.match(await stage.innerText(), /무시한 항목 \d+건은 숨겼습니다/u);
  await stage.locator('[data-hanmark-lint-action="recheck"]').click();
  assert.ok(!(await rules()).includes("DATE_NO_SPACE"));
  await page.evaluate(() => document.querySelector("#stage .modal")?.remove());

  // 5. Editor underlines: off by default, on by the switch, updated after typing.
  assert.equal(await page.locator(".hanmark-check-mark").count(), 0);
  await page.evaluate(() => view.dispatch({ effects: CheckUi.setCheckMarksEnabled.of(true) }));
  await page.waitForFunction(() => document.querySelectorAll(".hanmark-check-mark").length > 0);
  const marked = await page.locator(".hanmark-check-mark").evaluateAll((nodes) => nodes.flatMap((node) => node.dataset.hanmarkCheckRule.split(" ")));
  assert.ok(marked.includes("BUDGET_CALC_MISMATCH") && !marked.includes("DATE_NO_SPACE"), marked.join(","));
  await page.evaluate(() => { const line = view.state.doc.line(7); view.dispatch({ changes: { from: line.to, insert: " 그리고 2026. 11. 19.(금)" } }); });
  await page.waitForFunction(() => [...document.querySelectorAll(".hanmark-check-mark")].some((node) => node.dataset.hanmarkCheckRule === "WEEKDAY_MISMATCH"));
  await page.locator('.hanmark-check-mark[data-hanmark-check-rule="WEEKDAY_MISMATCH"]').hover();
  await page.waitForSelector(".hanmark-check-tooltip");
  assert.match(await page.locator(".hanmark-check-tooltip").innerText(), /날짜와 요일이 맞지 않음[\s\S]*고치기[\s\S]*무시/u);
  await page.screenshot({ path: `${out}/03-editor-underlines-with-tooltip.png` });
  await page.locator('.hanmark-check-tooltip [data-hanmark-check-action="fix"]').click();
  assert.match(await page.evaluate(() => editor.getLine(6)), /2026\. 11\. 19\.\(목\)$/u);
  await page.waitForFunction(() => ![...document.querySelectorAll(".hanmark-check-mark")].some((node) => node.dataset.hanmarkCheckRule === "WEEKDAY_MISMATCH"));
  // Two rules on overlapping text ("200달러": won first; no exchange rate given) make ONE
  // underline whose tooltip gives both pieces of advice, each with its own buttons.
  await page.evaluate(() => { const end = view.state.doc.length; view.dispatch({ changes: { from: end, insert: "\n\n클라우드 임대는 월 100~200달러 수준의 종량제로 운영한다.\n" } }); });
  await page.waitForFunction(() => [...document.querySelectorAll(".hanmark-check-mark")].some((node) => node.textContent.includes("달러")));
  // A wording finding over the whole sentence (DA_ENDING) stays its own underline.
  const dollar = page.locator('.hanmark-check-mark[data-hanmark-check-rule*="BUDGET_"]', { hasText: "달러" });
  assert.equal(await dollar.count(), 1, "one underline for the two rules");
  assert.deepEqual((await dollar.getAttribute("data-hanmark-check-rule")).split(" ").sort(), ["BUDGET_RATE_MISSING", "BUDGET_WON_FIRST"]);
  assert.equal(await dollar.getAttribute("data-hanmark-check-count"), "2");
  assert.equal(await dollar.innerText(), "200달러");
  await dollar.hover();
  await page.waitForSelector(".hanmark-check-tooltip .hanmark-check-tooltip-item + .hanmark-check-tooltip-item");
  const advice = await page.locator(".hanmark-check-tooltip .hanmark-check-tooltip-item").allInnerTexts();
  assert.equal(advice.length, 3, "the two budget rules, then the sentence-wide wording finding");
  assert.ok(advice.some((text) => /원화를 앞에 쓰고/u.test(text)) && advice.some((text) => /환율 기준이 없음/u.test(text)), advice.join(" | "));
  await page.screenshot({ path: `${out}/05-two-rules-one-underline.png` });
  // Ignoring one rule keeps the other on the same text.
  await page.locator(".hanmark-check-tooltip .hanmark-check-tooltip-item", { hasText: "환율" }).locator('[data-hanmark-check-action="ignore"]').click();
  await page.waitForFunction(() => { const node = [...document.querySelectorAll(".hanmark-check-mark")].find((item) => item.dataset.hanmarkCheckRule.includes("BUDGET_") && item.textContent.includes("달러")); return node && !node.dataset.hanmarkCheckCount; });
  assert.equal(await page.locator('.hanmark-check-mark[data-hanmark-check-rule*="BUDGET_"]', { hasText: "달러" }).getAttribute("data-hanmark-check-rule"), "BUDGET_WON_FIRST");
  await page.evaluate(() => view.dispatch({ effects: CheckUi.setCheckMarksEnabled.of(false) }));
  assert.equal(await page.locator(".hanmark-check-mark").count(), 0);

  // 6. Pre-flight: blocking findings and "그래도 내보내기".
  await page.evaluate(() => { globalThis.preflight = null; openCheck({ preflight: { onProceed: () => (globalThis.preflight = "proceed"), onCancel: () => (globalThis.preflight = "cancel") } }); });
  assert.equal(await page.locator("#stage .modal-title").innerText(), "내보내기 전 점검");
  await page.screenshot({ path: `${out}/04-preflight.png` });
  await stage.locator('[data-hanmark-lint-action="proceed"]').click();
  assert.equal(await page.evaluate(() => preflight), "proceed");

  console.log("Check UI: groups and filters, jump-and-select, fix and stale refusal, ignore stored in the note property, editor underlines with tooltip and fix, and the pre-flight passed.");
} finally {
  await browser.close();
  server.close();
}
