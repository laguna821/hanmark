import { normalizeSampleLookRecord, type SampleLookRecord } from "./sampleLook";
import { normalizeGongmunPreset, type FormatProfile, type GongmunPreset } from "kordoc";
import {
  normalizeDocumentStyleProfile,
  type DocumentStyleProfile
} from "./documentStyle";
import {
  builtInDocumentStyleProfile,
  DOCUMENT_STYLE_PRESET_LABELS,
  isDocumentStylePresetId,
  type HanmarkDocumentStylePresetId
} from "./documentStylePresets";
import type { GongmunOutlineStyle } from "./gongmunOutline";
import { normalizeGongmunStyleOptions, type CoverDateFormat, type GongmunStyleOptions } from "./gongmunStyle";
import type { CoverLogoImage, GongmunFinishSpec } from "./hwpxFinish";
import { BUILTIN_GONGMUN_STYLES, builtinGongmunStyle, isBuiltinGongmunStyleId } from "./institutionStyles";
import {
  choiceOfPreset,
  formatGongmunFormId,
  isStyleLook,
  LOOK_BASIC,
  migrateLegacyFormId,
  parseGongmunFormId
} from "./gongmunFormId";
import { t, tKey, type MessageKey } from "../i18n";

export const BUILTIN_TEMPLATE_IDS = [
  "builtin:kordoc-default",
  "builtin:korean-communication",
  "builtin:youth-studies"
] as const;

export type BuiltInTemplateId = (typeof BUILTIN_TEMPLATE_IDS)[number];

/**
 * Built-in template names are stored and matched in Korean (duplicate-name checks,
 * copies, migrations); only their display follows the interface language.
 */
const BUILTIN_TEMPLATE_LABELS: Readonly<Record<BuiltInTemplateId, MessageKey>> = {
  "builtin:kordoc-default": "template.builtin.kordocDefault",
  "builtin:korean-communication": "template.builtin.koreanCommunication",
  "builtin:youth-studies": "template.builtin.youthStudies"
};

/** The name to show for a template: built-in templates in the interface language, custom ones as saved. */
export function templateDisplayName(template: { id: string; name: string }): string {
  return isBuiltInTemplateId(template.id) ? tKey(BUILTIN_TEMPLATE_LABELS[template.id]) : template.name;
}

export interface HanmarkTemplateRecord {
  id: string;
  name: string;
  sourceName?: string;
  documentStyle?: DocumentStyleProfile;
  tableStyle?: FormatProfile;
  /**
   * Opt-in font substitutions saved explicitly by the user (template font → font
   * written instead). Stored, so every computer writes the same HWPX (R-018).
   */
  fontSubstitutions?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

/** Institution style for official documents (기관 서식, 2.7.0 W5). */
export interface GongmunTemplateRecord {
  id: string;
  name: string;
  options: GongmunStyleOptions;
  /** Table look read from a sample HWPX (hwpxToProfile). */
  tableStyle?: FormatProfile;
  /** Document type the form makes (R-026); older records without one use the chosen type. */
  preset?: GongmunPreset;
  /** A look learned from a sample HWPX (R-036): the document is made from the sample's own shapes. */
  sample?: SampleLookRecord;
  /** The user's logo at the bottom of the cover (3.0.0); only documents with a cover show it. */
  coverLogo?: CoverLogoRecord;
  createdAt: string;
  updatedAt: string;
}

/** A cover logo kept in a user look: the picture, its file name, and where it goes. */
export interface CoverLogoRecord extends CoverLogoImage {
  name: string;
  widthMm: number;
  bottomMm: number;
}

/** Largest stored logo picture (bytes); larger pictures are redrawn smaller before saving. */
export const COVER_LOGO_MAX_BYTES = 1024 * 1024;
export const COVER_LOGO_DEFAULT = { widthMm: 30, bottomMm: 32 } as const;
export const COVER_LOGO_WIDTH_MM = { min: 10, max: 120 } as const;
export const COVER_LOGO_BOTTOM_MM = { min: 10, max: 200 } as const;

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number): number {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return fallback;
  return Math.round(Math.min(range.max, Math.max(range.min, number)) * 10) / 10;
}

