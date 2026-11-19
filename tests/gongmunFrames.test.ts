import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import type { App, TFile } from "obsidian";
import JSZip from "jszip";
import { AGENCY_COMMON_NAME, agencyNames, agencyStyle } from "kordoc";
import {
  canonicalGongmunFormId,
  currentGongmunFormId,
  describeGongmunForm,
  gongmunFileLabel,
  gongmunGenerateOptions,
  listGongmunForms,
  planGongmunExport,
  selectGongmunFormInMemory
} from "../src/io/gongmunExport";
import {
  agencyLook,
  formatGongmunFormId,
  FRAME_OPTIONS,
  GONGMUN_FRAMES,
  gongmunFormChoice,
  LOOK_BASIC,
  parseGongmunFormId,
  presetOfFrame,
  type GongmunFrame
} from "../src/io/gongmunFormId";
import {
  AGENCY_FRAMES,
  agencyGroupOf,
  gongmunFormName,
  gongmunLookAllowed,
  gongmunLookByName,
  isSmallSampleAgency,
  listGongmunLooks,
  resolveGongmunForm,
  withGongmunFrame,
  withGongmunFrameOption,
  withGongmunLook
} from "../src/io/gongmunForms";
import { migrateGongmunFormMemory } from "../src/io/gongmunFormMigration";
import { readGongmunProperties, gongmunPropertyKeysFor } from "../src/io/gongmunProperties";
import { generateValidatedHwpx } from "../src/io/kordocEngine";
import {
  getTemplateLibrary,
  newGongmunTemplateRecord,
  normalizeTemplateLibrary,
  putGongmunTemplateInMemory,
  recordGongmunLookUseInMemory,
  toggleGongmunLookFavoriteInMemory,
  deleteGongmunTemplateInMemory,
  type TemplateLibraryHost
} from "../src/io/templateLibrary";
import { normalizeHanmarkSettings } from "../src/legacy-port/settings";
import { lookSections } from "../src/ui/gongmunFormPicker";
import { BASELINE_DAY, BASELINE_FORMS, BASELINE_FRONTMATTER, BASELINE_NOTE } from "./fixtures/gongmunFormBaselineNote";

function host(settings: Record<string, unknown> = {}): TemplateLibraryHost {
  return { settings, saveSettings: async () => {} };
}

function noteApp(frontmatter: Record<string, unknown>): App {
  return { metadataCache: { getFileCache: () => ({ frontmatter }) } } as unknown as App;
}

const FILE = { basename: "기준 노트", path: "기준 노트.md" } as TFile;
const form = (frame: GongmunFrame, look = LOOK_BASIC, options = {}): string => formatGongmunFormId(gongmunFormChoice(frame, look, options));

/** Runs `work` with `new Date()` fixed to the baseline day (cover dates are the export day). */
async function onBaselineDay<T>(work: () => Promise<T>): Promise<T> {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length) super(...(args as [number]));
      else super(BASELINE_DAY);
    }
    static now(): number {
      return new RealDate(BASELINE_DAY).getTime();
    }
  }
  globalThis.Date = FixedDate as DateConstructor;
  try {
    return await work();
  } finally {
    globalThis.Date = RealDate;
  }
}

async function xmlOf(data: ArrayBuffer): Promise<{ section: string; header: string }> {
  const zip = await JSZip.loadAsync(data);
  return {
    section: await zip.file("Contents/section0.xml")!.async("string"),
    header: await zip.file("Contents/header.xml")!.async("string")
  };
}

const sha = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

async function generate(plugin: TemplateLibraryHost, id: string, frontmatter = BASELINE_FRONTMATTER): Promise<{ data: ArrayBuffer; section: string; header: string; warnings: string[] }> {
  const plan = planGongmunExport(noteApp(frontmatter), FILE, plugin, undefined, id);
  const generated = await generateValidatedHwpx(BASELINE_NOTE, gongmunGenerateOptions(plan));
  return { data: generated.data, ...(await xmlOf(generated.data)), warnings: plan.warnings.map((warning) => warning.message) };
}

