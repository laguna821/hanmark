import { normalizeEditorialPdfLayout, type EditorialPdfLayout } from "./editorialPdfLayout";
import { createPdfElement, createPdfMeasurementStyle, PdfMeasurer } from "./editorialPdfMeasure";

const PX_PER_MM = 96 / 25.4;
const PAGE_WIDTH = 170 * PX_PER_MM;
// Sub-pixel clearance prevents a rounded wrapper from generating a blank page.
const PAGE_HEIGHT = 252.9 * PX_PER_MM;
const FIGURE_GAP = 4 * PX_PER_MM;
const ROOT = ".hanmark-editorial-pdf-root";
const BODY = ".hanmark-editorial-pdf-body";

interface FlowUnit {
  kind: "text" | "figure" | "boundary";
  node: HTMLElement;
  heading?: boolean;
}
interface Cursor { index: number; remainder?: HTMLElement; offset: number }
interface Slot { index: number; column: number; edge: "top" | "bottom"; node: HTMLElement; height: number }
interface Filled {
  cursor: Cursor;
  columns: HTMLElement[][];
  used: number[];
  encounter?: number;
  boundary?: boolean;
}

function clone(node: HTMLElement): HTMLElement { return node.cloneNode(true) as HTMLElement; }
function headingLevel(node: Element): number { return /^H[1-6]$/u.test(node.tagName) ? Number(node.tagName[1]) : 0; }

export function collectEditorialPdfFlow(body: HTMLElement): FlowUnit[] {
  const document = body.ownerDocument;
  const top = Array.from(body.children) as HTMLElement[];
  const levels = top.map(headingLevel).filter(Boolean);
  const highest = Math.min(...levels);
  const units: FlowUnit[] = [];
  const visit = (node: HTMLElement, wrappers: HTMLElement[] = []): void => {
    if (node.tagName === "P" && !node.textContent?.trim() && node.querySelector("img")) {
      for (const image of Array.from(node.querySelectorAll("img"))) {
        const figure = createPdfElement(document, "figure");
        figure.className = "hanmark-pdf-figure";
        figure.dataset.naturalWidth = String(image.naturalWidth);
        figure.dataset.naturalHeight = String(image.naturalHeight);
        const link = image.closest("a");
        if (link) { const copy = link.cloneNode(false); copy.appendChild(image.cloneNode(true)); figure.append(copy); }
        else figure.append(image.cloneNode(true));
        units.push({ kind: "figure", node: figure });
      }
      return;
    }
    if (node.matches("ul, ol")) {
      let number = Number(node.getAttribute("start") ?? 1);
      for (const item of Array.from(node.children) as HTMLElement[]) {
        const list = node.cloneNode(false) as HTMLElement;
        list.setAttribute("data-pdf-list-fragment", "true");
        if (item === node.firstElementChild) list.setAttribute("data-pdf-list-first", "true");
        if (item === node.lastElementChild) list.setAttribute("data-pdf-list-last", "true");
        if (node.tagName === "OL") list.setAttribute("start", String(number++));
        let first = true;
        const marker = item.querySelector(":scope > span[aria-hidden]");
        for (const child of Array.from(item.children) as HTMLElement[]) {
          if (child === marker) continue;
          const shell = item.cloneNode(false) as HTMLElement;
          if (!first) shell.setAttribute("data-pdf-continued-item", "true");
          else if (marker) shell.appendChild(marker.cloneNode(true));
          visit(child, [...wrappers, list, shell]);
          first = false;
        }
      }
      return;
    }
    if (node.matches("blockquote, aside, .hanmark-editorial-pdf-container-fallback, .hanmark-editorial-pdf-container-fallback-body") &&
        Array.from(node.querySelectorAll("p")).some(p => !p.textContent?.trim() && p.querySelector("img"))) {
      for (const child of Array.from(node.children) as HTMLElement[]) visit(child, [...wrappers, node]);
      return;
    }
    let result = clone(node);
    const originals = Array.from(node.querySelectorAll("img"));
    Array.from(result.querySelectorAll("img")).forEach((image, index) => {
      const original = originals[index];
      if (!image.closest("td, th") && original?.naturalWidth > 0 && original.naturalWidth <= 64 && original.naturalHeight <= 64) {
        image.classList.add("hanmark-pdf-inline-icon");
      }
    });
    for (const shell of wrappers.slice().reverse()) {
      const outer = shell.cloneNode(false) as HTMLElement;
      for (const marker of Array.from(shell.children)) {
        if (marker.matches("span[aria-hidden]")) outer.appendChild(marker.cloneNode(true));
      }
      outer.appendChild(result); result = outer;
    }
    units.push({ kind: "text", node: result, heading: Boolean(headingLevel(node)) });
  };
  let previousHeading = false;
  for (const node of top) {
    const level = headingLevel(node);
    if (level === highest && !previousHeading) units.push({ kind: "boundary", node });
    visit(node);
    previousHeading = Boolean(level);
  }
  // Consecutive headings must travel together, including emphasized title runs.
  for (let i = units.length - 2; i >= 0; i--) {
    if (units[i].heading && units[i + 1].heading) {
      const group = createPdfElement(document, "div");
      group.append(units[i].node, units[i + 1].node);
      units.splice(i, 2, { kind: "text", heading: true, node: group });
    }
  }
  units.forEach((unit, index) => unit.node.setAttribute("data-pdf-source-id", String(index)));
  return units;
}