/** A stored cover logo, or undefined when it is not a usable PNG or JPEG picture. */
export function normalizeCoverLogoRecord(value: unknown): CoverLogoRecord | undefined {
  if (!isRecord(value)) return undefined;
  const { data, mime, width, height } = value;
  if (mime !== "image/png" && mime !== "image/jpeg") return undefined;
  if (typeof data !== "string" || !data || data.length > Math.ceil(COVER_LOGO_MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(data)) return undefined;
  if (!Number.isInteger(width) || !Number.isInteger(height) || (width as number) <= 0 || (height as number) <= 0) return undefined;
  return {
    name: cleanName(value.name, "logo"),
    data,
    mime,
    width: width as number,
    height: height as number,
    widthMm: clampNumber(value.widthMm, COVER_LOGO_WIDTH_MM, COVER_LOGO_DEFAULT.widthMm),
    bottomMm: clampNumber(value.bottomMm, COVER_LOGO_BOTTOM_MM, COVER_LOGO_DEFAULT.bottomMm)
  };
}

/** Looks kept at the top of the look chooser (R-030). */
export const GONGMUN_LOOK_FAVORITE_LIMIT = 40;
export const GONGMUN_LOOK_RECENT_LIMIT = 5;

export interface HanmarkTemplateLibrary {
  schemaVersion: 3;
  activeId: string;
  customTemplates: Record<string, HanmarkTemplateRecord>;
  gongmunTemplates: Record<string, GongmunTemplateRecord>;
  /** "" = no institution style (Kordoc preset defaults). */
  activeGongmunId: string;
  /** Standard type chosen last when no institution form is active (R-026). */
  activeGongmunPreset: GongmunPreset;
  /** The active form as a frame and look pair, "form:<frame>/<look>…" (schema 3, R-030). */
  activeGongmunForm: string;
  /** Looks the user starred, in the order they were starred. */
  gongmunLookFavorites: string[];
  /** Looks used by the latest exports, newest first. */
  gongmunLookRecent: string[];
}

/** One of Kordoc's official-document types. */
export function isGongmunPreset(value: unknown): value is GongmunPreset {
  return typeof value === "string" && normalizeGongmunPreset(value) === value;
}

export interface HanmarkTemplateItem {
  id: string;
  name: string;
  builtIn: boolean;
  documentStyle?: DocumentStyleProfile;
  tableStyle?: FormatProfile;
  sourceName?: string;
  fontSubstitutions?: Record<string, string>;
}

export interface TemplateLibraryHost {
  settings: Record<string, unknown>;
  saveSettings: () => Promise<void>;
}

const BUILTIN_PRESET: Record<BuiltInTemplateId, HanmarkDocumentStylePresetId> = {
  "builtin:kordoc-default": "kordoc-default",
  "builtin:korean-communication": "korean-communication",
  "builtin:youth-studies": "youth-studies"
};

const PRESET_BUILTIN: Record<"kordoc-default" | "korean-communication" | "youth-studies", BuiltInTemplateId> = {
  "kordoc-default": "builtin:kordoc-default",
  "korean-communication": "builtin:korean-communication",
  "youth-studies": "builtin:youth-studies"
};

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function cleanName(value: unknown, fallback = t("template.defaultName")): string {
  const source = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const cleaned = Array.from(source, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("").replace(/\s+/g, " ").trim().slice(0, 100);
  return cleaned || fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTableStyle(value: unknown): value is FormatProfile {
  return isRecord(value) && Array.isArray(value.tables);
}

function fontFamilyName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("").replace(/\s+/gu, " ").trim().slice(0, 60);
  return cleaned || undefined;
}

/** At most 32 "requested → replacement" pairs with plain family names. */
export function normalizeFontSubstitutions(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const rules: Record<string, string> = {};
  for (const [requested, replacement] of Object.entries(value).slice(0, 32)) {
    const from = fontFamilyName(requested);
    const to = fontFamilyName(replacement);
    if (from && to && from !== to) rules[from] = to;
  }
  return Object.keys(rules).length ? rules : undefined;
}

function normalizedRecord(value: unknown, fallbackId?: string): HanmarkTemplateRecord | undefined {
  if (!isRecord(value)) return undefined;
  const id = (typeof value.id === "string" ? value.id : fallbackId ?? "").trim();
  if (!id || isBuiltInTemplateId(id)) return undefined;
  let documentStyle: DocumentStyleProfile | undefined;
  if (value.documentStyle) {
    try {
      documentStyle = normalizeDocumentStyleProfile(value.documentStyle);
    } catch {
      documentStyle = undefined;
    }
  }
  const tableStyle = validTableStyle(value.tableStyle) ? clone(value.tableStyle) : undefined;
  if (!documentStyle && !tableStyle) return undefined;
  const createdAt = typeof value.createdAt === "string" && value.createdAt ? value.createdAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" && value.updatedAt ? value.updatedAt : createdAt;
  const name = cleanName(value.name, documentStyle?.name || t("template.defaultName"));
  if (documentStyle) documentStyle = { ...documentStyle, name };
  const fontSubstitutions = normalizeFontSubstitutions(value.fontSubstitutions);
  return {
    id,
    name,
    sourceName: typeof value.sourceName === "string" && value.sourceName.trim()
      ? value.sourceName.trim().slice(0, 160)
      : documentStyle?.sourceName,
    documentStyle,
    tableStyle,
    ...(fontSubstitutions ? { fontSubstitutions } : {}),
    createdAt,
    updatedAt
  };
}

function normalizedGongmunRecord(value: unknown, fallbackId?: string): GongmunTemplateRecord | undefined {
  if (!isRecord(value)) return undefined;
  const id = (typeof value.id === "string" ? value.id : fallbackId ?? "").trim();
  if (!id.startsWith("gongmun:")) return undefined;
  const createdAt = typeof value.createdAt === "string" && value.createdAt ? value.createdAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" && value.updatedAt ? value.updatedAt : createdAt;
  const tableStyle = validTableStyle(value.tableStyle) ? clone(value.tableStyle) : undefined;
  return {
    id,
    name: cleanName(value.name, t("template.gongmunDefaultName")),
    options: normalizeGongmunStyleOptions(value.options),
    ...(tableStyle ? { tableStyle } : {}),
    ...(isGongmunPreset(value.preset) ? { preset: value.preset } : {}),
    ...(normalizeSampleLookRecord(value.sample) ? { sample: normalizeSampleLookRecord(value.sample) } : {}),
    ...(normalizeCoverLogoRecord(value.coverLogo) ? { coverLogo: normalizeCoverLogoRecord(value.coverLogo) } : {}),
    createdAt,
    updatedAt
  };
}

export function isBuiltInTemplateId(value: unknown): value is BuiltInTemplateId {
  return typeof value === "string" && BUILTIN_TEMPLATE_IDS.some((id) => id === value);
}

export function emptyTemplateLibrary(): HanmarkTemplateLibrary {
  return {
    schemaVersion: 3,
    activeId: "builtin:kordoc-default",
    customTemplates: {},
    gongmunTemplates: {},
    activeGongmunId: "",
    activeGongmunPreset: "report",
    activeGongmunForm: formatGongmunFormId(choiceOfPreset("report")),
    gongmunLookFavorites: [],
    gongmunLookRecent: []
  };
}

export function normalizeTemplateLibrary(value: unknown): HanmarkTemplateLibrary {
  const result = emptyTemplateLibrary();
  if (!isRecord(value)) return result;
  const customTemplates = isRecord(value.customTemplates) ? value.customTemplates : {};
  for (const [key, raw] of Object.entries(customTemplates)) {
    const record = normalizedRecord(raw, key);
    if (record) result.customTemplates[record.id] = record;
  }
  const activeId = typeof value.activeId === "string" ? value.activeId : "";
  if (isBuiltInTemplateId(activeId) || result.customTemplates[activeId]) result.activeId = activeId;
  // Schema 1 → 2 is lossless: the institution-style fields simply start empty.
  const gongmunTemplates = isRecord(value.gongmunTemplates) ? value.gongmunTemplates : {};
  for (const [key, raw] of Object.entries(gongmunTemplates)) {
    const record = normalizedGongmunRecord(raw, key);
    if (record) result.gongmunTemplates[record.id] = record;
  }
  const activeGongmunId = typeof value.activeGongmunId === "string" ? value.activeGongmunId : "";
  if (result.gongmunTemplates[activeGongmunId] || isBuiltinGongmunStyleId(activeGongmunId)) {
    result.activeGongmunId = activeGongmunId;
  }
  if (isGongmunPreset(value.activeGongmunPreset)) result.activeGongmunPreset = value.activeGongmunPreset;
  // Schema 2 → 3 (R-030): the active institution form, else the type chosen last,
  // becomes one frame-and-look id; a stored id whose look is gone falls back the same way.
  const styleExists = (id: string): boolean => Boolean(result.gongmunTemplates[id]) || isBuiltinGongmunStyleId(id);
  const presetOfStyle = (id: string): GongmunPreset | undefined =>
    result.gongmunTemplates[id]?.preset ?? builtinGongmunStyle(id)?.preset;
  const stored = parseGongmunFormId(value.activeGongmunForm);
  const legacy = result.activeGongmunId || `preset:${result.activeGongmunPreset}`;
  result.activeGongmunForm =
    stored && (!isStyleLook(stored.look) || styleExists(stored.look))
      ? formatGongmunFormId(stored)
      : (migrateLegacyFormId(legacy, presetOfStyle, isGongmunPreset, result.activeGongmunPreset) ?? result.activeGongmunForm);
  const looks = (raw: unknown, limit: number): string[] => {
    const seen = new Set<string>();
    for (const item of Array.isArray(raw) ? raw : []) {
      if (typeof item !== "string" || !item.trim() || item === LOOK_BASIC) continue;
      if (isStyleLook(item) && !styleExists(item)) continue;
      seen.add(item.trim());
    }
    return [...seen].slice(0, limit);
  };
  result.gongmunLookFavorites = looks(value.gongmunLookFavorites, GONGMUN_LOOK_FAVORITE_LIMIT);
  result.gongmunLookRecent = looks(value.gongmunLookRecent, GONGMUN_LOOK_RECENT_LIMIT);
  return result;
}

/** A 2.7.x or 3.0.0 form id as a 3.0.0 id, using the library's styles (R-030). */
export function migrateGongmunFormIdWithLibrary(library: HanmarkTemplateLibrary, id: unknown): string | undefined {
  const presetOfStyle = (styleId: string): GongmunPreset | undefined =>
    library.gongmunTemplates[styleId]?.preset ?? builtinGongmunStyle(styleId)?.preset;
  const migrated = migrateLegacyFormId(id, presetOfStyle, isGongmunPreset, library.activeGongmunPreset);
  const choice = parseGongmunFormId(migrated);
  if (!choice) return undefined;
  if (isStyleLook(choice.look) && !library.gongmunTemplates[choice.look] && !isBuiltinGongmunStyleId(choice.look)) return undefined;
  return migrated;
}

/** Stars or unstars a look; returns whether it is starred now. */
export function toggleGongmunLookFavoriteInMemory(plugin: TemplateLibraryHost, look: string): boolean {
  const library = getTemplateLibrary(plugin);
  const starred = library.gongmunLookFavorites.includes(look);
  library.gongmunLookFavorites = starred
    ? library.gongmunLookFavorites.filter((item) => item !== look)
    : [...library.gongmunLookFavorites, look].slice(-GONGMUN_LOOK_FAVORITE_LIMIT);
  plugin.settings.hanmarkTemplateLibrary = library;
  return !starred;
}

/** Puts a look an export just used at the front of the recent looks; true when the list changed. */
export function recordGongmunLookUseInMemory(plugin: TemplateLibraryHost, look: string): boolean {
  if (!look || look === LOOK_BASIC) return false;
  const library = getTemplateLibrary(plugin);
  const next = [look, ...library.gongmunLookRecent.filter((item) => item !== look)].slice(0, GONGMUN_LOOK_RECENT_LIMIT);
  if (JSON.stringify(next) === JSON.stringify(library.gongmunLookRecent)) return false;
  library.gongmunLookRecent = next;
  plugin.settings.hanmarkTemplateLibrary = library;
  return true;
}

/** Makes a frame-and-look id the active form (the caller validates it and saves). */
export function setActiveGongmunFormInMemory(plugin: TemplateLibraryHost, formId: string): void {
  const library = getTemplateLibrary(plugin);
  library.activeGongmunForm = formId;
  plugin.settings.hanmarkTemplateLibrary = library;
}

function oldPresetToBuiltIn(value: unknown): BuiltInTemplateId {
  if (value === "korean-communication" || value === "youth-studies" || value === "kordoc-default") {
    return PRESET_BUILTIN[value];
  }
  return "builtin:kordoc-default";
}

function uniqueMigratedId(library: HanmarkTemplateLibrary): string {
  let id = "custom:migrated";
  let index = 2;
  while (library.customTemplates[id]) id = `custom:migrated-${index++}`;
  return id;
}

function removeLegacyTemplateSettings(settings: Record<string, unknown>): boolean {
  let changed = false;
  for (const key of [
    "hanmarkDocumentStyle",
    "hanmarkDocumentStylePreset",
    "hanmarkTableProfile",
    "hanmarkTableProfileName",
    "defaultTemplatePath",
    "cachedTemplateStyles",
    "cachedTemplatePageLayout"
  ]) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      delete settings[key];
      changed = true;
    }
  }
  return changed;
}

