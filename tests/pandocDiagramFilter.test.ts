import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { withPngDisplayScale } from "../src/io/pngMeta";
import { addDiagramFigureStyle, DIAGRAM_FIGURE_STYLE_NAME } from "../src/legacy-port/wordReferenceDoc";

/** Pandoc is a user-installed optional engine; this test runs only where it is present. */
function pandocPath(): string | null {
  for (const candidate of [process.env.HANMARK_PANDOC, "pandoc", "C:\\Program Files\\Pandoc\\pandoc.exe"]) {
    if (!candidate) continue;
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // try the next one
    }
  }
  return null;
}

function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    let c = (value ^ byte) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    value = c ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "ascii");
  body.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

function png(width: number, height: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x88);
  for (let row = 0; row < height; row += 1) raw[row * (width * 3 + 1)] = 0;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0))
    ])
  );
}

const dataUrl = (bytes: Uint8Array): string => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;

function paragraphStyles(documentXml: string): Array<{ style: string; text: string; picture: boolean }> {
  return [...documentXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gu)].map((match) => ({
    style: /<w:pStyle w:val="([^"]+)"/u.exec(match[1])?.[1] ?? "",
    text: [...match[1].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/gu)].map((t) => t[1]).join(""),
    picture: match[1].includes("<w:drawing>")
  }));
}

describe("Pandoc DOCX diagram pictures (R-033)", () => {
  it("adds one centred figure style to the reference document", () => {
    const base = '<w:styles xmlns:w="w"><w:style w:type="paragraph" w:styleId="BodyText"/></w:styles>';
    const once = addDiagramFigureStyle(base);
    assert.match(once, /w:styleId="DiagramFigure"><w:name w:val="Diagram Figure"\/>/u);
    assert.match(once, /<w:jc w:val="center"\/>/u);
    assert.equal(addDiagramFigureStyle(once), once);
    assert.equal(DIAGRAM_FIGURE_STYLE_NAME, "Diagram Figure");
  });

  const pandoc = pandocPath();
  it("centres a marked diagram, styles its caption, and leaves other pictures alone", { skip: pandoc ? false : "Pandoc is not installed" }, async () => {
    const work = mkdtempSync(join(tmpdir(), "hanmark-pandoc-"));
    try {
      const captioned = withPngDisplayScale(png(40, 20), 2, true);
      const plain = withPngDisplayScale(png(40, 20), 2, false);
      const other = png(40, 20);
      const markdown = [
        "본문 첫 문단.",
        "",
        `![흐름](${dataUrl(captioned)})`,
        "",
        "재원과 쓰임",
        "",
        "그림 뒤의 본문.",
        "",
        `![제목 없는 도식](${dataUrl(plain)})`,
        "",
        "도식 뒤의 본문은 그대로.",
        "",
        `![일반 그림](${dataUrl(other)})`,
        "",
        "일반 그림 뒤의 본문."
      ].join("\n");
      writeFileSync(join(work, "note.md"), markdown, "utf8");
      const reference = join(work, "reference.docx");
      const base = execFileSync(pandoc!, ["--print-default-data-file", "reference.docx"]);
      const zip = await JSZip.loadAsync(base);
      zip.file("word/styles.xml", addDiagramFigureStyle(await zip.file("word/styles.xml")!.async("string")));
      writeFileSync(reference, await zip.generateAsync({ type: "nodebuffer" }));
      const output = join(work, "out.docx");
      execFileSync(pandoc!, [
        join(work, "note.md"),
        "--from", "gfm+footnotes+pipe_tables+task_lists",
        "--to", "docx",
        "--reference-doc", reference,
        "--lua-filter", "word-assets/docx_style_map.lua",
        "-o", output
      ]);
      const docx = await JSZip.loadAsync(readFileSync(output));
      const paragraphs = paragraphStyles(await docx.file("word/document.xml")!.async("string"));
      const pictures = paragraphs.filter((p) => p.picture);
      assert.equal(pictures.length, 3);
      assert.equal(pictures[0].style, "DiagramFigure");
      assert.equal(pictures[1].style, "DiagramFigure");
      assert.notEqual(pictures[2].style, "DiagramFigure");
      const after = (text: string): string => paragraphs.find((p) => p.text === text)!.style;
      assert.equal(after("재원과 쓰임"), "ImageCaption");
      assert.notEqual(after("도식 뒤의 본문은 그대로."), "ImageCaption");
      assert.notEqual(after("일반 그림 뒤의 본문."), "ImageCaption");
      const styles = await docx.file("word/styles.xml")!.async("string");
      assert.match(styles, /<w:style\b[^>]*w:styleId="DiagramFigure"[^>]*>(?:(?!<\/w:style>)[^])*<w:jc w:val="center"\s*\/>/u);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
