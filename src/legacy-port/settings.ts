import type { HanmarkTemplateLibrary } from "../io/templateLibrary";
import { normalizeFormMemory, type FormMemory } from "../io/formMemory";
import { normalizeRecentExports, type RecentExport } from "../io/recentExports";
import { normalizeLanguagePreference, type LanguagePreference } from "../i18n";
import {
  DEFAULT_IMPORT_DESTINATION,
  normalizeImportPreset,
  normalizeRememberedImportOptions,
  type RememberedImportOptions,
  type ImportDestination,
  type ImportPresetId
} from "../io/importOptions";
import { normalizeEditorialPdfLayout, type EditorialPdfLayout } from "../io/editorialPdfLayout";
import {
  emptyEditorialPdfThemeLibrary,
  normalizeEditorialPdfThemeLibrary,
  type EditorialPdfThemeLibraryV1
} from "../io/editorialPdfTheme";
import { CHECK_FAMILIES, DEFAULT_CHECK_FAMILIES, type CheckFamily } from "../io/gongmunCheckFamilies";

function normalizeCheckFamilies(value: unknown): Record<CheckFamily, boolean> {
  const data = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_CHECK_FAMILIES };
  for (const family of CHECK_FAMILIES) if (typeof data[family] === "boolean") out[family] = data[family];
  return out;
}

export type DocxPreviewMode = "fast-docx" | "word-pdf";
/** DOCX engine: the built-in writer (no installation) or the optional Pandoc path (R-031). */
export type DocxEngine = "builtin" | "pandoc";

/**
 * Engine for saved data: an explicit choice wins; data from before 3.0.0 keeps
 * Pandoc only when the user had pointed HanMark at a Pandoc executable.
 */
export function normalizeDocxEngine(value: unknown, pandocPath: unknown): DocxEngine {
  if (value === "builtin" || value === "pandoc") return value;
  const path = typeof pandocPath === "string" ? pandocPath.trim() : "";
  return path && path !== "pandoc" ? "pandoc" : "builtin";
}
export type HtmlExportTheme = "achmage-editorial" | "classic";
export type ImportedImageDestination = "vault" | "cmds-eagle-r2" | "ask";
export type ToolbarPosition = "top";
/** "classic" is the Hangul-style blue toolbar; "minimal" follows the Obsidian theme (R-028). */
export type ToolbarLook = "classic" | "minimal";
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
  settingsVersion: 12;
  pandocPath: string;
  toolbarPosition: ToolbarPosition;
  showToolbarOnStartup: boolean;
  previewPosition: PreviewPosition;
  enableLivePreview: boolean;
  fontDirectoryPath: string;
  activeWordTemplateId: string;
  docxPreviewMode: DocxPreviewMode;
  docxEngine: DocxEngine;
  htmlExportTheme: HtmlExportTheme;
  importedImageDestination: ImportedImageDestination;
  /**
   * Optional Vault-relative folder override for images kept locally.
   * An empty value preserves Obsidian's configured attachment policy.
   */
  importedImageFolder: string;
  cmdsEagleWorkerUrl: string;
  cmdsEaglePublicUrl: string;
  customFontDirs: string[];
  customFonts: CustomFontEntry[];
  toolbarSkinMode: ToolbarSkinMode;
  toolbarSkin: ToolbarSkin;
  /** Kordoc HWPX templates remain owned by src/io/templateLibrary.ts. */
  hanmarkTemplateLibrary?: HanmarkTemplateLibrary;
  /** Named Editorial PDF themes are Vault-local and contain no resolved colors. */
  editorialPdfThemeLibrary: EditorialPdfThemeLibraryV1;
  editorialPdfLayout: EditorialPdfLayout;
  /** Interface language: follow Obsidian ("auto") or pin Korean/English (2.7.0). */
  uiLanguage: LanguagePreference;
  /** Language of labels written into exported documents; "auto" reads the document. */
  outputLanguage: LanguagePreference;
  /** Stop automatic live-preview refreshes for notes whose preview renders slowly. */
  previewAutoPause: boolean;
  /** Conversion style selected first in the import window. */
  importPreset: ImportPresetId;
  /** Advanced import options used last time (R-032). */
  importAdvanced: RememberedImportOptions;
  /** Where notes created by an import go. */
  importDestination: ImportDestination;
  /** Open .hwp/.hwpx files in HanMark's read-only viewer (applies after restart). */
  openHangulFilesInHanmark: boolean;
  /** Inline embedded notes before every export (note assembly, 2.7.0 W6). */
  assembleEmbeds: boolean;
  /** Export Mermaid code blocks as drawn diagrams (R-033). */
  mermaidDiagrams: boolean;
  /** Always draw diagrams with the document palette instead of the note's colours (R-033). */
  mermaidPaperPalette: boolean;
  /** Official-document check families that run (R-035). */
  gongmunCheckFamilies: Record<CheckFamily, boolean>;
  /** Run the check before an official-document export and show blocking findings (R-035). */
  gongmunPreflight: boolean;
  /** What the HWPX preview shows when it opens: quick HWPX or the official-document form (R-026). */
  hwpxPreviewMode: "quick" | "gongmun";
  /** Toolbar folded to a slim strip (R-028); hiding it completely stays `showToolbarOnStartup`. */
  toolbarCollapsed: boolean;
  /** A folded toolbar opens over the note while the pointer rests on the strip. */
  toolbarPeek: boolean;
  toolbarLook: ToolbarLook;
  /** Fold the formatting row while a note is in reading view. */
  toolbarFoldFormatInReading: boolean;
  /** Last text and highlight colors, applied with one click. */
  toolbarTextColor: string;
  toolbarHighlightColor: string;
  /** HanMark's start panel in empty tabs. */
  showStartPanel: boolean;
  /** Files HanMark recently wrote into the vault, newest first. */
  recentExports: RecentExport[];
  /** The HWPX preview scrolls to the part of the note being edited. */
  previewFollowCursor: boolean;
  /** Korean character counts in the status bar. */
  statusCharCount: boolean;
  /** The note's official-document form in the status bar. */
  statusGongmunForm: boolean;
  /** Official-document form last chosen for each note (path → form id). */
  gongmunFormByNote: FormMemory;
}