/** Idempotently migrate the former single document/table style slots. */
export function migrateTemplateLibrarySettingsInMemory(settings: unknown): boolean {
  if (!isRecord(settings)) return false;
  let changed = false;
  const hasLibrary = isRecord(settings.hanmarkTemplateLibrary) &&
    (settings.hanmarkTemplateLibrary.schemaVersion === 1 ||
      settings.hanmarkTemplateLibrary.schemaVersion === 2 ||
      settings.hanmarkTemplateLibrary.schemaVersion === 3);
  const library = normalizeTemplateLibrary(settings.hanmarkTemplateLibrary);

  if (!hasLibrary) {
    const oldPreset = isDocumentStylePresetId(settings.hanmarkDocumentStylePreset)
      ? settings.hanmarkDocumentStylePreset
      : settings.hanmarkDocumentStyle
        ? "custom"
        : "kordoc-default";
    const builtInId = oldPresetToBuiltIn(oldPreset);
    library.activeId = builtInId;

    let oldDocumentStyle: DocumentStyleProfile | undefined;
    if (settings.hanmarkDocumentStyle) {
      try {
        oldDocumentStyle = normalizeDocumentStyleProfile(settings.hanmarkDocumentStyle);
      } catch {
        oldDocumentStyle = undefined;
      }
    }
    const oldTableStyle = validTableStyle(settings.hanmarkTableProfile) ? clone(settings.hanmarkTableProfile) : undefined;
    const shouldCombineAndActivate = oldPreset === "custom" || Boolean(oldTableStyle);
    if (oldDocumentStyle || oldTableStyle) {
      const id = uniqueMigratedId(library);
      const builtInDocumentStyle = builtInId === "builtin:kordoc-default"
        ? undefined
        : builtInDocumentStyleProfile(BUILTIN_PRESET[builtInId]);
      const documentStyle = oldDocumentStyle || builtInDocumentStyle;
      const baseName = oldDocumentStyle?.name || DOCUMENT_STYLE_PRESET_LABELS[BUILTIN_PRESET[builtInId]];
      const tableName = typeof settings.hanmarkTableProfileName === "string"
        ? settings.hanmarkTableProfileName.trim()
        : "";
      const name = oldTableStyle && oldPreset !== "custom" && tableName
        ? `${baseName} + ${tableName}`
        : baseName || tableName || t("template.migratedName");
      const migratedName = cleanName(name);
      const now = new Date().toISOString();
      library.customTemplates[id] = {
        id,
        name: migratedName,
        sourceName: oldDocumentStyle?.sourceName || tableName || undefined,
        documentStyle: documentStyle ? { ...clone(documentStyle), name: migratedName } : undefined,
        tableStyle: oldTableStyle,
        createdAt: now,
        updatedAt: now
      };
      if (shouldCombineAndActivate) library.activeId = id;
    }
    changed = true;
  }

  if (JSON.stringify(settings.hanmarkTemplateLibrary) !== JSON.stringify(library)) {
    settings.hanmarkTemplateLibrary = library;
    changed = true;
  }
  return removeLegacyTemplateSettings(settings) || changed;
}

