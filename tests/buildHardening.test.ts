import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { parse } from "kordoc";

import {
  dependencySourceHardeningPlugin,
  findUnsafeRuntimeConstructs,
  hardenDocxPreviewSource,
  hardenKordocComFallbackSource,
  hardenKordocOptionalNativeSource,
  hardenKordocSource,
  hardenSetImmediateSource,
  injectKordocCfb,
  KORDOC_HARDENING_MANIFEST,
  assertKordocHardeningTally,
  assertKordocManifestVersion,
  emptyKordocHardeningTally,
  findMatchingBrace,
  removeKordocComBranches,
  removeKordocHancomEngineBranches,
  removeKordocOcrLoaders,
} from "../esbuild.config.mjs";
import { loadHardenedKordocBundle } from "./helpers/hardenedKordocBundle";

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

/**
 * The Kordoc dist files that end up in main.js: index.js and everything it
 * reaches through static and dynamic imports *after* hardening. Chunks that
 * hardening cuts off (OCR, the Hancom save module) are not part of the graph.
 */
async function hardenedKordocGraph(): Promise<Map<string, ReturnType<typeof hardenKordocSource>>> {
  const directory = "node_modules/kordoc/dist";
  const graph = new Map<string, ReturnType<typeof hardenKordocSource>>();
  const queue = ["index.js"];
  while (queue.length > 0) {
    const name = queue.shift() ?? "";
    if (graph.has(name)) continue;
    const hardened = hardenKordocSource(await readFile(join(directory, name), "utf8"));
    graph.set(name, hardened);
    for (const match of hardened.source.matchAll(/from "\.\/([^"]+)"|import\("\.\/([^"]+)"\)|^import "\.\/([^"]+)";/gmu)) {
      const next = match[1] ?? match[2] ?? match[3];
      if (next && !graph.has(next)) queue.push(next);
    }
  }
  return graph;
}

test("the Kordoc hardening manifest matches the installed engine", async () => {
  const installed = JSON.parse(
    await readFile("node_modules/kordoc/package.json", "utf8"),
  ) as { version: string };
  assert.equal(installed.version, KORDOC_HARDENING_MANIFEST.version);
  assert.equal(KORDOC_HARDENING_MANIFEST.version, "4.25.0");
  assert.doesNotThrow(() => assertKordocManifestVersion(installed.version));
  assert.throws(
    () => assertKordocManifestVersion("0.0.0"),
    /does not match the reviewed hardening manifest/u,
  );
});

test("every Kordoc transform count over the bundled graph equals the manifest", async () => {
  const tally = emptyKordocHardeningTally();
  for (const hardened of (await hardenedKordocGraph()).values()) {
    tally.loadedFiles += 1;
    for (const [key, value] of Object.entries(hardened.counts)) {
      (tally as Record<string, number>)[key] += value;
    }
  }
  const { loadedFiles, ...counts } = tally;
  const { version: _version, ...expected } = KORDOC_HARDENING_MANIFEST;
  assert.ok(loadedFiles > 20, `expected the library graph, saw ${loadedFiles} files`);
  assert.deepEqual(counts, expected);
  assert.doesNotThrow(() => assertKordocHardeningTally(tally));
});

