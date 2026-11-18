import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SYNC_PROBE_BYTES,
  assertEngineCapability,
  engineCapabilityProblem,
  missingEngineCapabilities,
  paddedWasmModule,
  startupCapabilityNotice,
  type CapabilityScope
} from "../src/io/engineCapability";
import { setUiLocale } from "../src/i18n";

/** Chromium up to 114: synchronous compile on the main thread refused above 4 KB. */
const OLD_CHROMIUM: CapabilityScope = {
  WebAssembly: {
    Module: class {
      constructor(bytes: Uint8Array) {
        if (bytes.byteLength > 4096) {
          throw new RangeError("WebAssembly.Compile is disallowed on the main thread, if the buffer size is larger than 4KB.");
        }
      }
    },
    compile: () => Promise.resolve({})
  },
  HTMLCanvasElement: { prototype: { toBlob: () => undefined } }
};

describe("engine capabilities of the installer (R-037)", () => {
  it("probes with a valid module larger than the old 4 KB limit", () => {
    const bytes = paddedWasmModule();
    assert.equal(bytes.byteLength, SYNC_PROBE_BYTES);
    assert.ok(bytes.byteLength > 4096);
    assert.ok(new WebAssembly.Module(bytes) instanceof WebAssembly.Module, "the probe module is valid WebAssembly");
    assert.deepEqual(WebAssembly.Module.exports(new WebAssembly.Module(bytes)), []);
  });

  it("finds nothing missing where the engines run", () => {
    assert.deepEqual(missingEngineCapabilities(), []);
    assert.equal(engineCapabilityProblem("documents"), null);
    assert.equal(startupCapabilityNotice(), null);
    assert.doesNotThrow(() => assertEngineCapability("pdf"));
  });

  it("names the installer when synchronous compile is refused, in both languages", () => {
    assert.deepEqual(missingEngineCapabilities(OLD_CHROMIUM), ["wasm-sync"]);
    setUiLocale("ko");
    assert.match(engineCapabilityProblem("documents", OLD_CHROMIUM)!, /Obsidian 설치 프로그램을 새로 받아 설치하세요/u);
    assert.match(engineCapabilityProblem("pdf", OLD_CHROMIUM)!, /PDF.*Obsidian 설치 프로그램을 새로 받아 설치하세요/u);
    assert.equal(engineCapabilityProblem("diagrams", OLD_CHROMIUM), null);
    assert.throws(() => assertEngineCapability("documents", OLD_CHROMIUM), /설치 프로그램/u);
    assert.match(startupCapabilityNotice(OLD_CHROMIUM)!, /문서 엔진/u);
    setUiLocale("en");
    assert.match(engineCapabilityProblem("documents", OLD_CHROMIUM)!, /Download the Obsidian installer/u);
    setUiLocale("ko");
  });

  it("reports missing WebAssembly and a canvas that cannot make a PNG", () => {
    assert.deepEqual(missingEngineCapabilities({}), ["wasm", "wasm-sync"]);
    const noBlob: CapabilityScope = { WebAssembly, HTMLCanvasElement: { prototype: {} } };
    assert.deepEqual(missingEngineCapabilities(noBlob), ["canvas-png"]);
    assert.match(engineCapabilityProblem("diagrams", noBlob)!, /도식/u);
    assert.equal(engineCapabilityProblem("documents", noBlob), null);
  });
});