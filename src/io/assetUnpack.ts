import { normalizePath, type DataAdapter, type Plugin } from "obsidian";
import { EMBEDDED_ASSETS } from "./embeddedAssets";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64(value: string): Uint8Array {
  const cleaned = value.replace(/\s+/g, "").replace(/=+$/, "");
  const output = new Uint8Array(Math.floor((cleaned.length * 6) / 8));
  let bits = 0;
  let bitCount = 0;
  let offset = 0;
  for (const character of cleaned) {
    const digit = BASE64_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error("Bundled asset contains invalid base64 data.");
    bits = (bits << 6) | digit;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      output[offset++] = (bits >> bitCount) & 0xff;
    }
  }
  return output.subarray(0, offset);
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

async function ensureAdapterFolder(adapter: DataAdapter, path: string): Promise<void> {
  let current = "";
  for (const segment of normalizePath(path).split("/")) {
    if (!segment) continue;
    current = current ? `${current}/${segment}` : segment;
    if (await adapter.exists(current)) continue;
    try {
      await adapter.mkdir(current);
    } catch (error) {
      if (!(await adapter.exists(current))) throw error;
    }
  }
}

/**
 * Community installs ship only main.js / manifest.json / styles.css, so the optional DOCX
 * exporter/preview would otherwise miss its support files. Small bundled assets are written
 * through Obsidian's vault adapter and existing files are never overwritten.
 */
export async function unpackBundledAssets(plugin: Plugin): Promise<void> {
  try {
    const adapter = plugin.app.vault.adapter;
    const pluginDir = normalizePath(
      `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`
    );

    for (const asset of EMBEDDED_ASSETS) {
      const relative = normalizePath(`${pluginDir}/${asset.rel}`);
      if (await adapter.exists(relative)) continue;
      const parent = relative.split("/").slice(0, -1).join("/");
      await ensureAdapterFolder(adapter, parent);
      await adapter.writeBinary(relative, asArrayBuffer(decodeBase64(asset.b64)));
    }
  } catch {
    // Best-effort: the DOCX UI reports missing support files if adapter writes are blocked.
  }
}