export function createEditorialPdfFlowStyles(): string {
  const scope = `html body.hanmark-editorial-pdf-active > section${ROOT} ${BODY}[data-pdf-paged]`;
  return `
${scope} { margin:0; padding:0; width:170mm; }
${scope} .hanmark-pdf-page { position:relative; display:block; width:170mm; height:252.9mm; margin:0; padding:0; break-after:page; page:hanmark-body; }
${scope} .hanmark-pdf-page:last-child { break-after:auto; }
${scope} .hanmark-pdf-column { position:absolute; display:flow-root; margin:0; padding:0; }
${scope} .hanmark-pdf-unit { display:flow-root; margin:0; padding:0; }
${scope} .hanmark-pdf-figure { position:absolute; display:flow-root; margin:0; padding:0; border:0; }
${scope} .hanmark-pdf-figure img { display:block; width:100%; height:auto; max-height:none; margin:0; padding:0; }
${scope} img.hanmark-pdf-inline-icon { display:inline; width:auto; height:1.2em; margin:0; vertical-align:middle; }
${scope} [data-pdf-continuation] { margin-top:0; text-indent:0; }
${scope} [data-pdf-continued-item] { list-style:none; }
${scope} [data-pdf-list-fragment] { margin-top:0; margin-bottom:0; }
${scope} [data-pdf-list-first] { margin-top:0.35em; }
${scope} [data-pdf-list-last] { margin-bottom:0.8em; }
${scope} table { table-layout:fixed; max-width:100%; }
${scope} pre, ${scope} td, ${scope} th { overflow-wrap:anywhere; }
@media print { ${ROOT} ${BODY} [data-pdf-section-start] { break-before:page; } }
`;
}

class PageComposer {
  readonly width: number;
  constructor(
    private readonly units: FlowUnit[],
    private readonly layout: EditorialPdfLayout,
    private readonly measure: PdfMeasurer
  ) { this.width = (PAGE_WIDTH - layout.columnGapMm * PX_PER_MM) / 2; }

  slot(index: number, column: number, edge: "top" | "bottom"): Slot {
    const node = clone(this.units[index].node);
    const naturalWidth = Number(node.dataset.naturalWidth);
    const naturalHeight = Number(node.dataset.naturalHeight);
    if (!(naturalWidth > 0 && naturalHeight > 0)) throw new Error("PDF 그림 크기를 확인하지 못했습니다.");
    const target = this.layout.mode === "two-column-a" ? PAGE_WIDTH : this.width;
    const width = Math.min(target, (PAGE_HEIGHT - 2 * FIGURE_GAP) * naturalWidth / naturalHeight);
    const height = width * naturalHeight / naturalWidth;
    node.style.width = `${width}px`;
    node.style.height = `${height}px`;
    const image = node.querySelector("img");
    if (image) { image.style.width = `${width}px`; image.style.height = `${height}px`; }
    return { index, column, edge, node, height: height + 2 * FIGURE_GAP };
  }

  reserved(slots: Slot[], column: number, edge?: "top" | "bottom"): number {
    return slots.filter(s => (this.layout.mode === "two-column-a" || s.column === column) && (!edge || s.edge === edge))
      .reduce((sum, s) => sum + s.height, 0);
  }

