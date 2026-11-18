import { PRESET_ALIAS, type GongmunOptions, type GongmunPreset } from "kordoc";

/**
 * Note properties → official-document (공문서) options (2.7.0 W5).
 *
 * Keys are flat Korean property names; each has an English alias with the same
 * meaning. When both are present with different values the Korean key wins and the
 * conflict is reported. The table below is the single source of truth: reading,
 * the "insert properties" button, and the documentation all derive from it.
 */
type ValueKind = "text" | "list" | "boolean" | "preset" | "look" | "people";

type Target =
  | "preset"
  | "look"
  | "press.contact.people"
  | "toc"
  | "approval"
  | "summary"
  | "reportInfo"
  | "cover"
  | "cover.org"
  | "cover.dept"
  | "cover.date"
  | "cover.label"
  | "docHead.org"
  | "docHead.to"
  | "docHead.via"
  | "docHead.slogan"
  | "docHead.title"
  | "docFoot.sender"
  | "docFoot.drafter"
  | "docFoot.reviewer"
  | "docFoot.approver"
  | "docFoot.approvers"
  | "docFoot.cooperator"
  | "docFoot.recipients"
  | "docFoot.docNum"
  | "docFoot.receive"
  | "docFoot.zip"
  | "docFoot.address"
  | "docFoot.phone"
  | "docFoot.fax"
  | "docFoot.email"
  | "docFoot.site"
  | "docFoot.disclosure"
  | "noticeHead.no"
  | "noticeHead.date"
  | "noticeHead.sender"
  | "press.release"
  | "press.distribute"
  | "press.sub"
  | "press.contact.dept"
  | "press.contact.manager"
  | "press.contact.phone";

export interface GongmunPropertySpec {
  /** Korean property name (preferred). */
  key: string;
  /** English alias with the same meaning. */
  alias: string;
  kind: ValueKind;
  target: Target;
  /** Presets for which "insert properties" adds this key. */
  presets: "all" | "never" | readonly GongmunPreset[];
}