describe("frame and look ids (R-030)", () => {
  it("writes one canonical id per choice and reads it back", () => {
    assert.equal(form("report"), "form:report/basic");
    assert.equal(form("report", LOOK_BASIC, { cover: true, toc: true }), "form:report/basic;cover=1;toc=1");
    assert.equal(form("gaejosik"), "form:gaejosik/basic", "the bullet-style report has a cover and contents by default");
    assert.equal(form("gaejosik", LOOK_BASIC, { cover: false }), "form:gaejosik/basic;cover=0");
    assert.equal(form("general", LOOK_BASIC, { closing: true, toc: true }), "form:general/basic;closing=1", "switches of other frames are dropped");
    assert.equal(form("press", agencyLook("국세청")), "form:press/agency:국세청");
    for (const frame of GONGMUN_FRAMES) {
      const id = form(frame, LOOK_BASIC, Object.fromEntries(FRAME_OPTIONS[frame].map((option) => [option, true])));
      assert.equal(formatGongmunFormId(parseGongmunFormId(id)!), id);
    }
    for (const bad of ["", "preset:report", "form:letter/basic", "form:report", "form:report/basic;cover=2", "form:report/basic;size=1"]) {
      assert.equal(parseGongmunFormId(bad), undefined, bad);
    }
    assert.equal(presetOfFrame("report", { cover: true }), "plan");
    assert.equal(presetOfFrame("general", { closing: true }), "notice");
    assert.equal(presetOfFrame("general", {}), "minutes");
    assert.equal(presetOfFrame("bangchim", { cover: true }), "bangchim");
  });

  it("maps every 2.7.x form onto a frame, a look, and switches", () => {
    const plugin = host();
    const plan = putGongmunTemplateInMemory(plugin, newGongmunTemplateRecord(plugin, "학과 계획서", { bodyPt: 13 }, "plan"));
    const loose = putGongmunTemplateInMemory(plugin, newGongmunTemplateRecord(plugin, "예전 양식", { bodyPt: 12 }));
    const table: Array<[string, string]> = [
      ["preset:official", "form:official/basic"],
      ["preset:report", "form:report/basic"],
      ["preset:plan", "form:report/basic;cover=1"],
      ["preset:notice", "form:general/basic;closing=1"],
      ["preset:minutes", "form:general/basic"],
      ["preset:gaejosik", "form:gaejosik/basic"],
      ["preset:press", "form:press/basic"],
      ["preset:ministry", "form:ministry/basic"],
      ["preset:bangchim", "form:bangchim/basic"],
      ["builtin:hallym-ilsong", "form:general/builtin:hallym-ilsong"],
      ["builtin:hallym-aicr", "form:report/builtin:hallym-aicr"],
      [plan.id, `form:report/${plan.id};cover=1`],
      [loose.id, `form:report/${loose.id}`]
    ];
    for (const [old, next] of table) {
      assert.equal(canonicalGongmunFormId(plugin, old), next, old);
      assert.equal(canonicalGongmunFormId(plugin, next), next, "a 3.0.0 id stays as it is");
    }
    assert.equal(describeGongmunForm(plugin, "preset:plan")?.preset, "plan");
    assert.equal(describeGongmunForm(plugin, "preset:notice")?.preset, "notice");
    assert.equal(describeGongmunForm(plugin, "builtin:hallym-ilsong")?.preset, "minutes");
    assert.equal(describeGongmunForm(plugin, plan.id)?.fixed, true);
    assert.equal(describeGongmunForm(plugin, loose.id)?.fixed, false, "a form saved without a type follows the frame");
    for (const gone of ["preset:letter", "builtin:nope", "gongmun:deleted", "form:report/gongmun:deleted", "form:official/agency:국세청", "form:report/agency:없는청"]) {
      assert.equal(canonicalGongmunFormId(plugin, gone), undefined, gone);
    }
  });
});

