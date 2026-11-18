import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { parse, renderHwpxToSvg } from "kordoc";
import { generateValidatedHwpx } from "../src/io/kordocEngine";
import { writeDocx } from "../src/io/docxWriter";
import { createDefaultWordTemplate } from "../src/legacy-port/defaultWordTemplate";
import { renderStandaloneHtml } from "../src/legacy-port/htmlExport";

// Node half of scripts/test-diagram-exports.mjs (R-033): the real HWPX, DOCX and HTML
// writers run on the Markdown the diagram stage produced in Chromium.
interface Staged {
  note: Record<string, { targets: Record<"hwpx" | "docx" | "markup", { markdown: string }> }>;
}

const [stagedPath, out] = process.argv.slice(2);
const staged = JSON.parse(readFileSync(stagedPath, "utf8")) as Staged;

const loader = (source: string): Promise<{ data: Uint8Array; contentType: string }> => {
  const match = /^data:([^;,]+);base64,(.*)$/su.exec(source);
  if (!match) return Promise.reject(new Error("The fixture loader reads data URLs only."));
  return Promise.resolve({ data: Uint8Array.from(Buffer.from(match[2], "base64")), contentType: match[1] });
};
const same = (a: ArrayBuffer | Uint8Array, b: ArrayBuffer | Uint8Array): boolean =>
  Buffer.compare(Buffer.from(a as ArrayBuffer), Buffer.from(b as ArrayBuffer)) === 0;

void (async () => {
  const report: Record<string, unknown> = { hwpxPages: [] };
  for (const [name, entry] of Object.entries(staged.note)) {
    const title = name === "private" ? "Diagram note" : "도식 내보내기 시험";
    const hwpx = await generateValidatedHwpx(entry.targets.hwpx.markdown, { images: { loader } });
    const again = await generateValidatedHwpx(entry.targets.hwpx.markdown, { images: { loader } });
    writeFileSync(join(out, `${name}.hwpx`), Buffer.from(hwpx.data));
    const zip = await JSZip.loadAsync(hwpx.data);
    const section = await zip.file("Contents/section0.xml")!.async("string");
    const header = await zip.file("Contents/header.xml")!.async("string");
    const centred = new Set(
      Array.from(header.matchAll(/<hh:paraPr\b[^>]*\bid="(\d+)"[\s\S]*?<\/hh:paraPr>/gu))
        .filter((match) => /<hh:align\b[^>]*\bhorizontal="CENTER"/u.test(match[0]))
        .map((match) => match[1])
    );
    const pictureParagraphs = Array.from(section.matchAll(/<hp:p\b[^>]*\bparaPrIDRef="(\d+)"[^>]*>(?:(?!<\/hp:p>)[\s\S])*?<hp:pic\b/gu));
    const reparsed = await parse(hwpx.data.slice(0));
    const reparsedMarkdown = reparsed.success ? reparsed.markdown : "";
    const render = await renderHwpxToSvg(hwpx.data.slice(0), { reflow: true });
    const svgPath = join(out, `${name}.hwpx.svg`);
    writeFileSync(svgPath, render.svg);
    (report.hwpxPages as unknown[]).push({ name, svg: svgPath });

    const template = createDefaultWordTemplate();
    const docx = await writeDocx(entry.targets.docx.markdown, { template, title, language: "ko" });
    const docxAgain = await writeDocx(entry.targets.docx.markdown, { template, title, language: "ko" });
    writeFileSync(join(out, `${name}.docx`), docx.bytes);
    const docxZip = await JSZip.loadAsync(docx.bytes);
    const documentXml = await docxZip.file("word/document.xml")!.async("string");

    const html = renderStandaloneHtml(entry.targets.markup.markdown, { title, theme: "achmage-editorial", language: "ko" });
    writeFileSync(join(out, `${name}.html`), html);

    report[name] = {
      hwpxValid: true,
      hwpxRepeatable: same(hwpx.data, again.data),
      hwpxImages: Object.keys(zip.files).filter((file) => /^BinData\/.+\.png$/u.test(file)).length,
      hwpxPictureParagraphs: pictureParagraphs.length,
      hwpxPicturesCentred: pictureParagraphs.filter((match) => centred.has(match[1])).length,
      hwpxSourceLinesLeft: /<hp:t>[^<]*(?:%%\s*@caption|section 소개|flowchart LR)/u.test(section),
      hwpxWarnings: hwpx.warnings.map((warning) => warning.code),
      reparsedImages: (reparsedMarkdown.match(/!\[[^\]]*\]\(/gu) ?? []).length,
      reparsedHasCaption: name === "fixtures" ? reparsedMarkdown.includes("행사 진행 순서") : undefined,
      hwpxRenderPages: render.pageCount,
      hwpxRenderImages: (render.svg.match(/<image\b/gu) ?? []).length,
      docxRepeatable: same(docx.bytes, docxAgain.bytes),
      docxPictures: (documentXml.match(/<pic:pic>/gu) ?? []).length,
      docxCaptions: (documentXml.match(/<w:pStyle w:val="ImageCaption"\/>/gu) ?? []).length,
      docxMedia: Object.keys(docxZip.files).filter((file) => /^word\/media\/.+\.png$/u.test(file)).length,
      docxNotices: docx.notices,
      htmlFigures: (html.match(/<figure class="hanmark-diagram">/gu) ?? []).length,
      htmlCaptions: (html.match(/<figcaption>/gu) ?? []).length,
      htmlLeftovers: html.includes("HMDIAGRAM(") || /<svg[\s\S]*?var\(/u.test(html)
    };
  }
  console.log(JSON.stringify(report));
})();
