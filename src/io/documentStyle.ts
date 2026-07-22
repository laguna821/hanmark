import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const HH_NS = "http://www.hancom.co.kr/hwpml/2011/head";
const SCRIPT_KEYS = ["hangul", "latin", "hanja", "japanese", "other", "symbol", "user"] as const;
const ROLE_KEYS = ["body", "h1", "h2", "h3", "h4", "h5", "h6", "quote", "code", "list"] as const;
const ALIGNMENTS = new Set(["LEFT", "CENTER", "RIGHT", "JUSTIFY", "DISTRIBUTE", "DISTRIBUTE_SPACE"]);

export type DocumentStyleRole = (typeof ROLE_KEYS)[number];

export interface CharacterStyleProfile {
  fontFamily?: string;
  latinFontFamily?: string;
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  widthPercent?: number;
  letterSpacingPercent?: number;
}

export interface ParagraphStyleProfile {
  alignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFY" | "DISTRIBUTE" | "DISTRIBUTE_SPACE";
  lineSpacingPercent?: number;
  firstLineIndentHu?: number;
  marginLeftHu?: number;
  marginRightHu?: number;
  spaceBeforeHu?: number;
  spaceAfterHu?: number;
  keepWithNext?: boolean;
}

export interface RoleStyleProfile {
  styleName?: string;
  character?: CharacterStyleProfile;
  paragraph?: ParagraphStyleProfile;
}

export interface PageStyleProfile {
  widthHu: number;
  heightHu: number;
  landscape?: "WIDELY" | "NARROWLY";
  gutterType?: string;
  margins: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    header?: number;
    footer?: number;
    gutter?: number;
  };
}

export interface DocumentStyleProfile {
  schemaVersion: 3;
  name: string;
  sourceName?: string;
  roles: Partial<Record<DocumentStyleRole, RoleStyleProfile>>;
  page?: PageStyleProfile;
}

export interface AppliedDocumentStyle {
  data: ArrayBuffer;
  profile: DocumentStyleProfile;
  appliedRoles: DocumentStyleRole[];
}

export interface ExtendedHeadingMarker {
  token: string;
  level: 5 | 6;
}

function localName(node: Node): string {
  return (node as any).localName || node.nodeName.split(":").pop() || node.nodeName;
}

function elements(root: Document | Element, name: string): Element[] {
  const all = root.getElementsByTagName("*");
  const result: Element[] = [];
  for (let index = 0; index < all.length; index++) {
    const element = all.item(index);
    if (element && localName(element) === name) result.push(element);
  }
  return result;
}

function directElements(root: Element, name?: string): Element[] {
  const result: Element[] = [];
  for (let node = root.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && (!name || localName(node) === name)) result.push(node as Element);
  }
  return result;
}

function firstElement(root: Document | Element, name: string): Element | undefined {
  return elements(root, name)[0];
}

function parseXml(xml: string, label: string): Document {
  const errors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: (message) => errors.push(String(message)),
      fatalError: (message) => errors.push(String(message))
    }
  }).parseFromString(xml.replace(/^\uFEFF/, ""), "application/xml");
  if (!document?.documentElement || errors.length) {
    throw new Error(`${label} XML을 읽을 수 없습니다.${errors[0] ? ` ${errors[0]}` : ""}`);
  }
  return document;
}

function zipFileByPortablePath(zip: JSZip, path: string): JSZip.JSZipObject | null {
  const direct = zip.file(path);
  if (direct) return direct;
  const matched = Object.keys(zip.files).find((name) => name.replace(/\\/g, "/") === path);
  return matched ? zip.file(matched) : null;
}

function numberAttribute(element: Element | undefined, name: string): number | undefined {
  if (!element) return undefined;
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) ? value : undefined;
}

function booleanAttribute(element: Element | undefined, name: string): boolean | undefined {
  if (!element?.hasAttribute(name)) return undefined;
  return element.getAttribute(name) === "1" || element.getAttribute(name)?.toLowerCase() === "true";
}

function childValue(element: Element | undefined, childName: string): number | undefined {
  if (!element) return undefined;
  return numberAttribute(directElements(element, childName)[0], "value");
}

function cleanText(value: unknown, max = 100): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("").replace(/\s+/g, " ").trim().slice(0, max);
  return cleaned || undefined;
}

function bounded(value: unknown, min: number, max: number, integer = false): number | undefined {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  const clamped = Math.max(min, Math.min(max, number));
  return integer ? Math.round(clamped) : Math.round(clamped * 100) / 100;
}

function color(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : undefined;
}

function normalizeCharacter(input: any): CharacterStyleProfile | undefined {
  if (!input || typeof input !== "object") return undefined;
  const result: CharacterStyleProfile = {};
  const fontFamily = cleanText(input.fontFamily, 80);
  const latinFontFamily = cleanText(input.latinFontFamily, 80);
  const fontSizePt = bounded(input.fontSizePt, 4, 100);
  const textColor = color(input.color);
  const widthPercent = bounded(input.widthPercent, 50, 200, true);
  const letterSpacingPercent = bounded(input.letterSpacingPercent, -50, 50, true);
  if (fontFamily) result.fontFamily = fontFamily;
  if (latinFontFamily) result.latinFontFamily = latinFontFamily;
  if (fontSizePt !== undefined) result.fontSizePt = fontSizePt;
  if (typeof input.bold === "boolean") result.bold = input.bold;
  if (typeof input.italic === "boolean") result.italic = input.italic;
  if (typeof input.underline === "boolean") result.underline = input.underline;
  if (textColor) result.color = textColor;
  if (widthPercent !== undefined) result.widthPercent = widthPercent;
  if (letterSpacingPercent !== undefined) result.letterSpacingPercent = letterSpacingPercent;
  return Object.keys(result).length ? result : undefined;
}

