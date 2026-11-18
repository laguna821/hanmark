import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { markdownToHwpx, parse } from "kordoc";
import {
  GONGMUN_PROPERTIES,
  gongmunPropertyKeysFor,
  readGongmunProperties
} from "../src/io/gongmunProperties";
import {
  gongmunAutoCleanups,
  normalizeGongmunStyleOptions,
  resolveGongmunOptions
} from "../src/io/gongmunStyle";
import {
  activeGongmunTemplate,
  deleteGongmunTemplateInMemory,
  getTemplateLibrary,
  newGongmunTemplateRecord,
  normalizeTemplateLibrary,
  putGongmunTemplateInMemory,
  setActiveGongmunTemplateInMemory,
  setTemplateFontSubstitutionsInMemory,
  newTemplateRecord,
  putTemplateRecord,
  templateFontSubstitutions,
  setActiveTemplateInMemory,
  type TemplateLibraryHost
} from "../src/io/templateLibrary";
import { GONGMUN_PRESETS } from "../src/io/gongmunExport";
import { bodyLineOffset } from "../src/io/frontmatter";

function host(settings: Record<string, unknown> = {}): TemplateLibraryHost {
  return { settings, saveSettings: async () => {} };
}

describe("official-document note properties (2.7.0 W5)", () => {
  it("reads Korean keys and English aliases into Kordoc options", () => {
    const korean = readGongmunProperties({
      공문_종류: "보도자료",
      보도_시점: "배포 즉시",
      보도_부제: ["첫째 부제", "둘째 부제"],
      보도_담당부서: "홍보과",
      보도_연락처: "02-000-0000",
      공문_기관: "행정안전부"
    });
    assert.equal(korean.preset, "press");
    assert.deepEqual(korean.options.press, {
      release: "배포 즉시",
      sub: ["첫째 부제", "둘째 부제"],
      contact: { dept: "홍보과", phone: "02-000-0000" }
    });
    assert.deepEqual(korean.options.cover, { org: "행정안전부" });

    const english = readGongmunProperties({
      "gongmun-preset": "official",
      "gongmun-org": "Seoul City",
      "gongmun-to": "각 부서장",
      "gongmun-approval": "담당, 팀장, 과장"
    });
    assert.equal(english.preset, "official");
    assert.deepEqual(english.options.docHead, { org: "Seoul City", to: "각 부서장" });
    assert.deepEqual(english.options.approval, ["담당", "팀장", "과장"]);
    assert.deepEqual(english.issues, []);
  });

  it("prefers the Korean key, and reports conflicts, typos, and unreadable values", () => {
    const result = readGongmunProperties({
      공문_수신: "가",
      "gongmun-to": "나",
      공문_수산: "오타",
      공문_표지: "아마도"
    }, "official");
    assert.equal(result.options.docHead?.to, "가");
    assert.deepEqual(
      result.issues.map((issue) => issue.code).sort(),
      ["conflict", "invalid", "unknown"]
    );
  });

  it("turns the cover off with a boolean property and keeps it off", () => {
    const result = readGongmunProperties({ 공문_표지: "끄기", 공문_기관: "기관" }, "report");
    assert.equal(result.options.cover, false);
  });

  it("offers insertable keys that exist in the table for every preset", () => {
    const keys = new Set(GONGMUN_PROPERTIES.map((spec) => spec.key));
    for (const preset of GONGMUN_PRESETS) {
      for (const key of gongmunPropertyKeysFor(preset.value)) assert.ok(keys.has(key), key);
    }
    assert.ok(gongmunPropertyKeysFor("official").includes("공문_수신"));
    assert.ok(!gongmunPropertyKeysFor("report").includes("공문_수신"));
    assert.equal(GONGMUN_PRESETS.length, 9);
  });
});

