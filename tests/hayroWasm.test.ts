import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { deflateSync } from "node:zlib";
import {
  KORDOC_HAYRO_WASM,
  assertHayroWasmEmbedded,
  hardenKordocWasmSource,
  installedHayroWasmDigest
} from "../esbuild.config.mjs";
import { hayroWasmBytes } from "../src/io/hayroWasm";
import { HAYRO_WASM_BYTE_LENGTH, HAYRO_WASM_SHA256 } from "../src/io/hayroWasmData";
import { makeKoreanCMapPdf } from "./fixtures/koreanCMapPdf";
import { loadHardenedKordocBundle, type HardenedBundle } from "./helpers/hardenedKordocBundle";

interface ParseOutcome {
  success: boolean;
  fileType?: string;
  markdown?: string;
  error?: string;
  code?: string;
  warnings?: Array<{ code?: string; message: string }>;
}

interface Runtime {
  parseBytes(bytes: Uint8Array, options?: Record<string, unknown>): Promise<ParseOutcome>;
  roundTripHwpx(markdown: string): Promise<{
    byteLength: number;
    validation: { ok: boolean };
    reparsed: ParseOutcome;
    svgPages: number;
    firstSvg: string;
  }>;
}

const ENTRY =
  'import { markdownToHwpx, parse, renderHwpxToSvg, validateHwpx } from "kordoc";\n' +
  "export async function parseBytes(bytes, options) {\n" +
  "  return parse(new Uint8Array(bytes).buffer, options);\n" +
  "}\n" +
  "export async function roundTripHwpx(markdown) {\n" +
  "  const generated = await markdownToHwpx(markdown);\n" +
  "  const validation = await validateHwpx(generated);\n" +
  "  const reparsed = await parse(generated);\n" +
  "  const rendered = await renderHwpxToSvg(generated, { reflow: true });\n" +
  "  return {\n" +
  "    byteLength: generated.byteLength,\n" +
  "    validation,\n" +
  "    reparsed,\n" +
  "    svgPages: rendered.pageCount,\n" +
  "    firstSvg: rendered.svg\n" +
  "  };\n" +
  "}\n";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A valid 2x2 grey PNG: an image file handed to parse(). */
function makePng(): Uint8Array {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header.set([8, 0, 0, 0, 0], 8);
  const pixels = deflateSync(Buffer.from([0, 128, 128, 0, 128, 128]));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", pixels),
      chunk("IEND", Buffer.alloc(0))
    ])
  );
}

describe("embedded hayro PDF engine (R-029)", () => {
  let bundle: HardenedBundle<Runtime>;
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;

  before(async () => {
    // Any network use by the bundle is a failure, not a slow test.
    globalThis.fetch = (() => {
      networkCalls += 1;
      return Promise.reject(new Error("network is forbidden in HanMark"));
    }) as typeof fetch;
    bundle = await loadHardenedKordocBundle<Runtime>(ENTRY);
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await bundle?.dispose();
  });

  it("embeds exactly the wasm shipped in the reviewed Kordoc package", async () => {
    const installed = await installedHayroWasmDigest();
    assert.deepEqual(installed, { ...KORDOC_HAYRO_WASM });
    assert.equal(HAYRO_WASM_SHA256, installed.sha256);
    assert.equal(HAYRO_WASM_BYTE_LENGTH, installed.byteLength);
    const embedded = hayroWasmBytes();
    assert.equal(embedded.byteLength, installed.byteLength);
    assert.equal(createHash("sha256").update(embedded).digest("hex"), installed.sha256);
    assert.equal(WebAssembly.validate(embedded), true);
    await assert.doesNotReject(assertHayroWasmEmbedded());
  });

  it("replaces Kordoc's file and network loader, and fails closed if its shape changes", async () => {
    const dist = "node_modules/kordoc/dist";
    const { readdir } = await import("node:fs/promises");
    let loaders = 0;
    for (const name of await readdir(dist)) {
      if (!/^chunk-.*\.js$/u.test(name)) continue;
      const source = await readFile(`${dist}/${name}`, "utf8");
      if (!source.includes("hayro-pdf.wasm")) continue;
      const hardened = hardenKordocWasmSource(source);
      loaders += hardened.hayroWasmLoaderReplacements;
      assert.doesNotMatch(hardened.source, /hayro-pdf\.wasm/u, name);
      assert.match(hardened.source, /async function wasmBytes\(\) \{\n  return __hanmarkHayroWasmBytes\(\);\n\}/u);
    }
    assert.equal(loaders, 1);
    assert.throws(
      () => hardenKordocWasmSource('const url = new URL("./hayro-pdf.wasm", import.meta.url);'),
      /still resolves hayro-pdf\.wasm/u
    );
  });

  it("keeps the bundle free of wasm files, network calls, dynamic imports, and browser base64", () => {
    assert.doesNotMatch(bundle.text, /hayro-pdf\.wasm/u);
    assert.doesNotMatch(bundle.text, /(?<![\w$.])fetch\s*\(/u);
    assert.doesNotMatch(bundle.text, /\bimport\s*\(/u);
    assert.doesNotMatch(bundle.text, /\bcreateRequire\b/u);
    assert.doesNotMatch(bundle.text, /(?<![\w$.])(?:atob|btoa)\s*\(/u);
    assert.doesNotMatch(bundle.text, /child_process|powershell|HWPFrame|Hwp\.Application/iu);
    assert.doesNotMatch(bundle.text, /require\(["'](?:node:)?fs(?:\/promises)?["']\)/u);
  });

  it("reads a PDF whose text needs the Korean KSCms-UHC-H CMap, with no CMap files", async () => {
    const parsed = await bundle.runtime.parseBytes(new Uint8Array(makeKoreanCMapPdf()));
    assert.equal(parsed.success, true, parsed.error);
    assert.equal(parsed.fileType, "pdf");
    assert.match(parsed.markdown ?? "", /한글 PDF/u);
  });

  it("generates, validates, re-reads, and renders HWPX in memory (quick-xml wasm included)", async () => {
    const hwpx = await bundle.runtime.roundTripHwpx(
      "# HanMark 엔진 이식\n\n본문과 **굵은 글씨**입니다.\n\n| 항목 | 값 |\n| --- | --- |\n| 가 | 1 |\n"
    );
    assert.ok(hwpx.byteLength > 1_000);
    assert.equal(hwpx.validation.ok, true);
    assert.equal(hwpx.reparsed.success, true, hwpx.reparsed.error);
    assert.match(hwpx.reparsed.markdown ?? "", /HanMark 엔진 이식/u);
    assert.match(hwpx.reparsed.markdown ?? "", /굵은 글씨/u);
    assert.ok(hwpx.svgPages >= 1);
    assert.match(hwpx.firstSvg, /<svg[\s>]/u);
    assert.match(hwpx.firstSvg, /HanMark/u);
  });

  it("never runs OCR for an image file, even when the caller leaves ocr unset", async () => {
    for (const options of [undefined, { ocr: false }, { ocr: true }]) {
      const parsed = await bundle.runtime.parseBytes(makePng(), options);
      assert.equal(parsed.success, false, JSON.stringify(options));
      assert.doesNotMatch(parsed.markdown ?? "", /\S/u);
    }
  });

  it("made no network request in any of the above", () => {
    assert.equal(networkCalls, 0);
  });
});
