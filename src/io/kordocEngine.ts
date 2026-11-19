import {
  markdownToHwpx,
  normalizeGongmunPreset,
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
import { finalizeHwpxPackage } from "./hwpxPostProcess";
import { openSampleLook, type SampleLookRecord } from "./sampleLook";
import { applyScriptRunsToHwpx, markScriptTags } from "./hwpxScriptRuns";
import { finishGongmunHwpx, type GongmunFinishSpec } from "./hwpxFinish";
import { gongmunCoverIsOn } from "./gongmunStyle";
import { paragraphSignature, prepareGongmunMarkdown, type GongmunOutlineStyle } from "./gongmunOutline";
import {
  fontSubstitutionSummary,
  resolveDocumentStyleFonts,
  type FontResolverOptions,
  type FontSubstitution,
  type MissingFont
} from "./fontResolver";
import { fontGuideLines } from "./fontGuide";
import { resolveOutputLocale, t, type LanguagePreference } from "../i18n";
import { assertEngineCapability } from "./engineCapability";

/**
 * Official-document defaults that Kordoc changed after 4.15.7, pinned to the old
 * behaviour until HanMark adopts them on purpose (R-029). A value the caller set
 * always wins.
 * - totalRow "keep": a 합계/총계/계 row stays where the note has it (4.23.0 moves
 *   it under the header row by default).
 * - bodyTitleBox false and toc true, for the bullet-style report without a cover
 *   only: the first "#" stays chapter Ⅰ instead of becoming a title box, and the
 *   contents page stays in front (4.25.0 made both follow the cover).
 */
export function pinGongmunDefaults(gongmun: GongmunOptions | undefined): GongmunOptions | undefined {
  if (!gongmun) return gongmun;
  const pinned: GongmunOptions = { ...gongmun };
  if (pinned.totalRow === undefined) pinned.totalRow = "keep";
  if (pinned.cover === false && normalizeGongmunPreset(pinned.preset) === "gaejosik") {
    if (pinned.bodyTitleBox === undefined) pinned.bodyTitleBox = false;
    if (pinned.toc === undefined) pinned.toc = true;
  }
  return pinned;
}

export interface GenerateHwpxOptions {
  gongmun?: GongmunOptions;
  profile?: FormatProfile;
  documentStyle?: DocumentStyleProfile;
  fontResolver?: FontResolverOptions;
  images?: ImagePipelineOptions & { allowFailures?: boolean };
  /** Language of labels the adapter writes into the document ("auto" reads the note). */
  outputLanguage?: LanguagePreference;
  /** Official documents: title for a note without a leading `#` heading (R-024). */
  gongmunTitle?: string;
  /** Official documents: finishing of a built-in institution style. */
  gongmunFinish?: GongmunFinishSpec;
  /** Official documents: heading and list mapping of a built-in institution style. */
  gongmunOutline?: GongmunOutlineStyle;
  /** Engine notes to leave out of the report (message prefixes). */
  quietEngineNotes?: readonly string[];
  /**
   * A look learned from a sample HWPX (R-036). The engine fills the sample's own shapes,
   * so the official-document options, table look and finishing do not apply to it.
   */
  sampleLook?: SampleLookRecord;
  /** `$…$` becomes a Hangul equation object (R-036); off keeps the text as it is. */
  inlineMath?: boolean;
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
  /** Template fonts this machine lacks (reported only; the HWPX keeps their names). */
  missingFonts: MissingFont[];
  validation: ValidateResult;
}

export class HwpxValidationError extends Error {
  constructor(public readonly validation: ValidateResult) {
    super(
      t("hwpx.validationFailed", {
        issues: validation.issues
          .slice(0, 5)
          .map((issue) => `${issue.path ? issue.path + ": " : ""}${issue.message}`)
          .join(" / ")
      })
    );
    this.name = "HwpxValidationError";
  }
}

// Some Hancom/HWP face names differ from the family names exposed to Chromium.
// Keep the HWPX face untouched, but add the local CSS family while previewing.
// i18n-data-begin: font family names
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
  "한림고딕체 Regular": ["Hallym Gothic Regular", "한림고딕체", "Hallym Gothic", "Hallym-Regular"],
  "한림명조체 Regular": ["Hallym Mjo Regular", "한림명조체", "Hallym Mjo", "HallymMjo-Regular"],
  "맑은 고딕": ["Malgun Gothic"]
};
// i18n-data-end

/**
 * Adds local CSS fallbacks to preview SVG font lists. `previewFallbacks` maps a font
 * missing on this machine to the family the preview should draw instead; the HWPX
 * itself keeps the template's font names.
 */
