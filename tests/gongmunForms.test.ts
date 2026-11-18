import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { App, TFile } from "obsidian";
import {
  canonicalGongmunFormId,
  currentGongmunFormId,
  GONGMUN_PRESETS,
  gongmunFileLabel,
  gongmunFormId,
  gongmunGenerateOptions,
  listGongmunForms,
  planGongmunExport,
  selectGongmunFormInMemory
} from "../src/io/gongmunExport";
import { BUILTIN_GONGMUN_STYLES } from "../src/io/institutionStyles";
import {
  getTemplateLibrary,
  newGongmunTemplateRecord,
  normalizeTemplateLibrary,
  putGongmunTemplateInMemory,
  type TemplateLibraryHost
} from "../src/io/templateLibrary";
import { normalizeHanmarkSettings } from "../src/legacy-port/settings";

function host(): TemplateLibraryHost {
  return { settings: {}, saveSettings: async () => {} };
}

function noteApp(frontmatter: Record<string, unknown>): App {
  return { metadataCache: { getFileCache: () => ({ frontmatter }) } } as unknown as App;
}

const FILE = { basename: "노트", path: "노트.md" } as TFile;

describe("forms named explicitly (R-028)", () => {
  it("plans a named form exactly as if it had been chosen globally", () => {
    const plugin = host();
    const app = noteApp({ 공문_종류: "보고서" });
    const mine = putGongmunTemplateInMemory(plugin, newGongmunTemplateRecord(plugin, "학과 계획서", { bodyPt: 13 }, "plan"));
    for (const id of ["builtin:hallym-aicr", "builtin:hallym-ilsong", "preset:ministry", "preset:official", mine.id]) {
      const global = host();
      global.settings = JSON.parse(JSON.stringify(plugin.settings)) as Record<string, unknown>;
      const preset = selectGongmunFormInMemory(global, id);
      const chosen = planGongmunExport(app, FILE, global, preset);
      // The global selection points elsewhere; the explicit id must win.
      selectGongmunFormInMemory(plugin, id === "preset:report" ? "preset:plan" : "preset:report");
      const named = planGongmunExport(app, FILE, plugin, undefined, id);
      // Ids stored by 2.7.x are understood; the plan carries the frame-and-look id (R-030).
      assert.equal(named.formId, canonicalGongmunFormId(plugin, id));
      assert.equal(named.preset, chosen.preset);
      const withoutDates = (plan: typeof named): unknown => JSON.parse(JSON.stringify(gongmunGenerateOptions(plan)));
      assert.deepEqual(withoutDates(named), withoutDates(chosen), id);
    }
  });

  it("falls back to the global form when the named form no longer exists", () => {
    const plugin = host();
    selectGongmunFormInMemory(plugin, "builtin:hallym-ilsong");
    const plan = planGongmunExport(noteApp({}), FILE, plugin, undefined, "gongmun:deleted");
    assert.equal(plan.formId, "form:general/builtin:hallym-ilsong");
    assert.equal(plan.preset, "minutes");
  });

  it("names exported files after the form in the note's language", () => {
    const plugin = host();
    const mine = putGongmunTemplateInMemory(plugin, newGongmunTemplateRecord(plugin, '우리/학과 "보고서"', {}, "plan"));
    assert.equal(gongmunFileLabel(plugin, "preset:ministry", "ko"), "업무보고");
    assert.equal(gongmunFileLabel(plugin, "preset:ministry", "en"), "Ministry briefing");
    assert.equal(gongmunFileLabel(plugin, "builtin:hallym-ilsong", "ko"), "일반문서_한림대 일송");
    assert.equal(gongmunFileLabel(plugin, "builtin:hallym-aicr", "en"), "Report_Hallym AICR");
    assert.equal(gongmunFileLabel(plugin, mine.id, "en"), "Report_우리 학과 보고서");
    assert.equal(gongmunFileLabel(plugin, "gongmun:missing", "ko"), "");
    for (const item of GONGMUN_PRESETS) assert.ok(gongmunFileLabel(plugin, gongmunFormId(item.value), "ko"));
  });
});