describe("settings saved by 2.7.1 load into 3.0.0 (R-030)", () => {
  it("migrates the library, the active form, and every remembered form", () => {
    const styleId = "gongmun:11111111-2222-4333-8444-555555555555";
    const saved = {
      settingsVersion: 2,
      hwpxPreviewMode: "gongmun",
      gongmunFormByNote: {
        "회의/1차.md": "preset:minutes",
        "공지.md": "preset:notice",
        "계획.md": "preset:plan",
        "일송.md": "builtin:hallym-ilsong",
        "연구원.md": "builtin:hallym-aicr",
        "학과.md": styleId,
        "지운 양식.md": "gongmun:00000000-0000-4000-8000-000000000000"
      },
      recentExports: [{ path: "계획 - 계획서.hwpx", format: "hwpx", at: 1 }],
      hanmarkTemplateLibrary: {
        schemaVersion: 2,
        activeId: "builtin:kordoc-default",
        customTemplates: {},
        gongmunTemplates: {
          [styleId]: {
            id: styleId,
            name: "학과 계획서",
            options: { bodyPt: 13 },
            preset: "plan",
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z"
          }
        },
        activeGongmunId: styleId,
        activeGongmunPreset: "notice"
      }
    };
    const settings = normalizeHanmarkSettings(JSON.parse(JSON.stringify(saved))) as unknown as Record<string, unknown>;
    const plugin = host(settings);
    const library = getTemplateLibrary(plugin);
    assert.equal(library.schemaVersion, 3);
    assert.equal(library.gongmunTemplates[styleId]?.name, "학과 계획서", "the user's own form is kept");
    assert.equal(library.activeGongmunId, styleId);
    assert.equal(library.activeGongmunForm, `form:report/${styleId};cover=1`);
    assert.deepEqual(library.gongmunLookFavorites, []);
    assert.deepEqual(library.gongmunLookRecent, []);

    const migrated = migrateGongmunFormMemory(plugin, settings.gongmunFormByNote as Record<string, string>);
    assert.equal(migrated.changed, true);
    assert.deepEqual(migrated.memory, {
      "회의/1차.md": "form:general/basic",
      "공지.md": "form:general/basic;closing=1",
      "계획.md": "form:report/basic;cover=1",
      "일송.md": "form:general/builtin:hallym-ilsong",
      "연구원.md": "form:report/builtin:hallym-aicr",
      "학과.md": `form:report/${styleId};cover=1`,
      "지운 양식.md": "gongmun:00000000-0000-4000-8000-000000000000"
    });
    assert.equal(migrateGongmunFormMemory(plugin, migrated.memory).changed, false, "migrating twice changes nothing");
    assert.equal((settings as { hwpxPreviewMode?: string }).hwpxPreviewMode, "gongmun", "the preview still opens on official documents");
    assert.equal((settings.recentExports as unknown[]).length, 1, "recent exports are untouched");

    // No institution form active: the type chosen last becomes the active frame.
    const typed = normalizeTemplateLibrary({ schemaVersion: 2, activeGongmunId: "", activeGongmunPreset: "notice" });
    assert.equal(typed.activeGongmunForm, "form:general/basic;closing=1");
    assert.equal(normalizeTemplateLibrary({ schemaVersion: 2, activeGongmunId: "builtin:hallym-ilsong" }).activeGongmunForm, "form:general/builtin:hallym-ilsong");
    assert.equal(normalizeTemplateLibrary({}).activeGongmunForm, "form:report/basic");
    // A stored 3.0.0 id whose look is gone falls back instead of breaking the export.
    assert.equal(
      normalizeTemplateLibrary({ schemaVersion: 3, activeGongmunForm: "form:report/gongmun:gone", activeGongmunPreset: "press" }).activeGongmunForm,
      "form:press/basic"
    );
  });

  it("keeps the 2.7.x fields in step so the active form survives a round trip", () => {
    const plugin = host();
    assert.equal(selectGongmunFormInMemory(plugin, form("report", agencyLook("국세청"), { cover: true, toc: true })), "plan");
    const reloaded = normalizeTemplateLibrary(JSON.parse(JSON.stringify(plugin.settings.hanmarkTemplateLibrary)));
    assert.equal(reloaded.activeGongmunForm, "form:report/agency:국세청;cover=1;toc=1");
    assert.equal(reloaded.activeGongmunId, "");
    assert.equal(reloaded.activeGongmunPreset, "plan");
    assert.equal(selectGongmunFormInMemory(plugin, "builtin:hallym-ilsong"), "minutes");
    assert.equal(getTemplateLibrary(plugin).activeGongmunId, "builtin:hallym-ilsong");
    assert.equal(getTemplateLibrary(plugin).activeGongmunForm, "form:general/builtin:hallym-ilsong");
  });
});

