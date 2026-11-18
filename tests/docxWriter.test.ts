import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import { parse } from "kordoc";
import { DOCX_EXTRA_STYLE_IDS, rasterImageSize, writeDocx, type WrittenDocx } from "../src/io/docxWriter";
import { parseEditorialBlocks, parseEditorialDocument } from "../src/io/editorialDocument";
import { createDefaultWordTemplate } from "../src/legacy-port/defaultWordTemplate";
import { WORD_STYLE_ID_MAP, buildReferenceDocx } from "../src/legacy-port/wordReferenceDoc";
import { normalizeDocxEngine, normalizeHanmarkSettings } from "../src/legacy-port/settings";
import {
  ENGLISH_PAPER_NOTE,
  KOREAN_REPORT_NOTE,
  PLAIN_MEMO_NOTE,
  makePng,
  pngDataUri
} from "./fixtures/docxNotes";

const TEMPLATE = createDefaultWordTemplate();

async function write(markdown: string, title = "note"): Promise<WrittenDocx> {
  return writeDocx(markdown, { template: TEMPLATE, title });
}

async function parts(written: WrittenDocx): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(written.bytes);
  const output = new Map<string, string>();
  for (const name of Object.keys(zip.files)) {
    if (!name.startsWith("word/media/")) output.set(name, await zip.files[name].async("string"));
  }
  return output;
}

async function documentXml(markdown: string): Promise<string> {
  const xml = (await parts(await write(markdown))).get("word/document.xml");
  assert.ok(xml);
  return xml;
}

function paragraphs(xml: string): Array<{ style: string; text: string; xml: string }> {
  return [...xml.matchAll(/<w:p>[\s\S]*?<\/w:p>/g)].map((match) => ({
    style: /<w:pStyle w:val="([^"]+)"/.exec(match[0])?.[1] ?? "",
    text: [...match[0].matchAll(/<w:t [^>]*>([^<]*)<\/w:t>/g)].map((item) => item[1]).join(""),
    xml: match[0]
  }));
}

function assertWellFormed(name: string, xml: string): void {
  const errors: string[] = [];
  new DOMParser({ onError: (level, message) => errors.push(`${level}: ${message}`) }).parseFromString(xml, "application/xml");
  assert.deepEqual(errors, [], `${name} is well-formed XML`);
}

