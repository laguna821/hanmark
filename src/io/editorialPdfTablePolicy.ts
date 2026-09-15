/** Measurements from the same complete table at two candidate widths. */
export interface PdfTableMetrics {
  height: number;
  overflow: boolean;
  maxRowHeight: number;
  headerLines: number[];
  bodyLines: number[];
}

export function choosePdfTableWidth(
  column: PdfTableMetrics, full: PdfTableMetrics, pageHeight: number
): "column" | "full" {
  if ((column.overflow && !full.overflow) ||
      (column.maxRowHeight > pageHeight && full.maxRowHeight <= pageHeight)) return "full";
  if (Math.max(0, ...column.headerLines) >= 3 && Math.max(0, ...full.headerLines) <= 2) return "full";
  const nonempty = column.bodyLines.filter(lines => lines > 0);
  if (nonempty.length && nonempty.filter(lines => lines >= 4).length / nonempty.length >= 0.2 &&
      full.height <= column.height * 0.75) return "full";
  if ([...column.headerLines, ...column.bodyLines].some((lines, index) =>
    lines >= 8 && [...full.headerLines, ...full.bodyLines][index] <= lines / 2)) return "full";
  return "column";
}