// i18n-data-begin: property names are part of the note format, not interface text
export const GONGMUN_PROPERTIES: readonly GongmunPropertySpec[] = [
  { key: "공문_종류", alias: "gongmun-preset", kind: "preset", target: "preset", presets: "never" },
  // The look (모양) of the document: a central agency, 공통, or a form name (R-030).
  { key: "공문_기관서식", alias: "gongmun-agency-style", kind: "look", target: "look", presets: ["report", "plan", "gaejosik", "ministry", "press"] },
  { key: "공문_기관", alias: "gongmun-org", kind: "text", target: "cover.org", presets: "all" },
  { key: "공문_부서", alias: "gongmun-dept", kind: "text", target: "cover.dept", presets: ["report", "plan", "gaejosik", "ministry"] },
  { key: "공문_날짜", alias: "gongmun-date", kind: "text", target: "cover.date", presets: ["report", "plan", "gaejosik", "ministry"] },
  { key: "공문_표지", alias: "gongmun-cover", kind: "boolean", target: "cover", presets: ["report", "plan", "gaejosik", "ministry"] },
  { key: "공문_표지표시", alias: "gongmun-cover-label", kind: "text", target: "cover.label", presets: ["ministry"] },
  { key: "공문_목차", alias: "gongmun-toc", kind: "boolean", target: "toc", presets: ["gaejosik"] },
  { key: "공문_결재", alias: "gongmun-approval", kind: "list", target: "approval", presets: ["official", "report", "plan"] },
  { key: "공문_요약", alias: "gongmun-summary", kind: "text", target: "summary", presets: ["report"] },
  { key: "공문_보고정보", alias: "gongmun-report-info", kind: "text", target: "reportInfo", presets: ["ministry"] },
  { key: "공문_수신", alias: "gongmun-to", kind: "text", target: "docHead.to", presets: ["official"] },
  { key: "공문_경유", alias: "gongmun-via", kind: "text", target: "docHead.via", presets: ["official"] },
  { key: "공문_원훈", alias: "gongmun-slogan", kind: "text", target: "docHead.slogan", presets: ["official"] },
  { key: "공문_제목", alias: "gongmun-title", kind: "text", target: "docHead.title", presets: ["official"] },
  { key: "공문_발신명의", alias: "gongmun-sender", kind: "text", target: "docFoot.sender", presets: ["official"] },
  { key: "공문_기안자", alias: "gongmun-drafter", kind: "text", target: "docFoot.drafter", presets: ["official"] },
  { key: "공문_검토자", alias: "gongmun-reviewer", kind: "text", target: "docFoot.reviewer", presets: ["official"] },
  { key: "공문_결재권자", alias: "gongmun-approver", kind: "text", target: "docFoot.approver", presets: ["official"] },
  { key: "공문_결재선", alias: "gongmun-approvers", kind: "list", target: "docFoot.approvers", presets: "never" },
  { key: "공문_협조자", alias: "gongmun-cooperator", kind: "text", target: "docFoot.cooperator", presets: ["official"] },
  { key: "공문_수신자", alias: "gongmun-recipients", kind: "text", target: "docFoot.recipients", presets: ["official"] },
  { key: "공문_문서번호", alias: "gongmun-doc-number", kind: "text", target: "docFoot.docNum", presets: ["official"] },
  { key: "공문_접수", alias: "gongmun-receive", kind: "text", target: "docFoot.receive", presets: "never" },
  { key: "공문_우편번호", alias: "gongmun-zip", kind: "text", target: "docFoot.zip", presets: "never" },
  { key: "공문_주소", alias: "gongmun-address", kind: "text", target: "docFoot.address", presets: ["official"] },
  { key: "공문_전화", alias: "gongmun-phone", kind: "text", target: "docFoot.phone", presets: ["official"] },
  { key: "공문_전송", alias: "gongmun-fax", kind: "text", target: "docFoot.fax", presets: ["official"] },
  { key: "공문_이메일", alias: "gongmun-email", kind: "text", target: "docFoot.email", presets: ["official"] },
  { key: "공문_홈페이지", alias: "gongmun-site", kind: "text", target: "docFoot.site", presets: ["official"] },
  { key: "공문_공개구분", alias: "gongmun-disclosure", kind: "text", target: "docFoot.disclosure", presets: ["official"] },
  { key: "공고_번호", alias: "notice-number", kind: "text", target: "noticeHead.no", presets: ["notice"] },
  { key: "공고_날짜", alias: "notice-date", kind: "text", target: "noticeHead.date", presets: ["notice"] },
  { key: "공고_발신", alias: "notice-sender", kind: "text", target: "noticeHead.sender", presets: ["notice"] },
  { key: "보도_시점", alias: "press-release", kind: "text", target: "press.release", presets: ["press"] },
  { key: "보도_배포", alias: "press-distribute", kind: "text", target: "press.distribute", presets: ["press"] },
  { key: "보도_부제", alias: "press-subtitles", kind: "list", target: "press.sub", presets: ["press"] },
  { key: "보도_담당부서", alias: "press-dept", kind: "text", target: "press.contact.dept", presets: ["press"] },
  { key: "보도_담당자", alias: "press-manager", kind: "text", target: "press.contact.manager", presets: ["press"] },
  { key: "보도_연락처", alias: "press-contact", kind: "text", target: "press.contact.phone", presets: ["press"] },
  // One person per item, "구분 / 직급 / 이름 / 전화": the six-column contact table of real press releases.
  { key: "보도_담당자표", alias: "press-people", kind: "people", target: "press.contact.people", presets: "never" }
];

