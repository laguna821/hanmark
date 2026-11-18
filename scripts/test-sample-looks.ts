// Real-sample check for looks learned from samples (R-036). Samples are read at run
// time and never committed:
//   node --import tsx scripts/test-sample-looks.ts <output dir> <sample.hwpx>...
// For every sample the same note is made twice: with the engine's template path alone
// ("견본 그대로"), and the way HanMark chooses (template when the sample has shapes for
// running content, else the frame with the values measured from the sample).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderHwpxToSvg } from "kordoc";
import { generateValidatedHwpx } from "../src/io/kordocEngine";
import type { App, TFile } from "obsidian";
import { gongmunGenerateOptions, planGongmunExport } from "../src/io/gongmunExport";
import { newGongmunTemplateRecord, putGongmunTemplateInMemory, type TemplateLibraryHost } from "../src/io/templateLibrary";
import { learnLook } from "../src/io/sampleLook";
import { measureSample, trustedBody, type SampleMeasure } from "../src/io/sampleMeasure";

const NOTE = [
  "# 2027학년도 AI 미디어 교육과정 개편 계획", "",
  "## 추진 배경", "",
  "- 생성형 AI 확산으로 제작 실습 교과의 평가 기준을 다시 설계할 필요가 있음",
  "  - 2026학년도 2학기 실습과목 12개 가운데 9개가 AI 도구를 사용함",
  "  - 학생 설문 응답자 184명 가운데 71%가 평가 기준이 불명확하다고 답함",
  "    - 설문 기간은 2026. 10. 5.부터 10. 16.까지임",
  "    - 응답률은 62%임",
  "- 앵커 사업 성과지표와 교과과정을 연계해 달라는 요구가 있음", "",
  "공통과목 다섯 개를 AX 융합브릿지 과목으로 재편하고 실습과목의 운영 기준을 마련한다.", "",
  "이 계획은 교과과정위원회 심의를 거쳐 2027학년도 1학기부터 시행한다.", "",
  "※ 세부 일정은 붙임 참조", "",
  "## 추진 내용", "",
  "| 구분 | 2026학년도 | 2027학년도 |", "|---|---|---|", "| 공통과목 | 7개 | 5개 |", "| 실습과목 | 12개 | 14개 |", ""
].join("\n");

const FILE = { basename: "노트", path: "노트.md" } as TFile;
const APP = { metadataCache: { getFileCache: () => ({ frontmatter: {} }) } } as unknown as App;

type Check = "일치" | "불일치" | "견본에 없음";
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Every text shape a generated document uses for the note's running content. */
function contentShapes(measure: SampleMeasure): Array<{ font: string; pt: number; lineSpacing?: number }> {
  return [measure.body, ...Object.values(measure.levels)].filter((shape): shape is NonNullable<typeof shape> => !!shape);
}

function compare(sample: SampleMeasure, made: SampleMeasure): Record<"margins" | "body" | "lineSpacing" | "tableFill", Check> {
  const shapes = contentShapes(made);
  const body = trustedBody(sample);
  return {
    margins: same(sample.marginsMm, made.marginsMm) ? "일치" : "불일치",
    // The note's content must use the sample's body shape wherever the sample has no level of its own.
    body: !body ? "견본에 없음" : shapes.length && shapes.every((shape) => shape.font === body.font && shape.pt === body.pt) ? "일치" : made.body?.font === body.font && made.body.pt === body.pt ? "일치" : "불일치",
    lineSpacing: !body?.lineSpacing ? "견본에 없음" : made.body?.lineSpacing === body.lineSpacing ? "일치" : "불일치",
    tableFill: !sample.table?.headerFill ? "견본에 없음" : sample.table.headerFill === made.table?.headerFill ? "일치" : "불일치"
  };
}

