export const EDITORIAL_PDF_THEME_SCHEMA_VERSION = 1 as const;
export const BUILTIN_EDITORIAL_PDF_THEME_ID = "builtin:achmage-hanmark" as const;
export const BUILTIN_EDITORIAL_PDF_THEME_NAME = "Achmage HanMark 기본";
export const EDITORIAL_PDF_THEME_EXCHANGE_FORMAT =
  "hanmark-editorial-pdf-theme" as const;
export const EDITORIAL_PDF_THEME_MAX_JSON_BYTES = 256 * 1024;

export const EDITORIAL_PDF_THEME_LIMITS = Object.freeze({
  name: 100,
  coverTitle: 120,
  coverText: 60,
  pageText: 20,
  tagCount: 8,
  tag: 24
});

export type EditorialPdfTitleMode = "file-title" | "custom" | "blank";
export type EditorialPdfOverrideToken = "onKey" | "keyInk" | "accentLine";

export interface EditorialPdfThemeV1 {
  schemaVersion: 1;
  colors: {
    key: string;
    overrides: {
      onKey: string | null;
      keyInk: string | null;
      accentLine: string | null;
    };
  };
  cover: {
    kicker: string;
    edition: string;
    titleMode: EditorialPdfTitleMode;
    titleText: string;
    subtitle: string;
    brand: string;
    system: string;
    detail: string;
    tags: string[];
  };
  page: {
    headerLeft: string;
    headerRightMode: EditorialPdfTitleMode;
    headerRightText: string;
    footerLeft: string;
    showPageNumber: boolean;
  };
}

export interface EditorialPdfThemeRecordV1 {
  id: string;
  name: string;
  theme: EditorialPdfThemeV1;
  createdAt: string;
  updatedAt: string;
}

export interface EditorialPdfThemeLibraryV1 {
  schemaVersion: 1;
  activeId: string;
  customThemes: Record<string, EditorialPdfThemeRecordV1>;
}

export interface EditorialPdfThemeExchangeV1 {
  format: "hanmark-editorial-pdf-theme";
  schemaVersion: 1;
  name: string;
  theme: EditorialPdfThemeV1;
}

export interface EditorialPdfThemeSnapshot {
  id: string;
  name: string;
  builtIn: boolean;
  theme: EditorialPdfThemeV1;
}

export interface ResolvedEditorialPdfPalette {
  paper: string;
  bodyInk: string;
  keySurface: string;
  onKey: string;
  keyInk: string;
  keyMutedInk: string;
  accentLine: string;
  accentOnKey: string;
  softTint: string;
  border: string;
  alternate: string;
}

export interface EditorialPdfContrastDiagnostic {
  token: EditorialPdfOverrideToken;
  foreground: string;
  background: string;
  ratio: number;
  minimum: number;
  passes: boolean;
  manual: boolean;
  /** False only for a legacy decorative element whose exact color is frozen. */
  enforced: boolean;
}

export interface ResolvedEditorialPdfTheme {
  theme: EditorialPdfThemeV1;
  palette: ResolvedEditorialPdfPalette;
  diagnostics: EditorialPdfContrastDiagnostic[];
  warnings: string[];
}

export interface EditorialPdfThemeMutationResult {
  library: EditorialPdfThemeLibraryV1;
  record: EditorialPdfThemeRecordV1;
}

interface SegmentPart {
  segment: string;
}

interface SegmenterLike {
  segment(value: string): Iterable<SegmentPart>;
}

interface SegmenterConstructor {
  new (
    locale?: string | string[],
    options?: { granularity: "grapheme" }
  ): SegmenterLike;
}

interface OklchColor {
  lightness: number;
  chroma: number;
  hue: number;
}

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

interface ThemeRecordOptions {
  id?: string;
  now?: string;
}