function normalizeParagraph(input: any): ParagraphStyleProfile | undefined {
  if (!input || typeof input !== "object") return undefined;
  const result: ParagraphStyleProfile = {};
  const alignment = String(input.alignment || "").toUpperCase();
  if (ALIGNMENTS.has(alignment)) result.alignment = alignment as ParagraphStyleProfile["alignment"];
  const lineSpacingPercent = bounded(input.lineSpacingPercent, 70, 400, true);
  const firstLineIndentHu = bounded(input.firstLineIndentHu, -100_000, 100_000, true);
  const marginLeftHu = bounded(input.marginLeftHu, 0, 100_000, true);
  const marginRightHu = bounded(input.marginRightHu, 0, 100_000, true);
  const spaceBeforeHu = bounded(input.spaceBeforeHu, 0, 100_000, true);
  const spaceAfterHu = bounded(input.spaceAfterHu, 0, 100_000, true);
  if (lineSpacingPercent !== undefined) result.lineSpacingPercent = lineSpacingPercent;
  if (firstLineIndentHu !== undefined) result.firstLineIndentHu = firstLineIndentHu;
  if (marginLeftHu !== undefined) result.marginLeftHu = marginLeftHu;
  if (marginRightHu !== undefined) result.marginRightHu = marginRightHu;
  if (spaceBeforeHu !== undefined) result.spaceBeforeHu = spaceBeforeHu;
  if (spaceAfterHu !== undefined) result.spaceAfterHu = spaceAfterHu;
  if (typeof input.keepWithNext === "boolean") result.keepWithNext = input.keepWithNext;
  return Object.keys(result).length ? result : undefined;
}

function normalizePage(input: any): PageStyleProfile | undefined {
  if (!input || typeof input !== "object" || !input.margins) return undefined;
  const widthHu = bounded(input.widthHu, 10_000, 200_000, true);
  const heightHu = bounded(input.heightHu, 10_000, 200_000, true);
  const top = bounded(input.margins.top, 0, 100_000, true);
  const bottom = bounded(input.margins.bottom, 0, 100_000, true);
  const left = bounded(input.margins.left, 0, 100_000, true);
  const right = bounded(input.margins.right, 0, 100_000, true);
  if ([widthHu, heightHu, top, bottom, left, right].some((value) => value === undefined)) return undefined;
  if ((left as number) + (right as number) >= (widthHu as number)) return undefined;
  if ((top as number) + (bottom as number) >= (heightHu as number)) return undefined;
  const page: PageStyleProfile = {
    widthHu: widthHu as number,
    heightHu: heightHu as number,
    margins: { top: top as number, bottom: bottom as number, left: left as number, right: right as number }
  };
  if (input.landscape === "WIDELY" || input.landscape === "NARROWLY") page.landscape = input.landscape;
  const gutterType = cleanText(input.gutterType, 30);
  if (gutterType) page.gutterType = gutterType;
  for (const key of ["header", "footer", "gutter"] as const) {
    const value = bounded(input.margins[key], 0, 100_000, true);
    if (value !== undefined) page.margins[key] = value;
  }
  return page;
}

export function normalizeDocumentStyleProfile(input: any): DocumentStyleProfile {
  if (!input || typeof input !== "object") throw new Error("문서 스타일 프로필이 비어 있습니다.");
  const sourceSchemaVersion = Number(input.schemaVersion) || 1;
  const roles: DocumentStyleProfile["roles"] = {};
  for (const role of ROLE_KEYS) {
    const raw = input.roles?.[role];
    if (!raw || typeof raw !== "object") continue;
    const character = normalizeCharacter(raw.character);
    const paragraph = normalizeParagraph(raw.paragraph);
    const styleName = cleanText(raw.styleName, 80);
    if (character || paragraph || styleName) roles[role] = { character, paragraph, styleName };
  }
  // HanMark 2.2.0 treated <underline type="NONE"> as enabled. The direct
  // editor did not expose underline, so every persisted v1 true value came
  // from that importer bug and is safe to migrate back to false.
  if (sourceSchemaVersion < 2) {
    for (const style of Object.values(roles)) {
      if (style?.character?.underline === true) style.character.underline = false;
    }
  }
  if (sourceSchemaVersion < 3 && roles.h4) {
    if (!roles.h5) roles.h5 = JSON.parse(JSON.stringify(roles.h4));
    if (!roles.h6) roles.h6 = JSON.parse(JSON.stringify(roles.h4));
    if (roles.h5) roles.h5.styleName = "제목 5";
    if (roles.h6) roles.h6.styleName = "제목 6";
  }
  if (!Object.keys(roles).length) throw new Error("본문 또는 제목 스타일을 찾을 수 없습니다.");
  return {
    schemaVersion: 3,
    name: cleanText(input.name, 100) || "가져온 문서 스타일",
    sourceName: cleanText(input.sourceName, 160),
    roles,
    page: normalizePage(input.page)
  };
}