async function main(): Promise<void> {
  const [out, ...files] = process.argv.slice(2);
  await mkdir(out, { recursive: true });
  const rows = [
    "| 견본 | 고른 방식 | 여백 | 본문 글꼴·크기 (견본 그대로 → 고른 방식) | 줄간격 (견본 그대로 → 고른 방식) | 표 머리 음영 | 견본에서 잰 단계 | 남은 글 |",
    "|---|---|---|---|---|---|---|---|"
  ];
  const totals = { before: { body: 0, lineSpacing: 0 }, after: { body: 0, lineSpacing: 0, margins: 0, tableFill: 0 }, measurable: { body: 0, lineSpacing: 0, tableFill: 0 }, samples: 0 };
  for (const file of files) {
    const name = path.basename(file);
    const bytes = new Uint8Array(await readFile(file));
    const safe = name.replace(/[^\w가-힣-]+/gu, "_").slice(0, 40);
    try {
      const learned = await learnLook(bytes, name);
      const sample = learned.measure;
      // The way the product makes it: the look saved as one of the user's forms, then the export plan.
      const host: TemplateLibraryHost = { settings: {}, saveSettings: async () => {} };
      const record = putGongmunTemplateInMemory(host, {
        ...newGongmunTemplateRecord(host, name, learned.options, "report"),
        sample: learned.sample
      });
      const viaFrame = (): ReturnType<typeof generateValidatedHwpx> =>
        generateValidatedHwpx(NOTE, gongmunGenerateOptions(planGongmunExport(APP, FILE, host, undefined, record.id)));
      const template = await generateValidatedHwpx(NOTE, { sampleLook: { ...learned.sample, use: "template" } });
      const before = compare(sample, await measureSample(new Uint8Array(template.data)));
      const chosen = await viaFrame();
      const again = await viaFrame();
      const repeatable = Buffer.compare(Buffer.from(chosen.data), Buffer.from(again.data)) === 0;
      const madeMeasure = await measureSample(new Uint8Array(chosen.data));
      const after = compare(sample, madeMeasure);
      totals.samples += 1;
      for (const key of ["body", "lineSpacing"] as const) {
        if (before[key] !== "견본에 없음") totals.measurable[key] += 1;
        if (before[key] === "일치") totals.before[key] += 1;
        if (after[key] === "일치") totals.after[key] += 1;
      }
      if (after.tableFill !== "견본에 없음") totals.measurable.tableFill += 1;
      if (after.tableFill === "일치") totals.after.tableFill += 1;
      if (after.margins === "일치") totals.after.margins += 1;
      const render = await renderHwpxToSvg(chosen.data, { reflow: true });
      await writeFile(`${out}/${safe}.note-in-this-look.svg`, render.svg);
      await writeFile(`${out}/${safe}.note-in-this-look.hwpx`, Buffer.from(chosen.data));
      const levels = (["0", "1", "2", "3"] as const).filter((key) => sample.levels[key]).map((key) => sample.levels[key]!.marker).join(" ") || "없음";
      const believed = trustedBody(sample);
    const bodyText = believed ? `${believed.font} ${believed.pt}pt` : sample.body ? `(제목 한 줄뿐: ${sample.body.font} ${sample.body.pt}pt)` : "";
      rows.push(
        `| ${name} | ${learned.sample.use === "template" ? "견본 그대로" : "잰 값으로"} | ${after.margins} | ${bodyText}: ${before.body} → ${after.body} | ${believed?.lineSpacing ?? ""}%: ${before.lineSpacing} → ${after.lineSpacing} | ${sample.table?.headerFill ?? ""} ${after.tableFill} | ${levels} | ${learned.sample.leftover.length} |`
      );
      console.log(JSON.stringify({ name, use: learned.sample.use, templateFits: learned.templateFits, repeatable, pages: render.pageCount, sampleBody: sample.body, madeBody: madeMeasure.body, madeLevels: Object.fromEntries(Object.entries(madeMeasure.levels).map(([key, shape]) => [key, `${shape.font} ${shape.pt}`])), items: learned.items.map((item) => `${item.part}:${item.source}`).join(" ") }));
    } catch (error: unknown) {
      rows.push(`| ${name} | 실패: ${String(error instanceof Error ? error.message : error).slice(0, 90)} | | | | | | |`);
    }
  }
  rows.push("", `본문 글꼴·크기 일치: 견본 그대로 ${totals.before.body}/${totals.measurable.body} → 고른 방식 ${totals.after.body}/${totals.measurable.body}`, `줄간격 일치: 견본 그대로 ${totals.before.lineSpacing}/${totals.measurable.lineSpacing} → 고른 방식 ${totals.after.lineSpacing}/${totals.measurable.lineSpacing}`, `여백 일치(고른 방식): ${totals.after.margins}/${totals.samples}`, `표 머리 음영 일치(고른 방식): ${totals.after.tableFill}/${totals.measurable.tableFill}`);
  await writeFile(`${out}/fidelity.md`, rows.join("\n") + "\n");
  console.log(rows.join("\n"));
}
void main();
