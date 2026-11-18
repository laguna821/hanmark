import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateSync } from "node:zlib";
import JSZip from "jszip";
import { addMemoHwpx, markdownToHwpx, parse } from "kordoc";
import { DEFAULT_IMPORT_OPTIONS, kordocParseOptions, toParseOptions, type ImportOptions } from "../src/io/importOptions";
import { generateValidatedHwpx } from "../src/io/kordocEngine";
import { describeImportWarning } from "../src/io/messageCatalog";

/**
 * Import options that M3 tested only as option values, here on real document
 * shapes built in the test (M10): a Hangul memo, a footnote that holds a table,
 * a PDF whose picture sits between two paragraphs, and a PowerPoint deck with
 * levels, a table, notes, a picture, and a hidden slide.
 */
function buffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  return data instanceof Uint8Array ? (data.slice().buffer as ArrayBuffer) : data;
}

async function importWith(bytes: ArrayBuffer, options: Partial<ImportOptions> = {}) {
  const result = await parse(bytes, kordocParseOptions(toParseOptions({ ...DEFAULT_IMPORT_OPTIONS, ...options })));
  assert.equal(result.success, true, result.success ? "" : String(result.error));
  if (!result.success) throw new Error("import failed");
  return result;
}

// --- a PNG without any library -------------------------------------------------
function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(Buffer.from(type, "latin1"), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A two-colour checkerboard, so no reader takes it for a blank picture. */
function checkerPixels(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dark = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      pixels.set(dark ? [0, 107, 115] : [250, 200, 60], (y * size + x) * 3);
    }
  }
  return pixels;
}

function checkerPng(size = 64): Uint8Array {
  const pixels = checkerPixels(size);
  const raw = new Uint8Array(size * (size * 3 + 1));
  for (let y = 0; y < size; y += 1) raw.set(pixels.subarray(y * size * 3, (y + 1) * size * 3), y * (size * 3 + 1) + 1);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array())
  ]);
}

// --- a PDF with a picture between two paragraphs ---------------------------------
function picturePdf(): ArrayBuffer {
  const size = 64;
  const image = Buffer.from(checkerPixels(size));
  const text = (y: number, words: string): string => `BT /F1 12 Tf 72 ${y} Td (${words}) Tj ET\n`;
  const content =
    text(760, "First paragraph before the picture, long enough to be read as body text.") +
    text(744, "It continues on a second line so the block is clearly a paragraph.") +
    "q 200 0 0 200 72 520 cm /Im1 Do Q\n" +
    text(490, "Second paragraph after the picture, long enough to be read as body text.") +
    text(474, "It also continues on a second line so the block is clearly a paragraph.");
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >> >>"),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), Buffer.from(content, "latin1"), Buffer.from("endstream")]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${size} /Height ${size} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${image.length} >>\nstream\n`),
      image,
      Buffer.from("\nendstream")
    ])
  ];
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    parts.push(object);
    length += object.length;
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return buffer(Buffer.concat(parts));
}

