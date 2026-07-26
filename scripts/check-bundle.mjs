import { readFile } from "node:fs/promises";

const bundle = await readFile(new URL("../main.js", import.meta.url), "utf8");
const entry = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const exportTypes = await readFile(new URL("../src/io/exportTypes.ts", import.meta.url), "utf8");
const maximumBundleBytes = 3_459_213;
const forbiddenNativeModules = [
  "sharp",
  "onnxruntime-node",
  "@huggingface/transformers",
  "@hyzyla/pdfium",
  "@napi-rs/canvas",
  "puppeteer-core",
  "@modelcontextprotocol/sdk",
  "canvas"
];

const escaped = forbiddenNativeModules.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const staticRequire = new RegExp(`require\\(["'](?:${escaped.join("|")})["']\\)`, "g");
const forbiddenHits = bundle.match(staticRequire) ?? [];
const optionalNativeLoader = new RegExp(
  `(?:\\bimport\\s*\\(|\\brequire\\d*\\s*\\()\\s*["'](?:${escaped.join("|")})["']\\s*\\)`,
  "g",
);
const optionalNativeLoaderHits = bundle.match(optionalNativeLoader) ?? [];
const forbiddenSpecificNames = [
  "onnxruntime-node",
  "@huggingface/transformers",
  "@hyzyla/pdfium",
  "@napi-rs/canvas",
].filter((name) => bundle.includes(name));
const dynamicCfbRequire =
  bundle.match(/\brequire\d*\(\s*["']cfb["']\s*\)/g) ?? [];
const unsafeRuntimePatterns = [
  ["dynamic Function constructor", /(?<![\w$.])(?:new\s+)?Function\s*\(/u],
  ["eval", /(?<![\w$.])eval\s*\(/u],
  ["dynamic import", /\bimport\s*\(/u],
  ["createRequire", /\bcreateRequire\b/u],
  ["Clipboard API", /\bnavigator\s*\.\s*clipboard\b|\bClipboardItem\b/u],
  ["bare atob/btoa", /(?<![\w$.])(?:atob|btoa)\s*\(/u],
  [
    "dynamic script element",
    /\bcreateElement\s*\(\s*["']script["']\s*\)/u,
  ],
];
const unsafeRuntimeHits = unsafeRuntimePatterns
  .filter(([, pattern]) => pattern.test(bundle))
  .map(([name]) => name);

if (forbiddenHits.length > 0) {
  throw new Error(`Optional OCR/native modules leaked into the startup bundle: ${forbiddenHits.join(", ")}`);
}

if (optionalNativeLoaderHits.length > 0 || forbiddenSpecificNames.length > 0) {
  throw new Error(
    `Optional native loader/specifier remnants leaked into the startup bundle: ${[
      ...optionalNativeLoaderHits,
      ...forbiddenSpecificNames,
    ].join(", ")}`
  );
}

if (dynamicCfbRequire.length > 0) {
  throw new Error("Kordoc CFB remained a runtime dynamic require instead of being bundled.");
}

if (unsafeRuntimeHits.length > 0) {
  throw new Error(`Unsafe runtime constructs leaked into the production bundle: ${unsafeRuntimeHits.join(", ")}`);
}

if (!bundle.includes("4.2.5")) {
  throw new Error("The production bundle does not contain the pinned Kordoc 4.2.5 implementation.");
}

if (Buffer.byteLength(bundle, "utf8") > maximumBundleBytes) {
  throw new Error(
    `Production bundle exceeds the 2.4.2 baseline (${Buffer.byteLength(bundle, "utf8")} > ${maximumBundleBytes} bytes).`
  );
}

if (entry.includes("legacy-main.cjs") || bundle.includes("pypandoc-hwpx")) {
  throw new Error("The retired legacy/Python HWPX compatibility runtime remains in the production path.");
}

if (exportTypes.includes('"template-hwpx"')) {
  throw new Error("The retired pypandoc-hwpx export mode remains in the public export type.");
}

console.log(
  `Bundle check passed: ${Buffer.byteLength(bundle, "utf8")} bytes; Kordoc 4.2.5 present; no retired HWPX, dynamic loader, createRequire, or OCR/native module specifier.`
);