describe("built-in DOCX writer: structures (R-031)", () => {
  it("names paragraphs the way the Pandoc style filter does", async () => {
    const items = paragraphs(await documentXml("# 제목\n\n첫 문단\n\n둘째 문단\n\n###### 여섯\n\n다음"));
    assert.deepEqual(
      items.map((item) => [item.style, item.text]),
      [
        ["Heading1", "제목"],
        ["FirstParagraph", "첫 문단"],
        ["BodyText", "둘째 문단"],
        ["Heading6", "여섯"],
        ["FirstParagraph", "다음"]
      ]
    );
  });

  it("writes character formatting as run properties in schema order", async () => {
    const xml = await documentXml(
      "**굵게** *기울임* ~~취소~~ ==형광== <u>밑줄</u> x<sup>2</sup> H<sub>2</sub>O `code` <span style=\"color:#ff0000\">빨강</span>"
    );
    assert.match(xml, /<w:rPr><w:b\/><w:bCs\/><\/w:rPr><w:t xml:space="preserve">굵게<\/w:t>/u);
    assert.match(xml, /<w:rPr><w:i\/><w:iCs\/><\/w:rPr><w:t xml:space="preserve">기울임<\/w:t>/u);
    assert.match(xml, /<w:rPr><w:strike\/><\/w:rPr><w:t xml:space="preserve">취소<\/w:t>/u);
    assert.match(xml, /<w:rPr><w:highlight w:val="yellow"\/><\/w:rPr><w:t xml:space="preserve">형광<\/w:t>/u);
    assert.match(xml, /<w:rPr><w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">밑줄<\/w:t>/u);
    assert.match(xml, /<w:rPr><w:vertAlign w:val="superscript"\/><\/w:rPr><w:t xml:space="preserve">2<\/w:t>/u);
    assert.match(xml, /<w:rPr><w:vertAlign w:val="subscript"\/><\/w:rPr><w:t xml:space="preserve">2<\/w:t>/u);
    assert.match(xml, /<w:rPr><w:rStyle w:val="VerbatimChar"\/><\/w:rPr><w:t xml:space="preserve">code<\/w:t>/u);
    assert.match(xml, /<w:rPr><w:color w:val="FF0000"\/><\/w:rPr><w:t xml:space="preserve">빨강<\/w:t>/u);
  });

  it("keeps hard breaks, escapes text, and drops characters XML cannot hold", async () => {
    const xml = await documentXml("첫 줄  \n둘째 줄 1 < 2 & \"따옴표\" \u0001끝");
    assert.match(xml, /첫 줄<\/w:t><\/w:r><w:r><w:br\/><\/w:r>/u);
    assert.match(xml, /1 &lt; 2 &amp; &quot;따옴표&quot; 끝/u);
  });

  it("writes external links as hyperlinks and other links as text with a notice", async () => {
    const written = await write("[밖](https://example.com/a?b=1&c=2) [안](#제목) [[노트|별칭]] [파일](다른%20노트.md)");
    const files = await parts(written);
    const xml = files.get("word/document.xml") ?? "";
    const rels = files.get("word/_rels/document.xml.rels") ?? "";
    const id = /<w:hyperlink r:id="(rId\d+)" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr><w:t xml:space="preserve">밖<\/w:t>/u.exec(xml)?.[1];
    assert.ok(id, "the external link is a hyperlink in the Hyperlink style");
    assert.ok(
      rels.includes(`Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/a?b=1&amp;c=2" TargetMode="External"`)
    );
    assert.equal((xml.match(/<w:hyperlink /g) ?? []).length, 1);
    assert.match(xml, /별칭/u);
    assert.deepEqual(written.notices, [{ code: "link-not-external", count: 2 }]);
  });

  it("numbers lists with their own instance, nesting level, and start", async () => {
    const files = await parts(
      await write("1. 하나\n2. 둘\n   - 속\n     - 더 속\n3. 셋\n\n문단\n\n5. 다섯\n6. 여섯\n\n- 점\n")
    );
    const xml = files.get("word/document.xml") ?? "";
    const numbering = files.get("word/numbering.xml") ?? "";
    const listed = paragraphs(xml)
      .filter((item) => item.xml.includes("<w:numPr>"))
      .map((item) => [
        item.text,
        Number(/<w:ilvl w:val="(\d)"/.exec(item.xml)?.[1]),
        Number(/<w:numId w:val="(\d+)"/.exec(item.xml)?.[1])
      ]);
    assert.deepEqual(listed, [
      ["하나", 0, 1],
      ["둘", 0, 1],
      ["속", 1, 2],
      ["더 속", 2, 3],
      ["셋", 0, 1],
      ["다섯", 0, 4],
      ["여섯", 0, 4],
      ["점", 0, 5]
    ]);
    assert.ok(paragraphs(xml).filter((item) => item.xml.includes("<w:numPr>")).every((item) => item.style === "Compact"));
    const abstractOf = (numId: number): string =>
      new RegExp(`<w:num w:numId="${numId}"><w:abstractNumId w:val="(\\d+)"/>`).exec(numbering)?.[1] ?? "";
    assert.equal(abstractOf(1), "2", "ordered list uses the decimal definition");
    assert.equal(abstractOf(2), "1", "nested bullets use the bullet definition");
    assert.equal(abstractOf(5), "1");
    // The list starting at 5 has its own definition whose first level starts at 5.
    const custom = abstractOf(4);
    assert.notEqual(custom, "2");
    const definition = new RegExp(`<w:abstractNum w:abstractNumId="${custom}">[\\s\\S]*?</w:abstractNum>`).exec(numbering)?.[0] ?? "";
    assert.match(definition, /<w:lvl w:ilvl="0"><w:start w:val="5"\/><w:numFmt w:val="decimal"\/>/);
    assert.match(numbering, /<w:num w:numId="4">[\s\S]*?<w:startOverride w:val="5"\/>/);
    assert.ok(numbering.lastIndexOf("<w:abstractNum ") < numbering.indexOf("<w:num "), "definitions come before instances");
  });

  it("writes task items with a box and keeps the item's other blocks indented", async () => {
    const items = paragraphs(await documentXml("- [ ] 할 일\n- [x] 한 일\n\n- 항목\n\n  이어지는 문단\n"));
    assert.equal(items[0].text, "\u2610할 일");
    assert.equal(items[1].text, "\u2611한 일");
    assert.match(items[0].xml, /<w:ind w:left="480" w:hanging="360"\/>/);
    const continued = items.find((item) => item.text === "이어지는 문단");
    assert.ok(continued);
    assert.equal(continued.style, "Compact");
    assert.match(continued.xml, /<w:ind w:left="480"\/>/);
  });

  it("writes quotes, callouts, code, and rules", async () => {
    const written = await write(
      "> 인용\n>\n> > 속 인용\n\n> [!WARNING]- 주의\n> 본문\n\n```js\nconst a = 1;\n  indented();\n```\n\n---\n"
    );
    const xml = (await parts(written)).get("word/document.xml") ?? "";
    const items = paragraphs(xml);
    assert.deepEqual(
      items.slice(0, 5).map((item) => [item.style, item.text]),
      [
        ["BlockText", "인용"],
        ["BlockText", "속 인용"],
        ["CalloutTitle", "WARNING"],
        ["CalloutBody", "주의 본문"],
        ["SourceCode", "const a = 1;  indented();"]
      ]
    );
    assert.match(items[1].xml, /<w:ind w:left="360"\/>/, "a nested quote is indented further");
    assert.match(items[4].xml, /const a = 1;<\/w:t><w:br\/><w:t xml:space="preserve"> {2}indented\(\);/, "code keeps lines and spaces");
    assert.match(xml, /<w:pBdr><w:bottom w:val="single"/, "a rule is a bordered empty paragraph");
    assert.deepEqual(written.notices, [{ code: "callout-fold", count: 1 }]);
  });

  it("writes tables with a repeated header row, alignment, and widths that fit the page", async () => {
    const xml = await documentXml("| 가 | 나 | 다 |\n|:--|:-:|--:|\n| **1** | 2 | 3 |\n| 4 | 5 |\n");
    const table = /<w:tbl>[\s\S]*<\/w:tbl>/.exec(xml)?.[0] ?? "";
    const rows = [...table.matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g)].map((match) => match[0]);
    assert.equal(rows.length, 3);
    assert.match(rows[0], /^<w:tr><w:trPr><w:cantSplit\/><w:tblHeader\/><\/w:trPr>/);
    assert.ok(!rows[1].includes("<w:tblHeader/>"));
    for (const row of rows) assert.equal((row.match(/<w:tc>/g) ?? []).length, 3, "every row has every column");
    assert.deepEqual(
      [...rows[1].matchAll(/<w:jc w:val="(\w+)"\/>/g)].map((match) => match[1]),
      ["left", "center", "right"]
    );
    assert.match(rows[1], /<w:rPr><w:b\/><w:bCs\/><\/w:rPr><w:t xml:space="preserve">1<\/w:t>/);
    const widths = [...table.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((match) => Number(match[1]));
    const page = TEMPLATE.page;
    const textWidth = Math.round((page.widthPt - page.marginLeftPt - page.marginRightPt) * 20);
    assert.equal(widths.length, 3);
    assert.ok(widths.reduce((sum, width) => sum + width, 0) <= textWidth);
    assert.match(table, /<w:tblStyle w:val="TableNormal"\/>/);
  });

  it("writes footnotes as Word footnotes and reports references Word cannot hold", async () => {
    const written = await write(
      "본문[^a] 다시[^a] 다른[^b]\n\n[^a]: 첫 각주 [링크](https://example.com/n)\n[^b]: 둘째 각주\n"
    );
    const files = await parts(written);
    const xml = files.get("word/document.xml") ?? "";
    const notes = files.get("word/footnotes.xml") ?? "";
    assert.deepEqual(
      [...xml.matchAll(/<w:footnoteReference w:id="(\d+)"\/>/g)].map((match) => match[1]),
      ["1", "2"]
    );
    assert.match(xml, /<w:rPr><w:vertAlign w:val="superscript"\/><\/w:rPr><w:t xml:space="preserve">1<\/w:t>/, "the repeated reference stays visible");
    assert.match(notes, /<w:footnote w:type="separator" w:id="-1">/);
    assert.match(notes, /<w:footnote w:type="continuationSeparator" w:id="0">/);
    const first = /<w:footnote w:id="1">[\s\S]*?<\/w:footnote>/.exec(notes)?.[0] ?? "";
    assert.match(first, /<w:pStyle w:val="FootnoteText"\/><\/w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"\/><\/w:rPr><w:footnoteRef\/><\/w:r>/);
    assert.match(first, /첫 각주 /u);
    assert.match(first, /<w:hyperlink r:id="rId1"/);
    assert.match(files.get("word/_rels/footnotes.xml.rels") ?? "", /Target="https:\/\/example.com\/n" TargetMode="External"/);
    assert.match(notes, /<w:footnote w:id="2">[\s\S]*둘째 각주/u);
    assert.match(files.get("word/settings.xml") ?? "", /<w:footnotePr><w:footnote w:id="-1"\/><w:footnote w:id="0"\/><\/w:footnotePr>/);
    assert.deepEqual(written.notices, [{ code: "footnote-repeated", count: 1 }]);
  });

  it("embeds images once, keeps their shape, and caps them to the text width", async () => {
    const wide = pngDataUri(2000, 500, [1, 2, 3]);
    const small = pngDataUri(96, 48, [4, 5, 6]);
    const written = await write(`![넓음](${wide})\n\n![작음](${small}) ![작음 다시](${small})\n\n![밖](https://example.com/a.png)\n`);
    const zip = await JSZip.loadAsync(written.bytes);
    const media = Object.keys(zip.files).filter((name) => name.startsWith("word/media/"));
    assert.deepEqual(media, ["word/media/image1.png", "word/media/image2.png"]);
    const xml = await zip.files["word/document.xml"].async("string");
    const extents = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].map((match) => [Number(match[1]), Number(match[2])]);
    const page = TEMPLATE.page;
    const textWidthEmu = Math.round((page.widthPt - page.marginLeftPt - page.marginRightPt) * 20) * 635;
    assert.equal(extents.length, 3);
    assert.equal(extents[0][0], textWidthEmu, "a wide image is capped to the text width");
    assert.ok(Math.abs(extents[0][0] / extents[0][1] - 4) < 0.01, "the aspect ratio is kept");
    assert.deepEqual(extents[1], [96 * 9525, 48 * 9525], "a small image keeps 96 dpi size");
    assert.deepEqual(extents[2], extents[1]);
    assert.match(xml, /<wp:docPr id="1" name="image1.png" descr="넓음"\/>/u);
    const ids = [...xml.matchAll(/<wp:docPr id="(\d+)"/g)].map((match) => match[1]);
    assert.deepEqual(ids, ["1", "2", "3"], "drawing ids are unique");
    assert.match(await zip.files["[Content_Types].xml"].async("string"), /<Default Extension="png" ContentType="image\/png"\/>/);
    assert.match(xml, /\[밖\]/u, "an image that is not embedded leaves its alternative text");
    assert.deepEqual(written.notices, [{ code: "image-not-embedded", count: 1 }]);
  });

  it("reads the pixel size of PNG, GIF, BMP, and JPEG headers", () => {
    assert.deepEqual(rasterImageSize(makePng(31, 7, [0, 0, 0])), { width: 31, height: 7 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x01, 0x0a, 0x00]);
    assert.deepEqual(rasterImageSize(gif), { width: 288, height: 10 });
    const bmp = new Uint8Array(26);
    bmp.set([0x42, 0x4d]);
    new DataView(bmp.buffer).setInt32(18, 640, true);
    new DataView(bmp.buffer).setInt32(22, -480, true);
    assert.deepEqual(rasterImageSize(bmp), { width: 640, height: 480 });
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03, 0x01
    ]);
    assert.deepEqual(rasterImageSize(jpeg), { width: 600, height: 300 });
    assert.equal(rasterImageSize(new Uint8Array([1, 2, 3])), null);
  });

  it("keeps equations as text in their own style and says so once", async () => {
    const written = await write("가격은 $5 그리고 $10 이다. 식 $E = mc^2$ 와\n\n$$\n\\int_0^1 x\\,dx\n$$\n\n`$code$`\n\n```\n$fenced$\n```");
    const xml = (await parts(written)).get("word/document.xml") ?? "";
    const math = [...xml.matchAll(/<w:rStyle w:val="MathText"\/><\/w:rPr><w:t xml:space="preserve">([^<]*)</g)].map((match) => match[1]);
    assert.deepEqual(math, ["$E = mc^2$", "$$"]);
    assert.match(xml, /\$\$<\/w:t><w:br\/><w:t xml:space="preserve">\\int_0\^1 x\\,dx<\/w:t><w:br\/><w:t xml:space="preserve">\$\$</, "a display equation keeps its backslashes and lines");
    assert.match(xml, /<w:rStyle w:val="VerbatimChar"\/><\/w:rPr><w:t xml:space="preserve">\$code\$</, "inline code is not an equation");
    assert.match(xml, /<w:pStyle w:val="SourceCode"\/><\/w:pPr><w:r><w:t xml:space="preserve">\$fenced\$</, "fenced code is not an equation");
    assert.match(xml, /가격은 \$5 그리고 \$10 이다\. 식 /u, "prices are not equations");
    assert.deepEqual(written.notices, [{ code: "math", count: 2 }]);
  });

  it("applies paragraph alignment and every colour the model lets through", async () => {
    const written = await write('<p align="center">가운데</p>\n\n<span style="color:navy;background-color:#ff0">색</span>');
    const xml = (await parts(written)).get("word/document.xml") ?? "";
    assert.match(xml, /<w:jc w:val="center"\/><\/w:pPr><w:r><w:t xml:space="preserve">가운데/u);
    assert.match(xml, /<w:rPr><w:color w:val="000080"\/><w:shd w:val="clear" w:color="auto" w:fill="FFFF00"\/><\/w:rPr><w:t xml:space="preserve">색/u);
    assert.deepEqual(written.notices, []);
  });
});

