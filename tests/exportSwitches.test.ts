import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { EXPORT_SWITCHES, exportSwitchesFor, exportSwitchValue, hwpxEquationsSetting } from "../src/io/exportSwitches";
import { DEFAULT_HANMARK_SETTINGS, normalizeHanmarkSettings } from "../src/legacy-port/settings";
import { exportDiagramOptions } from "../src/ui/diagramEnvironment";
import { prepareExportMarkdown } from "../src/io/exportPreparation";
import { commentsAsMemosSetting, extractMemoMarks } from "../src/io/hwpxMemos";
import { generateValidatedHwpx } from "../src/io/kordocEngine";

const NOTE = [
  "# 제목",
  "",
  "본문에 ==강조한 글==%%검토 의견%% 이 있고 수식 $E = mc^2$ 도 있다.",
  "",
  "```mermaid",
  "flowchart LR",
  "    A[\"시작\"] --> B[\"끝\"]",
  "```",
  "",
  "끝 문단."
].join("\n");

const host = { read: () => Promise.resolve(null), resolve: () => null } as never;
const bytes = (data: ArrayBuffer): Uint8Array => new Uint8Array(data);

describe("the 내보낼 때 switches (R-037)", () => {
  it("lists the switches of each format in display order", () => {
    assert.deepEqual(exportSwitchesFor("hwpx").map((item) => item.id), ["mermaidDiagrams", "commentsAsMemos", "hwpxEquations"]);
    for (const format of ["docx", "html", "pdf"] as const) {
      assert.deepEqual(exportSwitchesFor(format).map((item) => item.id), ["mermaidDiagrams"], format);
    }
  });

  it("stores each switch as one setting whose default matches the settings defaults", () => {
    for (const item of EXPORT_SWITCHES) {
      assert.equal(exportSwitchValue({}, item.id), item.defaultOn, item.id);
      assert.equal(DEFAULT_HANMARK_SETTINGS[item.id], item.defaultOn, item.id);
      assert.equal(exportSwitchValue({ [item.id]: !item.defaultOn }, item.id), !item.defaultOn, item.id);
      assert.equal(exportSwitchValue({ [item.id]: "yes" }, item.id), item.defaultOn, `${item.id}: a malformed value is the default`);
    }
    const old = normalizeHanmarkSettings({});
    assert.equal(old.hwpxEquations, false);
    assert.equal(normalizeHanmarkSettings({ hwpxEquations: true }).hwpxEquations, true);
    assert.equal(normalizeHanmarkSettings({ hwpxEquations: "true" }).hwpxEquations, false);
  });

  it("reads the same stored values in the export, the preview and several forms at once", async () => {
    // One generation routine serves the window, the quick commands and the batch; the
    // preview and the settings tab read the same keys.
    const save = await readFile("src/io/kordocSave.ts", "utf8");
    assert.match(save, /diagrams: exportDiagramOptions\(host\.settings, "hwpx"\)/u);
    assert.match(save, /commentsAsMemosSetting\(host\.settings\) \? extractMemoMarks/u);
    assert.match(save, /hwpxEquationsSetting\(host\.settings\) \? \{ inlineMath: true \} : \{\}/u);
    const main = await readFile("src/main.ts", "utf8");
    assert.match(main, /diagrams: \(\) => exportDiagramOptions\(this\.settings, "hwpx"\)/u);
    assert.match(main, /equations: \(\) => hwpxEquationsSetting\(this\.settings\)/u);
    assert.match(main, /exportDiagramOptions\(this\.settings, "docx"\)/u);
    assert.match(main, /exportDiagramOptions\(this\.settings, "markup", paper\)/u);
    assert.match(main, /setExportSwitch: async \(id, value\) => \{[\s\S]*?await this\.saveSettings\(\);[\s\S]*?this\.refreshPreviews\(\);/u);
    const preview = await readFile("src/ui/QuickHwpxPreviewView.ts", "utf8");
    assert.match(preview, /this\.options\.equations\?\.\(\) \? \{ inlineMath: true \} : \{\}/u);
    assert.match(preview, /generation\.options\.inlineMath \? \{ inlineMath: true \} : \{\}/u, "the switch is part of the preview's cache key");
  });

  it("Mermaid switch off: no diagram stage, the note text is handed on unchanged", async () => {
    assert.equal(exportDiagramOptions({ mermaidDiagrams: false }, "hwpx"), undefined);
    assert.equal(exportDiagramOptions({ mermaidDiagrams: false }, "docx"), undefined);
    assert.equal(exportDiagramOptions({ mermaidDiagrams: false }, "markup"), undefined);
    const prepared = await prepareExportMarkdown(host, NOTE, "note.md", { assembleEmbeds: false, diagrams: undefined });
    assert.equal(prepared.markdown, NOTE);
    assert.deepEqual(prepared.warnings, []);
    const before = await generateValidatedHwpx(NOTE, {});
    const after = await generateValidatedHwpx(prepared.markdown, {});
    assert.deepEqual(bytes(after.data), bytes(before.data));
  });

  it("memo switch off: the note is not searched for memo marks", () => {
    assert.equal(commentsAsMemosSetting({}), false);
    assert.equal(commentsAsMemosSetting({ commentsAsMemos: false }), false);
    assert.equal(commentsAsMemosSetting({ commentsAsMemos: true }), true);
    // On, the mark leaves the body; off, export never calls this and the body stays as written.
    const marks = extractMemoMarks(NOTE);
    assert.equal(marks.memos.length, 1);
    assert.notEqual(marks.markdown, NOTE);
  });

  it("equation switch off: the same bytes as before; on: a Hangul equation object", async () => {
    assert.equal(hwpxEquationsSetting({}), false);
    assert.equal(hwpxEquationsSetting({ hwpxEquations: true }), true);
    const options = (settings: Record<string, unknown>): { inlineMath?: boolean } =>
      hwpxEquationsSetting(settings) ? { inlineMath: true } : {};
    for (const gongmun of [undefined, { preset: "report" as const }]) {
      const before = await generateValidatedHwpx(NOTE, { ...(gongmun ? { gongmun } : {}) });
      const off = await generateValidatedHwpx(NOTE, { ...(gongmun ? { gongmun } : {}), ...options({ hwpxEquations: false }) });
      assert.deepEqual(bytes(off.data), bytes(before.data), gongmun ? "official" : "quick");
      const on = await generateValidatedHwpx(NOTE, { ...(gongmun ? { gongmun } : {}), ...options({ hwpxEquations: true }) });
      const section = await (await JSZip.loadAsync(on.data)).file("Contents/section0.xml")!.async("string");
      assert.equal((section.match(/<hp:equation\b/gu) ?? []).length, 1, gongmun ? "official" : "quick");
    }
  });
});