describe("looks a frame can use (R-030)", () => {
  it("offers Kordoc's agencies only where they apply, grouped, with small samples marked", () => {
    const plugin = host();
    const names = agencyNames().filter((name) => name !== AGENCY_COMMON_NAME);
    assert.equal(names.length, 52);
    for (const frame of GONGMUN_FRAMES) {
      const looks = listGongmunLooks(plugin, frame);
      assert.equal(looks[0].id, LOOK_BASIC);
      const agencies = looks.filter((look) => look.kind === "agency");
      if (AGENCY_FRAMES.includes(frame)) {
        assert.equal(agencies.length, names.length, frame);
        assert.equal(looks[1].id, agencyLook(AGENCY_COMMON_NAME));
        assert.deepEqual(
          [...new Set(agencies.map((look) => look.groupKey))],
          ["ministry", "office", "agency", "committee", "other"],
          "부, 처, 청, 위원회, then the rest"
        );
      } else {
        assert.equal(agencies.length, 0, frame);
        assert.equal(gongmunLookAllowed(plugin, frame, agencyLook("국세청")), false);
        assert.equal(resolveGongmunForm(plugin, form(frame, agencyLook("국세청"))), undefined);
      }
    }
    assert.deepEqual(
      ["국세청", "교육부", "법제처", "국민권익위원회", "국무조정실"].map(agencyGroupOf),
      ["agency", "ministry", "office", "committee", "other"]
    );
    // "표본 적음" comes from the engine's own data, not from a list in HanMark.
    for (const name of names) {
      const docs = (agencyStyle(name) as { report?: { docs?: number } }).report?.docs;
      assert.equal(isSmallSampleAgency(name), !(typeof docs === "number" && docs >= 5), name);
    }
    assert.ok(names.some(isSmallSampleAgency) && !names.every(isSmallSampleAgency));
    const marked = listGongmunLooks(plugin, "report").filter((look) => look.smallSample).map((look) => look.name);
    assert.deepEqual(marked.sort(), names.filter(isSmallSampleAgency).sort());
  });

  it("puts the Hallym forms and the user's forms on the look axis of their frame", () => {
    const plugin = host();
    const mine = putGongmunTemplateInMemory(plugin, newGongmunTemplateRecord(plugin, "학과 계획서", {}, "plan"));
    const ids = (frame: GongmunFrame): string[] => listGongmunLooks(plugin, frame).map((look) => look.id);
    assert.ok(ids("general").includes("builtin:hallym-ilsong"));
    assert.ok(!ids("general").includes("builtin:hallym-aicr"));
    assert.ok(ids("report").includes("builtin:hallym-aicr") && ids("report").includes(mine.id));
    assert.ok(!ids("press").includes(mine.id) && !ids("official").includes("builtin:hallym-ilsong"));

    // Changing the frame keeps a look the new frame can use and drops one it cannot.
    const agency = form("report", agencyLook("국세청"), { toc: true });
    assert.equal(withGongmunFrame(plugin, agency, "press"), "form:press/agency:국세청");
    assert.equal(withGongmunFrame(plugin, agency, "official"), "form:official/basic");
    assert.equal(withGongmunFrame(plugin, "builtin:hallym-ilsong", "report"), "form:report/basic");
    // A look made for one type brings its frame; others keep the frame and its switches.
    assert.equal(withGongmunLook(plugin, form("press"), "builtin:hallym-ilsong"), "form:general/builtin:hallym-ilsong");
    assert.equal(withGongmunLook(plugin, agency, agencyLook("교육부")), "form:report/agency:교육부;toc=1");
    assert.equal(withGongmunLook(plugin, form("official"), agencyLook("교육부")), "form:official/basic");
    assert.equal(withGongmunFrameOption(plugin, form("report"), "cover", true), "form:report/basic;cover=1");
    assert.equal(withGongmunFrameOption(plugin, "builtin:hallym-aicr", "toc", true), "form:report/builtin:hallym-aicr", "a fixed look has no switches");
    assert.equal(gongmunFormName(plugin, form("report", agencyLook("국세청"), { cover: true, toc: true })), "보고서 · 국세청 (표지, 목차)");
    assert.equal(gongmunFormName(plugin, form("bangchim", LOOK_BASIC, { cover: true })), "서울방침 (앞장)");
    assert.equal(gongmunFormName(plugin, form("general")), "일반 문서");
  });

  it("keeps favorites and recent looks, and forgets a deleted form", () => {
    const plugin = host();
    const mine = putGongmunTemplateInMemory(plugin, newGongmunTemplateRecord(plugin, "학과 보고서", {}, "report"));
    assert.equal(toggleGongmunLookFavoriteInMemory(plugin, agencyLook("국세청")), true);
    assert.equal(toggleGongmunLookFavoriteInMemory(plugin, mine.id), true);
    assert.equal(toggleGongmunLookFavoriteInMemory(plugin, agencyLook("국세청")), false);
    assert.deepEqual(getTemplateLibrary(plugin).gongmunLookFavorites, [mine.id]);
    assert.equal(recordGongmunLookUseInMemory(plugin, LOOK_BASIC), false, "기본 is always on top already");
    for (const name of ["국세청", "교육부", "관세청", "법제처", "통일부", "기상청"]) recordGongmunLookUseInMemory(plugin, agencyLook(name));
    recordGongmunLookUseInMemory(plugin, agencyLook("교육부"));
    assert.deepEqual(
      getTemplateLibrary(plugin).gongmunLookRecent,
      ["교육부", "기상청", "통일부", "법제처", "관세청"].map(agencyLook),
      "newest first, five at most, no repeats"
    );
    recordGongmunLookUseInMemory(plugin, mine.id);
    const reloaded = normalizeTemplateLibrary(JSON.parse(JSON.stringify(plugin.settings.hanmarkTemplateLibrary)));
    assert.deepEqual(reloaded.gongmunLookFavorites, [mine.id]);
    assert.equal(reloaded.gongmunLookRecent[0], mine.id);
    deleteGongmunTemplateInMemory(plugin, mine.id);
    assert.deepEqual(getTemplateLibrary(plugin).gongmunLookFavorites, []);
    assert.ok(!getTemplateLibrary(plugin).gongmunLookRecent.includes(mine.id));
  });

  it("shows pinned sections only while nothing is typed and filters by part of a name", () => {
    const plugin = host();
    const looks = listGongmunLooks(plugin, "report");
    const idle = lookSections(looks, [agencyLook("국세청")], [agencyLook("교육부")], "");
    assert.deepEqual(idle.slice(0, 2).map((section) => section.key), ["recent", "favorite"]);
    assert.deepEqual(idle[0].looks.map((look) => look.name), ["교육부"]);
    assert.deepEqual(idle[1].looks.map((look) => look.name), ["국세청"]);
    const typed = lookSections(looks, [agencyLook("국세청")], [agencyLook("교육부")], " 국세 ");
    assert.deepEqual(typed.flatMap((section) => section.looks.map((look) => look.name)), ["국세청"]);
    assert.equal(lookSections(looks, [], [], "없는 기관").length, 0);
    assert.equal(lookSections(listGongmunLooks(plugin, "official"), [agencyLook("국세청")], [], "")[0].key.startsWith("standard"), true, "a pinned look the frame cannot use is not shown");
  });
});

