import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_EDITORIAL_PDF_LAYOUT, normalizeEditorialPdfLayout } from "../src/io/editorialPdfLayout";
import { normalizeHanmarkSettings } from "../src/legacy-port/settings";

test("v9 settings migrate to conservative independent PDF layout defaults", () => {
  const settings = normalizeHanmarkSettings({ settingsVersion: 9 });
  assert.equal(settings.settingsVersion, 11);
  assert.deepEqual(settings.editorialPdfLayout, DEFAULT_EDITORIAL_PDF_LAYOUT);
  assert.deepEqual(normalizeHanmarkSettings(settings), settings);
});
test("PDF layout validates unknown persisted fields and keeps each export independent", () => {
  assert.deepEqual(normalizeEditorialPdfLayout({ mode: "bad", columnGapMm: 0, sectionPageBreaks: "true" }), DEFAULT_EDITORIAL_PDF_LAYOUT);
  const layout = normalizeEditorialPdfLayout({ mode: "two-column-b", columnGapMm: 12, sectionPageBreaks: true });
  assert.equal(layout.mode, "two-column-b");
  assert.equal(layout.columnGapMm, 12);
  assert.equal(layout.sectionPageBreaks, true);
  layout.columnGapMm = 8;
  assert.equal(DEFAULT_EDITORIAL_PDF_LAYOUT.columnGapMm, 10);
});

test("v10 layout migrates to auto tables while retaining the selected layout", () => {
  const result = normalizeHanmarkSettings({ settingsVersion: 10, editorialPdfLayout: { mode: "two-column-a", columnGapMm: 8, sectionPageBreaks: true } });
  assert.equal(result.settingsVersion, 11);
  assert.deepEqual(result.editorialPdfLayout, { mode: "two-column-a", columnGapMm: 8, sectionPageBreaks: true, tableWidth: "auto" });
  for (const tableWidth of ["auto", "column", "full"] as const) {
    assert.equal(normalizeEditorialPdfLayout({ tableWidth }).tableWidth, tableWidth);
  }
  assert.equal(normalizeEditorialPdfLayout({ tableWidth: "invalid" }).tableWidth, "auto");
});