const PAPER = "#FFFFFF";
const BODY_INK = "#182433";
const NEAR_BLACK = "#182433";
const BLACK = "#000000";
const EMPTY_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const DEFAULT_CUSTOM_THEME_NAME = "사용자 PDF 테마";
const LEGACY_BUILTIN_FOOTER_LEFT = "ACHMAGE / HANMARK PDF EDITION";
const CUSTOM_THEME_ID = /^custom:[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/u;
const HEX = /^#[0-9A-F]{6}$/u;

const DEFAULT_THEME_VALUE: EditorialPdfThemeV1 = {
  schemaVersion: EDITORIAL_PDF_THEME_SCHEMA_VERSION,
  colors: {
    key: "#002E6E",
    overrides: {
      onKey: null,
      keyInk: null,
      accentLine: null
    }
  },
  cover: {
    kicker: "HANMARK PDF PRINT",
    edition: "EDITORIAL EDITION",
    titleMode: "file-title",
    titleText: "",
    subtitle: "Markdown to Editorial PDF",
    brand: "ACHMAGE / HanMark PDF Edition",
    system: "HANMARK EXPORT SYSTEM",
    detail: "OBSIDIAN MARKDOWN · PRINT-READY A4",
    tags: ["#HANMARK", "#MARKDOWN", "#EDITORIAL", "#PDF"]
  },
  page: {
    headerLeft: "HANMARK PDF PRINT",
    headerRightMode: "file-title",
    headerRightText: "",
    footerLeft: LEGACY_BUILTIN_FOOTER_LEFT,
    showPageNumber: true
  }
};

const BUILTIN_PALETTE_VALUE: ResolvedEditorialPdfPalette = {
  paper: PAPER,
  bodyInk: BODY_INK,
  keySurface: "#002E6E",
  onKey: "#FFFFFF",
  keyInk: "#002E6E",
  keyMutedInk: "#31537D",
  accentLine: "#00B5AD",
  accentOnKey: "#7FE2DC",
  softTint: "#C7F1EE",
  border: "#D9E0E6",
  alternate: "#FAFAFA"
};

function deepFreezeTheme(theme: EditorialPdfThemeV1): Readonly<EditorialPdfThemeV1> {
  Object.freeze(theme.colors.overrides);
  Object.freeze(theme.colors);
  Object.freeze(theme.cover.tags);
  Object.freeze(theme.cover);
  Object.freeze(theme.page);
  return Object.freeze(theme);
}

export const BUILTIN_EDITORIAL_PDF_THEME = deepFreezeTheme(
  cloneTheme(DEFAULT_THEME_VALUE)
);

export const BUILTIN_EDITORIAL_PDF_PALETTE: Readonly<ResolvedEditorialPdfPalette> =
  Object.freeze({ ...BUILTIN_PALETTE_VALUE });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneTheme(theme: Readonly<EditorialPdfThemeV1>): EditorialPdfThemeV1 {
  return {
    schemaVersion: EDITORIAL_PDF_THEME_SCHEMA_VERSION,
    colors: {
      key: theme.colors.key,
      overrides: { ...theme.colors.overrides }
    },
    cover: {
      ...theme.cover,
      tags: [...theme.cover.tags]
    },
    page: { ...theme.page }
  };
}

function cloneRecord(
  record: Readonly<EditorialPdfThemeRecordV1>
): EditorialPdfThemeRecordV1 {
  return {
    ...record,
    theme: cloneTheme(record.theme)
  };
}

function graphemes(value: string): string[] {
  const intlWithSegmenter = Intl as typeof Intl & {
    Segmenter?: SegmenterConstructor;
  };
  if (typeof intlWithSegmenter.Segmenter === "function") {
    const segmenter = new intlWithSegmenter.Segmenter("ko", {
      granularity: "grapheme"
    });
    return Array.from(segmenter.segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

export function editorialPdfGraphemeCount(value: string): number {
  return graphemes(value).length;
}

function replaceUnsafeTextCharacters(value: string): string {
  return Array.from(value.normalize("NFC"), (character) => {
    const code = character.codePointAt(0) ?? 0;
    if (
      code === 10
      || code === 13
      || code === 0x2028
      || code === 0x2029
      || code <= 31
      || (code >= 127 && code <= 159)
    ) {
      return " ";
    }
    return character;
  }).join("");
}

export function normalizeEditorialPdfText(
  value: unknown,
  maximumGraphemes: number,
  fallback = ""
): string {
  const source = typeof value === "string" ? value : fallback;
  const cleaned = replaceUnsafeTextCharacters(source);
  return graphemes(cleaned).slice(0, maximumGraphemes).join("");
}

function normalizeEditorialPdfFooter(value: unknown, fallback: string): string {
  const source = typeof value === "string" ? value : fallback;
  const cleaned = replaceUnsafeTextCharacters(source);
  if (cleaned === LEGACY_BUILTIN_FOOTER_LEFT) return cleaned;
  return graphemes(cleaned)
    .slice(0, EDITORIAL_PDF_THEME_LIMITS.pageText)
    .join("");
}

function normalizeThemeName(value: unknown, fallback = DEFAULT_CUSTOM_THEME_NAME): string {
  const cleaned = normalizeEditorialPdfText(
    value,
    EDITORIAL_PDF_THEME_LIMITS.name,
    fallback
  ).trim();
  return cleaned || fallback;
}

export function canonicalEditorialPdfHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  const withHash = candidate.startsWith("#") ? candidate : `#${candidate}`;
  const upper = withHash.toUpperCase();
  return HEX.test(upper) ? upper : null;
}

export function isEditorialPdfHex(value: unknown): value is string {
  return canonicalEditorialPdfHex(value) !== null;
}

function normalizeOverride(value: unknown): string | null {
  if (value === null) return null;
  return canonicalEditorialPdfHex(value);
}

function normalizeTitleMode(
  value: unknown,
  fallback: EditorialPdfTitleMode
): EditorialPdfTitleMode {
  return value === "file-title" || value === "custom" || value === "blank"
    ? value
    : fallback;
}

function normalizeTags(value: unknown, fallback: readonly string[]): string[] {
  const source = Array.isArray(value) ? value : fallback;
  return source
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => normalizeEditorialPdfText(
      tag,
      EDITORIAL_PDF_THEME_LIMITS.tag
    ).trim())
    .filter(Boolean)
    .slice(0, EDITORIAL_PDF_THEME_LIMITS.tagCount);
}

export function normalizeEditorialPdfTheme(value: unknown): EditorialPdfThemeV1 {
  const theme = isRecord(value) ? value : {};
  const colors = isRecord(theme.colors) ? theme.colors : {};
  const overrides = isRecord(colors.overrides) ? colors.overrides : {};
  const cover = isRecord(theme.cover) ? theme.cover : {};
  const page = isRecord(theme.page) ? theme.page : {};
  const fallback = DEFAULT_THEME_VALUE;

  return {
    schemaVersion: EDITORIAL_PDF_THEME_SCHEMA_VERSION,
    colors: {
      key: canonicalEditorialPdfHex(colors.key) ?? fallback.colors.key,
      overrides: {
        onKey: normalizeOverride(overrides.onKey),
        keyInk: normalizeOverride(overrides.keyInk),
        accentLine: normalizeOverride(overrides.accentLine)
      }
    },
    cover: {
      kicker: normalizeEditorialPdfText(
        cover.kicker,
        EDITORIAL_PDF_THEME_LIMITS.coverText,
        fallback.cover.kicker
      ),
      edition: normalizeEditorialPdfText(
        cover.edition,
        EDITORIAL_PDF_THEME_LIMITS.coverText,
        fallback.cover.edition
      ),
      titleMode: normalizeTitleMode(
        cover.titleMode,
        fallback.cover.titleMode
      ),
      titleText: normalizeEditorialPdfText(
        cover.titleText,
        EDITORIAL_PDF_THEME_LIMITS.coverTitle,
        fallback.cover.titleText
      ),
      subtitle: normalizeEditorialPdfText(
        cover.subtitle,
        EDITORIAL_PDF_THEME_LIMITS.coverText,
        fallback.cover.subtitle
      ),
      brand: normalizeEditorialPdfText(
        cover.brand,
        EDITORIAL_PDF_THEME_LIMITS.coverText,
        fallback.cover.brand
      ),
      system: normalizeEditorialPdfText(
        cover.system,
        EDITORIAL_PDF_THEME_LIMITS.coverText,
        fallback.cover.system
      ),
      detail: normalizeEditorialPdfText(
        cover.detail,
        EDITORIAL_PDF_THEME_LIMITS.coverText,
        fallback.cover.detail
      ),
      tags: normalizeTags(cover.tags, fallback.cover.tags)
    },
    page: {
      headerLeft: normalizeEditorialPdfText(
        page.headerLeft,
        EDITORIAL_PDF_THEME_LIMITS.pageText,
        fallback.page.headerLeft
      ),
      headerRightMode: normalizeTitleMode(
        page.headerRightMode,
        fallback.page.headerRightMode
      ),
      headerRightText: normalizeEditorialPdfText(
        page.headerRightText,
        EDITORIAL_PDF_THEME_LIMITS.pageText,
        fallback.page.headerRightText
      ),
      footerLeft: normalizeEditorialPdfFooter(
        page.footerLeft,
        fallback.page.footerLeft
      ),
      showPageNumber: typeof page.showPageNumber === "boolean"
        ? page.showPageNumber
        : fallback.page.showPageNumber
    }
  };
}

function validTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value) return fallback;
  return Number.isFinite(Date.parse(value)) ? value : fallback;
}