describe("the 2.7.x forms keep their output (R-030)", () => {
  it("makes the same section and header XML as the M1 engine port for every 2.7.x form", async () => {
    const baseline = JSON.parse(await readFile("tests/fixtures/gongmunFormBaseline.json", "utf8")) as {
      forms: Record<string, { section: string; header: string }>;
    };
    assert.deepEqual(Object.keys(baseline.forms), [...BASELINE_FORMS]);
    await onBaselineDay(async () => {
      for (const old of BASELINE_FORMS) {
        const plugin = host();
        const next = canonicalGongmunFormId(plugin, old);
        assert.ok(next, old);
        for (const id of [old, next]) {
          const made = await generate(plugin, id);
          // 3.0.0 adds the Hallym emblem to the AICR cover; everything else stays as recorded.
          const withoutLogo = made.section.replace(/<hp:pic\b(?:(?!<\/hp:pic>)[\s\S])*?HanMark cover logo<\/hp:shapeComment><\/hp:pic>/gu, "");
          assert.equal(withoutLogo !== made.section, old === "builtin:hallym-aicr", `${id}: cover logo`);
          assert.equal(sha(withoutLogo), baseline.forms[old].section, `${id}: section0.xml`);
          assert.equal(sha(made.header), baseline.forms[old].header, `${id}: header.xml`);
        }
      }
    });
  });
});

