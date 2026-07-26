import type { HanmarkTemplateLibrary } from "../io/templateLibrary";

export type DocxPreviewMode = "fast-docx" | "word-pdf";
export type HtmlExportTheme = "achmage-editorial" | "classic";
export type ImportedImageDestination = "vault" | "cmds-eagle-r2" | "ask";
export type ToolbarPosition = "top";
export type PreviewPosition = "right";
export type ToolbarSkinMode = "auto" | "light" | "dark";
export type ToolbarSkinPaletteKey =
  | "toolbarBg"
  | "toolbarEdge"
  | "buttonBorder"
  | "logoBody"
  | "logoAccent"
  | "logoMuted"
  | "logoText";

export interface ToolbarSkinPalette {
  toolbarBg: string;
  toolbarEdge: string;
  buttonBorder: string;
  logoBody: string;
  logoAccent: string;
  logoMuted: string;
  logoText: string;
}

export interface ToolbarSkin {
  light: ToolbarSkinPalette;
  dark: ToolbarSkinPalette;
}

export const TOOLBAR_SKIN_DEFAULTS: Readonly<ToolbarSkin> = Object.freeze({
  light: Object.freeze({
    toolbarBg: "#38A9FF",
    toolbarEdge: "#1A73E8",
    buttonBorder: "#004D99",
    logoBody: "#1565C0",
    logoAccent: "#42ADFF",
    logoMuted: "#283593",
    logoText: "#FFFFFF"
  }),
  dark: Object.freeze({
    toolbarBg: "#121212",
    toolbarEdge: "#1C1C1C",
    buttonBorder: "#B6FF00",
    logoBody: "#94D600",
    logoAccent: "#B6FF00",
    logoMuted: "#5F7A0A",
    logoText: "#121212"
  })
});

export const TOOLBAR_SKIN_DARK_PRESETS: Readonly<
  Record<"charcoal-minimal" | "neo-lime-dark" | "olive-deck", Readonly<ToolbarSkinPalette>>
> = Object.freeze({
  "charcoal-minimal": TOOLBAR_SKIN_DEFAULTS.dark,
  "neo-lime-dark": Object.freeze({
    toolbarBg: "#1C220B",
    toolbarEdge: "#2A330F",
    buttonBorder: "#B6FF00",
    logoBody: "#94D600",
    logoAccent: "#B6FF00",
    logoMuted: "#5F7A0A",
    logoText: "#121212"
  }),
  "olive-deck": Object.freeze({
    toolbarBg: "#242C14",
    toolbarEdge: "#364119",
    buttonBorder: "#B6FF00",
    logoBody: "#94D600",
    logoAccent: "#B6FF00",
    logoMuted: "#5F7A0A",
    logoText: "#121212"
  })
});

export interface CustomFontEntry {
  family: string;
  /**
   * User-facing source breadcrumb retained for the settings UI. It is never
   * dereferenced as a filesystem path.
   */
  path: string;
  weight: 400 | 700;
  style: "normal" | "italic";
  previewOnly?: boolean;
  /** Content-addressed copy stored through the plugin's Obsidian adapter. */
  cacheId?: string;
  fileName?: string;
}

/**
 * Settings owned by the typed toolbar/HTML/DOCX compatibility layer.
 *
 * HWPX settings deliberately live in the Kordoc modules. Keeping this surface
 * small prevents the retired Python and one-slot HWPX settings from returning.
 */
export interface HanmarkSettings extends Record<string, unknown> {
  settingsVersion: 7;
  pandocPath: string;
  toolbarPosition: ToolbarPosition;
  showToolbarOnStartup: boolean;
  previewPosition: PreviewPosition;
  enableLivePreview: boolean;
  fontDirectoryPath: string;
  activeWordTemplateId: string;
  docxPreviewMode: DocxPreviewMode;
  htmlExportTheme: HtmlExportTheme;
  importedImageDestination: ImportedImageDestination;
  cmdsEagleWorkerUrl: string;
  cmdsEaglePublicUrl: string;
  customFontDirs: string[];
  customFonts: CustomFontEntry[];
  toolbarSkinMode: ToolbarSkinMode;
  toolbarSkin: ToolbarSkin;
  /** Kordoc HWPX templates remain owned by src/io/templateLibrary.ts. */
  hanmarkTemplateLibrary?: HanmarkTemplateLibrary;
}

export const DEFAULT_HANMARK_SETTINGS: Readonly<HanmarkSettings> = Object.freeze({
  settingsVersion: 7,
  pandocPath: "pandoc",
  toolbarPosition: "top",
  showToolbarOnStartup: true,
  previewPosition: "right",
  enableLivePreview: true,
  // The caller resolves this with Obsidian Platform when it wants an OS default.
  fontDirectoryPath: "",
  activeWordTemplateId: "default",
  docxPreviewMode: "fast-docx",
  htmlExportTheme: "achmage-editorial",
  importedImageDestination: "vault",
  cmdsEagleWorkerUrl: "",
  cmdsEaglePublicUrl: "",
  customFontDirs: [],
  customFonts: [],
  toolbarSkinMode: "auto",
  toolbarSkin: cloneToolbarSkin(TOOLBAR_SKIN_DEFAULTS)
});