const PROPERTY_PREFIXES = ["공문_", "공고_", "보도_", "gongmun-", "notice-", "press-"];
const TRUE_WORDS = new Set(["true", "yes", "on", "1", "예", "네", "켜기", "켬", "사용"]);
const FALSE_WORDS = new Set(["false", "no", "off", "0", "아니오", "아니요", "끄기", "끔", "사용 안 함", "미사용"]);
/** Type names HanMark shows (menu labels) that Kordoc's alias table does not list. */
const HANMARK_PRESET_NAMES: Readonly<Record<string, GongmunPreset>> = {
  공고: "notice",
  통지안내: "notice",
  기안문시행문: "official",
  정부표준개조식: "gaejosik"
};
// i18n-data-end

export type GongmunPropertyIssue =
  | { code: "conflict"; key: string; alias: string }
  | { code: "unknown"; key: string }
  | { code: "invalid"; key: string };

export interface GongmunPropertyResult {
  /** Preset named by the note, if any. */
  preset?: GongmunPreset;
  /** Look named by the note (공문_기관서식), as written; the caller resolves it (R-030). */
  look?: string;
  /** Options taken from the note (content: cover, heads, feet, approval, ...). */
  options: GongmunOptions;
  issues: GongmunPropertyIssue[];
}

/** Empty text, an empty list, or no value: a property left blank (for example by "insert properties"). */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.every(isBlank);
  return false;
}

/**
 * The document type a note names: Kordoc's names and English keys, HanMark's menu
 * names ("통지·안내", "Draft letter (기안문·시행문)"), or 공고. Undefined when unknown —
 * Kordoc itself would silently read an unknown name as 기안문.
 */
