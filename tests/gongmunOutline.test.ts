import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import type { App, TFile } from "obsidian";
import { renderHwpxToSvg, validateHwpx } from "kordoc";
import { paragraphSignature, prepareGongmunMarkdown, usesLegalNumbering } from "../src/io/gongmunOutline";
import { finishGongmunXml } from "../src/io/hwpxFinish";
import { generateValidatedHwpx, type GenerateHwpxOptions } from "../src/io/kordocEngine";
import { resolveGongmunOptions, withCoverDate } from "../src/io/gongmunStyle";
import { BUILTIN_GONGMUN_STYLES, builtinGongmunStyle } from "../src/io/institutionStyles";
import {
  activeGongmunTemplate,
  listGongmunStyleChoices,
  newGongmunTemplateRecord,
  normalizeTemplateLibrary,
  putGongmunTemplateInMemory,
  setActiveGongmunTemplateInMemory,
  type TemplateLibraryHost
} from "../src/io/templateLibrary";
import { gongmunGenerateOptions, noteDocumentTitle, planGongmunExport } from "../src/io/gongmunExport";

function host(settings: Record<string, unknown> = {}): TemplateLibraryHost {
  return { settings, saveSettings: async () => {} };
}

const NOTE = [
  "## 배경",
  "",
  "### 현황",
  "",
  "현황을 짧게 설명하는 문단입니다.",
  "",
  "- 첫째 항목",
  "\t- 둘째 단계",
  "\t\t- 셋째 단계",
  "",
  "## 계획",
  "",
  "#### 1) 세부 계획",
  "",
  "> 참고 내용입니다.",
  ""
].join("\n");

const MARKER = /<hp:run charPrIDRef="\d+"><hp:t>([^<]{1,6})<hp:tab /g;

async function sectionAndHeader(data: ArrayBuffer): Promise<{ section: string; header: string }> {
  const zip = await JSZip.loadAsync(data);
  return {
    section: await zip.file("Contents/section0.xml")!.async("string"),
    header: await zip.file("Contents/header.xml")!.async("string")
  };
}

function markers(section: string): string[] {
  return [...section.matchAll(MARKER)].map((match) => match[1]);
}

/** Left margin of the paragraph shape used by the paragraph that contains `text`. */
function leftMarginOf(section: string, header: string, text: string): number {
  const at = section.indexOf(text);
  const open = section.lastIndexOf("<hp:p ", at);
  const shape = /paraPrIDRef="(\d+)"/.exec(section.slice(open, at))?.[1];
  const element = new RegExp(`<hh:paraPr id="${shape}"[\\s\\S]*?</hh:paraPr>`).exec(header)?.[0] ?? "";
  return Number(/<hc:left value="(-?\d+)"/.exec(element)?.[1] ?? Number.NaN);
}

function styleOptions(id: string, today = new Date(2026, 8, 29)): GenerateHwpxOptions {
  const style = builtinGongmunStyle(id);
  assert.ok(style);
  return {
    gongmun: withCoverDate(resolveGongmunOptions({ preset: style.preset, style: style.options }), today, style.coverDate),
    gongmunFinish: style.finish,
    gongmunOutline: style.outline,
    quietEngineNotes: style.quietEngineNotes,
    gongmunTitle: "문서"
  };
}

