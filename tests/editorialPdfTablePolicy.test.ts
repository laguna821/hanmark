import assert from "node:assert/strict";
import { test } from "node:test";
import { choosePdfTableWidth, type PdfTableMetrics } from "../src/io/editorialPdfTablePolicy";

const metric = (patch: Partial<PdfTableMetrics> = {}): PdfTableMetrics => ({
  height: 200, overflow: false, maxRowHeight: 40, headerLines: [1, 1],
  bodyLines: [1, 1, 1, 1], ...patch
});
test("table width does not depend on row count or total text length", () => {
  assert.equal(choosePdfTableWidth(metric({ height: 2000, bodyLines: Array(500).fill(1) }), metric({ height: 2000 }), 950), "column");
});
test("table overflow and oversized rows promote only when full width resolves them", () => {
  assert.equal(choosePdfTableWidth(metric({ overflow: true }), metric(), 950), "full");
  assert.equal(choosePdfTableWidth(metric({ maxRowHeight: 951 }), metric(), 950), "full");
  assert.equal(choosePdfTableWidth(metric({ overflow: true }), metric({ overflow: true }), 950), "column");
});
test("table width honors exact header and density thresholds and excludes empty cells", () => {
  assert.equal(choosePdfTableWidth(metric({ headerLines: [3, 1] }), metric({ headerLines: [2, 1] }), 950), "full");
  assert.equal(choosePdfTableWidth(metric({ headerLines: [3, 1] }), metric({ headerLines: [3, 1] }), 950), "column");
  assert.equal(choosePdfTableWidth(metric({ bodyLines: [4, 1, 1, 1, 1, 0] }), metric({ height: 150 }), 950), "full");
  assert.equal(choosePdfTableWidth(metric({ bodyLines: [4, 1, 1, 1, 1] }), metric({ height: 150.1 }), 950), "column");
  assert.equal(choosePdfTableWidth(metric({ bodyLines: [4, 1, 1, 1, 1, 1] }), metric({ height: 150 }), 950), "column");
});
test("one very long cell can promote, but hard breaks without improvement do not", () => {
  assert.equal(choosePdfTableWidth(metric({ bodyLines: [8, 1] }), metric({ bodyLines: [4, 1] }), 950), "full");
  assert.equal(choosePdfTableWidth(metric({ bodyLines: [8, 1] }), metric({ bodyLines: [8, 1] }), 950), "column");
});
