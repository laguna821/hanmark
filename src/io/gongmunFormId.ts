import type { GongmunPreset } from "kordoc";

/**
 * Official-document forms as a pair (3.0.0, R-030): a 틀 (frame: the page structure)
 * and a 모양 (look: fonts, sizes, markers, colors). The ten forms of 2.7.x were one
 * flat list in which a plan was a report with a cover, minutes were a notice at
 * another size, and the Hallym forms were looks on top of minutes and reports.
 *
 * This file is the pure id grammar. A form id is one string so every place that
 * already carries a form id (note memory, the preview, several forms at once)
 * keeps working:
 *
 *   form:<frame>/<look>[;<option>=0|1 …]
 *
 * Options are written in a fixed order and only when they differ from the frame's
 * default, so the same choice always has the same id.
 */
export const GONGMUN_FRAMES = ["official", "general", "report", "gaejosik", "ministry", "press", "bangchim"] as const;
export type GongmunFrame = (typeof GONGMUN_FRAMES)[number];

export const FRAME_OPTION_NAMES = ["cover", "checklist", "toc", "closing"] as const;
export type GongmunFrameOption = (typeof FRAME_OPTION_NAMES)[number];

/** The switches each frame offers, in display order. */
export const FRAME_OPTIONS: Readonly<Record<GongmunFrame, readonly GongmunFrameOption[]>> = {
  official: [],
  general: ["closing"],
  report: ["cover", "toc"],
  gaejosik: ["cover", "toc"],
  ministry: [],
  press: [],
  bangchim: ["cover", "checklist", "toc"]
};

/** A switch is off unless listed here (the bullet-style report has a cover and contents). */
const FRAME_OPTION_ON_BY_DEFAULT: Readonly<Partial<Record<GongmunFrame, readonly GongmunFrameOption[]>>> = {
  gaejosik: ["cover", "toc"]
};

export function frameOptionDefault(frame: GongmunFrame, option: GongmunFrameOption): boolean {
  return FRAME_OPTION_ON_BY_DEFAULT[frame]?.includes(option) ?? false;
}

export const LOOK_BASIC = "basic";
export const LOOK_AGENCY_PREFIX = "agency:";
export const LOOK_BUILTIN_PREFIX = "builtin:";
export const LOOK_CUSTOM_PREFIX = "gongmun:";
export const FORM_ID_PREFIX = "form:";
const LEGACY_PRESET_PREFIX = "preset:";

export type GongmunFrameOptions = Partial<Record<GongmunFrameOption, boolean>>;

export interface GongmunFormChoice {
  frame: GongmunFrame;
  /** "basic", "agency:<name>", "builtin:<id>", or the id of the user's own form. */
  look: string;
  /** Effective value of every switch the frame offers. */
  options: GongmunFrameOptions;
}

export function isGongmunFrame(value: unknown): value is GongmunFrame {
  return typeof value === "string" && (GONGMUN_FRAMES as readonly string[]).includes(value);
}

/** Every switch of the frame with a value; switches of other frames are dropped. */
export function completeFrameOptions(frame: GongmunFrame, options: GongmunFrameOptions = {}): GongmunFrameOptions {
  const complete: GongmunFrameOptions = {};
  for (const option of FRAME_OPTIONS[frame]) complete[option] = options[option] ?? frameOptionDefault(frame, option);
  return complete;
}

export function gongmunFormChoice(frame: GongmunFrame, look: string = LOOK_BASIC, options: GongmunFrameOptions = {}): GongmunFormChoice {
  return { frame, look: look || LOOK_BASIC, options: completeFrameOptions(frame, options) };
}

export function formatGongmunFormId(choice: GongmunFormChoice): string {
  const flags = FRAME_OPTIONS[choice.frame]
    .filter((option) => (choice.options[option] ?? frameOptionDefault(choice.frame, option)) !== frameOptionDefault(choice.frame, option))
    .map((option) => `;${option}=${choice.options[option] ? 1 : 0}`)
    .join("");
  return `${FORM_ID_PREFIX}${choice.frame}/${choice.look || LOOK_BASIC}${flags}`;
}

