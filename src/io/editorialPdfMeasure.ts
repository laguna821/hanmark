/** DOM measurements use the same print declarations as the final PDF. */
export function createPdfElement<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K): HTMLElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/1999/xhtml", tag) as HTMLElementTagNameMap[K];
}

export function createPdfMeasurementStyle(source: HTMLStyleElement): HTMLStyleElement {
  const style = createPdfElement(source.ownerDocument, "style");
  const root = ".hanmark-editorial-pdf-root";
  const scoped = `${root}[data-pdf-measuring]`;
  const rules: string[] = [];
  const visit = (items: CSSRuleList): void => {
    for (const item of Array.from(items)) {
      // CSSStyleRule also exposes cssRules in Chromium with CSS nesting.
      // Read its own declarations before considering nested/grouping rules.
      if ("selectorText" in item) {
        const rule = item as CSSStyleRule;
        const selectors = rule.selectorText.split(",").filter(s => s.includes(root)).map(selector => {
          const at = selector.indexOf(root);
          // Remove only the host prefix. Retain every descendant selector and
          // declaration; the measurement root stays off-screen and hidden.
          return scoped + selector.slice(at + root.length);
        });
        if (selectors.length) rules.push(`${selectors.join(",")} { ${rule.style.cssText} }`);
      } else if ("cssRules" in item) {
        visit((item as CSSGroupingRule).cssRules);
      }
    }
  };
  if (!source.sheet) throw new Error("PDF 출력 스타일을 읽지 못했습니다.");
  visit(source.sheet.cssRules);
  rules.push(`${scoped} { position:absolute; inset:auto; left:-100000px; top:0; width:170mm; visibility:hidden; pointer-events:none; }`);
  rules.push(`${scoped} .hanmark-pdf-measure-box { display:flow-root; }`);
  style.textContent = rules.join("\n");
  return style;
}

export class PdfMeasurer {
  private box: HTMLDivElement;
  private heights = new WeakMap<HTMLElement, Map<number, number>>();

  constructor(private readonly body: HTMLElement) {
    this.box = createPdfElement(body.ownerDocument, "div");
    this.box.className = "hanmark-pdf-measure-box";
    body.appendChild(this.box);
  }

  height(node: HTMLElement, width: number): number {
    const cached = this.heights.get(node)?.get(width);
    if (cached !== undefined) return cached;
    this.box.style.width = `${width}px`;
    this.box.replaceChildren(node.cloneNode(true));
    const height = this.box.getBoundingClientRect().height;
    const sizes = this.heights.get(node) ?? new Map<number, number>();
    sizes.set(width, height);
    this.heights.set(node, sizes);
    return height;
  }