describe("official-document outline (R-024)", () => {
  it("keeps one leading # as the title and adds the note name otherwise", () => {
    const titled = prepareGongmunMarkdown("# 제목\n\n## 배경\n", { preset: "report", title: "노트" });
    assert.equal(titled.titleAdded, false);
    assert.equal(titled.markdown, "# 제목\n\n## 배경\n");

    const untitled = prepareGongmunMarkdown("## 배경\n", { preset: "report", title: " 회의  자료 " });
    assert.equal(untitled.titleAdded, true);
    assert.equal(untitled.markdown, "# 회의 자료\n\n## 배경\n");

    const sections = prepareGongmunMarkdown("# 배경\n\n# 계획\n", { preset: "report", title: "노트" });
    assert.equal(sections.markdown, "# 노트\n\n## 배경\n\n## 계획\n");
    assert.equal(sections.headingsChanged, true);

    const late = prepareGongmunMarkdown("## 배경\n\n# 계획\n", { preset: "report", title: "노트" });
    assert.equal(late.markdown, "# 노트\n\n### 배경\n\n## 계획\n");
  });

  it("nests sub-headings under chapters in the legal family and keeps the report family at □", () => {
    const legal = prepareGongmunMarkdown(`# 제목\n\n${NOTE}`, { preset: "official" });
    assert.match(legal.markdown, /^#### 현황$/mu);
    assert.match(legal.markdown, /^##### 1\) 세부 계획$/mu);
    assert.equal(usesLegalNumbering(NOTE, { preset: "minutes" }), true);

    const report = prepareGongmunMarkdown(`# 제목\n\n${NOTE}`, { preset: "report" });
    assert.match(report.markdown, /^### 현황$/mu);
    assert.match(report.markdown, /^#### 1\) 세부 계획$/mu);

    const skipped = prepareGongmunMarkdown("# 제목\n\n## 배경\n\n#### 깊은 제목\n", { preset: "report" });
    assert.match(skipped.markdown, /^### 깊은 제목$/mu);
  });

  it("keeps box numbering when the body already uses □ markers", () => {
    const boxed = "# 제목\n\n## 배경\n\n### 현황\n\n□ 이미 네모 항목\n";
    assert.equal(usesLegalNumbering(boxed, { preset: "official" }), false);
    assert.match(prepareGongmunMarkdown(boxed, { preset: "official" }).markdown, /^### 현황$/mu);
    assert.equal(usesLegalNumbering(NOTE, { preset: "official", numbering: "report" }), false);
  });

  it("leaves headings inside code fences alone", () => {
    const fenced = "# 제목\n\n```md\n# 코드 속 제목\n#### 코드\n```\n\n## 배경\n";
    const result = prepareGongmunMarkdown(fenced, { preset: "official" });
    assert.equal(result.markdown, fenced);
    assert.equal(result.headingsChanged, false);
  });

  it("drops numbers the note wrote before bullet-style sub-headings", () => {
    const note = "# 제목\n\n## 1. 개요\n\n### 1) 세부\n\n### □ 네모\n\n### 1)\n";
    const gaejosik = prepareGongmunMarkdown(note, { preset: "gaejosik" }).markdown;
    assert.match(gaejosik, /^## 1\. 개요$/mu);
    assert.match(gaejosik, /^### 세부$/mu);
    assert.match(gaejosik, /^### 네모$/mu);
    assert.match(gaejosik, /^### 1\)$/mu);
    assert.match(prepareGongmunMarkdown(note, { preset: "report" }).markdown, /^### 1\) 세부$/mu);
  });

  it("nests lists under chapters for styles whose first item level is a sub-heading", () => {
    const note = "# 제목\n\n## 배경\n\n- 목록\n\t- 하위\n\n```\n- 코드\n```\n\n### 소제목\n\n- 소제목 아래\n";
    const nested = prepareGongmunMarkdown(note, { preset: "report", nestChapterLists: true }).markdown;
    assert.match(nested, /^ {2}- 목록$/mu);
    assert.match(nested, /^ {2}\t- 하위$/mu);
    assert.match(nested, /^- 코드$/mu);
    assert.match(nested, /^- 소제목 아래$/mu);
    assert.equal(prepareGongmunMarkdown(note, { preset: "report" }).markdown, note);
  });

  it("lists plain paragraphs line by line with the depth of their heading", () => {
    const note = [
      "# 제목",
      "서론 문단입니다.",
      "## 배경",
      "배경 첫 줄입니다.",
      "배경 둘째 줄입니다.",
      "### 현황",
      "현황 문단입니다.",
      "- 항목",
      "※ 참고 사항",
      "가. 직접 쓴 번호",
      "<center>가운데</center>",
      "출처: 통계청",
      "$$",
      "x = 1",
      "$$",
      "",
      "붙임 1. 자료"
    ].join("\n");
    const { paragraphs } = prepareGongmunMarkdown(note, { preset: "official" });
    assert.deepEqual(paragraphs, [
      { key: paragraphSignature("서론 문단입니다."), depth: 0 },
      { key: paragraphSignature("배경 첫 줄입니다."), depth: 1 },
      { key: paragraphSignature("배경 둘째 줄입니다."), depth: 1 },
      { key: paragraphSignature("현황 문단입니다."), depth: 2 }
    ]);
    assert.deepEqual(prepareGongmunMarkdown(note, { preset: "report" }).paragraphs, []);
  });

  it("compares paragraphs by letters and digits only", () => {
    assert.equal(paragraphSignature("“Hello”, 세계 1!"), "hello세계1");
    assert.equal(paragraphSignature("한글".normalize("NFD")), "한글");
  });

  it("fills a missing cover date as the engine intends", () => {
    const day = new Date(2026, 8, 29);
    const report = withCoverDate(resolveGongmunOptions({ preset: "report", style: { cover: true } }), day);
    assert.deepEqual(report.cover, { date: "2026. 9." });
    const full = withCoverDate(resolveGongmunOptions({ preset: "report", style: { cover: true } }), day, "day");
    assert.deepEqual(full.cover, { date: "2026. 9. 29." });
    assert.deepEqual(withCoverDate({ preset: "report", cover: { date: "2026. 1." } }, day).cover, { date: "2026. 1." });
    assert.equal(withCoverDate({ preset: "report" }, day).cover, undefined);
    assert.equal(withCoverDate({ preset: "gaejosik" }, day).cover, undefined);
    assert.deepEqual(withCoverDate({ preset: "gaejosik" }, day, "day").cover, { date: "2026. 9. 29." });
    assert.equal(withCoverDate({ preset: "press", cover: true }, day, "day").cover, true);
  });
});

describe("finishing generated official documents", () => {
  it("draws the legal hierarchy and moves body paragraphs under their heading", async () => {
    const generated = await generateValidatedHwpx(NOTE, {
      gongmun: resolveGongmunOptions({ preset: "official" }),
      gongmunTitle: "사업 계획"
    });
    assert.equal(generated.validation.ok, true);
    const { section, header } = await sectionAndHeader(generated.data);
    assert.match(section, /사업 계획/u);
    assert.deepEqual(
      markers(section).filter((marker) => marker !== "※"),
      ["1.", "가.", "1)", "가)", "(1)", "2.", "1)"]
    );
    assert.ok(!section.includes("1) 세부 계획"), "the number written in the note is not repeated");
    // Body 12 pt: an item of depth d starts 2·d half-size spaces (600 HWPUNIT each) in.
    assert.equal(leftMarginOf(section, header, "현황을 짧게 설명하는 문단입니다."), 2400);
  });

  it("keeps a flush paragraph before the first heading and after the title", async () => {
    const generated = await generateValidatedHwpx("# 안내\n\n안내 문단입니다.\n\n## 본문\n\n본문 문단입니다.\n", {
      gongmun: resolveGongmunOptions({ preset: "notice" })
    });
    const { section, header } = await sectionAndHeader(generated.data);
    assert.equal(leftMarginOf(section, header, "안내 문단입니다."), 0);
    assert.equal(leftMarginOf(section, header, "본문 문단입니다."), 1200);
  });

  it("reports finishing that found nothing to change", () => {
    const header =
      '<hh:head><hh:charProperties itemCnt="1"><hh:charPr id="0" height="1000" textColor="#000000"><hh:fontRef hangul="0"/></hh:charPr></hh:charProperties>' +
      '<hh:borderFills itemCnt="1"><hh:borderFill id="1"></hh:borderFill></hh:borderFills>' +
      '<hh:paraProperties itemCnt="1"><hh:paraPr id="0"><hh:align horizontal="JUSTIFY"/><hh:margin><hc:intent value="0"/><hc:left value="0"/></hh:margin></hh:paraPr></hh:paraProperties></hh:head>';
    const section = '<hs:sec><hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>본문</hp:t></hp:run></hp:p></hs:sec>';
    const finished = finishGongmunXml(section, header, {
      markers: { legal1: "•" },
      tableHeader: { fill: "#203864", textColor: "#FFFFFF" },
      title: { pt: 15 },
      chapter: { pt: 13 },
      cover: { removeInfoBox: true },
      paragraphs: [{ key: paragraphSignature("다른 문단"), depth: 1 }]
    });
    assert.deepEqual(finished.missed, ["paragraphs", "markers", "tableHeader", "title", "chapter", "cover"]);
    assert.equal(finished.section, section);
    assert.equal(finished.header, header);
  });
});

describe("built-in Hallym institution styles", () => {
  it("lists built-in styles first and keeps a built-in choice active", () => {
    const plugin = host();
    putGongmunTemplateInMemory(plugin, newGongmunTemplateRecord(plugin, "내 서식", { bodyPt: 13 }));
    const choices = listGongmunStyleChoices(plugin);
    assert.deepEqual(
      choices.slice(0, BUILTIN_GONGMUN_STYLES.length).map((choice) => choice.id),
      BUILTIN_GONGMUN_STYLES.map((style) => style.id)
    );
    assert.ok(choices.slice(0, BUILTIN_GONGMUN_STYLES.length).every((choice) => choice.builtIn && choice.group));
    assert.equal(choices.at(-1)?.name, "내 서식");

    setActiveGongmunTemplateInMemory(plugin, "builtin:hallym-ilsong");
    const active = activeGongmunTemplate(plugin);
    assert.equal(active?.preset, "minutes");
    assert.deepEqual(active?.finish?.tableHeader, { fill: "#203864", textColor: "#FFFFFF" });

    const library = normalizeTemplateLibrary({ schemaVersion: 2, activeGongmunId: "builtin:hallym-aicr", gongmunTemplates: {} });
    assert.equal(library.activeGongmunId, "builtin:hallym-aicr");
    assert.equal(normalizeTemplateLibrary({ schemaVersion: 2, activeGongmunId: "builtin:nope" }).activeGongmunId, "");
  });

  it("plans a built-in style with its document type, title, finishing, and cover date", () => {
    const plugin = host();
    setActiveGongmunTemplateInMemory(plugin, "builtin:hallym-aicr");
    const app = { metadataCache: { getFileCache: () => ({ frontmatter: { title: "중간 보고" } }) } } as unknown as App;
    const file = { basename: "노트", path: "노트.md" } as TFile;
    const plan = planGongmunExport(app, file, plugin);
    assert.equal(plan.preset, "report");
    assert.equal(plan.title, "중간 보고");
    assert.equal(plan.outline?.nestChapterLists, true);
    assert.ok(plan.finish?.cover?.removeInfoBox);
    const cover = plan.options.cover;
    assert.ok(typeof cover === "object" && /^\d{4}\. \d{1,2}\. \d{1,2}\.$/u.test(cover.date ?? ""));
    const options = gongmunGenerateOptions(plan);
    assert.equal(options.gongmunTitle, "중간 보고");
    assert.equal(options.gongmunOutline, plan.outline);

    // A built-in style always makes its own type; the requested one is reported (R-025).
    const asked = planGongmunExport(app, file, plugin, "official");
    assert.equal(asked.preset, "report");
    assert.ok(asked.warnings.some((warning) => warning.code === "gongmun-property"));
    assert.equal(noteDocumentTitle(undefined, { basename: "무제 1" }), "무제 1");
  });

  it("builds the Ilsong College minutes look deterministically", async () => {
    const note = "## 회의 개요\n\n- 일시: 2026. 9. 17.\n\t- 장소: 회의실\n\n## 결정사항\n\n| 번호 | 내용 |\n|---|---|\n| 1 | 추진함 |\n";
    const first = await generateValidatedHwpx(note, styleOptions("builtin:hallym-ilsong"));
    const second = await generateValidatedHwpx(note, styleOptions("builtin:hallym-ilsong"));
    assert.equal(first.validation.ok, true);
    assert.deepEqual(new Uint8Array(first.data), new Uint8Array(second.data));
    assert.equal((await validateHwpx(first.data)).ok, true);
    const { section, header } = await sectionAndHeader(first.data);
    assert.deepEqual(markers(section), ["1.", "•", "-", "2."]);
    assert.match(header, /faceColor="#203864"/u);
    assert.match(header, /한림고딕체 Regular/u);
    // One blank text line (11 pt × 160 %) before every section after the first.
    const gaps = [...section.matchAll(/<hp:p [^>]*paraPrIDRef="(\d+)"[^>]*styleIDRef="2"/gu)].map((match) => {
      const element = new RegExp(`<hh:paraPr id="${match[1]}"[\\s\\S]*?</hh:paraPr>`).exec(header)?.[0] ?? "";
      return Number(/<hc:prev value="(-?\d+)"/.exec(element)?.[1]);
    });
    assert.deepEqual(gaps, [0, 1760]);
    const title = /<hp:p [^>]*styleIDRef="1"[^>]*><hp:run charPrIDRef="(\d+)">/u.exec(section)?.[1];
    assert.match(new RegExp(`<hh:charPr id="${title}"[^>]*>`).exec(header)?.[0] ?? "", /height="1500"[^>]*bold="1"|bold="1"[^>]*height="1500"/u);
  });

  it("builds the AI Convergence Research Institute report with its cover", async () => {
    const note = "## 주요 추진 내용\n\n### 연구 진행 내용\n\n- 적용함\n\t- 진행함\n\n## 개선 사항\n\n- 연수 시간이 부족함\n";
    const generated = await generateValidatedHwpx(note, styleOptions("builtin:hallym-aicr"));
    assert.equal(generated.validation.ok, true);
    assert.ok(!generated.warnings.some((warning) => warning.code === "engine-note" && /요약박스/u.test(warning.message)));
    const { section, header } = await sectionAndHeader(generated.data);
    assert.ok(!section.includes("<hp:t>문서번호</hp:t>"));
    assert.ok(!section.includes('name="__kordoc_h1"'));
    assert.match(section, /2026\. 9\. 29\./u);
    for (const color of ["#0066B3", "#00B6AD"]) {
      const id = new RegExp(`<hh:borderFill id="(\\d+)"(?:(?!</hh:borderFill>)[\\s\\S])*faceColor="${color}"`, "u").exec(header)?.[1];
      assert.ok(id && section.includes(`borderFillIDRef="${id}"`), color);
    }
    // 1. chapter → 1) sub-heading → ○ body → - ; a list right under a chapter is body text (○).
    assert.deepEqual(markers(section), ["1)", "○", "-", "○"]);
    assert.match(section, /<hp:t>1\. 주요 추진 내용<\/hp:t>|>1\.<[\s\S]*?주요 추진 내용/u);
  });

  it("puts the Hallym University emblem at the bottom of the AICR cover, centred on the paper", async () => {
    for (const title of ["AI 미디어 교육 연구 중간 보고서", "생성형 AI를 활용한 미디어 리터러시 교육 과정 개발과 현장 적용 효과에 관한 연구 중간 보고서"]) {
      const note = `# ${title}\n\n## 주요 추진 내용\n\n- 적용함\n\n## 개선 사항\n\n- 연수 시간이 부족함\n`;
      const generated = await generateValidatedHwpx(note, styleOptions("builtin:hallym-aicr"));
      assert.equal(generated.validation.ok, true);
      const zip = await JSZip.loadAsync(generated.data);
      const manifest = await zip.file("Contents/content.hpf")!.async("string");
      assert.match(manifest, /<opf:item id="hanmark_logo_hallym_emblem" href="BinData\/hanmark_logo_hallym_emblem\.png" media-type="image\/png" isEmbeded="1"\/>/u);
      const png = await zip.file("BinData/hanmark_logo_hallym_emblem.png")!.async("uint8array");
      assert.deepEqual([...png.slice(1, 4)], [0x50, 0x4e, 0x47]);
      const { section } = await sectionAndHeader(generated.data);
      const cover = section.slice(0, section.search(/<hp:p\b[^>]*\bpageBreak="1"/u));
      const pic = /<hp:pic\b[\s\S]*?<\/hp:pic>/u.exec(cover)?.[0] ?? "";
      assert.match(pic, /binaryItemIDRef="hanmark_logo_hallym_emblem"/u, "the logo is on the cover");
      assert.match(pic, /vertRelTo="PAPER" horzRelTo="PAPER" vertAlign="BOTTOM" horzAlign="CENTER"/u);
      assert.match(pic, /<hp:sz width="8334"/u, "29.4 mm wide");
      assert.equal(section.split("hanmark_logo_hallym_emblem").length, 2, "one logo, on the cover only");
      // Drawn on page 1 below the date, and the cover stays one page.
      const rendered = await renderHwpxToSvg(generated.data, { reflow: true });
      assert.equal(rendered.pageCount, 2);
      assert.equal(rendered.stats.images, 1);
      const image = rendered.regions.find((region) => region.type === "image");
      assert.equal(image?.page, 1, title);
      const box = image!.regions[0];
      assert.ok(Math.abs(box.x + box.width / 2 - rendered.width / 2) < 1, "centred on the paper");
      assert.ok(box.y > 841.89 * 0.6 && box.y + box.height < 841.89 - 80, `bottom third: ${box.y}`);
    }
  });

  it("leaves other covers without a logo", async () => {
    const generated = await generateValidatedHwpx("# 보고\n\n## 배경\n\n- 내용\n", {
      gongmun: resolveGongmunOptions({ preset: "gaejosik" }),
      gongmunTitle: "보고"
    });
    const zip = await JSZip.loadAsync(generated.data);
    assert.ok(!Object.keys(zip.files).some((name) => name.startsWith("BinData/")));
  });
});
