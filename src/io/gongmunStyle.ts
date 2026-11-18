import { normalizeGongmunPreset, type GongmunOptions, type GongmunPreset } from "kordoc";

/**
 * Institution style (기관 서식, 2.7.0 W5): the look an organization applies to all
 * of its official documents — fonts, sizes, numbering, bands, page setup, default
 * approval line and organization name. Content such as recipients or dates comes
 * from note properties (gongmunProperties.ts), never from the style.
 */
export interface GongmunLevelStyleOptions {
  font?: string;
  pt?: number;
  bold?: boolean;
}

export interface GongmunStyleOptions {
  bodyFont?: "myeongjo" | "gothic";
  bodyPt?: number;
  lineSpacing?: number;
  numbering?: "standard" | "report" | "gaejosik";
  bullet2?: "ㅇ" | "○"; // i18n-data: Kordoc bullet characters
  h2Marker?: "band" | "roman" | "box" | "number" | "none";
  bandColor?: string;
  bandTextColor?: string;
  fonts?: { body?: string; heading?: string; ref?: string; table?: string };
  /** Item-marker levels 0-3 (□, ○, -, ㆍ or 1. 가. 1) 가)). */
  levels?: Partial<Record<"0" | "1" | "2" | "3", GongmunLevelStyleOptions>>;
  margins?: { top: number; bottom: number; left: number; right: number };
  pageNumbers?: boolean;
  endMark?: boolean;
  toc?: boolean;
  cover?: boolean;
  suppressSingle?: boolean;
  autoFit?: boolean;
  centerTitle?: boolean;
  /** Default approval labels, e.g. ["담당", "팀장", "과장"]. */
  approval?: string[];
  /** Default organization name (cover, or the draft-letter head table). */
  org?: string;
  /**
   * Kordoc agency look the form starts from (R-030): its measured fonts, marks and
   * colours sit below every option set here. Only frames that take agency looks use it.
   */
  agency?: string;
}

const HEX = /^#[0-9A-F]{6}$/iu;
const LEVEL_KEYS = ["0", "1", "2", "3"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max = 80): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = Array.from(value, (character) => (character.charCodeAt(0) < 32 ? " " : character))
    .join("")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
  return cleaned || undefined;
}

