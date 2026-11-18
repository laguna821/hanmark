import type { App, TFile } from "obsidian";
import { incompatibleGongmunWarnings, type FormatProfile, type GongmunOptions, type GongmunPreset } from "kordoc";
import type { AdapterWarning } from "./markdownAdapter";
import { readGongmunProperties, type GongmunPropertyIssue } from "./gongmunProperties";
import { applyTypeFrame, resolveGongmunOptions, withCoverDate } from "./gongmunStyle";
import {
  getTemplateLibrary,
  isGongmunPreset,
  listGongmunStyleChoices,
  setActiveGongmunFormInMemory,
  setActiveGongmunPresetInMemory,
  setActiveGongmunTemplateInMemory,
  type TemplateLibraryHost
} from "./templateLibrary";
import {
  choiceOfPreset,
  formatGongmunFormId,
  frameOfPreset,
  GONGMUN_FRAMES,
  gongmunFormChoice,
  LOOK_BASIC,
  type GongmunFrame
} from "./gongmunFormId";
import {
  gongmunFormFileLabel,
  gongmunFormName,
  gongmunFrameDescription,
  gongmunFrameLabel,
  gongmunLookAllowed,
  gongmunLookByName,
  resolveGongmunForm,
  withGongmunLook,
  type ResolvedGongmunForm
} from "./gongmunForms";
import type { GongmunFinishSpec } from "./hwpxFinish";
import type { GongmunOutlineStyle } from "./gongmunOutline";
import type { GenerateHwpxOptions } from "./kordocEngine";
import type { SampleLookRecord } from "./sampleLook";
import { t, tKey, type Locale, type MessageKey } from "../i18n";

export const DEFAULT_GONGMUN_PRESET: GongmunPreset = "report";

/** Kordoc's official-document presets, in menu order; `fileLabel` is the type's short name. */
export const GONGMUN_PRESETS: ReadonlyArray<{
  value: GongmunPreset;
  label: MessageKey;
  description: MessageKey;
  fileLabel: MessageKey;
}> = [
  { value: "official", label: "gongmun.preset.official", description: "gongmun.presetDesc.official", fileLabel: "gongmun.fileName.official" },
  { value: "report", label: "gongmun.preset.report", description: "gongmun.presetDesc.report", fileLabel: "gongmun.fileName.report" },
  { value: "plan", label: "gongmun.preset.plan", description: "gongmun.presetDesc.plan", fileLabel: "gongmun.fileName.plan" },
  { value: "notice", label: "gongmun.preset.notice", description: "gongmun.presetDesc.notice", fileLabel: "gongmun.fileName.notice" },
  { value: "minutes", label: "gongmun.preset.minutes", description: "gongmun.presetDesc.minutes", fileLabel: "gongmun.fileName.minutes" },
  { value: "gaejosik", label: "gongmun.preset.gaejosik", description: "gongmun.presetDesc.gaejosik", fileLabel: "gongmun.fileName.gaejosik" },
  { value: "press", label: "gongmun.preset.press", description: "gongmun.presetDesc.press", fileLabel: "gongmun.fileName.press" },
  { value: "ministry", label: "gongmun.preset.ministry", description: "gongmun.presetDesc.ministry", fileLabel: "gongmun.fileName.ministry" },
  { value: "bangchim", label: "gongmun.preset.bangchim", description: "gongmun.presetDesc.bangchim", fileLabel: "gongmun.fileName.bangchim" }
];

export function gongmunPresetLabel(preset: GongmunPreset): string {
  const entry = GONGMUN_PRESETS.find((item) => item.value === preset);
  return entry ? tKey(entry.label) : preset;
}

/**
 * One official-document form as a list shows it. Since 3.0.0 (R-030) a form is a
 * pair, a frame (틀: the page structure) and a look (모양: fonts, sizes, markers,
 * colors), carried as one id "form:<frame>/<look>…" so one choice still decides
 * both (R-026).
 */
export interface GongmunFormOption {
  /** "form:<frame>/<look>[;option=0|1…]". */
  id: string;
  name: string;
  kind: "standard" | "builtin" | "custom";
  /** List group: the frames, the institution, or "mine". */
  group: string;
  preset: GongmunPreset;
  description?: string;
  frame: GongmunFrame;
  look: string;
  /** The look was made for one document type; the frame's switches do not apply. */
  fixed: boolean;
}

