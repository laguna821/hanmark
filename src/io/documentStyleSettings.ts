import { Notice } from "obsidian";
import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { hwpxToProfile, unknownFontWarnings, validateHwpx } from "kordoc";
import {
  documentStyleSummary,
  extractDocumentStyleProfile,
  normalizeDocumentStyleProfile,
  type DocumentStyleProfile
} from "./documentStyle";
import { pickHwpxFile } from "./tableStyle";
import type { HanmarkDocumentStylePresetId } from "./documentStylePresets";
import {
  activeTemplateItem,
  availableTemplateName,
  deleteTemplateRecordInMemory,
  getTemplateLibrary,
  isBuiltInTemplateId,
  listTemplateItems,
  migrateTemplateLibrarySettingsInMemory,
  newTemplateRecord,
  putTemplateRecord,
  setActiveTemplateInMemory,
  templateDocumentStyle,
  type HanmarkTemplateItem,
  type HanmarkTemplateRecord
} from "./templateLibrary";

export function migrateDocumentStyleSettingsInMemory(plugin: any): boolean {
  return migrateTemplateLibrarySettingsInMemory(plugin?.settings);
}

/** Compatibility view for older callers; custom profiles map to `custom`. */
export function activeDocumentStylePreset(plugin: any): HanmarkDocumentStylePresetId {
  const id = getTemplateLibrary(plugin).activeId;
  if (id === "builtin:korean-communication") return "korean-communication";
  if (id === "builtin:youth-studies") return "youth-studies";
  if (id === "builtin:kordoc-default") return "kordoc-default";
  return "custom";
}

export function activeDocumentStyle(plugin: any): DocumentStyleProfile | undefined {
  return templateDocumentStyle(plugin);
}

export function activeDocumentStyleName(plugin: any): string {
  return activeTemplateItem(plugin).name;
}

export function activeTemplateId(plugin: any): string {
  return getTemplateLibrary(plugin).activeId;
}

export function availableDocumentTemplates(plugin: any): HanmarkTemplateItem[] {
  return listTemplateItems(plugin);
}

export function activeDocumentTemplate(plugin: any): HanmarkTemplateItem {
  return activeTemplateItem(plugin);
}

export async function setActiveDocumentTemplate(plugin: any, id: string): Promise<HanmarkTemplateItem> {
  const item = setActiveTemplateInMemory(plugin, id);
  await plugin.saveSettings();
  return item;
}

export async function setDocumentStylePreset(plugin: any, preset: HanmarkDocumentStylePresetId): Promise<void> {
  const id = preset === "korean-communication"
    ? "builtin:korean-communication"
    : preset === "youth-studies"
      ? "builtin:youth-studies"
      : preset === "custom"
        ? Object.keys(getTemplateLibrary(plugin).customTemplates)[0]
        : "builtin:kordoc-default";
  if (!id) throw new Error("가져오거나 직접 만든 사용자 HWPX 템플릿이 없습니다.");
  await setActiveDocumentTemplate(plugin, id);
}

export async function createDocumentTemplate(
  plugin: any,
  name: string,
  documentStyle?: DocumentStyleProfile,
  tableStyle?: any,
  sourceName?: string
): Promise<HanmarkTemplateRecord> {
  const record = newTemplateRecord(plugin, name, documentStyle, tableStyle, sourceName);
  const saved = putTemplateRecord(plugin, record);
  setActiveTemplateInMemory(plugin, saved.id);
  await plugin.saveSettings();
  return saved;
}

export async function duplicateDocumentTemplate(plugin: any, id: string): Promise<HanmarkTemplateRecord> {
  const source = listTemplateItems(plugin).find((item) => item.id === id);
  if (!source) throw new Error("복제할 HWPX 템플릿을 찾을 수 없습니다.");
  return createDocumentTemplate(
    plugin,
    availableTemplateName(plugin, `${source.name} 복사본`),
    source.documentStyle,
    source.tableStyle,
    source.sourceName
  );
}