/** A "form:…" id as a choice; undefined for anything else (including 2.7.x ids). */
export function parseGongmunFormId(id: unknown): GongmunFormChoice | undefined {
  if (typeof id !== "string" || !id.startsWith(FORM_ID_PREFIX)) return undefined;
  const [head, ...flags] = id.slice(FORM_ID_PREFIX.length).split(";");
  const slash = head.indexOf("/");
  if (slash < 0) return undefined;
  const frame = head.slice(0, slash);
  const look = head.slice(slash + 1).trim();
  if (!isGongmunFrame(frame) || !look) return undefined;
  const options: GongmunFrameOptions = {};
  for (const flag of flags) {
    const [name, value] = flag.split("=");
    if (!(FRAME_OPTION_NAMES as readonly string[]).includes(name) || (value !== "0" && value !== "1")) return undefined;
    options[name as GongmunFrameOption] = value === "1";
  }
  return gongmunFormChoice(frame, look, options);
}

/**
 * The frame and switches that make a 2.7.x document type: a plan is a report with a
 * cover, a notice is a general document with the closing lines, minutes are a
 * general document without them.
 */
export function frameOfPreset(preset: GongmunPreset): { frame: GongmunFrame; options: GongmunFrameOptions } {
  switch (preset) {
    case "plan":
      return { frame: "report", options: { cover: true } };
    case "report":
      return { frame: "report", options: { cover: false } };
    case "notice":
      return { frame: "general", options: { closing: true } };
    case "minutes":
      return { frame: "general", options: { closing: false } };
    case "official":
    case "gaejosik":
    case "ministry":
    case "press":
    case "bangchim":
      return { frame: preset, options: {} };
    default:
      return { frame: "report", options: {} };
  }
}

/** The Kordoc document type a frame makes with its switches. */
export function presetOfFrame(frame: GongmunFrame, options: GongmunFrameOptions = {}): GongmunPreset {
  if (frame === "general") return options.closing ? "notice" : "minutes";
  if (frame === "report") return options.cover ? "plan" : "report";
  return frame;
}

export function choiceOfPreset(preset: GongmunPreset, look: string = LOOK_BASIC): GongmunFormChoice {
  const { frame, options } = frameOfPreset(preset);
  return gongmunFormChoice(frame, look, options);
}

/** True for ids the look axis understands without a library lookup. */
export function isAgencyLook(look: string): boolean {
  return look.startsWith(LOOK_AGENCY_PREFIX) && look.length > LOOK_AGENCY_PREFIX.length;
}

export function agencyOfLook(look: string): string | undefined {
  return isAgencyLook(look) ? look.slice(LOOK_AGENCY_PREFIX.length) : undefined;
}

export function agencyLook(name: string): string {
  return `${LOOK_AGENCY_PREFIX}${name}`;
}

/** A look that brings its own document type (a built-in institution form or the user's form). */
export function isStyleLook(look: string): boolean {
  return look.startsWith(LOOK_BUILTIN_PREFIX) || look.startsWith(LOOK_CUSTOM_PREFIX);
}

/**
 * A 2.7.x form id ("preset:<type>", "builtin:<id>", "gongmun:<uuid>") as a 3.0.0 id.
 * `presetOfStyle` gives the document type a style was made for; a user's form saved
 * without one takes `fallback` (the type chosen last in 2.7.x).
 */
export function migrateLegacyFormId(
  id: unknown,
  presetOfStyle: (styleId: string) => GongmunPreset | undefined,
  isPreset: (value: string) => value is GongmunPreset,
  fallback: GongmunPreset = "report"
): string | undefined {
  if (typeof id !== "string") return undefined;
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith(FORM_ID_PREFIX)) return parseGongmunFormId(trimmed) ? trimmed : undefined;
  if (trimmed.startsWith(LEGACY_PRESET_PREFIX)) {
    const preset = trimmed.slice(LEGACY_PRESET_PREFIX.length);
    return isPreset(preset) ? formatGongmunFormId(choiceOfPreset(preset)) : undefined;
  }
  if (isStyleLook(trimmed)) return formatGongmunFormId(choiceOfPreset(presetOfStyle(trimmed) ?? fallback, trimmed));
  return undefined;
}

// i18n-data-begin: Kordoc preset ids
const PRESETS_IN_MENU_ORDER: readonly GongmunPreset[] = ["official", "report", "plan", "notice", "minutes", "gaejosik", "press", "ministry", "bangchim"];
// i18n-data-end

/** Document types of a frame, in menu order (보고서: 보고서, 계획서; 일반 문서: 통지·안내, 회의록). */
export function presetsOfFrame(frame: GongmunFrame): GongmunPreset[] {
  return PRESETS_IN_MENU_ORDER.filter((preset) => frameOfPreset(preset).frame === frame);
}
