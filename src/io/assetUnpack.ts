import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { EMBEDDED_ASSETS } from "./embeddedAssets";

/**
 * Community installs ship only main.js / manifest.json / styles.css, so the legacy export &
 * preview features — which read blank.hwpx, hwp-assets/ and word-assets/ from the plugin
 * folder via fs — would be missing their data files. We base64-embed those (~21KB) assets in
 * main.js and write any that are absent into the plugin folder on load. Existing files are
 * left untouched, so a user can customize an asset and it won't be clobbered on the next load.
 *
 * The target dir mirrors the legacy core's own getPluginDir():
 *   <vault>/<configDir>/plugins/<manifest.id>
 */
export async function unpackBundledAssets(plugin: any): Promise<void> {
  try {
    const adapter: any = plugin.app.vault.adapter;
    const base: string = adapter?.basePath || adapter?.getBasePath?.() || "";
    if (!base) return;
    const pluginDir = nodePath.join(base, plugin.app.vault.configDir, "plugins", plugin.manifest.id);

    for (const asset of EMBEDDED_ASSETS) {
      const abs = nodePath.join(pluginDir, ...asset.rel.split("/"));
      try {
        await fs.access(abs);
        continue; // already present — never overwrite
      } catch {
        /* missing — fall through and write it */
      }
      await fs.mkdir(nodePath.dirname(abs), { recursive: true });
      await fs.writeFile(abs, Buffer.from(asset.b64, "base64"));
    }
  } catch (e) {
    console.warn("[hwp-writer] bundled asset unpack failed:", e);
  }
}
