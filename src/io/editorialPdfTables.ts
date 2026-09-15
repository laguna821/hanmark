import { createPdfElement, type PdfMeasurer } from "./editorialPdfMeasure";
import { choosePdfTableWidth, type PdfTableMetrics } from "./editorialPdfTablePolicy";
import type { EditorialPdfLayout } from "./editorialPdfLayout";

export function findPdfTable(node: HTMLElement): HTMLTableElement | null {
  return node.tagName === "TABLE" ? node as HTMLTableElement : node.querySelector("table");
}

/** Read actual line boxes, including styled inline text, without counting it twice. */
function cellLines(cell: HTMLTableCellElement): { lines: number; overflow: boolean } {
  const rect = cell.getBoundingClientRect();
  const bottoms: number[] = [];
  let overflow = false;
  const walker = cell.ownerDocument.createTreeWalker(cell, 4);
  const range = cell.ownerDocument.createRange();
  let leaf: Node | null;
  while ((leaf = walker.nextNode())) {
    if (!leaf.textContent?.trim()) continue;
    range.selectNodeContents(leaf);
    for (const box of Array.from(range.getClientRects())) {
      if (!box.width || !box.height) continue;
      if (!bottoms.some(bottom => Math.abs(bottom - box.bottom) < 3)) bottoms.push(box.bottom);
      if (box.left < rect.left - 1 || box.right > rect.right + 1 ||
          box.top < rect.top - 1 || box.bottom > rect.bottom + 1) overflow = true;
    }
  }
  for (const image of Array.from(cell.querySelectorAll("img"))) {
    const box = image.getBoundingClientRect();
    if (box.left < rect.left - 1 || box.right > rect.right + 1 || box.bottom > rect.bottom + 1) overflow = true;
  }
  return { lines: bottoms.length, overflow };
}

export function pdfTableCellOverflows(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLTableCellElement>("th,td"))
    .filter(cell => cellLines(cell).overflow).map(cell => cell.dataset.pdfCellId ?? "unidentified");
}

function measureTable(node: HTMLElement, width: number, measure: PdfMeasurer) {
  return measure.inspect(node, width, copy => {
    const table = findPdfTable(copy)!;
    table.classList.add("hanmark-pdf-table-probe");
    const cells = Array.from(table.rows).flatMap(row => Array.from(row.cells));
    const readings = cells.map(cell => ({ ...cellLines(cell), header: cell.parentElement?.parentElement === table.tHead }));
    const tableRect = table.getBoundingClientRect();
    const headerHeight = table.tHead?.getBoundingClientRect().height ?? 0;
    const outerHeight = copy.parentElement!.getBoundingClientRect().height;
    const overhead = Math.max(0, outerHeight - tableRect.height);
    const metrics: PdfTableMetrics = {
      height: outerHeight,
      overflow: readings.some(value => value.overflow) || tableRect.width > width + 1,
      maxRowHeight: Math.max(headerHeight, ...Array.from(table.tBodies[0]?.rows ?? [], row => row.getBoundingClientRect().height + headerHeight)) + overhead,
      headerLines: readings.filter(value => value.header).map(value => value.lines),
      bodyLines: readings.filter(value => !value.header).map(value => value.lines)
    };
    const widths = Array.from(table.rows[0]?.cells ?? [], cell => cell.getBoundingClientRect().width);
    return { metrics, widths };
  });
}

function verticalTable(table: HTMLTableElement): HTMLElement {
  const document = table.ownerDocument;
  const result = createPdfElement(document, "div");
  result.className = "hanmark-editorial-pdf-table-fallback";
  result.dataset.pdfTableId = table.dataset.pdfTableId;
  const headers = Array.from(table.tHead?.rows[0]?.cells ?? []);
  if (table.tHead) {
    const header = createPdfElement(document, "div");
    header.className = "hanmark-editorial-pdf-table-fallback-row";
    for (const cell of headers) {
      const value = createPdfElement(document, "div");
      value.dataset.pdfCellId = cell.dataset.pdfCellId;
      value.append(...Array.from(cell.childNodes, child => child.cloneNode(true)));
      header.append(value);
    }
    result.append(header);
  }
  for (const row of Array.from(table.tBodies[0]?.rows ?? [])) {
    const record = createPdfElement(document, "div");
    record.className = "hanmark-editorial-pdf-table-fallback-row";
    record.dataset.pdfRowId = row.dataset.pdfRowId;
    Array.from(row.cells).forEach((cell, index) => {
      const label = createPdfElement(document, "div");
      label.className = "hanmark-editorial-pdf-table-fallback-label";
      label.dataset.pdfRepeatedHeader = "true";
      label.textContent = headers[index]?.textContent ?? String(index + 1);
      const value = createPdfElement(document, "div");
      value.className = "hanmark-editorial-pdf-table-fallback-value";
      value.dataset.pdfCellId = cell.dataset.pdfCellId;
      value.append(...Array.from(cell.childNodes, child => child.cloneNode(true)));
      record.append(label, value);
    });
    result.append(record);
  }
  return result;
}

export function preparePdfTable(
  node: HTMLElement, id: string, measure: PdfMeasurer, columnWidth: number,
  fullWidth: number, pageHeight: number, policy: EditorialPdfLayout["tableWidth"]
): { node: HTMLElement; width: "column" | "full" } {
  const table = findPdfTable(node)!;
  table.dataset.pdfTableId = id;
  Array.from(table.rows).forEach((row, rowIndex) => {
    row.dataset.pdfRowId = `${id}:r${rowIndex}`;
    Array.from(row.cells).forEach((cell, index) => { cell.dataset.pdfCellId = `${id}:r${rowIndex}:c${index}`; });
  });
  const column = measureTable(node, columnWidth, measure);
  const full = measureTable(node, fullWidth, measure);
  const width = policy === "auto" ? choosePdfTableWidth(column.metrics, full.metrics, pageHeight) : policy;
  const chosen = width === "full" ? full : column;
  const colgroup = createPdfElement(table.ownerDocument, "colgroup");
  for (const pixels of chosen.widths) {
    const col = createPdfElement(table.ownerDocument, "col");
    col.style.width = `${pixels}px`; colgroup.append(col);
  }
  table.prepend(colgroup);
  if (chosen.metrics.overflow || chosen.metrics.maxRowHeight > pageHeight) {
    const fallback = verticalTable(table);
    fallback.dataset.pdfSourceId = node.dataset.pdfSourceId;
    if (node === table) node = fallback;
    else table.replaceWith(fallback);
  }
  node.dataset.pdfTableWidth = width;
  node.dataset.pdfTableId = id;
  return { node, width };
}