describe("built-in DOCX writer: package (R-031)", () => {
  const NOTES = [
    ["korean", KOREAN_REPORT_NOTE],
    ["english", ENGLISH_PAPER_NOTE],
    ["memo", PLAIN_MEMO_NOTE]
  ] as const;

  it("builds a complete, well-formed package whose references all resolve", async () => {
    for (const [name, markdown] of NOTES) {
      const written = await write(markdown, name);
      const zip = await JSZip.loadAsync(written.bytes);
      const names = Object.keys(zip.files);
      for (const required of [
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/core.xml",
        "docProps/app.xml",
        "word/document.xml",
        "word/_rels/document.xml.rels",
        "word/styles.xml",
        "word/numbering.xml",
        "word/footnotes.xml",
        "word/settings.xml",
        "word/fontTable.xml"
      ]) {
        assert.ok(names.includes(required), `${name}: ${required}`);
      }
      assert.equal(names[0], "[Content_Types].xml", "content types come first");
      const files = await parts(written);
      for (const [part, xml] of files) assertWellFormed(`${name}:${part}`, xml);

      const xml = files.get("word/document.xml") ?? "";
      const rels = files.get("word/_rels/document.xml.rels") ?? "";
      const relIds = new Set([...rels.matchAll(/ Id="(rId\d+)"/g)].map((match) => match[1]));
      for (const match of xml.matchAll(/r:(?:id|embed)="(rId\d+)"/g)) assert.ok(relIds.has(match[1]), `${name}: ${match[1]} resolves`);
      for (const match of rels.matchAll(/Target="([^"]+)"(?! TargetMode)/g)) {
        assert.ok(names.includes(`word/${match[1]}`), `${name}: relationship target ${match[1]} exists`);
      }
      const numbering = files.get("word/numbering.xml") ?? "";
      const numIds = new Set([...numbering.matchAll(/<w:num w:numId="(\d+)"/g)].map((match) => match[1]));
      const abstractIds = new Set([...numbering.matchAll(/<w:abstractNum w:abstractNumId="(\d+)"/g)].map((match) => match[1]));
      for (const match of xml.matchAll(/<w:numId w:val="(\d+)"/g)) assert.ok(numIds.has(match[1]), `${name}: list ${match[1]} is defined`);
      for (const match of numbering.matchAll(/<w:abstractNumId w:val="(\d+)"/g)) assert.ok(abstractIds.has(match[1]));
      const notes = files.get("word/footnotes.xml") ?? "";
      const noteIds = new Set([...notes.matchAll(/<w:footnote (?:w:type="\w+" )?w:id="(-?\d+)"/g)].map((match) => match[1]));
      for (const match of xml.matchAll(/<w:footnoteReference w:id="(\d+)"/g)) assert.ok(noteIds.has(match[1]), `${name}: footnote ${match[1]} exists`);
      const styles = files.get("word/styles.xml") ?? "";
      const styleIds = new Set([...styles.matchAll(/w:styleId="([^"]+)"/g)].map((match) => match[1]));
      for (const match of `${xml}${notes}`.matchAll(/<w:(?:pStyle|rStyle|tblStyle) w:val="([^"]+)"/g)) {
        assert.ok(styleIds.has(match[1]), `${name}: style ${match[1]} is defined`);
      }
      assert.match(files.get("docProps/core.xml") ?? "", new RegExp(`<dc:title>${name}</dc:title>`));
      assert.ok(!/dcterms:(created|modified)/.test(files.get("docProps/core.xml") ?? ""), "no timestamps");
    }
  });

  it("gives the same bytes for the same note and template", async () => {
    for (const [name, markdown] of NOTES) {
      const first = await write(markdown, name);
      const second = await write(markdown, name);
      assert.ok(Buffer.from(first.bytes).equals(Buffer.from(second.bytes)), `${name}: byte-identical`);
    }
    const zip = await JSZip.loadAsync((await write(KOREAN_REPORT_NOTE)).bytes);
    for (const file of Object.values(zip.files)) {
      assert.equal(file.date.toISOString(), "1980-01-01T00:00:00.000Z", `${file.name} has the fixed date`);
    }
  });

  it("builds every template style with the ids the Pandoc reference document uses", async () => {
    const edited = createDefaultWordTemplate();
    edited.styles["Body Text"].font = { ...edited.styles["Body Text"].font!, family: "Hallym Test", eastAsiaFamily: "Hallym Test", sizePt: 13, bold: true };
    edited.styles["Heading 2"].paragraph = { ...edited.styles["Heading 2"].paragraph!, align: "center", keepWithNext: true, spacingBeforePt: 18 };
    edited.page = { ...edited.page, widthPt: 500, heightPt: 700, marginLeftPt: 50, marginRightPt: 40 };
    const files = await parts(await writeDocx("## 가\n\n나", { template: edited, title: "t" }));
    const styles = files.get("word/styles.xml") ?? "";
    for (const id of Object.values(WORD_STYLE_ID_MAP)) assert.ok(styles.includes(`w:styleId="${id}"`), id);
    for (const id of Object.values(DOCX_EXTRA_STYLE_IDS)) assert.ok(styles.includes(`w:styleId="${id}"`), id);
    const style = (id: string): string => new RegExp(`<w:style [^>]*w:styleId="${id}"[^>]*>[\\s\\S]*?</w:style>`).exec(styles)?.[0] ?? "";
    assert.match(style("BodyText"), /<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Hallym Test" w:cs="Calibri"\/><w:b w:val="1"\/><w:bCs w:val="1"\/>/);
    assert.match(style("BodyText"), /<w:sz w:val="26"\/><w:szCs w:val="26"\/>/);
    assert.match(style("Heading2"), /<w:pPr><w:keepNext w:val="1"\/>[\s\S]*<w:spacing w:before="360"[^>]*\/><w:ind [^>]*\/><w:jc w:val="center"\/><\/w:pPr><w:rPr>/, "paragraph properties come first and in schema order");
    assert.match(style("Normal"), /w:default="1"/);
    assert.match(files.get("word/document.xml") ?? "", /<w:pgSz w:w="10000" w:h="14000" w:orient="portrait"\/><w:pgMar w:top="\d+" w:right="800" w:bottom="\d+" w:left="1000"/);
    assert.match(files.get("word/fontTable.xml") ?? "", /<w:font w:name="Hallym Test"\/>/);
    // One style builder for both paths: the reference document gets the same style text.
    const base = new JSZip();
    base.file("word/styles.xml", '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>');
    const reference = await JSZip.loadAsync(await buildReferenceDocx(await base.generateAsync({ type: "uint8array" }), edited));
    const referenceStyles = await reference.files["word/styles.xml"].async("string");
    const referenceStyle = new RegExp('<w:style [^>]*w:styleId="Heading2"[^>]*>[\\s\\S]*?</w:style>').exec(referenceStyles)?.[0];
    assert.equal(referenceStyle, style("Heading2"));
  });

  it("survives a round trip through Kordoc's DOCX reader", async () => {
    const read = async (markdown: string): Promise<{ markdown: string; images: number }> => {
      const { bytes } = await write(markdown);
      const result = await parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
        hancomFallback: false,
        ocr: false
      } as Parameters<typeof parse>[1]);
      assert.equal(result.success, true);
      if (!result.success) throw new Error("parse failed");
      return { markdown: result.markdown, images: result.images?.length ?? 0 };
    };

    const korean = await read(KOREAN_REPORT_NOTE);
    const lines = korean.markdown.split("\n").map((line) => line.trim()).filter(Boolean);
    assert.deepEqual(
      lines.filter((line) => line.startsWith("#")),
      ["# 2027학년도 AI 미디어 교육과정 개편 보고", "## 1. 추진 배경", "## 2. 추진 내용", "### 2.1 공통과목 개편", "## 3. 향후 일정"]
    );
    for (const expected of [
      "- 평가 기준 재설계 필요",
      "2. 응답률 62%",
      "1. 미디어커뮤니케이션 입문을 4개 영역으로 재구성",
      "3. 장비 대여는 학과 사무실에서 일괄 관리",
      "5. 다섯 번부터 시작하는 목록",
      "6. 여섯 번",
      "\u2610 교과과정위원회 심의",
      "\u2611 교수회의 보고",
      "| 구분 | 2026학년도 | 2027학년도 | 비고 |",
      "| 공통과목 | 7개 | 5개 | 통합 2건 |",
      "| 실습과목 | 12개 | 14개 | [안내](https://www.hallym.ac.kr/) |",
      "| AI 크레딧 | 없음 | 과목당 30만 원 | 앵커 예산 |",
      "인용문 둘째 문단이다.",
      "NOTE",
      "- 콜아웃 안 목록",
      "def credit(course):",
      "강제 줄바꿈 뒤의 줄이다."
    ]) {
      assert.ok(lines.includes(expected), `round trip keeps: ${expected}`);
    }
    assert.match(korean.markdown, /평가 기준을 다시 설계한다\.[^\n]*\(주: 첫째 각주는 근거 자료를 가리킨다\.\)/u);
    assert.match(korean.markdown, /앵커 사업 성과지표와 연계 \(주: 둘째 각주다\.\)/u);
    assert.match(korean.markdown, /\[한림대학교\]\(https:\/\/www\.hallym\.ac\.kr\/\)와 연결 노트를 본다/u);
    assert.equal(korean.images, 2);

    const english = await read(ENGLISH_PAPER_NOTE);
    assert.match(english.markdown, /^# Knowledge Journalism in the Zero-Click Era$/m);
    assert.match(english.markdown, /\| Dwell time \| 41\.2 \| 9\.8 \|/);
    assert.match(english.markdown, /answer questions directly\.[^\n]*\(주: See the 2025 industry report\.\)/);
    assert.match(english.markdown, /^2\. Period: 2025–2026$/m);

    const memo = await read(PLAIN_MEMO_NOTE);
    assert.deepEqual(
      memo.markdown.split("\n").map((line) => line.trim()).filter(Boolean),
      ["첫 제목 없이 시작하는 메모다.", "## 할 일", "- 하나", "- 둘", "끝."]
    );
  });
});

