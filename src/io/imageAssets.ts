import JSZip from "jszip";
import { errorMessage } from "../utils/errors";

export interface LoadedImage {
  data: Uint8Array | ArrayBuffer;
  contentType?: string;
}

export type ImageLoader = (source: string) => Promise<LoadedImage>;

export interface ImageProgress {
  completed: number;
  total: number;
  source: string;
  status: "embedded" | "failed";
}

export interface ImagePipelineOptions {
  loader: ImageLoader;
  concurrency?: number;
  maxImages?: number;
  maxImageBytes?: number;
  maxTotalBytes?: number;
  maxDisplayWidthHu?: number;
  onProgress?: (progress: ImageProgress) => void;
}

export interface ImageReference {
  source: string;
  alt: string;
  occurrences: number;
}

export interface ResolvedImageAsset extends ImageReference {
  safeName: string;
  itemId: string;
  mimeType: string;
  data: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  displayWidthHu: number;
  displayHeightHu: number;
}

export interface ImageFailure extends ImageReference {
  stage: "resolve" | "place";
  message: string;
}

export interface ImageResolutionResult {
  references: ImageReference[];
  assets: ResolvedImageAsset[];
  failures: ImageFailure[];
}

export interface HydratedImagesResult {
  data: ArrayBuffer;
  placedAssets: ResolvedImageAsset[];
  placedOccurrences: number;
  failures: ImageFailure[];
}

