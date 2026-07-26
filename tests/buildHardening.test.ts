import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { parse } from "kordoc";

import {
  assertPdfJsClipboardHardening,
  blockedFileSystemPlugin,
  dependencySourceHardeningPlugin,
  findUnsafeRuntimeConstructs,
  hardenDocxPreviewSource,
  hardenKordocComFallbackSource,
  hardenKordocOptionalNativeSource,
  hardenKordocPdfParserSource,
  hardenPdfJsSource,
  hardenSetImmediateSource,
  injectKordocCfb,
  kordocSourceHardeningPlugin,
} from "../esbuild.config.mjs";

function makeMinimalPdf(text: string): ArrayBuffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  const bytes = Buffer.from(pdf, "ascii");
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

test("setImmediate hardening rejects strings and removes script scheduling", async () => {
  const fixtures = [
    {
      path: "node_modules/setimmediate/setImmediate.js",
      callback: 1,
      setImmediateReadyState: 1,
      probe: 1,
      immediateReadyState: 0,
    },
    {
      path: "node_modules/jszip/dist/jszip.js",
      callback: 1,
      setImmediateReadyState: 1,
      probe: 1,
      immediateReadyState: 1,
    },
    {
      path: "node_modules/immediate/lib/index.js",
      callback: 0,
      setImmediateReadyState: 0,
      probe: 0,
      immediateReadyState: 1,
    },
  ];

  for (const fixture of fixtures) {
    const source = await readFile(fixture.path, "utf8");
    const transformed = hardenSetImmediateSource(source);

    assert.equal(
      transformed.callbackReplacements,
      fixture.callback,
      fixture.path,
    );
    assert.equal(
      transformed.readyStateReplacements,
      fixture.setImmediateReadyState,
      fixture.path,
    );
    assert.equal(
      transformed.readyStateProbeReplacements,
      fixture.probe,
      fixture.path,
    );
    assert.equal(
      transformed.immediateReadyStateReplacements,
      fixture.immediateReadyState,
      fixture.path,
    );
    if (fixture.callback > 0) {
      assert.match(
        transformed.source,
        /throw new TypeError\("setImmediate callback must be a function"\)/u,
      );
    }
    assert.deepEqual(findUnsafeRuntimeConstructs(transformed.source), []);
  }
});

test("docx-preview 0.4.0 hardening removes HTML string insertion and altChunks", async () => {
  for (const path of [
    "node_modules/docx-preview/dist/docx-preview.mjs",
    "node_modules/docx-preview/dist/docx-preview.js",
  ]) {
    const source = await readFile(path, "utf8");
    const transformed = hardenDocxPreviewSource(source);

    assert.equal(transformed.nbspReplacements, 1, path);
    assert.equal(transformed.altChunkReplacements, 1, path);
    assert.equal(transformed.altChunkDefaultReplacements, 1, path);
    assert.equal(transformed.styleClearReplacements, 1, path);
    assert.equal(transformed.bodyClearReplacements, 1, path);
    assert.match(
      transformed.source,
      /elem\.textContent = "\u00a0";/u,
      path,
    );
    assert.match(
      transformed.source,
      /renderAltChunk\(\) \{\r?\n[ \t]*return null;\r?\n[ \t]*\}/u,
      path,
    );
    assert.match(
      transformed.source,
      /styleContainer\.replaceChildren\(\);/u,
      path,
    );
    assert.match(
      transformed.source,
      /bodyContainer\.replaceChildren\(\);/u,
      path,
    );
    assert.doesNotMatch(
      transformed.source,
      /\.innerHTML\b|\.srcdoc\b|renderAltChunks\s*:\s*true/u,
      path,
    );
    assert.deepEqual(findUnsafeRuntimeConstructs(transformed.source), []);
  }
});

test("docx-preview hardening fails closed when the pinned source shape changes", async () => {
  const source = await readFile(
    "node_modules/docx-preview/dist/docx-preview.mjs",
    "utf8",
  );
  const changed = source.replace(
    'styleContainer.innerHTML = "";',
    "styleContainer.replaceChildren();",
  );

  assert.throws(
    () => hardenDocxPreviewSource(changed),
    /docx-preview 0\.4\.0 hardening mismatch/u,
  );
});