export function getTemplateLibrary(plugin: TemplateLibraryHost): HanmarkTemplateLibrary {
  const normalized = normalizeTemplateLibrary(plugin.settings.hanmarkTemplateLibrary);
  plugin.settings.hanmarkTemplateLibrary = normalized;
  return normalized;
}

export function builtInTemplateItem(id: BuiltInTemplateId): HanmarkTemplateItem {
  const preset = BUILTIN_PRESET[id];
  return {
    id,
    name: DOCUMENT_STYLE_PRESET_LABELS[preset],
    builtIn: true,
    documentStyle: builtInDocumentStyleProfile(preset)
  };
}

export function listTemplateItems(plugin: TemplateLibraryHost): HanmarkTemplateItem[] {
  const library = getTemplateLibrary(plugin);
  const builtIns = BUILTIN_TEMPLATE_IDS.map((id) => builtInTemplateItem(id));
  const custom = Object.values(library.customTemplates)
    .sort((left, right) => left.name.localeCompare(right.name, "ko", { sensitivity: "base" }))
    .map((record) => ({ ...clone(record), builtIn: false }));
  return [...builtIns, ...custom];
}

export function activeTemplateItem(plugin: TemplateLibraryHost): HanmarkTemplateItem {
  const library = getTemplateLibrary(plugin);
  if (isBuiltInTemplateId(library.activeId)) return builtInTemplateItem(library.activeId);
  const record = library.customTemplates[library.activeId];
  if (record) return { ...clone(record), builtIn: false };
  library.activeId = "builtin:kordoc-default";
  return builtInTemplateItem("builtin:kordoc-default");
}

