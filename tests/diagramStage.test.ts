import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { describe, it } from "node:test";
import JSZip from "jszip";
import {
  decodeDiagramToken,
  encodeDiagramToken,
  findMermaidBlocks,
  readDiagramAnnotations,
  renderMermaidDiagrams,
  replaceDiagramTokensInHtml,
  type DiagramEnvironment
} from "../src/io/diagramStage";
import {
  BUILTIN_DIAGRAM_PALETTE,
  exportDiagramPalette,
  isSafeDiagramSvg,
  literalizeDiagramSvg
} from "../src/io/diagramSvg";
import { base64ToBytes, bytesToBase64, pngDiagramMark, pngDisplayScale, withPngDisplayScale } from "../src/io/pngMeta";
import { centerDiagramParagraphs, resolveMarkdownImages } from "../src/io/imageAssets";
import { assemblyNotice, diagramNotice, prepareExportMarkdown } from "../src/io/exportPreparation";
import { generateValidatedHwpx } from "../src/io/kordocEngine";
import { writeDocx } from "../src/io/docxWriter";
import { createDefaultWordTemplate } from "../src/legacy-port/defaultWordTemplate";
import { renderStandaloneHtml } from "../src/legacy-port/htmlExport";

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

/** A plain grey PNG of the given size. */
function png(width: number, height: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height, 0xcc);
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

const rasterCalls: Array<{ width: number; height: number; scale: number }> = [];
const ENVIRONMENT: DiagramEnvironment = {
  palette: { bg: "#FFFFFF", fg: "#17243A", muted: "#808080", line: "#17243A", surface: "#FFFFFF", surfaceAlt: "#FFFFFF", border: "#E0E0E0", accent: "#016CC3" },
  fontFamily: "'Test Sans', sans-serif",
  now: new Date(2026, 10, 18),
  rasterize: (_svg, width, height, scale) => {
    rasterCalls.push({ width, height, scale });
    return Promise.resolve(png(Math.round(width * scale), Math.round(height * scale)));
  }
};

const FLOW = ["flowchart LR", "    %% @caption: 재원과 쓰임", "    %% @alt: 두 재원이 설비로 이어진다", "    %% @key: C", "    A[\"대학 지원\"] --> C[\"조명 설비\"]"];
const fence = (lines: string[], mark = "```", prefix = ""): string[] => [`${prefix}${mark}mermaid`, ...lines.map((line) => prefix + line), `${prefix}${mark}`];
const loader = (source: string): Promise<{ data: Uint8Array; contentType: string }> => {
  const match = /^data:([^;,]+);base64,(.*)$/su.exec(source);
  if (!match) return Promise.reject(new Error("data URLs only"));
  return Promise.resolve({ data: Uint8Array.from(Buffer.from(match[2], "base64")), contentType: match[1] });
};
const firstPng = (markdown: string): Uint8Array =>
  Uint8Array.from(Buffer.from(/data:image\/png;base64,([A-Za-z0-9+/=]+)/u.exec(markdown)![1], "base64"));

describe("Mermaid blocks in a note (R-033)", () => {
  it("finds fences at the top level, in lists, quotes and callouts, and nowhere else", () => {
    const note = [
      "앞 문단",
      ...fence(FLOW),
      ...fence(["timeline", "    title 순서", "    section 가", "        1시 : 시작"], "~~~"),
      "- 항목",
      "",
      ...fence(["mindmap", "root((중심))"], "```", "  "),
      "> [!note] 콜아웃",
      ...fence(["mindmap", "root((안))"], "```", "> "),
      "````md",
      "```mermaid",
      "flowchart LR",
      "```",
      "````",
      "```js",
      "const x = 1;",
      "```",
      "```mermaid",
      "flowchart LR"
    ].join("\n");
    const blocks = findMermaidBlocks(note);
    assert.deepEqual(blocks.map((block) => block.prefix), ["", "", "  ", "> "]);
    assert.equal(blocks[0].source, FLOW.join("\n"));
    assert.equal(blocks[2].source, "mindmap\nroot((중심))");
    assert.equal(blocks[3].source, "mindmap\nroot((안))");
  });

  it("reads caption, alternative text and role comments", () => {
    assert.deepEqual(readDiagramAnnotations(FLOW.join("\n")), {
      caption: "재원과 쓰임",
      alt: "두 재원이 설비로 이어진다",
      key: ["C"],
      interpretation: [],
      aux: []
    });
    assert.deepEqual(readDiagramAnnotations("a\n%% @interp: X, Y\n%% @aux: Z").interpretation, ["X", "Y"]);
  });
});

