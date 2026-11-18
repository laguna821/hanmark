// Evidence for "learn a look from a report PDF" (R-036): makes report-like PDFs with
// item lines (Kordoc official documents drawn to SVG and printed by Chromium), then
// measures them through HanMark's production-hardened Kordoc bundle. Extra PDFs given
// on the command line (for example a public agency report) are measured as well.
//   node --import tsx scripts/test-pdf-look.ts <output dir> [more.pdf ...]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { markdownToHwpx, renderHwpxToSvg } from "kordoc";
import { loadHardenedKordocBundle } from "../tests/helpers/hardenedKordocBundle";
import { believablePdfMargins } from "../src/io/sampleLook";

const NOTE = [
  "# 2027학년도 교육과정 개편 계획", "",
  "> 공통과목 다섯 개를 융합 과목으로 재편한다.", "",
  "## 추진 배경", "",
  ...Array.from({ length: 4 }, (_, index) => [
    `- 평가 기준을 다시 설계할 필요가 있음 (${index + 1})`,
    "  - 실습과목 열두 개 가운데 아홉 개가 해당함",
    "  - 학생 설문 응답자 가운데 71%가 기준이 불명확하다고 답함",
    "    - 설문 기간은 10월 5일부터 16일까지임",
    "    - 응답률은 62%임"
  ]).flat(),
  "", "※ 세부 일정은 붙임 참조", "",
  "## 추진 내용", "",
  ...Array.from({ length: 4 }, (_, index) => [`- 공통과목을 네 영역으로 재구성함 (${index + 1})`, "  - 융합 과목 다섯 개를 운영함", "    - 과목당 지원 한도를 둠"]).flat(),
  ""
].join("\n");

const ENTRY =
  'import { measurePdfLayout, applyMeasuredLayout } from "kordoc";\n' +
  "export async function measure(bytes, preset) {\n" +
  "  const spec = await measurePdfLayout(new Uint8Array(bytes));\n" +
  "  const applied = applyMeasuredLayout({ preset }, spec);\n" +
  "  return { spec, applied: applied.applied, warnings: applied.warnings, gongmun: applied.gongmun };\n" +
  "}\n";

interface Measured {
  spec: { pageCount: number; edges: { top: number; bottom: number; left: number; right: number } | null; lineSpacing: number | null; levels: Array<{ depth: number; marker: string; font: string | null; pdfFont: string; pt: number }>; chapterFill: string | null; warnings: string[] };
  applied: string[];
  warnings: string[];
  gongmun: Record<string, unknown>;
}

async function main(): Promise<void> {
  const [out, ...extra] = process.argv.slice(2);
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.HANMARK_BROWSER_EXECUTABLE || undefined, headless: true });
  const made: Array<{ name: string; file: string; expected?: Record<string, unknown> }> = [];
  try {
    const page = await browser.newPage();
    for (const [preset, options] of [
      ["gaejosik", { margins: { top: 20, bottom: 15, left: 22, right: 22 }, lineSpacing: 165 }],
      ["report", { margins: { top: 25, bottom: 20, left: 25, right: 25 }, lineSpacing: 150, bodyPt: 13 }],
      ["ministry", { margins: { top: 15, bottom: 15, left: 20, right: 20 } }]
    ] as const) {
      const hwpx = await markdownToHwpx(NOTE, { gongmun: { preset, ...options } });
      const render = await renderHwpxToSvg(hwpx, { reflow: true });
      const pageHeight = 841.88;
      const gap = render.pageCount > 1 ? (render.height - render.pageCount * pageHeight) / (render.pageCount - 1) : 0;
      const pages = Array.from({ length: render.pageCount }, (_, index) =>
        render.svg.replace(/^<svg\b[^>]*>/u, (open) =>
          open.replace(/viewBox="[^"]*"/u, `viewBox="0 ${index * (pageHeight + gap)} 595.28 ${pageHeight}"`).replace(/\swidth="[^"]*"/u, ' width="210mm"').replace(/\sheight="[^"]*"/u, ' height="297mm"')
        )
      );
      await page.setContent(`<!doctype html><style>@page{size:210mm 297mm;margin:0}html,body{margin:0}svg{display:block;page-break-after:always;break-after:page}</style>${pages.join("")}`);
      const file = path.join(out, `made-${preset}.pdf`);
      await writeFile(file, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
      made.push({ name: `Kordoc ${preset} (Chromium PDF)`, file, expected: options });
    }
  } finally {
    await browser.close();
  }
  for (const file of extra) made.push({ name: path.basename(file), file });

  const bundle = await loadHardenedKordocBundle<{ measure(bytes: Uint8Array, preset: string): Promise<Measured> }>(ENTRY);
  const rows = ["| PDF | 쪽 | 글이 놓인 범위(mm, 위/아래/왼쪽/오른쪽) | HanMark가 쓰는 여백 | 줄간격 | 단계(부호·글꼴·크기) | 장 번호칸 색 | 경고 |", "|---|---|---|---|---|---|---|---|"];
  const frame = { top: 0, bottom: 0, left: 0, right: 0 };
  try {
    for (const item of made) {
      const bytes = new Uint8Array(await readFile(item.file));
      try {
        const result = await bundle.runtime.measure(bytes, "report");
        const edges = result.spec.edges ? `${result.spec.edges.top}/${result.spec.edges.bottom}/${result.spec.edges.left}/${result.spec.edges.right}` : "못 잼";
        const levels = result.spec.levels.map((level) => `${level.marker} ${level.font ?? `(${level.pdfFont})`} ${level.pt}`).join(", ") || "못 잼";
        const sides = result.spec.edges ? believablePdfMargins((result.gongmun as { margins?: typeof frame }).margins, frame)?.taken : undefined;
        const used = sides ? `왼쪽 ${sides.left}${sides.right !== undefined ? ` · 오른쪽 ${sides.right}` : " (오른쪽은 틀의 값)"}` : "없음";
        const expected = (item.expected as { margins?: typeof frame } | undefined)?.margins;
        rows.push(`| ${item.name} | ${result.spec.pageCount} | ${edges}${expected ? ` (만든 값 ${expected.top}/${expected.bottom}/${expected.left}/${expected.right})` : ""} | ${used} | ${result.spec.lineSpacing ?? "못 잼"} | ${levels} | ${result.spec.chapterFill ?? ""} | ${[...new Set([...result.spec.warnings, ...result.warnings])].join(" / ").slice(0, 120)} |`);
        console.log(JSON.stringify({ name: item.name, applied: result.applied, gongmun: result.gongmun }).slice(0, 900));
      } catch (error: unknown) {
        rows.push(`| ${item.name} | 실패: ${String(error instanceof Error ? error.message : error).slice(0, 120)} | | | | | | |`);
      }
    }
  } finally {
    await bundle.dispose?.();
  }
  await writeFile(path.join(out, "pdf-look.md"), rows.join("\n") + "\n");
  console.log(rows.join("\n"));
}
void main();
