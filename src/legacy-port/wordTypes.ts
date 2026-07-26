import type { DocxPreviewMode } from "./settings";

export const WORD_STYLE_IDS = [
  "Normal",
  "Body Text",
  "First Paragraph",
  "Title",
  "Subtitle",
  "Heading 1",
  "Heading 2",
  "Heading 3",
  "Heading 4",
  "Heading 5",
  "Heading 6",
  "Block Text",
  "Source Code",
  "Caption",
  "Table Caption",
  "Image Caption",
  "Hyperlink",
  "Verbatim Char",
  "Table"
] as const;

export type WordStyleId = (typeof WORD_STYLE_IDS)[number];
export type WordStyleKind = "paragraph" | "character" | "table";
export type WordUnderline = "none" | "single" | "double";
export type WordAlignment = "left" | "center" | "right" | "justify";
export type WordLineSpacingMode = "single" | "multiple" | "exact" | "atLeast";

export interface WordFontSpec {
  family: string;
  eastAsiaFamily?: string;
  asciiFamily?: string;
  hAnsiFamily?: string;
  csFamily?: string;
  sizePt: number;
  bold: boolean;
  italic: boolean;
  underline: WordUnderline;
  color?: string;
  charSpacingPt?: number;
  widthScalePct?: number;
}

export interface WordParagraphSpec {
  align: WordAlignment;
  lineSpacingMode: WordLineSpacingMode;
  lineSpacingValue: number;
  leftIndentPt: number;
  rightIndentPt: number;
  firstLineIndentPt: number;
  spacingBeforePt: number;
  spacingAfterPt: number;
  keepWithNext?: boolean;
  pageBreakBefore?: boolean;
  widowControl?: boolean;
}

export interface WordStyleSpec {
  id: WordStyleId;
  displayName: string;
  basedOn?: WordStyleId;
  nextStyle?: WordStyleId;
  kind: WordStyleKind;
  font?: WordFontSpec;
  paragraph?: WordParagraphSpec;
}

export interface WordPageSpec {
  widthPt: number;
  heightPt: number;
  orientation: "portrait" | "landscape";
  marginTopPt: number;
  marginRightPt: number;
  marginBottomPt: number;
  marginLeftPt: number;
  headerDistancePt: number;
  footerDistancePt: number;
}

export interface WordTemplateSpec {
  version: 1;
  id: string;
  name: string;
  page: WordPageSpec;
  styles: Record<WordStyleId, WordStyleSpec>;
  previewMode: DocxPreviewMode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isWordStyleId(value: unknown): value is WordStyleId {
  return typeof value === "string" && WORD_STYLE_IDS.some((item) => item === value);
}

function isWordFontSpec(value: unknown): value is WordFontSpec {
  if (!isRecord(value)) return false;
  return (
    typeof value.family === "string" &&
    Boolean(value.family.trim()) &&
    isFiniteNumber(value.sizePt) &&
    typeof value.bold === "boolean" &&
    typeof value.italic === "boolean" &&
    (value.underline === "none" || value.underline === "single" || value.underline === "double")
  );
}

function isWordParagraphSpec(value: unknown): value is WordParagraphSpec {
  if (!isRecord(value)) return false;
  const numericKeys = [
    "lineSpacingValue",
    "leftIndentPt",
    "rightIndentPt",
    "firstLineIndentPt",
    "spacingBeforePt",
    "spacingAfterPt"
  ] as const;
  return (
    (value.align === "left" ||
      value.align === "center" ||
      value.align === "right" ||
      value.align === "justify") &&
    (value.lineSpacingMode === "single" ||
      value.lineSpacingMode === "multiple" ||
      value.lineSpacingMode === "exact" ||
      value.lineSpacingMode === "atLeast") &&
    numericKeys.every((key) => isFiniteNumber(value[key]))
  );
}

function isWordStyleSpec(value: unknown, expectedId: WordStyleId): value is WordStyleSpec {
  if (!isRecord(value)) return false;
  if (value.id !== expectedId || typeof value.displayName !== "string") return false;
  if (value.kind !== "paragraph" && value.kind !== "character" && value.kind !== "table") return false;
  if (value.basedOn !== undefined && !isWordStyleId(value.basedOn)) return false;
  if (value.nextStyle !== undefined && !isWordStyleId(value.nextStyle)) return false;
  if (value.font !== undefined && !isWordFontSpec(value.font)) return false;
  if (value.paragraph !== undefined && !isWordParagraphSpec(value.paragraph)) return false;
  return true;
}

function isWordPageSpec(value: unknown): value is WordPageSpec {
  if (!isRecord(value)) return false;
  const numericKeys = [
    "widthPt",
    "heightPt",
    "marginTopPt",
    "marginRightPt",
    "marginBottomPt",
    "marginLeftPt",
    "headerDistancePt",
    "footerDistancePt"
  ] as const;
  return (
    (value.orientation === "portrait" || value.orientation === "landscape") &&
    numericKeys.every((key) => isFiniteNumber(value[key]))
  );
}

export function isWordTemplateSpec(value: unknown): value is WordTemplateSpec {
  if (!isRecord(value) || value.version !== 1) return false;
  if (typeof value.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(value.id)) return false;
  if (typeof value.name !== "string" || !value.name.trim()) return false;
  const styles = value.styles;
  if (!isWordPageSpec(value.page) || !isRecord(styles)) return false;
  if (value.previewMode !== "fast-docx" && value.previewMode !== "word-pdf") return false;
  return WORD_STYLE_IDS.every((id) => isWordStyleSpec(styles[id], id));
}

export function parseWordTemplateJson(json: string): WordTemplateSpec {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Word template JSON is invalid.");
  }
  if (!isWordTemplateSpec(value)) {
    throw new Error("Word template does not match the HanMark template schema.");
  }
  return value;
}

export function cloneWordTemplate(template: WordTemplateSpec): WordTemplateSpec {
  return parseWordTemplateJson(JSON.stringify(template));
}
