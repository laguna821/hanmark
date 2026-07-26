import type { HanmarkTemplateLibrary } from "../io/templateLibrary";

export type DocxPreviewMode = "fast-docx" | "word-pdf";
export type ToolbarPosition = "top";
export type PreviewPosition = "right";

export interface CustomFontEntry {
  family: string;
  path: string;
  weight: 400 | 700;
  style: "normal" | "italic";
  previewOnly?: boolean;
}

/**
 * Settings owned by the typed toolbar/HTML/DOCX compatibility layer.
 *
 * HWPX settings deliberately live in the Kordoc modules. Keeping this surface
 * small prevents the retired Python and one-slot HWPX settings from returning.
 */
export interface HanmarkSettings extends Record<string, unknown> {
  settingsVersion: 5;
  pandocPath: string;
  toolbarPosition: ToolbarPosition;
  showToolbarOnStartup: boolean;
  previewPosition: PreviewPosition;
  enableLivePreview: boolean;
  fontDirectoryPath: string;
  activeWordTemplateId: string;
  docxPreviewMode: DocxPreviewMode;
  customFontDirs: string[];
  customFonts: CustomFontEntry[];
  /** Kordoc HWPX templates remain owned by src/io/templateLibrary.ts. */
  hanmarkTemplateLibrary?: HanmarkTemplateLibrary;
}

export const DEFAULT_HANMARK_SETTINGS: Readonly<HanmarkSettings> = Object.freeze({
  settingsVersion: 5,
  pandocPath: "pandoc",
  toolbarPosition: "top",
  showToolbarOnStartup: true,
  previewPosition: "right",
  enableLivePreview: true,
  // The caller resolves this with Obsidian Platform when it wants an OS default.
  fontDirectoryPath: "",
  activeWordTemplateId: "default",
  docxPreviewMode: "fast-docx",
  customFontDirs: [],
  customFonts: []
});

export type HanmarkRuntimePlatform = "windows" | "macos" | "linux";

const RETIRED_SETTINGS_KEYS = [
  "pythonPath",
  "defaultTemplatePath",
  "cachedTemplateStyles",
  "cachedTemplatePageLayout"
] as const;

export function defaultFontDirectory(platform: HanmarkRuntimePlatform): string {
  if (platform === "windows") return "C:\\Windows\\Fonts";
  if (platform === "macos") return "/System/Library/Fonts";
  return "/usr/share/fonts";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeCustomFont(value: unknown): CustomFontEntry | null {
  if (!isRecord(value)) return null;
  const family = nonEmptyString(value.family, "");
  const path = nonEmptyString(value.path, "");
  if (!family || !path) return null;
  const entry: CustomFontEntry = {
    family,
    path,
    weight: value.weight === 700 ? 700 : 400,
    style: value.style === "italic" ? "italic" : "normal"
  };
  if (typeof value.previewOnly === "boolean") entry.previewOnly = value.previewOnly;
  return entry;
}

/**
 * Reads old data.json values without carrying forward Python/pypandoc fields.
 * Unknown Kordoc-owned settings are left to the main plugin's own migration.
 */
export function normalizeHanmarkSettings(
  raw: unknown,
  platform?: HanmarkRuntimePlatform
): HanmarkSettings {
  const data = isRecord(raw) ? raw : {};
  const preserved: Record<string, unknown> = { ...data };
  for (const key of RETIRED_SETTINGS_KEYS) delete preserved[key];
  const customFonts = Array.isArray(data.customFonts)
    ? data.customFonts.map(normalizeCustomFont).filter((item): item is CustomFontEntry => item !== null)
    : [];
  const fallbackFontDirectory = platform ? defaultFontDirectory(platform) : "";

  return {
    ...preserved,
    settingsVersion: 5,
    pandocPath: nonEmptyString(data.pandocPath, DEFAULT_HANMARK_SETTINGS.pandocPath),
    toolbarPosition: "top",
    showToolbarOnStartup:
      typeof data.showToolbarOnStartup === "boolean"
        ? data.showToolbarOnStartup
        : DEFAULT_HANMARK_SETTINGS.showToolbarOnStartup,
    previewPosition: "right",
    enableLivePreview:
      typeof data.enableLivePreview === "boolean"
        ? data.enableLivePreview
        : DEFAULT_HANMARK_SETTINGS.enableLivePreview,
    fontDirectoryPath: nonEmptyString(data.fontDirectoryPath, fallbackFontDirectory),
    activeWordTemplateId: nonEmptyString(data.activeWordTemplateId, "default"),
    docxPreviewMode: data.docxPreviewMode === "word-pdf" ? "word-pdf" : "fast-docx",
    customFontDirs: stringArray(data.customFontDirs),
    customFonts
  };
}