describe("drawing for each export target (R-033)", () => {
  const note = ["# 제목", "", ...fence(FLOW), "", "뒤 문단", "", "```js", "const kept = true;", "```"].join("\n");

  it("hands HTML and PDF a token that holds literal, safe SVG and repeats exactly", async () => {
    const first = await renderMermaidDiagrams(note, "markup", ENVIRONMENT);
    const second = await renderMermaidDiagrams(note, "markup", ENVIRONMENT);
    assert.equal(first.markdown, second.markdown);
    assert.equal(first.rendered, 1);
    assert.ok(first.markdown.includes("```js\nconst kept = true;\n```"), "other code blocks are untouched");
    assert.ok(!first.markdown.includes("@caption") && !first.markdown.includes("flowchart LR"));
    const token = first.markdown.split("\n").find((line) => line.startsWith("HMDIAGRAM("))!;
    const diagram = decodeDiagramToken(token)!;
    assert.equal(diagram.caption, "재원과 쓰임");
    assert.equal(diagram.alt, "두 재원이 설비로 이어진다");
    assert.ok(!diagram.svg.includes("var("), "no CSS variable is exported");
    assert.ok(diagram.svg.includes("#17243A") && diagram.svg.includes("'Test Sans', sans-serif"));
    assert.ok(diagram.svg.includes("<title>두 재원이 설비로 이어진다</title>"));
    assert.ok(isSafeDiagramSvg(diagram.svg));
    assert.equal(encodeDiagramToken(diagram), token);
  });

  it("keeps a wide timeline in the direction the note shows and places it smaller", async () => {
    const timeline = [
      "timeline",
      "    title 진행 순서",
      "    section 소개",
      "        14시 00분 : 동문 6명 소개",
      "    section 네트워킹",
      "        15시 10분 : 네트워킹 세션 1",
      "        16시 00분 : 네트워킹 세션 2",
      "    section 마무리",
      "        16시 50분 : 전공설명회"
    ];
    const staged = await renderMermaidDiagrams(fence(timeline).join("\n"), "markup", { ...ENVIRONMENT, maxWidth: 600 });
    const token = /HMDIAGRAM\([A-Za-z0-9+/=]+\)/u.exec(staged.markdown)![0];
    const diagram = decodeDiagramToken(token)!;
    // Drawn 800 wide and horizontal by Pele; placed at the page's 600 with the same proportions.
    assert.ok(diagram.width <= 600 && diagram.width > 590, `placed width ${diagram.width}`);
    assert.ok(diagram.width > diagram.height * 2, "still horizontal");
    assert.match(diagram.svg, /^<svg\b[^>]*\sviewBox="0 0 800 [\d.]+"/u);
    assert.match(diagram.svg, new RegExp(`^<svg\\b[^>]*\\swidth="${diagram.width}" height="${diagram.height}"`, "u"));
    rasterCalls.length = 0;
    await renderMermaidDiagrams(fence(timeline).join("\n"), "hwpx", { ...ENVIRONMENT, maxWidth: 600 });
    assert.deepEqual(rasterCalls, [{ width: diagram.width, height: diagram.height, scale: 2 }]);
    // Far too wide for the page: Pele may turn it, as it does in a narrow pane.
    const narrow = await renderMermaidDiagrams(fence(timeline).join("\n"), "markup", { ...ENVIRONMENT, maxWidth: 400 });
    const turned = decodeDiagramToken(/HMDIAGRAM\([A-Za-z0-9+/=]+\)/u.exec(narrow.markdown)![0])!;
    assert.ok(turned.width <= 400);
    assert.ok(turned.height > turned.width * 0.6, "turned to fit");
  });

  it("keeps a block it cannot draw as code and names it once", async () => {
    const broken = [...fence(["nosuchdiagram", "    a --> b"]), "", ...fence(["flowchart LR", "    A[\"열기만"])].join("\n");
    const result = await renderMermaidDiagrams(broken, "markup", ENVIRONMENT);
    assert.equal(result.rendered, 0);
    assert.equal(result.kept, 2);
    assert.equal(result.markdown, broken);
    assert.deepEqual(result.warnings.map((warning) => warning.code), ["diagram-kept-as-code", "diagram-kept-as-code"]);
    assert.ok(result.warnings[0].message.includes("nosuchdiagram"));
  });

  it("gives HWPX and DOCX a marked PNG at twice its drawn size and a plain caption paragraph", async () => {
    rasterCalls.length = 0;
    const hwpx = await renderMermaidDiagrams(note, "hwpx", ENVIRONMENT);
    const lines = hwpx.markdown.split("\n");
    const at = lines.findIndex((line) => line.startsWith("![두 재원이 설비로 이어진다](data:image/png;base64,"));
    assert.ok(at > 0 && lines[at - 1] === "" && lines[at + 1] === "" && lines[at + 2] === "재원과 쓰임");
    assert.equal(rasterCalls[0].scale, 2);
    assert.deepEqual(pngDiagramMark(firstPng(hwpx.markdown)), { scale: 2, captionFollows: true });
    const quoted = await renderMermaidDiagrams(["> 인용", ...fence(["mindmap", "root((안))"], "```", "> "), "> 뒤"].join("\n"), "hwpx", ENVIRONMENT);
    assert.ok(/\n!\[[^\]]*\]\(data:image\/png/u.test(quoted.markdown), "HWPX pictures leave the quote");
    const inQuote = await renderMermaidDiagrams(["> 인용", ...fence(["mindmap", "root((안))"], "```", "> ")].join("\n"), "docx", ENVIRONMENT);
    assert.ok(/\n> !\[[^\]]*\]\(data:image\/png/u.test(inQuote.markdown), "DOCX pictures stay in the quote");
    assert.deepEqual(pngDiagramMark(firstPng(inQuote.markdown)), { scale: 2, captionFollows: false });
    const noRaster = await renderMermaidDiagrams(note, "docx", { ...ENVIRONMENT, rasterize: undefined });
    assert.equal(noRaster.kept, 1, "without a rasteriser the block stays code");
  });

  it("escapes a caption that would start a list or emphasis", async () => {
    const result = await renderMermaidDiagrams(fence(["flowchart LR", "    %% @caption: 1. *첫* 단계 [안]", "    A --> B"]).join("\n"), "hwpx", ENVIRONMENT);
    assert.ok(result.markdown.includes("\n1\\. \\*첫\\* 단계 안\n"));
  });
});