describe("document model for structured writers (R-031)", () => {
  it("leaves the HTML and PDF model unchanged", () => {
    const markdown = "# 제목\n\n본문[^1]\n\n| a | b |\n|:-:|--:|\n| 1 | 2 |\n\n[^1]: 각주\n";
    const before = JSON.stringify(parseEditorialDocument(markdown, "t"));
    const structured = parseEditorialBlocks(markdown);
    assert.equal(JSON.stringify(parseEditorialDocument(markdown, "t")), before, "the flag does not leak");
    assert.ok(!before.includes('"footnote"') && !before.includes('"align"'));
    assert.equal(structured.blocks[0].type, "heading", "the leading heading stays in place");
    assert.equal(structured.footnotes.length, 1);
    const table = structured.blocks.find((block) => block.type === "table");
    assert.deepEqual(table?.type === "table" ? table.align : null, ["center", "right"]);
    assert.ok(!structured.blocks.some((block) => block.type === "thematic-break"), "footnotes are not appended to the text");
  });
});

describe("DOCX engine setting (R-031)", () => {
  it("defaults to the built-in writer and keeps Pandoc for users who configured it", () => {
    assert.equal(normalizeDocxEngine(undefined, undefined), "builtin");
    assert.equal(normalizeDocxEngine(undefined, "pandoc"), "builtin");
    assert.equal(normalizeDocxEngine(undefined, " C:/Program Files/Pandoc/pandoc.exe "), "pandoc");
    assert.equal(normalizeDocxEngine("builtin", "C:/Program Files/Pandoc/pandoc.exe"), "builtin");
    assert.equal(normalizeDocxEngine("pandoc", "pandoc"), "pandoc");
    assert.equal(normalizeHanmarkSettings({}).docxEngine, "builtin");
    assert.equal(normalizeHanmarkSettings({ pandocPath: "/opt/homebrew/bin/pandoc" }).docxEngine, "pandoc");
    assert.equal(normalizeHanmarkSettings({ pandocPath: "/opt/homebrew/bin/pandoc", docxEngine: "builtin" }).docxEngine, "builtin");
  });
});