/** The form of a standard type in the 기본 look (계획서 = 보고서 with a cover, and so on). */
export function gongmunFormId(preset: GongmunPreset): string {
  return formatGongmunFormId(choiceOfPreset(preset));
}

/** The document type a form id makes, old or new; undefined when it is not a form. */
export function presetOfFormId(host: TemplateLibraryHost, id: string): GongmunPreset | undefined {
  return resolveGongmunForm(host, id)?.preset;
}

function optionOf(host: TemplateLibraryHost, form: ResolvedGongmunForm): GongmunFormOption {
  const kind = form.style ? (form.style.builtIn ? "builtin" : "custom") : "standard";
  return {
    id: form.id,
    name: gongmunFormName(host, form.id),
    kind,
    group:
      kind === "builtin" ? (form.style?.group ?? "") : kind === "custom" ? t("gongmun.form.group.mine") : t("gongmun.form.group.standard"),
    preset: form.preset,
    description:
      kind === "builtin"
        ? form.style?.description
        : kind === "custom"
          ? t("gongmun.form.customDesc", { preset: gongmunPresetLabel(form.preset) })
          : gongmunFrameDescription(form.choice.frame),
    frame: form.choice.frame,
    look: form.choice.look,
    fixed: form.fixed
  };
}

/** A form by id (3.0.0 ids and the ids 2.7.x stored); undefined when it no longer exists. */
export function describeGongmunForm(host: TemplateLibraryHost, id: string | null | undefined): GongmunFormOption | undefined {
  const form = id ? resolveGongmunForm(host, id) : undefined;
  return form ? optionOf(host, form) : undefined;
}

export function isGongmunForm(host: TemplateLibraryHost, id: string | null | undefined): boolean {
  return Boolean(id && resolveGongmunForm(host, id));
}

/** The canonical 3.0.0 id of a stored id, else undefined (used when old data is loaded). */
export function canonicalGongmunFormId(host: TemplateLibraryHost, id: unknown): string | undefined {
  return resolveGongmunForm(host, id)?.id;
}

/** `틀_모양` for exported file names in the note's output language (R-028, R-030). */
export function gongmunFileLabel(host: TemplateLibraryHost, formId: string, locale: Locale): string {
  return gongmunFormFileLabel(host, formId, locale);
}

/**
 * The forms a short list offers (the status bar menu, several forms at once): the
 * seven frames and the two variants that were separate types in 2.7.x (a report with
 * a cover, a general document with closing lines), then the institution forms and
 * the user's forms. With `baseId`, frames keep that form's look where they can use it.
 * Any other frame-and-look pair comes from the look chooser (describeGongmunForm).
 */
export function listGongmunForms(host: TemplateLibraryHost, baseId?: string): GongmunFormOption[] {
  const base = baseId ? resolveGongmunForm(host, baseId) : undefined;
  const look = (frame: GongmunFrame): string =>
    base && !base.fixed && gongmunLookAllowed(host, frame, base.choice.look) ? base.choice.look : LOOK_BASIC;
  const ids: string[] = [];
  for (const frame of GONGMUN_FRAMES) {
    ids.push(formatGongmunFormId(gongmunFormChoice(frame, look(frame))));
    if (frame === "general") ids.push(formatGongmunFormId(gongmunFormChoice(frame, look(frame), { closing: true })));
    if (frame === "report") ids.push(formatGongmunFormId(gongmunFormChoice(frame, look(frame), { cover: true })));
  }
  const fallback = getTemplateLibrary(host).activeGongmunPreset;
  for (const style of listGongmunStyleChoices(host)) {
    ids.push(formatGongmunFormId(choiceOfPreset(style.preset ?? fallback, style.id)));
  }
  const forms: GongmunFormOption[] = [];
  for (const id of ids) {
    const form = describeGongmunForm(host, id);
    if (form && !forms.some((item) => item.id === form.id)) forms.push(form);
  }
  return forms;
}

/**
 * The form an export starts with: the active form; when its look does not fix the
 * document type, the note's 공문_종류 moves it to that frame and the note's
 * 공문_기관서식 picks the look (when the frame can use it).
 */
