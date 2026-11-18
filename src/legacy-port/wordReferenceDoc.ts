import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import JSZip from "jszip";
import type { WordStyleId, WordStyleSpec, WordTemplateSpec } from "./wordTypes";

const WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export const WORD_STYLE_ID_MAP: Record<WordStyleId, string> = {
  Normal: "Normal",
  "Body Text": "BodyText",
  "First Paragraph": "FirstParagraph",
  Title: "Title",
  Subtitle: "Subtitle",
  "Heading 1": "Heading1",
  "Heading 2": "Heading2",
  "Heading 3": "Heading3",
  "Heading 4": "Heading4",
  "Heading 5": "Heading5",
  "Heading 6": "Heading6",
  "Block Text": "BlockText",
  "Source Code": "SourceCode",
  Caption: "Caption",
  "Table Caption": "TableCaption",
  "Image Caption": "ImageCaption",
  Hyperlink: "Hyperlink",
  "Verbatim Char": "VerbatimChar",
  Table: "TableNormal"
};

const LINKED_CHARACTER_STYLE: Partial<Record<WordStyleId, string>> = {
  "Body Text": "BodyTextChar",
  Title: "TitleChar",
  Subtitle: "SubtitleChar",
  "Heading 1": "Heading1Char",
  "Heading 2": "Heading2Char",
  "Heading 3": "Heading3Char",
  "Heading 4": "Heading4Char",
  "Heading 5": "Heading5Char",
  "Heading 6": "Heading6Char"
};

function twips(points: number): string {
  return String(Math.round(points * 20));
}

function halfPoints(points: number): string {
  return String(Math.round(points * 2));
}

function elements(root: Document | Element, tagName: string): Element[] {
  const nodes = root.getElementsByTagName(tagName);
  const result: Element[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes.item(index);
    if (node) result.push(node);
  }
  return result;
}

function firstElement(root: Document | Element, tagName: string): Element | null {
  return elements(root, tagName)[0] ?? null;
}

function findChild(parent: Node, tagName: string): Element | null {
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && node.nodeName === tagName) return node as Element;
  }
  return null;
}

function ensureChild(doc: Document, parent: Node, tagName: string): Element {
  const existing = findChild(parent, tagName);
  if (existing) return existing;
  const child = doc.createElementNS(WORD_NAMESPACE, tagName);
  parent.appendChild(child);
  return child;
}

function styleById(doc: Document, styleId: string): Element | null {
  return elements(doc, "w:style").find((style) => style.getAttribute("w:styleId") === styleId) ?? null;
}

function fontByName(doc: Document, family: string): Element | null {
  return elements(doc, "w:font").find((font) => font.getAttribute("w:name") === family) ?? null;
}

function setNamedChild(
  doc: Document,
  parent: Element,
  tagName: string,
  attribute: string,
  value?: string
): void {
  const current = findChild(parent, tagName);
  if (!value) {
    if (current?.parentNode) current.parentNode.removeChild(current);
    return;
  }
  const child = current ?? ensureChild(doc, parent, tagName);
  child.setAttribute(attribute, value);
}

function setOnOff(
  doc: Document,
  parent: Element,
  tagName: string,
  enabled: boolean | undefined
): void {
  const current = findChild(parent, tagName);
  if (!enabled) {
    if (current?.parentNode) current.parentNode.removeChild(current);
    return;
  }
  const child = current ?? ensureChild(doc, parent, tagName);
  child.setAttribute("w:val", "1");
}

function updateStyleMetadata(
  doc: Document,
  style: Element,
  spec: WordStyleSpec,
  styleId: string
): void {
  style.setAttribute(
    "w:type",
    spec.kind === "table" ? "table" : spec.kind === "character" ? "character" : "paragraph"
  );
  style.setAttribute("w:styleId", styleId);
  setNamedChild(doc, style, "w:name", "w:val", spec.displayName);
  setNamedChild(
    doc,
    style,
    "w:basedOn",
    "w:val",
    spec.basedOn ? WORD_STYLE_ID_MAP[spec.basedOn] : undefined
  );
  setNamedChild(
    doc,
    style,
    "w:next",
    "w:val",
    spec.nextStyle ? WORD_STYLE_ID_MAP[spec.nextStyle] : undefined
  );
  if (styleId === "Normal") style.setAttribute("w:default", "1");
  else style.removeAttribute("w:default");
}

