import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";
import { promises as fsp } from "node:fs";
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
  // HanMark's runtime. PDF.js remains bundled because PDF import uses it.
  "puppeteer-core",
  "@modelcontextprotocol/sdk",
  "onnxruntime-node",
  "sharp",
  "@huggingface/transformers",
  "@hyzyla/pdfium",
  "@napi-rs/canvas",
  "canvas",
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

const CFB_DYNAMIC_REQUIRE = /\b(require\d*)\(\s*["']cfb["']\s*\)/g;
const OPTIONAL_NATIVE_MODULES = [
  "onnxruntime-node",
  "sharp",
  "@huggingface/transformers",
  "@hyzyla/pdfium",
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
const KORDOC_PDF_ASSET_CREATE_REQUIRE =
  /try \{\r?\n  const _require = createRequire\(import\.meta\.url\);\r?\n  const pkgDir = dirname\(_require\.resolve\("pdfjs-dist\/package\.json"\)\);\r?\n  pdfjsAssets\.cMapUrl = join\(pkgDir, "cmaps"\) \+ "\/";\r?\n  pdfjsAssets\.cMapPacked = true;\r?\n  pdfjsAssets\.standardFontDataUrl = join\(pkgDir, "standard_fonts"\) \+ "\/";\r?\n\} catch \{\r?\n\}/g;
const KORDOC_CREATE_REQUIRE_IMPORT =
  /import\s*\{\s*createRequire\s*\}\s*from\s*["'](?:node:)?module["'];?\r?\n/g;
const SET_IMMEDIATE_STRING_CALLBACK =
  /callback\s*=\s*new Function\(""\s*\+\s*callback\);/g;
const SET_IMMEDIATE_READY_STATE =
  /^    function installReadyStateChangeImplementation\(\) \{[\s\S]*?^    \}/gm;
const SET_IMMEDIATE_READY_STATE_PROBE =
  /doc && "onreadystatechange" in doc\.createElement\("script"\)/g;
const IMMEDIATE_READY_STATE_BRANCH =
  /  \} else if \('document' in global && 'onreadystatechange' in global\.document\.createElement\('script'\)\) \{[\s\S]*?^  \} else \{/gm;
const PDF_EVAL_PROBE =
  /function isEvalSupported\(\)\s*\{\s*try\s*\{\s*new Function\(""\);\s*return true;\s*\}\s*catch\s*\{\s*return false;\s*\}\s*\}/g;
const PDF_POSTSCRIPT_COMPILER =
  /    if \(isEvalSupported && FeatureTest\.isEvalSupported\) \{\r?\n      const compiled = new PostScriptCompiler\(\)\.compile\(code, domain, range\);\r?\n      if \(compiled\) \{\r?\n        return new Function\("src", "srcOffset", "dest", "destOffset", compiled\);\r?\n      \}\r?\n    \}/g;
const BARE_ATOB_CALL = /(?<![\w$.])atob\s*\(/g;
const BARE_BTOA_CALL = /(?<![\w$.])btoa\s*\(/g;
const PDF_DYNAMIC_REQUIRE_FALLBACK =
  "Function('return require(\"' + name + '\")')()";
const PDF_GLOBAL_THIS_FALLBACK = "Function('return this')()";
const PDF_NODE_FS_ACCESS =
  /process\.getBuiltinModule\(\s*["']fs["']\s*\)/g;
const PDF_NODE_CANVAS_BOOTSTRAP =
  /if \(isNodeJS\) \{\r?\n  let canvas;[\s\S]*?\r?\n\}\r?\nasync function node_utils_fetchData/g;
const PDF_NODE_CANVAS_FACTORY =
  /class NodeCanvasFactory extends BaseCanvasFactory \{\r?\n  _createCanvas\(width, height\) \{\r?\n    const require = process\.getBuiltinModule\("module"\)\.createRequire\(import\.meta\.url\);\r?\n    const canvas = require\("@napi-rs\/canvas"\);\r?\n    return canvas\.createCanvas\(width, height\);\r?\n  \}\r?\n\}/g;
const PDF_WORKER_CDN_WRAPPER =
  /this\._createCDNWrapper = url => \{\r?\n      const wrapper = `await import\("\$\{url\}"\);`;\r?\n      return URL\.createObjectURL\(new Blob\(\[wrapper\], \{\r?\n        type: "text\/javascript"\r?\n      \}\)\);\r?\n    \};/g;
const PDF_FAKE_WORKER_DYNAMIC_IMPORT =
  /      const worker = await import\(\/\*webpackIgnore: true\*\/this\.workerSrc\);\r?\n      return worker\.WorkerMessageHandler;/g;

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
 * Kordoc 4.2.5 loads CFB through createRequire-generated names such as
 * require2("cfb"). Those calls would otherwise resolve next to main.js at
 * runtime. A static import keeps the HWP/HWPX parser self-contained.
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
    '"hanmark-disabled-native-addon"',
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
 * Kordoc resolves PDF.js CMaps and standard fonts through Node's createRequire.
 * HanMark provides PDF bytes directly and cannot ship those filesystem assets,
 * so leaving the asset map empty preserves the existing browser parser path.
 */
export function hardenKordocPdfParserSource(source) {
  const assetLookup = replaceWithCount(
    source,
    KORDOC_PDF_ASSET_CREATE_REQUIRE,
    "",
  );
  const createRequireImport = replaceWithCount(
    assetLookup.source,
    KORDOC_CREATE_REQUIRE_IMPORT,
    "",
  );
  return {
    source: createRequireImport.source,
    assetLookupReplacements: assetLookup.replacements,
    createRequireImportReplacements: createRequireImport.replacements,
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
 * PDF.js can compile PostScript PDF functions through Function(). Disabling
 * the capability probe and removing that compiler branch makes it use the
 * built-in PostScriptEvaluator immediately. PDF parsing remains available.
 */
export function hardenPdfJsSource(source) {
  const evalProbe = replaceWithCount(
    source,
    PDF_EVAL_PROBE,
    "function isEvalSupported() { return false; }",
  );
  const postScript = replaceWithCount(
    evalProbe.source,
    PDF_POSTSCRIPT_COMPILER,
    "",
  );
  const dynamicRequire = replaceWithCount(
    postScript.source,
    new RegExp(
      PDF_DYNAMIC_REQUIRE_FALLBACK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "g",
    ),
    "__hanmarkRequireBuiltin(name)",
  );
  const globalThis = replaceWithCount(
    dynamicRequire.source,
    new RegExp(
      PDF_GLOBAL_THIS_FALLBACK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "g",
    ),
    "undefined",
  );
  const nodeFileSystem = replaceWithCount(
    globalThis.source,
    PDF_NODE_FS_ACCESS,
    "__hanmarkBlockedFileSystem",
  );
  const nodeCanvasBootstrap = replaceWithCount(
    nodeFileSystem.source,
    PDF_NODE_CANVAS_BOOTSTRAP,
    "async function node_utils_fetchData",
  );
  const nodeCanvasFactory = replaceWithCount(
    nodeCanvasBootstrap.source,
    PDF_NODE_CANVAS_FACTORY,
    `class NodeCanvasFactory extends BaseCanvasFactory {
  _createCanvas(width, height) {
    const canvas = globalThis.document?.createElement("canvas");
    if (!canvas) {
      throw new Error("Browser canvas rendering is unavailable.");
    }
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
}`,
  );
  const workerCdnWrapper = replaceWithCount(
    nodeCanvasFactory.source,
    PDF_WORKER_CDN_WRAPPER,
    `this._createCDNWrapper = () => {
      throw new Error("External PDF workers are disabled in HanMark.");
    };`,
  );
  const fakeWorkerDynamicImport = replaceWithCount(
    workerCdnWrapper.source,
    PDF_FAKE_WORKER_DYNAMIC_IMPORT,
    '      throw new Error("The bundled PDF worker is unavailable.");',
  );
  const atob = replaceWithCount(
    fakeWorkerDynamicImport.source,
    BARE_ATOB_CALL,
    "__hanmarkDecodeBase64(",
  );
  const btoa = replaceWithCount(
    atob.source,
    BARE_BTOA_CALL,
    "__hanmarkEncodeBase64(",
  );
  return {
    source: btoa.source,
    evalProbeReplacements: evalProbe.replacements,
    postScriptReplacements: postScript.replacements,
    dynamicRequireReplacements: dynamicRequire.replacements,
    globalThisFallbackReplacements: globalThis.replacements,
    nodeFileSystemReplacements: nodeFileSystem.replacements,
    nodeCanvasBootstrapReplacements: nodeCanvasBootstrap.replacements,
    nodeCanvasFactoryReplacements: nodeCanvasFactory.replacements,
    workerCdnWrapperReplacements: workerCdnWrapper.replacements,
    fakeWorkerDynamicImportReplacements: fakeWorkerDynamicImport.replacements,
    atobReplacements: atob.replacements,
    btoaReplacements: btoa.replacements,
  };
}

const unsafeRuntimePatterns = [
  ["dynamic Function constructor", /(?<![\w$.])(?:new\s+)?Function\s*\(/u],
  ["eval", /(?<![\w$.])eval\s*\(/u],
  ["dynamic import", /\bimport\s*\(/u],
  ["createRequire", /\bcreateRequire\b/u],
  ["Clipboard API", /\bnavigator\s*\.\s*clipboard\b|\bClipboardItem\b/u],
  ["bare atob", /(?<![\w$.])atob\s*\(/u],
  ["bare btoa", /(?<![\w$.])btoa\s*\(/u],
  [
    "dynamic script element",
    /\bcreateElement\s*\(\s*["']script["']\s*\)/u,
  ],
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

const kordocSourceHardeningPlugin = {
  name: "kordoc-source-hardening",
  setup(build) {
    build.onLoad(
      { filter: /kordoc[\\/]dist[\\/].*\.(?:c?js|mjs)$/ },
      async (args) => {
        const original = await fsp.readFile(args.path, "utf8");
        const cfb = injectKordocCfb(original);
        const optionalNative = hardenKordocOptionalNativeSource(cfb.source);
        const pdfParser = hardenKordocPdfParserSource(optionalNative.source);
        return {
          contents: pdfParser.source,
          loader: "js",
          resolveDir: nodePath.dirname(args.path),
        };
      },
    );
  },
};

const dependencySourceHardeningPlugin = {
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
          /pdfjs-dist[\\/]legacy[\\/]build[\\/]pdf(?:\.worker)?\.mjs$/,
      },
      async (args) => {
        const original = await fsp.readFile(args.path, "utf8");
        const transformed = hardenPdfJsSource(original);
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

const blockedFileSystemPlugin = {
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

const options = {
  banner: {
    // Kordoc calls createRequire(import.meta.url), so the CJS bundle supplies a
    // real file URL. PDF.js base64 helpers replace browser globals with Buffer.
    js:
      "/* THIS IS A GENERATED/BUNDLED FILE BY ESBUILD */\n" +
      "const __hwpImportMetaUrl = require('url').pathToFileURL(__filename).href;\n" +
      "const __hanmarkRequireBuiltin = (name) => require(name);\n" +
      "const __hanmarkBlockedFileSystem = { promises: { readFile: async () => { throw new Error('Filesystem PDF loading is disabled; HanMark supplies PDF bytes directly.'); } } };\n" +
      "const __hanmarkDecodeBase64 = (value) => Buffer.from(value, 'base64').toString('latin1');\n" +
      "const __hanmarkEncodeBase64 = (value) => Buffer.from(value, 'latin1').toString('base64');",
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
