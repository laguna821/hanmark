import { t } from "../i18n";
import { bytesToBase64 } from "../io/pngMeta";
import { COVER_LOGO_DEFAULT, COVER_LOGO_MAX_BYTES, type CoverLogoRecord } from "../io/templateLibrary";

/**
 * Turns a picture the user chose into a cover logo (3.0.0): PNG and JPEG are kept as
 * they are when small enough; SVG, WebP, and very large pictures are drawn into a
 * PNG in the window, the same way diagrams are. Nothing leaves the computer.
 */
const DRAW_SIDE = 1200;
const KEEP_SIDE = 3000;

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/** A detached element of the window the user works in (a pop-out window has its own document). */
function createElement<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K): HTMLElementTagNameMap[K] {
  return doc.createElementNS(HTML_NAMESPACE, tag) as HTMLElementTagNameMap[K];
}

type LogoKind = "image/png" | "image/jpeg" | "image/svg+xml" | "image/webp";

export const COVER_LOGO_EXTENSIONS = ["png", "jpg", "jpeg", "svg", "webp"];
/** Largest picture file read for a logo, before it is redrawn. */
export const COVER_LOGO_PICK_MAX_BYTES = 8 * 1024 * 1024;

export function coverLogoKind(bytes: Uint8Array): LogoKind | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  const head = new TextDecoder().decode(bytes.slice(0, 2048));
  return /<svg[\s>]/u.test(head) ? "image/svg+xml" : null;
}

const base64 = bytesToBase64;

/** The SVG with a pixel size on its root, so it draws at `side` on its long edge. */
export function sizedSvg(text: string, side = DRAW_SIDE): { svg: string; width: number; height: number } {
  const root = /<svg\b[^>]*>/u.exec(text);
  if (!root) throw new Error(t("gongmun.style.logo.unreadable"));
  const viewBox = /\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/u.exec(root[0]);
  const attr = (name: string): number => Number(new RegExp(`\\b${name}\\s*=\\s*["']\\s*([\\d.]+)(?:px)?\\s*["']`, "u").exec(root[0])?.[1] ?? NaN);
  let width = viewBox ? Number(viewBox[1]) : attr("width");
  let height = viewBox ? Number(viewBox[2]) : attr("height");
  if (!(width > 0) || !(height > 0)) width = height = 1;
  const scale = side / Math.max(width, height);
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  const open = root[0].replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gu, "").replace(/^<svg\b/u, `<svg width="${width}" height="${height}"`);
  return { svg: text.replace(root[0], open), width, height };
}

async function loadImage(doc: Document, src: string): Promise<HTMLImageElement> {
  const image = createElement(doc, "img");
  image.decoding = "sync";
  image.src = src;
  try {
    await image.decode();
  } catch {
    throw new Error(t("gongmun.style.logo.unreadable"));
  }
  if (!image.naturalWidth || !image.naturalHeight) throw new Error(t("gongmun.style.logo.unreadable"));
  return image;
}

async function draw(doc: Document, image: HTMLImageElement, width: number, height: number, mime: "image/png" | "image/jpeg"): Promise<Uint8Array> {
  const canvas = createElement(doc, "canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("gongmun.style.logo.unreadable"));
  if (mime === "image/jpeg") {
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.92));
  if (!blob) throw new Error(t("gongmun.style.logo.unreadable"));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function coverLogoFromFile(
  doc: Document,
  name: string,
  bytes: Uint8Array,
  previous?: Pick<CoverLogoRecord, "widthMm" | "bottomMm">
): Promise<CoverLogoRecord> {
  const kind = coverLogoKind(bytes);
  if (!kind) throw new Error(t("gongmun.style.logo.unsupported"));
  let data: Uint8Array;
  let mime: "image/png" | "image/jpeg";
  let width: number;
  let height: number;
  if (kind === "image/svg+xml") {
    const sized = sizedSvg(new TextDecoder().decode(bytes));
    const image = await loadImage(doc, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized.svg)}`);
    ({ width, height } = sized);
    mime = "image/png";
    data = await draw(doc, image, width, height, mime);
  } else {
    const image = await loadImage(doc, `data:${kind};base64,${base64(bytes)}`);
    width = image.naturalWidth;
    height = image.naturalHeight;
    mime = kind === "image/jpeg" ? "image/jpeg" : "image/png";
    data = bytes;
    if (kind === "image/webp" || bytes.length > COVER_LOGO_MAX_BYTES || Math.max(width, height) > KEEP_SIDE) {
      const scale = Math.min(1, DRAW_SIDE / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      data = await draw(doc, image, width, height, mime);
    }
  }
  if (data.length > COVER_LOGO_MAX_BYTES) throw new Error(t("gongmun.style.logo.tooLarge"));
  return {
    name: name.replace(/[\\/]/gu, " ").slice(0, 80) || "logo",
    data: base64(data),
    mime,
    width,
    height,
    widthMm: previous?.widthMm ?? COVER_LOGO_DEFAULT.widthMm,
    bottomMm: previous?.bottomMm ?? COVER_LOGO_DEFAULT.bottomMm
  };
}