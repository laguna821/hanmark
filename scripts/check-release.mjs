import { access, readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const [manifest, pkg, versions] = await Promise.all([
  readJson("manifest.json"),
  readJson("package.json"),
  readJson("versions.json")
]);

const version = manifest.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid manifest version: ${version}`);
if (pkg.version !== version) throw new Error(`package.json ${pkg.version} != manifest.json ${version}`);
if (versions[version] !== manifest.minAppVersion) {
  throw new Error(`versions.json ${versions[version]} != minAppVersion ${manifest.minAppVersion}`);
}
if (pkg.dependencies?.kordoc !== "4.2.5") throw new Error("kordoc must be pinned exactly to 4.2.5");

await Promise.all([
  access("main.js"),
  access("manifest.json"),
  access("styles.css"),
  access(`release-notes/${version}.md`)
]);

console.log(`Release check passed: HanMark ${version}, Obsidian ${manifest.minAppVersion}+, Kordoc 4.2.5.`);
