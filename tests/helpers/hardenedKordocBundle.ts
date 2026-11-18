import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import {
  blockedFileSystemPlugin,
  dependencySourceHardeningPlugin,
  kordocSourceHardeningPlugin,
  options as productionOptions
} from "../../esbuild.config.mjs";

export interface HardenedBundle<T> {
  /** The bundle text, for assertions about what main.js would contain. */
  text: string;
  runtime: T;
  dispose(): Promise<void>;
}

/**
 * Bundles a small entry file exactly the way main.js is built (same source
 * hardening plugins, banner, and defines) and loads it. Tests use this to prove a
 * Kordoc feature works inside the plugin bundle, not only in node_modules.
 */
export async function loadHardenedKordocBundle<T>(entry: string): Promise<HardenedBundle<T>> {
  const directory = await mkdtemp(join(tmpdir(), "hanmark-hardened-kordoc-"));
  const outputPath = join(directory, "bundle.cjs");
  const result = await build({
    stdin: {
      contents: entry,
      resolveDir: process.cwd(),
      sourcefile: "hardened-kordoc-entry.ts",
      loader: "ts"
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "es2018",
    write: false,
    logLevel: "silent",
    define: productionOptions.define,
    banner: productionOptions.banner,
    plugins: [blockedFileSystemPlugin, kordocSourceHardeningPlugin, dependencySourceHardeningPlugin]
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error("esbuild produced no hardened bundle");
  await writeFile(outputPath, output.contents);
  const runtime = createRequire(import.meta.url)(outputPath) as T;
  return {
    text: output.text,
    runtime,
    dispose: () => rm(directory, { recursive: true, force: true })
  };
}
