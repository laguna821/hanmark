import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

// Mermaid blocks as drawn diagrams in every export (R-033), with the real diagram stage,
// the real browser environment (colour and font resolution, canvas rasteriser) in
// Chromium, and the real writers in Node. Evidence lands in HANMARK_DIAGRAM_TEST_OUTPUT.
//
// HANMARK_DIAGRAM_TEST_NOTE may name a private Markdown note; it is read at run time
// and never copied into the repository.
const out = process.env.HANMARK_DIAGRAM_TEST_OUTPUT || "test-artifacts/diagrams";
const notePath = process.env.HANMARK_DIAGRAM_TEST_NOTE;
mkdirSync(out, { recursive: true });

const FIXTURES = {
  timeline: ["timeline", "    %% @caption: 행사 진행 순서", "    %% @alt: 소개에서 시작해 두 차례 세션을 거쳐 설명회로 끝난다", "    title 11월 진행 순서", "    section 소개", "        14시 00분 : 동문 소개", "    section 세션", "        15시 10분 : 세션 하나", "        16시 00분 : 세션 둘", "    section 마무리", "        16시 50분 : 전공 설명회"],
  flowchart: ["flowchart LR", "    %% @caption: 재원과 쓰임", "    %% @key: C", "    subgraph S1[\"재원\"]", "        A[\"대학혁신<br/>지원사업\"]", "        B[\"지역 사업\"]", "    end", "    subgraph S2[\"쓰임\"]", "        C[\"조명 설비\"]", "        D[\"카메라\"]", "    end", "    A --> C", "    B -.-> D"],
  mindmap: ["mindmap", "    %% @caption: 장소 후보", "    root((워크숍 장소))", "        우선 검토", "            강가 호텔", "            산속 리조트", "        다른 후보", "            시내 회의장"],
  sequence: ["sequenceDiagram", "    %% @caption: 과목 개설 순서", "    participant H as 고등학교", "    participant M as 학과", "    participant E as 교육청", "    H->>M: 과목 개설 요청", "    M->>E: 신청서 제출", "    E-->>M: 승인", "    Note over H,M: 수요일 오후 수업"],
  gantt: ["gantt", "    %% @caption: 주요 일정", "    title 주요 일정", "    dateFormat YYYY-MM-DD", "    section 행사", "    동문 행사 :a1, 2026-11-24, 1d", "    발표회 :a2, 2026-12-02, 1d", "    section 회의", "    워크숍 :2027-01-12, 2d"]
};
const fence = (lines) => ["```mermaid", ...lines, "```"].join("\n");
const fixtureNote = [
  "# 도식 내보내기 시험",
  "",
  "도식 앞 문단입니다.",
  "",
  ...Object.entries(FIXTURES).flatMap(([name, lines]) => [`## ${name}`, "", fence(lines), "", `${name} 뒤 문단입니다.`, ""]),
  "## 그릴 수 없는 블록",
  "",
  "```mermaid",
  "nosuchdiagram",
  "    a --> b",
  "```",
  "",
  "```js",
  "const kept = true;",
  "```"
].join("\n");

const notes = { fixtures: fixtureNote };
if (notePath && existsSync(notePath)) {
  notes.private = readFileSync(notePath, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "");
}

