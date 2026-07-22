import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import * as nodePath from "node:path";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { parse, validateHwpx } from "kordoc";
import {
  applyDocumentStyleToHwpx,
  documentContentWidthHu,
  documentStyleSummary,
  extractDocumentStyleProfile,
  legacyTemplatePageLayout,
  legacyTemplateStyleCache,
  normalizeDocumentStyleProfile
} from "../src/io/documentStyle";
import { generateValidatedHwpx, renderQuickHwpxPreview } from "../src/io/kordocEngine";
import { builtInDocumentStyleProfile } from "../src/io/documentStylePresets";
import { resolveDocumentStyleFonts } from "../src/io/fontResolver";

const PNG_1X1 = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==", "base64")
);

function block(xml: string, tag: string, id: number): string {
  const match = new RegExp(`<hh:${tag}\\b[^>]*\\bid="${id}"[\\s\\S]*?</hh:${tag}>`).exec(xml);
  assert.ok(match, `${tag} ${id} must exist`);
  return match[0];
}

function xmlElements(root: Document | Element, name: string): Element[] {
  const all = root.getElementsByTagName("*");
  const matches: Element[] = [];
  for (let index = 0; index < all.length; index++) {
    const element = all.item(index);
    if (element && ((element as any).localName || element.nodeName.split(":").pop()) === name) matches.push(element);
  }
  return matches;
}