export function currentGongmunFormId(host: TemplateLibraryHost, notePreset?: GongmunPreset, noteLook?: string): string {
  const library = getTemplateLibrary(host);
  const active = resolveGongmunForm(host, library.activeGongmunForm) ?? resolveGongmunForm(host, gongmunFormId(library.activeGongmunPreset));
  if (!active) return gongmunFormId(notePreset ?? DEFAULT_GONGMUN_PRESET);
  if (active.fixed) return active.id;
  let id = active.id;
  if (notePreset) {
    const { frame, options } = frameOfPreset(notePreset);
    const look = gongmunLookAllowed(host, frame, active.choice.look) ? active.choice.look : LOOK_BASIC;
    id = formatGongmunFormId(gongmunFormChoice(frame, look, frame === active.choice.frame ? { ...active.choice.options, ...options } : options));
  }
  const named = noteLook ? gongmunLookByName(host, noteLook) : undefined;
  if (named) {
    const frame = resolveGongmunForm(host, id)?.choice.frame;
    if (frame && gongmunLookAllowed(host, frame, named)) id = withGongmunLook(host, id, named);
  }
  return id;
}

/** Makes a form the active one (in memory; the caller saves) and returns its document type. */
export function selectGongmunFormInMemory(host: TemplateLibraryHost, id: string): GongmunPreset {
  const form = resolveGongmunForm(host, id);
  if (!form) throw new Error(t("template.error.notFound"));
  // The 2.7.x fields stay in step so a downgrade still opens on the same form;
  // the frame-and-look id is written last because those setters derive one too.
  setActiveGongmunTemplateInMemory(host, form.style?.id ?? "");
  if (!form.fixed && isGongmunPreset(form.preset)) setActiveGongmunPresetInMemory(host, form.preset);
  setActiveGongmunFormInMemory(host, form.id);
  return form.preset;
}

export interface GongmunExportPlan {
  preset: GongmunPreset;
  options: GongmunOptions;
  /** Table look of the active institution style (none = Kordoc's preset look). */
  profile?: FormatProfile;
  warnings: AdapterWarning[];
  /** Document title used when the note has no leading `#` heading (R-024). */
  title: string;
  /** Finishing of a built-in institution style (hwpxFinish.ts). */
  finish?: GongmunFinishSpec;
  /** Engine notes the institution style makes irrelevant. */
  quietEngineNotes?: readonly string[];
  /** Heading and list mapping of a built-in institution style. */
  outline?: GongmunOutlineStyle;
  /** The form the plan was made with ("form:<frame>/<look>…"). */
  formId: string;
  /** A look learned from a sample HWPX (R-036); the document is made from the sample's shapes. */
  sample?: SampleLookRecord;
}

/** The note's `title` property, else its file name: the title of a document without `#`. */
export function noteDocumentTitle(frontmatter: Readonly<Record<string, unknown>> | undefined, file: { basename: string }): string {
  const title = frontmatter?.title;
  return typeof title === "string" && title.trim() ? title.trim() : file.basename;
}

/** Generation options of a plan, shared by the export and the preview. */
export function gongmunGenerateOptions(
  plan: GongmunExportPlan
): Pick<GenerateHwpxOptions, "gongmun" | "profile" | "sampleLook" | "gongmunTitle" | "gongmunFinish" | "gongmunOutline" | "quietEngineNotes"> {
  return {
    gongmun: plan.options,
    profile: plan.profile,
    sampleLook: plan.sample,
    gongmunTitle: plan.title,
    gongmunFinish: plan.finish,
    gongmunOutline: plan.outline,
    quietEngineNotes: plan.quietEngineNotes
  };
}

function propertyWarning(issue: GongmunPropertyIssue): AdapterWarning {
  const message =
    issue.code === "conflict"
      ? t("gongmun.property.conflict", { key: issue.key, alias: issue.alias })
      : issue.code === "unknown"
        ? t("gongmun.property.unknown", { key: issue.key })
        : t("gongmun.property.invalid", { key: issue.key });
  return { code: "gongmun-property", message, count: 1 };
}

/** The preset a note asks for through its properties, if any. */
export function notePresetHint(app: App, file: TFile | null | undefined): GongmunPreset | undefined {
  if (!file) return undefined;
  return readGongmunProperties(app.metadataCache.getFileCache(file)?.frontmatter).preset;
}

/** The look a note names in 공문_기관서식, as written (R-030). */
export function noteLookHint(app: App, file: TFile | null | undefined): string | undefined {
  if (!file) return undefined;
  return readGongmunProperties(app.metadataCache.getFileCache(file)?.frontmatter).look;
}

/**
 * The frame's switches on top of the note and the style (the window's choice wins).
 * A switch at its default leaves the note's properties in charge, so the forms that
 * existed in 2.7.x keep their output. Explicit choices release two of the M1 pins:
 * a report or plan gets a contents page, and a bullet-style report whose cover is
 * switched off starts with the title box Kordoc 4.25.0 draws.
 */
