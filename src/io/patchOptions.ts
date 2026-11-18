import type { PatchOptions } from "kordoc";

/**
 * Options for every patchHwpx/patchHwp call (saving a note back into its source
 * document). They keep the Kordoc 4.15.7 behaviour for now (R-029):
 * - structure false: added or removed paragraphs are reported as skipped, as
 *   before 4.22.15, instead of being cloned into or cut from the original.
 * - keepLineseg true: HWP 5 keeps the stored line layout of edited paragraphs,
 *   as before 4.22.16.
 */
export const PATCH_OPTIONS: Readonly<PatchOptions> = Object.freeze({
  verify: true,
  structure: false,
  keepLineseg: true
});
