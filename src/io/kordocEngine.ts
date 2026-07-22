import {
  markdownToHwpx,
  renderHwpxToSvg,
  validateHwpx,
  type FormatProfile,
  type GongmunOptions,
  type RenderSvgResult,
  type ValidateResult
} from "kordoc";
import { adaptMarkdownForKordoc, type AdapterWarning, type MarkdownAdapterResult } from "./markdownAdapter";
import {
  hydrateKordocImages,
  ImageResolutionError,
  resolveMarkdownImages,
  rewriteMarkdownForResolvedImages,
  type ImageFailure,
  type ImagePipelineOptions,
  type ResolvedImageAsset
} from "./imageAssets";
import {
  applyDocumentStyleToHwpx,
  documentContentWidthHu,
  type DocumentStyleProfile,
  type ExtendedHeadingMarker
} from "./documentStyle";
import {
  fontSubstitutionSummary,
  resolveDocumentStyleFonts,
  type FontResolverOptions,
  type FontSubstitution
} from "./fontResolver";

export interface GenerateHwpxOptions {
  gongmun?: GongmunOptions;
  profile?: FormatProfile;
  documentStyle?: DocumentStyleProfile;
  fontResolver?: FontResolverOptions;
  images?: ImagePipelineOptions & { allowFailures?: boolean };
}

export interface GeneratedHwpx {
  data: ArrayBuffer;
  adaptedMarkdown: string;
  warnings: AdapterWarning[];
  /** Unique image sources found in the adapted Markdown. */
  imageCount: number;
  /** Unique image binaries actually embedded in BinData. */
  embeddedImageCount: number;
  /** hp:pic occurrences; one binary can be placed more than once. */
  embeddedImageOccurrences: number;
  imageFailures: ImageFailure[];
  documentStyleName?: string;
  fontSubstitutions: FontSubstitution[];
  validation: ValidateResult;
}

export class HwpxValidationError extends Error {
  constructor(public readonly validation: ValidateResult) {
    super(
      `생성된 HWPX 구조 검증 실패: ${validation.issues
        .slice(0, 5)
        .map((issue) => `${issue.path ? issue.path + ": " : ""}${issue.message}`)
        .join(" / ")}`
    );
    this.name = "HwpxValidationError";
  }
}

// Some Hancom/HWP face names differ from the family names exposed to Chromium.
// Keep the HWPX face untouched, but add the local CSS family while previewing.
const PREVIEW_FONT_ALIASES: Record<string, string[]> = {
  "한양신명조": ["HYSinMyeongJo-Medium", "HYSinMyeongJo", "HY신명조", "신명조"],
  "신명조": ["HYSinMyeongJo-Medium", "HYSinMyeongJo", "HY신명조", "한양신명조"],
  "HY신명조": ["HYSinMyeongJo-Medium", "HYSinMyeongJo"],
  "HY견고딕": ["HYGothic-Extra"],
  "한양견고딕": ["HYGothic-Extra", "HY견고딕"],
  "HY중고딕": ["HYGothic"],
  "한양중고딕": ["HYGothic", "HY중고딕"],
  "HY견명조": ["HYMyeongJo-Extra"],
  "한양견명조": ["HYMyeongJo-Extra", "HY견명조"],
  "휴먼명조": ["Human Myeongjo", "HumanMyungjo"],
  "맑은 고딕": ["Malgun Gothic"]
};

export function addPreviewFontAliases(svg: string): string {
  return svg.replace(/font-family="([^"]*)"/g, (_attribute, familyList: string) => {
    const expanded = familyList.replace(/'([^']+)'/g, (token, family: string) => {
      const aliases = PREVIEW_FONT_ALIASES[family];
      if (!aliases?.length) return token;
      return [family, ...aliases].map((name) => `'${name}'`).join(",");
    });
    return `font-family="${expanded}"`;
  });
}

function markdownHeadingLevels(markdown: string): Set<number> {
  const levels = new Set<number>();
  let fence: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = /^\s{0,3}(#{1,6})(?:\s+|$)/.exec(line);
    if (heading) levels.add(heading[1].length);
  }
  return levels;
}

export function markExtendedHeadings(
  markdown: string,
  profile: DocumentStyleProfile | undefined
): { markdown: string; markers: ExtendedHeadingMarker[] } {
  if (!profile?.roles.h5 && !profile?.roles.h6) return { markdown, markers: [] };
  let nonce = "HANMARK_EXTENDED_HEADING";
  while (markdown.includes(nonce)) nonce += "_";
  const markers: ExtendedHeadingMarker[] = [];
  let fence: string | null = null;
  const lines = markdown.split(/\r?\n/).map((line) => {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const character = fenceMatch[1][0];
      if (!fence) fence = character;
      else if (fence === character) fence = null;
      return line;
    }
    if (fence) return line;
    const match = /^(\s{0,3})(#{5,6})([ \t]+)(.*)$/.exec(line);
    if (!match) return line;
    const level = match[2].length as 5 | 6;
    if (!profile.roles[`h${level}` as "h5" | "h6"]) return line;
    const token = `\uE000${nonce}_${level}_${markers.length}\uE001`;
    markers.push({ token, level });
    return `${match[1]}${match[2]}${match[3]}${token}${match[4]}`;
  });
  return { markdown: lines.join("\n"), markers };
}

export async function generateValidatedHwpx(
  sourceMarkdown: string,
  options: GenerateHwpxOptions = {}
): Promise<GeneratedHwpx> {
  const adapted = adaptMarkdownForKordoc(sourceMarkdown);
  return generateValidatedHwpxFromAdapted(adapted, options);
}

