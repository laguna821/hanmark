import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { App, TFile } from "obsidian";
import JSZip from "jszip";
import { markdownToHwpx, parse } from "kordoc";
import {
  SAMPLE_PACK_MAX_BYTES,
  SampleLookError,
  exportSampleLookPack,
  importSampleLookPack,
  learnLookFromHwpx,
  normalizeSampleLookRecord,
  openSampleLook,
  readSampleFacts
} from "../src/io/sampleLook";
import { generateValidatedHwpx } from "../src/io/kordocEngine";
import { gongmunGenerateOptions, planGongmunExport } from "../src/io/gongmunExport";
import {
  getTemplateLibrary,
  gongmunStyleById,
  newGongmunTemplateRecord,
  normalizeTemplateLibrary,
  putGongmunTemplateInMemory,
  type TemplateLibraryHost
} from "../src/io/templateLibrary";

const SAMPLE_NOTE = [
  "# 2026년 교육과정 운영 보고",
  "",
  "> 공통과목을 다섯 개로 줄인다.",
  "",
  "## 추진 배경",
  "",
  "- 평가 기준을 다시 설계한다",
  "  - 실습과목 열두 개 가운데 아홉 개가 해당한다",
  "",
  "※ 세부 일정은 붙임과 같다",
  "",
  "| 구분 | 올해 | 내년 |",
  "|---|---|---|",
  "| 공통과목 | 7개 | 5개 |"
].join("\n");

const NOTE = ["# 워크숍 준비안", "", "## 장소", "", "- 가평과 홍천을 검토한다", "  - 객실 다섯 개", "", "| 후보 | 거리 |", "|---|---|", "| 가평 | 1시간 |"].join("\n");

/** A sample "institution document": a report with 25 mm side margins and its own body font. */
async function sample(): Promise<Uint8Array> {
  const data = await markdownToHwpx(SAMPLE_NOTE, {
    gongmun: { preset: "report", margins: { top: 20, bottom: 15, left: 25, right: 25 }, fonts: { body: "한림고딕체 Regular" } }
  });
  return new Uint8Array(data);
}

function host(): TemplateLibraryHost {
  return { settings: {}, saveSettings: async () => {} };
}

const FILE = { basename: "노트", path: "노트.md" } as TFile;
const APP = { metadataCache: { getFileCache: () => ({ frontmatter: {} }) } } as unknown as App;

