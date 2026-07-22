import { readFile } from "node:fs/promises";

const bundle = await readFile(new URL("../main.js", import.meta.url), "utf8");
const entry = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const exportTypes = await readFile(new URL("../src/io/exportTypes.ts", import.meta.url), "utf8");
const forbiddenNativeModules = [
  "sharp",
  "onnxruntime-node",
  "@huggingface/transformers",
  "@hyzyla/pdfium",
  "puppeteer-core",
  "@modelcontextprotocol/sdk",
  "canvas"
];

const escaped = forbiddenNativeModules.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const staticRequire = new RegExp(`require\\(["'](?:${escaped.join("|")})["']\\)`, "g");
const forbiddenHits = bundle.match(staticRequire) ?? [];

if (forbiddenHits.length > 0) {
  throw new Error(`Optional OCR/native modules leaked into the startup bundle: ${forbiddenHits.join(", ")}`);
}

if (!bundle.includes("4.2.5")) {
  throw new Error("The production bundle does not contain the pinned Kordoc 4.2.5 implementation.");
}

const retiredReachableCalls = [
  "super.initializePlugin(",
  "ensureAdvancedEngine(",
  "runAdvancedExport(",
  "pandocBridge.convert("
].filter((needle) => entry.includes(needle));

if (retiredReachableCalls.length > 0) {
  throw new Error(`Retired Python HWPX runtime calls remain reachable from src/main.ts: ${retiredReachableCalls.join(", ")}`);
}

if (!entry.includes('exportManager.exportHwpx = () => this.openExportCenter("hwpx")')) {
  throw new Error("The legacy exportHwpx defense-in-depth redirect is missing.");
}

if (exportTypes.includes('"template-hwpx"')) {
  throw new Error("The retired pypandoc-hwpx export mode remains in the public export type.");
}

console.log("Bundle check passed: Kordoc 4.2.5 present; HWPX is hard-routed away from the legacy Python bridge; no static OCR/native module requires.");