export function presetFromName(name: string): GongmunPreset | undefined {
  const compact = (text: string): string => text.normalize("NFC").replace(/[\s·ㆍ・]+/gu, "").toLowerCase();
  const lookup = (text: string): GongmunPreset | undefined => {
    const key = compact(text);
    return key ? (PRESET_ALIAS[key] ?? HANMARK_PRESET_NAMES[key]) : undefined;
  };
  return lookup(name) ?? name.split(/[·ㆍ・,/()]/u).map(lookup).find((preset) => preset !== undefined);
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function listValue(value: unknown): string[] | undefined {
  const items = Array.isArray(value)
    ? value.map(textValue)
    : typeof value === "string"
      ? value.split(/[,，·;\n]/u).map((item) => item.trim())
      : [];
  const cleaned = items.filter((item): item is string => Boolean(item));
  return cleaned.length ? cleaned : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const text = textValue(value)?.toLowerCase();
  if (!text) return undefined;
  if (TRUE_WORDS.has(text)) return true;
  if (FALSE_WORDS.has(text)) return false;
  return undefined;
}

/** "책임자 / 과장 / 홍길동 / 02-000-0000" per item (blank parts may be left out from the right). */
function peopleValue(value: unknown): Array<{ role?: string; title?: string; name?: string; phone?: string }> | undefined {
  const items = Array.isArray(value) ? value.map(textValue) : typeof value === "string" ? value.split(/[;\n]/u) : [];
  const people = items
    .filter((item): item is string => Boolean(item && item.trim()))
    .map((item) => {
      const [role, title, name, phone] = item.split(/[/|]/u).map((part) => part.trim());
      return Object.fromEntries(Object.entries({ role, title, name, phone }).filter(([, part]) => Boolean(part)));
    })
    .filter((person) => Object.keys(person).length > 0);
  return people.length ? people : undefined;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

type Writable = Record<string, unknown>;

function assign(options: GongmunOptions, target: Target, value: unknown): void {
  if (target === "cover") {
    if (value === false) options.cover = false;
    else if (value === true && options.cover === undefined) options.cover = true;
    return;
  }
  const path = target.split(".");
  if (path[0] === "cover" && options.cover === false) return;
  let node = options as unknown as Writable;
  for (const segment of path.slice(0, -1)) {
    const next = node[segment];
    if (typeof next !== "object" || next === null) node[segment] = {};
    node = node[segment] as Writable;
  }
  node[path[path.length - 1]] = value;
}

/**
 * Reads the note's official-document properties. `preset` decides where the
 * organization name goes (the draft-letter head table for 기안문, the cover
 * otherwise); pass the preset that will actually be generated.
 */
export function readGongmunProperties(
  frontmatter: Readonly<Record<string, unknown>> | null | undefined,
  preset?: GongmunPreset
): GongmunPropertyResult {
  const result: GongmunPropertyResult = { options: {}, issues: [] };
  const data = frontmatter ?? {};
  const known = new Set<string>();
  const values: Array<{ spec: GongmunPropertySpec; value: unknown }> = [];

  for (const spec of GONGMUN_PROPERTIES) {
    known.add(spec.key);
    known.add(spec.alias);
    const hasKey = Object.prototype.hasOwnProperty.call(data, spec.key);
    const hasAlias = Object.prototype.hasOwnProperty.call(data, spec.alias);
    if (!hasKey && !hasAlias) continue;
    const raw = hasKey ? data[spec.key] : data[spec.alias];
    if (hasKey && hasAlias && !sameValue(data[spec.key], data[spec.alias])) {
      result.issues.push({ code: "conflict", key: spec.key, alias: spec.alias });
    }
    values.push({ spec, value: raw });
  }

  for (const key of Object.keys(data)) {
    if (!known.has(key) && PROPERTY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      result.issues.push({ code: "unknown", key });
    }
  }

  const presetEntry = values.find(({ spec }) => spec.kind === "preset");
  if (presetEntry && !isBlank(presetEntry.value)) {
    const text = textValue(presetEntry.value);
    const named = text ? presetFromName(text) : undefined;
    if (named) result.preset = named;
    else result.issues.push({ code: "invalid", key: presetEntry.spec.key });
  }
  const effectivePreset = preset ?? result.preset;

  for (const { spec, value } of values) {
    if (spec.kind === "preset") continue;
    if (spec.kind === "look") {
      const look = textValue(value);
      if (look) result.look = look;
      else if (!isBlank(value)) result.issues.push({ code: "invalid", key: spec.key });
      continue;
    }
    const parsed =
      spec.kind === "list"
        ? listValue(value)
        : spec.kind === "boolean"
          ? booleanValue(value)
          : spec.kind === "people"
            ? peopleValue(value)
            : textValue(value);
    if (parsed === undefined) {
      if (!isBlank(value)) result.issues.push({ code: "invalid", key: spec.key });
      continue;
    }
    let target = spec.target;
    // The draft letter (기안문) prints the organization in its head table.
    if (target === "cover.org" && effectivePreset === "official") target = "docHead.org";
    assign(result.options, target, parsed);
  }
  return result;
}

/** Keys the "insert properties" button adds for a preset (Korean names). */
export function gongmunPropertyKeysFor(preset: GongmunPreset): string[] {
  return GONGMUN_PROPERTIES.filter(
    (spec) => spec.presets === "all" || (Array.isArray(spec.presets) && spec.presets.includes(preset))
  ).map((spec) => spec.key);
}

export const GONGMUN_PRESET_PROPERTY_KEY = "공문_종류"; // i18n-data
export const GONGMUN_LOOK_PROPERTY_KEY = "공문_기관서식"; // i18n-data

// i18n-data-begin: Korean preset names Kordoc accepts as property values
/** Written into 공문_종류 by "insert properties"; Kordoc reads them as aliases. */
export const GONGMUN_PRESET_KOREAN_NAMES: Readonly<Record<GongmunPreset, string>> = {
  official: "기안문",
  report: "보고서",
  plan: "계획서",
  notice: "통지",
  minutes: "회의록",
  gaejosik: "개조식",
  press: "보도자료",
  ministry: "업무보고",
  bangchim: "서울방침"
};
// i18n-data-end