function fontMaps(header: Document): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  for (const fontface of elements(header, "fontface")) {
    const language = fontface.getAttribute("lang").toUpperCase();
    const fonts = new Map<string, string>();
    for (const font of directElements(fontface, "font")) fonts.set(font.getAttribute("id"), font.getAttribute("face"));
    result.set(language, fonts);
  }
  return result;
}

function extractedCharacter(charPr: Element | undefined, fonts: Map<string, Map<string, string>>): CharacterStyleProfile | undefined {
  if (!charPr) return undefined;
  const fontRef = firstElement(charPr, "fontRef");
  const hangulId = fontRef?.getAttribute("hangul") || "";
  const latinId = fontRef?.getAttribute("latin") || "";
  const height = numberAttribute(charPr, "height");
  const ratio = numberAttribute(firstElement(charPr, "ratio"), "hangul");
  const spacing = numberAttribute(firstElement(charPr, "spacing"), "hangul");
  const underline = firstElement(charPr, "underline");
  const result: CharacterStyleProfile = {
    fontFamily: fonts.get("HANGUL")?.get(hangulId),
    latinFontFamily: fonts.get("LATIN")?.get(latinId),
    fontSizePt: height && height > 0 ? height / 100 : undefined,
    bold: booleanAttribute(charPr, "bold") === true || Boolean(firstElement(charPr, "bold")),
    italic: booleanAttribute(charPr, "italic") === true || Boolean(firstElement(charPr, "italic")),
    underline: underline !== undefined && (underline.getAttribute("type") || "NONE").toUpperCase() !== "NONE",
    color: charPr.getAttribute("textColor") || undefined,
    widthPercent: ratio,
    letterSpacingPercent: spacing
  };
  return normalizeCharacter(result);
}

function extractedParagraph(paraPr: Element | undefined): ParagraphStyleProfile | undefined {
  if (!paraPr) return undefined;
  const align = firstElement(paraPr, "align")?.getAttribute("horizontal") || undefined;
  const lineSpacing = firstElement(paraPr, "lineSpacing");
  const margin = firstElement(paraPr, "margin");
  const breakSetting = firstElement(paraPr, "breakSetting");
  return normalizeParagraph({
    alignment: align,
    lineSpacingPercent: lineSpacing?.getAttribute("type") === "PERCENT" ? numberAttribute(lineSpacing, "value") : undefined,
    firstLineIndentHu: childValue(margin, "intent"),
    marginLeftHu: childValue(margin, "left"),
    marginRightHu: childValue(margin, "right"),
    spaceBeforeHu: childValue(margin, "prev"),
    spaceAfterHu: childValue(margin, "next"),
    keepWithNext: booleanAttribute(breakSetting, "keepWithNext")
  });
}

function styleRole(style: Element): DocumentStyleRole | undefined {
  const english = (style.getAttribute("engName") || "").trim().toLowerCase();
  const korean = (style.getAttribute("name") || "").trim().toLowerCase();
  if (english === "normal" || korean === "바탕글") return "body";
  for (let level = 1; level <= 6; level++) {
    if (english === `heading ${level}` || korean === `제목 ${level}`) return `h${level}` as DocumentStyleRole;
  }
  if (["block text", "blockquote", "quote"].includes(english) || korean.includes("인용")) return "quote";
  if (["source code", "code block", "verbatim"].includes(english) || korean.includes("코드")) return "code";
  if (["list paragraph", "list"].includes(english) || korean.includes("목록")) return "list";
  return undefined;
}

function extractedPage(section: Document): PageStyleProfile | undefined {
  const pagePr = firstElement(section, "pagePr");
  const margin = pagePr ? firstElement(pagePr, "margin") : undefined;
  if (!pagePr || !margin) return undefined;
  return normalizePage({
    widthHu: numberAttribute(pagePr, "width"),
    heightHu: numberAttribute(pagePr, "height"),
    landscape: pagePr.getAttribute("landscape"),
    gutterType: pagePr.getAttribute("gutterType"),
    margins: {
      top: numberAttribute(margin, "top"),
      bottom: numberAttribute(margin, "bottom"),
      left: numberAttribute(margin, "left"),
      right: numberAttribute(margin, "right"),
      header: numberAttribute(margin, "header"),
      footer: numberAttribute(margin, "footer"),
      gutter: numberAttribute(margin, "gutter")
    }
  });
}