describe("one list of official-document forms (R-026)", () => {
  it("lists the frames (with the two 2.7.x variants), then the institutions' forms, then the user's forms", () => {
    const plugin = host();
    putGongmunTemplateInMemory(plugin, newGongmunTemplateRecord(plugin, "우리 학과 보고서", { bodyPt: 13 }, "plan"));
    const forms = listGongmunForms(plugin);
    assert.deepEqual(
      forms.map((form) => form.kind),
      [...GONGMUN_PRESETS.map(() => "standard"), ...BUILTIN_GONGMUN_STYLES.map(() => "builtin"), "custom"]
    );
    // Every 2.7.x type is still one row: 계획서 and 통지 are the report and the general document with a switch on.
    assert.deepEqual(
      forms.filter((form) => form.kind === "standard").map((form) => form.id).sort(),
      GONGMUN_PRESETS.map((item) => gongmunFormId(item.value)).sort()
    );
    assert.equal(forms.find((form) => form.kind === "builtin")?.preset, "minutes");
    assert.equal(forms.at(-1)?.name, "보고서 · 우리 학과 보고서");
    assert.equal(forms.at(-1)?.preset, "plan");
    assert.ok(forms.every((form) => form.description), "every form says what it makes");
  });

  it("starts with the active institution form, else the note's type, else the last type", () => {
    const plugin = host();
    assert.equal(currentGongmunFormId(plugin), gongmunFormId("report"));
    assert.equal(currentGongmunFormId(plugin, "official"), gongmunFormId("official"));
    assert.equal(selectGongmunFormInMemory(plugin, gongmunFormId("minutes")), "minutes");
    assert.equal(currentGongmunFormId(plugin), gongmunFormId("minutes"));
    assert.equal(selectGongmunFormInMemory(plugin, "builtin:hallym-aicr"), "report");
    assert.equal(currentGongmunFormId(plugin, "official"), "form:report/builtin:hallym-aicr");
    // Choosing a standard type clears the institution form.
    selectGongmunFormInMemory(plugin, gongmunFormId("press"));
    assert.equal(getTemplateLibrary(plugin).activeGongmunId, "");
    assert.equal(getTemplateLibrary(plugin).activeGongmunPreset, "press");
    assert.throws(() => selectGongmunFormInMemory(plugin, "preset:letter"));
  });

  it("makes the user's form's own type and keeps it through a reload", () => {
    const plugin = host();
    const record = putGongmunTemplateInMemory(plugin, newGongmunTemplateRecord(plugin, "학과 계획서", {}, "plan"));
    assert.equal(selectGongmunFormInMemory(plugin, record.id), "plan");
    const plan = planGongmunExport(noteApp({ 공문_종류: "보고서" }), FILE, plugin, "report");
    assert.equal(plan.preset, "plan");
    assert.ok(plan.warnings.some((warning) => warning.code === "gongmun-property"));

    const reloaded = normalizeTemplateLibrary(JSON.parse(JSON.stringify(plugin.settings.hanmarkTemplateLibrary)));
    assert.equal(reloaded.gongmunTemplates[record.id]?.preset, "plan");
    assert.equal(reloaded.activeGongmunId, record.id);
    assert.equal(normalizeTemplateLibrary({ activeGongmunPreset: "notice" }).activeGongmunPreset, "notice");
    assert.equal(normalizeTemplateLibrary({ activeGongmunPreset: "letter" }).activeGongmunPreset, "report");
  });

  it("falls back to the last type when neither the window nor the note names one", () => {
    const plugin = host();
    selectGongmunFormInMemory(plugin, gongmunFormId("notice"));
    assert.equal(planGongmunExport(noteApp({}), FILE, plugin).preset, "notice");
    assert.equal(planGongmunExport(noteApp({ 공문_종류: "회의록" }), FILE, plugin).preset, "minutes");
    assert.equal(planGongmunExport(noteApp({ 공문_종류: "회의록" }), FILE, plugin, "press").preset, "press");
  });

  it("remembers whether the HWPX preview shows quick HWPX or an official document", () => {
    assert.equal(normalizeHanmarkSettings({}).hwpxPreviewMode, "quick");
    assert.equal(normalizeHanmarkSettings({ hwpxPreviewMode: "gongmun" }).hwpxPreviewMode, "gongmun");
    assert.equal(normalizeHanmarkSettings({ hwpxPreviewMode: "report" }).hwpxPreviewMode, "quick");
  });
});