// --- a PowerPoint deck -------------------------------------------------------------
const NS =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function textShape(type: string, paragraphs: Array<{ text: string; level?: number }>): string {
  const body = paragraphs
    .map((item) => `<a:p>${item.level ? `<a:pPr lvl="${item.level}"/>` : ""}<a:r><a:rPr lang="ko-KR"/><a:t>${item.text}</a:t></a:r></a:p>`)
    .join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${body}</p:txBody></p:sp>`;
}

function tableFrame(rows: string[][]): string {
  const cell = (text: string): string => `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
  const grid = rows[0].map(() => '<a:gridCol w="2000000"/>').join("");
  const body = rows.map((row) => `<a:tr h="370000">${row.map(cell).join("")}</a:tr>`).join("");
  return (
    '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>' +
    '<p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1110000"/></p:xfrm>' +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid>${grid}</a:tblGrid>${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  );
}

const PICTURE =
  '<p:pic><p:nvPicPr><p:cNvPr id="7" name="그림" descr="바둑판 그림"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
  '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
  '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';

function slideXml(shapes: string, attrs = ""): string {
  return (
    `${XML}<p:sld ${NS}${attrs}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    `${shapes}</p:spTree></p:cSld></p:sld>`
  );
}

async function richDeck(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      [1, 2, 3].map((n) => `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("") +
      '<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>' +
      "</Types>"
  );
  zip.file("_rels/.rels", `${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file(
    "ppt/presentation.xml",
    `${XML}<p:presentation ${NS}><p:sldIdLst>${[1, 2, 3].map((n) => `<p:sldId id="${255 + n}" r:id="rId${n}"/>`).join("")}</p:sldIdLst></p:presentation>`
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `${XML}<Relationships xmlns="${PKG_REL}">${[1, 2, 3].map((n) => `<Relationship Id="rId${n}" Type="${REL}/slide" Target="slides/slide${n}.xml"/>`).join("")}</Relationships>`
  );
  zip.file(
    "ppt/slides/slide1.xml",
    slideXml(
      textShape("title", [{ text: "교육과정 개편 방향" }]) +
        textShape("body", [{ text: "공통과목 재편" }, { text: "입문 과목 통합", level: 1 }, { text: "실습 기준 마련" }])
    )
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`
  );
  zip.file(
    "ppt/notesSlides/notesSlide1.xml",
    `${XML}<p:notes ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
      `${textShape("body", [{ text: "발표자 메모: 예산은 다음 장에서 설명" }])}</p:spTree></p:cSld></p:notes>`
  );
  zip.file(
    "ppt/notesSlides/_rels/notesSlide1.xml.rels",
    `${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/slide" Target="../slides/slide1.xml"/></Relationships>`
  );
  zip.file(
    "ppt/slides/slide2.xml",
    slideXml(textShape("title", [{ text: "과목 수 비교" }]) + tableFrame([["구분", "2026", "2027"], ["공통과목", "7개", "5개"]]) + PICTURE)
  );
  zip.file(
    "ppt/slides/_rels/slide2.xml.rels",
    `${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId2" Type="${REL}/image" Target="../media/image1.png"/></Relationships>`
  );
  zip.file("ppt/media/image1.png", checkerPng());
  zip.file("ppt/slides/slide3.xml", slideXml(textShape("title", [{ text: "숨긴 참고 슬라이드" }]), ' show="0"'));
  return buffer(await zip.generateAsync({ type: "uint8array" }));
}

describe("import options on real document shapes (M10)", () => {
  it("brings Hangul memos into the note only when asked", async () => {
    const plain = await markdownToHwpx("# 회의 안건\n\n교과과정 개편안을 12월 위원회에 올린다.\n\n예산은 앵커 사업에서 집행한다.", {});
    const withMemo = await addMemoHwpx(buffer(plain), [{ anchor: "12월 위원회", text: "날짜 확인 필요", author: "검토자" }], new Date(Date.UTC(2026, 10, 18)));
    assert.equal(withMemo.placed.length, 1);
    const off = await importWith(withMemo.buffer);
    assert.ok(!off.markdown.includes("날짜 확인 필요"), "memos stay out by default");
    assert.match(off.markdown, /교과과정 개편안을 12월 위원회에 올린다/u);
    const on = await importWith(withMemo.buffer, { memos: true });
    assert.match(on.markdown, /날짜 확인 필요/u);
    assert.match(on.markdown, /메모/u);
    // The body is the same; the memos come after it.
    assert.ok(on.markdown.indexOf("날짜 확인 필요") > on.markdown.indexOf("예산은 앵커 사업에서 집행한다"));
  });

  it("keeps a table that sits inside a footnote", async () => {
    const generated = await generateValidatedHwpx(
      ["# 각주 속 표", "", "본문에 각주가 달린 문장입니다.[^1]", "", "| 연도 | 과목 수 |", "|---|---|", "| 2026 | 7개 |", "| 2027 | 5개 |", "", "[^1]: 각주 설명 문장."].join("\n"),
      {}
    );
    const zip = await JSZip.loadAsync(generated.data);
    const section = await zip.file("Contents/section0.xml")!.async("string");
    // Move the body table's paragraph into the footnote, the way Hangul stores a table typed in a footnote.
    const table = /<hp:p\b(?:(?!<hp:p\b)[\s\S])*?<hp:tbl\b[\s\S]*?<\/hp:tbl>[\s\S]*?<\/hp:p>/u.exec(section);
    assert.ok(table, "the generated document has a table paragraph");
    const without = section.replace(table[0], "");
    const moved = without.replace(/(<hp:footNote\b[\s\S]*?)(<\/hp:subList>)/u, `$1${table[0]}$2`);
    assert.notEqual(moved, without, "the table was moved into the footnote");
    zip.file("Contents/section0.xml", moved);
    const result = await importWith(buffer(await zip.generateAsync({ type: "uint8array" })), { tables: "mixed" });
    const note = /\(주:[\s\S]*?\)\s*$/mu.exec(result.markdown)?.[0] ?? result.markdown;
    assert.match(result.markdown, /각주 설명 문장/u);
    for (const cell of ["연도", "과목 수", "2026", "7개", "2027", "5개"]) assert.ok(note.includes(cell), `${cell} survives in the footnote: ${note}`);
    assert.match(note, /<table>|\|/u, "the footnote still holds a table");
  });

  it("puts a PDF picture where it is read when asked, and at the end of the page otherwise", async () => {
    const pdf = picturePdf();
    const end = await importWith(pdf);
    const flow = await importWith(pdf, { imagesInFlow: true });
    for (const result of [end, flow]) {
      assert.match(result.markdown, /First paragraph before the picture/u);
      assert.match(result.markdown, /Second paragraph after the picture/u);
      assert.equal((result.markdown.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length, 1, result.markdown);
      assert.equal(result.images?.length, 1);
    }
    const at = (markdown: string, needle: RegExp): number => markdown.search(needle);
    const picture = /!\[[^\]]*\]\([^)]+\)/u;
    assert.ok(at(end.markdown, picture) > at(end.markdown, /Second paragraph/u), `page end: ${end.markdown}`);
    assert.ok(
      at(flow.markdown, picture) > at(flow.markdown, /First paragraph/u) && at(flow.markdown, picture) < at(flow.markdown, /Second paragraph/u),
      `in place: ${flow.markdown}`
    );
  });

  it("reads a PowerPoint deck with levels, a table, notes, a picture, and a hidden slide", async () => {
    const result = await importWith(await richDeck());
    assert.equal(result.fileType, "pptx");
    const markdown = result.markdown;
    assert.match(markdown, /교육과정 개편 방향/u);
    // Bullets keep their levels.
    assert.match(markdown, /^- 공통과목 재편$/mu);
    assert.match(markdown, /^\s{2,}- 입문 과목 통합$/mu);
    assert.match(markdown, /^- 실습 기준 마련$/mu);
    // The table arrives as an Obsidian table (the default).
    assert.match(markdown, /\| 구분 \| 2026 \| 2027 \|/u);
    assert.match(markdown, /\| 공통과목 \| 7개 \| 5개 \|/u);
    // Speaker notes and the picture.
    assert.match(markdown, /발표자 메모: 예산은 다음 장에서 설명/u);
    assert.equal(result.images?.length, 1);
    assert.match(markdown, /!\[[^\]]*\]\([^)]*\.png\)/u);
    // The hidden slide is left out and reported in plain words.
    assert.ok(!markdown.includes("숨긴 참고 슬라이드"));
    const hidden = (result.warnings ?? []).find((warning) => warning.code === "HIDDEN_TEXT_FILTERED");
    assert.ok(hidden);
    assert.ok(!describeImportWarning(hidden).includes("HIDDEN_TEXT_FILTERED"));
    // Slides are pages; the hidden slide keeps its number.
    assert.equal(result.pageCount ?? (result as { metadata?: { pageCount?: number } }).metadata?.pageCount, 3);
  });
});