function normalizeThemeRecord(
  value: unknown,
  fallbackId?: string
): EditorialPdfThemeRecordV1 | null {
  if (!isRecord(value)) return null;
  const idValue = typeof value.id === "string" ? value.id.trim() : fallbackId ?? "";
  if (!CUSTOM_THEME_ID.test(idValue)) return null;
  const createdAt = validTimestamp(value.createdAt, EMPTY_TIMESTAMP);
  return {
    id: idValue,
    name: normalizeThemeName(value.name),
    theme: normalizeEditorialPdfTheme(value.theme),
    createdAt,
    updatedAt: validTimestamp(value.updatedAt, createdAt)
  };
}

export function emptyEditorialPdfThemeLibrary(): EditorialPdfThemeLibraryV1 {
  return {
    schemaVersion: EDITORIAL_PDF_THEME_SCHEMA_VERSION,
    activeId: BUILTIN_EDITORIAL_PDF_THEME_ID,
    customThemes: {}
  };
}

export function normalizeEditorialPdfThemeLibrary(
  value: unknown
): EditorialPdfThemeLibraryV1 {
  const result = emptyEditorialPdfThemeLibrary();
  if (!isRecord(value)) return result;
  const rawThemes = isRecord(value.customThemes) ? value.customThemes : {};
  const usedNames = [BUILTIN_EDITORIAL_PDF_THEME_NAME];
  for (const [key, raw] of Object.entries(rawThemes)) {
    const record = normalizeThemeRecord(raw, key);
    if (record) {
      record.name = uniqueThemeName(record.name, usedNames);
      usedNames.push(record.name);
      result.customThemes[record.id] = record;
    }
  }
  const activeId = typeof value.activeId === "string" ? value.activeId : "";
  if (
    activeId === BUILTIN_EDITORIAL_PDF_THEME_ID
    || result.customThemes[activeId]
  ) {
    result.activeId = activeId;
  }
  return result;
}