export function availableTemplateName(plugin: TemplateLibraryHost, requested: string, exceptId?: string): string {
  const base = cleanName(requested);
  const used = new Set(
    listTemplateItems(plugin)
      .filter((item) => item.id !== exceptId)
      .map((item) => item.name.toLocaleLowerCase())
  );
  if (!used.has(base.toLocaleLowerCase())) return base;
  let index = 2;
  while (used.has(`${base} ${index}`.toLocaleLowerCase())) index++;
  return `${base} ${index}`;
}

export function newTemplateRecord(
  plugin: TemplateLibraryHost,
  name: string,
  documentStyle?: DocumentStyleProfile,
  tableStyle?: FormatProfile,
  sourceName?: string
): HanmarkTemplateRecord {
  const now = new Date().toISOString();
  const id = `custom:${crypto.randomUUID()}`;
  const availableName = availableTemplateName(plugin, name);
  const normalizedDocumentStyle = documentStyle ? normalizeDocumentStyleProfile(documentStyle) : undefined;
  if (normalizedDocumentStyle) normalizedDocumentStyle.name = availableName;
  return {
    id,
    name: availableName,
    sourceName,
    documentStyle: normalizedDocumentStyle,
    tableStyle: validTableStyle(tableStyle) ? clone(tableStyle) : undefined,
    createdAt: now,
    updatedAt: now
  };
}

