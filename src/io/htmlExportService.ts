import {
  resolveMarkdownImages,
  type ImageFailure,
  type ImageLoader,
  type ImageProgress,
  type ImageReference,
  type ResolvedImageAsset
} from "./imageAssets";

export const HTML_EXPORT_IMAGE_LIMITS = Object.freeze({
  maxImages: 100,
  maxImageBytes: 20 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  concurrency: 4
});

export interface HtmlExportImageOptions {
  loader: ImageLoader;
  onProgress?: (progress: ImageProgress) => void;
}

export interface HtmlExportImageResult {
  markdown: string;
  references: ImageReference[];
  failures: ImageFailure[];
  embeddedCount: number;
  embeddedOccurrences: number;
}

const DATA_URI_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/bmp"]);
const FENCE = /^\s*(`{3,}|~{3,})/;
const RASTER_OBSIDIAN_EMBED = /\.(?:png|jpe?g|gif|bmp)(?:[?#].*)?$/i;

function encodeBase64(data: Uint8Array): string {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
}

function toDataUri(asset: ResolvedImageAsset): string {
  if (!DATA_URI_MIME_TYPES.has(asset.mimeType)) {
    throw new Error(`HTML에 포함할 수 없는 이미지 형식입니다: ${asset.mimeType}`);
  }
  return `data:${asset.mimeType};base64,${encodeBase64(asset.data)}`;
}

function asDataUriAsset(asset: ResolvedImageAsset): ResolvedImageAsset {
  return {
    ...asset,
    safeName: toDataUri(asset)
  };
}

interface HtmlImageToken {
  source: string;
  alt: string;
  raw: string;
}

function cleanLabel(value: string, fallback: string): string {
  return (value || fallback)
    .replace(/\[|\]/g, " ")
    .replace(/[\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || fallback;
}

function fallbackLabel(source: string): string {
  const withoutQuery = source.split(/[?#]/, 1)[0];
  return withoutQuery.split(/[\\/]/).pop() || "이미지";
}

function missingLabel(token: Pick<HtmlImageToken, "source" | "alt">): string {
  return `[이미지 누락: ${cleanLabel(token.alt, fallbackLabel(token.source))}]`;
}

function transformOutsideFences(markdown: string, transform: (line: string) => string): string {
  const output: string[] = [];
  let fenceMarker = "";
  for (const originalLine of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const fence = originalLine.match(FENCE)?.[1] ?? "";
    if (fence) {
      if (!fenceMarker) fenceMarker = fence[0];
      else if (fence[0] === fenceMarker) fenceMarker = "";
      output.push(originalLine);
      continue;
    }
    output.push(fenceMarker ? originalLine : transform(originalLine));
  }
  return output.join("\n");
}

/**
 * Converts only Obsidian raster embeds into standard Markdown image tokens.
 * Note, canvas, PDF, SVG, and other embed types remain unchanged.
 */
export function normalizeObsidianRasterImageEmbeds(markdown: string): string {
  return transformOutsideFences(markdown, (line) =>
    line.replace(/!\[\[([^\]\r\n]+)\]\]/g, (raw, body: string) => {
      const separator = body.indexOf("|");
      const source = (separator >= 0 ? body.slice(0, separator) : body).trim();
      if (!source || !RASTER_OBSIDIAN_EMBED.test(source)) return raw;
      const requestedAlt = separator >= 0 ? body.slice(separator + 1).trim() : "";
      const alt = /^\d+(?:x\d+)?$/i.test(requestedAlt)
        ? fallbackLabel(source)
        : cleanLabel(requestedAlt, fallbackLabel(source));
      return `![${alt}](<${source.replace(/[<>]/g, "")}>)`;
    })
  );
}

function rewriteImageTokens(
  markdown: string,
  assets: ResolvedImageAsset[],
  knownFailures: Map<string, ImageFailure>
): { markdown: string; defensiveFailures: ImageFailure[] } {
  const bySource = new Map(assets.map((asset) => [asset.source, asset]));
  const defensiveFailures: ImageFailure[] = [];
  const rewritten = transformOutsideFences(markdown, (line) => {
    const replace = (token: HtmlImageToken): string => {
      const asset = bySource.get(token.source);
      if (asset) {
        return `![${cleanLabel(token.alt, fallbackLabel(token.source))}](${asset.safeName})`;
      }
      if (!knownFailures.has(token.source)) {
        const failure: ImageFailure = {
          source: token.source,
          alt: token.alt,
          occurrences: 1,
          stage: "resolve",
          message: "HTML 내보내기에서 안전한 내장 이미지로 변환하지 못했습니다."
        };
        defensiveFailures.push(failure);
        knownFailures.set(token.source, failure);
      }
      return missingLabel(token);
    };

    let output = line.replace(
      /!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g,
      (raw, alt: string, angleSource: string | undefined, source: string | undefined) =>
        replace({ raw, alt, source: angleSource || source || "" })
    );
    output = output.replace(/<img\b[^>]*>/gi, (raw) => {
      const source = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1];
      if (!source) return raw;
      const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(raw)?.[1] || fallbackLabel(source);
      return replace({ raw, alt, source });
    });
    return output;
  });
  return { markdown: rewritten, defensiveFailures };
}

/**
 * Resolves every active Markdown/HTML image reference and prepares Markdown for
 * a script-free, self-contained HTML export.
 *
 * Callers can discard the result to cancel, invoke this function again to
 * retry, or explicitly continue with `markdown`. Continuing never preserves a
 * failed external image reference: each failure is replaced by a visible
 * `[이미지 누락: ...]` label.
 */
export async function prepareSelfContainedHtmlMarkdown(
  markdown: string,
  options: HtmlExportImageOptions
): Promise<HtmlExportImageResult> {
  const normalizedMarkdown = normalizeObsidianRasterImageEmbeds(markdown);
  const resolution = await resolveMarkdownImages(normalizedMarkdown, {
    loader: options.loader,
    onProgress: options.onProgress,
    ...HTML_EXPORT_IMAGE_LIMITS
  });
  const dataUriAssets = resolution.assets.map(asDataUriAsset);
  const knownFailures = new Map(resolution.failures.map((failure) => [failure.source, failure]));
  const rewritten = rewriteImageTokens(normalizedMarkdown, dataUriAssets, knownFailures);

  return {
    markdown: rewritten.markdown,
    references: resolution.references,
    failures: [...resolution.failures, ...rewritten.defensiveFailures],
    embeddedCount: resolution.assets.length,
    embeddedOccurrences: resolution.assets.reduce((sum, asset) => sum + asset.occurrences, 0)
  };
}
