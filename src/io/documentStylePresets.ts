import { normalizeDocumentStyleProfile, type DocumentStyleProfile } from "./documentStyle";

export type HanmarkDocumentStylePresetId =
  | "kordoc-default"
  | "korean-communication"
  | "youth-studies"
  | "custom";

export const DOCUMENT_STYLE_PRESET_LABELS: Record<HanmarkDocumentStylePresetId, string> = {
  "kordoc-default": "Kordoc 기본",
  "korean-communication": "한국언론학회",
  "youth-studies": "청소년학",
  custom: "사용자 문서 스타일"
};

const PAGE = {
  widthHu: 59_530,
  heightHu: 84_190,
  landscape: "WIDELY" as const,
  gutterType: "LEFT_ONLY",
  margins: { top: 4_255, bottom: 4_960, left: 7_200, right: 7_200, header: 4_250, footer: 2_240, gutter: 0 }
};

function character(
  fontFamily: string,
  fontSizePt: number,
  bold: boolean,
  widthPercent: number,
  letterSpacingPercent: number
) {
  return {
    fontFamily,
    latinFontFamily: fontFamily,
    fontSizePt,
    bold,
    italic: false,
    underline: false,
    color: "#000000",
    widthPercent,
    letterSpacingPercent
  };
}

function paragraph(
  alignment: "LEFT" | "CENTER" | "JUSTIFY",
  lineSpacingPercent: number,
  firstLineIndentHu = 0,
  spaceBeforeHu = 0,
  keepWithNext = true
) {
  return {
    alignment,
    lineSpacingPercent,
    firstLineIndentHu,
    marginLeftHu: 0,
    marginRightHu: 0,
    spaceBeforeHu,
    spaceAfterHu: 0,
    keepWithNext
  };
}

const KOREAN_COMMUNICATION: DocumentStyleProfile = {
  schemaVersion: 3,
  name: "한국언론학회",
  sourceName: "한국언론학회 템플릿.hwpx",
  roles: {
    body: {
      styleName: "바탕글",
      character: character("신명조", 10, false, 95, -10),
      paragraph: paragraph("JUSTIFY", 160, 1_000, 0, false)
    },
    h1: { styleName: "제목 1", character: character("맑은 고딕", 14, true, 95, -10), paragraph: paragraph("CENTER", 160) },
    h2: { styleName: "제목 2", character: character("HY견고딕", 10, false, 95, -10), paragraph: paragraph("JUSTIFY", 160) },
    h3: { styleName: "제목 3", character: character("맑은 고딕", 10, true, 100, 0), paragraph: paragraph("JUSTIFY", 160) },
    h4: { styleName: "제목 4", character: character("신명조", 10, true, 100, 0), paragraph: paragraph("JUSTIFY", 160) },
    h5: { styleName: "제목 5", character: character("휴먼명조", 13, true, 100, 0), paragraph: paragraph("LEFT", 180) },
    h6: { styleName: "제목 6", character: character("맑은 고딕", 10, true, 100, 0), paragraph: paragraph("LEFT", 180, 0, 1_000) }
  },
  page: PAGE
};

const YOUTH_STUDIES: DocumentStyleProfile = {
  schemaVersion: 3,
  name: "청소년학",
  sourceName: "청소년학 템플릿.hwpx",
  roles: {
    body: {
      styleName: "바탕글",
      character: character("휴먼명조", 10, false, 95, 0),
      paragraph: paragraph("JUSTIFY", 170, 1_000, 0, false)
    },
    h1: { styleName: "제목 1", character: character("휴먼명조", 15, true, 95, 0), paragraph: paragraph("CENTER", 170) },
    h2: { styleName: "제목 2", character: character("휴먼명조", 12, true, 95, 0), paragraph: paragraph("CENTER", 170) },
    h3: { styleName: "제목 3", character: character("휴먼명조", 11, true, 95, 0), paragraph: paragraph("LEFT", 170) },
    h4: { styleName: "제목 4", character: character("휴먼명조", 11, true, 100, 0), paragraph: paragraph("LEFT", 170) },
    h5: { styleName: "제목 5", character: character("휴먼명조", 13, true, 100, 0), paragraph: paragraph("LEFT", 180) },
    h6: { styleName: "제목 6", character: character("맑은 고딕", 10, true, 100, 0), paragraph: paragraph("LEFT", 180, 0, 1_000) }
  },
  page: PAGE
};

export function isDocumentStylePresetId(value: unknown): value is HanmarkDocumentStylePresetId {
  return typeof value === "string" && value in DOCUMENT_STYLE_PRESET_LABELS;
}

export function builtInDocumentStyleProfile(
  preset: HanmarkDocumentStylePresetId
): DocumentStyleProfile | undefined {
  const source = preset === "korean-communication"
    ? KOREAN_COMMUNICATION
    : preset === "youth-studies"
      ? YOUTH_STUDIES
      : undefined;
  return source ? normalizeDocumentStyleProfile(source) : undefined;
}