export async function renameDocumentTemplate(plugin: any, id: string, name: string): Promise<HanmarkTemplateRecord> {
  if (isBuiltInTemplateId(id)) throw new Error("내장 템플릿은 이름을 바꿀 수 없습니다. 먼저 복제하세요.");
  const library = getTemplateLibrary(plugin);
  const current = library.customTemplates[id];
  if (!current) throw new Error("이름을 바꿀 HWPX 템플릿을 찾을 수 없습니다.");
  const saved = putTemplateRecord(plugin, { ...current, name });
  await plugin.saveSettings();
  return saved;
}

export async function deleteDocumentTemplate(plugin: any, id: string): Promise<boolean> {
  const deleted = deleteTemplateRecordInMemory(plugin, id);
  if (deleted) await plugin.saveSettings();
  return deleted;
}

export async function saveDocumentStyle(plugin: any, profile: DocumentStyleProfile): Promise<HanmarkTemplateRecord> {
  const normalized = normalizeDocumentStyleProfile(profile);
  const active = activeTemplateItem(plugin);
  let record: HanmarkTemplateRecord;
  if (active.builtIn) {
    record = newTemplateRecord(plugin, normalized.name || `${active.name} 사용자 설정`, normalized, active.tableStyle, normalized.sourceName);
  } else {
    const library = getTemplateLibrary(plugin);
    const existing = library.customTemplates[active.id];
    if (!existing) throw new Error("편집 중인 사용자 HWPX 템플릿을 찾을 수 없습니다.");
    record = { ...existing, name: normalized.name || existing.name, documentStyle: normalized };
  }
  const saved = putTemplateRecord(plugin, record);
  setActiveTemplateInMemory(plugin, saved.id);
  await plugin.saveSettings();
  new Notice(`HWPX 템플릿 저장 완료: ${saved.name} · ${documentStyleSummary(normalized)}`);
  return saved;
}

export async function importDocumentStyle(plugin: any): Promise<boolean> {
  const path = await pickHwpxFile("새 HWPX 템플릿으로 가져올 파일 선택");
  if (!path) return false;
  const data = await fs.readFile(path);
  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const validation = await validateHwpx(view);
  const sourceName = nodePath.basename(path);
  const profile = await extractDocumentStyleProfile(view, sourceName);
  const format = validation.ok ? await hwpxToProfile(Buffer.from(view)) : { tables: [] };
  const tableStyle = format.tables.length ? format : undefined;
  const record = await createDocumentTemplate(plugin, profile.name || sourceName, profile, tableStyle, sourceName);

  const fonts: Record<string, string | undefined> = {};
  for (const [role, style] of Object.entries(profile.roles)) fonts[role] = style?.character?.fontFamily;
  const fontWarnings = unknownFontWarnings(fonts);
  const tableNote = tableStyle ? ` · 표 스타일 ${tableStyle.tables.length}개 포함` : "";
  new Notice(`HWPX 템플릿 추가 완료: ${record.name}${tableNote}`);
  if (!validation.ok) {
    new Notice("구형 HWPX에서 안전한 스타일 값만 가져왔습니다. 원본 본문 구조는 복사하지 않았습니다.", 8_000);
  }
  if (fontWarnings.length) new Notice(fontWarnings.slice(0, 3).join(" · "), 8_000);
  return true;
}

/** Older command compatibility: delete only the active custom template. */
export async function clearDocumentStyle(plugin: any): Promise<void> {
  const active = activeTemplateItem(plugin);
  if (active.builtIn) return;
  if (await deleteDocumentTemplate(plugin, active.id)) new Notice("사용자 HWPX 템플릿을 삭제하고 Kordoc 기본으로 전환했습니다.");
}

/** Kept as an inert compatibility hook until legacy-main.cjs is removed in 3.0. */
export async function synchronizeLegacyTemplateCache(_plugin: any): Promise<boolean> {
  return false;
}