/** Extract safe semantic values only; reference XML and its local IDs are never persisted. */
export async function extractDocumentStyleProfile(
  input: ArrayBuffer | Uint8Array,
  name = "가져온 문서 스타일"
): Promise<DocumentStyleProfile> {
  const zip = await JSZip.loadAsync(input);
  const headerFile = zipFileByPortablePath(zip, "Contents/header.xml");
  const sectionFile = zipFileByPortablePath(zip, "Contents/section0.xml");
  if (!headerFile || !sectionFile) throw new Error("문서 스타일을 읽을 header.xml 또는 section0.xml이 없습니다.");
  const header = parseXml(await headerFile.async("string"), "header.xml");
  const section = parseXml(await sectionFile.async("string"), "section0.xml");
  const fonts = fontMaps(header);
  const charPrs = new Map(elements(header, "charPr").map((element) => [element.getAttribute("id"), element]));
  const paraPrs = new Map(elements(header, "paraPr").map((element) => [element.getAttribute("id"), element]));
  const roles: DocumentStyleProfile["roles"] = {};

  for (const style of elements(header, "style")) {
    const role = styleRole(style);
    if (!role || roles[role]) continue;
    const character = extractedCharacter(charPrs.get(style.getAttribute("charPrIDRef")), fonts);
    const paragraph = extractedParagraph(paraPrs.get(style.getAttribute("paraPrIDRef")));
    if (character || paragraph) roles[role] = { styleName: style.getAttribute("name") || undefined, character, paragraph };
  }

  if (!roles.body) {
    roles.body = {
      styleName: "바탕글",
      character: extractedCharacter(charPrs.get("0"), fonts),
      paragraph: extractedParagraph(paraPrs.get("0"))
    };
  }

  return normalizeDocumentStyleProfile({
    schemaVersion: 3,
    name,
    sourceName: name,
    roles,
    page: extractedPage(section)
  });
}

const SCRIPT_LANGUAGE: Record<(typeof SCRIPT_KEYS)[number], string> = {
  hangul: "HANGUL",
  latin: "LATIN",
  hanja: "HANJA",
  japanese: "JAPANESE",
  other: "OTHER",
  symbol: "SYMBOL",
  user: "USER"
};

function canonicalHwpxFontFace(family: string): string {
  const normalized = family.replace(/\s+/g, " ").trim();
  if (normalized === "신명조") return "한양신명조";
  if (normalized === "맑은고딕") return "맑은 고딕";
  return normalized;
}

function configuredFontfaces(header: Document): Array<{ script: (typeof SCRIPT_KEYS)[number]; group: Element }> {
  const groups = elements(header, "fontface");
  return SCRIPT_KEYS.flatMap((script) => {
    const group = groups.find((candidate) => candidate.getAttribute("lang").toUpperCase() === SCRIPT_LANGUAGE[script]);
    return group ? [{ script, group }] : [];
  });
}

function clonedFont(
  header: Document,
  template: Element | undefined,
  id: number,
  family: string
): Element {
  const font = template
    ? (template.cloneNode(true) as Element)
    : header.createElementNS(HH_NS, "hh:font");
  font.setAttribute("id", String(id));
  font.setAttribute("face", family);
  font.setAttribute("type", "TTF");
  font.setAttribute("isEmbedded", "0");
  font.removeAttribute("embeddedBinaryItemIDRef");
  return font;
}

/**
 * Hancom's style dialog treats different per-script font IDs as a mixed font and
 * displays "?" even when the glyphs look right. Register a face at one shared,
 * contiguous ID in every fontface table so F6 sees one editable font selection.
 */
function ensureUnifiedFont(header: Document, rawFamily: string): string {
  const family = canonicalHwpxFontFace(rawFamily);
  const configured = configuredFontfaces(header);
  if (!configured.length) throw new Error("HWPX 글꼴 테이블을 찾을 수 없습니다.");
  const normalized = family.toLocaleLowerCase();
  const commonIds = configured
    .map(({ group }) => new Set(
      directElements(group, "font")
        .filter((font) => font.getAttribute("face").trim().toLocaleLowerCase() === normalized)
        .map((font) => font.getAttribute("id"))
    ))
    .reduce<string[]>((ids, current, index) => index === 0 ? [...current] : ids.filter((id) => current.has(id)), []);
  if (commonIds.length) return commonIds.sort((left, right) => Number(left) - Number(right))[0];

  const commonId = Math.max(
    -1,
    ...configured.flatMap(({ group }) => directElements(group, "font").map((font) => Number(font.getAttribute("id"))).filter(Number.isFinite))
  ) + 1;
  const familyTemplate = configured
    .flatMap(({ group }) => directElements(group, "font"))
    .find((font) => font.getAttribute("face").trim().toLocaleLowerCase() === normalized);

  for (const { group } of configured) {
    let fonts = directElements(group, "font");
    let nextId = Math.max(-1, ...fonts.map((font) => Number(font.getAttribute("id"))).filter(Number.isFinite)) + 1;
    while (nextId < commonId) {
      const fillerTemplate = fonts[0] ?? familyTemplate;
      const fillerFamily = fillerTemplate?.getAttribute("face") || "함초롬바탕";
      group.appendChild(clonedFont(header, fillerTemplate, nextId, fillerFamily));
      fonts = directElements(group, "font");
      nextId++;
    }
    group.appendChild(clonedFont(header, familyTemplate ?? fonts[0], commonId, family));
    group.setAttribute("fontCnt", String(directElements(group, "font").length));
  }
  return String(commonId);
}

function removeChildren(element: Element, name: string): void {
  for (const child of directElements(element, name)) element.removeChild(child);
}

function setFlag(document: Document, element: Element, name: "bold" | "italic", enabled: boolean | undefined): void {
  if (enabled === undefined) return;
  removeChildren(element, name);
  element.removeAttribute(name);
  if (!enabled) return;
  element.setAttribute(name, "1");
  element.appendChild(document.createElementNS(HH_NS, `hh:${name}`));
}

