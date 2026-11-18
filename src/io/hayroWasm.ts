import { inflateRawSync } from "node:zlib";
import { HAYRO_WASM_BYTE_LENGTH, HAYRO_WASM_DEFLATE_BASE64 } from "./hayroWasmData";

/**
 * Kordoc's PDF text engine (hayro, compiled to WebAssembly), carried inside the
 * bundle. Kordoc itself reads the module from a file next to it or fetches it;
 * the build replaces that loader with this function, so PDF import needs no file
 * access and no network (R-029). Kordoc compiles the bytes once and keeps the
 * compiled module, so nothing is cached here.
 */
export function hayroWasmBytes(): Uint8Array {
  const bytes = inflateRawSync(Buffer.from(HAYRO_WASM_DEFLATE_BASE64, "base64"));
  if (bytes.byteLength !== HAYRO_WASM_BYTE_LENGTH) {
    throw new Error("The embedded PDF engine is damaged; reinstall HanMark.");
  }
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