function number(value: unknown, min: number, max: number): number | undefined {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? Math.round(parsed * 10) / 10
    : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function hex(value: unknown): string | undefined {
  return typeof value === "string" && HEX.test(value.trim()) ? value.trim().toUpperCase() : undefined;
}

function compact<T extends object>(value: T): T | undefined {
  return Object.values(value).some((entry) => entry !== undefined) ? value : undefined;
}

/** Keeps only valid, bounded values; unknown keys are dropped. */
export function normalizeGongmunStyleOptions(value: unknown): GongmunStyleOptions {
  const data = isRecord(value) ? value : {};
  const fonts = isRecord(data.fonts) ? data.fonts : {};
  const margins = isRecord(data.margins) ? data.margins : {};
  const levelsInput = isRecord(data.levels) ? data.levels : {};
  const levels: GongmunStyleOptions["levels"] = {};
  for (const key of LEVEL_KEYS) {
    const level = isRecord(levelsInput[key]) ? levelsInput[key] : {};
    const normalized = compact({ font: cleanText(level.font, 40), pt: number(level.pt, 6, 60), bold: bool(level.bold) });
    if (normalized) levels[key] = normalized;
  }
  const marginValues = {
    top: number(margins.top, 5, 60),
    bottom: number(margins.bottom, 5, 60),
    left: number(margins.left, 5, 60),
    right: number(margins.right, 5, 60)
  };
  const approval = Array.isArray(data.approval)
    ? data.approval.map((item) => cleanText(item, 20)).filter((item): item is string => Boolean(item)).slice(0, 8)
    : undefined;
  const result: GongmunStyleOptions = {
    bodyFont: oneOf(data.bodyFont, ["myeongjo", "gothic"] as const),
    bodyPt: number(data.bodyPt, 8, 24),
    lineSpacing: number(data.lineSpacing, 100, 250),
    numbering: oneOf(data.numbering, ["standard", "report", "gaejosik"] as const),
    bullet2: oneOf(data.bullet2, ["ㅇ", "○"] as const), // i18n-data: Kordoc bullet characters
    h2Marker: oneOf(data.h2Marker, ["band", "roman", "box", "number", "none"] as const),
    bandColor: hex(data.bandColor),
    bandTextColor: hex(data.bandTextColor),
    agency: cleanText(data.agency, 40),
    fonts: compact({
      body: cleanText(fonts.body, 40),
      heading: cleanText(fonts.heading, 40),
      ref: cleanText(fonts.ref, 40),
      table: cleanText(fonts.table, 40)
    }),
    levels: Object.keys(levels).length ? levels : undefined,
    margins:
      marginValues.top !== undefined &&
      marginValues.bottom !== undefined &&
      marginValues.left !== undefined &&
      marginValues.right !== undefined
        ? { top: marginValues.top, bottom: marginValues.bottom, left: marginValues.left, right: marginValues.right }
        : undefined,
    pageNumbers: bool(data.pageNumbers),
    endMark: bool(data.endMark),
    toc: bool(data.toc),
    cover: bool(data.cover),
    suppressSingle: bool(data.suppressSingle),
    autoFit: bool(data.autoFit),
    centerTitle: bool(data.centerTitle),
    approval: approval?.length ? approval : undefined,
    org: cleanText(data.org, 80)
  };
  for (const key of Object.keys(result) as Array<keyof GongmunStyleOptions>) {
    if (result[key] === undefined) delete result[key];
  }
  return result;
}

type CoverValue = NonNullable<GongmunOptions["cover"]>;

function mergeCover(
  preset: GongmunPreset,
  style: GongmunStyleOptions,
  note: GongmunOptions["cover"]
): GongmunOptions["cover"] {
  if (note === false) return false;
  const base: Exclude<CoverValue, boolean> = {};
  if (style.org && preset !== "official") base.org = style.org;
  if (typeof note === "object") return { ...base, ...note };
  if (note === true) return Object.keys(base).length ? base : true;
  if (style.cover === false) return false;
  if (Object.keys(base).length) return style.cover === true || preset === "gaejosik" || preset === "ministry" ? base : undefined;
  return style.cover;
}

/**
 * Final options for one export. Precedence: the export window's preset > note
 * properties > institution style > Kordoc's preset defaults.
 */
export function resolveGongmunOptions(input: {
  preset: GongmunPreset;
  style?: GongmunStyleOptions;
  note?: GongmunOptions;
}): GongmunOptions {
  const style = input.style ?? {};
  const note = input.note ?? {};
  const { org, approval, cover: _styleCover, levels, fonts, margins, ...look } = style;
  const options: GongmunOptions = { ...look, preset: input.preset };
  if (fonts) options.fonts = { ...fonts };
  if (margins) options.margins = { ...margins };
  if (levels) options.levels = Object.fromEntries(Object.entries(levels).map(([key, value]) => [key, { ...value }]));
  if (approval) options.approval = [...approval];
  if (org && input.preset === "official") options.docHead = { org };

  const cover = mergeCover(input.preset, style, note.cover);
  if (cover !== undefined) options.cover = cover;
  if (note.toc !== undefined) options.toc = note.toc;
  if (note.approval) options.approval = [...note.approval];
  if (note.summary) options.summary = note.summary;
  if (note.reportInfo) options.reportInfo = note.reportInfo;
  if (note.docHead) options.docHead = { ...options.docHead, ...note.docHead };
  if (note.docFoot) options.docFoot = { ...note.docFoot };
  if (note.noticeHead) options.noticeHead = { ...note.noticeHead };
  if (note.press) {
    options.press = { ...note.press, ...(note.press.contact ? { contact: { ...note.press.contact } } : {}) };
  }
  return options;
}

/** How a cover without a date shows the export day: "2026. 9." or "2026. 9. 29.". */
export type CoverDateFormat = "month" | "day";

function coverIsOn(options: GongmunOptions, preset: GongmunPreset): boolean {
  if (preset === "press") return false;
  return options.cover !== undefined ? options.cover !== false : preset === "gaejosik" || preset === "ministry";
}

/**
 * Fills the cover date when neither the note (공문_날짜) nor the style sets one.
 * Kordoc 4.15.7 writes the report cover's month-only default as "2026. 9.." (the
 * day's period stays), so report and plan covers get "2026. 9." from HanMark; other
 * covers keep Kordoc's full date unless a style asks for a format.
 */
export function withCoverDate(options: GongmunOptions, today: Date, format?: CoverDateFormat): GongmunOptions {
  const preset = normalizeGongmunPreset(options.preset);
  if (!coverIsOn(options, preset)) return options;
  if (typeof options.cover === "object" && options.cover.date) return options;
  // The Seoul policy paper's front page has the same month-only default ("2026. 11..") since Kordoc 4.16.
  const chosen = format ?? (preset === "report" || preset === "plan" || preset === "bangchim" ? "month" : undefined);
  if (!chosen) return options;
  const date = officialDate(today, chosen);
  return { ...options, cover: typeof options.cover === "object" ? { ...options.cover, date } : { date } };
}

/** A date as official documents write it: "2026. 9." or "2026. 9. 29.". */
export function officialDate(day: Date, format: CoverDateFormat = "day"): string {
  const month = `${day.getFullYear()}. ${day.getMonth() + 1}.`;
  return format === "month" ? month : `${month} ${day.getDate()}.`;
}

/** Closing lines HanMark writes itself at the end of a notice (right-aligned). */
export interface GongmunClosing {
  date?: string;
  sender?: string;
}

/**
 * Per-type frame (2.7.0, R-025). Kordoc 4.15.7's v5 engine draws the legal family at
 * 12 pt whatever the type and leaves a type's head and foot out unless they are given,
 * so draft letters, notices, and minutes came out almost alike, and plans matched
 * reports byte for byte. Below the institution style and the note, HanMark adds:
 * - 기안문: the head (organization, 수신, 제목) and foot (발신명의, 결재선, 시행) tables,
 *   as Kordoc already does for the press-release head box;
 * - 통지·안내: Kordoc's documented 15 pt / 160 %, and the date and sender at the end;
 * - 회의록: Kordoc's documented 14 pt / 130 %;
 * - 계획서: the Seoul policy (방침) cover, whose information box has a 방침번호 row.
 * HanMark writes the notice's closing lines itself: Kordoc's v5 notice foot uses a
 * paragraph-shape id of its older engine (17), which the v5 header gives to an
 * indented item, so the date landed on the left instead of the right.
 */
export function applyTypeFrame(
  options: GongmunOptions,
  input: { today: Date; org?: string }
): { options: GongmunOptions; closing?: GongmunClosing } {
  const preset = normalizeGongmunPreset(options.preset);
  const next: GongmunOptions = { ...options };
  switch (preset) {
    case "official":
      next.docHead = { ...options.docHead };
      next.docFoot = { ...options.docFoot };
      return { options: next };
    case "notice": {
      next.bodyPt ??= 15;
      next.lineSpacing ??= 160;
      const head = options.noticeHead;
      const org = (typeof options.cover === "object" ? options.cover.org : undefined) ?? input.org;
      delete next.noticeHead;
      delete next.cover;
      if (head?.no) next.noticeHead = { no: head.no };
      return { options: next, closing: { date: head?.date ?? officialDate(input.today), sender: head?.sender ?? org } };
    }
    case "minutes":
      next.bodyPt ??= 14;
      next.lineSpacing ??= 130;
      return { options: next };
    case "plan":
      if (next.cover === undefined) next.cover = true;
      return { options: next };
    default:
      return { options: next };
  }
}

export type AutoCleanupKind = "law-code" | "system-code" | "region-code" | "tool-note";

export interface AutoCleanup {
  /** 1-based line in the text that was checked. */
  line: number;
  kind: AutoCleanupKind;
  match: string;
}

// Kordoc's official-document generator silently removes these (stripLawCodes in
// Kordoc 4.15.7). Listing them before generation keeps the change visible.
const CLEANUP_PATTERNS: ReadonlyArray<{ kind: AutoCleanupKind; pattern: RegExp }> = [
  { kind: "law-code", pattern: /(?:법률|기본법|특별법|법|령|규칙|조례|규정|고시|훈령|예규|지침)[」』]?\s*\(\d{5,8}\)/gu }, // i18n-data
  { kind: "system-code", pattern: /\(?\bDT_[A-Z0-9_]+\)?/gu },
  { kind: "region-code", pattern: /\((?:법정동|행정동|시군구|지역)?\s*코드\s*[\d-]+\)/gu }, // i18n-data
  { kind: "tool-note", pattern: /[가-힣A-Za-z·]*\s*MCP\s*(?:조회|호출|응답)?/gu } // i18n-data
];

/** Lines whose text the generator will shorten, outside fenced code. */
export function gongmunAutoCleanups(markdown: string): AutoCleanup[] {
  const found: AutoCleanup[] = [];
  let fence = "";
  markdown.replace(/\r\n?/gu, "\n").split("\n").forEach((line, index) => {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1] ?? "";
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = "";
      return;
    }
    if (fence) return;
    for (const { kind, pattern } of CLEANUP_PATTERNS) {
      for (const match of line.matchAll(pattern)) {
        if (match[0].trim()) found.push({ line: index + 1, kind, match: match[0].trim() });
      }
    }
  });
  return found;
}
