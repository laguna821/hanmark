import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const walk = async (directory) => {
  const absolute = new URL(`${directory}/`, root);
  const entries = await readdir(absolute);
  const files = [];
  for (const entry of entries) {
    const relativePath = join(directory, entry);
    const info = await stat(new URL(relativePath.replaceAll("\\", "/"), root));
    if (info.isDirectory()) files.push(...await walk(relativePath));
    else files.push(relativePath);
  }
  return files;
};

const sourceFiles = (await walk("src"))
  .filter((path) => [".ts", ".tsx", ".js", ".mjs", ".cjs"].includes(extname(path)));
const sourceEntries = await Promise.all(
  sourceFiles.map(async (path) => [relative(".", path), await read(path.replaceAll("\\", "/"))])
);
const bundle = await read("main.js");
const css = await read("styles.css");

const findings = [];
const check = (scope, content, pattern, message) => {
  if (pattern.test(content)) findings.push(`${scope}: ${message}`);
};

for (const [path, content] of sourceEntries) {
  check(
    path,
    content,
    /(?<![\w$.])eval\s*\(|(?<![\w$.])(?:new\s+)?Function\s*\(/u,
    "dynamic code evaluation is forbidden"
  );
  check(path, content, /\bnavigator\s*\.\s*clipboard\b|\bClipboardItem\b/u, "Clipboard API access is forbidden");
  check(path, content, /(?<![\w$.])(?:atob|btoa)\s*\(/u, "bare browser base64 APIs are forbidden");
  check(
    path,
    content,
    /\bcreateElement\s*\(\s*["']script["']\s*\)/u,
    "dynamic script element creation is forbidden"
  );
  check(
    path,
    content,
    /(?:from\s*|import\s*\(|require\s*\()\s*["'](?:node:)?fs(?:\/promises)?["']/u,
    "direct Node filesystem access is forbidden"
  );
  check(path, content, /\bconsole\.log\s*\(/u, "production console.log is forbidden");
}

check(
  "main.js",
  bundle,
  /(?<![\w$.])eval\s*\(|(?<![\w$.])(?:new\s+)?Function\s*\(/u,
  "dynamic code evaluation leaked into the bundle"
);
check(
  "main.js",
  bundle,
  /\bnavigator\s*\.\s*clipboard\b|\bClipboardItem\b/u,
  "Clipboard API access leaked into the bundle"
);
check(
  "main.js",
  bundle,
  /(?<![\w$.])(?:atob|btoa)\s*\(/u,
  "bare browser base64 APIs leaked into the bundle"
);
check(
  "main.js",
  bundle,
  /\bcreateElement\s*\(\s*["']script["']\s*\)/u,
  "dynamic script element creation leaked into the bundle"
);
check(
  "main.js",
  bundle,
  /require\s*\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)/u,
  "direct Node filesystem access leaked into the bundle"
);
check("styles.css", css, /!\s*important\b/iu, "CSS declarations must not use !important");

try {
  await stat(new URL("legacy-main.cjs", root));
  findings.push("legacy-main.cjs: retired untyped runtime must not remain in the review branch");
} catch {
  // Expected: the old compatibility runtime remains available in the historical branches only.
}

if (findings.length > 0) {
  throw new Error(`Community gate failed:\n- ${findings.join("\n- ")}`);
}

console.log(
  "Community gate passed: no dynamic evaluation, script injection, clipboard/base64 API, direct filesystem access, legacy runtime, or CSS !important."
);