export function putTemplateRecord(plugin: TemplateLibraryHost, raw: HanmarkTemplateRecord): HanmarkTemplateRecord {
  const library = getTemplateLibrary(plugin);
  const existing = library.customTemplates[raw.id];
  const normalized = normalizedRecord({
    ...raw,
    name: availableTemplateName(plugin, raw.name, raw.id),
    createdAt: existing?.createdAt || raw.createdAt,
    updatedAt: new Date().toISOString()
  });
  if (!normalized) throw new Error(t("template.error.empty"));
  library.customTemplates[normalized.id] = normalized;
  plugin.settings.hanmarkTemplateLibrary = library;
  return clone(normalized);
}

export function deleteTemplateRecordInMemory(plugin: TemplateLibraryHost, id: string): boolean {
  if (isBuiltInTemplateId(id)) return false;
  const library = getTemplateLibrary(plugin);
  if (!library.customTemplates[id]) return false;
  delete library.customTemplates[id];
  if (library.activeId === id) library.activeId = "builtin:kordoc-default";
  plugin.settings.hanmarkTemplateLibrary = library;
  return true;
}

export function setActiveTemplateInMemory(plugin: TemplateLibraryHost, id: string): HanmarkTemplateItem {
  const library = getTemplateLibrary(plugin);
  if (!isBuiltInTemplateId(id) && !library.customTemplates[id]) throw new Error(t("template.error.notFound"));
  library.activeId = id;
  plugin.settings.hanmarkTemplateLibrary = library;
  return activeTemplateItem(plugin);
}

export function templateDocumentStyle(plugin: TemplateLibraryHost): DocumentStyleProfile | undefined {
  return activeTemplateItem(plugin).documentStyle;
}

export function templateTableStyle(plugin: TemplateLibraryHost): FormatProfile | undefined {
  return activeTemplateItem(plugin).tableStyle;
}