describe("a look learned from a sample HWPX (R-036)", () => {
  it("keeps the sample's page setup and fonts in what it makes, and the same bytes twice", async () => {
    const bytes = await sample();
    const direct = await readSampleFacts(bytes);
    assert.equal(direct.marginsMm.left, 25);
    assert.equal(direct.marginsMm.right, 25);
    assert.ok(direct.fonts.includes("한림고딕체 Regular"));

    const look = await learnLookFromHwpx(bytes, "우리 기관 보고서");
    assert.deepEqual(look.facts, direct);
    assert.ok(look.roles.includes("title"));
    assert.ok(look.sourceSha256.length >= 32);

    const first = await generateValidatedHwpx(NOTE, { sampleLook: look });
    const second = await generateValidatedHwpx(NOTE, { sampleLook: look });
    assert.deepEqual(new Uint8Array(first.data), new Uint8Array(second.data));
    const made = await readSampleFacts(new Uint8Array(first.data));
    assert.deepEqual(made.pageMm, direct.pageMm);
    assert.deepEqual(made.marginsMm, direct.marginsMm);
    assert.deepEqual(made.fonts, direct.fonts);

    // The note's own text is there and the sample's is not.
    const back = await parse(first.data, { hancomFallback: false, ocr: false });
    assert.ok(back.success);
    assert.match(back.markdown, /워크숍 준비안/u);
    assert.match(back.markdown, /가평과 홍천을 검토한다/u);
    assert.doesNotMatch(back.markdown, /공통과목을 다섯 개로 줄인다/u);
  });

  it("is stored inside the template library and reaches every export through the plan", async () => {
    const plugin = host();
    const look = await learnLookFromHwpx(await sample(), "우리 기관 보고서");
    const record = putGongmunTemplateInMemory(plugin, { ...newGongmunTemplateRecord(plugin, "우리 기관 보고서", {}, "report"), sample: look });
    // A settings round trip (data.json) keeps the look.
    const reloaded = host();
    reloaded.settings.hanmarkTemplateLibrary = normalizeTemplateLibrary(JSON.parse(JSON.stringify(getTemplateLibrary(plugin))));
    const choice = gongmunStyleById(reloaded, record.id);
    assert.deepEqual(choice?.sample, look);

    const plan = planGongmunExport(APP, FILE, reloaded, undefined, record.id);
    const options = gongmunGenerateOptions(plan);
    assert.deepEqual(options.sampleLook, look);
    const generated = await generateValidatedHwpx("## 장소\n\n- 가평", options);
    const made = await readSampleFacts(new Uint8Array(generated.data));
    assert.deepEqual(made.marginsMm, look.facts.marginsMm);
    // A note without a title takes the file name, as official documents do.
    const back = await parse(generated.data, { hancomFallback: false, ocr: false });
    assert.ok(back.success && /노트/u.test(back.markdown));
  });

  it("tells which parts the sample has no shape for", async () => {
    const plain = new Uint8Array(await markdownToHwpx("# 제목만 있는 견본\n\n본문 한 줄."));
    const look = await learnLookFromHwpx(plain, "얇은 견본");
    assert.ok(look.missing.length > 0);
    const opened = await openSampleLook(look);
    assert.ok(opened.roleWarnings("> 요약 한 줄\n\n## 장 제목\n\n- 항목").length > 0);
    const generated = await generateValidatedHwpx("# 문서\n\n> 요약 한 줄\n\n## 장 제목\n\n- 항목", { sampleLook: look });
    assert.ok(generated.warnings.some((warning) => warning.code === "engine-note"));
  });

  it("learns from a sample saved without version.xml (older generators)", async () => {
    const zip = await JSZip.loadAsync(await sample());
    zip.remove("version.xml");
    const old = await zip.generateAsync({ type: "uint8array" });
    const look = await learnLookFromHwpx(old, "옛 견본");
    const generated = await generateValidatedHwpx(NOTE, { sampleLook: look });
    assert.ok((await JSZip.loadAsync(generated.data)).file("version.xml"));
    assert.deepEqual((await readSampleFacts(new Uint8Array(generated.data))).marginsMm, look.facts.marginsMm);
  });

  it("shares a look as a .kpack with the same bytes every time", async () => {
    const look = await learnLookFromHwpx(await sample(), "우리 기관 보고서");
    const file = exportSampleLookPack(look);
    assert.deepEqual(exportSampleLookPack(look), file);
    const imported = await importSampleLookPack(file);
    assert.equal(imported.pack, look.pack);
    assert.deepEqual(imported.roles, look.roles);
    assert.deepEqual(imported.facts.marginsMm, look.facts.marginsMm);
    const a = await generateValidatedHwpx(NOTE, { sampleLook: look });
    const b = await generateValidatedHwpx(NOTE, { sampleLook: imported });
    assert.deepEqual(new Uint8Array(a.data), new Uint8Array(b.data));
  });

  it("treats an imported pack as an untrusted file", async () => {
    const look = await learnLookFromHwpx(await sample(), "우리 기관 보고서");
    const good = exportSampleLookPack(look);
    const repack = async (change: (zip: JSZip) => void): Promise<Uint8Array> => {
      const zip = await JSZip.loadAsync(good);
      change(zip);
      return zip.generateAsync({ type: "uint8array" });
    };
    const refused = async (bytes: Uint8Array, code: string): Promise<void> => {
      await assert.rejects(importSampleLookPack(bytes), (error: unknown) => error instanceof SampleLookError && error.code === code);
    };
    await refused(new Uint8Array([1, 2, 3, 4]), "pack-invalid");
    await refused(new Uint8Array(SAMPLE_PACK_MAX_BYTES + 1), "pack-too-large");
    await refused(await repack((zip) => zip.file("../evil.txt", "x")), "pack-invalid");
    await refused(await repack((zip) => zip.file("kinds/../../evil.hwpx", "x")), "pack-invalid");
    await refused(await repack((zip) => zip.file("script.js", "alert(1)")), "pack-invalid");
    await refused(await repack((zip) => zip.remove("pack.json")), "pack-invalid");
    await refused(await repack((zip) => zip.file("pack.json", "{not json")), "pack-invalid");
    await refused(
      await repack((zip) => {
        for (let index = 0; index < 20; index += 1) zip.file(`kinds/extra${index}.hwpx`, "x");
      }),
      "pack-invalid"
    );
    // Stored data that is not a look is dropped, not trusted.
    assert.equal(normalizeSampleLookRecord({ pack: "not base64 !!" }), undefined);
    assert.equal(normalizeSampleLookRecord({ pack: "" }), undefined);
    assert.equal(normalizeSampleLookRecord(null), undefined);
  });
});

describe("equations as Hangul equation objects (R-036)", () => {
  const MATH = "# 수식\n\n에너지는 $E = mc^2$ 이고 가격은 $5 이다.\n";

  it("leaves documents made without the option exactly as they were", async () => {
    const plain = await generateValidatedHwpx(MATH, {});
    const off = await generateValidatedHwpx(MATH, { inlineMath: false });
    assert.deepEqual(new Uint8Array(off.data), new Uint8Array(plain.data));
    const section = await (await JSZip.loadAsync(plain.data)).file("Contents/section0.xml")!.async("string");
    assert.doesNotMatch(section, /<hp:equation\b/u);
    assert.match(section, /E = mc\^2/u);
  });

  it("makes an equation object of a matched pair and leaves a lone dollar sign as text", async () => {
    const on = await generateValidatedHwpx(MATH, { inlineMath: true });
    const again = await generateValidatedHwpx(MATH, { inlineMath: true });
    assert.deepEqual(new Uint8Array(on.data), new Uint8Array(again.data));
    const section = await (await JSZip.loadAsync(on.data)).file("Contents/section0.xml")!.async("string");
    assert.equal((section.match(/<hp:equation\b/gu) ?? []).length, 1);
    assert.match(section, /가격은 \$5 이다/u);
    const official = await generateValidatedHwpx(MATH, { inlineMath: true, gongmun: { preset: "report" } });
    const officialSection = await (await JSZip.loadAsync(official.data)).file("Contents/section0.xml")!.async("string");
    assert.equal((officialSection.match(/<hp:equation\b/gu) ?? []).length, 1);
  });
});
