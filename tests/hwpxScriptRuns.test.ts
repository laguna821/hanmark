import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { parse, validateHwpx } from "kordoc";
import {
  SCRIPT_SUB_CLOSE,
  SCRIPT_SUB_OPEN,
  SCRIPT_SUP_CLOSE,
  SCRIPT_SUP_OPEN,
  applyScriptRunsToXml,
  markScriptTags
} from "../src/io/hwpxScriptRuns";
import { generateValidatedHwpx } from "../src/io/kordocEngine";
import { writeDocx } from "../src/io/docxWriter";
import { createDefaultWordTemplate } from "../src/legacy-port/defaultWordTemplate";
import { renderStandaloneHtml } from "../src/legacy-port/htmlExport";
import { parseEditorialDocument } from "../src/io/editorialDocument";

const NOTE = [
  "# 제목",
  "",
  "면적은 25m<sup>2</sup>이고 H<sub>2</sub>O와 증가<sup>\\*</sup>하는 등 **굵게**<sup>1</sup>.",
  "",
  "| 구분 | 값 |",
  "|---|---|",
  "| 면적 | 30m<sup>2</sup> |",
  "",
  "- 항목 CO<sub>2</sub> 배출",
  "",
  "코드 `x<sup>2</sup>`는 그대로이고 \\<sup>글자\\</sup>도 그대로다.",
  "",
  "```html",
  "<sup>fence</sup>",
  "```"
].join("\n");

const HEADER = [
  '<hh:head><hh:refList><hh:charProperties itemCnt="2">',
  '<hh:charPr id="0" height="1000" textColor="#000000"><hh:fontRef hangul="0"/><hh:underline type="NONE"/></hh:charPr>',
  '<hh:charPr id="1" height="1000" textColor="#FF0000" bold="1"><hh:fontRef hangul="0"/><hh:bold/></hh:charPr>',
  "</hh:charProperties></hh:refList></hh:head>"
].join("");

async function entries(data: ArrayBuffer): Promise<{ section: string; header: string }> {
  const zip = await JSZip.loadAsync(data);
  return {
    section: await zip.file("Contents/section0.xml")!.async("string"),
    header: await zip.file("Contents/header.xml")!.async("string")
  };
}

async function spans(data: ArrayBuffer): Promise<string[]> {
  const result = await parse(data, { hancomFallback: false, ocr: false, scriptTags: true } as never);
  assert.equal(result.success, true);
  return ((result as { markdown: string }).markdown.match(/<su[pb]>[^<]*<\/su[pb]>/g) ?? []).map((span) => span.replace(/\\/g, ""));
}

