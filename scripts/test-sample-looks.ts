// Real-sample check for looks learned from samples (R-036). Samples are read at run
// time and never committed:
//   node --import tsx scripts/test-sample-looks.ts <output dir> <sample.hwpx|sample.pdf>...
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { renderHwpxToSvg } from "kordoc";
import { generateValidatedHwpx } from "../src/io/kordocEngine";
import { learnLookFromHwpx, learnLookFromPdf, readSampleFacts } from "../src/io/sampleLook";

const NOTE = [
  "# 2027학년도 AI 미디어 교육과정 개편 계획", "",
  "> 공통과목 5개를 AX 융합브릿지 과목으로 재편한다.", "",
  "## 추진 배경", "",
  "- 생성형 AI 확산으로 평가 기준 재설계 필요",
  "  - 실습과목 12개 중 9개가 AI 도구 사용",
  "    - 학생 설문 응답자 184명",
  "- 앵커 사업 성과지표와 연계", "",
  "※ 세부 일정은 붙임 참조", "",
  "## 추진 내용", "",
  "| 구분 | 2026학년도 | 2027학년도 |", "|---|---|---|", "| 공통과목 | 7개 | 5개 |", "| 실습과목 | 12개 | 14개 |", ""
].join("\n");

interface ShapeFacts { bodyFont: string; bodyPt: number; lineSpacing: string; tableHeaderFill: string }

/** Body paragraph shape and first table header fill read from the package XML. */
async function shapeFacts(bytes: Uint8Array): Promise<ShapeFacts> {
  const zip = await JSZip.loadAsync(bytes);
  const header = (await zip.file("Contents/header.xml")?.async("string")) ?? "";
  const section = (await zip.file("Contents/section0.xml")?.async("string")) ?? "";
  const fonts = [...header.matchAll(/<hh:fontface\b[^>]*lang="HANGUL"[\s\S]*?<\/hh:fontface>/gu)][0]?.[0] ?? "";
  const faces = [...fonts.matchAll(/<hh:font\b[^>]*\bid="(\d+)"[^>]*\bface="([^"]+)"/gu)];
  const charPrs = new Map([...header.matchAll(/<hh:charPr\b[^>]*\bid="(\d+)"[^>]*\bheight="(\d+)"[\s\S]*?<\/hh:charPr>/gu)].map((m) => [m[1], m] as const));
  const paraPrs = new Map([...header.matchAll(/<hh:paraPr\b[^>]*\bid="(\d+)"[\s\S]*?<\/hh:paraPr>/gu)].map((m) => [m[1], m[0]] as const));
  // The most used (paragraph shape, character shape) pair outside tables is the body.
  const outside = section.replace(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/gu, "");
  const counts = new Map<string, number>();
  for (const p of outside.matchAll(/<hp:p\b[^>]*\bparaPrIDRef="(\d+)"[^>]*>([\s\S]*?)<\/hp:p>/gu)) {
    const run = /<hp:run\b[^>]*\bcharPrIDRef="(\d+)"[^>]*>\s*<hp:t>[^<]{4,}/u.exec(p[2]);
    if (!run) continue;
    const key = `${p[1]}/${run[1]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [para, char] = ([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "/").split("/");
  const charPr = charPrs.get(char);
  const fontRef = charPr ? /<hh:fontRef\b[^>]*\bhangul="(\d+)"/u.exec(charPr[0])?.[1] : undefined;
  const spacing = /<hh:lineSpacing\b[^>]*\btype="([^"]+)"[^>]*\bvalue="(\d+)"/u.exec(paraPrs.get(para) ?? "");
  const firstCell = /<hp:tc\b[^>]*\bborderFillIDRef="(\d+)"/u.exec(section)?.[1];
  const fill = firstCell
    ? /faceColor="([^"]+)"/u.exec(new RegExp(`<hh:borderFill\\b[^>]*\\bid="${firstCell}"[\\s\\S]*?</hh:borderFill>`, "u").exec(header)?.[0] ?? "")?.[1] ?? "none"
    : "no table";
  return {
    bodyFont: faces.find((face) => face[1] === fontRef)?.[2] ?? "?",
    bodyPt: charPr ? Number(charPr[2]) / 100 : 0,
    lineSpacing: spacing ? `${spacing[1]} ${spacing[2]}` : "?",
    tableHeaderFill: fill
  };
}

async function main(): Promise<void> {
  const [out, ...files] = process.argv.slice(2);
  await mkdir(out, { recursive: true });
  const rows: string[] = ["| 견본 | 쪽·여백 | 글꼴표 | 본문 글꼴·크기 | 줄간격 | 표 머리 음영 | 있는 역할 | 없는 역할 | 남은 글 | 팩 크기 |", "|---|---|---|---|---|---|---|---|---|---|"];
  for (const file of files) {
    const name = path.basename(file);
    const bytes = new Uint8Array(await readFile(file));
    const safe = name.replace(/[^\w가-힣-]+/gu, "_").slice(0, 40);
    try {
      if (name.toLowerCase().endsWith(".pdf")) {
        const learned = await learnLookFromPdf(bytes, { preset: "report" });
        console.log(JSON.stringify({ name, pdf: true, applied: learned.applied, warnings: learned.warnings, edges: learned.spec.edges, lineSpacing: learned.spec.lineSpacing, levels: learned.spec.levels.map((l) => `${l.depth}:${l.marker}:${l.font ?? l.pdfFont}:${l.pt}`) }));
        continue;
      }
      const sampleFacts = await readSampleFacts(bytes);
      const sampleShape = await shapeFacts(bytes);
      const look = await learnLookFromHwpx(bytes, name);
      const first = await generateValidatedHwpx(NOTE, { sampleLook: look });
      const second = await generateValidatedHwpx(NOTE, { sampleLook: look });
      const made = new Uint8Array(first.data);
      const madeFacts = await readSampleFacts(made);
      const madeShape = await shapeFacts(made);
      const same = (a: unknown, b: unknown): string => (JSON.stringify(a) === JSON.stringify(b) ? "일치" : `불일치 (${JSON.stringify(a)} → ${JSON.stringify(b)})`);
      const render = await renderHwpxToSvg(first.data, { reflow: true });
      await writeFile(`${out}/${safe}.note-in-this-look.svg`, render.svg);
      await writeFile(`${out}/${safe}.note-in-this-look.hwpx`, made);
      rows.push(`| ${name} | ${same([sampleFacts.pageMm, sampleFacts.marginsMm], [madeFacts.pageMm, madeFacts.marginsMm])} | ${same(sampleFacts.fonts, madeFacts.fonts)} | ${same([sampleShape.bodyFont, sampleShape.bodyPt], [madeShape.bodyFont, madeShape.bodyPt])} | ${same(sampleShape.lineSpacing, madeShape.lineSpacing)} | ${same(sampleShape.tableHeaderFill, madeShape.tableHeaderFill)} | ${look.roles.join(" ")} | ${look.missing.join(" ")} | ${look.leftover.length} | ${Math.round((look.pack.length * 3) / 4 / 1024)}KB |`);
      console.log(JSON.stringify({ name, repeatable: Buffer.compare(Buffer.from(first.data), Buffer.from(second.data)) === 0, pages: render.pageCount, sampleShape, madeShape, warnings: first.warnings.map((w) => w.message.slice(0, 80)) }));
    } catch (error: unknown) {
      rows.push(`| ${name} | 실패: ${String(error instanceof Error ? error.message : error).slice(0, 80)} | | | | | | | | |`);
    }
  }
  await writeFile(`${out}/fidelity.md`, rows.join("\n") + "\n");
  console.log(rows.join("\n"));
}
void main();
