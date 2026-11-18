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
  learnLook,
  learnLookFromHwpx,
  normalizeSampleLookRecord,
  openSampleLook,
  readSampleFacts,
  removeLeftoverText
} from "../src/io/sampleLook";
import { measureSample, measuredStyleOptions, trustedBody } from "../src/io/sampleMeasure";
import { believablePdfMargins } from "../src/io/sampleLook";
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
  "- 운영 기준을 새로 마련한다",
  "  - 실습과목 열두 개 가운데 아홉 개가 해당한다",
  "  - 공통과목 일곱 개 가운데 두 개를 합친다",
  "",
  "※ 세부 일정은 붙임과 같다",
  "",
  "| 구분 | 올해 | 내년 |",
  "|---|---|---|",
  "| 공통과목 | 7개 | 5개 |"
].join("\n");

const NOTE = ["# 워크숍 준비안", "", "## 장소", "", "- 가평과 홍천을 검토한다", "- 춘천 근교도 함께 검토한다", "  - 객실 다섯 개", "  - 세미나실 한 곳", "", "| 후보 | 거리 |", "|---|---|", "| 가평 | 1시간 |"].join("\n");

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

describe("values measured from a sample (R-036)", () => {
  /** A sample with a body font of its own and no item levels: a form letter, not a report. */
  async function letter(): Promise<Uint8Array> {
    const data = await markdownToHwpx(
      ["# 안내문", "", "이 문서는 본문 문단만으로 이루어진 안내문입니다.", "", "둘째 문단도 본문 모양으로 충분히 길게 적습니다.", "", "셋째 문단도 본문 모양으로 충분히 길게 적습니다.", "", "| 구분 | 내용 |", "|---|---|", "| 일시 | 3월 |"].join("\n"),
      { gongmun: { preset: "notice", bodyPt: 13, lineSpacing: 170, margins: { top: 22, bottom: 14, left: 26, right: 24 }, fonts: { body: "한림명조" } } }
    );
    return new Uint8Array(data);
  }

  it("reads margins, the body shape, levels by their marks, and the table header fill", async () => {
    const measure = await measureSample(await sample());
    assert.deepEqual(measure.marginsMm, { top: 20, bottom: 15, left: 25, right: 25 });
    assert.equal(measure.levels["0"]?.marker, "□");
    assert.ok(measure.levels["0"]!.pt > 0);
    assert.ok(measure.ref, "the ※ note is found");
    assert.match(measure.table?.headerFill ?? "", /^#[0-9A-F]{6}$/u);

    const plain = await measureSample(await letter());
    assert.equal(plain.body?.font, "한림명조");
    assert.equal(plain.body?.pt, 13);
    assert.equal(plain.body?.lineSpacing, 170);
    assert.deepEqual(plain.levels, {});
    const { options, items } = measuredStyleOptions(plain);
    assert.deepEqual(options.margins, { top: 22, bottom: 14, left: 26, right: 24 });
    assert.equal(options.fonts?.body, "한림명조");
    assert.equal(options.bodyPt, 13);
    assert.equal(options.lineSpacing, 170);
    // A level the sample lacks takes the body font and says so.
    assert.deepEqual(options.levels?.["0"], { font: "한림명조" });
    assert.equal(items.find((item) => item.part === "level0")?.source, "body");
    assert.equal(items.find((item) => item.part === "body")?.source, "sample");
  });

  it("uses a sample without item shapes by its measured values, through the frame's own structure", async () => {
    const learned = await learnLook(await letter(), "안내문 견본");
    assert.equal(learned.templateFits, false);
    assert.equal(learned.sample.use, "measured");
    const plugin = host();
    const record = putGongmunTemplateInMemory(plugin, {
      ...newGongmunTemplateRecord(plugin, "안내문 견본", learned.options, "report"),
      sample: learned.sample
    });
    const options = gongmunGenerateOptions(planGongmunExport(APP, FILE, plugin, undefined, record.id));
    // The official-document path runs (outline, finishing), not the template path.
    assert.equal(options.sampleLook, undefined);
    assert.equal(options.gongmun?.fonts?.body, "한림명조");
    const generated = await generateValidatedHwpx(NOTE, options);
    const made = await measureSample(new Uint8Array(generated.data));
    assert.deepEqual(made.marginsMm, learned.measure.marginsMm);
    assert.equal(made.levels["0"]?.font, "한림명조");
    assert.equal(made.body?.lineSpacing ?? made.levels["0"]?.lineSpacing, 170);
    const again = await generateValidatedHwpx(NOTE, options);
    assert.deepEqual(new Uint8Array(again.data), new Uint8Array(generated.data));
  });

  it("uses a sample with item shapes as a template when a trial keeps its shapes", async () => {
    const learned = await learnLook(await sample(), "보고서 견본");
    assert.equal(learned.sample.use, learned.templateFits ? "template" : "measured");
    assert.ok(learned.items.some((item) => item.part === "level0" && item.source === "sample"));
    assert.equal(learned.sample.headerFill, learned.measure.table?.headerFill);
  });

  it("draws the sample's table header fill through the finishing when used by measured values", async () => {
    const plugin = host();
    const learned = await learnLook(await sample(), "보고서 견본");
    const record = putGongmunTemplateInMemory(plugin, {
      ...newGongmunTemplateRecord(plugin, "보고서 견본", learned.options, "report"),
      sample: { ...learned.sample, use: "measured", headerFill: "#203864" }
    });
    const choice = gongmunStyleById(plugin, record.id);
    assert.deepEqual(choice?.finish?.tableHeader, { fill: "#203864", textColor: "#FFFFFF" });
    const generated = await generateValidatedHwpx(NOTE, gongmunGenerateOptions(planGongmunExport(APP, FILE, plugin, undefined, record.id)));
    assert.equal((await measureSample(new Uint8Array(generated.data))).table?.headerFill, "#203864");
  });

  it("removes chosen fixed text from the stored sample and keeps the look working", async () => {
    // A sample whose emptied form keeps a fixed line: a table cell label the engine does not clear.
    const learned = await learnLook(await sample(), "보고서 견본");
    const pack = await JSZip.loadAsync(exportSampleLookPack(learned.sample));
    const kindName = Object.keys(pack.files).find((name) => /^kinds\/.+\.hwpx$/u.test(name))!;
    const inner = await JSZip.loadAsync(await pack.file(kindName)!.async("uint8array"));
    const section = await inner.file("Contents/section0.xml")!.async("string");
    const fixed = "한림대학교 미디어스쿨 내부 문서";
    inner.file("Contents/section0.xml", section.replace(/<hp:t>([^<]*)<\/hp:t>/u, `<hp:t>${fixed}</hp:t>`));
    pack.file(kindName, await inner.generateAsync({ type: "uint8array" }));
    const withFixed = { ...(await importSampleLookPack(await pack.generateAsync({ type: "uint8array" }))), leftover: [fixed] };
    const before = await (await JSZip.loadAsync((await openSampleLook(withFixed)).template)).file("Contents/section0.xml")!.async("string");
    assert.ok(before.includes(fixed));

    const cleaned = await removeLeftoverText(withFixed, [fixed]);
    assert.deepEqual(cleaned.leftover, []);
    const after = await (await JSZip.loadAsync((await openSampleLook(cleaned)).template)).file("Contents/section0.xml")!.async("string");
    assert.ok(!after.includes(fixed));
    const generated = await generateValidatedHwpx(NOTE, { sampleLook: { ...cleaned, use: "template" } });
    const back = await parse(generated.data, { hancomFallback: false, ocr: false });
    assert.ok(back.success && !back.markdown.includes(fixed) && /워크숍 준비안/u.test(back.markdown));
    // Nothing chosen: the same record.
    assert.equal(await removeLeftoverText(withFixed, []), withFixed);
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

describe("a look from a report PDF", () => {
  it("takes side margins only where they can be believed", () => {
    const frame = { top: 15, bottom: 15, left: 20, right: 20 };
    // Justified lines reach the right edge: both sides are taken, top and bottom never.
    assert.deepEqual(believablePdfMargins({ top: 28, bottom: 32.5, left: 22, right: 22.5 }, frame), {
      margins: { top: 15, bottom: 15, left: 22, right: 22.5 },
      taken: { left: 22, right: 22.5 }
    });
    // Short item lines: the right "margin" is only where text happened to end.
    assert.deepEqual(believablePdfMargins({ top: 29.5, bottom: 60, left: 22, right: 47.5 }, frame), {
      margins: { top: 15, bottom: 15, left: 22, right: 20 },
      taken: { left: 22 }
    });
    assert.equal(believablePdfMargins({ top: 20, bottom: 20, left: 82, right: 82 }, frame), undefined);
    assert.equal(believablePdfMargins(undefined, frame), undefined);
  });
});

describe("a sample that is all tables", () => {
  const margins = { top: 15, bottom: 5, left: 20, right: 20 };
  it("does not take its one title line as the body shape", () => {
    const measure = {
      body: { font: "HY중고딕", pt: 18, bold: true, lineSpacing: 145, count: 1 },
      levels: {},
      table: { font: "HY중고딕", pt: 10, headerFill: "#DEF6ED" },
      marginsMm: margins
    };
    assert.equal(trustedBody(measure), undefined);
    const { options, items } = measuredStyleOptions(measure);
    assert.equal(options.bodyPt, undefined, "the frame keeps its body size");
    assert.equal(options.lineSpacing, undefined);
    assert.equal(options.fonts?.body, "HY중고딕", "the tables' font is the document's font");
    assert.deepEqual(options.levels?.["0"], { font: "HY중고딕" });
    assert.deepEqual(items.find((item) => item.part === "body"), { part: "body", source: "table", value: "HY중고딕" });
    assert.deepEqual(options.margins, margins);
  });
  it("keeps a lone body line of body size, and any repeated shape", () => {
    assert.ok(trustedBody({ body: { font: "휴먼명조", pt: 13, bold: true, lineSpacing: 180, count: 1 }, levels: {}, marginsMm: margins }));
    assert.ok(trustedBody({ body: { font: "HY헤드라인M", pt: 16, bold: false, count: 4 }, levels: {}, marginsMm: margins }));
  });
});