export function builtInEditorialPdfThemeSnapshot(): EditorialPdfThemeSnapshot {
  return {
    id: BUILTIN_EDITORIAL_PDF_THEME_ID,
    name: BUILTIN_EDITORIAL_PDF_THEME_NAME,
    builtIn: true,
    theme: cloneTheme(BUILTIN_EDITORIAL_PDF_THEME)
  };
}

function recordSnapshot(
  record: Readonly<EditorialPdfThemeRecordV1>
): EditorialPdfThemeSnapshot {
  return {
    id: record.id,
    name: record.name,
    builtIn: false,
    theme: cloneTheme(record.theme)
  };
}

export function listEditorialPdfThemeSnapshots(
  libraryValue: unknown
): EditorialPdfThemeSnapshot[] {
  const library = normalizeEditorialPdfThemeLibrary(libraryValue);
  const collator = new Intl.Collator("ko", { sensitivity: "base" });
  const custom = Object.values(library.customThemes)
    .sort((left, right) => collator.compare(left.name, right.name))
    .map(recordSnapshot);
  return [builtInEditorialPdfThemeSnapshot(), ...custom];
}

export function activeEditorialPdfThemeSnapshot(
  libraryValue: unknown
): EditorialPdfThemeSnapshot {
  const library = normalizeEditorialPdfThemeLibrary(libraryValue);
  const record = library.customThemes[library.activeId];
  return record ? recordSnapshot(record) : builtInEditorialPdfThemeSnapshot();
}

function equalThemeNames(left: string, right: string): boolean {
  return new Intl.Collator("ko", { sensitivity: "base" }).compare(
    left.normalize("NFC"),
    right.normalize("NFC")
  ) === 0;
}

function nameWithSuffix(base: string, index: number): string {
  const suffix = ` ${index}`;
  const available = EDITORIAL_PDF_THEME_LIMITS.name
    - editorialPdfGraphemeCount(suffix);
  const stem = graphemes(base).slice(0, available).join("").trimEnd();
  return `${stem || DEFAULT_CUSTOM_THEME_NAME}${suffix}`;
}

function uniqueThemeName(requested: string, used: readonly string[]): string {
  const base = normalizeThemeName(requested);
  if (!used.some((name) => equalThemeNames(name, base))) return base;
  let index = 2;
  let candidate = nameWithSuffix(base, index);
  while (used.some((name) => equalThemeNames(name, candidate))) {
    index += 1;
    candidate = nameWithSuffix(base, index);
  }
  return candidate;
}

export function availableEditorialPdfThemeName(
  libraryValue: unknown,
  requested: string,
  exceptId?: string
): string {
  const library = normalizeEditorialPdfThemeLibrary(libraryValue);
  const base = normalizeThemeName(requested);
  const used = [BUILTIN_EDITORIAL_PDF_THEME_NAME]
    .concat(
      Object.values(library.customThemes)
        .filter((record) => record.id !== exceptId)
        .map((record) => record.name)
    );
  return uniqueThemeName(base, used);
}

function mutationLibrary(libraryValue: unknown): EditorialPdfThemeLibraryV1 {
  return normalizeEditorialPdfThemeLibrary(libraryValue);
}

function newCustomThemeId(): string {
  return `custom:${crypto.randomUUID()}`;
}

function mutationTimestamp(value?: string): string {
  return validTimestamp(value, new Date().toISOString());
}

export function createEditorialPdfTheme(
  libraryValue: unknown,
  name: string,
  theme: unknown = BUILTIN_EDITORIAL_PDF_THEME,
  options: ThemeRecordOptions = {}
): EditorialPdfThemeMutationResult {
  const library = mutationLibrary(libraryValue);
  const id = options.id ?? newCustomThemeId();
  if (!CUSTOM_THEME_ID.test(id) || library.customThemes[id]) {
    throw new Error("사용할 수 없는 PDF 테마 ID입니다.");
  }
  const now = mutationTimestamp(options.now);
  const record: EditorialPdfThemeRecordV1 = {
    id,
    name: availableEditorialPdfThemeName(library, name),
    theme: normalizeEditorialPdfTheme(theme),
    createdAt: now,
    updatedAt: now
  };
  library.customThemes[id] = record;
  return { library, record: cloneRecord(record) };
}

export function updateEditorialPdfTheme(
  libraryValue: unknown,
  id: string,
  theme: unknown,
  now?: string
): EditorialPdfThemeMutationResult {
  const library = mutationLibrary(libraryValue);
  const existing = library.customThemes[id];
  if (!existing) throw new Error("선택한 PDF 테마를 찾을 수 없습니다.");
  const record: EditorialPdfThemeRecordV1 = {
    ...existing,
    theme: normalizeEditorialPdfTheme(theme),
    updatedAt: mutationTimestamp(now)
  };
  library.customThemes[id] = record;
  return { library, record: cloneRecord(record) };
}

