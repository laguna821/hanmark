import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";
import { promises as fsp } from "node:fs";
import { createHash } from "node:crypto";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";

const prod = process.argv[2] === "production";
const outputFile = "main.js";

const external = [
  "obsidian",
  "electron",
  "@electron/remote",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
  // Kordoc optional OCR, ML, printing, and MCP integrations are not part of
  // HanMark's runtime. Kordoc 4.25.0 reads PDFs with its own wasm engine
  // (hayro), so PDF.js is no longer part of the bundle.
  "puppeteer-core",
  "@modelcontextprotocol/sdk",
  "onnxruntime-node",
  "sharp",
  "@huggingface/transformers",
  "@hyzyla/pdfium",
  "@rhwp/core",
  "zxing-wasm/reader",
  "libheif-js/libheif-wasm/libheif-bundle.js",
  "@huggingface/tokenizers",
  "@napi-rs/canvas",
  "canvas",
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

const CFB_DYNAMIC_REQUIRE = /\b(require\d*)\(\s*["']cfb["']\s*\)/g;
// Optional side modules Kordoc loads lazily for OCR, formula OCR, image
// re-encoding, QR codes, HEIC, HWP 5 saving, and printing. HanMark ships none
// of them: every loader is replaced with a rejection and the names are erased.
const OPTIONAL_NATIVE_MODULES = [
  "onnxruntime-node",
  "sharp",
  "@huggingface/transformers",
  "@huggingface/tokenizers",
  "@hyzyla/pdfium",
  "@rhwp/core",
  "zxing-wasm/reader",
  "libheif-js/libheif-wasm/libheif-bundle.js",
  "puppeteer-core",
];
const OPTIONAL_NATIVE_ALTERNATION = OPTIONAL_NATIVE_MODULES
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const OPTIONAL_NATIVE_CJS_IMPORT = new RegExp(
  `Promise\\.resolve\\(\\)\\.then\\(\\(\\)\\s*=>\\s*_interopRequireWildcard\\(require\\(\\s*["'](?:${OPTIONAL_NATIVE_ALTERNATION})["']\\s*\\)\\)\\)`,
  "g",
);
const OPTIONAL_NATIVE_DYNAMIC_IMPORT = new RegExp(
  `\\bimport\\(\\s*["'](?:${OPTIONAL_NATIVE_ALTERNATION})["']\\s*\\)`,
  "g",
);
const OPTIONAL_NATIVE_REQUIRE = new RegExp(
  `\\brequire\\d*\\(\\s*["'](?:${OPTIONAL_NATIVE_ALTERNATION})["']\\s*\\)`,
  "g",
);
const OPTIONAL_NATIVE_STRING = new RegExp(
  `(["'])(?:${OPTIONAL_NATIVE_ALTERNATION})\\1`,
  "g",
);
// Kordoc 4.25.0 reads PDF text through hayro (Rust, wasm). Its loader resolves
// dist/hayro-pdf.wasm next to the module and reads it from disk (Node) or
// fetches it (browser). Neither exists inside main.js.
const KORDOC_HAYRO_WASM_LOADER =
  /async function wasmBytes\(\) \{\r?\n  const url = new URL\("\.\/hayro-pdf\.wasm", import\.meta\.url\);\r?\n[\s\S]*?\r?\n\}\r?\n(?=function module\(\) \{)/g;
// Optional wasm side files (QR reader, HWP 5 writer) are resolved through
// createRequire and read from disk. Their modules are already unreachable.
const KORDOC_WASM_ASSET_LOOKUP =
  /\bawait readFile\d*\(\s*createRequire\d*\(import\.meta\.url\)\.resolve\(\s*["'][^"'\r\n]+\.wasm["']\s*\)\s*\)/g;
// The XML parser (quick-xml, wasm) is inline base64 decoded with the browser
// global atob; the bundle may only use Buffer.
const KORDOC_XML_WASM_DECODE =
  /Uint8Array\.from\(atob\(XML_FLAT_WASM\), \(c\) => c\.charCodeAt\(0\)\)/g;
// OCR, formula OCR, and image-file input live in lazily imported chunks that
// carry the model downloader (network) and the model cache (filesystem).
const KORDOC_OCR_CHUNK_IMPORT =
  /\bimport\("\.\/(?:image-ocr|formula|pdf-ocr)-[A-Z0-9]+\.js"\)/g;
const KORDOC_NODE_MODULE_IMPORT =
  /import\s*\{\s*createRequire\s*\}\s*from\s*["']node:module["'];?\r?\n/g;
const SET_IMMEDIATE_STRING_CALLBACK =
  /callback\s*=\s*new Function\(""\s*\+\s*callback\);/g;
const SET_IMMEDIATE_READY_STATE =
  /^    function installReadyStateChangeImplementation\(\) \{[\s\S]*?^    \}/gm;
const SET_IMMEDIATE_READY_STATE_PROBE =
  /doc && "onreadystatechange" in doc\.createElement\("script"\)/g;
const IMMEDIATE_READY_STATE_BRANCH =
  /  \} else if \('document' in global && 'onreadystatechange' in global\.document\.createElement\('script'\)\) \{[\s\S]*?^  \} else \{/gm;
const KORDOC_COM_MODULE_MARKER = "// src/hwpx/com-fallback.ts";
const KORDOC_HANCOM_MODULE_MARKER = "// src/hwp5/to-hwpx/hancom.ts";
const KORDOC_ENCRYPTED_HWPX_HELPER =
  /function isEncryptedHwpx\(manifestXml\) \{\r?\n  return manifestXml\.includes\("encryption-data"\);\r?\n\}/;
// Every COM call site is guarded by this condition. Branches are removed by
// brace matching rather than by the text around them, so a Kordoc refactor of
// neighbouring code cannot silently leave a branch behind.
const KORDOC_COM_BRANCH_GUARD =
  /isComFallbackAvailable\((?:options)?\) && options\?\.filePath\) \{/g;
const KORDOC_COM_IMPORT =
  /import \{([^{}]*\bisComFallbackAvailable\b[^{}]*)\} from ("\.\/chunk-[A-Z0-9]+\.js");/g;
const KORDOC_COM_IMPORTED_NAMES = new Set([
  "comResultToParseResult",
  "extractTextViaCom",
  "isComFallbackAvailable",
]);
// convertToHwpx() offers a second engine that saves through Hancom Office.
const KORDOC_HANCOM_ENGINE_GUARD = /if \(engine !== "kordoc"\) \{/g;
const KORDOC_HANCOM_ENGINE_IMPORT = /\bimport\("\.\/hancom-[A-Z0-9]+\.js"\)/;
const KORDOC_PROCESS_RESIDUE =
  /\b(?:execFile(?:Sync)?|execFileAsync|isComFallbackAvailable|extractTextViaCom|comResultToParseResult|hwpToHwpxViaHancom|hancomAvailable|hancomSaveInvocation)\b|["'](?:node:)?child_process["']|HWPFrame\.HwpObject|Hwp\.Application|powershell/iu;

/**
 * Transform counts for the Kordoc library graph (dist/index.js and the chunks
 * it imports). A Kordoc upgrade must be reviewed against these numbers; the
 * build stops if the installed version or any count differs.
 */
export const KORDOC_HARDENING_MANIFEST = Object.freeze({
  version: "4.25.0",
  // createRequire("cfb") loaders: HWP 5 parser, HWP 5 patcher, HWP 5 -> HWPX converter.
  cfbLoaders: 3,
  // The com-fallback module (replaced by a process-free stub).
  comHelpers: 1,
  // DRM/distribution call sites: HWPX parser and HWP 5 parser.
  comBranches: 2,
  // Import lists that named the COM helpers.
  comImports: 2,
  // convertToHwpx() "hancom"/"auto" engine branch.
  hancomBranches: 1,
  // The Hancom save module must never be loaded into the graph.
  hancomModules: 0,
  // hayro-pdf.wasm loader replaced by HanMark's embedded bytes.
  hayroWasmLoaders: 1,
  // createRequire(...).resolve("*.wasm") reads: QR reader, HWP 5 writer.
  wasmAssetLookups: 2,
  // quick-xml wasm decoded with Buffer instead of atob.
  xmlWasmDecoders: 1,
  // Lazy OCR chunk imports: embedded-image OCR, image-file input, formula OCR,
  // and two for PDF page OCR. The chunks themselves never enter the graph.
  ocrLoaders: 5,
});

/** The hayro build shipped in the reviewed Kordoc package (dist/hayro-pdf.wasm). */
export const KORDOC_HAYRO_WASM = Object.freeze({
  byteLength: 4_124_364,
  sha256: "5da10f8423f48d6c40236f49db956afac25e160e170f80c957cebfd2a7e187e5",
});

export async function installedHayroWasmDigest(cwd = process.cwd()) {
  const bytes = await fsp.readFile(
    nodePath.join(cwd, "node_modules", "kordoc", "dist", "hayro-pdf.wasm"),
  );
  return {
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** The embedded copy must be the reviewed build: package, manifest, and src data agree. */
export async function assertHayroWasmEmbedded(cwd = process.cwd()) {
  const installed = await installedHayroWasmDigest(cwd);
  if (
    installed.sha256 !== KORDOC_HAYRO_WASM.sha256 ||
    installed.byteLength !== KORDOC_HAYRO_WASM.byteLength
  ) {
    throw new Error(
      `Installed hayro-pdf.wasm (${installed.byteLength} bytes, sha256 ${installed.sha256}) is not the reviewed build ${KORDOC_HAYRO_WASM.sha256}.`,
    );
  }
  const data = await fsp.readFile(
    nodePath.join(cwd, "src", "io", "hayroWasmData.ts"),
    "utf8",
  );
  const recorded = /HAYRO_WASM_SHA256 = "([0-9a-f]{64})"/u.exec(data)?.[1];
  if (recorded !== installed.sha256) {
    throw new Error(
      "src/io/hayroWasmData.ts does not embed the installed hayro-pdf.wasm; run node scripts/gen-hayro-wasm.mjs.",
    );
  }
}

export async function installedKordocVersion(cwd = process.cwd()) {
  const manifest = JSON.parse(
    await fsp.readFile(
      nodePath.join(cwd, "node_modules", "kordoc", "package.json"),
      "utf8",
    ),
  );
  return String(manifest.version);
}

export function assertKordocManifestVersion(version) {
  if (version !== KORDOC_HARDENING_MANIFEST.version) {
    throw new Error(
      `Installed Kordoc ${version} does not match the reviewed hardening manifest ${KORDOC_HARDENING_MANIFEST.version}. ` +
        "Review every Kordoc transform in esbuild.config.mjs before changing the manifest.",
    );
  }
}
const DOCX_PREVIEW_NBSP_HTML =
  /^([ \t]*)elem\.innerHTML = "&nbsp;";$/gm;
const DOCX_PREVIEW_ALT_CHUNK =
  /^([ \t]*)renderAltChunk\(elem\) \{\r?\n[ \t]*if \(!this\.options\.renderAltChunks\)\r?\n[ \t]*return null;\r?\n[ \t]*var result = this\.h\(\{ tagName: "iframe" \}\);\r?\n[ \t]*this\.tasks\.push\(this\.document\.loadAltChunk\(elem\.id, this\.currentPart\)\.then\(x => \{\r?\n[ \t]*result\.srcdoc = x;\r?\n[ \t]*\}\)\);\r?\n[ \t]*return result;\r?\n[ \t]*\}$/gm;
const DOCX_PREVIEW_ALT_CHUNK_DEFAULT =
  /^([ \t]*)renderAltChunks: true,$/gm;
const DOCX_PREVIEW_STYLE_CLEAR =
  /^([ \t]*)styleContainer\.innerHTML = "";$/gm;
const DOCX_PREVIEW_BODY_CLEAR =
  /^([ \t]*)bodyContainer\.innerHTML = "";$/gm;

function replaceWithCount(source, pattern, replacement) {
  let replacements = 0;
  return {
    source: source.replace(pattern, (...args) => {
      replacements += 1;
      return typeof replacement === "function" ? replacement(...args) : replacement;
    }),
    replacements,
  };
}

/**
 * Kordoc loads CFB through createRequire-generated names such as
 * require2("cfb") in the HWP 5 parser and the HWP 5 patcher. Those calls would
 * otherwise resolve next to main.js at runtime. A static import keeps the
 * HWP/HWPX parser self-contained.
 */
export function injectKordocCfb(source) {
  const loaderNames = Array.from(
    source.matchAll(CFB_DYNAMIC_REQUIRE),
    (match) => match[1],
  );
  const result = replaceWithCount(
    source,
    CFB_DYNAMIC_REQUIRE,
    "(__kordoc_cfb.default || __kordoc_cfb)",
  );
  if (result.replacements === 0) {
    return result;
  }
  let transformed = result.source;
  const createRequireNames = new Set();
  for (const loaderName of loaderNames) {
    const declaration = new RegExp(
      `\\b(?:var|const|let)\\s+${loaderName}\\s*=\\s*(createRequire\\d*)\\(import\\.meta\\.url\\);\\r?\\n`,
      "g",
    );
    transformed = transformed.replace(declaration, (_match, factoryName) => {
      createRequireNames.add(factoryName);
      return "";
    });
    const transpiledDeclaration = new RegExp(
      `\\b(?:var|const|let)\\s+${loaderName}\\s*=\\s*[^;\\r\\n]*\\bcreateRequire\\b[^;\\r\\n]*;\\r?\\n`,
      "g",
    );
    transformed = transformed.replace(transpiledDeclaration, "");
  }
  for (const factoryName of createRequireNames) {
    const createRequireImport = new RegExp(
      `import\\s*\\{\\s*createRequire(?:\\s+as\\s+${factoryName})?\\s*\\}\\s*from\\s*["'](?:node:)?module["'];?\\r?\\n`,
      "g",
    );
    transformed = transformed.replace(createRequireImport, "");
  }
  return {
    source: `import * as __kordoc_cfb from "cfb";\n${transformed}`,
    replacements: result.replacements,
  };
}

/**
 * HanMark intentionally excludes Kordoc's OCR/ML/native rasterizers. Replacing
 * their lazy loaders with a rejected promise keeps the document parsers in the
 * browser bundle while ensuring Electron never attempts to resolve an
 * unshipped native addon.
 */
export function hardenKordocOptionalNativeSource(source) {
  const cjsImports = replaceWithCount(
    source,
    OPTIONAL_NATIVE_CJS_IMPORT,
    'Promise.reject(new Error("HanMark does not bundle optional native features."))',
  );
  const dynamicImports = replaceWithCount(
    cjsImports.source,
    OPTIONAL_NATIVE_DYNAMIC_IMPORT,
    'Promise.reject(new Error("HanMark does not bundle optional native features."))',
  );
  const runtimeRequires = replaceWithCount(
    dynamicImports.source,
    OPTIONAL_NATIVE_REQUIRE,
    '(() => { throw new Error("HanMark does not bundle optional native features."); })()',
  );
  const moduleNames = replaceWithCount(
    runtimeRequires.source,
    OPTIONAL_NATIVE_STRING,
    (_match, quote) => `${quote}hanmark-disabled-native-addon${quote}`,
  );
  return {
    source: moduleNames.source,
    cjsImportReplacements: cjsImports.replacements,
    dynamicImportReplacements: dynamicImports.replacements,
    runtimeRequireReplacements: runtimeRequires.replacements,
    moduleNameReplacements: moduleNames.replacements,
  };
}

/**
 * HanMark never runs OCR: it would download models and write a cache. Cutting
 * the lazy imports keeps the whole OCR subgraph (engine, model downloader,
 * model cache) out of main.js instead of leaving it as unreachable code.
 * Callers already treat a failed import as "OCR unavailable".
 */
export function removeKordocOcrLoaders(source) {
  return replaceWithCount(
    source,
    KORDOC_OCR_CHUNK_IMPORT,
    'Promise.reject(new Error("HanMark does not bundle OCR."))',
  );
}

// Absolute, forward-slash path of HanMark's embedded hayro reader, imported into
// Kordoc's PDF engine chunk in place of its file/network loader.
export const HANMARK_HAYRO_WASM_MODULE = nodePath
  .join(nodePath.dirname(fileURLToPath(import.meta.url)), "src", "io", "hayroWasm.ts")
  .split(nodePath.sep)
  .join("/");

/**
 * WebAssembly in the bundle comes from two places only, both compiled from
 * bytes that are part of main.js: Kordoc's inline quick-xml parser and the
 * hayro PDF engine HanMark embeds. Nothing is read from disk or fetched.
 */
export function hardenKordocWasmSource(source) {
  const hayro = replaceWithCount(
    source,
    KORDOC_HAYRO_WASM_LOADER,
    "async function wasmBytes() {\n  return __hanmarkHayroWasmBytes();\n}\n",
  );
  const assets = replaceWithCount(
    hayro.source,
    KORDOC_WASM_ASSET_LOOKUP,
    '(() => { throw new Error("HanMark does not bundle optional native features."); })()',
  );
  const xml = replaceWithCount(
    assets.source,
    KORDOC_XML_WASM_DECODE,
    'Buffer.from(XML_FLAT_WASM, "base64")',
  );
  let transformed = xml.source;
  if (assets.replacements > 0) {
    const withoutImport = transformed.replace(KORDOC_NODE_MODULE_IMPORT, "");
    if (!/\bcreateRequire\b/u.test(withoutImport)) {
      transformed = withoutImport;
    }
  }
  if (hayro.replacements > 0) {
    transformed = `import { hayroWasmBytes as __hanmarkHayroWasmBytes } from ${JSON.stringify(HANMARK_HAYRO_WASM_MODULE)};\n${transformed}`;
  }
  if (/hayro-pdf\.wasm/u.test(transformed)) {
    throw new Error(
      `Kordoc ${KORDOC_HARDENING_MANIFEST.version} still resolves hayro-pdf.wasm from a file or URL after hardening.`,
    );
  }
  return {
    source: transformed,
    hayroWasmLoaderReplacements: hayro.replacements,
    wasmAssetLookupReplacements: assets.replacements,
    xmlWasmDecoderReplacements: xml.replacements,
  };
}

function skipQuoted(source, start, quote) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
    } else if (source[index] === quote) {
      return index;
    }
  }
  throw new Error("Unterminated string literal while hardening Kordoc.");
}

function skipTemplate(source, start) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
    } else if (source[index] === "`") {
      return index;
    } else if (source[index] === "$" && source[index + 1] === "{") {
      index = findMatchingBrace(source, index + 1);
    }
  }
  throw new Error("Unterminated template literal while hardening Kordoc.");
}

/** Index of the `}` that closes the `{` at openIndex (strings and comments skipped). */
export function findMatchingBrace(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' || char === "'") {
      index = skipQuoted(source, index, char);
    } else if (char === "`") {
      index = skipTemplate(source, index);
    } else if (char === "/" && source[index + 1] === "/") {
      const lineEnd = source.indexOf("\n", index);
      index = lineEnd === -1 ? source.length : lineEnd;
    } else if (char === "/" && source[index + 1] === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 1;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error("Unbalanced braces while hardening Kordoc.");
}

/** Removes every whole-line `if (… isComFallbackAvailable() && options?.filePath) { … }` statement. */
export function removeKordocComBranches(source) {
  let output = "";
  let cursor = 0;
  let replacements = 0;
  for (const match of source.matchAll(KORDOC_COM_BRANCH_GUARD)) {
    const guardIndex = match.index ?? 0;
    if (guardIndex < cursor) {
      continue;
    }
    const statementStart = source.lastIndexOf("if (", guardIndex);
    const lineStart = source.lastIndexOf("\n", statementStart) + 1;
    if (statementStart < 0 || source.slice(lineStart, statementStart).trim() !== "") {
      throw new Error("Kordoc COM branch is not a standalone if statement.");
    }
    const closeBrace = findMatchingBrace(source, guardIndex + match[0].length - 1);
    const lineEnd = source.indexOf("\n", closeBrace);
    if (source.slice(closeBrace + 1, lineEnd === -1 ? source.length : lineEnd).trim() !== "") {
      throw new Error("Kordoc COM branch shares its closing line with other code.");
    }
    output += source.slice(cursor, lineStart);
    cursor = lineEnd === -1 ? source.length : lineEnd + 1;
    replacements += 1;
  }
  output += source.slice(cursor);
  return { source: output, replacements };
}

/** Drops the COM helper names from one import list and reports whether it changed. */
function stripKordocComImports(source) {
  let replacements = 0;
  const transformed = source.replace(KORDOC_COM_IMPORT, (_match, names, specifier) => {
    replacements += 1;
    const kept = names
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name && !KORDOC_COM_IMPORTED_NAMES.has(name));
    return kept.length > 0
      ? `import {\n  ${kept.join(",\n  ")}\n} from ${specifier};`
      : `import ${specifier};`;
  });
  return { source: transformed, replacements };
}

/** Replaces convertToHwpx()'s Hancom engine branch with an explicit refusal. */
export function removeKordocHancomEngineBranches(source) {
  let output = "";
  let cursor = 0;
  let replacements = 0;
  for (const match of source.matchAll(KORDOC_HANCOM_ENGINE_GUARD)) {
    const guardIndex = match.index ?? 0;
    if (guardIndex < cursor) {
      continue;
    }
    const openBrace = guardIndex + match[0].length - 1;
    const closeBrace = findMatchingBrace(source, openBrace);
    if (!KORDOC_HANCOM_ENGINE_IMPORT.test(source.slice(openBrace, closeBrace))) {
      continue;
    }
    output +=
      source.slice(cursor, openBrace) +
      '{\n    throw new KordocError("HanMark does not bundle Hancom Office automation.");\n  }';
    cursor = closeBrace + 1;
    replacements += 1;
  }
  output += source.slice(cursor);
  return { source: output, replacements };
}

/**
 * Kordoc can start PowerShell to drive Hancom Office (COM) on Windows: to
 * read DRM/distribution documents from a file path, and as an alternative
 * HWP -> HWPX engine. HanMark only passes document bytes and never starts a
 * process for conversion, so every call site, the helper module, and the
 * Hancom save module are removed before bundling. KORDOC_HARDENING_MANIFEST
 * counts stop the build if Kordoc changes shape.
 */
export function hardenKordocComFallbackSource(source) {
  const counts = {
    helperReplacements: 0,
    comBranchReplacements: 0,
    comImportReplacements: 0,
    hancomBranchReplacements: 0,
    hancomModuleLoads: 0,
  };
  if (source.includes(KORDOC_HANCOM_MODULE_MARKER)) {
    // Unreachable once the engine branch is gone; the manifest expects zero loads.
    return {
      source: "export {};\n",
      ...counts,
      hancomModuleLoads: 1,
    };
  }
  if (source.includes(KORDOC_COM_MODULE_MARKER)) {
    const sourceModules = source.match(/^\/\/ src\//gmu)?.length ?? 0;
    const helper = KORDOC_ENCRYPTED_HWPX_HELPER.exec(source)?.[0];
    if (
      sourceModules !== 1 ||
      !helper ||
      !source.includes('import { execFile } from "child_process";')
    ) {
      throw new Error(
        `Kordoc ${KORDOC_HARDENING_MANIFEST.version} COM hardening encountered an unsupported module format.`,
      );
    }
    return {
      source: `${KORDOC_COM_MODULE_MARKER} (HanMark: process-free stub)\n${helper}\n\nexport {\n  isEncryptedHwpx\n};\n`,
      ...counts,
      helperReplacements: 1,
    };
  }
  const branches = removeKordocComBranches(source);
  const imports = stripKordocComImports(branches.source);
  const hancom = removeKordocHancomEngineBranches(imports.source);
  if (branches.replacements !== imports.replacements) {
    throw new Error(
      `Kordoc ${KORDOC_HARDENING_MANIFEST.version} COM hardening mismatch: ${branches.replacements} call sites but ${imports.replacements} import lists.`,
    );
  }
  const residual = hancom.source.match(KORDOC_PROCESS_RESIDUE)?.[0] ?? null;
  if (residual) {
    throw new Error(
      `Kordoc process automation remained after source hardening: ${residual}`,
    );
  }
  return {
    source: hancom.source,
    ...counts,
    comBranchReplacements: branches.replacements,
    comImportReplacements: imports.replacements,
    hancomBranchReplacements: hancom.replacements,
  };
}

/**
 * The setImmediate polyfill accepts string callbacks for very old browser
 * compatibility. HanMark only accepts functions. Its obsolete IE ready-state
 * scheduler is replaced with the equivalent timer fallback, so no script node
 * is created even if that branch is selected.
 */
export function hardenSetImmediateSource(source) {
  const callback = replaceWithCount(
    source,
    SET_IMMEDIATE_STRING_CALLBACK,
    'throw new TypeError("setImmediate callback must be a function");',
  );
  const readyState = replaceWithCount(
    callback.source,
    SET_IMMEDIATE_READY_STATE,
    `    function installReadyStateChangeImplementation() {
        registerImmediate = function(handle) {
            setTimeout(runIfPresent, 0, handle);
        };
    }`,
  );
  const readyStateProbe = replaceWithCount(
    readyState.source,
    SET_IMMEDIATE_READY_STATE_PROBE,
    "false",
  );
  const immediateReadyState = replaceWithCount(
    readyStateProbe.source,
    IMMEDIATE_READY_STATE_BRANCH,
    "  } else {",
  );
  return {
    source: immediateReadyState.source,
    callbackReplacements: callback.replacements,
    readyStateReplacements: readyState.replacements,
    readyStateProbeReplacements: readyStateProbe.replacements,
    immediateReadyStateReplacements: immediateReadyState.replacements,
  };
}

/**
 * docx-preview 0.4.0 supports HTML altChunks by assigning package-controlled
 * HTML to iframe.srcdoc. HanMark's DOCX preview does not need altChunks, so the
 * pinned source is made text/DOM-only before bundling. Exact replacement
 * counts intentionally fail the build when the upstream source shape changes.
 */
export function hardenDocxPreviewSource(source) {
  const nbsp = replaceWithCount(
    source,
    DOCX_PREVIEW_NBSP_HTML,
    (_match, indent) => `${indent}elem.textContent = "\u00a0";`,
  );
  const altChunk = replaceWithCount(
    nbsp.source,
    DOCX_PREVIEW_ALT_CHUNK,
    (_match, indent) =>
      `${indent}renderAltChunk() {\n${indent}    return null;\n${indent}}`,
  );
  const altChunkDefault = replaceWithCount(
    altChunk.source,
    DOCX_PREVIEW_ALT_CHUNK_DEFAULT,
    (_match, indent) => `${indent}renderAltChunks: false,`,
  );
  const styleClear = replaceWithCount(
    altChunkDefault.source,
    DOCX_PREVIEW_STYLE_CLEAR,
    (_match, indent) => `${indent}styleContainer.replaceChildren();`,
  );
  const bodyClear = replaceWithCount(
    styleClear.source,
    DOCX_PREVIEW_BODY_CLEAR,
    (_match, indent) => `${indent}bodyContainer.replaceChildren();`,
  );
  const counts = {
    nbspReplacements: nbsp.replacements,
    altChunkReplacements: altChunk.replacements,
    altChunkDefaultReplacements: altChunkDefault.replacements,
    styleClearReplacements: styleClear.replacements,
    bodyClearReplacements: bodyClear.replacements,
  };
  if (Object.values(counts).some((count) => count !== 1)) {
    throw new Error(
      `docx-preview 0.4.0 hardening mismatch: expected one of each transform, got ${JSON.stringify(counts)}`,
    );
  }
  const residual =
    bodyClear.source.match(
      /\.innerHTML\b|\.srcdoc\b|renderAltChunks\s*:\s*true/u,
    )?.[0] ?? null;
  if (residual) {
    throw new Error(
      `Unsafe docx-preview HTML rendering remained after source hardening: ${residual}`,
    );
  }
  return {
    source: bodyClear.source,
    ...counts,
  };
}

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
  ["bare atob", /(?<![\w$.])atob\s*\(/u],
  ["bare btoa", /(?<![\w$.])btoa\s*\(/u],
  [
    "dynamic script element",
    /\bcreateElement\s*\(\s*["']script["']\s*\)/u,
  ],
  ["HTML string insertion", /\.innerHTML\b|\.srcdoc\b/u],
  ["DOCX altChunk rendering", /renderAltChunks\s*:\s*true/u],
];

export function findUnsafeRuntimeConstructs(source) {
  return unsafeRuntimePatterns
    .filter(([, pattern]) => pattern.test(source))
    .map(([name]) => name);
}

function assertDependencyTransform(path, source) {
  const findings = findUnsafeRuntimeConstructs(source);
  if (findings.length > 0) {
    throw new Error(
      `Dependency hardening did not remove ${findings.join(", ")} from ${path}`,
    );
  }
}

const KORDOC_TALLY_KEYS = Object.freeze(
  Object.keys(KORDOC_HARDENING_MANIFEST).filter((key) => key !== "version"),
);

export function emptyKordocHardeningTally() {
  return {
    loadedFiles: 0,
    ...Object.fromEntries(KORDOC_TALLY_KEYS.map((key) => [key, 0])),
  };
}

/** Compares one build's Kordoc transform totals with the reviewed manifest. */
export function assertKordocHardeningTally(tally) {
  if (tally.loadedFiles === 0) {
    return;
  }
  const expected = Object.fromEntries(
    KORDOC_TALLY_KEYS.map((key) => [key, KORDOC_HARDENING_MANIFEST[key]]),
  );
  const actual = Object.fromEntries(
    KORDOC_TALLY_KEYS.map((key) => [key, tally[key]]),
  );
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Kordoc ${KORDOC_HARDENING_MANIFEST.version} hardening totals differ from the manifest: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

/** Runs every Kordoc source transform on one dist file. */
export function hardenKordocSource(original) {
  const cfb = injectKordocCfb(original);
  const optionalNative = hardenKordocOptionalNativeSource(cfb.source);
  const ocr = removeKordocOcrLoaders(optionalNative.source);
  const wasm = hardenKordocWasmSource(ocr.source);
  const comFallback = hardenKordocComFallbackSource(wasm.source);
  return {
    source: comFallback.source,
    counts: {
      cfbLoaders: cfb.replacements,
      comHelpers: comFallback.helperReplacements,
      comBranches: comFallback.comBranchReplacements,
      comImports: comFallback.comImportReplacements,
      hancomBranches: comFallback.hancomBranchReplacements,
      hancomModules: comFallback.hancomModuleLoads,
      hayroWasmLoaders: wasm.hayroWasmLoaderReplacements,
      wasmAssetLookups: wasm.wasmAssetLookupReplacements,
      xmlWasmDecoders: wasm.xmlWasmDecoderReplacements,
      ocrLoaders: ocr.replacements,
    },
  };
}

export const kordocSourceHardeningPlugin = {
  name: "kordoc-source-hardening",
  setup(build) {
    let tally = emptyKordocHardeningTally();
    build.onStart(async () => {
      tally = emptyKordocHardeningTally();
      assertKordocManifestVersion(await installedKordocVersion());
      await assertHayroWasmEmbedded();
    });
    build.onLoad(
      { filter: /kordoc[\\/]dist[\\/].*\.(?:c?js|mjs)$/ },
      async (args) => {
        const original = await fsp.readFile(args.path, "utf8");
        const hardened = hardenKordocSource(original);
        tally.loadedFiles += 1;
        for (const key of KORDOC_TALLY_KEYS) {
          tally[key] += hardened.counts[key];
        }
        return {
          contents: hardened.source,
          loader: "js",
          resolveDir: nodePath.dirname(args.path),
        };
      },
    );
    build.onEnd((result) => {
      if (result.errors.length === 0) {
        assertKordocHardeningTally(tally);
      }
    });
  },
};

export const dependencySourceHardeningPlugin = {
  name: "dependency-source-hardening",
  setup(build) {
    build.onLoad(
      {
        filter:
          /(?:setimmediate[\\/]setImmediate|jszip[\\/]dist[\\/]jszip|immediate[\\/]lib[\\/](?:index|browser))\.js$/,
      },
      async (args) => {
        const original = await fsp.readFile(args.path, "utf8");
        const transformed = hardenSetImmediateSource(original);
        assertDependencyTransform(args.path, transformed.source);
        return {
          contents: transformed.source,
          loader: "js",
          resolveDir: nodePath.dirname(args.path),
        };
      },
    );

    build.onLoad(
      {
        filter:
          /docx-preview[\\/]dist[\\/]docx-preview\.(?:mjs|js)$/,
      },
      async (args) => {
        const original = await fsp.readFile(args.path, "utf8");
        const transformed = hardenDocxPreviewSource(original);
        assertDependencyTransform(args.path, transformed.source);
        return {
          contents: transformed.source,
          loader: "js",
          resolveDir: nodePath.dirname(args.path),
        };
      },
    );
  },
};

export const blockedFileSystemPlugin = {
  name: "block-unneeded-node-filesystem",
  setup(build) {
    build.onResolve(
      { filter: /^(?:node:)?fs(?:\/promises)?$/ },
      (args) => ({
        path: args.path,
        namespace: "hanmark-blocked-filesystem",
      }),
    );
    build.onLoad(
      { filter: /.*/, namespace: "hanmark-blocked-filesystem" },
      () => ({
        loader: "js",
        contents: `
const blocked = () => { throw new Error("This optional filesystem feature is not available in HanMark."); };
const blockedAsync = async () => blocked();
export const readFile = blockedAsync;
export const writeFile = blockedAsync;
export const mkdir = blockedAsync;
export const stat = blockedAsync;
export const unlink = blockedAsync;
export const rename = blockedAsync;
export const realpath = blockedAsync;
export const readFileSync = blocked;
export const writeFileSync = blocked;
export const mkdirSync = blocked;
export const statSync = blocked;
export const realpathSync = blocked;
export const openSync = blocked;
export const readSync = blocked;
export const closeSync = blocked;
export const createReadStream = blocked;
export const createWriteStream = blocked;
export const watch = blocked;
export const existsSync = () => false;
// Kordoc 4.25.0: the PDF parser statically imports the OCR model-cache helpers
// (they only answer "is a model cached?"); these two names come with them.
export const readlinkSync = blocked;
export const readdir = blockedAsync;
export const promises = { readFile, writeFile, mkdir, stat, unlink, rename, realpath };
export default {
  readFile, writeFile, mkdir, stat, unlink, rename, realpath,
  readFileSync, writeFileSync, mkdirSync, statSync, realpathSync,
  openSync, readSync, closeSync, createReadStream, createWriteStream,
  watch, existsSync, promises
};
`,
      }),
    );
  },
};

const verifyBundledCodePlugin = {
  name: "verify-bundled-code",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) {
        return;
      }
      const code = await fsp.readFile(outputFile, "utf8");
      const findings = findUnsafeRuntimeConstructs(code);
      if (findings.length > 0) {
        throw new Error(
          `Unsafe runtime constructs remain in ${outputFile}: ${findings.join(", ")}`,
        );
      }
    });
  },
};

export const options = {
  banner: {
    // Kordoc modules still mention import.meta.url, so the CJS bundle supplies
    // a real file URL for it.
    js:
      "/* THIS IS A GENERATED/BUNDLED FILE BY ESBUILD */\n" +
      "const __hwpImportMetaUrl = require('url').pathToFileURL(__filename).href;",
  },
  define: {
    "import.meta.url": "__hwpImportMetaUrl",
  },
  plugins: [
    blockedFileSystemPlugin,
    kordocSourceHardeningPlugin,
    dependencySourceHardeningPlugin,
    verifyBundledCodePlugin,
  ],
  entryPoints: ["src/main.ts"],
  bundle: true,
  external,
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: outputFile,
  platform: "node",
  minify: prod,
  // Obsidian reads main.js as UTF-8. The default ASCII charset spells every Hangul
  // character as a six-byte \uXXXX escape; UTF-8 keeps it at three bytes (R-018:
  // 117 KB smaller at 2.7.0 M5 with identical behavior).
  charset: "utf8",
};

async function runBuild() {
  if (prod) {
    await esbuild.build(options);
    console.log(`Production build complete: ${outputFile}`);
    return;
  }
  const context = await esbuild.context(options);
  await context.watch();
  console.log("Watching for changes...");
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  nodePath.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  runBuild().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