async function generateKordocPackage(
  markdown: string,
  options: GenerateHwpxOptions,
  assets: ResolvedImageAsset[]
): Promise<{ data: ArrayBuffer; placedAssets: ResolvedImageAsset[]; placedOccurrences: number; failures: ImageFailure[] }> {
  const raw = await markdownToHwpx(markdown, {
    gongmun: options.gongmun,
    profile: options.profile
  });
  const hydrated = await hydrateKordocImages(raw, assets);
  return {
    data: hydrated.data,
    placedAssets: hydrated.placedAssets,
    placedOccurrences: hydrated.placedOccurrences,
    failures: hydrated.failures
  };
}

export async function generateValidatedHwpxFromAdapted(
  adapted: MarkdownAdapterResult,
  options: GenerateHwpxOptions = {}
): Promise<GeneratedHwpx> {
  let markdown = adapted.markdown;
  let assets: ResolvedImageAsset[] = [];
  let imageFailures: ImageFailure[] = [];
  let headingMarkers: ExtendedHeadingMarker[] = [];

  if (adapted.imageCount > 0) {
    if (!options.images?.loader) {
      throw new ImageResolutionError(
        [{
          source: "",
          alt: "문서 이미지",
          occurrences: adapted.imageCount,
          stage: "resolve",
          message: "이미지를 읽을 HanMark 로더가 연결되지 않았습니다."
        }],
        0,
        adapted.imageCount
      );
    }
    const styleWidth = documentContentWidthHu(options.documentStyle);
    const resolution = await resolveMarkdownImages(markdown, {
      ...options.images,
      maxDisplayWidthHu:
        styleWidth === undefined
          ? options.images.maxDisplayWidthHu
          : Math.min(options.images.maxDisplayWidthHu ?? styleWidth, styleWidth)
    });
    assets = resolution.assets;
    imageFailures = resolution.failures;
    if (imageFailures.length && !options.images.allowFailures) {
      throw new ImageResolutionError(imageFailures, assets.length, resolution.references.length);
    }
    markdown = rewriteMarkdownForResolvedImages(markdown, assets, new Set(imageFailures.map((item) => item.source)));
  }

  const generateCurrentPackage = async () => {
    const marked = markExtendedHeadings(markdown, options.documentStyle);
    headingMarkers = marked.markers;
    return generateKordocPackage(marked.markdown, options, assets);
  };

  let generated = await generateCurrentPackage();
  if (generated.failures.length) {
    if (!options.images?.allowFailures) {
      throw new ImageResolutionError(
        [...imageFailures, ...generated.failures],
        generated.placedAssets.length,
        adapted.imageCount
      );
    }

    imageFailures = [...imageFailures, ...generated.failures];
    const failedSources = new Set(imageFailures.map((item) => item.source));
    assets = assets.filter((asset) => !failedSources.has(asset.source));
    markdown = rewriteMarkdownForResolvedImages(adapted.markdown, assets, failedSources);
    generated = await generateCurrentPackage();
    if (generated.failures.length) {
      throw new ImageResolutionError(
        [...imageFailures, ...generated.failures],
        generated.placedAssets.length,
        adapted.imageCount
      );
    }
  }

  let finalData = generated.data;
  let documentStyleName: string | undefined;
  let fontSubstitutions: FontSubstitution[] = [];
  if (options.documentStyle) {
    const resolved = await resolveDocumentStyleFonts(options.documentStyle, options.fontResolver);
    fontSubstitutions = resolved.substitutions;
    const styled = await applyDocumentStyleToHwpx(finalData, resolved.profile, headingMarkers);
    finalData = styled.data;
    documentStyleName = styled.profile.name;
  }

  const validation = await validateHwpx(finalData);
  if (!validation.ok) throw new HwpxValidationError(validation);
  const warnings = [...adapted.warnings];
  if (options.documentStyle) {
    const headingLevels = markdownHeadingLevels(adapted.markdown);
    if (!headingLevels.has(1) && [...headingLevels].some((level) => level >= 2)) {
      warnings.push({
        code: "document-style-level-unused",
        message: "문서에 H1(#)이 없어 가져온 HWPX의 H1 스타일은 사용되지 않습니다. 현재 Markdown 제목 단계는 그대로 유지했습니다.",
        count: 1
      });
    }
  }
  if (fontSubstitutions.length) {
    warnings.push({
      code: "font-substituted",
      message: `설치되지 않은 글꼴을 대체해 HWPX에 기록했습니다: ${fontSubstitutionSummary(fontSubstitutions).join(" · ")}`,
      count: fontSubstitutions.length
    });
  }
  if (imageFailures.length) {
    warnings.push({
      code: "image-missing",
      message: "일부 이미지를 불러오지 못해 누락 안내 텍스트로 대체했습니다.",
      count: imageFailures.length
    });
  }
  return {
    data: finalData,
    adaptedMarkdown: markdown,
    warnings,
    imageCount: adapted.imageCount,
    embeddedImageCount: generated.placedAssets.length,
    embeddedImageOccurrences: generated.placedOccurrences,
    imageFailures,
    documentStyleName,
    fontSubstitutions,
    validation
  };
}

export async function renderQuickHwpxPreview(
  sourceMarkdown: string,
  options: GenerateHwpxOptions = {}
): Promise<GeneratedHwpx & { render: RenderSvgResult }> {
  const generated = await generateValidatedHwpx(sourceMarkdown, options);
  const rawRender = await renderHwpxToSvg(generated.data, { reflow: true });
  const render: RenderSvgResult = { ...rawRender, svg: addPreviewFontAliases(rawRender.svg) };
  return { ...generated, render };
}