export function renameEditorialPdfTheme(
  libraryValue: unknown,
  id: string,
  requestedName: string,
  now?: string
): EditorialPdfThemeMutationResult {
  const library = mutationLibrary(libraryValue);
  const existing = library.customThemes[id];
  if (!existing) throw new Error("선택한 PDF 테마를 찾을 수 없습니다.");
  const record: EditorialPdfThemeRecordV1 = {
    ...existing,
    name: availableEditorialPdfThemeName(library, requestedName, id),
    updatedAt: mutationTimestamp(now)
  };
  library.customThemes[id] = record;
  return { library, record: cloneRecord(record) };
}

export function duplicateEditorialPdfTheme(
  libraryValue: unknown,
  sourceId: string,
  requestedName?: string,
  options: ThemeRecordOptions = {}
): EditorialPdfThemeMutationResult {
  const library = mutationLibrary(libraryValue);
  const source = sourceId === BUILTIN_EDITORIAL_PDF_THEME_ID
    ? builtInEditorialPdfThemeSnapshot()
    : library.customThemes[sourceId]
      ? recordSnapshot(library.customThemes[sourceId])
      : null;
  if (!source) throw new Error("복제할 PDF 테마를 찾을 수 없습니다.");
  return createEditorialPdfTheme(
    library,
    requestedName ?? `${source.name} 복사본`,
    source.theme,
    options
  );
}

export function deleteEditorialPdfTheme(
  libraryValue: unknown,
  id: string
): EditorialPdfThemeLibraryV1 {
  const library = mutationLibrary(libraryValue);
  if (id === BUILTIN_EDITORIAL_PDF_THEME_ID || !library.customThemes[id]) {
    return library;
  }
  delete library.customThemes[id];
  if (library.activeId === id) {
    library.activeId = BUILTIN_EDITORIAL_PDF_THEME_ID;
  }
  return library;
}

export function setActiveEditorialPdfTheme(
  libraryValue: unknown,
  id: string
): EditorialPdfThemeLibraryV1 {
  const library = mutationLibrary(libraryValue);
  if (
    id !== BUILTIN_EDITORIAL_PDF_THEME_ID
    && !library.customThemes[id]
  ) {
    throw new Error("선택한 PDF 테마를 찾을 수 없습니다.");
  }
  library.activeId = id;
  return library;
}

function parseHex(value: string): RgbColor {
  return {
    red: Number.parseInt(value.slice(1, 3), 16) / 255,
    green: Number.parseInt(value.slice(3, 5), 16) / 255,
    blue: Number.parseInt(value.slice(5, 7), 16) / 255
  };
}

function srgbToLinear(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308
    ? 12.92 * value
    : 1.055 * value ** (1 / 2.4) - 0.055;
}

export function relativeLuminance(value: string): number {
  const hex = canonicalEditorialPdfHex(value);
  if (!hex) throw new Error("명도를 계산할 색상은 #RRGGBB여야 합니다.");
  const rgb = parseHex(hex);
  return 0.2126 * srgbToLinear(rgb.red)
    + 0.7152 * srgbToLinear(rgb.green)
    + 0.0722 * srgbToLinear(rgb.blue);
}

export function contrastRatio(left: string, right: string): number {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbToOklch(rgb: RgbColor): OklchColor {
  const red = srgbToLinear(rgb.red);
  const green = srgbToLinear(rgb.green);
  const blue = srgbToLinear(rgb.blue);
  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  const lightness = 0.2104542553 * lRoot
    + 0.793617785 * mRoot
    - 0.0040720468 * sRoot;
  const a = 1.9779984951 * lRoot
    - 2.428592205 * mRoot
    + 0.4505937099 * sRoot;
  const b = 0.0259040371 * lRoot
    + 0.7827717662 * mRoot
    - 0.808675766 * sRoot;
  const hueRadians = Math.atan2(b, a);
  const hue = (hueRadians * 180 / Math.PI + 360) % 360;
  return {
    lightness,
    chroma: Math.hypot(a, b),
    hue
  };
}

function oklchToLinearRgb(color: OklchColor): RgbColor {
  const radians = color.hue * Math.PI / 180;
  const a = color.chroma * Math.cos(radians);
  const b = color.chroma * Math.sin(radians);
  const lRoot = color.lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = color.lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = color.lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;
  return {
    red: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    green: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    blue: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  };
}

function inSrgbGamut(rgb: RgbColor): boolean {
  return rgb.red >= 0 && rgb.red <= 1
    && rgb.green >= 0 && rgb.green <= 1
    && rgb.blue >= 0 && rgb.blue <= 1;
}

function gamutMappedLinearRgb(color: OklchColor): RgbColor {
  let candidate = oklchToLinearRgb(color);
  if (inSrgbGamut(candidate)) return candidate;
  let low = 0;
  let high = color.chroma;
  for (let index = 0; index < 32; index += 1) {
    const chroma = (low + high) / 2;
    candidate = oklchToLinearRgb({ ...color, chroma });
    if (inSrgbGamut(candidate)) low = chroma;
    else high = chroma;
  }
  return oklchToLinearRgb({ ...color, chroma: low });
}

function channelHex(value: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, value)) * 255);
  return byte.toString(16).padStart(2, "0").toUpperCase();
}

