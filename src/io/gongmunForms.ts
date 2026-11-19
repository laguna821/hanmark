import { AGENCY_COMMON_NAME, agencyNames, agencyStyle, type GongmunPreset } from "kordoc";
import {
  agencyLook,
  agencyOfLook,
  choiceOfPreset,
  completeFrameOptions,
  formatGongmunFormId,
  FRAME_OPTIONS,
  frameOfPreset,
  GONGMUN_FRAMES,
  gongmunFormChoice,
  isAgencyLook,
  isStyleLook,
  LOOK_BASIC,
  parseGongmunFormId,
  presetOfFrame,
  type GongmunFormChoice,
  type GongmunFrame,
  type GongmunFrameOption
} from "./gongmunFormId";
import { safeFileLabel } from "./exportFileNames";
import {
  getTemplateLibrary,
  gongmunStyleById,
  listGongmunStyleChoices,
  migrateGongmunFormIdWithLibrary,
  type GongmunStyleChoice,
  type TemplateLibraryHost
} from "./templateLibrary";
import { t, tKey, translate, type Locale, type MessageKey } from "../i18n";

/**
 * Frames and looks of official documents (3.0.0, R-030). gongmunFormId.ts holds the
 * id grammar; this file knows which looks exist (Kordoc's measured agency looks, the
 * built-in institution forms, the user's forms), which frame may use which look,
 * and how a form is named.
 */

/** Frames Kordoc's agency looks apply to (report and plan, bullet-style, ministry briefing, press release). */
export const AGENCY_FRAMES: readonly GongmunFrame[] = ["report", "gaejosik", "ministry", "press"];

const FRAME_LABEL: Readonly<Record<GongmunFrame, MessageKey>> = {
  official: "gongmun.frame.official",
  general: "gongmun.frame.general",
  report: "gongmun.frame.report",
  gaejosik: "gongmun.frame.gaejosik",
  ministry: "gongmun.frame.ministry",
  press: "gongmun.frame.press",
  bangchim: "gongmun.frame.bangchim"
};

const FRAME_DESCRIPTION: Readonly<Record<GongmunFrame, MessageKey>> = {
  official: "gongmun.frameDesc.official",
  general: "gongmun.frameDesc.general",
  report: "gongmun.frameDesc.report",
  gaejosik: "gongmun.frameDesc.gaejosik",
  ministry: "gongmun.frameDesc.ministry",
  press: "gongmun.frameDesc.press",
  bangchim: "gongmun.frameDesc.bangchim"
};

const FRAME_FILE_LABEL: Readonly<Record<GongmunFrame, MessageKey>> = {
  official: "gongmun.frameFile.official",
  general: "gongmun.frameFile.general",
  report: "gongmun.frameFile.report",
  gaejosik: "gongmun.frameFile.gaejosik",
  ministry: "gongmun.frameFile.ministry",
  press: "gongmun.frameFile.press",
  bangchim: "gongmun.frameFile.bangchim"
};

const OPTION_LABEL: Readonly<Record<GongmunFrameOption, MessageKey>> = {
  cover: "gongmun.frameOption.cover",
  checklist: "gongmun.frameOption.checklist",
  toc: "gongmun.frameOption.toc",
  closing: "gongmun.frameOption.closing"
};

/** Short names of the built-in institution looks in file names. */
const BUILTIN_LOOK_FILE_LABEL: Readonly<Record<string, MessageKey>> = {
  "builtin:hallym-ilsong": "gongmun.lookFile.hallymIlsong",
  "builtin:hallym-aicr": "gongmun.lookFile.hallymAicr"
};

export function gongmunFrameLabel(frame: GongmunFrame): string {
  return tKey(FRAME_LABEL[frame]);
}

export function gongmunFrameDescription(frame: GongmunFrame): string {
  return tKey(FRAME_DESCRIPTION[frame]);
}

export function gongmunFrameOptionLabel(frame: GongmunFrame, option: GongmunFrameOption): string {
  // The Seoul policy paper calls its first page 앞장, not 표지.
  return frame === "bangchim" && option === "cover" ? t("gongmun.frameOption.bangchimCover") : tKey(OPTION_LABEL[option]);
}

export type GongmunLookKind = "basic" | "common" | "agency" | "builtin" | "custom";
export type GongmunLookGroupKey =
  | "standard"
  | "institution"
  | "mine"
  | "ministry"
  | "office"
  | "agency"
  | "committee"
  | "other";

export interface GongmunLookEntry {
  id: string;
  name: string;
  kind: GongmunLookKind;
  groupKey: GongmunLookGroupKey;
  /** Group heading in the chooser. */
  group: string;
  /** The measured sample behind an agency look is small (fewer than five reports). */
  smallSample: boolean;
  description?: string;
  /** What an agency look puts on paper, shown in the chooser (body font and size, band colour). */
  detail?: GongmunLookDetail;
  /** A look of another frame, offered so it can be found; choosing it also switches to this frame. */
  switchesFrameTo?: GongmunFrame;
}