function updateRunStyle(doc: Document, style: Element, spec: WordStyleSpec): void {
  const font = spec.font;
  if (!font) return;
  const runProperties = ensureChild(doc, style, "w:rPr");
  const fonts = ensureChild(doc, runProperties, "w:rFonts");
  for (const attribute of ["w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"]) {
    fonts.removeAttribute(attribute);
  }
  fonts.setAttribute("w:ascii", font.asciiFamily ?? font.family);
  fonts.setAttribute("w:hAnsi", font.hAnsiFamily ?? font.family);
  fonts.setAttribute("w:eastAsia", font.eastAsiaFamily ?? font.family);
  fonts.setAttribute("w:cs", font.csFamily ?? font.family);
  if (spec.id === "Hyperlink") {
    // A link takes the size of the text it stands in (body, footnote, caption, table cell).
    for (const name of ["w:sz", "w:szCs"]) {
      const own = findChild(runProperties, name);
      if (own) runProperties.removeChild(own);
    }
  } else {
    ensureChild(doc, runProperties, "w:sz").setAttribute("w:val", halfPoints(font.sizePt));
    ensureChild(doc, runProperties, "w:szCs").setAttribute("w:val", halfPoints(font.sizePt));
  }
  setOnOff(doc, runProperties, "w:b", font.bold);
  setOnOff(doc, runProperties, "w:bCs", font.bold);
  setOnOff(doc, runProperties, "w:i", font.italic);
  setOnOff(doc, runProperties, "w:iCs", font.italic);
  ensureChild(doc, runProperties, "w:u").setAttribute("w:val", font.underline);
  if (font.color && /^#?[0-9A-Fa-f]{6}$/.test(font.color)) {
    const color = ensureChild(doc, runProperties, "w:color");
    for (const attribute of ["w:themeColor", "w:themeTint", "w:themeShade"]) {
      color.removeAttribute(attribute);
    }
    color.setAttribute("w:val", font.color.replace(/^#/, ""));
  }
  if (font.charSpacingPt !== undefined) {
    ensureChild(doc, runProperties, "w:spacing")
      .setAttribute("w:val", twips(font.charSpacingPt));
  }
  if (font.widthScalePct !== undefined) {
    ensureChild(doc, runProperties, "w:w")
      .setAttribute("w:val", String(Math.round(font.widthScalePct)));
  }
}

function updateParagraphStyle(doc: Document, style: Element, spec: WordStyleSpec): void {
  const paragraph = spec.paragraph;
  if (!paragraph) return;
  const properties = ensureChild(doc, style, "w:pPr");
  ensureChild(doc, properties, "w:jc")
    .setAttribute("w:val", paragraph.align === "justify" ? "both" : paragraph.align);
  const spacing = ensureChild(doc, properties, "w:spacing");
  spacing.setAttribute("w:before", twips(paragraph.spacingBeforePt));
  spacing.setAttribute("w:after", twips(paragraph.spacingAfterPt));
  if (paragraph.lineSpacingMode === "single") {
    spacing.setAttribute("w:line", "240");
    spacing.setAttribute("w:lineRule", "auto");
  } else if (paragraph.lineSpacingMode === "multiple") {
    spacing.setAttribute("w:line", String(Math.round(paragraph.lineSpacingValue * 240)));
    spacing.setAttribute("w:lineRule", "auto");
  } else {
    spacing.setAttribute("w:line", twips(paragraph.lineSpacingValue));
    spacing.setAttribute(
      "w:lineRule",
      paragraph.lineSpacingMode === "atLeast" ? "atLeast" : "exact"
    );
  }
  const indent = ensureChild(doc, properties, "w:ind");
  indent.setAttribute("w:left", twips(paragraph.leftIndentPt));
  indent.setAttribute("w:right", twips(paragraph.rightIndentPt));
  indent.setAttribute("w:firstLine", twips(paragraph.firstLineIndentPt));
  setOnOff(doc, properties, "w:keepNext", paragraph.keepWithNext);
  setOnOff(doc, properties, "w:pageBreakBefore", paragraph.pageBreakBefore);
  setOnOff(doc, properties, "w:widowControl", paragraph.widowControl);
}

function ensureStyle(doc: Document, id: string, spec: WordStyleSpec): Element {
  const existing = styleById(doc, id);
  if (existing) return existing;
  const root = firstElement(doc, "w:styles");
  if (!root) throw new Error("reference.docx styles.xml does not contain w:styles.");
  const style = doc.createElementNS(WORD_NAMESPACE, "w:style");
  root.appendChild(style);
  updateStyleMetadata(doc, style, spec, id);
  return style;
}

function parseXml(xml: string, label: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (!doc?.documentElement || elements(doc, "parsererror").length) {
    throw new Error(`${label} is not valid XML.`);
  }
  return doc;
}

function serialize(doc: Document): string {
  return new XMLSerializer().serializeToString(doc);
}

// Child order of CT_Style, CT_PPr and CT_RPr (ECMA-376). Word reads elements in
// schema order; styles created from a template are sorted so a package built from
// HanMark's own base (R-031) is as valid as one patched into Pandoc's reference.
const STYLE_CHILD_ORDER = [
  "w:name", "w:aliases", "w:basedOn", "w:next", "w:link", "w:autoRedefine", "w:hidden", "w:uiPriority",
  "w:semiHidden", "w:unhideWhenUsed", "w:qFormat", "w:locked", "w:personal", "w:personalCompose",
  "w:personalReply", "w:rsid", "w:pPr", "w:rPr", "w:tblPr", "w:trPr", "w:tcPr", "w:tblStylePr"
];
const PARAGRAPH_PROPERTY_ORDER = [
  "w:pStyle", "w:keepNext", "w:keepLines", "w:pageBreakBefore", "w:framePr", "w:widowControl", "w:numPr",
  "w:suppressLineNumbers", "w:pBdr", "w:shd", "w:tabs", "w:suppressAutoHyphens", "w:kinsoku", "w:wordWrap",
  "w:overflowPunct", "w:topLinePunct", "w:autoSpaceDE", "w:autoSpaceDN", "w:bidi", "w:adjustRightInd",
  "w:snapToGrid", "w:spacing", "w:ind", "w:contextualSpacing", "w:mirrorIndents", "w:suppressOverlap", "w:jc",
  "w:textDirection", "w:textAlignment", "w:textboxTightWrap", "w:outlineLvl", "w:divId", "w:cnfStyle", "w:rPr",
  "w:sectPr", "w:pPrChange"
];
const RUN_PROPERTY_ORDER = [
  "w:rStyle", "w:rFonts", "w:b", "w:bCs", "w:i", "w:iCs", "w:caps", "w:smallCaps", "w:strike", "w:dstrike",
  "w:outline", "w:shadow", "w:emboss", "w:imprint", "w:noProof", "w:snapToGrid", "w:vanish", "w:webHidden",
  "w:color", "w:spacing", "w:w", "w:kern", "w:position", "w:sz", "w:szCs", "w:highlight", "w:u", "w:effect",
  "w:bdr", "w:shd", "w:fitText", "w:vertAlign", "w:rtl", "w:cs", "w:em", "w:lang", "w:eastAsianLayout",
  "w:specVanish", "w:oMath"
];

function sortChildren(parent: Element, order: readonly string[]): void {
  const children: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1) children.push(node as Element);
  }
  const rank = (element: Element): number => {
    const index = order.indexOf(element.nodeName);
    return index < 0 ? order.length : index;
  };
  const sorted = children
    .map((element, index) => ({ element, index }))
    .sort((left, right) => rank(left.element) - rank(right.element) || left.index - right.index);
  if (sorted.every((item, index) => item.element === children[index])) return;
  for (const item of sorted) parent.appendChild(item.element);
}