describe("institution style and option precedence", () => {
  it("keeps only valid bounded style values", () => {
    const style = normalizeGongmunStyleOptions({
      bodyFont: "gothic",
      bodyPt: "13",
      lineSpacing: 999,
      bandColor: "#dfe6f7",
      bandTextColor: "blue",
      margins: { top: 20, bottom: 10, left: 20, right: 20 },
      levels: { "0": { font: "HY견고딕", pt: 16, bold: true }, "9": { font: "x" } },
      approval: ["담당", "", "과장"],
      unknown: true
    });
    assert.deepEqual(style, {
      bodyFont: "gothic",
      bodyPt: 13,
      bandColor: "#DFE6F7",
      levels: { "0": { font: "HY견고딕", pt: 16, bold: true } },
      margins: { top: 20, bottom: 10, left: 20, right: 20 },
      approval: ["담당", "과장"]
    });
  });

  it("layers window preset, note properties, and institution style", () => {
    const style = normalizeGongmunStyleOptions({ org: "기관 서식 이름", approval: ["담당"], bodyPt: 14, cover: false });
    const note = readGongmunProperties({ 공문_결재: ["주무관", "팀장"], 공문_부서: "기획과" }, "report").options;
    const options = resolveGongmunOptions({ preset: "report", style, note });
    assert.equal(options.preset, "report");
    assert.equal(options.bodyPt, 14);
    assert.deepEqual(options.approval, ["주무관", "팀장"], "note beats institution");
    assert.deepEqual(options.cover, { org: "기관 서식 이름", dept: "기획과" }, "note content turns the cover on");

    const draft = resolveGongmunOptions({ preset: "official", style, note: {} });
    assert.deepEqual(draft.docHead, { org: "기관 서식 이름" }, "draft letters print the organization in the head table");
    assert.equal(draft.cover, false);
  });

  it("lists text the generator removes silently, outside code blocks", () => {
    const cleanups = gongmunAutoCleanups([
      "근거: 개인정보 보호법(011357) 제15조",
      "지역(법정동 코드 1168010100) 기준",
      "```",
      "DT_CODE_A 는 예시",
      "```",
      "법령 MCP 조회 결과"
    ].join("\n"));
    assert.deepEqual(cleanups.map((item) => [item.line, item.kind]), [
      [1, "law-code"],
      [2, "region-code"],
      [6, "tool-note"]
    ]);
  });

  it("maps lint lines back to the editor after frontmatter", () => {
    assert.equal(bodyLineOffset("---\ntitle: x\n공문_종류: 보고서\n---\n\n# 제목\n본문"), 5);
    assert.equal(bodyLineOffset("# 제목\n본문"), 0);
  });
});

describe("template library schema 3", () => {
  it("migrates schema 1 losslessly and keeps institution styles and font rules", () => {
    const v1 = normalizeTemplateLibrary({ schemaVersion: 1, activeId: "builtin:korean-communication", customTemplates: {} });
    assert.equal(v1.schemaVersion, 3);
    assert.equal(v1.activeId, "builtin:korean-communication");
    assert.deepEqual(v1.gongmunTemplates, {});
    assert.equal(v1.activeGongmunId, "");

    const plugin = host();
    const record = newGongmunTemplateRecord(plugin, "서울시 보고서", { bodyPt: 15, h2Marker: "band" });
    putGongmunTemplateInMemory(plugin, record);
    setActiveGongmunTemplateInMemory(plugin, record.id);
    assert.equal(activeGongmunTemplate(plugin)?.name, "서울시 보고서");
    const reloaded = normalizeTemplateLibrary(JSON.parse(JSON.stringify(plugin.settings.hanmarkTemplateLibrary)));
    assert.deepEqual(reloaded.gongmunTemplates[record.id]?.options, { bodyPt: 15, h2Marker: "band" });
    assert.equal(deleteGongmunTemplateInMemory(plugin, record.id), true);
    assert.equal(getTemplateLibrary(plugin).activeGongmunId, "");

    const custom = putTemplateRecord(plugin, newTemplateRecord(plugin, "양식", undefined, { tables: [] }));
    setActiveTemplateInMemory(plugin, custom.id);
    setTemplateFontSubstitutionsInMemory(plugin, custom.id, { HY견고딕: "맑은 고딕", "": "x" });
    assert.deepEqual(templateFontSubstitutions(plugin), { HY견고딕: "맑은 고딕" });
    setTemplateFontSubstitutionsInMemory(plugin, custom.id, undefined);
    assert.deepEqual(templateFontSubstitutions(plugin), {});
  });
});

describe("official documents through the real engine", () => {
  it("writes note-property content into the generated draft letter", async () => {
    const properties = readGongmunProperties({
      공문_수신: "각 부서장",
      공문_기관: "한림대학교",
      공문_발신명의: "한림대학교총장"
    }, "official");
    const options = resolveGongmunOptions({ preset: "official", note: properties.options });
    const data = await markdownToHwpx("# 교육 과정 운영 안내\n\n1. 관련 규정을 확인합니다.\n", { gongmun: options });
    const parsed = await parse(data);
    assert.equal(parsed.success, true);
    const text = parsed.success ? parsed.markdown : "";
    assert.match(text, /각 부서장/u);
    assert.match(text, /한림대학교/u);
  });
});
