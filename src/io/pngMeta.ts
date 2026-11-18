/**
 * PNG metadata for pictures HanMark draws itself (R-033).
 *
 * A diagram is rasterised at a multiple of the size it is placed at. The multiple
 * is written into the PNG as a private text chunk so every writer (HWPX image
 * pipeline, DOCX writer) places the picture at its intended size instead of at one
 * document pixel per image pixel. Other PNG files never carry the chunk and are
 * placed exactly as before.
 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SCALE_KEYWORD = "hanmark-scale";
const PIXELS_PER_METRE_AT_96_DPI = 3780;

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function isPng(data: Uint8Array): boolean {
  return data.length >= 33 && PNG_SIGNATURE.every((byte, index) => data[index] === byte);
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(Array.from(text, (char) => char.charCodeAt(0) & 0x7f));
}

interface PngChunk {
  type: string;
  start: number;
  end: number;
  body: Uint8Array;
}

function* chunks(data: Uint8Array): Generator<PngChunk> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8;
  while (offset + 12 <= data.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > data.length) return;
    const type = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]);
    yield { type, start: offset, end, body: data.subarray(offset + 8, offset + 8 + length) };
    if (type === "IEND") return;
    offset = end;
  }
}

/**
 * Marks a PNG as drawn at `scale` image pixels per placed pixel (1 to 8), and
 * whether the paragraph after it is its caption. Earlier marks and density chunks
 * are replaced, so marking twice gives the same bytes.
 */
export function withPngDisplayScale(png: Uint8Array, scale: number, captionFollows = false): Uint8Array {
  if (!isPng(png)) throw new Error("Not a PNG image.");
  const value = Math.max(1, Math.min(8, Math.round(scale)));
  const density = new Uint8Array(9);
  const densityView = new DataView(density.buffer);
  densityView.setUint32(0, PIXELS_PER_METRE_AT_96_DPI * value);
  densityView.setUint32(4, PIXELS_PER_METRE_AT_96_DPI * value);
  density[8] = 1;
  const mark = chunk("tEXt", ascii(`${SCALE_KEYWORD}\0${value}${captionFollows ? "c" : ""}`));
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  for (const item of chunks(png)) {
    if (item.type === "pHYs") continue;
    if (item.type === "tEXt" && String.fromCharCode(...item.body.subarray(0, SCALE_KEYWORD.length + 1)) === `${SCALE_KEYWORD}\0`) continue;
    parts.push(png.subarray(item.start, item.end));
    if (item.type === "IHDR") parts.push(chunk("pHYs", density), mark);
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export interface PngDiagramMark {
  /** Image pixels per placed pixel. */
  scale: number;
  /** The paragraph after the picture is its caption. */
  captionFollows: boolean;
}

/** The mark of a PNG HanMark drew; null for every other image. */
export function pngDiagramMark(data: Uint8Array): PngDiagramMark | null {
  if (!isPng(data)) return null;
  for (const item of chunks(data)) {
    if (item.type === "IDAT") break;
    if (item.type !== "tEXt") continue;
    const text = String.fromCharCode(...item.body.subarray(0, 32));
    if (!text.startsWith(`${SCALE_KEYWORD}\0`)) continue;
    const match = /^([1-8])(c?)$/.exec(text.slice(SCALE_KEYWORD.length + 1));
    return match ? { scale: Number(match[1]), captionFollows: match[2] === "c" } : null;
  }
  return null;
}

/** Image pixels per placed pixel of a PNG HanMark drew; 1 for every other image. */
export function pngDisplayScale(data: Uint8Array): number {
  return pngDiagramMark(data)?.scale ?? 1;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 of bytes, without relying on a platform encoder. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    out += BASE64[a >> 2] + BASE64[((a & 3) << 4) | (b >> 4)];
    out += index + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)] : "=";
    out += index + 2 < bytes.length ? BASE64[c & 63] : "=";
  }
  return out;
}

/** Bytes of standard base64 text; null when the text is not valid base64. */
export function base64ToBytes(text: string): Uint8Array | null {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(text)) return null;
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let at = 0;
  for (let index = 0; index < text.length; index += 4) {
    const values = [0, 1, 2, 3].map((offset) => Math.max(0, BASE64.indexOf(text[index + offset])));
    const block = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
    if (at < out.length) out[at++] = block >> 16;
    if (at < out.length) out[at++] = (block >> 8) & 0xff;
    if (at < out.length) out[at++] = block & 0xff;
  }
  return out;
}