function setUnderline(document: Document, element: Element, enabled: boolean | undefined): void {
  if (enabled === undefined) return;
  removeChildren(element, "underline");
  if (!enabled) return;
  const underline = document.createElementNS(HH_NS, "hh:underline");
  underline.setAttribute("type", "BOTTOM");
  underline.setAttribute("shape", "SOLID");
  underline.setAttribute("color", element.getAttribute("textColor") || "#000000");
  element.appendChild(underline);
}

function applyCharacter(
  header: Document,
  charPr: Element | undefined,
  style: CharacterStyleProfile | undefined,
  forced?: { bold?: boolean; italic?: boolean }
): void {
  if (!charPr || !style) return;
  if (style.fontSizePt !== undefined) charPr.setAttribute("height", String(Math.round(style.fontSizePt * 100)));
  if (style.color) charPr.setAttribute("textColor", style.color);
  const fontRef = firstElement(charPr, "fontRef");
  if (fontRef && style.fontFamily) {
    const main = ensureUnifiedFont(header, style.fontFamily);
    const latinFamily = style.latinFontFamily || style.fontFamily;
    const latin = canonicalHwpxFontFace(latinFamily).toLocaleLowerCase() === canonicalHwpxFontFace(style.fontFamily).toLocaleLowerCase()
      ? main
      : ensureUnifiedFont(header, latinFamily);
    for (const script of SCRIPT_KEYS) {
      fontRef.setAttribute(script, script === "latin" || script === "other" ? latin : main);
    }
  }
  const ratio = firstElement(charPr, "ratio");
  if (ratio && style.widthPercent !== undefined) {
    for (const script of SCRIPT_KEYS) ratio.setAttribute(script, String(style.widthPercent));
  }
  const spacing = firstElement(charPr, "spacing");
  if (spacing && style.letterSpacingPercent !== undefined) {
    for (const script of SCRIPT_KEYS) spacing.setAttribute(script, String(style.letterSpacingPercent));
  }
  setFlag(header, charPr, "bold", forced?.bold ?? style.bold);
  setFlag(header, charPr, "italic", forced?.italic ?? style.italic);
  setUnderline(header, charPr, style.underline);
}

function setMarginValue(margin: Element | undefined, name: string, value: number | undefined): void {
  if (!margin || value === undefined) return;
  const child = directElements(margin, name)[0];
  if (child) child.setAttribute("value", String(Math.round(value)));
}

function applyParagraph(paraPr: Element | undefined, style: ParagraphStyleProfile | undefined): void {
  if (!paraPr || !style) return;
  const align = firstElement(paraPr, "align");
  if (align && style.alignment) align.setAttribute("horizontal", style.alignment);
  const lineSpacing = firstElement(paraPr, "lineSpacing");
  if (lineSpacing && style.lineSpacingPercent !== undefined) {
    lineSpacing.setAttribute("type", "PERCENT");
    lineSpacing.setAttribute("value", String(style.lineSpacingPercent));
  }
  const margin = firstElement(paraPr, "margin");
  setMarginValue(margin, "intent", style.firstLineIndentHu);
  setMarginValue(margin, "left", style.marginLeftHu);
  setMarginValue(margin, "right", style.marginRightHu);
  setMarginValue(margin, "prev", style.spaceBeforeHu);
  setMarginValue(margin, "next", style.spaceAfterHu);
  const breakSetting = firstElement(paraPr, "breakSetting");
  if (breakSetting && style.keepWithNext !== undefined) {
    breakSetting.setAttribute("keepWithNext", style.keepWithNext ? "1" : "0");
  }
}

function applyPage(section: Document, page: PageStyleProfile | undefined): void {
  if (!page) return;
  const pagePr = firstElement(section, "pagePr");
  const margin = pagePr ? firstElement(pagePr, "margin") : undefined;
  if (!pagePr || !margin) return;
  pagePr.setAttribute("width", String(page.widthHu));
  pagePr.setAttribute("height", String(page.heightHu));
  if (page.landscape) pagePr.setAttribute("landscape", page.landscape);
  if (page.gutterType) pagePr.setAttribute("gutterType", page.gutterType);
  for (const key of ["top", "bottom", "left", "right", "header", "footer", "gutter"] as const) {
    const value = page.margins[key];
    if (value !== undefined) margin.setAttribute(key, String(value));
  }
}

interface RoleResourceIds {
  charId: number;
  paraId: number;
  styleId: number;
}

function nextNumericId(items: Element[]): number {
  return Math.max(-1, ...items.map((item) => Number(item.getAttribute("id"))).filter(Number.isFinite)) + 1;
}

