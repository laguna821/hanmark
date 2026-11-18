/**
 * Families of the official-document check (R-035). Kept apart from the check itself
 * so that settings code does not pull in the engine.
 */
export type CheckFamily = "notation" | "munche" | "budget" | "logic" | "slop";

export const CHECK_FAMILIES: readonly CheckFamily[] = ["notation", "munche", "budget", "logic", "slop"];

export type CheckFamilySwitches = Readonly<Record<CheckFamily, boolean>>;

/** Defaults measured on real documents (R-035): logic and AI-style wording are off. */
export const DEFAULT_CHECK_FAMILIES: CheckFamilySwitches = Object.freeze({
  notation: true,
  munche: true,
  budget: true,
  logic: false,
  slop: false
});