function sortStyleChildren(style: Element): void {
  sortChildren(style, STYLE_CHILD_ORDER);
  const paragraph = findChild(style, "w:pPr");
  if (paragraph) sortChildren(paragraph, PARAGRAPH_PROPERTY_ORDER);
  const run = findChild(style, "w:rPr");
  if (run) sortChildren(run, RUN_PROPERTY_ORDER);
}

/** Writes every style of the template into a styles.xml (creating missing ones). */
export function applyWordTemplateStyles(xml: string, template: WordTemplateSpec): string {
  const doc = parseXml(xml, "styles.xml");
  for (const [id, spec] of Object.entries(template.styles) as [WordStyleId, WordStyleSpec][]) {
    const styleId = WORD_STYLE_ID_MAP[id];
    const style = ensureStyle(doc, styleId, spec);
    updateStyleMetadata(doc, style, spec, styleId);
    updateRunStyle(doc, style, spec);
    updateParagraphStyle(doc, style, spec);
    const linkedId = LINKED_CHARACTER_STYLE[id];
    const linked = linkedId ? styleById(doc, linkedId) : null;
    if (linked) updateRunStyle(doc, linked, spec);
    sortStyleChildren(style);
    if (linked) sortStyleChildren(linked);
  }
  return serialize(doc);
}

