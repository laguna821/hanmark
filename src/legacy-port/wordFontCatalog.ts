import {
  bytesAsArrayBuffer,
  filenameFromDisplayPath,
  splitFilename,
  type FileGateway,
  type SelectedExternalFile
} from "../io/fileGateway";
import type { CustomFontEntry, HanmarkSettings } from "./settings";

declare global {
  /**
   * CSS Font Loading defines FontFaceSet as a mutable setlike collection.
   * TypeScript 5.9's DOM declarations currently omit its standard add method.
   */
  interface FontFaceSet {
    add(face: FontFace): FontFaceSet;
  }
}

export type WordFontSource =
  | "document"
  | "recommended"
  | "installed"
  | "custom-file";

export interface WordFontCatalogEntry {
  family: string;
  displayName: string;
  previewFamily: string;
  source: WordFontSource;
  weight: 400 | 700;
  style: "normal" | "italic";
  cacheId?: string;
  sourceLabel?: string;
}

export interface InstalledFontDiscovery {
  entries: WordFontCatalogEntry[];
  method: "local-font-access" | "known-font-probe";
}

interface LocalFontDataLike {
  family: string;
  fullName?: string;
  postscriptName?: string;
  style?: string;
}

interface LocalFontAccessWindow extends Window {
  queryLocalFonts?: () => Promise<LocalFontDataLike[]>;
}

interface FontFaceWindow extends Window {
  FontFace?: typeof FontFace;
}

const FONT_EXTENSIONS = ["ttf", "otf", "ttc", "woff", "woff2"];
export const FONT_PICK_LIMITS = {
  maxFiles: 256,
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024
} as const;
const PREVIEW_SAMPLE = "Aa 한글 123";

/**
 * A useful zero-permission baseline. The explicit "installed fonts" action
 * replaces these suggestions with the browser's real local-font result where
 * supported.
 */
export const RECOMMENDED_WORD_FONTS = [
  "맑은 고딕",
  "Malgun Gothic",
  "함초롬바탕",
  "함초롬돋움",
  "신명조",
  "한양신명조",
  "HY견고딕",
  "휴먼명조",
  "바탕",
  "굴림",
  "돋움",
  "AppleMyungjo",
  "Apple SD Gothic Neo",
  "Arial",
  "Calibri",
  "Cambria",
  "Consolas",
  "D2Coding",
  "Georgia",
  "Noto Sans CJK KR",
  "Noto Serif CJK KR",
  "Times New Roman"
] as const;

function cleanFamily(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceRank(source: WordFontSource): number {
  if (source === "custom-file") return 0;
  if (source === "installed") return 1;
  if (source === "document") return 2;
  return 3;
}

function entryKey(entry: Pick<WordFontCatalogEntry, "family" | "weight" | "style">): string {
  return `${entry.family.toLocaleLowerCase()}::${entry.weight}::${entry.style}`;
}

function customEntryKey(entry: Pick<CustomFontEntry, "family" | "weight" | "style">): string {
  return `${entry.family.toLocaleLowerCase()}::${entry.weight}::${entry.style}`;
}

function displayNameFromFilename(name: string): string {
  const { stem } = splitFilename(name);
  return cleanFamily(
    stem
      .replace(/[-_]+/g, " ")
      .replace(/\b(?:bold|semibold|demibold|heavy|black|italic|oblique|regular)\b/gi, "")
  ) || "사용자 글꼴";
}

function fontWeight(name: string): 400 | 700 {
  return /bold|semibold|demibold|heavy|black/i.test(name) ? 700 : 400;
}

function fontStyle(name: string): "normal" | "italic" {
  return /italic|oblique/i.test(name) ? "italic" : "normal";
}

function stringAt(view: DataView, offset: number, length: number): string {
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(view.getUint8(offset + index));
  }
  return result;
}

function decodeUtf16Be(view: DataView, offset: number, length: number): string {
  let result = "";
  const end = offset + length - (length % 2);
  for (let cursor = offset; cursor < end; cursor += 2) {
    result += String.fromCharCode(view.getUint16(cursor, false));
  }
  return result;
}

