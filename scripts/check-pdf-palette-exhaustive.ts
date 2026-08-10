import {
  contrastRatio,
  resolveEditorialPdfOnKey
} from "../src/io/editorialPdfTheme";

const MINIMUM_TEXT_CONTRAST = 4.5;
const MAXIMUM_TEXT_SURFACE_DELTA_E_OK = 0.02;
const MAX_RGB24 = 0xffffff;
const CANONICAL_HEX = /^#[0-9A-F]{6}$/u;
let aaaCount = 0;
let adjustedCount = 0;
let fallbackCount = 0;
let weakestRatio = Number.POSITIVE_INFINITY;
let weakestKey = "";
let weakestForeground = "";
let weakestSurface = "";

for (let rgb = 0; rgb <= MAX_RGB24; rgb += 1) {
  const key = `#${rgb.toString(16).padStart(6, "0").toUpperCase()}`;
  const resolved = resolveEditorialPdfOnKey(key);
  if (resolved.seed !== key) {
    throw new Error(`Automatic on-key resolver changed the seed ${key} to ${resolved.seed}.`);
  }
  if (!CANONICAL_HEX.test(resolved.surface) || !CANONICAL_HEX.test(resolved.foreground)) {
    throw new Error(
      `Automatic on-key resolver returned non-canonical colors for ${key}: `
      + `${resolved.surface}/${resolved.foreground}`
    );
  }
  const actualRatio = contrastRatio(resolved.foreground, resolved.surface);
  if (actualRatio !== resolved.ratio) {
    throw new Error(
      `Automatic on-key ratio drifted for ${key}: ${resolved.ratio} !== ${actualRatio}`
    );
  }
  if (resolved.ratio < MINIMUM_TEXT_CONTRAST) {
    throw new Error(
      `Automatic on-key contrast failed for ${key}/${resolved.surface}/`
      + `${resolved.foreground}: ${resolved.ratio}`
    );
  }
  if (resolved.strategy === "automatic-adjusted") {
    adjustedCount += 1;
    if (
      resolved.surface === key
      || resolved.foreground !== "#FFFFFF"
      || resolved.adjustmentDeltaEOK > MAXIMUM_TEXT_SURFACE_DELTA_E_OK
    ) {
      throw new Error(`Invalid adjusted on-key result for ${key}.`);
    }
  } else {
    if (resolved.surface !== key || resolved.adjustmentDeltaEOK !== 0) {
      throw new Error(`Exact/fallback on-key result changed the surface for ${key}.`);
    }
    if (resolved.strategy === "automatic-wcag-fallback") fallbackCount += 1;
  }
  if (resolved.aaa) aaaCount += 1;
  if (resolved.ratio < weakestRatio) {
    weakestRatio = resolved.ratio;
    weakestKey = key;
    weakestSurface = resolved.surface;
    weakestForeground = resolved.foreground;
  }
}

console.log(
  `Editorial PDF on-key exhaustive check passed for ${(MAX_RGB24 + 1).toLocaleString("en-US")} colors. ` +
  `Weakest pair ${weakestKey}/${weakestSurface}/${weakestForeground}=`
  + `${weakestRatio.toFixed(6)}:1; ${adjustedCount.toLocaleString("en-US")} adjusted; `
  + `${fallbackCount.toLocaleString("en-US")} used the WCAG fallback; `
  + `${aaaCount.toLocaleString("en-US")} reached 7:1.`
);