describe("no-install document style profiles", () => {
  for (const [filename, expectedBodyFont] of [
    ["blank.hwpx", "맑은 고딕"],
    ["한국언론학회 템플릿.hwpx", "한양신명조"],
    ["청소년학 템플릿.hwpx", "휴먼명조"],
    ["방송학회 템플릿.hwpx", "한양신명조"],
    ["AI융합연구원템플릿.hwpx", "맑은 고딕"]
  ] as const) {
    it(`round-trips the ${filename} named styles without copying foreign IDs`, async () => {
      const template = await readFile(nodePath.resolve(filename));
      const profile = await extractDocumentStyleProfile(template, filename);
      assert.equal(profile.roles.body?.character?.fontFamily, expectedBodyFont);
      assert.equal(profile.roles.body?.character?.underline, false);
      assert.ok(profile.roles.h1?.character?.fontSizePt);
      const generated = await generateValidatedHwpx("# 제목\n\n## 소제목\n\n본문입니다.\n", { documentStyle: profile });
      assert.equal(generated.validation.ok, true);
      assert.equal((await validateHwpx(generated.data)).ok, true);
      const parsed = await parse(generated.data);
      assert.equal(parsed.success, true);
    });
  }

  it("extracts semantic body, heading, paragraph, and page values from an edited HWPX", async () => {
    const templatePath = nodePath.resolve("AI융합연구원템플릿.hwpx");
    const bytes = await readFile(templatePath);
    const profile = await extractDocumentStyleProfile(bytes, nodePath.basename(templatePath));

    assert.equal(profile.name, "AI융합연구원템플릿.hwpx");
    assert.equal(profile.roles.body?.character?.fontFamily, "맑은 고딕");
    assert.equal(profile.roles.body?.character?.fontSizePt, 11);
    assert.equal(profile.roles.body?.paragraph?.marginLeftHu, 2000);
    assert.equal(profile.roles.body?.paragraph?.firstLineIndentHu, -1000);
    assert.equal(profile.roles.h1?.character?.fontSizePt, 14);
    assert.equal(profile.roles.h2?.character?.fontSizePt, 13);
    assert.equal(profile.roles.h2?.paragraph?.lineSpacingPercent, 200);
    assert.equal(profile.roles.h3?.paragraph?.marginLeftHu, 1000);
    assert.equal(profile.page?.margins.left, 7200);
    assert.equal(profile.page?.margins.right, 7200);
    assert.equal(documentContentWidthHu(profile), 45_130);
  });

  it("keeps HWPX NONE underlines off and resolves Hancom font aliases in the live preview", async () => {
    const template = await readFile(nodePath.resolve("한국언론학회 템플릿.hwpx"));
    const profile = await extractDocumentStyleProfile(template, "한국언론학회");
    assert.equal(profile.roles.body?.character?.fontFamily, "한양신명조");
    assert.equal(profile.roles.body?.character?.underline, false);
    assert.equal(profile.roles.h1?.character?.underline, false);

    const preview = await renderQuickHwpxPreview("# 제목\n\n본문과 **강조**입니다.\n", { documentStyle: profile });
    assert.match(preview.render.svg, /HYSinMyeongJo/);
    assert.doesNotMatch(preview.render.svg, /text-decoration="underline"/);
  });

  it("uses the actual Korean Communication Association HWPX for every visible role and legacy cache", async () => {
    const template = await readFile(nodePath.resolve("한국언론학회 템플릿.hwpx"));
    const profile = await extractDocumentStyleProfile(template, "한국언론학회 템플릿.hwpx");

    assert.equal(profile.roles.body?.character?.fontFamily, "한양신명조");
    assert.equal(profile.roles.body?.character?.fontSizePt, 10);
    assert.equal(profile.roles.h1?.character?.fontFamily, "맑은 고딕");
    assert.equal(profile.roles.h1?.character?.fontSizePt, 14);
    assert.equal(profile.roles.h2?.character?.fontFamily, "HY견고딕");
    assert.equal(profile.roles.h2?.character?.fontSizePt, 10);
    assert.equal(profile.roles.h3?.character?.fontFamily, "맑은 고딕");
    assert.equal(profile.roles.h3?.character?.fontSizePt, 10);
    assert.equal(profile.roles.h4?.character?.fontFamily, "한양신명조");
    assert.equal(profile.roles.h4?.character?.fontSizePt, 10);

    const summary = documentStyleSummary(profile);
    assert.match(summary, /본문 한양신명조 10pt/);
    assert.match(summary, /H1 맑은 고딕 14pt/);
    assert.match(summary, /H2 HY견고딕 10pt/);
    assert.match(summary, /H3 맑은 고딕 10pt/);
    assert.match(summary, /H4 한양신명조 10pt/);

    const legacy = legacyTemplateStyleCache(profile);
    assert.equal(legacy.Normal.fontFamily, "한양신명조");
    assert.equal(legacy["Heading 1"].fontFamily, "맑은 고딕");
    assert.equal(legacy["Heading 2"].fontFamily, "HY견고딕");
    assert.equal(legacy["Heading 3"].fontFamily, "맑은 고딕");
    assert.equal(legacy["Heading 4"].fontFamily, "한양신명조");
    assert.deepEqual(legacyTemplatePageLayout(profile), {
      width_pt: 595.3,
      height_pt: 841.9,
      marginLeft_pt: 72,
      marginRight_pt: 72,
      marginTop_pt: 42.55,
      marginBottom_pt: 49.6
    });

    const generated = await generateValidatedHwpx(
      "# H1\n\n## H2\n\n### H3\n\n#### H4\n\n본문입니다.\n",
      { documentStyle: profile }
    );
    const roundTripped = await extractDocumentStyleProfile(generated.data, "결과");
    assert.equal(roundTripped.roles.body?.character?.fontFamily, "한양신명조");
    assert.equal(roundTripped.roles.h1?.character?.fontFamily, "맑은 고딕");
    assert.equal(roundTripped.roles.h2?.character?.fontFamily, "HY견고딕");
    assert.equal(roundTripped.roles.h3?.character?.fontFamily, "맑은 고딕");
    assert.equal(roundTripped.roles.h4?.character?.fontFamily, "한양신명조");
  });

  it("warns when an exact imported H1 style cannot be used because Markdown starts at H2", async () => {
    const template = await readFile(nodePath.resolve("한국언론학회 템플릿.hwpx"));
    const profile = await extractDocumentStyleProfile(template, "한국언론학회 템플릿.hwpx");
    const generated = await generateValidatedHwpx("## 실제 첫 제목\n\n본문입니다.\n", { documentStyle: profile });
    assert.ok(generated.warnings.some((warning) => warning.code === "document-style-level-unused"));
    assert.equal(generated.validation.ok, true);
  });

  it("migrates the 2.2.0 importer underline bug without disabling explicit v2 underlines", () => {
    const legacy = normalizeDocumentStyleProfile({
      schemaVersion: 1,
      name: "구버전",
      roles: { body: { character: { fontFamily: "함초롬바탕", underline: true } } }
    });
    assert.equal(legacy.schemaVersion, 3);
    assert.equal(legacy.roles.body?.character?.underline, false);

    const current = normalizeDocumentStyleProfile({
      schemaVersion: 2,
      name: "현재 버전",
      roles: {
        body: { character: { fontFamily: "함초롬바탕", underline: true } },
        h4: { styleName: "제목 4", character: { fontFamily: "함초롬돋움", fontSizePt: 11 } }
      }
    });
    assert.equal(current.roles.body?.character?.underline, true);
    assert.equal(current.roles.h5?.character?.fontFamily, "함초롬돋움");
    assert.equal(current.roles.h5?.styleName, "제목 5");
    assert.equal(current.roles.h6?.styleName, "제목 6");
  });

  it("defines the verified Korean Communication and Youth Studies presets with H1 through H6", () => {
    const communication = builtInDocumentStyleProfile("korean-communication")!;
    assert.equal(communication.schemaVersion, 3);
    assert.equal(communication.roles.body?.character?.fontFamily, "신명조");
    assert.equal(communication.roles.body?.character?.widthPercent, 95);
    assert.equal(communication.roles.body?.character?.letterSpacingPercent, -10);
    assert.equal(communication.roles.body?.paragraph?.lineSpacingPercent, 160);
    assert.equal(communication.roles.body?.paragraph?.firstLineIndentHu, 1000);
    assert.equal(communication.roles.h1?.character?.fontFamily, "맑은 고딕");
    assert.equal(communication.roles.h2?.character?.fontFamily, "HY견고딕");
    assert.equal(communication.roles.h4?.character?.fontFamily, "신명조");
    assert.equal(communication.roles.h5?.character?.fontFamily, "휴먼명조");
    assert.equal(communication.roles.h5?.character?.fontSizePt, 13);
    assert.equal(communication.roles.h6?.character?.fontFamily, "맑은 고딕");
    assert.equal(communication.page?.margins.left, 7200);

    const youth = builtInDocumentStyleProfile("youth-studies")!;
    for (const role of ["body", "h1", "h2", "h3", "h4", "h5"] as const) {
      assert.equal(youth.roles[role]?.character?.fontFamily, "휴먼명조");
      assert.equal(youth.roles[role]?.character?.underline, false);
    }
    assert.equal(youth.roles.body?.paragraph?.lineSpacingPercent, 170);
    assert.equal(youth.roles.h6?.character?.fontFamily, "맑은 고딕");
  });

  it("preserves H5 and H6 as independent named HWPX styles without leaking markers", async () => {
    const profile = builtInDocumentStyleProfile("korean-communication")!;
    const markdown = "# H1\n\n#### H4\n\n##### H5 제목\n\n###### H6 제목\n\n본문\n";
    const generated = await generateValidatedHwpx(markdown, {
      documentStyle: profile,
      fontResolver: { platform: "win32", available: () => true }
    });
    const archive = await JSZip.loadAsync(generated.data);
    const header = await archive.file("Contents/header.xml")!.async("string");
    const section = await archive.file("Contents/section0.xml")!.async("string");

    const h5Style = /<hh:style\b[^>]*engName="Heading 5"[^>]*paraPrIDRef="(\d+)"[^>]*charPrIDRef="(\d+)"/.exec(header);
    const h6Style = /<hh:style\b[^>]*engName="Heading 6"[^>]*paraPrIDRef="(\d+)"[^>]*charPrIDRef="(\d+)"/.exec(header);
    assert.ok(h5Style);
    assert.ok(h6Style);
    assert.notEqual(h5Style[1], "4");
    assert.notEqual(h6Style[1], h5Style[1]);
    assert.notEqual(h6Style[2], h5Style[2]);
    const charIds = [...header.matchAll(/<hh:charPr\b[^>]*\bid="(\d+)"/g)].map((match) => match[1]);
    const paraIds = [...header.matchAll(/<hh:paraPr\b[^>]*\bid="(\d+)"/g)].map((match) => match[1]);
    assert.equal(new Set(charIds).size, charIds.length);
    assert.equal(new Set(paraIds).size, paraIds.length);
    assert.match(header, new RegExp(`<hh:charProperties\\b[^>]*itemCnt="${charIds.length}"`));
    assert.match(header, new RegExp(`<hh:paraProperties\\b[^>]*itemCnt="${paraIds.length}"`));
    assert.match(section, new RegExp(`<hp:p\\b[^>]*paraPrIDRef="${h5Style[1]}"[^>]*styleIDRef="5"[^>]*>[\\s\\S]*?<hp:t>H5 제목</hp:t>`));
    assert.match(section, new RegExp(`<hp:p\\b[^>]*paraPrIDRef="${h6Style[1]}"[^>]*styleIDRef="6"[^>]*>[\\s\\S]*?<hp:t>H6 제목</hp:t>`));
    assert.doesNotMatch(section, /HANMARK_EXTENDED_HEADING|\uE000|\uE001/);

    const roundTrip = await extractDocumentStyleProfile(generated.data, "내장 프리셋 결과");
    assert.equal(roundTrip.roles.h5?.character?.fontFamily, "휴먼명조");
    assert.equal(roundTrip.roles.h5?.character?.fontSizePt, 13);
    assert.equal(roundTrip.roles.h6?.character?.fontFamily, "맑은 고딕");
    assert.equal((await validateHwpx(generated.data)).ok, true);
  });

  it("writes Hancom-editable F6 styles with one shared font ID across every language table", async () => {
    const profile = builtInDocumentStyleProfile("korean-communication")!;
    const generated = await generateValidatedHwpx(
      "# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n\n본문\n",
      { documentStyle: profile, fontResolver: { platform: "win32", available: () => true } }
    );
    const archive = await JSZip.loadAsync(generated.data);
    const headerXml = await archive.file("Contents/header.xml")!.async("string");
    const header = new DOMParser().parseFromString(headerXml, "application/xml");
    const fontfaces = xmlElements(header, "fontface");
    assert.deepEqual(
      fontfaces.map((group) => group.getAttribute("lang")).sort(),
      ["HANGUL", "HANJA", "JAPANESE", "LATIN", "OTHER", "SYMBOL", "USER"].sort()
    );

    for (const group of fontfaces) {
      const fonts = xmlElements(group, "font");
      const ids = fonts.map((font) => Number(font.getAttribute("id"))).sort((left, right) => left - right);
      assert.equal(group.getAttribute("fontCnt"), String(fonts.length));
      assert.deepEqual(ids, Array.from({ length: fonts.length }, (_, index) => index));
    }

    const expectedFaces: Record<string, string> = {
      Normal: "한양신명조",
      "Heading 1": "맑은 고딕",
      "Heading 2": "HY견고딕",
      "Heading 3": "맑은 고딕",
      "Heading 4": "한양신명조",
      "Heading 5": "휴먼명조",
      "Heading 6": "맑은 고딕"
    };
    const charPrs = new Map(xmlElements(header, "charPr").map((element) => [element.getAttribute("id"), element]));
    for (const style of xmlElements(header, "style").filter((item) => item.getAttribute("engName") in expectedFaces)) {
      assert.equal(style.getAttribute("langID"), "1042");
      assert.equal(style.hasAttribute("langIDRef"), false);
      assert.equal(style.getAttribute("type"), "PARA");
      assert.equal(style.getAttribute("lockForm"), "0");
      const charPr = charPrs.get(style.getAttribute("charPrIDRef"));
      assert.ok(charPr, `${style.getAttribute("engName")} charPr must exist`);
      const fontRef = xmlElements(charPr, "fontRef")[0];
      assert.ok(fontRef);
      const fontIds = ["hangul", "latin", "hanja", "japanese", "other", "symbol", "user"]
        .map((script) => fontRef.getAttribute(script));
      assert.equal(new Set(fontIds).size, 1, `${style.getAttribute("engName")} must not be a mixed font`);
      const sharedId = fontIds[0];
      for (const group of fontfaces) {
        const face = xmlElements(group, "font").find((font) => font.getAttribute("id") === sharedId)?.getAttribute("face");
        assert.equal(face, expectedFaces[style.getAttribute("engName")]);
      }
    }
  });

  it("keeps a logical Hancom font when an installed alias exists and substitutes truly missing fonts", async () => {
    const profile = builtInDocumentStyleProfile("korean-communication")!;
    const availableAliases = new Set(["HY신명조", "맑은 고딕", "HY견고딕"]);
    const resolved = await resolveDocumentStyleFonts(profile, {
      platform: "win32",
      available: (family) => availableAliases.has(family)
    });
    assert.equal(resolved.profile.roles.body?.character?.fontFamily, "신명조");
    assert.equal(resolved.profile.roles.h4?.character?.fontFamily, "신명조");
    assert.equal(resolved.profile.roles.h5?.character?.fontFamily, "바탕");
    assert.ok(resolved.substitutions.some((item) => item.requested === "휴먼명조" && item.replacement === "바탕"));

    const mac = await resolveDocumentStyleFonts(builtInDocumentStyleProfile("youth-studies")!, {
      platform: "darwin",
      available: () => false
    });
    assert.equal(mac.profile.roles.body?.character?.fontFamily, "AppleMyungjo");
    assert.equal(mac.profile.roles.h6?.character?.fontFamily, "Apple SD Gothic Neo");
  });

  it("applies imported styles to stable Kordoc roles and keeps the package parseable", async () => {
    const template = await readFile(nodePath.resolve("AI융합연구원템플릿.hwpx"));
    const profile = await extractDocumentStyleProfile(template, "AI융합연구원");
    const markdown = `# 첫째\n\n## 둘째\n\n### 셋째\n\n#### 넷째\n\n##### 다섯째\n\n본문과 **굵은 본문**입니다.\n`;
    const generated = await generateValidatedHwpx(markdown, { documentStyle: profile });

    assert.equal(generated.validation.ok, true);
    assert.equal(generated.documentStyleName, "AI융합연구원");
    const archive = await JSZip.loadAsync(generated.data);
    const header = await archive.file("Contents/header.xml")!.async("string");
    const section = await archive.file("Contents/section0.xml")!.async("string");
    assert.match(header, /face="맑은 고딕"/);
    assert.match(block(header, "charPr", 0), /height="1100"/);
    assert.match(block(header, "charPr", 5), /height="1400"/);
    assert.match(block(header, "charPr", 6), /height="1300"/);
    assert.match(block(header, "charPr", 7), /height="1100"/);
    assert.match(block(header, "charPr", 8), /height="1100"/);
    assert.match(block(header, "paraPr", 0), /<hc:left value="2000"/);
    assert.match(block(header, "paraPr", 0), /<hc:intent value="-1000"/);
    assert.match(block(header, "paraPr", 2), /<hh:lineSpacing type="PERCENT" value="200"/);
    assert.match(header, /<hh:style\b[^>]*id="1"[^>]*engName="Heading 1"/);
    assert.match(section, /<hp:p\b[^>]*paraPrIDRef="1"[^>]*styleIDRef="1"[^>]*>[\s\S]*?<hp:t>첫째<\/hp:t>/);
    assert.match(section, /<hp:pagePr\b[^>]*width="59530"[^>]*height="84190"/);
    assert.match(section, /<hp:margin\b[^>]*left="7200"[^>]*right="7200"/);

    const reparsed = await parse(generated.data);
    assert.equal(reparsed.success, true);
    if (reparsed.success) {
      assert.match(reparsed.markdown, /첫째/);
      assert.match(reparsed.markdown, /굵은 본문/);
    }
    assert.equal((await validateHwpx(generated.data)).ok, true);
  });

  it("preserves embedded images and renders them with an imported document style", async () => {
    const template = await readFile(nodePath.resolve("청소년학 템플릿.hwpx"));
    const profile = await extractDocumentStyleProfile(template, "청소년학");
    const markdown = "# 이미지 문서\n\n![스크린샷](https://images.example/screenshot.png)\n";
    const options = {
      documentStyle: profile,
      images: { loader: async () => ({ data: PNG_1X1 }) }
    };
    const generated = await generateValidatedHwpx(markdown, options);
    assert.equal(generated.embeddedImageCount, 1);
    assert.equal(generated.validation.ok, true);
    const archive = await JSZip.loadAsync(generated.data);
    assert.ok(archive.file("BinData/hanmark_image_001.png"));
    const section = await archive.file("Contents/section0.xml")!.async("string");
    assert.match(section, /<hp:pic\b/);

    const preview = await renderQuickHwpxPreview(markdown, options);
    assert.equal(preview.render.stats.images, 1);
    assert.match(preview.render.svg, /data:image\/png;base64,/);
  });

  it("sanitizes persisted profiles instead of accepting raw XML or unsafe numeric values", async () => {
    const normalized = normalizeDocumentStyleProfile({
      name: "  테스트\u0000 스타일  ",
      roles: {
        body: {
          character: { fontFamily: "맑은\u0001 고딕", fontSizePt: 999, color: "red" },
          paragraph: { lineSpacingPercent: 999, marginLeftHu: -50 }
        }
      }
    });
    assert.equal(normalized.name, "테스트 스타일");
    assert.equal(normalized.roles.body?.character?.fontFamily, "맑은 고딕");
    assert.equal(normalized.roles.body?.character?.fontSizePt, 100);
    assert.equal(normalized.roles.body?.character?.color, undefined);
    assert.equal(normalized.roles.body?.paragraph?.lineSpacingPercent, 400);
    assert.equal(normalized.roles.body?.paragraph?.marginLeftHu, 0);

    const plain = await generateValidatedHwpx("# 안전\n\n본문\n");
    const styled = await applyDocumentStyleToHwpx(plain.data, normalized);
    assert.equal((await validateHwpx(styled.data)).ok, true);
  });
});