describe("diagram colours and safety (R-033)", () => {
  it("replaces every variable, with Pele's own defaults where the palette is silent", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" class="pele" viewBox="0 0 10 10" width="10" height="10" style="max-width:100%;--_fg:var(--pele-fg,#1f1f1f);--_r:var(--pele-radius,4px);color:var(--_fg);font-family:var(--pele-font,Old)" fill="var(--_fg)">' +
      '<rect fill="var(--pele-series-2,#f58518)" style="rx:var(--_r)"/><text font-weight="var(--pele-title-weight,bold)">가</text></svg>';
    const out = literalizeDiagramSvg(svg, { ...BUILTIN_DIAGRAM_PALETTE, fg: "#112233" }, '"My Font", sans-serif');
    assert.ok(!out.includes("var(") && !out.includes("--_"));
    assert.ok(out.includes('fill="#112233"') && out.includes('fill="#f58518"') && out.includes('rx="4"') && out.includes('font-weight="bold"'));
    assert.ok(out.includes("font-family:'My Font', sans-serif"));
    assert.ok(literalizeDiagramSvg(svg, { ...BUILTIN_DIAGRAM_PALETTE, series: ["#000001", "#000002"] }, "x").includes('fill="#000002"'));
  });

  it("uses paper colours when the note's background is dark or unknown", () => {
    const light = { bg: "#ffffff", fg: "#17243a", muted: "#808080", line: "#17243a", surface: "#ffffff", surfaceAlt: "#ffffff", border: "#e0e0e0", accent: "#016cc3" };
    assert.equal(exportDiagramPalette(light).source, "note");
    assert.equal(exportDiagramPalette(light).palette.fg, "#17243A");
    assert.equal(exportDiagramPalette({ ...light, bg: "#0B0C0E" }).source, "paper");
    assert.equal(exportDiagramPalette({ ...light, bg: "#0B0C0E" }).palette.bg, "#FFFFFF");
    assert.equal(exportDiagramPalette({ bg: "#FFFFFF" }).source, "paper");
    const paper = { ...BUILTIN_DIAGRAM_PALETTE, fg: "#000000" };
    assert.equal(exportDiagramPalette(null, paper).palette.fg, "#000000");
  });

  it("refuses SVG that is more than a drawing", () => {
    const wrap = (inner: string, attributes = ""): string => `<svg xmlns="http://www.w3.org/2000/svg"${attributes}>${inner}</svg>`;
    assert.equal(isSafeDiagramSvg(wrap('<g><rect width="1" height="1"/><text>가</text></g>')), true);
    for (const bad of [
      wrap("<script>alert(1)</script>"),
      wrap('<rect onload="x()"/>'),
      wrap('<a href="https://example.com"><text>x</text></a>'),
      wrap('<image href="data:image/png;base64,AA"/>'),
      wrap("<foreignObject><div>x</div></foreignObject>"),
      wrap("<style>*{fill:red}</style>"),
      wrap('<rect fill="url(https://example.com/x)"/>'),
      wrap('<use xlink:href="#a"/>'),
      "<svg><rect/></svg>"
    ]) {
      assert.equal(isSafeDiagramSvg(bad), false, bad);
    }
    const forged = `HMDIAGRAM(${bytesToBase64(new TextEncoder().encode(JSON.stringify({ svg: wrap("<script>x</script>"), width: 10, height: 10 })))})`;
    assert.equal(decodeDiagramToken(forged), null);
    assert.equal(replaceDiagramTokensInHtml(`<p>${forged}</p>`), `<p>${forged}</p>`, "a forged token stays text");
  });
});

