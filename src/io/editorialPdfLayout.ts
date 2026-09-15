export interface EditorialPdfLayout {
  mode: "single" | "two-column-a" | "two-column-b";
  columnGapMm: 8 | 10 | 12;
  sectionPageBreaks: boolean;
}

export const DEFAULT_EDITORIAL_PDF_LAYOUT: Readonly<EditorialPdfLayout> = Object.freeze({
  mode: "single", columnGapMm: 10, sectionPageBreaks: false
});

export function normalizeEditorialPdfLayout(value: unknown): EditorialPdfLayout {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    mode: data.mode === "two-column-a" || data.mode === "two-column-b" ? data.mode : "single",
    columnGapMm: data.columnGapMm === 8 || data.columnGapMm === 12 ? data.columnGapMm : 10,
    sectionPageBreaks: data.sectionPageBreaks === true
  };
}

export const EDITORIAL_PDF_LAYOUT_CHOICES = {
  single: "기존 1단",
  "two-column-a": "2단 A — 전체 폭 그림",
  "two-column-b": "2단 B — 한 단 폭 그림"
};