function appendExtendedHeadingResources(
  header: Document,
  charPrs: Map<number, Element>,
  paraPrs: Map<number, Element>,
  profile: DocumentStyleProfile
): Map<5 | 6, RoleResourceIds> {
  const result = new Map<5 | 6, RoleResourceIds>();
  const charProperties = firstElement(header, "charProperties");
  const paraProperties = firstElement(header, "paraProperties");
  if (!charProperties || !paraProperties) return result;

  let charId = nextNumericId([...charPrs.values()]);
  let paraId = nextNumericId([...paraPrs.values()]);
  for (const level of [5, 6] as const) {
    const role = `h${level}` as DocumentStyleRole;
    const roleStyle = profile.roles[role];
    if (!roleStyle) continue;
    const charTemplate = charPrs.get(8) ?? charPrs.get(0);
    const paraTemplate = paraPrs.get(4) ?? paraPrs.get(0);
    if (!charTemplate || !paraTemplate) throw new Error(`H${level} 스타일을 만들 기준 HWPX 속성이 없습니다.`);

    const charPr = charTemplate.cloneNode(true) as Element;
    charPr.setAttribute("id", String(charId));
    applyCharacter(header, charPr, roleStyle.character);
    charProperties.appendChild(charPr);
    charPrs.set(charId, charPr);

    const paraPr = paraTemplate.cloneNode(true) as Element;
    paraPr.setAttribute("id", String(paraId));
    const heading = firstElement(paraPr, "heading");
    if (heading) {
      heading.setAttribute("type", "OUTLINE");
      heading.setAttribute("level", String(level - 1));
    }
    applyParagraph(paraPr, roleStyle.paragraph);
    paraProperties.appendChild(paraPr);
    paraPrs.set(paraId, paraPr);

    result.set(level, { charId, paraId, styleId: level });
    charId++;
    paraId++;
  }
  charProperties.setAttribute("itemCnt", String(directElements(charProperties, "charPr").length));
  paraProperties.setAttribute("itemCnt", String(directElements(paraProperties, "paraPr").length));
  return result;
}

function ancestor(element: Element, name: string): Element | undefined {
  let current: Node | null = element;
  while (current) {
    if (current.nodeType === 1 && localName(current) === name) return current as Element;
    current = current.parentNode;
  }
  return undefined;
}

function applyExtendedHeadingMarkers(
  section: Document,
  markers: ExtendedHeadingMarker[],
  resources: Map<5 | 6, RoleResourceIds>
): void {
  const textElements = elements(section, "t");
  for (const marker of markers) {
    const matches = textElements.filter((text) => (text.textContent || "").includes(marker.token));
    if (matches.length !== 1) {
      throw new Error(`H${marker.level} 제목 식별자 검증 실패: 예상 1개, 발견 ${matches.length}개`);
    }
    const resource = resources.get(marker.level);
    if (!resource) throw new Error(`H${marker.level} 문서 스타일이 없어 제목 단계를 보존할 수 없습니다.`);
    const text = matches[0];
    text.textContent = (text.textContent || "").replace(marker.token, "");
    const paragraph = ancestor(text, "p");
    if (!paragraph) throw new Error(`H${marker.level} 제목 문단을 찾을 수 없습니다.`);
    paragraph.setAttribute("paraPrIDRef", String(resource.paraId));
    paragraph.setAttribute("styleIDRef", String(resource.styleId));
    for (const run of elements(paragraph, "run")) run.setAttribute("charPrIDRef", String(resource.charId));
  }
  const serialized = new XMLSerializer().serializeToString(section);
  const leaked = markers.find((marker) => serialized.includes(marker.token));
  if (leaked) throw new Error(`H${leaked.level} 임시 식별자가 HWPX에 남았습니다.`);
}

function ensureNamedStyles(
  header: Document,
  section: Document,
  profile: DocumentStyleProfile,
  extended: Map<5 | 6, RoleResourceIds>
): void {
  const styles = firstElement(header, "styles");
  if (!styles) return;
  const existing = new Map(directElements(styles, "style").map((style) => [style.getAttribute("id"), style]));
  const normal = existing.get("0");
  if (normal && profile.roles.body) {
    normal.setAttribute("type", "PARA");
    normal.setAttribute("name", profile.roles.body.styleName || "바탕글");
    normal.setAttribute("engName", "Normal");
    normal.setAttribute("paraPrIDRef", "0");
    normal.setAttribute("charPrIDRef", "0");
    normal.setAttribute("nextStyleIDRef", "0");
    normal.removeAttribute("langIDRef");
    normal.setAttribute("langID", "1042");
    normal.setAttribute("lockForm", "0");
  }
  for (let level = 1; level <= 6; level++) {
    const role = `h${level}` as DocumentStyleRole;
    if (!profile.roles[role]) continue;
    const resource = level <= 4
      ? { charId: 4 + level, paraId: level, styleId: level }
      : extended.get(level as 5 | 6);
    if (!resource) continue;
    let style = existing.get(String(level));
    if (!style) {
      style = header.createElementNS(HH_NS, "hh:style");
      styles.appendChild(style);
    }
    style.setAttribute("id", String(level));
    style.setAttribute("type", "PARA");
    style.setAttribute("name", profile.roles[role]?.styleName || `제목 ${level}`);
    style.setAttribute("engName", `Heading ${level}`);
    style.setAttribute("paraPrIDRef", String(resource.paraId));
    style.setAttribute("charPrIDRef", String(resource.charId));
    style.setAttribute("nextStyleIDRef", "0");
    style.removeAttribute("langIDRef");
    style.setAttribute("langID", "1042");
    style.setAttribute("lockForm", "0");
  }
  styles.setAttribute("itemCnt", String(directElements(styles, "style").length));

  for (const paragraph of elements(section, "p")) {
    const paraId = Number(paragraph.getAttribute("paraPrIDRef"));
    if (paraId >= 1 && paraId <= 4 && profile.roles[`h${paraId}` as DocumentStyleRole]) {
      paragraph.setAttribute("styleIDRef", String(paraId));
    }
  }
}

