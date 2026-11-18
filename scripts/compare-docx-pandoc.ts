// Verification helper (not shipped): makes the same note with the built-in writer and
// with Pandoc (the arguments and reference document HanMark's Pandoc path uses), then
// prints a structural comparison. Requires Pandoc.
// Usage: node --import tsx scripts/compare-docx-pandoc.ts <outDir> [pandoc path]
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import JSZip from "jszip";
import { writeDocx } from "../src/io/docxWriter";
import { adaptMarkdownForKordoc } from "../src/io/markdownAdapter";
import { createDefaultWordTemplate } from "../src/legacy-port/defaultWordTemplate";
import { createPandocDocxArgs } from "../src/legacy-port/pandocDocx";
import { buildReferenceDocx } from "../src/legacy-port/wordReferenceDoc";
import { ENGLISH_PAPER_NOTE, KOREAN_REPORT_NOTE } from "../tests/fixtures/docxNotes";

interface Shape {
  styles: Record<string, number>;
  tables: number;
  tableRows: number;
  headerRows: number;
  footnotes: number;
  footnoteReferences: number;
  hyperlinks: number;
  images: number;
  listParagraphs: number;
  listInstances: number;
}

async function shape(bytes: Uint8Array): Promise<Shape> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.files["word/document.xml"].async("string");
  const notes = (await zip.files["word/footnotes.xml"]?.async("string")) ?? "";
  const styles: Record<string, number> = {};
  for (const paragraph of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const style = /<w:pStyle w:val="([^"]+)"/.exec(paragraph[0])?.[1] ?? "(none)";
    styles[style] = (styles[style] ?? 0) + 1;
  }
  const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;
  return {
    styles: Object.fromEntries(Object.entries(styles).sort(([left], [right]) => left.localeCompare(right))),
    tables: count(xml, /<w:tbl>/g),
    tableRows: count(xml, /<w:tr[ >]/g),
    headerRows: count(xml, /<w:tblHeader/g),
    footnotes: count(notes, /<w:footnote (?!w:type)/g),
    footnoteReferences: count(xml, /<w:footnoteReference /g),
    hyperlinks: count(xml, /<w:hyperlink /g),
    images: Object.keys(zip.files).filter((name) => name.startsWith("word/media/")).length,
    listParagraphs: count(xml, /<w:numPr>/g),
    listInstances: new Set([...xml.matchAll(/<w:numId w:val="(\d+)"/g)].map((match) => match[1])).size
  };
}

async function main(): Promise<void> {
  const outDir = resolve(process.argv[2] ?? "test-artifacts/docx-compare");
  const pandoc = process.argv[3] ?? "pandoc";
  await mkdir(outDir, { recursive: true });
  const template = createDefaultWordTemplate();
  const base = execFileSync(pandoc, ["--print-default-data-file", "reference.docx"], { maxBuffer: 32 * 1024 * 1024 });
  const referencePath = join(outDir, "reference.docx");
  await writeFile(referencePath, await buildReferenceDocx(new Uint8Array(base), template));
  console.log(execFileSync(pandoc, ["--version"]).toString().split(/\r?\n/)[0]);
  for (const [name, markdown] of [
    ["korean-report", KOREAN_REPORT_NOTE],
    ["english-paper", ENGLISH_PAPER_NOTE]
  ] as const) {
    const input = join(outDir, `${name}.pandoc-input.md`);
    const output = join(outDir, `${name}.pandoc.docx`);
    await writeFile(input, adaptMarkdownForKordoc(markdown, { outputLanguage: "auto" }).markdown);
    execFileSync(
      pandoc,
      createPandocDocxArgs({
        inputPath: input,
        outputPath: output,
        referenceDocPath: referencePath,
        luaFilterPath: resolve("word-assets/docx_style_map.lua")
      })
    );
    const builtIn = await shape((await writeDocx(markdown, { template, title: name })).bytes);
    const viaPandoc = await shape(new Uint8Array(await readFile(output)));
    console.log(`\n## ${name}`);
    console.log("built-in:", JSON.stringify(builtIn));
    console.log("pandoc:  ", JSON.stringify(viaPandoc));
  }
}

void main();