export function addPreviewFontAliases(
  svg: string,
  previewFallbacks: Readonly<Record<string, string>> = {}
): string {
  return svg.replace(/font-family="([^"]*)"/g, (_attribute, familyList: string) => {
    const expanded = familyList.replace(/'([^']+)'/g, (token, family: string) => {
      const names = [...(PREVIEW_FONT_ALIASES[family] ?? [])];
      const fallback = previewFallbacks[family];
      if (fallback && !names.includes(fallback)) names.push(fallback);
      if (!names.length) return token;
      return [family, ...names].map((name) => `'${name}'`).join(",");
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
    if (!profile.roles[`h${level}`]) return line;
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
  const adapted = adaptMarkdownForKordoc(sourceMarkdown, {
    outputLanguage: options.outputLanguage
  });
  return generateValidatedHwpxFromAdapted(adapted, options);
}

async function generateKordocPackage(
  markdown: string,
  options: GenerateHwpxOptions,
  assets: ResolvedImageAsset[]
): Promise<{
  data: ArrayBuffer;
  placedAssets: ResolvedImageAsset[];
  placedOccurrences: number;
  failures: ImageFailure[];
  engineWarnings: string[];
}> {
  // Kordoc reports what its generator adjusted silently (for example shrinking an
  // over-long official-document heading); HanMark shows these in the report.
  const engineWarnings: string[] = [];
  const sample = options.sampleLook ? await openSampleLook(options.sampleLook) : undefined;
  if (sample) engineWarnings.push(...sample.roleWarnings(markdown));
  assertEngineCapability("documents");
  const raw = await markdownToHwpx(
    markdown,
    sample
      ? { template: sample.template, totalRow: "keep", warnings: engineWarnings }
      : {
          gongmun: pinGongmunDefaults(options.gongmun),
          profile: options.profile,
          // Passed only when asked for, so documents made without it keep their bytes.
          ...(options.inlineMath ? { inlineMath: true } : {}),
          warnings: engineWarnings
        }
  );
  const hydrated = await hydrateKordocImages(raw, assets);
  return {
    data: hydrated.data,
    placedAssets: hydrated.placedAssets,
    placedOccurrences: hydrated.placedOccurrences,
    failures: hydrated.failures,
    engineWarnings
  };
}