function decodeSingleByte(view: DataView, offset: number, length: number): string {
  let result = "";
  for (let cursor = offset; cursor < offset + length; cursor += 1) {
    result += String.fromCharCode(view.getUint8(cursor));
  }
  return result;
}

function sfntOffset(view: DataView): number {
  if (view.byteLength < 12 || stringAt(view, 0, 4) !== "ttcf") return 0;
  const count = view.getUint32(8, false);
  if (count < 1 || view.byteLength < 16) return 0;
  return view.getUint32(12, false);
}

function tableOffset(view: DataView, fontOffset: number, wantedTag: string): number | null {
  if (fontOffset < 0 || fontOffset + 12 > view.byteLength) return null;
  const count = view.getUint16(fontOffset + 4, false);
  const directoryEnd = fontOffset + 12 + count * 16;
  if (directoryEnd > view.byteLength) return null;
  for (let index = 0; index < count; index += 1) {
    const record = fontOffset + 12 + index * 16;
    if (stringAt(view, record, 4) !== wantedTag) continue;
    const offset = view.getUint32(record + 8, false);
    return offset < view.byteLength ? offset : null;
  }
  return null;
}

/**
 * Reads the OpenType typographic-family/family name without native modules.
 * Unsupported web-font containers simply use their filename as a safe
 * editable fallback.
 */
export function readOpenTypeFamily(
  bytes: Uint8Array,
  fallbackName: string
): string {
  const fallback = displayNameFromFilename(fallbackName);
  if (bytes.byteLength < 12) return fallback;
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  );
  const fontOffset = sfntOffset(view);
  const nameOffset = tableOffset(view, fontOffset, "name");
  if (nameOffset === null || nameOffset + 6 > view.byteLength) return fallback;
  const count = view.getUint16(nameOffset + 2, false);
  const storage = nameOffset + view.getUint16(nameOffset + 4, false);
  if (nameOffset + 6 + count * 12 > view.byteLength || storage > view.byteLength) {
    return fallback;
  }

  let best = "";
  let bestScore = -1;
  for (let index = 0; index < count; index += 1) {
    const record = nameOffset + 6 + index * 12;
    const platform = view.getUint16(record, false);
    const language = view.getUint16(record + 4, false);
    const nameId = view.getUint16(record + 6, false);
    if (nameId !== 16 && nameId !== 1 && nameId !== 4) continue;
    const length = view.getUint16(record + 8, false);
    const offset = storage + view.getUint16(record + 10, false);
    if (offset + length > view.byteLength) continue;
    const decoded = platform === 0 || platform === 3
      ? decodeUtf16Be(view, offset, length)
      : decodeSingleByte(view, offset, length);
    const family = cleanFamily(decoded);
    if (!family) continue;
    const nameScore = nameId === 16 ? 300 : nameId === 1 ? 200 : 100;
    const languageScore = language === 0x0412 || language === 0x0409 ? 20 : 0;
    const platformScore = platform === 3 ? 10 : platform === 0 ? 5 : 0;
    const score = nameScore + languageScore + platformScore;
    if (score > bestScore) {
      best = family;
      bestScore = score;
    }
  }
  return best || fallback;
}

function recommendedEntry(family: string): WordFontCatalogEntry {
  return {
    family,
    displayName: family,
    previewFamily: family,
    source: "recommended",
    weight: 400,
    style: "normal"
  };
}

function customCatalogEntry(entry: CustomFontEntry): WordFontCatalogEntry {
  return {
    family: entry.family,
    displayName: entry.family,
    previewFamily: entry.family,
    source: "custom-file",
    weight: entry.weight,
    style: entry.style,
    cacheId: entry.cacheId,
    sourceLabel: entry.fileName || filenameFromDisplayPath(entry.path, entry.path)
  };
}

