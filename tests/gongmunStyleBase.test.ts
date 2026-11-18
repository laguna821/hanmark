import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { App, TFile } from "obsidian";
import JSZip from "jszip";
import { GONGMUN_FRAMES, presetsOfFrame } from "../src/io/gongmunFormId";
import { gongmunGenerateOptions, planGongmunExport } from "../src/io/gongmunExport";
import { listGongmunLooks } from "../src/io/gongmunForms";
import { normalizeGongmunStyleOptions, resolveGongmunOptions } from "../src/io/gongmunStyle";
import { generateValidatedHwpx } from "../src/io/kordocEngine";
import { newGongmunTemplateRecord, putGongmunTemplateInMemory, type TemplateLibraryHost } from "../src/io/templateLibrary";

const NOTE = ["# 제목", "", "## 추진 배경", "", "- 첫째 항목", "  - 둘째 단계", "", "| 구분 | 값 |", "|---|---|", "| 가 | 나 |"].join("\n");
const FILE = { basename: "노트", path: "노트.md" } as TFile;
const APP = { metadataCache: { getFileCache: () => ({ frontmatter: {} }) } } as unknown as App;

function host(): TemplateLibraryHost {
  return { settings: {}, saveSettings: async () => {} };
}

async function header(data: ArrayBuffer): Promise<string> {
  return (await JSZip.loadAsync(data)).file("Contents/header.xml")!.async("string");
}

describe("the user's form as a look for a frame (M10)", () => {
  it("lists the document types of each frame for the style window", () => {
    assert.deepEqual(
      GONGMUN_FRAMES.map((frame) => [frame, presetsOfFrame(frame)]),
      [
        ["official", ["official"]],
        ["general", ["notice", "minutes"]],
        ["report", ["report", "plan"]],
        ["gaejosik", ["gaejosik"]],
        ["ministry", ["ministry"]],
        ["press", ["press"]],
        ["bangchim", ["bangchim"]]
      ]
    );
  });

  it("keeps the starting look in the form's options and hands it to the engine", () => {
    assert.equal(normalizeGongmunStyleOptions({ agency: " 국세청 " }).agency, "국세청");
    assert.equal(normalizeGongmunStyleOptions({ agency: 7 }).agency, undefined);
    assert.equal("agency" in normalizeGongmunStyleOptions({ bodyPt: 13 }), false);
    const options = resolveGongmunOptions({ preset: "report", style: { agency: "국세청", bodyPt: 13 } });
    assert.equal((options as { agency?: string }).agency, "국세청");
    assert.equal(options.bodyPt, 13);
  });

  it("makes a form that starts from an agency look differ from one that starts from 기본, with its own options on top", async () => {
    const plugin = host();
    const plain = putGongmunTemplateInMemory(plugin, newGongmunTemplateRecord(plugin, "학과 보고서", {}, "report"));
    const based = putGongmunTemplateInMemory(plugin, newGongmunTemplateRecord(plugin, "국세청 바탕 보고서", { agency: "국세청" }, "report"));
    // Both are looks of the 보고서 frame.
    const looks = listGongmunLooks(plugin, "report").map((look) => look.id);
    assert.ok(looks.includes(plain.id) && looks.includes(based.id));
    const generate = async (id: string): Promise<string> => {
      const plan = planGongmunExport(APP, FILE, plugin, undefined, id);
      assert.equal(plan.preset, "report");
      return header((await generateValidatedHwpx(NOTE, gongmunGenerateOptions(plan))).data);
    };
    const plainHeader = await generate(plain.id);
    const basedHeader = await generate(based.id);
    assert.notEqual(basedHeader, plainHeader, "the agency's measured shapes reach the document");
    // The same form twice gives the same header (deterministic).
    assert.equal(await generate(based.id), basedHeader);
  });
});