const DEFAULT_MAX_IMAGES = 100;
const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_BODY_WIDTH_HU = 42_520;
const MAX_BODY_HEIGHT_HU = 60_000;
const PIXEL_TO_HWPUNIT_AT_96_DPI = 75;
const FENCE = /^\s*(`{3,}|~{3,})/;

interface ImageToken {
  source: string;
  alt: string;
  raw: string;
  kind: "markdown" | "html";
}

type TokenTransform = (token: ImageToken) => string;

function transformImageTokens(markdown: string, transform: TokenTransform): string {
  const output: string[] = [];
  let fenceMarker = "";
  for (let line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const fence = line.match(FENCE)?.[1] ?? "";
    if (fence) {
      if (!fenceMarker) fenceMarker = fence[0];
      else if (fence[0] === fenceMarker) fenceMarker = "";
      output.push(line);
      continue;
    }
    if (fenceMarker) {
      output.push(line);
      continue;
    }

    line = line.replace(
      /!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g,
      (raw, alt: string, angleSource: string | undefined, source: string | undefined) =>
        transform({ raw, alt: alt || "이미지", source: angleSource || source || "", kind: "markdown" })
    );
    line = line.replace(/<img\b[^>]*>/gi, (raw) => {
      const source = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1];
      if (!source) return raw;
      const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(raw)?.[1] || "이미지";
      return transform({ raw, alt, source, kind: "html" });
    });
    output.push(line);
  }
  return output.join("\n");
}

export function collectImageReferences(markdown: string): ImageReference[] {
  const references = new Map<string, ImageReference>();
  transformImageTokens(markdown, (token) => {
    const current = references.get(token.source);
    if (current) current.occurrences++;
    else references.set(token.source, { source: token.source, alt: token.alt, occurrences: 1 });
    return token.raw;
  });
  return [...references.values()];
}

function toBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value);
}

function u16be(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

function u16le(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function u32be(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, false);
}

function i32le(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset + offset, 4).getInt32(0, true);
}

function jpegDimensions(data: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }
    while (offset < data.length && data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) break;
    const length = u16be(data, offset);
    if (length < 2 || offset + length > data.length) break;
    if (sofMarkers.has(marker) && length >= 7) {
      return { height: u16be(data, offset + 3), width: u16be(data, offset + 5) };
    }
    offset += length;
  }
  return null;
}

export function inspectImage(data: Uint8Array): {
  mimeType: string;
  extension: "png" | "jpg" | "gif" | "bmp";
  width: number;
  height: number;
} {
  let result: { mimeType: string; extension: "png" | "jpg" | "gif" | "bmp"; width: number; height: number } | null = null;
  if (
    data.length >= 24 &&
    data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 &&
    data[12] === 0x49 && data[13] === 0x48 && data[14] === 0x44 && data[15] === 0x52
  ) {
    result = { mimeType: "image/png", extension: "png", width: u32be(data, 16), height: u32be(data, 20) };
  } else if (data.length >= 10 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    result = { mimeType: "image/gif", extension: "gif", width: u16le(data, 6), height: u16le(data, 8) };
  } else if (data.length >= 26 && data[0] === 0x42 && data[1] === 0x4d) {
    result = { mimeType: "image/bmp", extension: "bmp", width: i32le(data, 18), height: Math.abs(i32le(data, 22)) };
  } else if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    const dimensions = jpegDimensions(data);
    if (dimensions) result = { mimeType: "image/jpeg", extension: "jpg", ...dimensions };
  }

  if (!result) throw new Error("지원하지 않거나 손상된 이미지입니다. PNG·JPEG·GIF·BMP를 사용하세요.");
  if (!Number.isFinite(result.width) || !Number.isFinite(result.height) || result.width <= 0 || result.height <= 0) {
    throw new Error("이미지 크기 정보를 읽을 수 없습니다.");
  }
  if (result.width > 50_000 || result.height > 50_000 || result.width * result.height > 100_000_000) {
    throw new Error(`이미지 픽셀 크기가 너무 큽니다: ${result.width}×${result.height}`);
  }
  return result;
}

export function imageDisplaySize(
  pixelWidth: number,
  pixelHeight: number,
  maxDisplayWidthHu = MAX_BODY_WIDTH_HU
): { widthHu: number; heightHu: number } {
  const maximumWidth = Math.max(1, Math.min(100_000, Math.round(maxDisplayWidthHu)));
  let widthHu = Math.min(Math.round(pixelWidth * PIXEL_TO_HWPUNIT_AT_96_DPI), maximumWidth);
  let heightHu = Math.max(1, Math.round((widthHu * pixelHeight) / pixelWidth));
  if (heightHu > MAX_BODY_HEIGHT_HU) {
    const ratio = MAX_BODY_HEIGHT_HU / heightHu;
    widthHu = Math.max(1, Math.round(widthHu * ratio));
    heightHu = MAX_BODY_HEIGHT_HU;
  }
  return { widthHu, heightHu };
}

export async function resolveMarkdownImages(
  markdown: string,
  options: ImagePipelineOptions
): Promise<ImageResolutionResult> {
  const references = collectImageReferences(markdown);
  const maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES;
  const maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4));
  const assets: ResolvedImageAsset[] = [];
  const failures: ImageFailure[] = [];
  const queued = references.slice(0, maxImages);
  for (const reference of references.slice(maxImages)) {
    failures.push({ ...reference, stage: "resolve", message: `문서당 이미지 한도 ${maxImages}개를 넘었습니다.` });
  }

  let next = 0;
  let completed = references.length - queued.length;
  let totalBytes = 0;
  const run = async (): Promise<void> => {
    while (next < queued.length) {
      const index = next++;
      const reference = queued[index];
      try {
        const loaded = await options.loader(reference.source);
        const data = toBytes(loaded.data);
        if (!data.byteLength) throw new Error("이미지 데이터가 비어 있습니다.");
        if (data.byteLength > maxImageBytes) {
          throw new Error(`이미지 한 개의 용량 한도 ${Math.round(maxImageBytes / 1024 / 1024)}MiB를 넘었습니다.`);
        }
        if (totalBytes + data.byteLength > maxTotalBytes) {
          throw new Error(`문서 이미지 총용량 한도 ${Math.round(maxTotalBytes / 1024 / 1024)}MiB를 넘었습니다.`);
        }
        const inspected = inspectImage(data);
        totalBytes += data.byteLength;
        const ordinal = index + 1;
        const base = `hanmark_image_${String(ordinal).padStart(3, "0")}`;
        const display = imageDisplaySize(inspected.width, inspected.height, options.maxDisplayWidthHu);
        assets.push({
          ...reference,
          safeName: `${base}.${inspected.extension}`,
          itemId: base,
          mimeType: inspected.mimeType,
          data,
          pixelWidth: inspected.width,
          pixelHeight: inspected.height,
          displayWidthHu: display.widthHu,
          displayHeightHu: display.heightHu
        });
        completed++;
        options.onProgress?.({ completed, total: references.length, source: reference.source, status: "embedded" });
      } catch (error: unknown) {
        failures.push({
          ...reference,
          stage: "resolve",
          message: errorMessage(error)
        });
        completed++;
        options.onProgress?.({ completed, total: references.length, source: reference.source, status: "failed" });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queued.length || 1) }, run));

  assets.sort((a, b) => references.findIndex((item) => item.source === a.source) - references.findIndex((item) => item.source === b.source));
  failures.sort((a, b) => references.findIndex((item) => item.source === a.source) - references.findIndex((item) => item.source === b.source));
  return { references, assets, failures };
}

function missingLabel(token: ImageToken): string {
  const clean = (token.alt || token.source.split("/").pop() || "이미지")
    .replace(/\[/g, " ").replace(/\]/g, " ").replace(/[\r\n]/g, " ").trim();
  return `[이미지 누락: ${clean || "이미지"}]`;
}

export function rewriteMarkdownForResolvedImages(
  markdown: string,
  assets: ResolvedImageAsset[],
  failedSources: Set<string>
): string {
  const bySource = new Map(assets.map((asset) => [asset.source, asset]));
  return transformImageTokens(markdown, (token) => {
    const asset = bySource.get(token.source);
    if (asset) {
      if (token.kind === "markdown") return token.raw.replace(token.source, asset.safeName);
      const alt = (token.alt || "이미지")
        .replace(/\[/g, " ").replace(/\]/g, " ").replace(/[\r\n]/g, " ").trim() || "이미지";
      return `![${alt}](${asset.safeName})`;
    }
    return failedSources.has(token.source) ? missingLabel(token) : token.raw;
  });
}

function replaceTagAttribute(xml: string, tag: string, attribute: string, value: number): string {
  const pattern = new RegExp(`(<${tag}\\b[^>]*\\b${attribute}=")[^"]*(")`);
  return xml.replace(pattern, `$1${value}$2`);
}

function resizePic(pic: string, width: number, height: number): string {
  let result = pic;
  for (const tag of ["hp:orgSz", "hp:curSz", "hp:sz"]) {
    result = replaceTagAttribute(result, tag, "width", width);
    result = replaceTagAttribute(result, tag, "height", height);
  }
  result = replaceTagAttribute(result, "hp:rotationInfo", "centerX", Math.round(width / 2));
  result = replaceTagAttribute(result, "hp:rotationInfo", "centerY", Math.round(height / 2));
  result = replaceTagAttribute(result, "hc:pt1", "x", width);
  result = replaceTagAttribute(result, "hc:pt2", "x", width);
  result = replaceTagAttribute(result, "hc:pt2", "y", height);
  result = replaceTagAttribute(result, "hc:pt3", "y", height);
  result = replaceTagAttribute(result, "hp:imgClip", "right", width);
  result = replaceTagAttribute(result, "hp:imgClip", "bottom", height);
  result = replaceTagAttribute(result, "hp:imgDim", "dimwidth", width);
  result = replaceTagAttribute(result, "hp:imgDim", "dimheight", height);
  return result;
}

export async function hydrateKordocImages(
  hwpx: ArrayBuffer,
  assets: ResolvedImageAsset[]
): Promise<HydratedImagesResult> {
  if (!assets.length) return { data: hwpx, placedAssets: [], placedOccurrences: 0, failures: [] };
  const zip = await JSZip.loadAsync(hwpx);
  const sectionFile = zip.file("Contents/section0.xml");
  const manifestFile = zip.file("Contents/content.hpf");
  if (!sectionFile || !manifestFile) throw new Error("HWPX 이미지 삽입에 필요한 section0.xml 또는 content.hpf가 없습니다.");
  let section = await sectionFile.async("string");
  const manifest = await manifestFile.async("string");
  const byId = new Map(assets.map((asset) => [asset.itemId, asset]));
  const placedCounts = new Map<string, number>();
  let placedOccurrences = 0;

  section = section.replace(/<hp:pic\b[\s\S]*?<\/hp:pic>/g, (pic) => {
    const itemId = /\bbinaryItemIDRef="([^"]+)"/.exec(pic)?.[1];
    const asset = itemId ? byId.get(itemId) : undefined;
    if (!asset) return pic;
    placedCounts.set(asset.itemId, (placedCounts.get(asset.itemId) ?? 0) + 1);
    placedOccurrences++;
    return resizePic(pic, asset.displayWidthHu, asset.displayHeightHu);
  });

  const placedAssets: ResolvedImageAsset[] = [];
  const failures: ImageFailure[] = [];
  for (const asset of assets) {
    const hasPart = Boolean(zip.file(`BinData/${asset.safeName}`));
    const hasManifest = manifest.includes(`id="${asset.itemId}"`) && manifest.includes(`href="BinData/${asset.safeName}"`);
    const actualPlacements = placedCounts.get(asset.itemId) ?? 0;
    if (!hasPart || !hasManifest || actualPlacements !== asset.occurrences) {
      failures.push({
        source: asset.source,
        alt: asset.alt,
        occurrences: asset.occurrences,
        stage: "place",
        message:
          actualPlacements === 0
            ? "이미지가 독립 문단 또는 지원되는 표 셀에 있지 않아 Kordoc 이미지 개체를 만들지 못했습니다."
            : `이미지 참조 ${asset.occurrences}곳 중 ${actualPlacements}곳만 배치할 수 있습니다.`
      });
      continue;
    }
    zip.file(`BinData/${asset.safeName}`, asset.data);
    placedAssets.push(asset);
  }

  zip.file("Contents/section0.xml", section);
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  const data = await zip.generateAsync({ type: "arraybuffer" });
  return { data, placedAssets, placedOccurrences, failures };
}

export class ImageResolutionError extends Error {
  constructor(
    public readonly failures: ImageFailure[],
    public readonly resolvedCount: number,
    public readonly totalCount: number
  ) {
    const first = failures.slice(0, 3).map((failure) => `${failure.alt}: ${failure.message}`).join(" / ");
    super(`이미지 ${failures.length}개를 포함하지 못했습니다.${first ? ` ${first}` : ""}`);
    this.name = "ImageResolutionError";
  }
}