export interface GongmunLookDetail {
  font?: string;
  pt?: number;
  /** Chapter band colour as #RRGGBB, when the agency uses one. */
  band?: string;
}

/** The body font, size and band colour Kordoc measured for an agency ("공통" included). */
export function agencyLookDetail(name: string): GongmunLookDetail | undefined {
  let style: unknown;
  try {
    style = agencyStyle(name);
  } catch {
    return undefined;
  }
  const data = style as { report?: { p?: { font?: unknown; pt?: unknown } }; press?: { p?: { font?: unknown; pt?: unknown } }; band?: { fill?: unknown } } | undefined;
  const body = data?.report?.p ?? data?.press?.p;
  const detail: GongmunLookDetail = {};
  if (typeof body?.font === "string" && body.font) detail.font = body.font;
  if (typeof body?.pt === "number" && body.pt > 0) detail.pt = body.pt;
  if (typeof data?.band?.fill === "string" && /^#[0-9a-f]{6}$/iu.test(data.band.fill)) detail.band = data.band.fill.toUpperCase();
  return Object.keys(detail).length ? detail : undefined;
}

const AGENCY_GROUP_LABEL: Readonly<Record<"ministry" | "office" | "agency" | "committee" | "other", MessageKey>> = {
  ministry: "gongmun.look.group.ministry",
  office: "gongmun.look.group.office",
  agency: "gongmun.look.group.agency",
  committee: "gongmun.look.group.committee",
  other: "gongmun.look.group.other"
};

// i18n-data-begin: endings of Korean central agency names (부, 처, 청, 위원회)
const AGENCY_SUFFIXES: ReadonlyArray<[string, "ministry" | "office" | "agency" | "committee"]> = [
  ["위원회", "committee"],
  ["부", "ministry"],
  ["처", "office"],
  ["청", "agency"]
];
// i18n-data-end

/** 부 / 처 / 청 / 위원회 by the agency name's ending; anything else (국무조정실) is "other". */
export function agencyGroupOf(name: string): "ministry" | "office" | "agency" | "committee" | "other" {
  return AGENCY_SUFFIXES.find(([suffix]) => name.endsWith(suffix))?.[1] ?? "other";
}

let agencyCache: { names: string[]; small: Set<string> } | null = null;

/** Kordoc's agencies (the engine's own list, never a copy) and those with a small measured sample. */
function agencies(): { names: string[]; small: Set<string> } {
  if (agencyCache) return agencyCache;
  const names = agencyNames().filter((name) => name !== AGENCY_COMMON_NAME);
  const small = new Set<string>();
  for (const name of names) {
    let docs: unknown;
    try {
      docs = (agencyStyle(name) as { report?: { docs?: unknown } } | undefined)?.report?.docs;
    } catch {
      docs = undefined;
    }
    if (!(typeof docs === "number" && docs >= 5)) small.add(name);
  }
  agencyCache = { names, small };
  return agencyCache;
}

export function isKnownAgency(name: string): boolean {
  return name === AGENCY_COMMON_NAME || agencies().names.includes(name);
}

export function isSmallSampleAgency(name: string): boolean {
  return agencies().small.has(name);
}

function styleFrame(style: GongmunStyleChoice): GongmunFrame | undefined {
  return style.preset ? frameOfPreset(style.preset).frame : undefined;
}

function styleEntry(style: GongmunStyleChoice): GongmunLookEntry {
  return {
    id: style.id,
    name: style.name,
    kind: style.builtIn ? "builtin" : "custom",
    groupKey: style.builtIn ? "institution" : "mine",
    group: style.builtIn ? (style.group ?? "") : t("gongmun.form.group.mine"),
    smallSample: false,
    description: style.description
  };
}

function agencyEntry(name: string): GongmunLookEntry {
  const groupKey = agencyGroupOf(name);
  return {
    id: agencyLook(name),
    name,
    kind: "agency",
    groupKey,
    group: tKey(AGENCY_GROUP_LABEL[groupKey]),
    smallSample: isSmallSampleAgency(name),
    description: t("gongmun.look.agencyDesc", { name }),
    ...withDetail(agencyLookDetail(name))
  };
}

function withDetail(detail: GongmunLookDetail | undefined): { detail?: GongmunLookDetail } {
  return detail ? { detail } : {};
}

function commonEntry(standard: string): GongmunLookEntry {
  return {
    id: agencyLook(AGENCY_COMMON_NAME),
    name: t("gongmun.look.common"),
    kind: "common",
    groupKey: "standard",
    group: standard,
    smallSample: false,
    description: t("gongmun.look.commonDesc"),
    ...withDetail(agencyLookDetail(AGENCY_COMMON_NAME))
  };
}

function sortedAgencyEntries(): GongmunLookEntry[] {
  const order = ["ministry", "office", "agency", "committee", "other"];
  return [...agencies().names]
    .sort((left, right) => order.indexOf(agencyGroupOf(left)) - order.indexOf(agencyGroupOf(right)) || left.localeCompare(right, "ko"))
    .map(agencyEntry);
}

/**
 * 공통 and the 52 agency looks for a frame that cannot use them, so the chooser can
 * still show what exists; each one switches the form to the 보고서 frame when chosen.
 */
export function agencyLooksForOtherFrame(frame: GongmunFrame): GongmunLookEntry[] {
  if (AGENCY_FRAMES.includes(frame)) return [];
  const to: GongmunFrame = "report";
  return [commonEntry(t("gongmun.look.group.standard")), ...sortedAgencyEntries()].map((look) => ({ ...look, switchesFrameTo: to }));
}

/** Every look the frame can use: 기본, then 공통 and the agencies, the institution forms, the user's forms. */
export function listGongmunLooks(host: TemplateLibraryHost, frame: GongmunFrame): GongmunLookEntry[] {
  const standard = t("gongmun.look.group.standard");
  const looks: GongmunLookEntry[] = [
    { id: LOOK_BASIC, name: t("gongmun.look.basic"), kind: "basic", groupKey: "standard", group: standard, smallSample: false, description: t("gongmun.look.basicDesc") }
  ];
  const styles = listGongmunStyleChoices(host).filter((style) => {
    const made = styleFrame(style);
    return made === undefined || made === frame;
  });
  if (AGENCY_FRAMES.includes(frame)) looks.push(commonEntry(standard));
  looks.push(...styles.filter((style) => style.builtIn).map(styleEntry));
  looks.push(...styles.filter((style) => !style.builtIn).map(styleEntry));
  if (AGENCY_FRAMES.includes(frame)) looks.push(...sortedAgencyEntries());
  return looks;
}

export function gongmunLookAllowed(host: TemplateLibraryHost, frame: GongmunFrame, look: string): boolean {
  if (look === LOOK_BASIC) return true;
  const agency = agencyOfLook(look);
  if (agency !== undefined) return AGENCY_FRAMES.includes(frame) && isKnownAgency(agency);
  const style = gongmunStyleById(host, look);
  if (!style) return false;
  const made = styleFrame(style);
  return made === undefined || made === frame;
}

export interface ResolvedGongmunForm {
  /** Canonical "form:…" id. */
  id: string;
  choice: GongmunFormChoice;
  /** Kordoc document type the form makes. */
  preset: GongmunPreset;
  /** Built-in institution form or the user's form behind the look. */
  style?: GongmunStyleChoice;
  /** Kordoc agency name behind the look ("공통" included). */
  agency?: string;
  /** The look was made for one document type, so the frame's switches do not apply. */
  fixed: boolean;
}

/**
 * A 3.0.0 or 2.7.x form id as a usable form; undefined when the look no longer
 * exists or the frame cannot use it. A look made for one document type decides the
 * frame and its switches.
 */
export function resolveGongmunForm(host: TemplateLibraryHost, id: unknown): ResolvedGongmunForm | undefined {
  const migrated = migrateGongmunFormIdWithLibrary(getTemplateLibrary(host), id);
  const parsed = parseGongmunFormId(migrated);
  if (!parsed) return undefined;
  if (isAgencyLook(parsed.look)) {
    if (!gongmunLookAllowed(host, parsed.frame, parsed.look)) return undefined;
    return {
      id: formatGongmunFormId(parsed),
      choice: parsed,
      preset: presetOfFrame(parsed.frame, parsed.options),
      agency: agencyOfLook(parsed.look),
      fixed: false
    };
  }
  if (isStyleLook(parsed.look)) {
    const style = gongmunStyleById(host, parsed.look);
    if (!style) return undefined;
    const choice = style.preset ? choiceOfPreset(style.preset, parsed.look) : parsed;
    return {
      id: formatGongmunFormId(choice),
      choice,
      preset: style.preset ?? presetOfFrame(choice.frame, choice.options),
      style,
      fixed: style.preset !== undefined
    };
  }
  if (parsed.look !== LOOK_BASIC) return undefined;
  return { id: formatGongmunFormId(parsed), choice: parsed, preset: presetOfFrame(parsed.frame, parsed.options), fixed: false };
}

/** The same form in another frame: the look stays when the frame can use it, switches start at the frame's defaults. */
export function withGongmunFrame(host: TemplateLibraryHost, id: string, frame: GongmunFrame): string {
  const current = resolveGongmunForm(host, id);
  const keep = current && !current.fixed && gongmunLookAllowed(host, frame, current.choice.look);
  const options = current && current.choice.frame === frame && !current.fixed ? current.choice.options : {};
  return formatGongmunFormId(gongmunFormChoice(frame, keep ? current.choice.look : LOOK_BASIC, options));
}

/** The same frame with another look; a look made for one document type brings its own frame. */
export function withGongmunLook(host: TemplateLibraryHost, id: string, look: string): string {
  const current = resolveGongmunForm(host, id);
  const frame = current?.choice.frame ?? "report";
  const style = isStyleLook(look) ? gongmunStyleById(host, look) : undefined;
  if (style?.preset) return formatGongmunFormId(choiceOfPreset(style.preset, look));
  const allowed = gongmunLookAllowed(host, frame, look);
  return formatGongmunFormId(gongmunFormChoice(frame, allowed ? look : LOOK_BASIC, current && !current.fixed ? current.choice.options : {}));
}

export function withGongmunFrameOption(host: TemplateLibraryHost, id: string, option: GongmunFrameOption, value: boolean): string {
  const current = resolveGongmunForm(host, id);
  if (!current || current.fixed || !FRAME_OPTIONS[current.choice.frame].includes(option)) return current?.id ?? id;
  return formatGongmunFormId({ ...current.choice, options: completeFrameOptions(current.choice.frame, { ...current.choice.options, [option]: value }) });
}

function lookNameIn(form: ResolvedGongmunForm, locale?: Locale): string {
  const say = (key: MessageKey): string => (locale ? translate(locale, key) : tKey(key));
  if (form.style) return form.style.name;
  if (form.agency === AGENCY_COMMON_NAME) return say("gongmun.look.common");
  return form.agency ?? say("gongmun.look.basic");
}

/** The look's name as the chooser button shows it. */
export function gongmunLookName(host: TemplateLibraryHost, id: string): string {
  const form = resolveGongmunForm(host, id);
  return form ? lookNameIn(form) : t("gongmun.look.basic");
}

/** "보고서 · 국세청 (표지, 목차)": the frame, the look unless it is 기본, and the switches that are on. */
export function gongmunFormName(host: TemplateLibraryHost, id: string): string {
  const form = resolveGongmunForm(host, id);
  if (!form) return "";
  const frame = gongmunFrameLabel(form.choice.frame);
  const base = form.choice.look === LOOK_BASIC ? frame : t("gongmun.form.name", { frame, look: lookNameIn(form) });
  if (form.fixed) return base;
  const on = FRAME_OPTIONS[form.choice.frame]
    .filter((option) => form.choice.options[option])
    .map((option) => gongmunFrameOptionLabel(form.choice.frame, option));
  return on.length ? t("gongmun.form.nameOptions", { name: base, options: on.join(", ") }) : base;
}

/**
 * The form in exported file names (R-028, R-030): `틀_모양` in the note's output
 * language so the same note gets the same name on every computer; 기본 adds nothing.
 */
export function gongmunFormFileLabel(host: TemplateLibraryHost, id: string, locale: Locale): string {
  const form = resolveGongmunForm(host, id);
  if (!form) return "";
  const frame = translate(locale, FRAME_FILE_LABEL[form.choice.frame]);
  if (form.choice.look === LOOK_BASIC) return frame;
  const builtin = form.style?.builtIn ? BUILTIN_LOOK_FILE_LABEL[form.style.id] : undefined;
  const look = builtin
    ? translate(locale, builtin)
    : form.style
      ? safeFileLabel(form.style.name)
      : form.agency === AGENCY_COMMON_NAME
        ? translate(locale, "gongmun.lookFile.common")
        : safeFileLabel(form.agency ?? "");
  return look ? `${frame}_${look}` : frame;
}

/**
 * A look a note names in 공문_기관서식: an agency, 공통, 기본, or the name of an
 * institution form or one of the user's forms. Undefined when nothing matches.
 */
export function gongmunLookByName(host: TemplateLibraryHost, name: string): string | undefined {
  const wanted = name.normalize("NFC").replace(/\s+/gu, "").toLowerCase();
  if (!wanted) return undefined;
  const same = (text: string): boolean => text.normalize("NFC").replace(/\s+/gu, "").toLowerCase() === wanted;
  if (same(AGENCY_COMMON_NAME) || same(t("gongmun.look.common")) || wanted === "common") return agencyLook(AGENCY_COMMON_NAME);
  if (same(t("gongmun.look.basic")) || wanted === "basic") return LOOK_BASIC;
  const agency = agencies().names.find(same);
  if (agency) return agencyLook(agency);
  return listGongmunStyleChoices(host).find((style) => same(style.name) || style.id.toLowerCase() === wanted)?.id;
}

export { GONGMUN_FRAMES };