  fill(start: Cursor, slots: Slot[], skipped: Set<number>, deferred = false): Filled {
    const cursor = { ...start };
    const columns: HTMLElement[][] = [[], []];
    const used = [0, 0];
    for (let column = 0; column < 2; column++) {
      const limit = PAGE_HEIGHT - this.reserved(slots, column);
      while (cursor.index < this.units.length) {
        const unit = this.units[cursor.index];
        if (unit.kind === "boundary") {
          const occupied = used[0] + used[1] > 0;
          const earlierFigure = slots.some(s => s.index < cursor.index) ||
            (deferred && [...skipped].some(index => index >= start.index && index < cursor.index));
          if (this.layout.sectionPageBreaks && (occupied || earlierFigure)) {
            return { cursor, columns, used, boundary: true };
          }
          cursor.index++; continue;
        }
        if (unit.kind === "figure") {
          if (!skipped.has(cursor.index)) return { cursor, columns, used, encounter: cursor.index };
          const anchor = createPdfElement(unit.node.ownerDocument, "span");
          anchor.dataset.pdfAnchor = String(cursor.index);
          columns[column].push(anchor);
          cursor.index++; continue;
        }
        const node = cursor.remainder ?? unit.node;
        const height = this.measure.height(node, this.width);
        const available = limit - used[column];
        const keep = unit.heading && this.units[cursor.index + 1]?.kind === "text" ? 3 * 18.6 : 0;
        if (height <= available + 0.1 && (height + keep <= available || height + keep > PAGE_HEIGHT)) {
          columns[column].push(node);
          used[column] += height;
          cursor.index++; cursor.remainder = undefined; cursor.offset = 0;
        } else {
          const split = !unit.heading || height > PAGE_HEIGHT
            ? this.measure.split(node, this.width, available) : null;
          if (split) {
            columns[column].push(split[0]);
            used[column] += this.measure.height(split[0], this.width);
            cursor.remainder = split[1];
            cursor.offset += split[0].textContent?.length ?? 0;
          }
          break;
        }
      }
    }
    return { cursor, columns, used };
  }

  progress(cursor: Cursor): number {
    return cursor.index + Math.min(0.999, cursor.offset / ((this.units[cursor.index]?.node.textContent?.length ?? 0) + 1));
  }

  occupied(filled: Filled, slots: Slot[]): number {
    return filled.used[0] + filled.used[1] + slots.reduce((sum, s) => sum + s.height * (this.layout.mode === "two-column-a" ? 2 : 1), 0);
  }

  rank(slot: Slot): number { return slot.column * 2 + (slot.edge === "top" ? 0 : 1); }

  compose(start: Cursor, emitted: Set<number>, pending?: number): { filled: Filled; slots: Slot[]; pending?: number; skipped: Set<number> } {
    const skipped = new Set(emitted);
    const dueAnchors = [...emitted].filter(index => index >= start.index);
    let slots = pending === undefined ? [] : [this.slot(pending, 0, "top")];
    if (pending !== undefined) skipped.add(pending);
    let filled = this.fill(start, slots, skipped);
    for (let count = 0; filled.encounter !== undefined && count <= this.units.length; count++) {
      const index = filled.encounter;
      const withFigure = new Set(skipped).add(index);
      const candidates: Array<{ filled: Filled; slots: Slot[]; pending?: number; score: number; occupied: number }> = [];
      const firstNode = this.units[start.index];
      for (const column of this.layout.mode === "two-column-a" ? [0] : [0, 1]) {
        for (const edge of ["top", "bottom"] as const) {
          // A new section opens with its heading; put its first figure below it.
          if (this.layout.sectionPageBreaks && edge === "top" && (firstNode?.kind === "boundary" || firstNode?.heading)) continue;
          const slot = this.slot(index, column, edge);
          if (slots.length && this.rank(slot) < this.rank(slots[slots.length - 1])) continue;
          const proposed = [...slots, slot];
          if ([0, 1].some(c => this.reserved(proposed, c) > PAGE_HEIGHT + 0.1)) continue;
          const trial = this.fill(start, proposed, withFigure);
          if (dueAnchors.some(anchor => trial.cursor.index <= anchor)) continue;
          // A top float may push its anchor text onto the following page.
          // Keep a new section's opening heading on its own first page.
          if (this.layout.sectionPageBreaks && (firstNode?.kind === "boundary" || firstNode?.heading) && trial.cursor.index <= index) continue;
          const next = this.fill(trial.cursor, [], withFigure);
          candidates.push({ filled: trial, slots: proposed, score: this.progress(next.cursor), occupied: this.occupied(trial, proposed) });
        }
      }
      const deferred = this.fill(start, slots, withFigure, true);
      const next = this.fill(deferred.cursor, [this.slot(index, 0, "top")], withFigure);
      if (this.occupied(deferred, slots) > 0) {
        candidates.push({ filled: deferred, slots, pending: index, score: this.progress(next.cursor), occupied: this.occupied(deferred, slots) });
      }
      candidates.sort((a, b) => b.score - a.score || b.occupied - a.occupied || Number(a.pending !== undefined) - Number(b.pending !== undefined));
      const chosen = candidates[0];
      if (!chosen) {
        // Close a partly filled page before placing this figure on a fresh one.
        return { filled, slots, skipped };
      }
      skipped.add(index);
      slots = chosen.slots;
      filled = chosen.filled;
      if (chosen.pending !== undefined) return { filled, slots, skipped, pending: chosen.pending };
    }
    return { filled, slots, skipped };
  }

