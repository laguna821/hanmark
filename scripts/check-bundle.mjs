import { readFile } from "node:fs/promises";

const bundle = await readFile(new URL("../main.js", import.meta.url), "utf8");
const entry = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const exportTypes = await readFile(new URL("../src/io/exportTypes.ts", import.meta.url), "utf8");
const docxPreviewView = await readFile(
  new URL("../src/ui/DocxPreviewView.ts", import.meta.url),
  "utf8"
);
const packageManifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);
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
  [
    "clipboard event access",
    /\bclipboardData\b|\.addEventListener\(\s*["'](?:copy|cut|paste)["']/u,
  ],
  ["bare atob/btoa", /(?<![\w$.])(?:atob|btoa)\s*\(/u],
  [
    "dynamic script element",
    /\bcreateElement\s*\(\s*["']script["']\s*\)/u,
  ],
  ["HTML string insertion", /\.innerHTML\b|\.srcdoc\b/u],
  ["DOCX altChunk rendering", /renderAltChunks\s*:\s*true/u],
];
const unsafeRuntimeHits = unsafeRuntimePatterns
  .filter(([, pattern]) => pattern.test(bundle))
  .map(([name]) => name);
const unintendedComRuntime = [
  ...bundle.matchAll(
    /require\(\s*["']child_process["']\s*\)|\bexecFileSync\b|HWPFrame\.HwpObject/gu,
  ),
].map((match) => match[0]);
const intentionalChildProcessBoundaries =
  bundle.match(/require\(\s*["']node:child_process["']\s*\)/gu) ?? [];

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

if (
  unintendedComRuntime.length > 0 ||
  intentionalChildProcessBoundaries.length !== 1
) {
  throw new Error(
    `Kordoc COM process execution leaked into the bundle or the user-process boundary changed: ${[
      ...unintendedComRuntime,
      `intentional boundaries=${intentionalChildProcessBoundaries.length}`,
    ].join(", ")}`
  );
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

if (packageManifest.dependencies?.["docx-preview"] !== "0.4.0") {
  throw new Error("The DOCX package renderer must remain pinned to docx-preview 0.4.0.");
}

if (packageManifest.dependencies?.["pdfjs-dist"] !== "4.10.38") {
  throw new Error("PDF.js source hardening requires the exact pdfjs-dist 4.10.38 source.");
}

if (
  !bundle.includes("docx-preview <https://github.com/VolodymyrBaydalka/docxjs>") ||
  !bundle.includes("Released under Apache License 2.0")
) {
  throw new Error("The bundled docx-preview Apache-2.0 attribution was removed.");
}

const docxBuilderReferences =
  docxPreviewView.match(/\.buildDocxBytesUserInitiated\s*\(/g) ?? [];
if (
  docxBuilderReferences.length !== 1 ||
  !docxPreviewView.includes("new UserInitiatedDocxPackagePreview")
) {
  throw new Error(
    "DOCX preview generation must remain behind the user-initiated runtime gate."
  );
}

if (!bundle.includes("A user-initiated DOCX preview request is required.")) {
  throw new Error("The user-initiated DOCX preview runtime gate was removed from the bundle.");
}

console.log(
  `Bundle check passed: ${Buffer.byteLength(bundle, "utf8")} bytes; Kordoc 4.2.5 and guarded DOCX package preview present; PDF.js clipboard and Kordoc COM fallbacks removed; only the user-initiated process boundary remains.`
);