function applyFrameSwitches(options: GongmunOptions, form: ResolvedGongmunForm): GongmunOptions {
  if (form.fixed) return options;
  const next: GongmunOptions = { ...options };
  const chosen = form.choice.options;
  switch (form.choice.frame) {
    case "report":
      if (chosen.toc) next.toc = true;
      break;
    case "gaejosik":
      if (chosen.cover === false) {
        next.cover = false;
        next.bodyTitleBox = true;
        next.toc = chosen.toc !== false;
      } else if (chosen.toc === false) {
        next.toc = false;
      }
      break;
    case "bangchim":
      if (chosen.cover && (next.cover === undefined || next.cover === false)) next.cover = true;
      if (chosen.checklist && next.checklist === undefined) next.checklist = true;
      if (chosen.toc) next.toc = true;
      break;
    default:
      break;
  }
  return next;
}

/**
 * Official-document options for one export: the chosen form (frame and look), the
 * note's properties, and the look's style, in that order of precedence.
 *
 * `formId` names the form explicitly (the export window, the preview, a note's
 * remembered form, several forms at once); ids stored by 2.7.x are understood.
 * Without it, or when it is no longer a form, the active form applies: the window's
 * or the note's document type moves it to that frame and the note's 공문_기관서식
 * picks its look, unless the active look was made for one document type.
 */
export function planGongmunExport(
  app: App,
  file: TFile,
  host: TemplateLibraryHost,
  requestedPreset?: GongmunPreset,
  formId?: string
): GongmunExportPlan {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  const noted = readGongmunProperties(frontmatter);
  const lookWarnings: AdapterWarning[] = [];
  let form = formId ? resolveGongmunForm(host, formId) : undefined;
  if (!form) {
    const startId = currentGongmunFormId(host, requestedPreset ?? noted.preset);
    let id = startId;
    const start = resolveGongmunForm(host, startId);
    if (noted.look && start && !start.fixed) {
      const named = gongmunLookByName(host, noted.look);
      if (!named) {
        lookWarnings.push({ code: "gongmun-property", message: t("gongmun.property.lookUnknown", { name: noted.look }), count: 1 });
      } else if (!gongmunLookAllowed(host, start.choice.frame, named)) {
        lookWarnings.push({
          code: "gongmun-property",
          message: t("gongmun.property.lookNotAllowed", { look: noted.look, frame: gongmunFrameLabel(start.choice.frame) }),
          count: 1
        });
      } else {
        id = withGongmunLook(host, startId, named);
      }
    }
    form = resolveGongmunForm(host, id) ?? resolveGongmunForm(host, gongmunFormId(DEFAULT_GONGMUN_PRESET));
  }
  if (!form) throw new Error(t("template.error.notFound"));
  const style = form.style;
  const preset = form.preset;
  const properties = readGongmunProperties(frontmatter, preset);
  const today = new Date();
  const switched = applyFrameSwitches(resolveGongmunOptions({ preset, style: style?.options, note: properties.options }), form);
  const frame = applyTypeFrame(switched, { today, org: style?.options.org });
  const options = withCoverDate(frame.options, today, style?.coverDate);
  // A measured agency look sits below every explicit option (Kordoc applies it as defaults).
  if (form.agency) options.agency = form.agency;
  const warnings = [...properties.issues.map(propertyWarning), ...lookWarnings];
  // A look made for one document type always makes it (R-025, R-026).
  const asked = form.fixed ? [requestedPreset, noted.preset].find((item) => item !== undefined && item !== preset) : undefined;
  if (style && asked) {
    warnings.push({
      code: "gongmun-property",
      message: t("gongmun.property.styleType", {
        style: style.name,
        preset: gongmunPresetLabel(preset),
        asked: gongmunPresetLabel(asked)
      }),
      count: 1
    });
  }
  for (const message of incompatibleGongmunWarnings(options)) {
    warnings.push({ code: "engine-note", message, count: 1 });
  }
  const outline = style?.outline || frame.closing ? { ...style?.outline, closing: frame.closing } : undefined;
  return {
    preset,
    options,
    profile: style?.tableStyle,
    sample: style?.sample,
    warnings,
    title: noteDocumentTitle(frontmatter, file),
    finish: style?.finish,
    quietEngineNotes: style?.quietEngineNotes,
    outline,
    formId: form.id
  };
}