describe("pictures HanMark drew (R-033)", () => {
  it("marks a PNG with its scale and caption, and leaves other images alone", () => {
    const plain = png(40, 20);
    assert.equal(pngDiagramMark(plain), null);
    assert.equal(pngDisplayScale(plain), 1);
    const marked = withPngDisplayScale(plain, 2, true);
    assert.deepEqual(pngDiagramMark(marked), { scale: 2, captionFollows: true });
    assert.deepEqual(Array.from(withPngDisplayScale(marked, 2, true)), Array.from(marked), "marking twice gives the same bytes");
    assert.deepEqual(pngDiagramMark(withPngDisplayScale(marked, 3)), { scale: 3, captionFollows: false });
    assert.equal(pngDisplayScale(new Uint8Array([0xff, 0xd8, 0xff])), 1);
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253]);
    assert.deepEqual(Array.from(base64ToBytes(bytesToBase64(bytes))!), Array.from(bytes));
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString("base64"));
    assert.equal(base64ToBytes("a?=="), null);
  });

  it("places a marked picture at its drawn size in the HWPX image pipeline", async () => {
    const source = `data:image/png;base64,${bytesToBase64(withPngDisplayScale(png(400, 200), 2, true))}`;
    const plain = `data:image/png;base64,${bytesToBase64(png(400, 200))}`;
    const resolved = await resolveMarkdownImages(`![도식](${source})\n\n![사진](${plain})`, { loader });
    assert.equal(resolved.assets[0].displayWidthHu, 200 * 75);
    assert.deepEqual(resolved.assets[0].diagram, { captionFollows: true });
    assert.equal(resolved.assets[1].displayWidthHu, 400 * 75);
    assert.equal(resolved.assets[1].diagram, undefined);
  });

  it("centres the picture paragraph and its caption with copies of their own shapes", () => {
    const header =
      '<hh:paraProperties itemCnt="2"><hh:paraPr id="0"><hh:align horizontal="JUSTIFY"/><hh:breakSetting keepWithNext="0"/></hh:paraPr>' +
      '<hh:paraPr id="1"><hh:align horizontal="LEFT"/><hh:breakSetting keepWithNext="0"/></hh:paraPr></hh:paraProperties>';
    const section =
      '<hp:p id="1" paraPrIDRef="0"><hp:run><hp:t>앞</hp:t></hp:run></hp:p>' +
      '<hp:p id="2" paraPrIDRef="0"><hp:run><hp:pic><hc:img binaryItemIDRef="d1"/></hp:pic></hp:run></hp:p>' +
      '<hp:p id="3" paraPrIDRef="1"><hp:run><hp:t>캡션</hp:t></hp:run></hp:p>' +
      '<hp:p id="4" paraPrIDRef="0"><hp:run><hp:pic><hc:img binaryItemIDRef="photo"/></hp:pic></hp:run></hp:p>';
    const out = centerDiagramParagraphs(section, header, new Map([["d1", true]]));
    assert.ok(out.header.includes('itemCnt="4"'));
    assert.ok(out.header.includes('<hh:paraPr id="2"><hh:align horizontal="CENTER"/><hh:breakSetting keepWithNext="1"/>'));
    assert.ok(out.header.includes('<hh:paraPr id="3"><hh:align horizontal="CENTER"/><hh:breakSetting keepWithNext="0"/>'));
    assert.ok(out.section.includes('<hp:p id="2" paraPrIDRef="2">') && out.section.includes('<hp:p id="3" paraPrIDRef="3">'));
    assert.ok(out.section.includes('<hp:p id="1" paraPrIDRef="0">') && out.section.includes('<hp:p id="4" paraPrIDRef="0">'), "other paragraphs keep their shape");
    assert.deepEqual(centerDiagramParagraphs(section, header, new Map()), { section, header });
  });
});