export function filterWordFontEntries(
  entries: readonly WordFontCatalogEntry[],
  query: string
): WordFontCatalogEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...entries];
  return entries.filter((entry) =>
    `${entry.displayName} ${entry.family} ${entry.source} ${entry.sourceLabel ?? ""}`
      .toLocaleLowerCase()
      .includes(needle)
  );
}

async function localFontAvailable(family: string): Promise<boolean> {
  if (typeof FontFace !== "function") return false;
  try {
    const escaped = family.replace(/["\\]/g, "\\$&");
    const face = new FontFace("__hanmark_local_font_probe__", `local("${escaped}")`);
    await face.load();
    return face.status === "loaded";
  } catch {
    return false;
  }
}

function rootDirectoryLabel(files: readonly SelectedExternalFile[]): string | null {
  for (const file of files) {
    const root = file.relativePath?.split(/[\\/]/).filter(Boolean)[0];
    if (root) return root;
  }
  return null;
}

export class WordFontCatalog {
  private readonly getSettings: () => HanmarkSettings;
  private readonly fileGateway: FileGateway;
  private installedEntries: WordFontCatalogEntry[] = [];
  private readonly loadedPreviewFaces = new WeakMap<Document, Set<string>>();

  constructor(
    settings: HanmarkSettings | (() => HanmarkSettings),
    fileGateway: FileGateway
  ) {
    this.getSettings =
      typeof settings === "function" ? settings : () => settings;
    this.fileGateway = fileGateway;
  }

  getPreviewSample(): string {
    return PREVIEW_SAMPLE;
  }

  listFamilies(documentFamilies: readonly string[] = []): WordFontCatalogEntry[] {
    const settings = this.getSettings();
    const candidates: WordFontCatalogEntry[] = [
      ...settings.customFonts.map(customCatalogEntry),
      ...this.installedEntries,
      ...documentFamilies
        .map(cleanFamily)
        .filter(Boolean)
        .map((family) => ({
          ...recommendedEntry(family),
          source: "document" as const
        })),
      ...RECOMMENDED_WORD_FONTS.map(recommendedEntry)
    ];
    const unique = new Map<string, WordFontCatalogEntry>();
    for (const entry of candidates) {
      const key = entryKey(entry);
      const existing = unique.get(key);
      if (!existing || sourceRank(entry.source) < sourceRank(existing.source)) {
        unique.set(key, entry);
      }
    }
    return [...unique.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName, undefined, {
        sensitivity: "base"
      })
    );
  }

  listCustomFonts(): WordFontCatalogEntry[] {
    return this.getSettings().customFonts.map(customCatalogEntry);
  }

  async discoverInstalledFonts(): Promise<InstalledFontDiscovery> {
    const localWindow = window as LocalFontAccessWindow;
    if (typeof localWindow.queryLocalFonts === "function") {
      const discovered = await localWindow.queryLocalFonts();
      this.installedEntries = discovered
        .map((font): WordFontCatalogEntry | null => {
          const family = cleanFamily(font.family);
          if (!family) return null;
          const label = cleanFamily(font.fullName || font.postscriptName || family);
          const styleLabel = `${font.style ?? ""} ${label}`;
          return {
            family,
            displayName: label || family,
            previewFamily: family,
            source: "installed",
            weight: fontWeight(styleLabel),
            style: fontStyle(styleLabel)
          };
        })
        .filter((entry): entry is WordFontCatalogEntry => entry !== null);
      return {
        entries: [...this.installedEntries],
        method: "local-font-access"
      };
    }

    const available = await Promise.all(
      RECOMMENDED_WORD_FONTS.map(async (family) => ({
        family,
        available: await localFontAvailable(family)
      }))
    );
    this.installedEntries = available
      .filter((item) => item.available)
      .map(({ family }) => ({
        ...recommendedEntry(family),
        source: "installed" as const
      }));
    return {
      entries: [...this.installedEntries],
      method: "known-font-probe"
    };
  }

  async pickFontFiles(): Promise<CustomFontEntry[]> {
    const files = await this.fileGateway.pickFiles({
      title: "미리보기에 사용할 글꼴 파일 선택",
      extensions: FONT_EXTENSIONS,
      multiple: true,
      ...FONT_PICK_LIMITS
    });
    return this.importSelectedFiles(files);
  }

  async pickFontDirectory(): Promise<CustomFontEntry[]> {
    const files = await this.fileGateway.pickFiles({
      title: "미리보기에 사용할 글꼴 폴더 선택",
      extensions: FONT_EXTENSIONS,
      multiple: true,
      directory: true,
      ...FONT_PICK_LIMITS
    });
    const imported = await this.importSelectedFiles(files);
    const label = rootDirectoryLabel(files);
    const settings = this.getSettings();
    if (label && !settings.customFontDirs.includes(label)) {
      settings.customFontDirs.push(label);
    }
    return imported;
  }

  async importSelectedFiles(
    files: readonly SelectedExternalFile[]
  ): Promise<CustomFontEntry[]> {
    const imported: CustomFontEntry[] = [];
    for (const file of files) {
      const extension = splitFilename(file.name).extension.replace(/^\./, "").toLowerCase();
      if (!FONT_EXTENSIONS.includes(extension)) continue;
      const family = readOpenTypeFamily(file.bytes, file.name);
      const label = file.relativePath || file.name;
      const styleLabel = `${file.name} ${family}`;
      const cacheId = await this.fileGateway.cacheSource(file.bytes, {
        byteLength: file.bytes.byteLength,
        sourceName: file.name
      });
      imported.push({
        family,
        path: label,
        fileName: file.name,
        cacheId,
        weight: fontWeight(styleLabel),
        style: fontStyle(styleLabel),
        previewOnly: true
      });
    }

    if (!imported.length) return [];
    const settings = this.getSettings();
    const merged = new Map<string, CustomFontEntry>();
    for (const entry of settings.customFonts) {
      merged.set(customEntryKey(entry), entry);
    }
    for (const entry of imported) merged.set(customEntryKey(entry), entry);
    settings.customFonts = [...merged.values()].sort((left, right) =>
      left.family.localeCompare(right.family, undefined, { sensitivity: "base" })
    );
    await this.applyPreviewFonts();
    return imported;
  }

  removeCustomFont(entry: WordFontCatalogEntry): boolean {
    const settings = this.getSettings();
    const before = settings.customFonts.length;
    settings.customFonts = settings.customFonts.filter(
      (font) => customEntryKey(font) !== entryKey(entry)
    );
    return settings.customFonts.length !== before;
  }

  async applyPreviewFonts(target?: Document): Promise<void> {
    const previewDocument =
      target ?? (typeof document === "undefined" ? null : document);
    const FontFaceConstructor =
      (previewDocument?.defaultView as FontFaceWindow | null)?.FontFace ??
      (typeof FontFace === "function" ? FontFace : null);
    if (
      !previewDocument ||
      !FontFaceConstructor ||
      !previewDocument.fonts
    ) {
      return;
    }
    const fontSet = previewDocument.fonts;
    let loadedForDocument = this.loadedPreviewFaces.get(previewDocument);
    if (!loadedForDocument) {
      loadedForDocument = new Set<string>();
      this.loadedPreviewFaces.set(previewDocument, loadedForDocument);
    }
    const settings = this.getSettings();
    await Promise.all(
      settings.customFonts.map(async (entry) => {
        if (!entry.cacheId) return;
        const key = `${entry.cacheId}::${entry.family}::${entry.weight}::${entry.style}`;
        if (loadedForDocument.has(key)) return;
        try {
          const bytes = await this.fileGateway.readCachedSource(entry.cacheId);
          if (!bytes) return;
          const face = new FontFaceConstructor(
            entry.family,
            bytesAsArrayBuffer(bytes),
            {
              style: entry.style,
              weight: String(entry.weight)
            }
          );
          await face.load();
          fontSet.add(face);
          loadedForDocument.add(key);
        } catch {
          // A missing cache entry or unsupported font must not block editing.
        }
      })
    );
  }
}
