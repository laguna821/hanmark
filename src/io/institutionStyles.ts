import type { GongmunPreset } from "kordoc";
import type { MessageKey } from "../i18n";
import type { GongmunOutlineStyle } from "./gongmunOutline";
import type { CoverDateFormat, GongmunStyleOptions } from "./gongmunStyle";
import { NUMBERED_PAREN, type GongmunFinishSpec } from "./hwpxFinish";

/**
 * Built-in institution styles (2.7.0, R-024): official-document looks that ship with
 * HanMark and are listed above the user's own styles. Each one names the document
 * type it was made for, the Kordoc options that get close to the institution's
 * forms, and the finishing Kordoc cannot express (hwpxFinish.ts).
 */
export interface BuiltinGongmunStyle {
  id: string;
  name: MessageKey;
  description: MessageKey;
  group: MessageKey;
  /** Short name written into exported file names (R-028). */
  fileLabel: MessageKey;
  /** Document type the style was measured from; selecting the style selects it. */
  preset: GongmunPreset;
  options: GongmunStyleOptions;
  finish: GongmunFinishSpec;
  /** Engine notes that do not apply to this style (message prefixes). */
  quietEngineNotes?: readonly string[];
  /** Cover date shown when the note sets none (withCoverDate). */
  coverDate?: CoverDateFormat;
  /** How the note's headings and lists map onto the style's levels (gongmunOutline.ts). */
  outline?: GongmunOutlineStyle;
}

export const BUILTIN_GONGMUN_STYLE_PREFIX = "builtin:";

// i18n-data-begin: typeface names, colors, and Kordoc note prefixes of the source forms
const HALLYM_GOTHIC = "한림고딕체 Regular";
const HUMAN_MYEONGJO = "휴먼명조";
/** Header rows of Ilsong College of Liberal Arts tables (measured from its PDFs). */
const ILSONG_NAVY = "#203864";
/** Cover rules of the AI Convergence Research Institute report form. */
const AICR_BLUE = "#0066B3";
const AICR_TEAL = "#00B6AD";
const SUMMARY_BOX_NOTE = "보고서 요약박스가 없습니다";
// i18n-data-end

export const BUILTIN_GONGMUN_STYLES: readonly BuiltinGongmunStyle[] = [
  {
    // 제2026-1차 TF 회의록·회의자료 (일송자유교양대학): 한림고딕체 11pt, "1." 절 제목,
    // • / - 항목, 남색 머리행 표, 가운데 쪽 번호.
    id: "builtin:hallym-ilsong",
    name: "gongmun.builtin.hallymIlsong.name",
    description: "gongmun.builtin.hallymIlsong.desc",
    group: "gongmun.builtin.group.hallym",
    fileLabel: "gongmun.fileName.hallymIlsong",
    preset: "minutes",
    options: {
      bodyPt: 11,
      lineSpacing: 160,
      numbering: "standard",
      fonts: { body: HALLYM_GOTHIC, heading: HALLYM_GOTHIC, ref: HALLYM_GOTHIC, table: HALLYM_GOTHIC },
      levels: { "0": { bold: true } },
      margins: { top: 20, bottom: 15, left: 20, right: 20 },
      pageNumbers: true,
      endMark: false
    },
    finish: {
      // Deeper levels keep the last bullet instead of switching back to (1) (가).
      markers: { legal1: "•", legal2: "-", legal3: "·", legal4: "·", legal5: "·", legal6: "·", legal7: "·" },
      tableHeader: { fill: ILSONG_NAVY, textColor: "#FFFFFF" },
      title: { pt: 15, bold: true, font: "body" },
      // The minutes leave one blank line between numbered sections.
      chapter: { blankLineBefore: true }
    },
    // Items stand for sub-headings with a bold lead ("• 추진 방향 …").
    outline: { boldSubHeadings: true }
  },
  {
    // AI융합연구원 중간 보고서 양식: 표지(파랑·청록 선, 제목, 날짜, 연구책임자), 휴먼명조,
    // 1. 본문 제목 → 1) 소제목 → ○ → - → · 본문.
    id: "builtin:hallym-aicr",
    name: "gongmun.builtin.hallymAicr.name",
    description: "gongmun.builtin.hallymAicr.desc",
    group: "gongmun.builtin.group.hallym",
    fileLabel: "gongmun.fileName.hallymAicr",
    preset: "report",
    options: {
      bodyPt: 11,
      lineSpacing: 160,
      numbering: "report",
      h2Marker: "number",
      bullet2: "○", // i18n-data: Kordoc bullet character
      fonts: { body: HUMAN_MYEONGJO, heading: HUMAN_MYEONGJO, ref: HUMAN_MYEONGJO, table: HUMAN_MYEONGJO },
      levels: {
        "0": { font: HUMAN_MYEONGJO, pt: 13, bold: false },
        "1": { font: HUMAN_MYEONGJO, pt: 11 },
        "2": { font: HUMAN_MYEONGJO, pt: 11 },
        "3": { font: HUMAN_MYEONGJO, pt: 11 }
      },
      cover: true,
      pageNumbers: true
    },
    finish: {
      markers: { box0: NUMBERED_PAREN },
      chapter: { pt: 13, bold: true },
      cover: {
        removeInfoBox: true,
        removeBodyTitle: true,
        barColors: [AICR_BLUE, AICR_TEAL],
        linePt: 15,
        lineBold: false,
        // The university emblem centred at the bottom of the cover (assets/cover-logos).
        logo: { key: "hallym-emblem", widthMm: 29.4, bottomMm: 32 }
      }
    },
    quietEngineNotes: [SUMMARY_BOX_NOTE],
    // The form's cover shows the full date ("2025. 11. 00").
    coverDate: "day",
    // "1)" is the form's sub-heading level; lists under a chapter are body text (○).
    outline: { nestChapterLists: true }
  }
];

export function isBuiltinGongmunStyleId(id: unknown): boolean {
  return typeof id === "string" && BUILTIN_GONGMUN_STYLES.some((style) => style.id === id);
}

export function builtinGongmunStyle(id: string): BuiltinGongmunStyle | undefined {
  return BUILTIN_GONGMUN_STYLES.find((style) => style.id === id);
}