describe("every frame with the looks it can use (R-030)", () => {
  it("generates valid, repeatable HWPX; agency looks change the fonts where they apply", async () => {
    const plugin = host();
    await onBaselineDay(async () => {
      for (const frame of GONGMUN_FRAMES) {
        const looks = [LOOK_BASIC];
        if (AGENCY_FRAMES.includes(frame)) looks.push(agencyLook(AGENCY_COMMON_NAME), agencyLook("국세청"), agencyLook("개인정보보호위원회"));
        if (frame === "general") looks.push("builtin:hallym-ilsong");
        if (frame === "report") looks.push("builtin:hallym-aicr");
        const headers = new Map<string, string>();
        for (const look of looks) {
          const id = withGongmunLook(plugin, form(frame), look);
          assert.ok(resolveGongmunForm(plugin, id), id);
          const first = await generate(plugin, id);
          const second = await generate(plugin, id);
          assert.deepEqual(new Uint8Array(first.data), new Uint8Array(second.data), `${id}: the same note gives the same bytes`);
          headers.set(look, first.header);
        }
        if (AGENCY_FRAMES.includes(frame)) {
          const fonts = (header: string): string[] => [...new Set([...header.matchAll(/<hh:font\b[^>]*\bface="([^"]+)"/gu)].map((match) => match[1]))].sort();
          const basic = headers.get(LOOK_BASIC)!;
          assert.notEqual(headers.get(agencyLook("국세청")), basic, `${frame}: the agency look changes header.xml`);
          assert.notDeepEqual(fonts(headers.get(agencyLook("개인정보보호위원회"))!), fonts(basic), `${frame}: the agency look brings its fonts`);
          assert.notEqual(headers.get(agencyLook("국세청")), headers.get(agencyLook("개인정보보호위원회")), `${frame}: agencies differ`);
        }
      }
    });
  });

  it("applies the frame's switches and releases only the pins they name", async () => {
    const plugin = host();
    const options = (id: string, frontmatter: Record<string, unknown> = {}) =>
      planGongmunExport(noteApp(frontmatter), FILE, plugin, undefined, id).options;
    assert.equal(options(form("report")).toc, undefined, "a switch at its default leaves the note in charge");
    assert.equal(options(form("report"), { 공문_목차: true }).toc, true);
    assert.equal(options(form("report", LOOK_BASIC, { toc: true })).toc, true);
    assert.equal(options(form("report", LOOK_BASIC, { cover: true })).preset, "plan");
    assert.equal(options(form("general", LOOK_BASIC, { closing: true })).preset, "notice");
    const coverless = options(form("gaejosik", LOOK_BASIC, { cover: false }));
    assert.deepEqual([coverless.cover, coverless.bodyTitleBox, coverless.toc], [false, true, true]);
    assert.equal(options(form("gaejosik", LOOK_BASIC, { cover: false, toc: false })).toc, false);
    assert.equal(options(form("gaejosik")).bodyTitleBox, undefined, "with a cover the M1 pin still decides");
    assert.equal(options(form("gaejosik"), { 공문_표지: false }).bodyTitleBox, undefined, "the note alone does not release the pin");
    const policy = options(form("bangchim", LOOK_BASIC, { cover: true, checklist: true, toc: true }));
    assert.equal(policy.preset, "bangchim");
    assert.deepEqual([policy.checklist, policy.toc], [true, true]);
    assert.ok(typeof policy.cover === "object" && /^\d{4}\. \d{1,2}\.$/u.test(policy.cover.date ?? ""), "the front page date is not left as 2026. 11..");
    assert.equal(options(form("press", agencyLook("국세청"))).agency, "국세청");
    assert.equal(options(form("press")).agency, undefined);

    await onBaselineDay(async () => {
      const plain = await generate(plugin, form("report"));
      const contents = await generate(plugin, form("report", LOOK_BASIC, { toc: true }));
      assert.notEqual(contents.section, plain.section);
      assert.match(contents.section, /목\s*차/u, "a report now gets a contents page");
      const policyPaper = await generate(plugin, form("bangchim", LOOK_BASIC, { cover: true, checklist: true, toc: true }));
      assert.match(policyPaper.section, /추진 배경/u);
      const people = await generate(plugin, form("press"), { 보도_담당부서: "미디어스쿨", 보도_담당자표: ["책임자 / 교수 / 안창현 / 033-000-0000", "담당자 / 조교 / 김한림 / 033-000-0001"] });
      assert.match(people.section, /안창현/u);
      assert.match(people.section, /김한림/u);
    });
  });
});

describe("the note names its look (R-030)", () => {
  it("reads 공문_기관서식 and its alias, and offers it for the frames that use agency looks", () => {
    assert.equal(readGongmunProperties({ 공문_기관서식: " 국세청 " }).look, "국세청");
    assert.equal(readGongmunProperties({ "gongmun-agency-style": "교육부" }).look, "교육부");
    assert.deepEqual(readGongmunProperties({ 공문_기관서식: "국세청" }).issues, []);
    assert.deepEqual(readGongmunProperties({ 공문_기관서식: "국세청", "gongmun-agency-style": "교육부" }).issues, [
      { code: "conflict", key: "공문_기관서식", alias: "gongmun-agency-style" }
    ]);
    assert.ok(gongmunPropertyKeysFor("report").includes("공문_기관서식"));
    assert.ok(gongmunPropertyKeysFor("press").includes("공문_기관서식"));
    assert.ok(!gongmunPropertyKeysFor("official").includes("공문_기관서식"));
    assert.deepEqual(readGongmunProperties({ 보도_담당자표: "책임자 / 과장 / 홍길동 / 02-1; 담당자 / 주무관 / 김철수" }).options.press?.contact?.people, [
      { role: "책임자", title: "과장", name: "홍길동", phone: "02-1" },
      { role: "담당자", title: "주무관", name: "김철수" }
    ]);
  });

  it("uses the note's look when no form is chosen, and the chosen form when one is", () => {
    const plugin = host();
    assert.equal(gongmunLookByName(plugin, "국세청"), agencyLook("국세청"));
    assert.equal(gongmunLookByName(plugin, "공통"), agencyLook(AGENCY_COMMON_NAME));
    assert.equal(gongmunLookByName(plugin, "기본"), LOOK_BASIC);
    assert.equal(gongmunLookByName(plugin, "한림대 AI융합연구원 보고서"), "builtin:hallym-aicr");
    assert.equal(gongmunLookByName(plugin, "없는 기관"), undefined);

    const named = planGongmunExport(noteApp({ 공문_종류: "보도자료", 공문_기관서식: "국세청" }), FILE, plugin);
    assert.equal(named.formId, "form:press/agency:국세청");
    assert.equal(named.options.agency, "국세청");
    assert.equal(currentGongmunFormId(plugin, "press", "국세청"), "form:press/agency:국세청");

    const unknown = planGongmunExport(noteApp({ 공문_기관서식: "없는 기관" }), FILE, plugin);
    assert.equal(unknown.formId, "form:report/basic");
    assert.ok(unknown.warnings.some((warning) => /없는 기관/u.test(warning.message)));
    const notAllowed = planGongmunExport(noteApp({ 공문_종류: "기안문", 공문_기관서식: "국세청" }), FILE, plugin);
    assert.equal(notAllowed.formId, "form:official/basic");
    assert.ok(notAllowed.warnings.some((warning) => /기안문/u.test(warning.message)));

    // The window's choice comes first: the note's look does not override it.
    const chosen = planGongmunExport(noteApp({ 공문_기관서식: "국세청" }), FILE, plugin, undefined, form("report", agencyLook("교육부")));
    assert.equal(chosen.options.agency, "교육부");
    // An active look made for one type keeps its type and its look.
    selectGongmunFormInMemory(plugin, "builtin:hallym-ilsong");
    const fixed = planGongmunExport(noteApp({ 공문_종류: "보고서", 공문_기관서식: "국세청" }), FILE, plugin);
    assert.equal(fixed.formId, "form:general/builtin:hallym-ilsong");
    assert.equal(fixed.options.agency, undefined);
  });

  it("names files 틀_모양 in the note's language and lists the short catalog", () => {
    const plugin = host();
    const mine = putGongmunTemplateInMemory(plugin, newGongmunTemplateRecord(plugin, '우리/학과 "보고서"', {}, "plan"));
    assert.equal(gongmunFileLabel(plugin, form("report", agencyLook("국세청"), { cover: true }), "ko"), "보고서_국세청");
    assert.equal(gongmunFileLabel(plugin, form("press", agencyLook(AGENCY_COMMON_NAME)), "en"), "Press release_Common");
    assert.equal(gongmunFileLabel(plugin, "builtin:hallym-ilsong", "ko"), "일반문서_한림대 일송");
    assert.equal(gongmunFileLabel(plugin, mine.id, "ko"), "보고서_우리 학과 보고서");
    assert.equal(gongmunFileLabel(plugin, form("bangchim"), "ko"), "서울방침");
    const catalog = listGongmunForms(plugin);
    assert.deepEqual(
      catalog.filter((item) => item.kind === "standard").map((item) => item.id),
      [
        "form:official/basic",
        "form:general/basic",
        "form:general/basic;closing=1",
        "form:report/basic",
        "form:report/basic;cover=1",
        "form:gaejosik/basic",
        "form:ministry/basic",
        "form:press/basic",
        "form:bangchim/basic"
      ]
    );
    assert.deepEqual(catalog.filter((item) => item.kind !== "standard").map((item) => item.look), ["builtin:hallym-ilsong", "builtin:hallym-aicr", mine.id]);
    const inAgency = listGongmunForms(plugin, form("press", agencyLook("국세청")));
    assert.equal(inAgency.find((item) => item.frame === "official")?.look, LOOK_BASIC);
    assert.deepEqual(
      inAgency.filter((item) => item.look === agencyLook("국세청")).map((item) => item.frame),
      ["report", "report", "gaejosik", "ministry", "press"]
    );
  });
});