test("Kordoc CFB runtime requires are converted to a bundled import", async () => {
  let replacements = 0;
  for (const [name] of await hardenedKordocGraph()) {
    const source = await readFile(join("node_modules/kordoc/dist", name), "utf8");
    const transformed = injectKordocCfb(source);
    replacements += transformed.replacements;
    if (transformed.replacements > 0) {
      assert.match(transformed.source, /^import \* as __kordoc_cfb from "cfb";/u);
      assert.doesNotMatch(transformed.source, /\brequire\d*\(\s*["']cfb["']\s*\)/u);
    }
  }
  assert.equal(replacements, KORDOC_HARDENING_MANIFEST.cfbLoaders);
});

const PROCESS_AUTOMATION =
  /\b(?:execFile(?:Sync|Async)?|isComFallbackAvailable|extractTextViaCom|comResultToParseResult|hwpToHwpxViaHancom|hancomAvailable)\b|["'](?:node:)?child_process["']|HWPFrame\.HwpObject|Hwp\.Application|powershell/iu;

test("Kordoc's Hancom Office automation is removed from every bundled module", async () => {
  const graph = await hardenedKordocGraph();
  let stubs = 0;
  let callSites = 0;
  let engineBranches = 0;
  for (const [name, hardened] of graph) {
    assert.doesNotMatch(hardened.source, PROCESS_AUTOMATION, name);
    assert.doesNotMatch(hardened.source, /import\("\.\/hancom-[A-Z0-9]+\.js"\)/u, name);
    assert.ok(!/^hancom-/u.test(name), "the Hancom save module must stay out of the graph");
    stubs += hardened.counts.comHelpers;
    callSites += hardened.counts.comBranches;
    engineBranches += hardened.counts.hancomBranches;
    if (hardened.counts.comHelpers === 1) {
      assert.match(
        hardened.source,
        /function isEncryptedHwpx\(manifestXml\) \{\r?\n  return manifestXml\.includes\("encryption-data"\);\r?\n\}/u,
        "encrypted-package detection must survive",
      );
      assert.match(hardened.source, /export \{\n  isEncryptedHwpx\n\};/u);
    }
    if (hardened.counts.comBranches > 0) {
      assert.match(hardened.source, /\bisEncryptedHwpx\b|\bparseHwp5Document\(/u, name);
    }
    if (hardened.counts.hancomBranches > 0) {
      assert.match(hardened.source, /throw new KordocError\("HanMark does not bundle Hancom Office automation\."\)/u);
      assert.match(hardened.source, /data: await hwpToHwpx\(bytes, options\)/u, "the built-in converter must remain");
    }
  }
  assert.equal(stubs, 1);
  assert.equal(callSites, 2);
  assert.equal(engineBranches, 1);
  const joined = [...graph.values()].map((hardened) => hardened.source).join("\n");
  assert.match(joined, /async function parseHwpxDocument\(buffer, options\)/u);
  assert.match(joined, /await decryptHwpxInPlace\(zip, manifestXml, options\.password\)/u, "password decryption stays");
});

test("COM hardening fails closed when Kordoc changes shape", async () => {
  const dist = "node_modules/kordoc/dist";
  const names = await readdir(dist);
  let helper = "";
  let hancom = "";
  for (const name of names) {
    if (!/\.js$/u.test(name)) continue;
    const source = await readFile(join(dist, name), "utf8");
    if (source.startsWith("// src/hwpx/com-fallback.ts")) helper = source;
    if (source.includes("// src/hwp5/to-hwpx/hancom.ts")) hancom = source;
  }
  assert.ok(helper, "the com-fallback module exists in Kordoc 4.25.0");
  assert.ok(hancom, "the Hancom save module exists in Kordoc 4.25.0");
  // A second source module in the helper chunk, or a renamed process import, stops the build.
  assert.throws(
    () => hardenKordocComFallbackSource(`${helper}\n// src/other.ts\nexport const x = 1;\n`),
    /unsupported module format/u,
  );
  assert.throws(
    () => hardenKordocComFallbackSource(helper.replace('import { execFile } from "child_process";', 'import { spawn } from "child_process";')),
    /unsupported module format/u,
  );
  // A call site left behind (guard reworded) is caught by the residue scan.
  assert.throws(
    () =>
      hardenKordocComFallbackSource(
        'import {\n  isComFallbackAvailable\n} from "./chunk-ABC123.js";\nif (isComFallbackAvailable(options)) {\n  run();\n}\n',
      ),
    /COM hardening mismatch|remained after source hardening/u,
  );
  // The Hancom save module is replaced by an empty module and counted, so the tally rejects it.
  const stub = hardenKordocComFallbackSource(hancom);
  assert.equal(stub.hancomModuleLoads, 1);
  assert.doesNotMatch(stub.source, PROCESS_AUTOMATION);
  const tally = emptyKordocHardeningTally();
  tally.loadedFiles = 1;
  Object.assign(tally, { ...KORDOC_HARDENING_MANIFEST, version: undefined, hancomModules: 1 });
  assert.throws(() => assertKordocHardeningTally(tally), /differ from the manifest/u);
});

test("COM branch removal matches braces across strings, templates, and comments", () => {
  const source = [
    "function run(options) {",
    "  if (ready() && isComFallbackAvailable(options) && options?.filePath) {",
    '    const note = "} not a brace";',
    "    const tpl = `${{ a: 1 }.a} }`;",
    "    // } comment brace",
    "    return 1;",
    "  }",
    "  return 2;",
    "}",
  ].join("\n");
  const removed = removeKordocComBranches(source);
  assert.equal(removed.replacements, 1);
  assert.equal(removed.source, ["function run(options) {", "  return 2;", "}"].join("\n"));
  assert.equal(removeKordocComBranches(source.replace("(options) &&", "() &&")).replacements, 1);
  assert.equal(findMatchingBrace("{ '{' }", 0), 6);
  assert.throws(
    () => removeKordocComBranches("x = y; if (isComFallbackAvailable() && options?.filePath) { z(); } w();"),
    /standalone if statement|shares its closing line/u,
  );
});

test("the Hancom engine branch is replaced only where it loads the Hancom module", () => {
  const source = [
    "async function convert(options) {",
    '  const engine = options?.engine ?? "kordoc";',
    '  if (engine !== "kordoc") {',
    '    const { run } = await import("./hancom-ABC123.js");',
    "    return run();",
    "  }",
    '  if (engine !== "kordoc") {',
    "    log();",
    "  }",
    "  return builtIn();",
    "}",
  ].join("\n");
  const removed = removeKordocHancomEngineBranches(source);
  assert.equal(removed.replacements, 1);
  assert.doesNotMatch(removed.source, /hancom-ABC123/u);
  assert.match(removed.source, /throw new KordocError\("HanMark does not bundle Hancom Office automation\."\);/u);
  assert.match(removed.source, /log\(\);/u, "an unrelated branch with the same guard is kept");
});

test("the hardening tally rejects any drift from the manifest", () => {
  const tally = emptyKordocHardeningTally();
  assert.doesNotThrow(() => assertKordocHardeningTally(tally), "no Kordoc files loaded");
  tally.loadedFiles = 3;
  const { version: _version, ...expected } = KORDOC_HARDENING_MANIFEST;
  Object.assign(tally, expected);
  assert.doesNotThrow(() => assertKordocHardeningTally(tally));
  for (const key of Object.keys(expected)) {
    const drifted = { ...tally, [key]: (tally as Record<string, number>)[key] + 1 };
    assert.throws(() => assertKordocHardeningTally(drifted), /differ from the manifest/u, key);
  }
});

const OPTIONAL_SIDE_MODULES = [
  "onnxruntime-node",
  "sharp",
  "@huggingface/tokenizers",
  "@hyzyla/pdfium",
  "@rhwp/core",
  "zxing-wasm/reader",
  "libheif-js/libheif-wasm/libheif-bundle.js",
  "puppeteer-core",
];

test("Kordoc optional native and wasm side modules are unreachable and name-free", async () => {
  const directory = "node_modules/kordoc/dist";
  const files = (await readdir(directory)).filter((name) => /\.(?:c?js|mjs)$/u.test(name));
  const escaped = OPTIONAL_SIDE_MODULES.map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
  const loader = new RegExp(`(?:\\bimport\\s*\\(|\\brequire\\d*\\s*\\()\\s*["'](?:${escaped})["']\\s*\\)`, "u");
  const quotedName = new RegExp(`(["'])(?:${escaped})\\1`, "u");

  let replacements = 0;
  const seen = new Set<string>();
  for (const name of files) {
    const source = await readFile(join(directory, name), "utf8");
    for (const module of OPTIONAL_SIDE_MODULES) {
      if (new RegExp(`import\\(\\s*["']${module.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}["']\\s*\\)`, "u").test(source)) {
        seen.add(module);
      }
    }
    const transformed = hardenKordocOptionalNativeSource(source);
    replacements +=
      transformed.cjsImportReplacements +
      transformed.dynamicImportReplacements +
      transformed.runtimeRequireReplacements;
    assert.doesNotMatch(transformed.source, loader, name);
    assert.doesNotMatch(transformed.source, quotedName, name);
  }
  assert.deepEqual([...seen].sort(), [...OPTIONAL_SIDE_MODULES].sort(), "every listed module is really loaded by Kordoc 4.25.0");
  assert.ok(replacements >= 10, `expected the optional loaders to be neutralized, got ${replacements}`);

  // The name inside an ordinary quoted message must be rewritten without breaking the string.
  const message = hardenKordocOptionalNativeSource(
    "const why = \" optional dependency 'sharp' is missing\"; const other = 'needs \"sharp\" too';",
  );
  assert.equal(
    message.source,
    "const why = \" optional dependency 'hanmark-disabled-native-addon' is missing\"; const other = 'needs \"hanmark-disabled-native-addon\" too';",
  );
  for (const [name, hardened] of await hardenedKordocGraph()) {
    await assert.doesNotReject(
      build({ stdin: { contents: hardened.source, loader: "js" }, write: false, bundle: false, logLevel: "silent" }),
      `${name} must still parse after hardening`,
    );
  }
});

test("OCR chunks, their model downloader, and wasm asset lookups never enter the bundle", async () => {
  const graph = await hardenedKordocGraph();
  for (const [name, hardened] of graph) {
    assert.ok(!/^(?:image-ocr|formula|pdf-ocr)-/u.test(name), `${name} must be cut off`);
    assert.doesNotMatch(hardened.source, /import\("\.\/(?:image-ocr|formula|pdf-ocr)-/u, name);
    assert.doesNotMatch(hardened.source, /createRequire\d*\(import\.meta\.url\)\.resolve\(/u, name);
    assert.doesNotMatch(hardened.source, /(?<![\w$.])atob\s*\(/u, name);
  }
  const removed = removeKordocOcrLoaders(
    'const a = await import("./image-ocr-ABC123.js"); const b = await import("./page-range-ABC123.js");',
  );
  assert.equal(removed.replacements, 1);
  assert.match(removed.source, /Promise\.reject\(new Error\("HanMark does not bundle OCR\."\)\)/u);
  assert.match(removed.source, /import\("\.\/page-range-ABC123\.js"\)/u);
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
  const bundle = await loadHardenedKordocBundle<{
    parsePdf(bytes: Uint8Array): Promise<{
      success: boolean;
      fileType?: string;
      markdown?: string;
      error?: string;
    }>;
    roundTripHwpx(markdown: string): Promise<{
      byteLength: number;
      validation: { ok: boolean };
      reparsed: { success: boolean; markdown?: string; error?: string };
    }>;
  }>(
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
  );
  try {
    assert.deepEqual(findUnsafeRuntimeConstructs(bundle.text), []);
    const parsed = await bundle.runtime.parsePdf(
      new Uint8Array(makeMinimalPdf("HanMark hardened PDF smoke")),
    );
    assert.equal(parsed.success, true, parsed.error);
    assert.equal(parsed.fileType, "pdf");
    assert.match(parsed.markdown ?? "", /HanMark hardened PDF smoke/u);

    const hwpx = await bundle.runtime.roundTripHwpx(
      "# HanMark 하드닝 HWPX\n\n본문과 **굵은 글씨**입니다.\n",
    );
    assert.ok(hwpx.byteLength > 1_000);
    assert.equal(hwpx.validation.ok, true);
    assert.equal(hwpx.reparsed.success, true, hwpx.reparsed.error);
    assert.match(hwpx.reparsed.markdown ?? "", /HanMark 하드닝 HWPX/u);
    assert.match(hwpx.reparsed.markdown ?? "", /본문과/u);
  } finally {
    await bundle.dispose();
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
