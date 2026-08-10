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

const version = manifest.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid manifest version: ${version}`);
if (pkg.version !== version) throw new Error(`package.json ${pkg.version} != manifest.json ${version}`);
if (manifest.minAppVersion !== "1.8.9") {
  throw new Error(`Editorial PDF requires minAppVersion 1.8.9, found ${manifest.minAppVersion}`);
}
if (versions[version] !== manifest.minAppVersion) {
  throw new Error(`versions.json ${versions[version]} != minAppVersion ${manifest.minAppVersion}`);
}
if (pkg.dependencies?.kordoc !== "4.2.5") throw new Error("kordoc must be pinned exactly to 4.2.5");
if (pkg.dependencies?.["markdown-it"] !== "14.3.0") {
  throw new Error("markdown-it must be pinned exactly to 14.3.0");
}
if (pkg.devDependencies?.["@fontsource/pretendard"] !== "5.3.0") {
  throw new Error("@fontsource/pretendard must be pinned exactly to 5.3.0");
}
if (lock.packages?.[""]?.version !== version) throw new Error("package-lock root version does not match");
if (lock.packages?.["node_modules/kordoc"]?.version !== "4.2.5") {
  throw new Error("package-lock must resolve Kordoc exactly to 4.2.5");
}
if (lock.packages?.["node_modules/markdown-it"]?.version !== "14.3.0") {
  throw new Error("package-lock must resolve markdown-it exactly to 14.3.0");
}
if (lock.packages?.["node_modules/@fontsource/pretendard"]?.version !== "5.3.0") {
  throw new Error("package-lock must resolve @fontsource/pretendard exactly to 5.3.0");
}

const requiredOverrides = {
  "adm-zip": "0.6.0",
  "fast-uri": "3.1.5",
  hono: "4.12.34",
  "ip-address": "10.3.1",
  protobufjs: "8.7.1",
  sharp: "0.35.3"
};
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

await Promise.all([
  access("main.js"),
  access("manifest.json"),
  access("styles.css"),
  access(`release-notes/${version}.md`)
]);

console.log(`Release check passed: HanMark ${version}, Obsidian ${manifest.minAppVersion}+, Kordoc 4.2.5.`);