/** Opt-in font substitutions of the active HWPX template ({} when none). */
export function templateFontSubstitutions(plugin: TemplateLibraryHost): Record<string, string> {
  return { ...(activeTemplateItem(plugin).fontSubstitutions ?? {}) };
}

/** Saves (or clears with `undefined`) the substitutions of a custom HWPX template. */
export function setTemplateFontSubstitutionsInMemory(
  plugin: TemplateLibraryHost,
  id: string,
  rules: Record<string, string> | undefined
): HanmarkTemplateRecord {
  const library = getTemplateLibrary(plugin);
  const record = library.customTemplates[id];
  if (!record) throw new Error(t("template.error.notFound"));
  const normalized = normalizeFontSubstitutions(rules);
  const next: HanmarkTemplateRecord = { ...record, updatedAt: new Date().toISOString() };
  if (normalized) next.fontSubstitutions = normalized;
  else delete next.fontSubstitutions;
  library.customTemplates[id] = next;
  plugin.settings.hanmarkTemplateLibrary = library;
  return clone(next);
}

export function listGongmunTemplates(plugin: TemplateLibraryHost): GongmunTemplateRecord[] {
  return Object.values(getTemplateLibrary(plugin).gongmunTemplates)
    .sort((left, right) => left.name.localeCompare(right.name, "ko", { sensitivity: "base" }))
    .map((record) => clone(record));
}

/** An institution style as the export uses it: built-in (HanMark) or the user's own. */
export interface GongmunStyleChoice {
  id: string;
  name: string;
  builtIn: boolean;
  options: GongmunStyleOptions;
  tableStyle?: FormatProfile;
  /** A look learned from a sample HWPX (R-036). */
  sample?: SampleLookRecord;
  /** Group label of a built-in style (for example the university). */
  group?: string;
  description?: string;
  /** Document type a built-in style was made for. */
  preset?: GongmunPreset;
  finish?: GongmunFinishSpec;
  quietEngineNotes?: readonly string[];
  coverDate?: CoverDateFormat;
  outline?: GongmunOutlineStyle;
}

function builtinChoice(id: string): GongmunStyleChoice | undefined {
  const style = builtinGongmunStyle(id);
  if (!style) return undefined;
  return {
    id: style.id,
    name: tKey(style.name),
    builtIn: true,
    options: clone(style.options),
    group: tKey(style.group),
    description: tKey(style.description),
    preset: style.preset,
    finish: clone(style.finish),
    quietEngineNotes: style.quietEngineNotes ? [...style.quietEngineNotes] : undefined,
    coverDate: style.coverDate,
    outline: style.outline ? { ...style.outline } : undefined
  };
}

