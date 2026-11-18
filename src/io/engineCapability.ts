import { tKey, type MessageKey } from "../i18n";

/**
 * What the engines need from the Obsidian installer (its Electron/Chromium), not from
 * the app version (R-037). An app that updated itself keeps the installer it came with:
 * app 1.8.9 can still run on Electron 21 (Chromium 106).
 *
 * - "wasm": WebAssembly at all (PDF engine, XML parser).
 * - "wasm-sync": Kordoc's XML parser compiles a 98 KB module with
 *   `new WebAssembly.Module` on the main thread. Chromium up to 114 refuses that above
 *   4 KB ("WebAssembly.Compile is disallowed on the main thread, if the buffer size is
 *   larger than 4KB"); from Chromium 115 the limit is 8 MB (kWasmWireBytesLimit in
 *   third_party/blink/renderer/bindings/core/v8/v8_initializer.cc). Electron 26 is the
 *   first with Chromium 116.
 * - "canvas-png": drawing a diagram to a PNG picture (`canvas.toBlob`).
 */
export type EngineCapability = "wasm" | "wasm-sync" | "canvas-png";
export type EngineFeature = "documents" | "pdf" | "diagrams";

export interface CapabilityScope {
  WebAssembly?: { Module?: new (bytes: Uint8Array) => unknown; compile?: unknown };
  HTMLCanvasElement?: { prototype?: { toBlob?: unknown } };
}

const NEEDS: Readonly<Record<EngineFeature, readonly EngineCapability[]>> = {
  // Reading and writing HWPX, DOCX, PPTX and XLSX all go through the XML parser.
  documents: ["wasm", "wasm-sync"],
  pdf: ["wasm", "wasm-sync"],
  diagrams: ["canvas-png"]
};

const MESSAGES: Readonly<Record<EngineFeature, MessageKey>> = {
  documents: "capability.documents",
  pdf: "capability.pdf",
  diagrams: "capability.diagrams"
};

/** The synchronous-compile probe is larger than the old 4 KB limit and compiles to nothing. */
export const SYNC_PROBE_BYTES = 8192;

/** A valid, empty WebAssembly module padded by one custom section to `size` bytes. */
export function paddedWasmModule(size = SYNC_PROBE_BYTES): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  // Custom section (id 0): two-byte LEB128 payload length, then a one-letter name.
  const payload = size - 11;
  bytes[8] = 0x00;
  bytes[9] = (payload & 0x7f) | 0x80;
  bytes[10] = payload >> 7;
  bytes[11] = 0x01;
  bytes[12] = 0x70;
  return bytes;
}

/** The Obsidian window; outside a browser (tests, tools) only WebAssembly is looked at. */
function hostScope(): CapabilityScope {
  return typeof window === "undefined"
    ? { WebAssembly: WebAssembly as unknown as CapabilityScope["WebAssembly"] }
    : (window as unknown as CapabilityScope);
}

/** Capabilities this installer lacks; empty when everything is there. */
export function missingEngineCapabilities(scope: CapabilityScope = hostScope()): EngineCapability[] {
  const missing: EngineCapability[] = [];
  const wasm = scope.WebAssembly;
  if (!wasm || typeof wasm.Module !== "function" || typeof wasm.compile !== "function") {
    missing.push("wasm", "wasm-sync");
  } else {
    try {
      new wasm.Module(paddedWasmModule());
    } catch {
      missing.push("wasm-sync");
    }
  }
  // Outside a browser window (tests, tools) there is no canvas; only its absence where a
  // canvas type exists counts.
  const canvas = scope.HTMLCanvasElement;
  if (canvas && typeof canvas.prototype?.toBlob !== "function") missing.push("canvas-png");
  return missing;
}

let cached: EngineCapability[] | undefined;

function current(scope?: CapabilityScope): EngineCapability[] {
  if (scope) return missingEngineCapabilities(scope);
  cached ??= missingEngineCapabilities();
  return cached;
}

/** Why a feature cannot run on this installer, or null when it can. */
export function engineCapabilityProblem(feature: EngineFeature, scope?: CapabilityScope): string | null {
  const missing = current(scope);
  return NEEDS[feature].some((need) => missing.includes(need)) ? tKey(MESSAGES[feature]) : null;
}

/** Stops a feature with a message the user can act on instead of an engine exception. */
export function assertEngineCapability(feature: EngineFeature, scope?: CapabilityScope): void {
  const problem = engineCapabilityProblem(feature, scope);
  if (problem) throw new Error(problem);
}

/** One message for the start of the plugin; null when nothing is missing. */
export function startupCapabilityNotice(scope?: CapabilityScope): string | null {
  const problems = (["documents", "diagrams"] as const)
    .map((feature) => engineCapabilityProblem(feature, scope))
    .filter((message): message is string => message !== null);
  return problems.length ? problems.join("\n") : null;
}