function oklchToHex(color: OklchColor): string {
  const linear = gamutMappedLinearRgb(color);
  return `#${channelHex(linearToSrgb(linear.red))}${channelHex(
    linearToSrgb(linear.green)
  )}${channelHex(linearToSrgb(linear.blue))}`;
}

function darkenSeedForPaperContrast(seed: string, target: number): string {
  if (contrastRatio(seed, PAPER) >= target) return seed;
  const source = rgbToOklch(parseHex(seed));
  let safeLightness = 0;
  let unsafeLightness = source.lightness;
  for (let index = 0; index < 36; index += 1) {
    const lightness = (safeLightness + unsafeLightness) / 2;
    const candidate = oklchToHex({ ...source, lightness });
    if (contrastRatio(candidate, PAPER) >= target) {
      safeLightness = lightness;
    } else {
      unsafeLightness = lightness;
    }
  }
  let candidate = oklchToHex({ ...source, lightness: safeLightness });
  for (let index = 0; index < 100 && contrastRatio(candidate, PAPER) < target; index += 1) {
    safeLightness = Math.max(0, safeLightness - 0.0005);
    candidate = oklchToHex({ ...source, lightness: safeLightness });
  }
  return contrastRatio(candidate, PAPER) >= target ? candidate : BLACK;
}

function lightTint(seed: string): string {
  const source = rgbToOklch(parseHex(seed));
  let color: OklchColor = {
    lightness: Math.max(0.94, source.lightness),
    chroma: Math.min(0.035, source.chroma * 0.18),
    hue: source.hue
  };
  let candidate = oklchToHex(color);
  for (let index = 0; index < 120 && contrastRatio(BODY_INK, candidate) < 7; index += 1) {
    color = { ...color, lightness: Math.min(1, color.lightness + 0.0005) };
    candidate = oklchToHex(color);
  }
  return contrastRatio(BODY_INK, candidate) >= 7 ? candidate : PAPER;
}

function automaticOnKey(keySurface: string): string {
  const candidates = [PAPER, NEAR_BLACK, BLACK];
  const aaa = candidates.find((candidate) => contrastRatio(candidate, keySurface) >= 7);
  if (aaa) return aaa;
  const aaCandidates = candidates
    .map((candidate) => ({ candidate, ratio: contrastRatio(candidate, keySurface) }))
    .filter(({ ratio }) => ratio >= 4.5)
    .sort((left, right) => right.ratio - left.ratio);
  if (aaCandidates[0]) return aaCandidates[0].candidate;
  throw new Error("PDF 키 컬러의 안전한 글자색을 계산하지 못했습니다.");
}

/** Fast production selector used by the full 24-bit release verification. */
export function resolveEditorialPdfOnKey(
  keyValue: unknown
): { color: string; ratio: number; aaa: boolean } {
  const key = canonicalEditorialPdfHex(keyValue);
  if (!key) throw new Error("PDF 키 컬러는 #RRGGBB여야 합니다.");
  const color = automaticOnKey(key);
  const ratio = contrastRatio(color, key);
  return { color, ratio, aaa: ratio >= 7 };
}

function diagnostic(
  token: EditorialPdfOverrideToken,
  foreground: string,
  background: string,
  minimum: number,
  manual: boolean,
  enforced = true
): EditorialPdfContrastDiagnostic {
  const ratio = contrastRatio(foreground, background);
  return {
    token,
    foreground,
    background,
    ratio,
    minimum,
    passes: ratio >= minimum,
    manual,
    enforced
  };
}

function warningForDiagnostic(value: EditorialPdfContrastDiagnostic): string {
  const labels: Record<EditorialPdfOverrideToken, string> = {
    onKey: "키 배경 위 글자",
    keyInk: "흰 종이 위 브랜드 글자",
    accentLine: "상·하단 포인트 선"
  };
  return `${labels[value.token]} 대비 경고: ${value.ratio.toFixed(2)}:1 (목표 ${value.minimum}:1)`;
}

function assertAutomaticPaletteInvariants(
  theme: EditorialPdfThemeV1,
  palette: ResolvedEditorialPdfPalette
): void {
  const checks = [
    theme.colors.overrides.onKey === null
      ? contrastRatio(palette.onKey, palette.keySurface) >= 4.5
      : true,
    theme.colors.overrides.keyInk === null
      ? contrastRatio(palette.keyInk, palette.paper) >= 7
      : true,
    theme.colors.overrides.accentLine === null
      ? contrastRatio(palette.accentLine, palette.paper) >= 3
      : true,
    contrastRatio(palette.accentOnKey, palette.keySurface) >= 4.5,
    contrastRatio(palette.keyMutedInk, palette.paper) >= 4.5,
    contrastRatio(palette.bodyInk, palette.softTint) >= 7,
    contrastRatio(palette.border, palette.paper) >= 3,
    contrastRatio(palette.bodyInk, palette.alternate) >= 7
  ];
  if (checks.some((passes) => !passes)) {
    throw new Error("PDF 테마 자동 팔레트가 대비 안전 규칙을 만족하지 못했습니다.");
  }
}

