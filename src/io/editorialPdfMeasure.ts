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

  inspect<T>(node: HTMLElement, width: number, read: (copy: HTMLElement) => T): T {
    this.box.style.width = `${width}px`;
    const copy = node.cloneNode(true) as HTMLElement;
    this.box.replaceChildren(copy);
    return read(copy);
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
    if (node.tagName === "TABLE" || node.querySelector("table")) return this.splitTable(node, width, available);
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

  private splitTable(node: HTMLElement, width: number, available: number): [HTMLElement, HTMLElement] | null {
    const getTable = (root: HTMLElement): HTMLTableElement | null =>
      root.tagName === "TABLE" ? root as HTMLTableElement : root.querySelector("table");
    const table = getTable(node);
    const rows = table?.tBodies[0]?.rows;
    if (!rows || rows.length < 2) return null;
    // Column widths are frozen before fragmentation, so prefix heights are monotonic.
    let low = 1, high = rows.length - 1;
    let best: [HTMLElement, HTMLElement] | null = null;
    while (low <= high) {
      const count = Math.floor((low + high) / 2);
      const head = node.cloneNode(true) as HTMLElement;
      const tail = node.cloneNode(true) as HTMLElement;
      const headTable = getTable(head)!;
      const tailTable = getTable(tail)!;
      for (const row of Array.from(headTable.tBodies[0].rows).slice(count)) row.remove();
      for (const row of Array.from(tailTable.tBodies[0].rows).slice(0, count)) row.remove();
      tail.setAttribute("data-pdf-continuation", "true");
      tail.querySelectorAll(".hanmark-pdf-table-lead").forEach(lead => lead.remove());
      tail.querySelectorAll("li").forEach(item => item.setAttribute("data-pdf-continued-item", "true"));
      tail.querySelectorAll("li > span[aria-hidden]").forEach(marker => marker.remove());
      tailTable.tHead?.setAttribute("data-pdf-repeated-header", "true");
      if (this.height(head, width) <= available) { best = [head, tail]; low = count + 1; }
      else high = count - 1;
    }
    return best;
  }

  dispose(): void { this.box.remove(); }
}