test("PDF.js hardening forces its PostScript interpreter fallback", async () => {
  const pdf = await readFile(
    "node_modules/pdfjs-dist/legacy/build/pdf.mjs",
    "utf8",
  );
  const worker = await readFile(
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    "utf8",
  );

  const hardenedPdf = hardenPdfJsSource(pdf);
  const hardenedWorker = hardenPdfJsSource(worker);

  assertPdfJsClipboardHardening(
    "node_modules/pdfjs-dist/legacy/build/pdf.mjs",
    hardenedPdf,
  );
  assertPdfJsClipboardHardening(
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    hardenedWorker,
  );
  assert.equal(hardenedPdf.clipboardDataPathReplacements, 4);
  assert.equal(hardenedPdf.clipboardListenerReplacements, 4);
  assert.equal(hardenedPdf.clipboardCopyMethodReplacements, 1);
  assert.equal(hardenedPdf.clipboardCutMethodReplacements, 1);
  assert.equal(hardenedPdf.clipboardPasteMethodReplacements, 1);
  assert.equal(hardenedPdf.clipboardFreeTextPasteMethodReplacements, 1);
  assert.equal(hardenedWorker.clipboardDataPathReplacements, 0);
  assert.equal(hardenedWorker.clipboardListenerReplacements, 0);
  assert.equal(hardenedWorker.clipboardCopyMethodReplacements, 0);
  assert.equal(hardenedWorker.clipboardCutMethodReplacements, 0);
  assert.equal(hardenedWorker.clipboardPasteMethodReplacements, 0);
  assert.equal(hardenedWorker.clipboardFreeTextPasteMethodReplacements, 0);
  assert.equal(hardenedPdf.evalProbeReplacements, 1);
  assert.equal(hardenedWorker.evalProbeReplacements, 1);
  assert.equal(hardenedWorker.postScriptReplacements, 1);
  assert.equal(hardenedPdf.dynamicRequireReplacements, 1);
  assert.equal(hardenedWorker.dynamicRequireReplacements, 1);
  assert.equal(hardenedPdf.globalThisFallbackReplacements, 1);
  assert.equal(hardenedWorker.globalThisFallbackReplacements, 1);
  assert.ok(hardenedPdf.nodeFileSystemReplacements > 0);
  assert.equal(hardenedWorker.nodeFileSystemReplacements, 0);
  assert.equal(hardenedPdf.nodeCanvasBootstrapReplacements, 1);
  assert.equal(hardenedWorker.nodeCanvasBootstrapReplacements, 0);
  assert.equal(hardenedPdf.nodeCanvasFactoryReplacements, 1);
  assert.equal(hardenedWorker.nodeCanvasFactoryReplacements, 0);
  assert.equal(hardenedPdf.workerCdnWrapperReplacements, 1);
  assert.equal(hardenedWorker.workerCdnWrapperReplacements, 0);
  assert.equal(hardenedPdf.fakeWorkerDynamicImportReplacements, 1);
  assert.equal(hardenedWorker.fakeWorkerDynamicImportReplacements, 0);
  assert.ok(hardenedPdf.atobReplacements > 0);
  assert.ok(hardenedPdf.btoaReplacements > 0);
  assert.ok(hardenedWorker.atobReplacements > 0);
  assert.ok(hardenedWorker.btoaReplacements > 0);
  assert.match(
    hardenedWorker.source,
    /const evaluator = new PostScriptEvaluator\(code\)/u,
  );
  assert.doesNotMatch(
    hardenedWorker.source,
    /new PostScriptCompiler\(\)\.compile\(code, domain, range\)/u,
  );
  assert.doesNotMatch(
    hardenedPdf.source,
    /process\.getBuiltinModule\(\s*["']fs["']\s*\)/u,
  );
  assert.doesNotMatch(hardenedPdf.source, /@napi-rs\/canvas/u);
  assert.doesNotMatch(hardenedPdf.source, /\bcreateRequire\b/u);
  assert.doesNotMatch(hardenedPdf.source, /\bimport\s*\(/u);
  assert.doesNotMatch(hardenedPdf.source, /\bclipboardData\b/u);
  assert.doesNotMatch(
    hardenedPdf.source,
    /\.addEventListener\(\s*["'](?:copy|cut|paste)["']/u,
  );
  assert.match(hardenedPdf.source, /  copy\(\) \{\r?\n  \}/u);
  assert.match(hardenedPdf.source, /  cut\(\) \{\r?\n  \}/u);
  assert.match(hardenedPdf.source, /  async paste\(\) \{\r?\n  \}/u);
  assert.match(hardenedPdf.source, /  editorDivPaste\(\) \{\r?\n  \}/u);
  assert.match(
    hardenedPdf.source,
    /globalThis\.document\?\.createElement\("canvas"\)/u,
  );
  assert.deepEqual(findUnsafeRuntimeConstructs(hardenedPdf.source), []);
  assert.deepEqual(findUnsafeRuntimeConstructs(hardenedWorker.source), []);
});

test("PDF.js clipboard hardening fails closed when the pinned source shape changes", async () => {
  const pdf = await readFile(
    "node_modules/pdfjs-dist/legacy/build/pdf.mjs",
    "utf8",
  );
  const changed = pdf.replace(
    'clipboardData.getData("application/pdfjs")',
    'clipboardData.getData("application/x-pdfjs")',
  );

  assert.throws(
    () =>
      assertPdfJsClipboardHardening(
        "node_modules/pdfjs-dist/legacy/build/pdf.mjs",
        hardenPdfJsSource(changed),
      ),
    /PDF\.js 4\.10\.38 clipboard hardening mismatch/u,
  );
});

test("Kordoc 4.2.5 CFB runtime requires are converted to a bundled import", async () => {
  const directory = "node_modules/kordoc/dist";
  const files = (await readdir(directory))
    .filter((name) => /\.(?:c?js|mjs)$/u.test(name))
    .map((name) => join(directory, name));

  let replacements = 0;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const transformed = injectKordocCfb(source);
    replacements += transformed.replacements;
    if (transformed.replacements > 0) {
      assert.match(
        transformed.source,
        /^import \* as __kordoc_cfb from "cfb";/u,
      );
      assert.doesNotMatch(
        transformed.source,
        /\brequire\d*\(\s*["']cfb["']\s*\)/u,
      );
      assert.doesNotMatch(transformed.source, /\bcreateRequire\b/u);
    }
  }

  assert.ok(
    replacements >= 2,
    `expected at least two CFB replacements, got ${replacements}`,
  );
});

test("Kordoc 4.2.5 strips the unreachable Windows COM fallback exactly", async () => {
  const directory = "node_modules/kordoc/dist";
  const files = (await readdir(directory))
    .filter((name) => /\.(?:js|mjs)$/u.test(name))
    .map((name) => join(directory, name));

  let hardenedSources = 0;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const transformed = hardenKordocComFallbackSource(source);
    if (transformed.helperReplacements === 0) {
      continue;
    }
    hardenedSources += 1;
    assert.equal(transformed.helperReplacements, 1, file);
    assert.equal(transformed.encryptedHwpxBranchReplacements, 1, file);
    assert.equal(transformed.distributionHwpBranchReplacements, 1, file);
    assert.equal(
      transformed.source.match(/^\/\/ src\//gmu)?.length,
      (source.match(/^\/\/ src\//gmu)?.length ?? 0) - 1,
      `${file} must remove only the COM source module`,
    );
    assert.doesNotMatch(
      transformed.source,
      /\b(?:execFileSync|isComFallbackAvailable|extractTextViaCom|comResultToParseResult)\b|["'](?:node:)?child_process["']|HWPFrame\.HwpObject/u,
      file,
    );
    assert.match(
      transformed.source,
      /async function parseHwpxDocument\(buffer, options\)/u,
      file,
    );
    assert.match(
      transformed.source,
      /function isEncryptedHwpx\(manifestXml\) \{\r?\n  return manifestXml\.includes\("encryption-data"\);\r?\n\}/u,
      `${file} must preserve encrypted-package detection`,
    );
    assert.match(
      transformed.source,
      /function parseHwp5Document\(buffer, options\)/u,
      file,
    );
  }

  assert.equal(
    hardenedSources,
    2,
    `expected both pinned Kordoc distributions to contain the COM fallback, got ${hardenedSources}`,
  );
});

test("Kordoc optional native loaders are replaced without removing document parsers", async () => {
  const directory = "node_modules/kordoc/dist";
  const files = (await readdir(directory))
    .filter((name) => /\.(?:c?js|mjs)$/u.test(name))
    .map((name) => join(directory, name));
  const optionalSpecifier =
    /(?:\bimport\s*\(|\brequire\d*\s*\()\s*["'](?:onnxruntime-node|sharp|@huggingface\/transformers|@hyzyla\/pdfium)["']\s*\)/u;

  let replacements = 0;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const transformed = hardenKordocOptionalNativeSource(source);
    replacements +=
      transformed.cjsImportReplacements +
      transformed.dynamicImportReplacements +
      transformed.runtimeRequireReplacements;
    assert.doesNotMatch(transformed.source, optionalSpecifier, file);
  }

  assert.ok(
    replacements >= 10,
    `expected Kordoc optional native loaders to be neutralized, got ${replacements}`,
  );
});

test("Kordoc PDF parser keeps byte parsing without createRequire asset lookup", async () => {
  const parser = await readFile(
    "node_modules/kordoc/dist/parser-FDOR727T.js",
    "utf8",
  );
  const transformed = hardenKordocPdfParserSource(parser);

  assert.equal(transformed.assetLookupReplacements, 1);
  assert.equal(transformed.createRequireImportReplacements, 1);
  assert.match(transformed.source, /data: new Uint8Array\(buffer\)/u);
  assert.doesNotMatch(transformed.source, /\bcreateRequire\b/u);
  assert.doesNotMatch(transformed.source, /pdfjs-dist\/package\.json/u);
});

test("Kordoc still extracts text from an in-memory PDF", async () => {
  const parsed = await parse(makeMinimalPdf("HanMark PDF smoke"));
  assert.equal(parsed.success, true);
  if (!parsed.success) {
    assert.fail(parsed.error);
  }
  assert.equal(parsed.fileType, "pdf");
  assert.match(parsed.markdown, /HanMark PDF smoke/u);
});

test("the production-hardened Kordoc bundle still extracts an in-memory PDF", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hanmark-hardened-kordoc-"));
  const outputPath = join(directory, "smoke.cjs");
  try {
    const result = await build({
      stdin: {
        contents:
          'import { markdownToHwpx, parse, validateHwpx } from "kordoc";\n' +
          "export async function parsePdf(bytes) {\n" +
          "  const copy = new Uint8Array(bytes);\n" +
          "  return parse(copy.buffer);\n" +
          "}\n" +
          "export async function roundTripHwpx(markdown) {\n" +
          "  const generated = await markdownToHwpx(markdown);\n" +
          "  const validation = await validateHwpx(generated);\n" +
          "  const reparsed = await parse(generated);\n" +
          "  return { byteLength: generated.byteLength, validation, reparsed };\n" +
          "}\n",
        resolveDir: process.cwd(),
        sourcefile: "hardened-kordoc-smoke.ts",
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "es2018",
      write: false,
      define: {
        "import.meta.url": "__hwpImportMetaUrl",
      },
      banner: {
        js:
          "const __hwpImportMetaUrl = require('url').pathToFileURL(__filename).href;\n" +
          "const __hanmarkRequireBuiltin = (name) => require(name);\n" +
          "const __hanmarkBlockedFileSystem = { promises: { readFile: async () => { throw new Error('Filesystem PDF loading is disabled; HanMark supplies PDF bytes directly.'); } } };\n" +
          "const __hanmarkDecodeBase64 = (value) => Buffer.from(value, 'base64').toString('latin1');\n" +
          "const __hanmarkEncodeBase64 = (value) => Buffer.from(value, 'latin1').toString('base64');",
      },
      plugins: [
        blockedFileSystemPlugin,
        kordocSourceHardeningPlugin,
        dependencySourceHardeningPlugin,
      ],
    });
    const output = result.outputFiles[0];
    assert.ok(output, "esbuild must produce the hardened smoke bundle");
    await writeFile(outputPath, output.contents);
    const load = createRequire(import.meta.url);
    const runtime = load(outputPath) as {
      parsePdf(bytes: Uint8Array): Promise<{
        success: boolean;
        fileType?: string;
        markdown?: string;
        error?: string;
      }>;
      roundTripHwpx(markdown: string): Promise<{
        byteLength: number;
        validation: { ok: boolean };
        reparsed: {
          success: boolean;
          markdown?: string;
          error?: string;
        };
      }>;
    };
    const parsed = await runtime.parsePdf(
      new Uint8Array(makeMinimalPdf("HanMark hardened PDF smoke")),
    );
    assert.equal(parsed.success, true, parsed.error);
    assert.equal(parsed.fileType, "pdf");
    assert.match(parsed.markdown ?? "", /HanMark hardened PDF smoke/u);

    const hwpx = await runtime.roundTripHwpx(
      "# HanMark 하드닝 HWPX\n\n본문과 **굵은 글씨**입니다.\n",
    );
    assert.ok(hwpx.byteLength > 1_000);
    assert.equal(hwpx.validation.ok, true);
    assert.equal(hwpx.reparsed.success, true, hwpx.reparsed.error);
    assert.match(hwpx.reparsed.markdown ?? "", /HanMark 하드닝 HWPX/u);
    assert.match(hwpx.reparsed.markdown ?? "", /본문과/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime scanner rejects dynamic imports and createRequire", () => {
  assert.deepEqual(
    findUnsafeRuntimeConstructs(
      'const load = () => import("native-addon"); const req = createRequire(url);',
    ),
    ["dynamic import", "createRequire"],
  );
  assert.deepEqual(
    findUnsafeRuntimeConstructs(
      'node.innerHTML = html; frame.srcdoc = html; const options = { renderAltChunks: true };',
    ),
    ["HTML string insertion", "DOCX altChunk rendering"],
  );
});