  render(document: Document, filled: Filled, slots: Slot[], pageNumber: number): HTMLElement {
    const page = createPdfElement(document, "div");
    page.className = "hanmark-pdf-page";
    page.dataset.pdfPage = String(pageNumber);
    for (let column = 0; column < 2; column++) {
      const container = createPdfElement(document, "div");
      container.className = "hanmark-pdf-column";
      container.dataset.pdfColumn = String(column);
      container.style.left = `${column * (this.width + this.layout.columnGapMm * PX_PER_MM)}px`;
      container.style.top = `${this.reserved(slots, column, "top")}px`;
      container.style.width = `${this.width}px`;
      for (const node of filled.columns[column]) {
        const wrapper = createPdfElement(document, "div");
        wrapper.className = "hanmark-pdf-unit";
        wrapper.dataset.pdfMeasuredHeight = String(this.measure.height(node, this.width));
        wrapper.append(clone(node)); container.append(wrapper);
      }
      page.append(container);
    }
    const consumed = new Map<string, number>();
    for (const slot of slots) {
      const key = `${slot.column}-${slot.edge}`;
      const before = consumed.get(key) ?? 0;
      const base = slot.edge === "top" ? 0 : PAGE_HEIGHT - this.reserved(slots, slot.column, "bottom");
      slot.node.style.top = `${base + before + FIGURE_GAP}px`;
      const width = Number.parseFloat(slot.node.style.width);
      const target = this.layout.mode === "two-column-a" ? PAGE_WIDTH : this.width;
      const left = slot.column * (this.width + this.layout.columnGapMm * PX_PER_MM) + (target - width) / 2;
      slot.node.style.left = `${left}px`;
      page.append(slot.node);
      consumed.set(key, before + slot.height);
    }
    return page;
  }
}

/** Creates final page DOM; reading order stays in DOM order within each column. */
export async function layoutEditorialPdf(
  root: HTMLElement, sourceStyle: HTMLStyleElement, value?: EditorialPdfLayout
): Promise<void> {
  const layout = normalizeEditorialPdfLayout(value);
  if (layout.mode === "single" && !layout.sectionPageBreaks) return;
  const body = root.querySelector<HTMLElement>(BODY);
  if (!body) throw new Error("PDF 본문이 없습니다.");
  sourceStyle.textContent += createEditorialPdfFlowStyles();
  if (layout.mode === "single") {
    const children = Array.from(body.children);
    const highest = Math.min(...children.map(headingLevel).filter(Boolean));
    children.forEach((node, index) => {
      if (index > 0 && headingLevel(node) === highest && !headingLevel(children[index - 1])) {
        node.setAttribute("data-pdf-section-start", "true");
      }
    });
    return;
  }
  const units = collectEditorialPdfFlow(body);
  body.setAttribute("data-pdf-paged", layout.mode);
  const measurementStyle = createPdfMeasurementStyle(sourceStyle);
  root.setAttribute("data-pdf-measuring", "true");
  root.ownerDocument.head.append(measurementStyle);
  const measurer = new PdfMeasurer(body);
  const composer = new PageComposer(units, layout, measurer);
  let cursor: Cursor = { index: 0, offset: 0 };
  let emitted = new Set<number>();
  let pending: number | undefined;
  const pages: HTMLElement[] = [];
  try {
    const view = root.ownerDocument.defaultView;
    if (!view) throw new Error("PDF 출력 창이 닫혔습니다.");
    for (const unit of units) {
      if (unit.node.tagName === "TABLE") unit.node = measurer.expandTallTable(unit.node as HTMLTableElement, composer.width, PAGE_HEIGHT);
    }
    let pageNumber = 0;
    while (cursor.index < units.length || pending !== undefined) {
      if (!root.isConnected) throw new Error("PDF 내보내기가 취소되었습니다.");
      const result = composer.compose(cursor, emitted, pending);
      const occupied = composer.occupied(result.filled, result.slots);
      if (occupied <= 0 && composer.progress(result.filled.cursor) <= composer.progress(cursor)) {
        throw new Error("PDF 한 단에 배치할 수 없는 블록이 있습니다. 표의 긴 셀이나 제목 길이를 확인하세요.");
      }
      if (occupied > 0) pages.push(composer.render(root.ownerDocument, result.filled, result.slots, ++pageNumber));
      cursor = result.filled.cursor; emitted = result.skipped; pending = result.pending;
      if (pageNumber > 5000) throw new Error("PDF 페이지 수가 조판 한도를 초과했습니다.");
      await new Promise<void>(resolve => view.setTimeout(resolve, 0));
    }
    body.replaceChildren(...pages);
  } finally {
    measurer.dispose();
    measurementStyle.remove();
    root.removeAttribute("data-pdf-measuring");
  }
}