export async function generateValidatedHwpxFromAdapted(
  adapted: MarkdownAdapterResult,
  requested: GenerateHwpxOptions = {}
): Promise<GeneratedHwpx> {
  // A look learned from a sample is made from the sample's shapes alone (R-036): the
  // official-document outline, table look, finishing and document style stay out of it.
  const options: GenerateHwpxOptions = requested.sampleLook
    ? { ...requested, gongmun: undefined, profile: undefined, gongmunFinish: undefined, gongmunOutline: undefined, documentStyle: undefined }
    : requested;
  if (requested.sampleLook && requested.gongmunTitle && !/^\s*#\s/u.test(adapted.markdown)) {
    adapted = { ...adapted, markdown: `# ${requested.gongmunTitle}\n\n${adapted.markdown}` };
  }
  // Official documents: consecutive heading levels and a title (R-024).
  const outline = options.gongmun
    ? prepareGongmunMarkdown(adapted.markdown, {
        preset: normalizeGongmunPreset(options.gongmun.preset),
        numbering: options.gongmun.numbering,
        h2Marker: options.gongmun.h2Marker,
        title: options.gongmunTitle,
        ...options.gongmunOutline
      })
    : undefined;
  const sourceMarkdown = outline?.markdown ?? adapted.markdown;
  let markdown = sourceMarkdown;
  let assets: ResolvedImageAsset[] = [];
  let imageFailures: ImageFailure[] = [];
  let headingMarkers: ExtendedHeadingMarker[] = [];
  let scriptSpans = 0;

  if (adapted.imageCount > 0) {
    if (!options.images?.loader) {
      throw new ImageResolutionError(
        [{
          source: "",
          alt: t("hwpx.imageAlt"),
          occurrences: adapted.imageCount,
          stage: "resolve",
          message: t("hwpx.imageLoaderMissing")
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
    markdown = rewriteMarkdownForResolvedImages(
      markdown,
      assets,
      new Set(imageFailures.map((item) => item.source)),
      resolveOutputLocale(options.outputLanguage, markdown)
    );
  }

  const generateCurrentPackage = async () => {
    const marked = markExtendedHeadings(markdown, options.documentStyle);
    headingMarkers = marked.markers;
    // Kordoc's generator drops <sup>/<sub>; HanMark writes them as runs (hwpxScriptRuns.ts).
    const scripted = markScriptTags(marked.markdown);
    scriptSpans = scripted.marked;
    return generateKordocPackage(scripted.markdown, options, assets);
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
    markdown = rewriteMarkdownForResolvedImages(
      sourceMarkdown,
      assets,
      failedSources,
      resolveOutputLocale(options.outputLanguage, sourceMarkdown)
    );
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
  let missingFonts: MissingFont[] = [];
  if (options.documentStyle) {
    const resolved = await resolveDocumentStyleFonts(options.documentStyle, options.fontResolver);
    fontSubstitutions = resolved.substitutions;
    missingFonts = resolved.missing;
    const styled = await applyDocumentStyleToHwpx(finalData, resolved.profile, headingMarkers);
    finalData = styled.data;
    documentStyleName = styled.profile.name;
  }

  // After the document style, so a raised or lowered run copies the final character shape;
  // before the official-document finishing, so that reads the text without markers.
  if (scriptSpans > 0) finalData = (await applyScriptRunsToHwpx(finalData)).data;

  // Body paragraphs under their heading (legal family) and the institution style's finishing.
  const paragraphs = outline?.paragraphs.some((hint) => hint.depth > 0) ? outline.paragraphs : undefined;
  const closingLine = options.gongmunOutline?.closing?.date ?? options.gongmunOutline?.closing?.sender;
  const closing = closingLine ? { key: paragraphSignature(closingLine) } : undefined;
  // Every official-document style draws titles and headings in frames sized for one line (R-027).
  const fitFrames = !!options.gongmun;
  // A cover logo only where the document has a cover (a frame switch or the note can turn it off).
  let finish = options.gongmunFinish;
  if (finish?.cover?.logo && !(options.gongmun && gongmunCoverIsOn(options.gongmun))) {
    const { logo: _logo, ...cover } = finish.cover;
    finish = { ...finish, cover: Object.keys(cover).length ? cover : undefined };
  }
  if (finish || paragraphs || closing || fitFrames) {
    finalData = (await finishGongmunHwpx(finalData, { ...finish, paragraphs, closing, fitFrames })).data;
  }

  // Footnote numbers, repeated header rows, and fixed ZIP timestamps (R-018 M2).
  const finalized = await finalizeHwpxPackage(finalData, {
    footnoteAutoNumbers: true,
    repeatHeaderRows: true
  });
  finalData = finalized.data;

  const validation = await validateHwpx(finalData);
  if (!validation.ok) throw new HwpxValidationError(validation);
  const warnings = [...adapted.warnings];
  // Kordoc repeats a note for every item it concerns (…: "<item>…"); report each kind once with a count.
  const engineNotes = new Map<string, AdapterWarning>();
  for (const message of generated.engineWarnings) {
    if (options.quietEngineNotes?.some((prefix) => message.startsWith(prefix))) continue;
    const kind = message.replace(/:\s*"[^"]*"$/u, "");
    const known = engineNotes.get(kind);
    if (known) known.count += 1;
    else engineNotes.set(kind, { code: "engine-note", message, count: 1 });
  }
  warnings.push(...engineNotes.values());
  if (options.documentStyle) {
    const headingLevels = markdownHeadingLevels(adapted.markdown);
    if (!headingLevels.has(1) && [...headingLevels].some((level) => level >= 2)) {
      warnings.push({
        code: "document-style-level-unused",
        message: t("hwpx.warning.headingLevelUnused"),
        count: 1
      });
    }
  }
  if (fontSubstitutions.length) {
    warnings.push({
      code: "font-substituted",
      message: t("hwpx.warning.fontSubstituted", {
        rules: fontSubstitutionSummary(fontSubstitutions).join(" · ")
      }),
      count: fontSubstitutions.length
    });
  }
  if (missingFonts.length) {
    warnings.push({
      code: "font-missing",
      message: t("hwpx.warning.fontMissing", { guide: fontGuideLines(missingFonts).join(" / ") }),
      count: missingFonts.length
    });
  }
  if (imageFailures.length) {
    warnings.push({
      code: "image-missing",
      message: t("hwpx.warning.imageMissing"),
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
    missingFonts,
    validation
  };
}

export async function renderQuickHwpxPreview(
  sourceMarkdown: string,
  options: GenerateHwpxOptions = {}
): Promise<GeneratedHwpx & { render: RenderSvgResult }> {
  const generated = await generateValidatedHwpx(sourceMarkdown, options);
  const rawRender = await renderHwpxToSvg(generated.data, { reflow: true });
  const previewFallbacks = Object.fromEntries(
    generated.missingFonts.map((item) => [item.family, item.previewFallback])
  );
  const render: RenderSvgResult = { ...rawRender, svg: addPreviewFontAliases(rawRender.svg, previewFallbacks) };
  return { ...generated, render };
}
