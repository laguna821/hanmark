import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const stylesUrl = new URL("styles.css", root);
const startMarker = "/* HANMARK_PRETENDARD_GENERATED_START */";
const endMarker = "/* HANMARK_PRETENDARD_GENERATED_END */";
const fonts = [
  {
    file: "files/pretendard-latin-400-normal.woff2",
    weight: 400,
    sha256: "fad853f7f47c6c8b103171e7193fa095708cdcd70850a71d93aa5379e8a61d63"
  },
  {
    file: "files/pretendard-latin-600-normal.woff2",
    weight: 600,
    sha256: "c863f76a7de5c1ddc1ed8b2fa794964530774592c4f31407a84e2a2ae93f17f0"
  }
];

const packageJsonPath = require.resolve("@fontsource/pretendard/package.json");
const packageRoot = dirname(packageJsonPath);
const metadata = JSON.parse(await readFile(packageJsonPath, "utf8"));
if (metadata.version !== "5.3.0" || metadata.license !== "OFL-1.1") {
  throw new Error(
    `Unexpected Pretendard package metadata: ${metadata.version} ${metadata.license}`
  );
}

const license = (await readFile(join(packageRoot, "LICENSE"), "utf8"))
  .replaceAll("*/", "* /")
  .trim();
const rules = [];
let total = 0;
for (const font of fonts) {
  const bytes = await readFile(join(packageRoot, font.file));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== font.sha256) {
    throw new Error(
      `Pretendard ${font.weight} hash mismatch: ${digest} != ${font.sha256}`
    );
  }
  total += bytes.byteLength;
  rules.push(`@font-face {
  font-family: "HanMark Pretendard";
  font-style: normal;
  font-weight: ${font.weight};
  font-display: block;
  src: url("data:font/woff2;base64,${bytes.toString("base64")}") format("woff2");
}`);
}

const generated = `${startMarker}
/*
 * Pretendard ${metadata.version}, Copyright (c) 2021 Kil Hyung-Jin.
 * Embedded unchanged under the SIL Open Font License 1.1.
 *
${license.split("\n").map((line) => ` * ${line.trimEnd()}`.trimEnd()).join("\n")}
 */
${rules.join("\n\n")}
${endMarker}`;
const styles = await readFile(stylesUrl, "utf8");
const start = styles.indexOf(startMarker);
const end = styles.indexOf(endMarker);
if (start < 0 || end < start) {
  throw new Error("Pretendard generation markers are missing from styles.css.");
}
const next =
  styles.slice(0, start) +
  generated +
  styles.slice(end + endMarker.length);
await writeFile(stylesUrl, next, "utf8");
console.log(
  `Embedded Pretendard 400/600 (${(total / 1024 / 1024).toFixed(2)} MB) into styles.css`
);
