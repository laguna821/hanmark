import {
  WORD_STYLE_IDS,
  cloneWordTemplate,
  type WordFontSpec,
  type WordPageSpec,
  type WordParagraphSpec,
  type WordStyleId,
  type WordStyleSpec,
  type WordTemplateSpec
} from "./wordTypes";

function defaultFont(): WordFontSpec {
  return {
    family: "Malgun Gothic",
    eastAsiaFamily: "Malgun Gothic",
    asciiFamily: "Calibri",
    hAnsiFamily: "Calibri",
    csFamily: "Calibri",
    sizePt: 11,
    bold: false,
    italic: false,
    underline: "none",
    color: "#000000",
    charSpacingPt: 0,
    widthScalePct: 100
  };
}

function defaultParagraph(overrides: Partial<WordParagraphSpec> = {}): WordParagraphSpec {
  return {
    align: "left",
    lineSpacingMode: "multiple",
    lineSpacingValue: 1.5,
    leftIndentPt: 0,
    rightIndentPt: 0,
    firstLineIndentPt: 0,
    spacingBeforePt: 0,
    spacingAfterPt: 6,
    keepWithNext: false,
    pageBreakBefore: false,
    widowControl: true,
    ...overrides
  };
}

function styleKind(id: WordStyleId): WordStyleSpec["kind"] {
  if (id === "Table") return "table";
  if (id === "Hyperlink" || id === "Verbatim Char") return "character";
  return "paragraph";
}

function createStyle(id: WordStyleId): WordStyleSpec {
  return {
    id,
    displayName: id,
    basedOn: id === "Normal" ? undefined : "Normal",
    nextStyle: id === "Title" ? "Subtitle" : "Body Text",
    kind: styleKind(id),
    font: defaultFont(),
    paragraph: styleKind(id) === "paragraph" ? defaultParagraph() : undefined
  };
}

function fontWith(overrides: Partial<WordFontSpec>): WordFontSpec {
  return { ...defaultFont(), ...overrides };
}

export function createDefaultWordPage(): WordPageSpec {
  return {
    widthPt: 595.3,
    heightPt: 841.9,
    orientation: "portrait",
    marginTopPt: 72,
    marginRightPt: 72,
    marginBottomPt: 72,
    marginLeftPt: 72,
    headerDistancePt: 36,
    footerDistancePt: 36
  };
}

export function createDefaultWordTemplate(): WordTemplateSpec {
  const styles = Object.fromEntries(
    WORD_STYLE_IDS.map((id) => [id, createStyle(id)])
  ) as Record<WordStyleId, WordStyleSpec>;

  styles.Normal.paragraph = defaultParagraph({ align: "justify" });
  styles["First Paragraph"].paragraph = defaultParagraph({ spacingAfterPt: 10 });
  styles.Title.font = fontWith({ sizePt: 20, bold: true });
  styles.Title.paragraph = defaultParagraph({ align: "center", spacingAfterPt: 12 });
  styles.Subtitle.font = fontWith({ sizePt: 13, italic: true, color: "#555555" });
  styles.Subtitle.paragraph = defaultParagraph({ align: "center", spacingAfterPt: 12 });

  const headingSizes = [18, 16, 14, 13, 12, 11] as const;
  for (let index = 0; index < headingSizes.length; index += 1) {
    const id = `Heading ${index + 1}` as WordStyleId;
    styles[id].font = fontWith({ sizePt: headingSizes[index], bold: true });
    styles[id].paragraph = defaultParagraph({
      spacingBeforePt: 18 - index * 2,
      spacingAfterPt: index < 2 ? 8 : index < 4 ? 6 : 4,
      keepWithNext: true
    });
  }

  styles["Block Text"].paragraph = defaultParagraph({
    leftIndentPt: 18,
    rightIndentPt: 18,
    spacingBeforePt: 6,
    spacingAfterPt: 6
  });
  styles["Source Code"].font = fontWith({
    family: "Consolas",
    eastAsiaFamily: "D2Coding",
    asciiFamily: "Consolas",
    hAnsiFamily: "Consolas",
    csFamily: "Consolas",
    sizePt: 10
  });
  styles["Source Code"].paragraph = defaultParagraph({
    leftIndentPt: 12,
    rightIndentPt: 12,
    spacingBeforePt: 6,
    spacingAfterPt: 6
  });
  for (const id of ["Caption", "Table Caption", "Image Caption"] as const) {
    styles[id].font = fontWith({ sizePt: 10, italic: true, color: "#555555" });
    styles[id].paragraph = defaultParagraph({
      align: "center",
      spacingBeforePt: 4,
      spacingAfterPt: 8
    });
  }
  styles.Hyperlink.font = fontWith({
    color: "#0563C1",
    underline: "single"
  });
  styles["Verbatim Char"].font = fontWith({
    family: "Consolas",
    eastAsiaFamily: "D2Coding",
    asciiFamily: "Consolas",
    hAnsiFamily: "Consolas",
    csFamily: "Consolas",
    sizePt: 10
  });
  styles.Table.font = fontWith({ sizePt: 10 });

  return {
    version: 1,
    id: "default",
    name: "Default",
    page: createDefaultWordPage(),
    styles,
    previewMode: "fast-docx"
  };
}

export function duplicateWordTemplate(
  template: WordTemplateSpec,
  id: string,
  name: string
): WordTemplateSpec {
  const clone = cloneWordTemplate(template);
  clone.id = id;
  clone.name = name.trim();
  return clone;
}