describe("diagrams through the writers (R-033)", () => {
  const note = ["# 제목", "", "앞 문단", "", ...fence(FLOW), "", "뒤 문단"].join("\n");

  it("writes an HWPX with the picture where the code was, centred, and the same bytes twice", async () => {
    const staged = await renderMermaidDiagrams(note, "hwpx", ENVIRONMENT);
    const first = await generateValidatedHwpx(staged.markdown, { images: { loader } });
    const second = await generateValidatedHwpx(staged.markdown, { images: { loader } });
    assert.equal(Buffer.compare(Buffer.from(first.data), Buffer.from(second.data)), 0);
    const zip = await JSZip.loadAsync(first.data);
    const section = await zip.file("Contents/section0.xml")!.async("string");
    const header = await zip.file("Contents/header.xml")!.async("string");
    assert.ok(!section.includes("flowchart LR") && !section.includes("@caption"), "the source is not printed");
    const picture = /<hp:p\b[^>]*\bparaPrIDRef="(\d+)"[^>]*>(?:(?!<\/hp:p>)[\s\S])*?<hp:pic\b[\s\S]*?<\/hp:p>\s*<hp:p\b[^>]*\bparaPrIDRef="(\d+)"[^>]*>([\s\S]*?)<\/hp:p>/u.exec(section)!;
    const centred = (id: string): boolean =>
      /<hh:align\b[^>]*\bhorizontal="CENTER"/u.test(new RegExp(`<hh:paraPr\\b[^>]*\\bid="${id}"[\\s\\S]*?</hh:paraPr>`, "u").exec(header)![0]);
    assert.ok(centred(picture[1]) && centred(picture[2]));
    assert.ok(picture[3].includes("재원과 쓰임"));
    assert.equal(Object.keys(zip.files).filter((file) => /^BinData\/.+\.png$/u.test(file)).length, 1);
  });

  it("writes a DOCX with a centred picture at its drawn size and a caption in the image caption style", async () => {
    const staged = await renderMermaidDiagrams(note, "docx", ENVIRONMENT);
    const template = createDefaultWordTemplate();
    const first = await writeDocx(staged.markdown, { template, title: "t" });
    const second = await writeDocx(staged.markdown, { template, title: "t" });
    assert.deepEqual(Array.from(first.bytes), Array.from(second.bytes));
    const xml = await (await JSZip.loadAsync(first.bytes)).file("word/document.xml")!.async("string");
    const paragraph = /<w:p><w:pPr>((?:(?!<\/w:pPr>)[\s\S])*)<\/w:pPr>(?:(?!<\/w:p>)[\s\S])*<pic:pic>[\s\S]*?<\/w:p><w:p><w:pPr>([\s\S]*?)<\/w:pPr>/u.exec(xml)!;
    assert.ok(paragraph[1].includes("<w:keepNext/>") && paragraph[1].includes('<w:jc w:val="center"/>'));
    assert.ok(paragraph[2].includes('<w:pStyle w:val="ImageCaption"/>') && paragraph[2].includes('<w:jc w:val="center"/>'));
    const drawn = rasterCalls[rasterCalls.length - 1];
    assert.ok(xml.includes(`<wp:extent cx="${Math.round(Math.round(drawn.width * 2) / 2 * 9525)}"`), "the picture is placed at its drawn width");
    assert.ok(xml.includes('descr="두 재원이 설비로 이어진다"'));
  });

  it("writes HTML with an inline SVG figure and caption in both themes", async () => {
    const staged = await renderMermaidDiagrams(note, "markup", ENVIRONMENT);
    for (const theme of ["achmage-editorial", "classic"] as const) {
      const html = renderStandaloneHtml(staged.markdown, { title: "t", theme });
      assert.equal((html.match(/<figure class="hanmark-diagram"><svg /gu) ?? []).length, 1, theme);
      assert.ok(html.includes("<figcaption>재원과 쓰임</figcaption>"), theme);
      assert.ok(!html.includes("HMDIAGRAM(") && !/<svg[\s\S]*?var\(/u.test(html), theme);
      assert.ok(html.includes(".hanmark-diagram svg{"), theme);
    }
    assert.ok(!renderStandaloneHtml("본문", { title: "t" }).includes("hanmark-diagram"), "notes without diagrams are unchanged");
  });
});

describe("the shared export step (R-033)", () => {
  it("draws diagrams with or without note assembly and reports them apart from assembly", async () => {
    const note = fence(FLOW).join("\n");
    let built = 0;
    const diagrams = { target: "markup" as const, environment: () => { built += 1; return ENVIRONMENT; } };
    const off = await prepareExportMarkdown(null, note, "n.md", { assembleEmbeds: false, outputLanguage: "ko", diagrams });
    assert.ok(off.markdown.includes("HMDIAGRAM("));
    const none = await prepareExportMarkdown(null, "본문만", "n.md", { assembleEmbeds: false, outputLanguage: "ko", diagrams });
    assert.equal(none.markdown, "본문만");
    assert.equal(built, 1, "the environment is built only for notes with a Mermaid block");
    const untouched = await prepareExportMarkdown(null, note, "n.md", { assembleEmbeds: false, outputLanguage: "ko" });
    assert.equal(untouched.markdown, note, "switched off, the block stays code as before");
    const broken = await prepareExportMarkdown(null, fence(["nosuchdiagram"]).join("\n"), "n.md", { assembleEmbeds: false, outputLanguage: "ko", diagrams });
    assert.equal(assemblyNotice(broken.warnings), null);
    assert.ok(diagramNotice(broken.warnings)?.includes("nosuchdiagram"));
    const noted = await renderMermaidDiagrams(note, "markup", { ...ENVIRONMENT, fontNotice: "글꼴 안내" });
    assert.deepEqual(noted.warnings.map((warning) => warning.code), ["diagram-font"]);
  });
});