/** Writes the template's page size and margins into the section of a document.xml. */
export function applyWordTemplatePage(xml: string, template: WordTemplateSpec): string {
  const doc = parseXml(xml, "document.xml");
  const body = firstElement(doc, "w:body");
  if (!body) return xml;
  const section = firstElement(body, "w:sectPr") ?? ensureChild(doc, body, "w:sectPr");
  const size = ensureChild(doc, section, "w:pgSz");
  size.setAttribute("w:w", twips(template.page.widthPt));
  size.setAttribute("w:h", twips(template.page.heightPt));
  size.setAttribute("w:orient", template.page.orientation);
  const margin = ensureChild(doc, section, "w:pgMar");
  margin.setAttribute("w:top", twips(template.page.marginTopPt));
  margin.setAttribute("w:right", twips(template.page.marginRightPt));
  margin.setAttribute("w:bottom", twips(template.page.marginBottomPt));
  margin.setAttribute("w:left", twips(template.page.marginLeftPt));
  margin.setAttribute("w:header", twips(template.page.headerDistancePt));
  margin.setAttribute("w:footer", twips(template.page.footerDistancePt));
  return serialize(doc);
}

/** Sets the language and compatibility mode every HanMark DOCX uses. */
export function applyWordSettings(xml: string): string {
  const doc = parseXml(xml, "settings.xml");
  const settings = firstElement(doc, "w:settings");
  if (!settings) return xml;
  const language = ensureChild(doc, settings, "w:themeFontLang");
  language.setAttribute("w:val", "en-US");
  language.setAttribute("w:eastAsia", "ko-KR");
  language.setAttribute("w:bidi", "ar-SA");
  const compat = ensureChild(doc, settings, "w:compat");
  const setting = ensureChild(doc, compat, "w:compatSetting");
  setting.setAttribute("w:name", "compatibilityMode");
  setting.setAttribute("w:uri", "http://schemas.microsoft.com/office/word");
  setting.setAttribute("w:val", "15");
  return serialize(doc);
}

/** Lists the template's font families in a fontTable.xml. */
export function applyWordTemplateFonts(xml: string, template: WordTemplateSpec): string {
  const doc = parseXml(xml, "fontTable.xml");
  const fonts = firstElement(doc, "w:fonts");
  if (!fonts) return xml;
  const families = new Set<string>();
  for (const style of Object.values(template.styles)) {
    const font = style.font;
    if (!font) continue;
    for (const family of [
      font.family,
      font.eastAsiaFamily,
      font.asciiFamily,
      font.hAnsiFamily,
      font.csFamily
    ]) {
      if (family) families.add(family);
    }
  }
  for (const family of families) {
    if (fontByName(doc, family)) continue;
    const font = doc.createElementNS(WORD_NAMESPACE, "w:font");
    font.setAttribute("w:name", family);
    fonts.appendChild(font);
  }
  return serialize(doc);
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Patches Pandoc's default reference.docx entirely in memory. */
export async function buildReferenceDocx(
  baseReferenceDocx: Uint8Array,
  template: WordTemplateSpec
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(asArrayBuffer(baseReferenceDocx));
  const styles = await zip.file("word/styles.xml")?.async("string");
  if (styles) zip.file("word/styles.xml", applyWordTemplateStyles(styles, template));
  const document = await zip.file("word/document.xml")?.async("string");
  if (document) zip.file("word/document.xml", applyWordTemplatePage(document, template));
  const settings = await zip.file("word/settings.xml")?.async("string");
  if (settings) zip.file("word/settings.xml", applyWordSettings(settings));
  const fontTable = await zip.file("word/fontTable.xml")?.async("string");
  if (fontTable) zip.file("word/fontTable.xml", applyWordTemplateFonts(fontTable, template));
  return zip.generateAsync({ type: "uint8array" });
}