/** Apply role values to Kordoc's stable role IDs without importing foreign XML IDs. */
export async function applyDocumentStyleToHwpx(
  input: ArrayBuffer | Uint8Array,
  rawProfile: DocumentStyleProfile,
  markers: ExtendedHeadingMarker[] = []
): Promise<AppliedDocumentStyle> {
  const profile = normalizeDocumentStyleProfile(rawProfile);
  const zip = await JSZip.loadAsync(input);
  const headerFile = zip.file("Contents/header.xml");
  const sectionFile = zip.file("Contents/section0.xml");
  if (!headerFile || !sectionFile) throw new Error("문서 스타일을 적용할 header.xml 또는 section0.xml이 없습니다.");
  const header = parseXml(await headerFile.async("string"), "header.xml");
  const section = parseXml(await sectionFile.async("string"), "section0.xml");
  const charPrs = new Map(elements(header, "charPr").map((element) => [Number(element.getAttribute("id")), element]));
  const paraPrs = new Map(elements(header, "paraPr").map((element) => [Number(element.getAttribute("id")), element]));
  const appliedRoles: DocumentStyleRole[] = [];

  const body = profile.roles.body;
  if (body) {
    applyCharacter(header, charPrs.get(0), body.character);
    applyCharacter(header, charPrs.get(1), body.character, { bold: true, italic: body.character?.italic });
    applyCharacter(header, charPrs.get(2), body.character, { bold: body.character?.bold, italic: true });
    applyCharacter(header, charPrs.get(3), body.character, { bold: true, italic: true });
    applyParagraph(paraPrs.get(0), body.paragraph);
    appliedRoles.push("body");
  }
  const roleTargets: Array<[DocumentStyleRole, number, number]> = [
    ["h1", 5, 1], ["h2", 6, 2], ["h3", 7, 3], ["h4", 8, 4],
    ["code", 4, 5], ["quote", 10, 6], ["list", 0, 7]
  ];
  for (const [role, charId, paraId] of roleTargets) {
    const style = profile.roles[role];
    if (!style) continue;
    if (role !== "list") applyCharacter(header, charPrs.get(charId), style.character);
    applyParagraph(paraPrs.get(paraId), style.paragraph);
    appliedRoles.push(role);
  }

  const extended = appendExtendedHeadingResources(header, charPrs, paraPrs, profile);
  for (const level of [5, 6] as const) {
    if (extended.has(level)) appliedRoles.push(`h${level}` as DocumentStyleRole);
  }
  applyExtendedHeadingMarkers(section, markers, extended);
  ensureNamedStyles(header, section, profile, extended);
  applyPage(section, profile.page);
  zip.file("Contents/header.xml", new XMLSerializer().serializeToString(header));
  zip.file("Contents/section0.xml", new XMLSerializer().serializeToString(section));
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  const data = await zip.generateAsync({ type: "arraybuffer" });
  return { data, profile, appliedRoles };
}

export function documentContentWidthHu(profile: DocumentStyleProfile | undefined): number | undefined {
  const page = profile?.page;
  if (!page) return undefined;
  return Math.max(1, page.widthHu - page.margins.left - page.margins.right);
}

/**
 * Project the semantic HWPX roles into the old HanMark cache shape. The bundled
 * Kordoc path does not consume this cache, but keeping it in sync prevents the
 * inherited preview/advanced UI from showing styles from blank.hwpx while the
 * active no-install profile came from another HWPX.
 */
export function legacyTemplateStyleCache(profile: DocumentStyleProfile): Record<string, Record<string, unknown>> {
  const normalized = normalizeDocumentStyleProfile(profile);
  const toLegacy = (role: RoleStyleProfile | undefined): Record<string, unknown> => {
    const character = role?.character;
    const paragraph = role?.paragraph;
    return {
      fontFamily: character?.fontFamily,
      fontSize_pt: character?.fontSizePt,
      bold: character?.bold ?? false,
      italic: character?.italic ?? false,
      underline: character?.underline ?? false,
      strikeout: false,
      textColor: character?.color || "#000000",
      charSpacing_pct: character?.letterSpacingPercent ?? 0,
      charWidth_pct: character?.widthPercent ?? 100,
      align: paragraph?.alignment?.toLowerCase() || "left",
      lineSpacingType: "PERCENT",
      lineSpacing_pct: paragraph?.lineSpacingPercent ?? 160,
      lineSpacing_pt: null,
      marginLeft_pt: (paragraph?.marginLeftHu ?? 0) / 100,
      marginRight_pt: (paragraph?.marginRightHu ?? 0) / 100,
      indent_pt: (paragraph?.firstLineIndentHu ?? 0) / 100,
      spacingBefore_pt: (paragraph?.spaceBeforeHu ?? 0) / 100,
      spacingAfter_pt: (paragraph?.spaceAfterHu ?? 0) / 100
    };
  };
  const body = toLegacy(normalized.roles.body);
  const h1 = toLegacy(normalized.roles.h1 || normalized.roles.body);
  const h2 = toLegacy(normalized.roles.h2 || normalized.roles.h1 || normalized.roles.body);
  const h3 = toLegacy(normalized.roles.h3 || normalized.roles.h2 || normalized.roles.body);
  const h4 = toLegacy(normalized.roles.h4 || normalized.roles.h3 || normalized.roles.body);
  const h5 = toLegacy(normalized.roles.h5 || normalized.roles.h4 || normalized.roles.body);
  const h6 = toLegacy(normalized.roles.h6 || normalized.roles.h5 || normalized.roles.h4 || normalized.roles.body);
  return {
    Normal: body,
    "Body Text": body,
    "First Paragraph": body,
    "Heading 1": h1,
    "Heading 2": h2,
    "Heading 3": h3,
    "Heading 4": h4,
    "Heading 5": h5,
    "Heading 6": h6
  };
}

