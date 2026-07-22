import { Notice } from "obsidian";
import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { hwpxToProfile, validateHwpx, type FormatProfile } from "kordoc";
import {
  activeTemplateItem,
  deleteTemplateRecordInMemory,
  getTemplateLibrary,
  newTemplateRecord,
  putTemplateRecord,
  setActiveTemplateInMemory,
  templateTableStyle
} from "./templateLibrary";

export function pickHwpxFile(title = "스타일을 가져올 HWPX 선택"): Promise<string | null> {
  try {
    const req: any = (window as any).require;
    const dialog =
      req?.("@electron/remote")?.dialog ??
      req?.("electron")?.remote?.dialog ??
      req?.("electron")?.dialog;
    if (dialog?.showOpenDialog) {
      return dialog
        .showOpenDialog({
          title,
          properties: ["openFile"],
          filters: [{ name: "HWPX", extensions: ["hwpx"] }]
        })
        .then((result: any) => (result?.canceled ? null : result?.filePaths?.[0] ?? null));
    }
  } catch {
    /* fall through */
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".hwpx";
    input.onchange = () => {
      const file: any = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(file.path || (window as any).require("electron").webUtils.getPathForFile(file));
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}

export function activeTableProfile(plugin: any): FormatProfile | undefined {
  return templateTableStyle(plugin);
}

export function activeTableProfileName(plugin: any): string | undefined {
  const active = activeTemplateItem(plugin);
  return active.tableStyle?.tables?.length ? active.name : undefined;
}

/** Import only table border/shading/width/font information, never the document body. */
export async function importTableStyle(plugin: any): Promise<boolean> {
  const path = await pickHwpxFile("표 스타일을 가져올 HWPX 선택");
  if (!path) return false;
  const data = await fs.readFile(path);
  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const validation = await validateHwpx(view);
  if (!validation.ok) {
    throw new Error(`표 스타일 원본 검증 실패: ${validation.issues[0]?.message || "잘못된 HWPX"}`);
  }
  const profile = await hwpxToProfile(Buffer.from(view));
  if (!profile.tables.length) throw new Error("선택한 HWPX에 가져올 표가 없습니다.");

  const active = activeTemplateItem(plugin);
  const sourceName = nodePath.basename(path);
  if (active.builtIn) {
    const record = newTemplateRecord(plugin, `${active.name} + ${sourceName}`, active.documentStyle, profile, sourceName);
    putTemplateRecord(plugin, record);
    setActiveTemplateInMemory(plugin, record.id);
  } else {
    const record = getTemplateLibrary(plugin).customTemplates[active.id];
    if (!record) throw new Error("활성 사용자 HWPX 템플릿을 찾을 수 없습니다.");
    putTemplateRecord(plugin, { ...record, tableStyle: profile, sourceName });
  }
  await plugin.saveSettings();
  new Notice(`활성 HWPX 템플릿에 표 스타일 추가: ${sourceName} · 표 ${profile.tables.length}개`);
  return true;
}

export async function clearTableStyle(plugin: any): Promise<void> {
  const active = activeTemplateItem(plugin);
  if (active.builtIn || !active.tableStyle) return;
  const record = getTemplateLibrary(plugin).customTemplates[active.id];
  if (!record) return;
  if (record.documentStyle) putTemplateRecord(plugin, { ...record, tableStyle: undefined });
  else deleteTemplateRecordInMemory(plugin, record.id);
  await plugin.saveSettings();
  new Notice("활성 HWPX 템플릿에서 표 스타일을 제거했습니다.");
}