export function resolveEditorialPdfTheme(
  value: unknown,
  options: { builtIn?: boolean } = {}
): ResolvedEditorialPdfTheme {
  const builtIn = options.builtIn === true;
  // The legacy footer is deliberately longer than the new custom-theme page
  // limit. Bypass custom normalization so the immutable built-in remains a
  // byte-for-byte rendering contract instead of silently truncating it.
  const theme = builtIn
    ? cloneTheme(BUILTIN_EDITORIAL_PDF_THEME)
    : normalizeEditorialPdfTheme(value);
  const palette: ResolvedEditorialPdfPalette = builtIn
    ? { ...BUILTIN_EDITORIAL_PDF_PALETTE }
    : (() => {
        const keySurface = theme.colors.key;
        const automaticKeyInk = darkenSeedForPaperContrast(keySurface, 7);
        const automaticAccentLine = darkenSeedForPaperContrast(keySurface, 3);
        const onKey = theme.colors.overrides.onKey ?? automaticOnKey(keySurface);
        const keyInk = theme.colors.overrides.keyInk ?? automaticKeyInk;
        const accentLine = theme.colors.overrides.accentLine ?? automaticAccentLine;
        return {
          paper: PAPER,
          bodyInk: BODY_INK,
          keySurface,
          onKey,
          keyInk,
          keyMutedInk: darkenSeedForPaperContrast(keySurface, 4.5),
          accentLine,
          accentOnKey: automaticOnKey(keySurface),
          softTint: lightTint(keySurface),
          border: "#87919C",
          alternate: "#FAFAFA"
        };
      })();

  if (!builtIn) assertAutomaticPaletteInvariants(theme, palette);
  const diagnostics = [
    diagnostic(
      "onKey",
      palette.onKey,
      palette.keySurface,
      4.5,
      theme.colors.overrides.onKey !== null
    ),
    diagnostic(
      "keyInk",
      palette.keyInk,
      palette.paper,
      7,
      theme.colors.overrides.keyInk !== null
    ),
    diagnostic(
      "accentLine",
      palette.accentLine,
      palette.paper,
      3,
      theme.colors.overrides.accentLine !== null,
      !builtIn
    )
  ];
  const warnings = diagnostics
    .filter((item) => item.enforced && !item.passes)
    .map(warningForDiagnostic);
  return { theme, palette, diagnostics, warnings };
}

export function resolveEditorialPdfThemeSnapshot(
  snapshot: Readonly<EditorialPdfThemeSnapshot>
): ResolvedEditorialPdfTheme {
  return resolveEditorialPdfTheme(snapshot.theme, { builtIn: snapshot.builtIn });
}

function assertJsonString(
  value: unknown,
  label: string,
  maximum: number,
  options: { empty?: boolean } = {}
): string {
  if (typeof value !== "string") throw new Error(`${label}이(가) 문자열이 아닙니다.`);
  const cleaned = replaceUnsafeTextCharacters(value);
  if (editorialPdfGraphemeCount(cleaned) > maximum) {
    throw new Error(`${label}이(가) ${maximum}글자보다 깁니다.`);
  }
  if (options.empty === false && !cleaned.trim()) {
    throw new Error(`${label}을(를) 비울 수 없습니다.`);
  }
  return cleaned;
}

function assertJsonFooter(value: unknown): string {
  if (typeof value === "string") {
    const cleaned = replaceUnsafeTextCharacters(value);
    if (cleaned === LEGACY_BUILTIN_FOOTER_LEFT) return cleaned;
  }
  return assertJsonString(
    value,
    "왼쪽 꼬리말",
    EDITORIAL_PDF_THEME_LIMITS.pageText
  );
}

function assertJsonTitleMode(value: unknown, label: string): EditorialPdfTitleMode {
  if (value === "file-title" || value === "custom" || value === "blank") return value;
  throw new Error(`${label}이(가) 올바른 제목 모드가 아닙니다.`);
}

function assertJsonHex(value: unknown, label: string): string {
  const hex = canonicalEditorialPdfHex(value);
  if (!hex) throw new Error(`${label}은(는) #RRGGBB 색상이어야 합니다.`);
  return hex;
}

