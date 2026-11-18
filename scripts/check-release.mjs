import { access, readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const [manifest, pkg, lock, versions, ciWorkflow, releaseWorkflow] = await Promise.all([
  readJson("manifest.json"),
  readJson("package.json"),
  readJson("package-lock.json"),
  readJson("versions.json"),
  readFile(".github/workflows/ci.yml", "utf8"),
  readFile(".github/workflows/release.yml", "utf8")
]);

// The one place to change when the minimum Obsidian version moves (also manifest.json and versions.json).
const MIN_APP_VERSION = "1.8.9";
const version = manifest.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid manifest version: ${version}`);
if (pkg.version !== version) throw new Error(`package.json ${pkg.version} != manifest.json ${version}`);
if (manifest.minAppVersion !== MIN_APP_VERSION) {
  throw new Error(`HanMark ${version} declares minAppVersion ${MIN_APP_VERSION}, found ${manifest.minAppVersion}`);
}
if (versions[version] !== manifest.minAppVersion) {
  throw new Error(`versions.json ${versions[version]} != minAppVersion ${manifest.minAppVersion}`);
}
// Keep in step with KORDOC_HARDENING_MANIFEST.version in esbuild.config.mjs.
const KORDOC_VERSION = "4.25.0";
if (pkg.dependencies?.kordoc !== KORDOC_VERSION) {
  throw new Error(`kordoc must be pinned exactly to ${KORDOC_VERSION}`);
}
// Pele draws Mermaid diagrams in every export (R-033).
const PELE_VERSION = "1.13.0";
if (pkg.dependencies?.pele !== PELE_VERSION) {
  throw new Error(`pele must be pinned exactly to ${PELE_VERSION}`);
}
if (lock.packages?.["node_modules/pele"]?.version !== PELE_VERSION) {
  throw new Error(`package-lock must resolve pele exactly to ${PELE_VERSION}`);
}
if (pkg.dependencies?.["markdown-it"] !== "14.3.3") {
  throw new Error("markdown-it must be pinned exactly to 14.3.3");
}
if (pkg.dependencies?.["markdown-it-footnote"] !== "4.0.0") {
  throw new Error("markdown-it-footnote must be pinned exactly to 4.0.0");
}
if (lock.packages?.["node_modules/markdown-it-footnote"]?.version !== "4.0.0") {
  throw new Error("package-lock must resolve markdown-it-footnote exactly to 4.0.0");
}
if (pkg.devDependencies?.["@fontsource/pretendard"] !== "5.3.0") {
  throw new Error("@fontsource/pretendard must be pinned exactly to 5.3.0");
}
if (lock.packages?.[""]?.version !== version) throw new Error("package-lock root version does not match");
if (lock.packages?.["node_modules/kordoc"]?.version !== KORDOC_VERSION) {
  throw new Error(`package-lock must resolve Kordoc exactly to ${KORDOC_VERSION}`);
}
if (lock.packages?.["node_modules/markdown-it"]?.version !== "14.3.3") {
  throw new Error("package-lock must resolve markdown-it exactly to 14.3.3");
}
if (lock.packages?.["node_modules/@fontsource/pretendard"]?.version !== "5.3.0") {
  throw new Error("package-lock must resolve @fontsource/pretendard exactly to 5.3.0");
}

// Kordoc 4.25.0 itself requires the patched zod (^4.6.7) and MCP SDK (^1.32.0), and
// adm-zip, protobufjs, and sharp are no longer installed, so the overrides that
// 4.15.7 needed are gone (R-029). The lockfile holds the transitive versions and
// the audit gate in CI fails on any new advisory.
const requiredOverrides = {
  moment: "2.31.0"
};
const retiredOverrides = [
  "adm-zip",
  "body-parser",
  "fast-uri",
  "hono",
  "@hono/node-server",
  "ip-address",
  "@modelcontextprotocol/sdk",
  "protobufjs",
  "proxy-addr",
  "qs",
  "sharp",
  "zod"
];
for (const name of retiredOverrides) {
  if (pkg.overrides?.[name] !== undefined) {
    throw new Error(`${name} override is retired with Kordoc 4.25.0; remove it or record why it is back`);
  }
}
if (lock.packages?.["node_modules/zod"]?.version !== "4.6.7") {
  throw new Error("package-lock must resolve zod to 4.6.7 (Kordoc 4.25.0 requirement)");
}
for (const [name, safeVersion] of Object.entries(requiredOverrides)) {
  if (pkg.overrides?.[name] !== safeVersion) {
    throw new Error(`${name} override must be pinned to ${safeVersion}`);
  }
  if (lock.packages?.[`node_modules/${name}`]?.version !== safeVersion) {
    throw new Error(`package-lock must resolve ${name} to ${safeVersion}`);
  }
}

if (!ciWorkflow.includes(`branches: ["${version}"]`)) {
  throw new Error(`CI workflow is not pinned to branch ${version}`);
}
if (!releaseWorkflow.includes(`tags: ["${version}"]`)) {
  throw new Error(`Release workflow is not pinned to tag ${version}`);
}
if (!releaseWorkflow.includes("uses: actions/attest@v4")) {
  throw new Error("Release workflow must attest the Community assets");
}
for (const asset of ["main.js", "manifest.json", "styles.css"]) {
  if (!releaseWorkflow.includes(`release/${asset}`)) {
    throw new Error(`Release workflow does not publish ${asset}`);
  }
}

// 2.7.0 W9: every interface text lives in src/i18n. The migration ratchet must stay empty
// so a release can never ship untranslated Korean interface text (R-019).
const i18nBaseline = await readJson("scripts/i18n-baseline.json");
if (Object.keys(i18nBaseline).length !== 0) {
  throw new Error("scripts/i18n-baseline.json must be empty: move interface text to src/i18n");
}

await Promise.all([
  access("main.js"),
  access("manifest.json"),
  access("styles.css"),
  access(`release-notes/${version}.md`)
]);

console.log(`Release check passed: HanMark ${version}, Obsidian ${manifest.minAppVersion}+, Kordoc ${KORDOC_VERSION}.`);
