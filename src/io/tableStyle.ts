import { Notice, type App } from "obsidian";
import { hwpxToProfile, validateHwpx, type FormatProfile } from "kordoc";
import {
  activeTemplateItem,
  deleteTemplateRecordInMemory,
  getTemplateLibrary,
  newTemplateRecord,
  putTemplateRecord,
  setActiveTemplateInMemory,
  templateTableStyle,
  type TemplateLibraryHost
} from "./templateLibrary";
import {
  bytesAsArrayBuffer,
  createFileGateway,
  type SelectedExternalFile
} from "./fileGateway";

export interface HanmarkSettingsPlugin extends TemplateLibraryHost {
  app: App;
  manifest?: { id: string };
}

export async function pickHwpxFile(
  app: App,
  plugin?: unknown,
  title = "스타일을 가져올 HWPX 선택"
): Promise<SelectedExternalFile | null> {
  const selected = await createFileGateway(app, plugin).pickFiles({
    title,
    extensions: ["hwpx"],
    multiple: false
  });
  return selected[0] ?? null;
}

export function activeTableProfile(
  plugin: TemplateLibraryHost
): FormatProfile | undefined {
  return templateTableStyle(plugin);
}

export function activeTableProfileName(plugin: TemplateLibraryHost): string | undefined {
  const active = activeTemplateItem(plugin);
  return active.tableStyle?.tables?.length ? active.name : undefined;
}

/** Import only table border/shading/width/font information, never the document body. */
export async function importTableStyle(plugin: HanmarkSettingsPlugin): Promise<boolean> {
  const selected = await pickHwpxFile(
    plugin.app,
    plugin,
    "표 스타일을 가져올 HWPX 선택"
  );
  if (!selected) return false;
  const buffer = bytesAsArrayBuffer(selected.bytes);
  const validation = await validateHwpx(buffer);
  if (!validation.ok) {
    throw new Error(
      `표 스타일 원본 검증 실패: ${
        validation.issues[0]?.message || "올바르지 않은 HWPX"
      }`
    );
  }
  const profile = await hwpxToProfile(buffer);
  if (!profile.tables.length) throw new Error("선택한 HWPX에 가져올 표가 없습니다.");

  const active = activeTemplateItem(plugin);
  const sourceName = selected.name;
  if (active.builtIn) {
    const record = newTemplateRecord(
      plugin,
      `${active.name} + ${sourceName}`,
      active.documentStyle,
      profile,
      sourceName
    );
    putTemplateRecord(plugin, record);
    setActiveTemplateInMemory(plugin, record.id);
  } else {
    const record = getTemplateLibrary(plugin).customTemplates[active.id];
    if (!record) throw new Error("활성 사용자 HWPX 템플릿을 찾을 수 없습니다.");
    putTemplateRecord(plugin, { ...record, tableStyle: profile, sourceName });
  }
  await plugin.saveSettings();
  new Notice(
    `활성 HWPX 템플릿에 표 스타일 추가: ${sourceName} · 표 ${profile.tables.length}개`
  );
  return true;
}

export async function clearTableStyle(plugin: HanmarkSettingsPlugin): Promise<void> {
  const active = activeTemplateItem(plugin);
  if (active.builtIn || !active.tableStyle) return;
  const record = getTemplateLibrary(plugin).customTemplates[active.id];
  if (!record) return;
  if (record.documentStyle) putTemplateRecord(plugin, { ...record, tableStyle: undefined });
  else deleteTemplateRecordInMemory(plugin, record.id);
  await plugin.saveSettings();
  new Notice("활성 HWPX 템플릿에서 표 스타일을 제거했습니다.");
}