const bundle = await build({
  stdin: {
    contents: [
      "export { renderMermaidDiagrams, renderDiagram, findMermaidBlocks } from './src/io/diagramStage';",
      "export { createBrowserDiagramEnvironment } from './src/ui/diagramEnvironment';",
      "export { parseEditorialDocument } from './src/io/editorialDocument';",
      "export { buildEditorialPdfRoot, createEditorialPdfStyles } from './src/io/editorialPdf';"
    ].join("\n"),
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "HanmarkDiagramTest",
  platform: "browser"
});

const fontCss = readFileSync("styles.css", "utf8").split("/* HANMARK_PRETENDARD_GENERATED_END */")[0];
// The diagram colours and font of the reference vault (read from Obsidian 1.14.5 on 2026-11-18).
const LOOK = {
  note: 'body, .mermaid { --pele-bg: white; --pele-fg: #17243A; --pele-muted: hsl(0, 0%, 50%); --pele-line: #17243A; --pele-surface: #FFFFFF; --pele-surface-alt: #FFFFFF; --pele-border: hsl(0, 0%, 88%); --pele-accent: #016CC3; --pele-font: "Achmage SameTone", "Pretendard Variable", ui-sans-serif, sans-serif; }',
  dark: 'body, .mermaid { --pele-bg: #0B0C0E; --pele-fg: #DADADA; --pele-muted: #888888; --pele-line: #DADADA; --pele-surface: #1E1E1E; --pele-surface-alt: #262626; --pele-border: #444444; --pele-accent: #F27AA4; --pele-font: "Achmage SameTone", sans-serif; }',
  nofont: 'body, .mermaid { --pele-bg: white; --pele-fg: #17243A; --pele-muted: #808080; --pele-line: #17243A; --pele-surface: #FFFFFF; --pele-surface-alt: #FFFFFF; --pele-border: #E0E0E0; --pele-accent: #016CC3; --pele-font: "HanMark No Such Font 7c1", sans-serif; }'
};

const browser = await chromium.launch({ executablePath: process.env.HANMARK_BROWSER_EXECUTABLE || undefined, headless: true });
const staged = {};
let pdfInfo = null;
try {
  for (const [lookName, lookCss] of Object.entries(LOOK)) {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><head></head><body></body></html>");
    await page.addStyleTag({ content: fontCss });
    await page.addStyleTag({ content: lookCss });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    staged[lookName] = await page.evaluate(async ({ notes, lookName }) => {
      const api = globalThis.HanmarkDiagramTest;
      const result = {};
      for (const [name, markdown] of Object.entries(notes)) {
        if (lookName !== "note" && name !== "fixtures") continue;
        const environment = await api.createBrowserDiagramEnvironment(document, {});
        environment.now = new Date(2026, 10, 18);
        const entry = { fontFamily: environment.fontFamily, fontNotice: environment.fontNotice ?? null, palette: environment.palette, targets: {} };
        for (const target of ["hwpx", "docx", "markup"]) {
          const first = await api.renderMermaidDiagrams(markdown, target, environment);
          const second = await api.renderMermaidDiagrams(markdown, target, environment);
          entry.targets[target] = { markdown: first.markdown, warnings: first.warnings, rendered: first.rendered, kept: first.kept, repeatable: first.markdown === second.markdown };
        }
        result[name] = entry;
      }
      return result;
    }, { notes, lookName });
    await page.close();
  }

  writeFileSync(join(out, "staged.json"), JSON.stringify(staged));
  // Editorial PDF (single column) from the "markup" Markdown: inline SVG, text stays text.
  for (const name of Object.keys(staged.note)) {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><head></head><body></body></html>");
    await page.addStyleTag({ content: fontCss });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const info = await page.evaluate(async ({ markdown, title }) => {
      const api = globalThis.HanmarkDiagramTest;
      const style = document.createElement("style");
      style.className = "hanmark-editorial-pdf-style";
      style.textContent = api.createEditorialPdfStyles(title);
      document.head.append(style);
      const root = api.buildEditorialPdfRoot(document, api.parseEditorialDocument(markdown, title), title);
      document.body.append(root);
      document.body.classList.add("hanmark-editorial-pdf-active");
      await document.fonts.ready;
      const holders = Array.from(root.querySelectorAll(".hanmark-pdf-diagram"));
      return {
        diagrams: holders.length,
        captions: root.querySelectorAll(".hanmark-pdf-diagram-caption").length,
        svgText: holders.reduce((sum, holder) => sum + holder.querySelectorAll("svg text").length, 0),
        leftoverTokens: (root.textContent || "").includes("HMDIAGRAM("),
        fonts: holders.slice(0, 1).map((holder) => getComputedStyle(holder.querySelector("svg text")).fontFamily)
      };
    }, { markdown: staged.note[name].targets.markup.markdown, title: name === "private" ? "Diagram note" : "도식 내보내기 시험" });
    await page.emulateMedia({ media: "print" });
    writeFileSync(join(out, `${name}.pdf`), await page.pdf({ printBackground: true, preferCSSPageSize: true, format: "A4" }));
    if (name === "fixtures") pdfInfo = info;
    assert.equal(info.leftoverTokens, false, `no diagram token may be printed as text: ${JSON.stringify(info)}`);
    assert.equal(info.diagrams, staged.note[name].targets.markup.rendered, `every drawn diagram is inline SVG: ${JSON.stringify(info)}`);
    if (info.diagrams) assert.ok(info.svgText > 0, "diagram text stays text");
    await page.close();
  }

  // The writers run in Node on the staged Markdown (the HWPX engine cannot be bundled for a plain page).
  const report = JSON.parse(
    execFileSync(process.execPath, ["--import", "tsx", "scripts/diagram-export-writers.ts", join(out, "staged.json"), out], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n").filter((line) => line.startsWith("{")).pop()
  );

  // Pictures of what was produced: the HWPX re-render page with each diagram, and the HTML export.
  const shots = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  for (const item of report.hwpxPages) {
    await shots.setContent(`<!doctype html><html><body style="margin:0;background:#8a8f98">${readFileSync(item.svg, "utf8")}</body></html>`);
    const box = await shots.evaluate(() => {
      // The preview SVG keeps picture data in <symbol> and places it with <use>.
      for (const image of document.querySelectorAll("use, image")) {
        const rect = image.getBoundingClientRect();
        if (rect.width > 40 && rect.height > 40) return { y: rect.y + scrollY, height: rect.height };
      }
      return { y: 0, height: 600 };
    });
    const clip = { x: 0, y: Math.max(0, box.y - 190), width: 800, height: Math.min(1100, box.height + 380) };
    await shots.screenshot({ path: join(out, `${item.name}.hwpx-page.png`), clip, fullPage: true });
  }
  for (const name of Object.keys(staged.note)) {
    await shots.setViewportSize({ width: 1000, height: 1200 });
    await shots.setContent(readFileSync(join(out, `${name}.html`), "utf8"));
    await shots.screenshot({ path: join(out, `${name}.html.png`), fullPage: true });
    const figure = shots.locator("figure.hanmark-diagram").first();
    if (await figure.count()) await figure.screenshot({ path: join(out, `${name}.html-first-diagram.png`) });
  }
  // One PNG per fixture type, straight from the HWPX/DOCX picture data, in each look.
  for (const [lookName, looks] of Object.entries(staged)) {
    const images = Array.from(looks.fixtures.targets.hwpx.markdown.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g), (match) => match[1]);
    Object.keys(FIXTURES).forEach((type, index) => {
      if (images[index]) writeFileSync(join(out, `fixture-${type}.${lookName}.png`), Buffer.from(images[index], "base64"));
    });
  }
  await shots.close();

  const fixtures = staged.note.fixtures;
  assert.equal(fixtures.targets.hwpx.rendered, 5, "all five fixture types are drawn");
  assert.equal(fixtures.targets.hwpx.kept, 1, "the unknown block stays code");
  assert.ok(fixtures.targets.hwpx.warnings.some((warning) => warning.code === "diagram-kept-as-code"));
  for (const target of ["hwpx", "docx", "markup"]) assert.equal(fixtures.targets[target].repeatable, true, `${target} output repeats`);
  assert.ok(!/var\(/.test(Buffer.from(/HMDIAGRAM\(([A-Za-z0-9+/=]+)\)/.exec(fixtures.targets.markup.markdown)[1], "base64").toString("utf8")), "no CSS variable is exported");
  assert.equal(staged.dark.fixtures.palette.bg, "#FFFFFF", "a dark note background falls back to paper");
  assert.ok(staged.nofont.fixtures.fontNotice, "an unusable font is reported once");
  assert.equal(report.fixtures.hwpxImages, 5);
  assert.equal(report.fixtures.hwpxValid, true);
  assert.equal(report.fixtures.hwpxRepeatable, true);
  assert.equal(report.fixtures.docxRepeatable, true);
  assert.equal(report.fixtures.htmlFigures, 5);
  console.log(JSON.stringify({ looks: Object.fromEntries(Object.entries(staged).map(([key, value]) => [key, { font: value.fixtures.fontFamily, notice: value.fixtures.fontNotice, bg: value.fixtures.palette.bg }])), pdf: pdfInfo, report }, null, 1));
} finally {
  await browser.close();
}