describe("superscripts and subscripts in generated HWPX", () => {
  it("marks tags outside code and leaves code, fences and escaped tags alone", () => {
    const marked = markScriptTags(NOTE);
    assert.equal(marked.marked, 6);
    assert.ok(marked.markdown.includes(`25m${SCRIPT_SUP_OPEN}2${SCRIPT_SUP_CLOSE}이고 H${SCRIPT_SUB_OPEN}2${SCRIPT_SUB_CLOSE}O`));
    assert.ok(marked.markdown.includes("`x<sup>2</sup>`"));
    assert.ok(marked.markdown.includes("\\<sup>글자\\</sup>"));
    assert.ok(marked.markdown.includes("<sup>fence</sup>"));
    assert.deepEqual(markScriptTags("첨자 없는 글"), { markdown: "첨자 없는 글", marked: 0 });
    // A note that already uses a marker character is not touched.
    assert.equal(markScriptTags(`x<sup>2</sup>${SCRIPT_SUP_OPEN}`).marked, 0);
  });

  it("splits a marked stretch into a run with a raised or lowered copy of the shape", () => {
    const section =
      `<hs:sec><hp:p id="1"><hp:run charPrIDRef="1"><hp:t>25m${SCRIPT_SUP_OPEN}2${SCRIPT_SUP_CLOSE}이고 H${SCRIPT_SUB_OPEN}2${SCRIPT_SUB_CLOSE}O</hp:t></hp:run></hp:p>` +
      `<hp:p id="2"><hp:run charPrIDRef="0"><hp:t>${SCRIPT_SUP_OPEN}처음${SCRIPT_SUP_CLOSE}</hp:t></hp:run></hp:p>` +
      `<hp:p id="3"><hp:run charPrIDRef="0"><hp:t>앞${SCRIPT_SUP_OPEN}가</hp:t></hp:run><hp:run charPrIDRef="1"><hp:t>나${SCRIPT_SUP_CLOSE}뒤</hp:t></hp:run></hp:p>` +
      `<hp:p id="4"><hp:run charPrIDRef="0"><hp:t>열림만${SCRIPT_SUP_OPEN}끝</hp:t></hp:run></hp:p>` +
      `<hp:p id="5"><hp:run charPrIDRef="0"><hp:t>보통 글</hp:t></hp:run></hp:p></hs:sec>`;
    const result = applyScriptRunsToXml(section, HEADER);
    assert.equal(result.applied, 6);
    assert.doesNotMatch(result.section, /[\uE010-\uE013]/u);
    // Paragraph 1: plain, raised, plain, lowered, plain; all copies of shape 1.
    assert.ok(
      result.section.includes(
        '<hp:p id="1"><hp:run charPrIDRef="1"><hp:t>25m</hp:t></hp:run><hp:run charPrIDRef="2"><hp:t>2</hp:t></hp:run>' +
          '<hp:run charPrIDRef="1"><hp:t>이고 H</hp:t></hp:run><hp:run charPrIDRef="3"><hp:t>2</hp:t></hp:run>' +
          '<hp:run charPrIDRef="1"><hp:t>O</hp:t></hp:run></hp:p>'
      ),
      result.section
    );
    // Paragraph 2: the whole text is raised; no empty run is left behind.
    assert.ok(result.section.includes('<hp:p id="2"><hp:run charPrIDRef="4"><hp:t>처음</hp:t></hp:run></hp:p>'), result.section);
    // Paragraph 3: a span across two runs keeps each run's own shape.
    assert.ok(
      result.section.includes(
        '<hp:p id="3"><hp:run charPrIDRef="0"><hp:t>앞</hp:t></hp:run><hp:run charPrIDRef="4"><hp:t>가</hp:t></hp:run>' +
          '<hp:run charPrIDRef="2"><hp:t>나</hp:t></hp:run><hp:run charPrIDRef="1"><hp:t>뒤</hp:t></hp:run></hp:p>'
      ),
      result.section
    );
    // Paragraph 5 starts plain even though paragraph 4 never closed its span.
    assert.ok(result.section.includes('<hp:p id="5"><hp:run charPrIDRef="0"><hp:t>보통 글</hp:t></hp:run></hp:p>'));
    assert.match(result.header, /itemCnt="5"/u);
    assert.match(result.header, /<hh:charPr id="2" height="1000" textColor="#FF0000" bold="1"><hh:fontRef hangul="0"\/><hh:bold\/><hh:supscript\/><\/hh:charPr>/u);
    assert.match(result.header, /<hh:charPr id="3"[^>]*>.*?<hh:subscript\/><\/hh:charPr>/u);
    // Text without markers is returned as it came.
    assert.equal(applyScriptRunsToXml("<hp:p><hp:run charPrIDRef=\"0\"><hp:t>글</hp:t></hp:run></hp:p>", HEADER).applied, 0);
  });

  it("keeps runs nested in a run (a table in a paragraph) on their own shapes", () => {
    const section =
      `<hp:p><hp:run charPrIDRef="1"><hp:tbl><hp:tc><hp:p><hp:run charPrIDRef="0"><hp:t>30m${SCRIPT_SUP_OPEN}2${SCRIPT_SUP_CLOSE}</hp:t></hp:run></hp:p></hp:tc></hp:tbl>` +
      `<hp:t>밖${SCRIPT_SUB_OPEN}x${SCRIPT_SUB_CLOSE}</hp:t></hp:run></hp:p>`;
    const result = applyScriptRunsToXml(section, HEADER);
    assert.ok(result.section.includes('<hp:run charPrIDRef="0"><hp:t>30m</hp:t></hp:run><hp:run charPrIDRef="2"><hp:t>2</hp:t></hp:run></hp:p>'), result.section);
    assert.ok(result.section.endsWith('<hp:t>밖</hp:t></hp:run><hp:run charPrIDRef="3"><hp:t>x</hp:t></hp:run></hp:p>'), result.section);
    assert.match(result.header, /<hh:charPr id="2" height="1000" textColor="#000000">.*?<hh:supscript\/>/u);
    assert.match(result.header, /<hh:charPr id="3" height="1000" textColor="#FF0000" bold="1">.*?<hh:subscript\/>/u);
  });

  for (const [name, options] of [
    ["quick HWPX", {}],
    ["official-document HWPX (보고서)", { gongmun: { preset: "report" } }],
    ["official-document HWPX (기안문)", { gongmun: { preset: "official" } }]
  ] as const) {
    it(`writes real superscripts and subscripts in ${name}`, async () => {
      const first = await generateValidatedHwpx(NOTE, options as never);
      const { section, header } = await entries(first.data);
      assert.doesNotMatch(section, /[\uE010-\uE013]/u);
      assert.match(header, /<hh:supscript\/>/u);
      assert.match(header, /<hh:subscript\/>/u);
      assert.equal((await validateHwpx(first.data)).ok, true);
      // Read back by Kordoc: the same spans, in order, around unchanged text.
      const read = await spans(first.data);
      assert.deepEqual(read.slice(0, 6), ["<sup>2</sup>", "<sub>2</sub>", "<sup>*</sup>", "<sup>1</sup>", "<sup>2</sup>", "<sub>2</sub>"], name);
      const back = (await parse(first.data, { hancomFallback: false, ocr: false, scriptTags: false } as never)) as { markdown: string };
      assert.ok(back.markdown.includes("25m2이고 H2O와 증가"), back.markdown);
      // The same note gives the same bytes.
      const second = await generateValidatedHwpx(NOTE, options as never);
      assert.deepEqual(new Uint8Array(second.data), new Uint8Array(first.data));
    });
  }

  it("leaves a note without the tags byte-identical to generation without this step", async () => {
    const plain = NOTE.replace(/<\/?su[pb]>/g, "");
    const a = await generateValidatedHwpx(plain, {});
    const { header } = await entries(a.data);
    assert.doesNotMatch(header, /<hh:(?:supscript|subscript)\/>/u);
  });

  it("is kept by the other exporters", async () => {
    const html = renderStandaloneHtml("면적 25m<sup>2</sup>, H<sub>2</sub>O", { title: "t" } as never);
    assert.match(html, /25m<sup>2<\/sup>, H<sub>2<\/sub>O/u);
    const model = JSON.stringify(parseEditorialDocument("면적 25m<sup>2</sup>, H<sub>2</sub>O", "t"));
    assert.match(model, /"style":"superscript"/u);
    assert.match(model, /"style":"subscript"/u);
    const docx = await writeDocx("면적 25m<sup>2</sup>, H<sub>2</sub>O", { template: createDefaultWordTemplate(), title: "t" } as never);
    const document = await (await JSZip.loadAsync(docx.bytes)).file("word/document.xml")!.async("string");
    assert.match(document, /<w:vertAlign w:val="superscript"\/>/u);
    assert.match(document, /<w:vertAlign w:val="subscript"\/>/u);
  });
});