export const DEFAULT_HANMARK_SETTINGS: Readonly<HanmarkSettings> = Object.freeze({
  settingsVersion: 12,
  pandocPath: "pandoc",
  toolbarPosition: "top",
  showToolbarOnStartup: true,
  previewPosition: "right",
  enableLivePreview: true,
  // The caller resolves this with Obsidian Platform when it wants an OS default.
  fontDirectoryPath: "",
  activeWordTemplateId: "default",
  docxPreviewMode: "fast-docx",
  docxEngine: "builtin",
  htmlExportTheme: "achmage-editorial",
  importedImageDestination: "vault",
  importedImageFolder: "",
  cmdsEagleWorkerUrl: "",
  cmdsEaglePublicUrl: "",
  customFontDirs: [],
  customFonts: [],
  toolbarSkinMode: "auto",
  toolbarSkin: cloneToolbarSkin(TOOLBAR_SKIN_DEFAULTS),
  editorialPdfThemeLibrary: emptyEditorialPdfThemeLibrary(),
  editorialPdfLayout: normalizeEditorialPdfLayout(undefined),
  uiLanguage: "auto",
  outputLanguage: "auto",
  previewAutoPause: true,
  importPreset: "default",
  importAdvanced: normalizeRememberedImportOptions(undefined),
  importDestination: { ...DEFAULT_IMPORT_DESTINATION },
  openHangulFilesInHanmark: true,
  assembleEmbeds: true,
  mermaidDiagrams: true,
  mermaidPaperPalette: false,
  gongmunCheckFamilies: { ...DEFAULT_CHECK_FAMILIES },
  gongmunPreflight: false,
  hwpxPreviewMode: "quick",
  toolbarCollapsed: false,
  toolbarPeek: false,
  toolbarLook: "classic",
  toolbarFoldFormatInReading: true,
  toolbarTextColor: "#1A73E8",
  toolbarHighlightColor: "#FFF59D",
  showStartPanel: true,
  recentExports: [],
  previewFollowCursor: true,
  statusCharCount: true,
  statusGongmunForm: true,
  gongmunFormByNote: {}
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

/**
 * Accept only a normal Vault-relative folder. Empty means “follow Obsidian's
 * attachment policy”. In particular, never allow an import setting to target
 * the private `.obsidian` configuration tree or escape the Vault root.
 */
export function normalizeImportedImageFolder(value: unknown): string {
  if (typeof value !== "string") return "";
  const candidate = value.trim().replace(/\\/gu, "/");
  if (!candidate) return "";
  if (
    candidate.startsWith("/")
    || /^[a-z]:/iu.test(candidate)
    || [...candidate].some((character) => character.charCodeAt(0) < 32)
    || /[:*?"<>|#[\]^]/u.test(candidate)
  ) {
    return "";
  }
  const parts = candidate
    .split("/")
    .filter((part) => part && part !== ".");
  if (
    !parts.length
    || parts.includes("..")
    || parts[0].startsWith(".")
  ) {
    return "";
  }
  return parts.join("/");
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
    settingsVersion: 12,
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
    docxEngine: normalizeDocxEngine(data.docxEngine, data.pandocPath),
    htmlExportTheme: normalizeHtmlExportTheme(data.htmlExportTheme),
    importedImageDestination: normalizeImportedImageDestination(
      data.importedImageDestination
    ),
    importedImageFolder: normalizeImportedImageFolder(
      data.importedImageFolder
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
    toolbarSkin: normalizeToolbarSkin(data.toolbarSkin),
    editorialPdfLayout: normalizeEditorialPdfLayout(data.editorialPdfLayout),
    editorialPdfThemeLibrary: normalizeEditorialPdfThemeLibrary(
      data.editorialPdfThemeLibrary
    ),
    uiLanguage: normalizeLanguagePreference(data.uiLanguage),
    outputLanguage: normalizeLanguagePreference(data.outputLanguage),
    previewAutoPause:
      typeof data.previewAutoPause === "boolean"
        ? data.previewAutoPause
        : DEFAULT_HANMARK_SETTINGS.previewAutoPause,
    importPreset: normalizeImportPreset(data.importPreset),
    importAdvanced: normalizeRememberedImportOptions(data.importAdvanced),
    importDestination: normalizeImportDestination(data.importDestination),
    openHangulFilesInHanmark:
      typeof data.openHangulFilesInHanmark === "boolean"
        ? data.openHangulFilesInHanmark
        : DEFAULT_HANMARK_SETTINGS.openHangulFilesInHanmark,
    assembleEmbeds:
      typeof data.assembleEmbeds === "boolean"
        ? data.assembleEmbeds
        : DEFAULT_HANMARK_SETTINGS.assembleEmbeds,
    mermaidDiagrams: data.mermaidDiagrams !== false,
    mermaidPaperPalette: data.mermaidPaperPalette === true,
    gongmunCheckFamilies: normalizeCheckFamilies(data.gongmunCheckFamilies),
    gongmunPreflight: data.gongmunPreflight === true,
    hwpxPreviewMode: data.hwpxPreviewMode === "gongmun" ? "gongmun" : "quick",
    toolbarCollapsed: booleanOr(data.toolbarCollapsed, DEFAULT_HANMARK_SETTINGS.toolbarCollapsed),
    toolbarPeek: booleanOr(data.toolbarPeek, DEFAULT_HANMARK_SETTINGS.toolbarPeek),
    toolbarLook: data.toolbarLook === "minimal" ? "minimal" : "classic",
    toolbarFoldFormatInReading: booleanOr(data.toolbarFoldFormatInReading, DEFAULT_HANMARK_SETTINGS.toolbarFoldFormatInReading),
    toolbarTextColor: normalizeToolbarHex(data.toolbarTextColor, DEFAULT_HANMARK_SETTINGS.toolbarTextColor),
    toolbarHighlightColor: normalizeToolbarHex(data.toolbarHighlightColor, DEFAULT_HANMARK_SETTINGS.toolbarHighlightColor),
    showStartPanel: booleanOr(data.showStartPanel, DEFAULT_HANMARK_SETTINGS.showStartPanel),
    recentExports: normalizeRecentExports(data.recentExports),
    previewFollowCursor: booleanOr(data.previewFollowCursor, DEFAULT_HANMARK_SETTINGS.previewFollowCursor),
    statusCharCount: booleanOr(data.statusCharCount, DEFAULT_HANMARK_SETTINGS.statusCharCount),
    statusGongmunForm: booleanOr(data.statusGongmunForm, DEFAULT_HANMARK_SETTINGS.statusGongmunForm),
    gongmunFormByNote: normalizeFormMemory(data.gongmunFormByNote)
  };
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Accepts only a known mode and a safe Vault-relative folder (see normalizeImportedImageFolder). */
export function normalizeImportDestination(value: unknown): ImportDestination {
  const data = isRecord(value) ? value : {};
  const mode = data.mode === "folder" || data.mode === "ask" ? data.mode : "note-folder";
  return { mode, folder: normalizeImportedImageFolder(data.folder) };
}