export type HanmarkRuntimePlatform = "windows" | "macos" | "linux";

const RETIRED_SETTINGS_KEYS = [
  "pythonPath",
  "defaultTemplatePath",
  "cachedTemplateStyles",
  "cachedTemplatePageLayout",
  "cmdsEagleApiKey",
  "cmdsEagleR2ApiKey",
  "r2ApiKey",
  "cloudflareApiKey",
  "cloudflareR2ApiKey"
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

export function cloneToolbarSkin(skin: Readonly<ToolbarSkin>): ToolbarSkin {
  return {
    light: { ...skin.light },
    dark: { ...skin.dark }
  };
}

export function normalizeToolbarSkinMode(value: unknown): ToolbarSkinMode {
  return value === "light" || value === "dark" || value === "auto"
    ? value
    : "auto";
}

export function normalizeHtmlExportTheme(value: unknown): HtmlExportTheme {
  return value === "classic" ? "classic" : "achmage-editorial";
}

export function normalizeImportedImageDestination(
  value: unknown
): ImportedImageDestination {
  return value === "cmds-eagle-r2" || value === "ask" ? value : "vault";
}

export function normalizeToolbarHex(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9a-f]{6}$/i.test(candidate)) return candidate.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(candidate)) return `#${candidate.toUpperCase()}`;
  return fallback;
}

function normalizeToolbarPalette(
  value: unknown,
  variant: keyof ToolbarSkin
): ToolbarSkinPalette {
  const fallback = TOOLBAR_SKIN_DEFAULTS[variant];
  const palette = isRecord(value) ? value : {};
  return {
    toolbarBg: normalizeToolbarHex(palette.toolbarBg, fallback.toolbarBg),
    toolbarEdge: normalizeToolbarHex(palette.toolbarEdge, fallback.toolbarEdge),
    buttonBorder: normalizeToolbarHex(palette.buttonBorder, fallback.buttonBorder),
    logoBody: normalizeToolbarHex(palette.logoBody, fallback.logoBody),
    logoAccent: normalizeToolbarHex(palette.logoAccent, fallback.logoAccent),
    logoMuted: normalizeToolbarHex(palette.logoMuted, fallback.logoMuted),
    logoText: normalizeToolbarHex(palette.logoText, fallback.logoText)
  };
}

function isLegacyOverexposedLimePalette(palette: ToolbarSkinPalette): boolean {
  return (
    palette.buttonBorder === "#B6FF00" &&
    palette.logoBody === "#B6FF00" &&
    palette.logoAccent === "#D4FF4A" &&
    palette.logoMuted === "#EDFF9A" &&
    palette.logoText === "#121212"
  );
}

/**
 * Accepts the nested palette stored by HanMark 2.4.2 and repairs partial or
 * invalid values. All returned colors are canonical #RRGGBB strings, so they
 * can be assigned to CSS custom properties without accepting arbitrary CSS.
 */
export function normalizeToolbarSkin(value: unknown): ToolbarSkin {
  const skin = isRecord(value) ? value : {};
  const light = normalizeToolbarPalette(skin.light, "light");
  let dark = normalizeToolbarPalette(skin.dark, "dark");
  if (isLegacyOverexposedLimePalette(dark)) {
    dark = { ...TOOLBAR_SKIN_DEFAULTS.dark };
  }
  return { light, dark };
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
  if (typeof value.cacheId === "string" && value.cacheId.trim()) {
    entry.cacheId = value.cacheId.trim();
  }
  if (typeof value.fileName === "string" && value.fileName.trim()) {
    entry.fileName = value.fileName.trim();
  }
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
    settingsVersion: 7,
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
    htmlExportTheme: normalizeHtmlExportTheme(data.htmlExportTheme),
    importedImageDestination: normalizeImportedImageDestination(
      data.importedImageDestination
    ),
    cmdsEagleWorkerUrl:
      typeof data.cmdsEagleWorkerUrl === "string"
        ? data.cmdsEagleWorkerUrl.trim()
        : "",
    cmdsEaglePublicUrl:
      typeof data.cmdsEaglePublicUrl === "string"
        ? data.cmdsEaglePublicUrl.trim()
        : "",
    customFontDirs: stringArray(data.customFontDirs),
    customFonts,
    toolbarSkinMode: normalizeToolbarSkinMode(data.toolbarSkinMode),
    toolbarSkin: normalizeToolbarSkin(data.toolbarSkin)
  };
}