/** Black or white, whichever reads better on a fill colour. */
function readableOn(fill: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(fill.slice(at, at + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 < 140 ? "#FFFFFF" : "#000000";
}

/** Finishing of a look learned from a sample: its table header fill, when the look is used by measured values. */
export function sampleLookFinish(sample: SampleLookRecord): GongmunFinishSpec | undefined {
  const fill = sample.use === "measured" ? sample.headerFill : undefined;
  return fill ? { tableHeader: { fill, textColor: readableOn(fill) } } : undefined;
}

function customChoice(record: GongmunTemplateRecord): GongmunStyleChoice {
  const choice: GongmunStyleChoice = { id: record.id, name: record.name, builtIn: false, options: clone(record.options) };
  if (record.tableStyle) choice.tableStyle = clone(record.tableStyle);
  if (record.preset) choice.preset = record.preset;
  if (record.sample) {
    choice.sample = record.sample;
    // Used by its measured values, the look draws the sample's table header fill through the finishing (R-036).
    const finish = sampleLookFinish(record.sample);
    if (finish) choice.finish = finish;
  }
  const logo = coverLogoFinish(record.coverLogo);
  if (logo) choice.finish = { ...choice.finish, ...logo };
  return choice;
}

/** The finishing that puts a user look's logo on the cover. */
export function coverLogoFinish(logo: CoverLogoRecord | undefined): GongmunFinishSpec | undefined {
  if (!logo) return undefined;
  const { name: _name, widthMm, bottomMm, ...image } = logo;
  return { cover: { logo: { key: "mine", widthMm, bottomMm, image } } };
}

/** Built-in styles first (in their catalog order), then the user's styles by name. */
export function listGongmunStyleChoices(plugin: TemplateLibraryHost): GongmunStyleChoice[] {
  const builtIns = BUILTIN_GONGMUN_STYLES.map((style) => builtinChoice(style.id)).filter(
    (choice): choice is GongmunStyleChoice => !!choice
  );
  return [...builtIns, ...listGongmunTemplates(plugin).map(customChoice)];
}

/** A built-in or user style by id; undefined for "" or an unknown id (R-028). */
export function gongmunStyleById(plugin: TemplateLibraryHost, id: string): GongmunStyleChoice | undefined {
  if (isBuiltinGongmunStyleId(id)) return builtinChoice(id);
  const record = getTemplateLibrary(plugin).gongmunTemplates[id];
  return record ? customChoice(record) : undefined;
}

export function activeGongmunTemplate(plugin: TemplateLibraryHost): GongmunStyleChoice | undefined {
  return gongmunStyleById(plugin, getTemplateLibrary(plugin).activeGongmunId);
}

export function newGongmunTemplateRecord(
  plugin: TemplateLibraryHost,
  name: string,
  options: GongmunStyleOptions = {},
  preset?: GongmunPreset
): GongmunTemplateRecord {
  const now = new Date().toISOString();
  const used = new Set(listGongmunTemplates(plugin).map((record) => record.name.toLocaleLowerCase()));
  let available = cleanName(name, t("template.gongmunDefaultName"));
  for (let index = 2; used.has(available.toLocaleLowerCase()); index += 1) {
    available = `${cleanName(name, t("template.gongmunDefaultName"))} ${index}`;
  }
  return {
    id: `gongmun:${crypto.randomUUID()}`,
    name: available,
    options: normalizeGongmunStyleOptions(options),
    ...(preset ? { preset } : {}),
    createdAt: now,
    updatedAt: now
  };
}

export function putGongmunTemplateInMemory(
  plugin: TemplateLibraryHost,
  raw: GongmunTemplateRecord
): GongmunTemplateRecord {
  const library = getTemplateLibrary(plugin);
  const existing = library.gongmunTemplates[raw.id];
  const normalized = normalizedGongmunRecord({
    ...raw,
    createdAt: existing?.createdAt || raw.createdAt,
    updatedAt: new Date().toISOString()
  });
  if (!normalized) throw new Error(t("template.error.notFound"));
  library.gongmunTemplates[normalized.id] = normalized;
  plugin.settings.hanmarkTemplateLibrary = library;
  return clone(normalized);
}

export function deleteGongmunTemplateInMemory(plugin: TemplateLibraryHost, id: string): boolean {
  const library = getTemplateLibrary(plugin);
  if (!library.gongmunTemplates[id]) return false;
  delete library.gongmunTemplates[id];
  if (library.activeGongmunId === id) library.activeGongmunId = "";
  library.gongmunLookFavorites = library.gongmunLookFavorites.filter((look) => look !== id);
  library.gongmunLookRecent = library.gongmunLookRecent.filter((look) => look !== id);
  plugin.settings.hanmarkTemplateLibrary = library;
  return true;
}

/** "" selects Kordoc's preset defaults (no institution style). */
export function setActiveGongmunTemplateInMemory(plugin: TemplateLibraryHost, id: string): void {
  const library = getTemplateLibrary(plugin);
  if (id && !library.gongmunTemplates[id] && !isBuiltinGongmunStyleId(id)) throw new Error(t("template.error.notFound"));
  library.activeGongmunId = id;
  // The frame-and-look id follows (R-030): the style's form, else the type chosen last.
  library.activeGongmunForm =
    migrateGongmunFormIdWithLibrary(library, id || `preset:${library.activeGongmunPreset}`) ?? library.activeGongmunForm;
  plugin.settings.hanmarkTemplateLibrary = library;
}

/** Remembers the standard type chosen when no institution form is active (R-026). */
export function setActiveGongmunPresetInMemory(plugin: TemplateLibraryHost, preset: GongmunPreset): void {
  const library = getTemplateLibrary(plugin);
  library.activeGongmunPreset = preset;
  if (!library.activeGongmunId) {
    library.activeGongmunForm = migrateGongmunFormIdWithLibrary(library, `preset:${preset}`) ?? library.activeGongmunForm;
  }
  plugin.settings.hanmarkTemplateLibrary = library;
}
