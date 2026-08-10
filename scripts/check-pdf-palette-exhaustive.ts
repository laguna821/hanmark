import { resolveEditorialPdfOnKey } from "../src/io/editorialPdfTheme";

const MINIMUM_TEXT_CONTRAST = 4.5;
const MAX_RGB24 = 0xffffff;
let aaaCount = 0;
let weakestRatio = Number.POSITIVE_INFINITY;
let weakestKey = "";
let weakestForeground = "";

for (let rgb = 0; rgb <= MAX_RGB24; rgb += 1) {
  const key = `#${rgb.toString(16).padStart(6, "0").toUpperCase()}`;
  const resolved = resolveEditorialPdfOnKey(key);
  if (resolved.ratio < MINIMUM_TEXT_CONTRAST) {
    throw new Error(
      `Automatic on-key contrast failed for ${key}/${resolved.color}: ${resolved.ratio}`
    );
  }
  if (resolved.aaa) aaaCount += 1;
  if (resolved.ratio < weakestRatio) {
    weakestRatio = resolved.ratio;
    weakestKey = key;
    weakestForeground = resolved.color;
  }
}

console.log(
  `Editorial PDF on-key exhaustive check passed for ${(MAX_RGB24 + 1).toLocaleString("en-US")} colors. ` +
  `Weakest pair ${weakestKey}/${weakestForeground}=${weakestRatio.toFixed(6)}:1; ` +
  `${aaaCount.toLocaleString("en-US")} colors reached 7:1.`
);