export function legacyTemplatePageLayout(profile: DocumentStyleProfile): Record<string, number> | null {
  const page = normalizeDocumentStyleProfile(profile).page;
  if (!page) return null;
  return {
    width_pt: page.widthHu / 100,
    height_pt: page.heightHu / 100,
    marginLeft_pt: page.margins.left / 100,
    marginRight_pt: page.margins.right / 100,
    marginTop_pt: page.margins.top / 100,
    marginBottom_pt: page.margins.bottom / 100
  };
}

export function defaultDocumentStyleProfile(): DocumentStyleProfile {
  return {
    schemaVersion: 3,
    name: "직접 설정",
    roles: {
      body: {
        styleName: "바탕글",
        character: { fontFamily: "함초롬바탕", latinFontFamily: "Times New Roman", fontSizePt: 10, bold: false, italic: false, color: "#000000" },
        paragraph: { alignment: "JUSTIFY", lineSpacingPercent: 160, firstLineIndentHu: 0, marginLeftHu: 0, marginRightHu: 0, spaceBeforeHu: 0, spaceAfterHu: 0 }
      },
      h1: {
        styleName: "제목 1",
        character: { fontFamily: "함초롬돋움", latinFontFamily: "Arial", fontSizePt: 24, bold: true, italic: false, color: "#000000" },
        paragraph: { alignment: "CENTER", lineSpacingPercent: 160, spaceBeforeHu: 800, spaceAfterHu: 500, keepWithNext: true }
      },
      h2: {
        styleName: "제목 2",
        character: { fontFamily: "함초롬돋움", latinFontFamily: "Arial", fontSizePt: 18, bold: true, italic: false, color: "#000000" },
        paragraph: { alignment: "LEFT", lineSpacingPercent: 160, spaceBeforeHu: 600, spaceAfterHu: 300, keepWithNext: true }
      },
      h3: {
        styleName: "제목 3",
        character: { fontFamily: "함초롬돋움", latinFontFamily: "Arial", fontSizePt: 14, bold: true, italic: false, color: "#000000" },
        paragraph: { alignment: "LEFT", lineSpacingPercent: 160, spaceBeforeHu: 400, spaceAfterHu: 200, keepWithNext: true }
      },
      h4: {
        styleName: "제목 4",
        character: { fontFamily: "함초롬돋움", latinFontFamily: "Arial", fontSizePt: 12, bold: true, italic: false, color: "#000000" },
        paragraph: { alignment: "LEFT", lineSpacingPercent: 160, spaceBeforeHu: 300, spaceAfterHu: 100, keepWithNext: true }
      },
      h5: {
        styleName: "제목 5",
        character: { fontFamily: "함초롬돋움", latinFontFamily: "Arial", fontSizePt: 11, bold: true, italic: false, underline: false, color: "#000000" },
        paragraph: { alignment: "LEFT", lineSpacingPercent: 160, spaceBeforeHu: 300, spaceAfterHu: 100, keepWithNext: true }
      },
      h6: {
        styleName: "제목 6",
        character: { fontFamily: "함초롬돋움", latinFontFamily: "Arial", fontSizePt: 10, bold: true, italic: false, underline: false, color: "#000000" },
        paragraph: { alignment: "LEFT", lineSpacingPercent: 160, spaceBeforeHu: 300, spaceAfterHu: 100, keepWithNext: true }
      }
    },
    page: {
      widthHu: 59_528,
      heightHu: 84_188,
      landscape: "WIDELY",
      gutterType: "LEFT_ONLY",
      margins: { top: 8_504, bottom: 4_252, left: 5_670, right: 4_252, header: 2_835, footer: 2_835, gutter: 0 }
    }
  };
}

export function documentStyleSummary(profile: DocumentStyleProfile | undefined): string {
  if (!profile) return "문서 스타일 없음";
  const parts = [profile.name];
  for (const [label, role] of [
    ["본문", "body"],
    ["H1", "h1"],
    ["H2", "h2"],
    ["H3", "h3"],
    ["H4", "h4"],
    ["H5", "h5"],
    ["H6", "h6"]
  ] as const) {
    const character = profile.roles[role]?.character;
    if (character?.fontFamily || character?.fontSizePt) {
      parts.push(`${label} ${character.fontFamily || "기본"} ${character.fontSizePt || "?"}pt`);
    }
  }
  return parts.join(" · ");
}