  split(node: HTMLElement, width: number, available: number): [HTMLElement, HTMLElement] | null {
    if (available < 36) return null;
    if (node.tagName === "TABLE") return this.splitTable(node as HTMLTableElement, width, available);
    this.box.style.width = `${width}px`;
    const copy = node.cloneNode(true) as HTMLElement;
    this.box.replaceChildren(copy);
    const document = node.ownerDocument;
    const walker = document.createTreeWalker(copy, 4 /* SHOW_TEXT */);
    const range = document.createRange();
    const lines: Array<{ node: Text; end: number; bottom: number }> = [];
    const Segmenter = (Intl as unknown as { Segmenter: new (locale: undefined, options: { granularity: "grapheme" }) => {
      segment(value: string): Iterable<{ index: number; segment: string }>;
    } }).Segmenter;
    const segmenter = new Segmenter(undefined, { granularity: "grapheme" });
    let text: Node | null;
    while ((text = walker.nextNode())) {
      const leaf = text as Text;
      for (const part of segmenter.segment(leaf.data)) {
        range.setStart(leaf, part.index);
        range.setEnd(leaf, part.index + part.segment.length);
        const rects = range.getClientRects();
        const rect = rects[rects.length - 1];
        if (!rect || rect.height === 0) continue;
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.bottom - rect.bottom) < 2) {
          last.node = leaf; last.end = part.index + part.segment.length;
        } else lines.push({ node: leaf, end: part.index + part.segment.length, bottom: rect.bottom });
      }
    }
    if (lines.length < 6) return null;
    const origin = this.box.getBoundingClientRect().top;
    let cutIndex = lines.findLastIndex(line => line.bottom - origin <= available - 1);
    cutIndex = Math.min(cutIndex, lines.length - 4);
    // Preserve three lines on either side when splitting paragraphs/containers.
    for (; cutIndex >= 2; cutIndex--) {
      const cut = lines[cutIndex];
      range.selectNodeContents(copy);
      range.setEnd(cut.node, cut.end);
      const head = copy.cloneNode(false) as HTMLElement;
      head.appendChild(range.cloneContents());
      range.selectNodeContents(copy);
      range.setStart(cut.node, cut.end);
      const tail = copy.cloneNode(false) as HTMLElement;
      tail.appendChild(range.cloneContents());
      tail.setAttribute("data-pdf-continuation", "true");
      const continuedItem = tail.querySelector("li");
      if (continuedItem) continuedItem.setAttribute("data-pdf-continued-item", "true");
      if (!head.textContent || !tail.textContent) continue;
      if (this.height(head, width) <= available + 0.1) return [head, tail];
      // height() reuses the box; reattach the source before creating a Range.
      this.box.replaceChildren(copy);
    }
    return null;
  }

  private splitTable(table: HTMLTableElement, width: number, available: number): [HTMLElement, HTMLElement] | null {
    const rows = Array.from(table.tBodies[0]?.rows ?? []);
    for (let count = rows.length - 1; count > 0; count--) {
      const head = table.cloneNode(true) as HTMLTableElement;
      const tail = table.cloneNode(true) as HTMLTableElement;
      for (const row of Array.from(head.tBodies[0].rows).slice(count)) row.remove();
      for (const row of Array.from(tail.tBodies[0].rows).slice(0, count)) row.remove();
      tail.setAttribute("data-pdf-continuation", "true");
      tail.tHead?.setAttribute("data-pdf-repeated-header", "true");
      if (this.height(head, width) <= available) return [head, tail];
    }
    return null;
  }

  /** The legacy row estimate assumes a full-width page. Recheck at column width. */
  expandTallTable(table: HTMLTableElement, width: number, pageHeight: number): HTMLElement {
    const rows = Array.from(table.tBodies[0]?.rows ?? []);
    const tooTall = rows.some((_, index) => {
      const probe = table.cloneNode(true) as HTMLTableElement;
      Array.from(probe.tBodies[0].rows).forEach((row, i) => { if (i !== index) row.remove(); });
      return this.height(probe, width) > pageHeight;
    });
    if (!tooTall) return table;
    const document = table.ownerDocument;
    const result = createPdfElement(document, "div");
    result.className = "hanmark-editorial-pdf-table-fallback";
    result.dataset.pdfSourceId = table.dataset.pdfSourceId;
    if (table.tHead) {
      const heading = table.cloneNode(false) as HTMLTableElement;
      heading.appendChild(table.tHead.cloneNode(true)); result.append(heading);
    }
    const headers = Array.from(table.tHead?.rows[0]?.cells ?? []);
    for (const row of rows) {
      const card = createPdfElement(document, "div");
      card.className = "hanmark-editorial-pdf-table-fallback-row";
      Array.from(row.cells).forEach((cell, index) => {
        const label = createPdfElement(document, "div");
        label.className = "hanmark-editorial-pdf-table-fallback-label";
        label.setAttribute("data-pdf-repeated-header", "true");
        label.textContent = headers[index]?.textContent ?? String(index + 1);
        const value = createPdfElement(document, "div");
        value.className = "hanmark-editorial-pdf-table-fallback-value";
        for (const child of Array.from(cell.childNodes)) value.appendChild(child.cloneNode(true));
        card.append(label, value);
      });
      result.append(card);
    }
    return result;
  }

  dispose(): void { this.box.remove(); }
}