function strictExchangeTheme(value: unknown): EditorialPdfThemeV1 {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("PDF 테마 schemaVersion은 1이어야 합니다.");
  }
  if (!isRecord(value.colors) || !isRecord(value.colors.overrides)) {
    throw new Error("PDF 테마 색상 정보가 올바르지 않습니다.");
  }
  if (!isRecord(value.cover) || !isRecord(value.page)) {
    throw new Error("PDF 테마 문구 정보가 올바르지 않습니다.");
  }
  const overrides = value.colors.overrides;
  const override = (candidate: unknown, label: string): string | null => {
    if (candidate === null) return null;
    return assertJsonHex(candidate, label);
  };
  const cover = value.cover;
  const tags = cover.tags;
  if (!Array.isArray(tags)) {
    throw new Error("표지 태그가 배열이 아닙니다.");
  }
  const normalizedTags = tags
    .map((tag, index) => assertJsonString(
      tag,
      `표지 태그 ${index + 1}`,
      EDITORIAL_PDF_THEME_LIMITS.tag
    ).trim())
    .filter(Boolean);
  if (normalizedTags.length > EDITORIAL_PDF_THEME_LIMITS.tagCount) {
    throw new Error(`표지 태그는 ${EDITORIAL_PDF_THEME_LIMITS.tagCount}개 이하여야 합니다.`);
  }
  const page = value.page;
  if (typeof page.showPageNumber !== "boolean") {
    throw new Error("쪽번호 표시 설정은 true 또는 false여야 합니다.");
  }
  return {
    schemaVersion: EDITORIAL_PDF_THEME_SCHEMA_VERSION,
    colors: {
      key: assertJsonHex(value.colors.key, "키 컬러"),
      overrides: {
        onKey: override(overrides.onKey, "키 배경 위 글자색"),
        keyInk: override(overrides.keyInk, "종이 위 브랜드 글자색"),
        accentLine: override(overrides.accentLine, "포인트 선 색상")
      }
    },
    cover: {
      kicker: assertJsonString(cover.kicker, "표지 kicker", EDITORIAL_PDF_THEME_LIMITS.coverText),
      edition: assertJsonString(cover.edition, "표지 edition", EDITORIAL_PDF_THEME_LIMITS.coverText),
      titleMode: assertJsonTitleMode(cover.titleMode, "표지 제목 모드"),
      titleText: assertJsonString(cover.titleText, "표지 제목", EDITORIAL_PDF_THEME_LIMITS.coverTitle),
      subtitle: assertJsonString(cover.subtitle, "표지 부제", EDITORIAL_PDF_THEME_LIMITS.coverText),
      brand: assertJsonString(cover.brand, "표지 브랜드", EDITORIAL_PDF_THEME_LIMITS.coverText),
      system: assertJsonString(cover.system, "표지 시스템", EDITORIAL_PDF_THEME_LIMITS.coverText),
      detail: assertJsonString(cover.detail, "표지 설명", EDITORIAL_PDF_THEME_LIMITS.coverText),
      tags: normalizedTags
    },
    page: {
      headerLeft: assertJsonString(page.headerLeft, "왼쪽 머리말", EDITORIAL_PDF_THEME_LIMITS.pageText),
      headerRightMode: assertJsonTitleMode(page.headerRightMode, "오른쪽 머리말 모드"),
      headerRightText: assertJsonString(page.headerRightText, "오른쪽 머리말", EDITORIAL_PDF_THEME_LIMITS.pageText),
      footerLeft: assertJsonFooter(page.footerLeft),
      showPageNumber: page.showPageNumber
    }
  };
}

function jsonByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function stringifyEditorialPdfThemeExchange(
  name: string,
  themeValue: unknown
): string {
  const exchange: EditorialPdfThemeExchangeV1 = {
    format: EDITORIAL_PDF_THEME_EXCHANGE_FORMAT,
    schemaVersion: EDITORIAL_PDF_THEME_SCHEMA_VERSION,
    name: normalizeThemeName(name),
    theme: normalizeEditorialPdfTheme(themeValue)
  };
  const json = `${JSON.stringify(exchange, null, 2)}\n`;
  if (jsonByteLength(json) > EDITORIAL_PDF_THEME_MAX_JSON_BYTES) {
    throw new Error("PDF 테마 JSON이 256KiB보다 큽니다.");
  }
  return json;
}

export function parseEditorialPdfThemeExchange(
  source: string | Uint8Array
): EditorialPdfThemeExchangeV1 {
  const bytes = typeof source === "string"
    ? new TextEncoder().encode(source)
    : source;
  if (bytes.byteLength > EDITORIAL_PDF_THEME_MAX_JSON_BYTES) {
    throw new Error("PDF 테마 JSON이 256KiB보다 큽니다.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      typeof source === "string" ? source : new TextDecoder("utf-8", {
        fatal: true
      }).decode(source)
    ) as unknown;
  } catch {
    throw new Error("올바른 UTF-8 PDF 테마 JSON 파일이 아닙니다.");
  }
  if (
    !isRecord(parsed)
    || parsed.format !== EDITORIAL_PDF_THEME_EXCHANGE_FORMAT
    || parsed.schemaVersion !== EDITORIAL_PDF_THEME_SCHEMA_VERSION
  ) {
    throw new Error("HanMark PDF 테마 JSON 형식이 아닙니다.");
  }
  return {
    format: EDITORIAL_PDF_THEME_EXCHANGE_FORMAT,
    schemaVersion: EDITORIAL_PDF_THEME_SCHEMA_VERSION,
    name: assertJsonString(
      parsed.name,
      "PDF 테마 이름",
      EDITORIAL_PDF_THEME_LIMITS.name,
      { empty: false }
    ).trim(),
    theme: strictExchangeTheme(parsed.theme)
  };
}
