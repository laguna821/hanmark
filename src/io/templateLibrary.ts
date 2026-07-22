import { randomUUID } from "node:crypto";
import type { FormatProfile } from "kordoc";
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

export const BUILTIN_TEMPLATE_IDS = [
  "builtin:kordoc-default",
  "builtin:korean-communication",
  "builtin:youth-studies"
] as const;

export type BuiltInTemplateId = (typeof BUILTIN_TEMPLATE_IDS)[number];

export interface HanmarkTemplateRecord {
  id: string;
  name: string;
  sourceName?: string;
  documentStyle?: DocumentStyleProfile;
  tableStyle?: FormatProfile;
  createdAt: string;
  updatedAt: string;
}

export interface HanmarkTemplateLibrary {
  schemaVersion: 1;
  activeId: string;
  customTemplates: Record<string, HanmarkTemplateRecord>;
}

export interface HanmarkTemplateItem {
  id: string;
  name: string;
  builtIn: boolean;
  documentStyle?: DocumentStyleProfile;
  tableStyle?: FormatProfile;
  sourceName?: string;
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
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function cleanName(value: unknown, fallback = "사용자 템플릿"): string {
  const source = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const cleaned = Array.from(source, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("").replace(/\s+/g, " ").trim().slice(0, 100);
  return cleaned || fallback;
}

function validTableStyle(value: unknown): value is FormatProfile {
  return Boolean(value && typeof value === "object" && Array.isArray((value as any).tables));
}

function normalizedRecord(value: any, fallbackId?: string): HanmarkTemplateRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const id = String(value.id || fallbackId || "").trim();
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
  const name = cleanName(value.name, documentStyle?.name || "사용자 템플릿");
  if (documentStyle) documentStyle = { ...documentStyle, name };
  return {
    id,
    name,
    sourceName: typeof value.sourceName === "string" && value.sourceName.trim()
      ? value.sourceName.trim().slice(0, 160)
      : documentStyle?.sourceName,
    documentStyle,
    tableStyle,
    createdAt,
    updatedAt
  };
}

export function isBuiltInTemplateId(value: unknown): value is BuiltInTemplateId {
  return typeof value === "string" && (BUILTIN_TEMPLATE_IDS as readonly string[]).includes(value);
}

export function emptyTemplateLibrary(): HanmarkTemplateLibrary {
  return { schemaVersion: 1, activeId: "builtin:kordoc-default", customTemplates: {} };
}

export function normalizeTemplateLibrary(value: unknown): HanmarkTemplateLibrary {
  const result = emptyTemplateLibrary();
  if (!value || typeof value !== "object") return result;
  const input = value as any;
  for (const [key, raw] of Object.entries(input.customTemplates || {})) {
    const record = normalizedRecord(raw, key);
    if (record) result.customTemplates[record.id] = record;
  }
  const activeId = String(input.activeId || "");
  if (isBuiltInTemplateId(activeId) || result.customTemplates[activeId]) result.activeId = activeId;
  return result;
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

function removeLegacyTemplateSettings(settings: any): boolean {
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
export function migrateTemplateLibrarySettingsInMemory(settings: any): boolean {
  if (!settings || typeof settings !== "object") return false;
  let changed = false;
  const hasLibrary = settings.hanmarkTemplateLibrary?.schemaVersion === 1;
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
      } catch (error) {
        console.warn("[hanmark] ignored invalid legacy document style during migration:", error);
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
      const tableName = String(settings.hanmarkTableProfileName || "").trim();
      const name = oldTableStyle && oldPreset !== "custom" && tableName
        ? `${baseName} + ${tableName}`
        : baseName || tableName || "이전 사용자 템플릿";
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

export function getTemplateLibrary(plugin: any): HanmarkTemplateLibrary {
  const normalized = normalizeTemplateLibrary(plugin?.settings?.hanmarkTemplateLibrary);
  if (plugin?.settings) plugin.settings.hanmarkTemplateLibrary = normalized;
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

export function listTemplateItems(plugin: any): HanmarkTemplateItem[] {
  const library = getTemplateLibrary(plugin);
  const builtIns = BUILTIN_TEMPLATE_IDS.map((id) => builtInTemplateItem(id));
  const custom = Object.values(library.customTemplates)
    .sort((left, right) => left.name.localeCompare(right.name, "ko", { sensitivity: "base" }))
    .map((record) => ({ ...clone(record), builtIn: false }));
  return [...builtIns, ...custom];
}

export function activeTemplateItem(plugin: any): HanmarkTemplateItem {
  const library = getTemplateLibrary(plugin);
  if (isBuiltInTemplateId(library.activeId)) return builtInTemplateItem(library.activeId);
  const record = library.customTemplates[library.activeId];
  if (record) return { ...clone(record), builtIn: false };
  library.activeId = "builtin:kordoc-default";
  return builtInTemplateItem("builtin:kordoc-default");
}

export function availableTemplateName(plugin: any, requested: string, exceptId?: string): string {
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
  plugin: any,
  name: string,
  documentStyle?: DocumentStyleProfile,
  tableStyle?: FormatProfile,
  sourceName?: string
): HanmarkTemplateRecord {
  const now = new Date().toISOString();
  const id = `custom:${randomUUID()}`;
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

export function putTemplateRecord(plugin: any, raw: HanmarkTemplateRecord): HanmarkTemplateRecord {
  const library = getTemplateLibrary(plugin);
  const existing = library.customTemplates[raw.id];
  const normalized = normalizedRecord({
    ...raw,
    name: availableTemplateName(plugin, raw.name, raw.id),
    createdAt: existing?.createdAt || raw.createdAt,
    updatedAt: new Date().toISOString()
  });
  if (!normalized) throw new Error("저장할 HWPX 템플릿에 문서 스타일이나 표 스타일이 없습니다.");
  library.customTemplates[normalized.id] = normalized;
  plugin.settings.hanmarkTemplateLibrary = library;
  return clone(normalized);
}

export function deleteTemplateRecordInMemory(plugin: any, id: string): boolean {
  if (isBuiltInTemplateId(id)) return false;
  const library = getTemplateLibrary(plugin);
  if (!library.customTemplates[id]) return false;
  delete library.customTemplates[id];
  if (library.activeId === id) library.activeId = "builtin:kordoc-default";
  plugin.settings.hanmarkTemplateLibrary = library;
  return true;
}

export function setActiveTemplateInMemory(plugin: any, id: string): HanmarkTemplateItem {
  const library = getTemplateLibrary(plugin);
  if (!isBuiltInTemplateId(id) && !library.customTemplates[id]) throw new Error("선택한 HWPX 템플릿을 찾을 수 없습니다.");
  library.activeId = id;
  plugin.settings.hanmarkTemplateLibrary = library;
  return activeTemplateItem(plugin);
}

export function templateDocumentStyle(plugin: any): DocumentStyleProfile | undefined {
  return activeTemplateItem(plugin).documentStyle;
}

export function templateTableStyle(plugin: any): FormatProfile | undefined {
  return activeTemplateItem(plugin).tableStyle;
}
