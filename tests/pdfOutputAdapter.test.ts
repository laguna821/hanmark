import assert from "node:assert/strict";
import { test } from "node:test";
import { createDesktopPdfOutputAdapter } from "../src/io/pdfOutputAdapter";

test("direct PDF uses explicit CSS geometry and copies host bytes", async () => {
  const original = new TextEncoder().encode("%PDF-1.7 test");
  const adapter = createDesktopPdfOutputAdapter(() => ({
    getCurrentWebContents: () => ({ printToPDF: async (options: Record<string, unknown>) => {
      assert.equal(options.preferCSSPageSize, true);
      assert.equal(options.printBackground, true);
      assert.equal(options.displayHeaderFooter, false);
      assert.equal(options.scale, 1);
      assert.equal(options.margins, undefined);
      return original;
    } })
  }));
  const bytes = await adapter.render({} as Window);
  assert.deepEqual(bytes, original);
  assert.notEqual(bytes.buffer, original.buffer);
});

test("unsupported hosts and invalid results fail without invoking native print", async () => {
  for (const value of [null, {}, { getCurrentWebContents: () => ({}) },
    { getCurrentWebContents: () => ({ printToPDF: async () => new Uint8Array([1]) }) }]) {
    await assert.rejects(createDesktopPdfOutputAdapter(() => value).render({} as Window));
  }
  await assert.rejects(createDesktopPdfOutputAdapter(() => { throw new Error("unavailable"); }).render({} as Window));
});
