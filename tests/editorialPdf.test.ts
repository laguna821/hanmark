import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  parseEditorialDocument,
  type EditorialBlock,
  type EditorialInline
} from "../src/io/editorialDocument";
import {
  EDITORIAL_PDF_CODE_COLUMNS,
  EDITORIAL_PDF_CODE_CHUNK_CLASS,
  EDITORIAL_PDF_CODE_SPLIT_THRESHOLD_ROWS,
  EDITORIAL_PDF_CONTAINER_FALLBACK_BODY_CLASS,
  EDITORIAL_PDF_CONTAINER_FALLBACK_CLASS,
  EDITORIAL_PDF_CONTAINER_FALLBACK_LABEL_CLASS,
  EDITORIAL_PDF_CONTAINER_SPLIT_THRESHOLD_ROWS,
  EDITORIAL_PDF_FALLBACK_LABEL_MAX_GRAPHEMES,
  EDITORIAL_PDF_IMAGE_ESTIMATED_ROWS,
  EDITORIAL_PDF_NATIVE_TABLE_MAX_COLUMNS,
  EDITORIAL_PDF_OBSIDIAN_PRINT_CLASS,
  EDITORIAL_PDF_MIN_CHROMIUM,
  EDITORIAL_PDF_SPLITTABLE_CLASS,
  EDITORIAL_PDF_SPLITTABLE_TABLE_CLASS,
  EDITORIAL_PDF_TABLE_FALLBACK_CELL_CLASS,
  EDITORIAL_PDF_TABLE_FALLBACK_CLASS,
  EDITORIAL_PDF_TABLE_FALLBACK_HEADER_ROW_CLASS,
  EDITORIAL_PDF_TABLE_FALLBACK_LABEL_CLASS,
  EDITORIAL_PDF_TABLE_FALLBACK_ROW_CLASS,
  EDITORIAL_PDF_TABLE_FALLBACK_VALUE_CLASS,
  EDITORIAL_PDF_TABLE_ROW_SPLIT_THRESHOLD_ROWS,
  EDITORIAL_PDF_TABLE_SPLIT_THRESHOLD_ROWS,
  EditorialPdfService,
  balanceEditorialPdfCoverTitle,
  buildEditorialPdfRoot,
  createEditorialPdfStageError,
  createEditorialPdfStyles,
  detectChromiumMajor,
  escapeEditorialPdfCssString,
  estimateEditorialPdfCodeRows,
  estimateEditorialPdfContainerRows,
  estimateEditorialPdfFallbackRowRows,
  estimateEditorialPdfTableRowRows,
  estimateEditorialPdfTableRows,
  getEditorialPdfRuntimeSupport,
  primeEditorialPdfPrintLayout,
  splitEditorialPdfCodeChunks,
  truncateEditorialPdfFallbackLabel,
  truncateEditorialPdfHeader,
  waitForEditorialPdfAssets,
  waitForEditorialPdfLayout
} from "../src/io/editorialPdf";

interface TestDomNode {
  readonly nodeType: "element" | "text";
  readonly children: TestDomNode[];
  textContent: string;
}

class TestTextNode implements TestDomNode {
  readonly nodeType = "text";
  readonly children: TestDomNode[] = [];

  constructor(public textContent: string) {}
}

class TestElement implements TestDomNode {
  readonly nodeType = "element";
  readonly children: TestDomNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  parent: TestElement | null = null;
  className = "";
  alt = "";
  complete = true;
  href = "";
  naturalWidth = 1;
  rel = "";
  src = "";
  start = 1;
  removed = false;
  sheet: { cssRules: unknown[] } | null = null;
  onMeasure: (() => void) | null = null;
  private ownText = "";
  readonly classList = {
    add: (...tokens: string[]): void => {
      const classes = new Set(this.className.split(/\s+/u).filter(Boolean));
      for (const token of tokens) classes.add(token);
      this.className = Array.from(classes).join(" ");
    },
    remove: (...tokens: string[]): void => {
      const removed = new Set(tokens);
      this.className = this.className
        .split(/\s+/u)
        .filter((token) => token && !removed.has(token))
        .join(" ");
    },
    contains: (token: string): boolean => {
      return this.className.split(/\s+/u).includes(token);
    }
  };

  constructor(readonly tagName: string) {
    if (tagName === "STYLE") this.sheet = { cssRules: [{}] };
  }

  get isConnected(): boolean {
    return this.parent !== null;
  }

  get parentNode(): TestElement | null {
    return this.parent;
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.ownText = value;
    this.children.length = 0;
  }

  appendChild<T extends TestDomNode>(child: T): T {
    if (child.nodeType === "element") {
      (child as TestElement).parent = this;
    }
    this.children.push(child);
    return child;
  }

  async decode(): Promise<void> {}

  getBoundingClientRect(): DOMRect {
    this.onMeasure?.();
    return {} as DOMRect;
  }

  querySelector(selector: string): TestElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): TestElement[] {
    const matches = new Set<TestElement>();
    for (const part of selector.split(",")) {
      const candidate = part.trim();
      const expectedTag = candidate.startsWith(".")
        ? null
        : candidate.toUpperCase();
      const expectedClass = candidate.startsWith(".")
        ? candidate.slice(1)
        : null;
      for (const element of testElements(
        this,
        (descendant) =>
          descendant !== this &&
          (expectedTag
            ? descendant.tagName === expectedTag
            : hasTestClass(descendant, expectedClass ?? ""))
      )) {
        matches.add(element);
      }
    }
    return Array.from(matches);
  }

  remove(): void {
    if (this.parent) {
      const index = this.parent.children.indexOf(this);
      if (index >= 0) this.parent.children.splice(index, 1);
      this.parent = null;
    }
    this.removed = true;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

function createTestDocument(): Document {
  return {
    createElementNS: (_namespace: string, tag: string) =>
      new TestElement(tag.toUpperCase()),
    createTextNode: (value: string) => new TestTextNode(value)
  } as unknown as Document;
}

function testElements(
  node: TestDomNode,
  predicate: (element: TestElement) => boolean
): TestElement[] {
  const matches: TestElement[] = [];
  const pending: TestDomNode[] = [node];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    if (current.nodeType === "element") {
      const element = current as TestElement;
      if (predicate(element)) matches.push(element);
    }
    for (let index = current.children.length - 1; index >= 0; index -= 1) {
      pending.push(current.children[index] as TestDomNode);
    }
  }
  return matches;
}

function hasTestClass(element: TestElement, className: string): boolean {
  return element.className.split(/\s+/u).includes(className);
}

interface PrintHarness {
  readonly document: Document;
  readonly head: TestElement;
  readonly body: TestElement;
  readonly view: Window;
  readonly eventOrder: string[];
  readonly fontLoadQueries: string[];
  readonly fontLoadTexts: string[];
  readonly dispatchEvent: (type: string) => void;
  readonly listenerCount: (type: string) => number;
  readonly printCalls: () => number;
}

interface PrintHarnessOptions {
  fontsReady?: Promise<unknown>;
  fontReadyAfterAttempts?: number;
  stylesheetReadyAfterFrames?: number;
  throwOnComputedStyle?: boolean;
}

function createPrintHarness(options: PrintHarnessOptions = {}): PrintHarness {
  const head = new TestElement("HEAD");
  const body = new TestElement("BODY");
  const eventOrder: string[] = [];
  const fontLoadQueries: string[] = [];
  const fontLoadTexts: string[] = [];
  let printCalls = 0;
  let nextTimer = 1;
  let animationFrames = 0;
  const fontAttempts = new Map<string, number>();
  const createdStyles: TestElement[] = [];
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const onceListeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >();
  const dispatchEvent = (type: string): void => {
    const registered = Array.from(listeners.get(type) ?? []);
    for (const listener of registered) {
      if (typeof listener === "function") {
        listener(new Event(type));
      } else {
        listener.handleEvent(new Event(type));
      }
      if (onceListeners.get(type)?.has(listener)) {
        listeners.get(type)?.delete(listener);
        onceListeners.get(type)?.delete(listener);
      }
    }
  };
  const documentLike: {
    body: TestElement;
    defaultView?: Window;
    fonts: {
      load: (font: string, text?: string) => Promise<unknown>;
      ready: Promise<unknown>;
    };
    head: TestElement;
    createElementNS: (_namespace: string, tag: string) => TestElement;
    createTextNode: (value: string) => TestTextNode;
    querySelector: (selector: string) => TestElement | null;
    querySelectorAll: (selector: string) => TestElement[];
  } = {
    body,
    fonts: {
      load: async (font: string, text = "") => {
        eventOrder.push(`font-load:${font}`);
        fontLoadQueries.push(font);
        fontLoadTexts.push(text);
        const attempts = (fontAttempts.get(font) ?? 0) + 1;
        fontAttempts.set(font, attempts);
        return attempts > (options.fontReadyAfterAttempts ?? 0)
          ? [{ family: "HanMark Pretendard" }]
          : [];
      },
      ready: options.fontsReady ?? Promise.resolve()
    },
    head,
    createElementNS: (_namespace: string, tag: string) => {
      const element = new TestElement(tag.toUpperCase());
      if (element.tagName === "STYLE") {
        createdStyles.push(element);
        if ((options.stylesheetReadyAfterFrames ?? 0) > 0) {
          element.sheet = null;
        }
      }
      element.onMeasure = () => {
        eventOrder.push(`geometry:${element.className || element.tagName}`);
      };
      return element;
    },
    createTextNode: (value: string) => new TestTextNode(value),
    querySelector: (selector: string) =>
      documentLike.querySelectorAll(selector)[0] ?? null,
    querySelectorAll: (selector: string) => {
      const matches = new Set<TestElement>();
      for (const part of selector.split(",")) {
        const candidate = part.trim();
        for (const element of [
          ...head.querySelectorAll(candidate),
          ...body.querySelectorAll(candidate)
        ]) {
          matches.add(element);
        }
      }
      return Array.from(matches);
    }
  };
  const viewLike = {
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
      eventOptions?: boolean | AddEventListenerOptions
    ): void => {
      const registered = listeners.get(type) ?? new Set();
      registered.add(listener);
      listeners.set(type, registered);
      if (
        typeof eventOptions === "object" &&
        eventOptions !== null &&
        eventOptions.once
      ) {
        const once = onceListeners.get(type) ?? new Set();
        once.add(listener);
        onceListeners.set(type, once);
      }
    },
    clearTimeout: (_timer: number): void => {},
    document: documentLike,
    navigator: { userAgent: "Chrome/150.0.0.0" },
    getComputedStyle: (element: Element): CSSStyleDeclaration => {
      if (options.throwOnComputedStyle) {
        throw new Error("transient print-media style failure");
      }
      eventOrder.push(
        `computed:${(element as unknown as TestElement).className}`
      );
      return {
        backgroundColor: "rgb(255, 255, 255)",
        display: "block",
        fontFamily: "HanMark Pretendard",
        fontWeight: "400",
        getPropertyValue: (property: string) =>
          property === "page" ? "hanmark-body" : ""
      } as unknown as CSSStyleDeclaration;
    },
    print: (): void => {
      eventOrder.push("print-call");
      dispatchEvent("beforeprint");
      eventOrder.push("print-snapshot");
      printCalls += 1;
    },
    removeEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject
    ): void => {
      listeners.get(type)?.delete(listener);
    },
    requestAnimationFrame: (callback: FrameRequestCallback): number => {
      animationFrames += 1;
      const frame = animationFrames;
      queueMicrotask(() => {
        if (
          frame >= (options.stylesheetReadyAfterFrames ?? 0) &&
          createdStyles.some((style) => style.sheet === null)
        ) {
          for (const style of createdStyles) {
            if (style.sheet === null) style.sheet = { cssRules: [{}] };
          }
          eventOrder.push("stylesheet-ready");
        }
        callback(0);
      });
      return frame;
    },
    setTimeout: (
      _callback: TimerHandler,
      _delay?: number
    ): number => nextTimer++
  } as unknown as Window;
  documentLike.defaultView = viewLike;
  return {
    body,
    dispatchEvent,
    document: documentLike as unknown as Document,
    eventOrder,
    fontLoadQueries,
    fontLoadTexts,
    head,
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
    printCalls: () => printCalls,
    view: viewLike
  };
}

function tableBlock(rows: number, cell = "값"): Extract<EditorialBlock, { type: "table" }> {
  return {
    type: "table",
    header: [[{ type: "text", value: "항목" }]],
    rows: Array.from({ length: rows }, (_, index) => [
      [{ type: "text", value: `${cell}${String(index + 1)}` }]
    ])
  };
}

function multilineInlines(prefix: string, lines: number): EditorialInline[] {
  const inlines: EditorialInline[] = [];
  for (let index = 0; index < lines; index += 1) {
    if (index > 0) inlines.push({ type: "hardbreak" });
    inlines.push({ type: "text", value: `${prefix}${String(index + 1)}` });
  }
  return inlines;
}

describe("Achmage Editorial PDF helpers", () => {
  it("uses Obsidian's print-root class so the host stylesheet cannot hide the document", async () => {
    assert.equal(EDITORIAL_PDF_OBSIDIAN_PRINT_CLASS, "print");
    const source = await readFile("src/io/editorialPdf.ts", "utf8");
    assert.match(
      source,
      /root\.className\s*=\s*`\$\{EDITORIAL_PDF_ROOT_CLASS\} \$\{EDITORIAL_PDF_OBSIDIAN_PRINT_CLASS\}`/u
    );
  });

  it("detects the Chromium major version and enforces the page-margin-box gate", () => {
    assert.equal(
      detectChromiumMajor(
        "Mozilla/5.0 Chrome/132.0.6834.83 Electron/34.0.0 Safari/537.36"
      ),
      132
    );
    assert.equal(detectChromiumMajor("Mozilla/5.0 Firefox/141.0"), null);
    assert.deepEqual(
      getEditorialPdfRuntimeSupport("Chrome/130.0.0.0"),
      {
        supported: false,
        chromiumMajor: 130,
        minimum: EDITORIAL_PDF_MIN_CHROMIUM
      }
    );
    assert.equal(
      getEditorialPdfRuntimeSupport("Chrome/131.0.0.0").supported,
      true
    );
  });

  it("truncates the repeated header by grapheme rather than UTF-16 code units", () => {
    const emoji = "👨‍👩‍👧‍👦";
    assert.equal(truncateEditorialPdfHeader(`${emoji}가나다`, 3), `${emoji}가나…`);
    assert.equal(truncateEditorialPdfHeader("짧은 제목", 72), "짧은 제목");
    assert.throws(() => truncateEditorialPdfHeader("제목", 0), /positive integer/u);
  });

  it("balances the full cover title without truncating Korean graphemes", () => {
    const short = "한글 제목";
    assert.deepEqual(balanceEditorialPdfCoverTitle(short), {
      lines: [short],
      fontSizePt: 30
    });

    const twoLine = "한국어 어절을 보존하면서 긴 제목을 균형 있게 두 줄로 나누는 표지";
    const twoLineLayout = balanceEditorialPdfCoverTitle(twoLine);
    assert.equal(twoLineLayout.lines.length, 2);
    assert.equal(twoLineLayout.fontSizePt, 26);
    assert.equal(twoLineLayout.lines.join(" "), twoLine);
    assert.ok(
      Math.abs(
        Array.from(twoLineLayout.lines[0] ?? "").length -
        Array.from(twoLineLayout.lines[1] ?? "").length
      ) <= 8,
      "a two-line cover title should be visually balanced"
    );

    const longTitle = Array.from(
      { length: 45 },
      (_, index) => `제목어절${String(index + 1)}`
    ).join(" ");
    const longLayout = balanceEditorialPdfCoverTitle(longTitle);
    assert.equal(longLayout.lines.length, 3);
    assert.equal(longLayout.fontSizePt, 5);
    assert.equal(longLayout.lines.join(" "), longTitle);
    assert.doesNotMatch(longLayout.lines.join(""), /…/u);

    const sizeThresholds = [
      [14, 30, 1],
      [15, 26, 2],
      [32, 26, 2],
      [33, 21, 3],
      [57, 21, 3],
      [72, 17.5, 3],
      [73, 17, 3],
      [91, 13.5, 3],
      [121, 10, 3],
      [252, 5, 3]
    ] as const;
    for (const [length, expectedSize, expectedLines] of sizeThresholds) {
      const title = "가".repeat(length);
      const layout = balanceEditorialPdfCoverTitle(title);
      assert.equal(layout.fontSizePt, expectedSize);
      assert.equal(layout.lines.length, expectedLines);
      assert.equal(
        layout.lines.join(""),
        title,
        `the ${String(length)}-grapheme title must remain complete`
      );
    }
  });

  it("escapes quotes, backslashes, line breaks, and CSS control characters", () => {
    const escaped = escapeEditorialPdfCssString(
      "제목\"; } @page { \\ 다음\n줄\u2028끝"
    );
    assert.equal(
      escaped,
      "제목\\\"; } @page { \\\\ 다음\\a 줄\\2028 끝"
    );
    assert.doesNotMatch(escaped, /[\n\r\u2028\u2029]/u);
  });

  it("builds strict A4 CSS with named full-bleed cover and branded p2+ pages", () => {
    const css = createEditorialPdfStyles("강의 \"문서\" 제목");
    const longHeaderCss = createEditorialPdfStyles("가".repeat(40));

    assert.match(css, /@page hanmark-cover \{\s*size: A4 portrait;\s*margin: 0;/u);
    assert.match(css, /@page hanmark-body \{\s*size: A4 portrait;/u);
    assert.match(css, /@top-left \{[\s\S]*?content: "HANMARK PDF PRINT";/u);
    assert.match(css, /@top-right \{[\s\S]*?content: "강의 \\"문서\\" 제목";/u);
    assert.match(longHeaderCss, /@top-right \{[\s\S]*?content: "가{20}…";/u);
    assert.match(css, /@top-right \{[\s\S]*?white-space: nowrap;/u);
    assert.match(css, /@bottom-left \{[\s\S]*?content: "ACHMAGE \/ HANMARK PDF EDITION";/u);
    assert.match(css, /@bottom-right \{[\s\S]*?content: counter\(page\);/u);
    assert.match(css, /border-bottom: 0\.8pt solid #00B5AD;/u);
    assert.match(css, /border-top: 0\.8pt solid #00B5AD;/u);
    assert.match(css, /margin-bottom: 4mm;/u);
    assert.match(css, /padding-bottom: 4mm;/u);
    assert.match(css, /margin-top: 4mm;/u);
    assert.match(css, /padding-top: 4mm;/u);
    assert.doesNotMatch(css, /^\s*transform:/mu);
    const bodyPageCss = css.slice(
      css.indexOf("@page hanmark-body"),
      css.indexOf(".hanmark-editorial-pdf-root")
    );
    assert.doesNotMatch(bodyPageCss, /\bbox-sizing:/u);
    assert.match(css, /font-size: 7pt;/u);
    assert.match(css, /\.hanmark-editorial-pdf-cover \{[\s\S]*?page: hanmark-cover;/u);
    assert.match(css, /\.hanmark-editorial-pdf-body \{[\s\S]*?page: hanmark-body;/u);
    assert.match(
      css,
      /\.hanmark-editorial-pdf-cover \{[\s\S]*?width: 210mm;[\s\S]*?height: 297mm;/u
    );
    assert.match(css, /grid-template-rows: 52% 48%;/u);
    assert.match(css, /background: #002E6E;/u);
    assert.match(css, /\.hanmark-editorial-pdf-cover-title-line \{[\s\S]*?white-space: nowrap;/u);
    assert.doesNotMatch(
      css,
      /\.hanmark-editorial-pdf-cover \{[\s\S]*?margin:\s*-\d/u
    );
    assert.match(css, /break-after: page;/u);
    assert.match(css, /widows: 3;/u);
    assert.match(css, /orphans: 3;/u);
    assert.match(css, /"HanMark Pretendard"/u);
    assert.match(
      css,
      /\.hanmark-editorial-pdf-root \{[\s\S]*?font-size: 9pt;[\s\S]*?line-height: 1\.55;/u
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-root \.hanmark-editorial-pdf-body p \{[\s\S]*?text-align: justify;[\s\S]*?text-indent: 1em;/u
    );
    assert.match(css, /\.hanmark-editorial-pdf-root \.hanmark-editorial-pdf-body h1 \{[\s\S]*?font-size: 15pt;/u);
    assert.match(css, /\.hanmark-editorial-pdf-root \.hanmark-editorial-pdf-body h2 \{[\s\S]*?font-size: 11\.5pt;/u);
    assert.match(css, /\.hanmark-editorial-pdf-root \.hanmark-editorial-pdf-body h3 \{[\s\S]*?font-size: 9\.5pt;/u);
    assert.match(
      css,
      /\.hanmark-editorial-pdf-root \.hanmark-editorial-pdf-body h4,[\s\S]*?font-size: 9pt;/u
    );
    assert.match(css, /print-color-adjust: exact;/u);
    assert.match(
      css,
      /\.hanmark-editorial-pdf-root \{[\s\S]*?display: block;[\s\S]*?visibility: hidden;/u
    );
    const hiddenRootCss = css.slice(
      css.indexOf(".hanmark-editorial-pdf-root"),
      css.indexOf("@media print")
    );
    assert.match(
      hiddenRootCss,
      /font-family: "HanMark Pretendard", "Pretendard", "Apple SD Gothic Neo", sans-serif;/u
    );
    assert.match(hiddenRootCss, /font-size: 9pt;/u);
    assert.match(hiddenRootCss, /line-height: 1\.55;/u);
    assert.match(
      css,
      /@media print \{[\s\S]*?html \{[\s\S]*?height: auto;[\s\S]*?overflow: visible;/u
    );
    assert.match(
      css,
      /body\.hanmark-editorial-pdf-active[\s\S]*?height: auto;[\s\S]*?overflow: visible;/u
    );
    assert.match(
      css,
      /section\.hanmark-editorial-pdf-root[\s\S]*?position: static;[\s\S]*?visibility: visible;/u
    );
    assert.doesNotMatch(css, /COLLOQUIUM|author/u);
    assert.doesNotMatch(css, /!important/u);
  });

  it("isolates every Editorial PDF color from the active Obsidian theme", () => {
    const css = createEditorialPdfStyles("Theme regression");
    const palette = Array.from(
      new Set(
        Array.from(
          css.matchAll(/#[0-9a-f]{6}\b/giu),
          (match) => match[0].toUpperCase()
        )
      )
    ).sort();
    const expectedPalette = [
      "#FFFFFF",
      "#182433",
      "#002E6E",
      "#31537D",
      "#00B5AD",
      "#7FE2DC",
      "#C7F1EE",
      "#D9E0E6",
      "#FAFAFA"
    ].sort();

    assert.deepEqual(palette, expectedPalette);
    assert.doesNotMatch(
      css,
      /var\(\s*--(?:background|text|code|list|bold|italic|link|interactive)/iu
    );
    assert.doesNotMatch(
      css,
      /--(?:background|text|code|list|bold|italic|link|interactive)[\w-]*\s*:/iu
    );
    assert.doesNotMatch(css, /\bcurrentColor\b/u);
    assert.doesNotMatch(css, /\.theme-(?:dark|light)\b/u);
    assert.match(
      css,
      /html body\.hanmark-editorial-pdf-active \{[\s\S]*?color-scheme: only light;[\s\S]*?color: #182433;[\s\S]*?background: #FFFFFF;/u
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-root \{[\s\S]*?color-scheme: only light;[\s\S]*?color: #182433;[\s\S]*?background: #FFFFFF;/u
    );
    assert.match(
      css,
      /section\.hanmark-editorial-pdf-root \.hanmark-editorial-pdf-cover-upper \{[\s\S]*?color: #FFFFFF;[\s\S]*?background: #002E6E;/u
    );
    assert.match(
      css,
      /section\.hanmark-editorial-pdf-root \.hanmark-editorial-pdf-cover-lower \{[\s\S]*?color: #002E6E;[\s\S]*?background: #FFFFFF;/u
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-body (?:strong|em|del|u|sup|sub)[\s\S]*?\{[\s\S]*?color: inherit;[\s\S]*?background: transparent;/u
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-body li::marker,[\s\S]*?color: #31537D;/u
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-body ol,[\s\S]*?\.hanmark-editorial-pdf-body ul,[\s\S]*?\{[\s\S]*?color: inherit;[\s\S]*?background: transparent;/u
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-body :not\(pre\) > code \{[\s\S]*?color: #002E6E;[\s\S]*?background: #FAFAFA;/u
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-body pre code \{[\s\S]*?color: #FFFFFF;[\s\S]*?background: #002E6E;/u
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-body td \{[\s\S]*?color: #182433;[\s\S]*?background: #FFFFFF;/u
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-body tbody tr:nth-child\(even\) td \{[\s\S]*?background: #FAFAFA;/u
    );
    assert.match(
      css,
      new RegExp(
        `\\.${EDITORIAL_PDF_TABLE_FALLBACK_VALUE_CLASS},[\\s\\S]*?` +
          `\\.${EDITORIAL_PDF_CONTAINER_FALLBACK_BODY_CLASS} \\{` +
          "[\\s\\S]*?color: #182433;" +
          "[\\s\\S]*?background: #FFFFFF;",
        "u"
      )
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-body blockquote,[\s\S]*?color: #FFFFFF;[\s\S]*?background: #002E6E;/u
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-callout a \{[\s\S]*?color: #FFFFFF;[\s\S]*?text-decoration-color: #7FE2DC;/u
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-body mark \{[\s\S]*?color: #182433;[\s\S]*?background: #C7F1EE;/u
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-body img \{[\s\S]*?filter: none;[\s\S]*?opacity: 1;[\s\S]*?mix-blend-mode: normal;/u
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-body hr \{[\s\S]*?border-color: #00B5AD;/u
    );
    assert.doesNotMatch(css, /!important/u);
  });

  it("normalizes source-authored inline colors in PDF DOM without losing text", () => {
    const root = buildEditorialPdfRoot(
      createTestDocument(),
      {
        title: "Palette",
        masthead: [],
        blocks: [
          {
            type: "paragraph",
            inlines: [
              {
                type: "styled",
                style: "span",
                color: "#ff0000",
                backgroundColor: "#ffee00",
                children: [{ type: "text", value: "custom" }]
              },
              {
                type: "styled",
                style: "strong",
                color: "#123456",
                children: [{ type: "text", value: "strong" }]
              },
              {
                type: "styled",
                style: "mark",
                backgroundColor: "#ffff00",
                children: [{ type: "text", value: "mark" }]
              }
            ]
          }
        ]
      },
      "Palette"
    ) as unknown as TestElement;
    const styledElements = testElements(
      root,
      (element) =>
        (element.tagName === "SPAN" && element.textContent === "custom") ||
        (element.tagName === "STRONG" && element.textContent === "strong") ||
        (element.tagName === "MARK" && element.textContent === "mark")
    );

    assert.equal(styledElements.length, 3);
    for (const element of styledElements) {
      assert.equal(element.style.color, undefined);
      assert.equal(element.style.backgroundColor, undefined);
    }
    assert.match(root.textContent, /customstrongmark/u);
  });

  it("keeps short code in one chunk and physically chunks oversized code", () => {
    const shortCode = Array.from(
      { length: 10 },
      (_, index) => `const short${String(index)} = true;`
    ).join("\n");
    const sixtyLines = Array.from(
      { length: 60 },
      (_, index) => `const row${String(index)} = ${String(index)};`
    ).join("\n");
    const sixtyCrlfLines = Array.from(
      { length: 60 },
      (_, index) => `const crlf${String(index)} = ${String(index)};`
    ).join("\r\n");
    const oneVeryLongLine = "x".repeat(
      EDITORIAL_PDF_CODE_COLUMNS *
        (EDITORIAL_PDF_CODE_SPLIT_THRESHOLD_ROWS + 1)
    );

    assert.ok(
      estimateEditorialPdfCodeRows(shortCode) <=
        EDITORIAL_PDF_CODE_SPLIT_THRESHOLD_ROWS
    );
    assert.ok(
      estimateEditorialPdfCodeRows(sixtyLines) >
        EDITORIAL_PDF_CODE_SPLIT_THRESHOLD_ROWS
    );
    assert.ok(
      estimateEditorialPdfCodeRows(oneVeryLongLine) >
        EDITORIAL_PDF_CODE_SPLIT_THRESHOLD_ROWS
    );
    assert.deepEqual(splitEditorialPdfCodeChunks(shortCode), [shortCode]);
    for (const source of [sixtyLines, sixtyCrlfLines, oneVeryLongLine]) {
      const chunks = splitEditorialPdfCodeChunks(source);
      assert.ok(chunks.length > 1);
      assert.equal(chunks.join(""), source);
      for (const continuation of chunks.slice(1)) {
        assert.doesNotMatch(
          continuation,
          /^(?:\r\n|\r|\n|\u2028|\u2029)/u,
          "a continuation PRE must not render a duplicated leading blank line"
        );
      }
      for (const chunk of chunks) {
        assert.ok(
          estimateEditorialPdfCodeRows(chunk) <=
            EDITORIAL_PDF_CODE_SPLIT_THRESHOLD_ROWS
        );
      }
    }
  });

  it("estimates code rows with deterministic tab, CJK, and emoji widths", () => {
    assert.equal(estimateEditorialPdfCodeRows("\t".repeat(22)), 1);
    assert.equal(estimateEditorialPdfCodeRows("가".repeat(44)), 1);
    assert.equal(estimateEditorialPdfCodeRows("😀".repeat(44)), 1);
    assert.equal(
      estimateEditorialPdfCodeRows(
        `${"a".repeat(80)}\t가😀`
      ),
      1
    );
    assert.equal(
      estimateEditorialPdfCodeRows(
        `${"a".repeat(80)}\t가😀a`
      ),
      2
    );
  });

  it("keeps short tables intact but makes many-row and giant-row tables splittable", () => {
    const shortTable = tableBlock(3);
    const manyRows = tableBlock(
      EDITORIAL_PDF_TABLE_SPLIT_THRESHOLD_ROWS + 3
    );
    const giantCell = tableBlock(
      1,
      "긴셀".repeat(
        EDITORIAL_PDF_CODE_COLUMNS *
          (EDITORIAL_PDF_TABLE_SPLIT_THRESHOLD_ROWS + 1)
      )
    );

    assert.ok(
      estimateEditorialPdfTableRows(shortTable) <=
        EDITORIAL_PDF_TABLE_SPLIT_THRESHOLD_ROWS
    );
    assert.ok(
      estimateEditorialPdfTableRows(manyRows) >
        EDITORIAL_PDF_TABLE_SPLIT_THRESHOLD_ROWS
    );
    assert.ok(
      estimateEditorialPdfTableRows(giantCell) >
        EDITORIAL_PDF_TABLE_SPLIT_THRESHOLD_ROWS
    );
  });

  it("defines bounded code chunks and ordinary-flow table/container fallbacks", () => {
    const css = createEditorialPdfStyles("분할 회귀");

    assert.match(
      css,
      new RegExp(
        `pre\\.${EDITORIAL_PDF_CODE_CHUNK_CLASS} \\{` +
          "[\\s\\S]*?break-inside: avoid-page;" +
          "[\\s\\S]*?page-break-inside: avoid;",
        "u"
      )
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-body pre \{[\s\S]*?tab-size: 4;/u
    );
    assert.match(
      css,
      new RegExp(
        `\\.${EDITORIAL_PDF_TABLE_FALLBACK_CLASS},[\\s\\S]*?` +
          `\\.${EDITORIAL_PDF_CONTAINER_FALLBACK_CLASS},[\\s\\S]*?` +
          `\\.${EDITORIAL_PDF_CONTAINER_FALLBACK_BODY_CLASS} \\{` +
          "[\\s\\S]*?display: block;" +
          "[\\s\\S]*?break-inside: auto;",
        "u"
      )
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-body table thead \{[\s\S]*?display: table-header-group;[\s\S]*?break-inside: avoid-page;[\s\S]*?page-break-inside: avoid;/u
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-body table tr \{[\s\S]*?break-inside: avoid-page;[\s\S]*?page-break-inside: avoid;/u
    );
    assert.match(
      css,
      new RegExp(
        `\\.${EDITORIAL_PDF_TABLE_FALLBACK_VALUE_CLASS},[\\s\\S]*?` +
          `\\.${EDITORIAL_PDF_CONTAINER_FALLBACK_BODY_CLASS} \\{` +
          "[\\s\\S]*?background: #FFFFFF;",
        "u"
      )
    );
    assert.match(
      css,
      new RegExp(
        `\\.${EDITORIAL_PDF_TABLE_FALLBACK_ROW_CLASS}` +
          `\\.${EDITORIAL_PDF_SPLITTABLE_CLASS} \\{` +
          "[\\s\\S]*?break-inside: auto;" +
          "[\\s\\S]*?page-break-inside: auto;",
        "u"
      )
    );
    assert.match(
      css,
      /\.hanmark-editorial-pdf-body img \{[\s\S]*?max-width: 100%;[\s\S]*?max-height: 225mm;/u
    );
  });

  it("keeps short code and tables intact while one ordinary 42-row table remains a real repeating-header table", () => {
    const shortCode = "const short = true;";
    const shortTable: Extract<EditorialBlock, { type: "table" }> = {
      type: "table",
      header: [[{ type: "text", value: "short header" }]],
      rows: [[[{ type: "text", value: "short value" }]]]
    };
    const longTable: Extract<EditorialBlock, { type: "table" }> = {
      type: "table",
      header: [[{ type: "text", value: "long header" }]],
      rows: Array.from({ length: 42 }, (_, index) => [[{
        type: "text",
        value: `ordinary row ${String(index + 1)}`
      }]])
    };
    const root = buildEditorialPdfRoot(
      createTestDocument(),
      {
        title: "ordinary content",
        masthead: [{ type: "text", value: "ordinary content" }],
        blocks: [
          { type: "code", language: "ts", value: shortCode },
          shortTable,
          longTable
        ]
      },
      "ordinary content"
    ) as unknown as TestElement;

    const codeBlocks = testElements(root, (element) => element.tagName === "PRE");
    const tables = testElements(root, (element) => element.tagName === "TABLE");
    const tableHeads = testElements(root, (element) => element.tagName === "THEAD");

    assert.equal(codeBlocks.length, 1);
    assert.equal(codeBlocks[0]?.textContent, shortCode);
    assert.equal(
      hasTestClass(codeBlocks[0] as TestElement, EDITORIAL_PDF_CODE_CHUNK_CLASS),
      false
    );
    assert.equal(tables.length, 2);
    assert.equal(tableHeads.length, 2);
    assert.equal(
      hasTestClass(tables[0] as TestElement, EDITORIAL_PDF_SPLITTABLE_TABLE_CLASS),
      false
    );
    assert.ok(
      hasTestClass(tables[1] as TestElement, EDITORIAL_PDF_SPLITTABLE_TABLE_CLASS)
    );
    assert.equal(
      testElements(tables[1] as TestElement, (element) => element.tagName === "TBODY")[0]
        ?.children.length,
      42
    );
    assert.ok(root.textContent.includes("ordinary row 42"));
  });

  it("moves one giant body row into ordinary-flow fallback DOM without losing its image or adjacent real tables", () => {
    const image =
      "data:image/png;base64," +
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=";
    const giantText = `giant-row-start-${"oversized cell ".repeat(1_000)}-giant-row-end`;
    const table: Extract<EditorialBlock, { type: "table" }> = {
      type: "table",
      header: [
        [{ type: "text", value: "Name" }],
        [{ type: "text", value: "Evidence" }]
      ],
      rows: [
        [
          [{ type: "text", value: "before" }],
          [{ type: "text", value: "before value" }]
        ],
        [
          [{ type: "text", value: "giant" }],
          [
            { type: "text", value: giantText },
            { type: "image", src: image, alt: "giant data URI" }
          ]
        ],
        [
          [{ type: "text", value: "after" }],
          [{ type: "text", value: "after value" }]
        ]
      ]
    };
    const root = buildEditorialPdfRoot(
      createTestDocument(),
      {
        title: "giant body row",
        masthead: [{ type: "text", value: "giant body row" }],
        blocks: [table]
      },
      "giant body row"
    ) as unknown as TestElement;
    const realTables = testElements(root, (element) => element.tagName === "TABLE");
    const fallbacks = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_CLASS)
    );
    const fallbackRows = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_ROW_CLASS)
    );
    const fallbackCells = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_CELL_CLASS)
    );
    const fallbackLabels = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_LABEL_CLASS)
    );
    const fallbackValues = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_VALUE_CLASS)
    );

    assert.equal(realTables.length, 2);
    assert.equal(
      testElements(root, (element) => element.tagName === "THEAD").length,
      2
    );
    assert.equal(fallbacks.length, 1);
    assert.equal(fallbackRows.length, 1);
    assert.equal(fallbackCells.length, 2);
    assert.deepEqual(
      fallbackLabels.map((element) => element.textContent),
      ["Name", "Evidence"]
    );
    assert.equal(fallbackValues.length, 2);
    assert.equal(fallbackValues[0]?.textContent, "giant");
    assert.equal(fallbackValues[1]?.textContent, giantText);
    assert.ok(
      hasTestClass(fallbackRows[0] as TestElement, EDITORIAL_PDF_SPLITTABLE_CLASS)
    );
    assert.equal(
      hasTestClass(
        fallbackRows[0] as TestElement,
        EDITORIAL_PDF_TABLE_FALLBACK_HEADER_ROW_CLASS
      ),
      false
    );
    const fallbackImages = testElements(
      fallbacks[0] as TestElement,
      (element) => element.tagName === "IMG"
    );
    assert.equal(fallbackImages.length, 1);
    assert.equal(fallbackImages[0]?.src, image);
    assert.equal(fallbackImages[0]?.alt, "giant data URI");
    assert.ok(realTables[0]?.textContent.includes("before value"));
    assert.ok(realTables[1]?.textContent.includes("after value"));
  });

  it("renders a giant header and its ordinary body row as labeled fallback rows with exact values", () => {
    const giantHeaderText =
      `giant-header-start-${"header token ".repeat(1_000)}-giant-header-end`;
    const table: Extract<EditorialBlock, { type: "table" }> = {
      type: "table",
      header: [
        [{ type: "text", value: giantHeaderText }],
        [{ type: "text", value: "Secondary header" }]
      ],
      rows: [[
        [{ type: "text", value: "body value one" }],
        [{ type: "text", value: "body value two" }]
      ]]
    };
    const root = buildEditorialPdfRoot(
      createTestDocument(),
      {
        title: "giant header",
        masthead: [{ type: "text", value: "giant header" }],
        blocks: [table]
      },
      "giant header"
    ) as unknown as TestElement;
    const fallbacks = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_CLASS)
    );
    const rows = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_ROW_CLASS)
    );
    const labels = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_LABEL_CLASS)
    );
    const values = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_VALUE_CLASS)
    );

    assert.equal(testElements(root, (element) => element.tagName === "TABLE").length, 0);
    assert.equal(fallbacks.length, 1);
    assert.equal(rows.length, 2);
    assert.ok(
      hasTestClass(rows[0] as TestElement, EDITORIAL_PDF_TABLE_FALLBACK_HEADER_ROW_CLASS)
    );
    assert.ok(hasTestClass(rows[0] as TestElement, EDITORIAL_PDF_SPLITTABLE_CLASS));
    assert.equal(
      hasTestClass(rows[1] as TestElement, EDITORIAL_PDF_SPLITTABLE_CLASS),
      false
    );
    assert.deepEqual(
      labels.slice(0, 2).map((element) => element.textContent),
      ["열 1 제목", "열 2 제목"]
    );
    assert.ok(labels[2]?.textContent.startsWith("giant-header-start-"));
    assert.equal(labels[3]?.textContent, "Secondary header");
    assert.deepEqual(
      values.map((element) => element.textContent),
      [
        giantHeaderText,
        "Secondary header",
        "body value one",
        "body value two"
      ]
    );
  });

  it("falls back when a repeated header and one body row are each safe but exceed one page together", () => {
    const header = [multilineInlines("header-line-", 24)];
    const bodyRow = [multilineInlines("body-line-", 20)];
    const table: Extract<EditorialBlock, { type: "table" }> = {
      type: "table",
      header,
      rows: [bodyRow]
    };

    const headerRows = estimateEditorialPdfTableRowRows(header, 1);
    const bodyRows = estimateEditorialPdfTableRowRows(bodyRow, 1);
    assert.ok(headerRows <= EDITORIAL_PDF_TABLE_ROW_SPLIT_THRESHOLD_ROWS);
    assert.ok(bodyRows <= EDITORIAL_PDF_TABLE_ROW_SPLIT_THRESHOLD_ROWS);
    assert.ok(
      headerRows + bodyRows > EDITORIAL_PDF_TABLE_ROW_SPLIT_THRESHOLD_ROWS
    );

    const root = buildEditorialPdfRoot(
      createTestDocument(),
      {
        title: "header plus row budget",
        masthead: [{ type: "text", value: "header plus row budget" }],
        blocks: [table]
      },
      "header plus row budget"
    ) as unknown as TestElement;
    const fallbackRows = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_ROW_CLASS)
    );

    assert.equal(testElements(root, (element) => element.tagName === "TABLE").length, 0);
    assert.equal(
      testElements(
        root,
        (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_CLASS)
      ).length,
      1
    );
    assert.equal(fallbackRows.length, 2);
    assert.ok(
      hasTestClass(
        fallbackRows[0] as TestElement,
        EDITORIAL_PDF_TABLE_FALLBACK_HEADER_ROW_CLASS
      )
    );
    assert.ok(root.textContent.includes("header-line-24"));
    assert.ok(root.textContent.includes("body-line-20"));
  });

  it("uses vertical fallback for a 30-column table instead of undercounting native cell width", () => {
    const columnCount = EDITORIAL_PDF_NATIVE_TABLE_MAX_COLUMNS + 18;
    const table: Extract<EditorialBlock, { type: "table" }> = {
      type: "table",
      header: Array.from({ length: columnCount }, (_, index) => [{
        type: "text",
        value: `header-${String(index + 1)}`
      }]),
      rows: [Array.from({ length: columnCount }, (_, index) => [{
        type: "text",
        value: `value-${String(index + 1)}`
      }])]
    };
    const root = buildEditorialPdfRoot(
      createTestDocument(),
      {
        title: "wide table",
        masthead: [{ type: "text", value: "wide table" }],
        blocks: [table]
      },
      "wide table"
    ) as unknown as TestElement;
    const fallbackRows = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_ROW_CLASS)
    );
    const fallbackCells = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_CELL_CLASS)
    );

    assert.equal(testElements(root, (element) => element.tagName === "TABLE").length, 0);
    assert.equal(fallbackRows.length, 2);
    assert.equal(fallbackCells.length, columnCount * 2);
    for (const row of fallbackRows) {
      assert.ok(
        hasTestClass(row, EDITORIAL_PDF_SPLITTABLE_CLASS),
        "a vertically stacked 30-cell fallback row must not be one keep-together box"
      );
    }
    assert.ok(root.textContent.includes("header-30"));
    assert.ok(root.textContent.includes("value-30"));
  });

  it("keeps ten five-line cells native because table rows use max cell height rather than vertical sum", () => {
    const cellCount = 10;
    const table: Extract<EditorialBlock, { type: "table" }> = {
      type: "table",
      header: Array.from(
        { length: cellCount },
        (_, index) => multilineInlines(`H${String(index + 1)}-`, 5)
      ),
      rows: [Array.from(
        { length: cellCount },
        (_, index) => multilineInlines(`V${String(index + 1)}-`, 5)
      )]
    };
    const root = buildEditorialPdfRoot(
      createTestDocument(),
      {
        title: "vertical cell sum",
        masthead: [{ type: "text", value: "vertical cell sum" }],
        blocks: [table]
      },
      "vertical cell sum"
    ) as unknown as TestElement;
    const tables = testElements(root, (element) => element.tagName === "TABLE");
    const tableRows = testElements(root, (element) => element.tagName === "TR");
    assert.ok(
      estimateEditorialPdfFallbackRowRows(table.header) >
        EDITORIAL_PDF_TABLE_ROW_SPLIT_THRESHOLD_ROWS
    );
    assert.ok(
      estimateEditorialPdfFallbackRowRows(table.rows[0] ?? []) >
        EDITORIAL_PDF_TABLE_ROW_SPLIT_THRESHOLD_ROWS
    );
    assert.equal(estimateEditorialPdfTableRowRows(table.header, cellCount), 5);
    assert.equal(
      estimateEditorialPdfTableRowRows(table.rows[0] ?? [], cellCount),
      5
    );
    assert.equal(tables.length, 1);
    assert.equal(tableRows.length, 2);
    assert.equal(
      testElements(
        root,
        (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_CLASS)
      ).length,
      0
    );
    assert.equal(
      testElements(root, (element) => element.tagName === "BR").length,
      cellCount * 2 * 4
    );
    for (let index = 0; index < cellCount; index += 1) {
      const headerValue = Array.from(
        { length: 5 },
        (_, line) => `H${String(index + 1)}-${String(line + 1)}`
      ).join("");
      const bodyValue = Array.from(
        { length: 5 },
        (_, line) => `V${String(index + 1)}-${String(line + 1)}`
      ).join("");
      assert.ok(tables[0]?.textContent.includes(headerValue));
      assert.ok(tables[0]?.textContent.includes(bodyValue));
    }
  });

  it("caps a fallback column label while preserving the complete header value exactly once", () => {
    const longHeader =
      `header-start-${"한글머리".repeat(30)}-header-end`;
    const table: Extract<EditorialBlock, { type: "table" }> = {
      type: "table",
      header: [[{ type: "text", value: longHeader }]],
      rows: [[multilineInlines("oversized-body-", 45)]]
    };
    const root = buildEditorialPdfRoot(
      createTestDocument(),
      {
        title: "fallback label cap",
        masthead: [{ type: "text", value: "fallback label cap" }],
        blocks: [table]
      },
      "fallback label cap"
    ) as unknown as TestElement;
    const labels = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_LABEL_CLASS)
    );
    const values = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_VALUE_CLASS)
    );
    const bodyLabel = labels.find((element) =>
      element.textContent.startsWith("header-start-")
    );

    assert.ok(bodyLabel);
    assert.ok(
      Array.from(bodyLabel.textContent).length <=
        EDITORIAL_PDF_FALLBACK_LABEL_MAX_GRAPHEMES + 1
    );
    assert.ok(bodyLabel.textContent.endsWith("…"));
    assert.equal(
      bodyLabel.textContent,
      truncateEditorialPdfFallbackLabel(longHeader, "column")
    );
    assert.equal(
      values.filter((element) => element.textContent === longHeader).length,
      1
    );
    assert.ok(values.some((element) => element.textContent.includes("oversized-body-45")));
  });

  it("preserves every image in one naturally flowing image-heavy paragraph", () => {
    const image =
      "data:image/png;base64," +
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=";
    const blocks: EditorialBlock[] = [{
      type: "paragraph",
      inlines: Array.from({ length: 6 }, (_, index) => ({
        type: "image" as const,
        src: image,
        alt: `paragraph image ${String(index + 1)}`
      }))
    }];
    const root = buildEditorialPdfRoot(
      createTestDocument(),
      {
        title: "image paragraph",
        masthead: [{ type: "text", value: "image paragraph" }],
        blocks
      },
      "image paragraph"
    ) as unknown as TestElement;
    const paragraphs = testElements(root, (element) => element.tagName === "P");
    const images = testElements(root, (element) => element.tagName === "IMG");

    assert.equal(images.length, 6);
    assert.deepEqual(
      images.map((element) => element.alt),
      Array.from(
        { length: 6 },
        (_, index) => `paragraph image ${String(index + 1)}`
      )
    );
    assert.ok(
      paragraphs.some((paragraph) =>
        testElements(paragraph, (element) => element.tagName === "IMG").length === 6
      )
    );
  });

  it("caps giant callout labels in both compact and ordinary-flow fallback containers", () => {
    const kind = `CALLOUT-${"매우긴종류".repeat(30)}-END`;
    const blocks: EditorialBlock[] = [
      {
        type: "callout",
        kind,
        blocks: [{
          type: "paragraph",
          inlines: [{ type: "text", value: "compact body" }]
        }]
      },
      {
        type: "callout",
        kind,
        blocks: [{
          type: "paragraph",
          inlines: [{
            type: "text",
            value: `oversized body ${"long content ".repeat(1_000)}`
          }]
        }]
      }
    ];
    const root = buildEditorialPdfRoot(
      createTestDocument(),
      {
        title: "callout label cap",
        masthead: [{ type: "text", value: "callout label cap" }],
        blocks
      },
      "callout label cap"
    ) as unknown as TestElement;
    const compactLabels = testElements(
      root,
      (element) => hasTestClass(element, "hanmark-editorial-pdf-callout-label")
    );
    const fallbackLabels = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_CONTAINER_FALLBACK_LABEL_CLASS)
    );
    const expected = truncateEditorialPdfFallbackLabel(kind, "CALLOUT");

    assert.equal(compactLabels.length, 1);
    assert.equal(fallbackLabels.length, 1);
    assert.equal(compactLabels[0]?.textContent, expected);
    assert.equal(fallbackLabels[0]?.textContent, expected);
    assert.ok(
      Array.from(expected).length <=
        EDITORIAL_PDF_FALLBACK_LABEL_MAX_GRAPHEMES + 1
    );
    assert.ok(expected.endsWith("…"));
    assert.ok(root.textContent.includes("compact body"));
    assert.ok(root.textContent.includes("oversized body"));
  });

  it("recursively renders oversized quote and callout bodies with bounded code, real long tables, and images", () => {
    const image =
      "data:image/png;base64," +
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=";
    const code = Array.from(
      { length: 60 },
      (_, index) => `const nested${String(index + 1)} = true;`
    ).join("\n");
    const nestedBlocks = (prefix: string): EditorialBlock[] => [
      { type: "code", language: "ts", value: code },
      {
        type: "table",
        header: [[{ type: "text", value: `${prefix} header` }]],
        rows: Array.from({ length: 42 }, (_, index) => [[{
          type: "text",
          value: `${prefix} row ${String(index + 1)}`
        }]])
      },
      {
        type: "paragraph",
        inlines: [{ type: "image", src: image, alt: `${prefix} image` }]
      }
    ];
    const blocks: EditorialBlock[] = [
      { type: "quote", blocks: nestedBlocks("quote") },
      { type: "callout", kind: "NOTE", blocks: nestedBlocks("callout") }
    ];
    const root = buildEditorialPdfRoot(
      createTestDocument(),
      {
        title: "recursive fallback",
        masthead: [{ type: "text", value: "recursive fallback" }],
        blocks
      },
      "recursive fallback"
    ) as unknown as TestElement;
    const fallbacks = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_CONTAINER_FALLBACK_CLASS)
    );

    assert.equal(fallbacks.length, 2);
    for (const [index, fallback] of fallbacks.entries()) {
      const labels = testElements(
        fallback,
        (element) => hasTestClass(element, EDITORIAL_PDF_CONTAINER_FALLBACK_LABEL_CLASS)
      );
      const bodies = testElements(
        fallback,
        (element) => hasTestClass(element, EDITORIAL_PDF_CONTAINER_FALLBACK_BODY_CLASS)
      );
      const codeChunks = testElements(
        fallback,
        (element) => element.tagName === "PRE"
      );
      const tables = testElements(
        fallback,
        (element) => element.tagName === "TABLE"
      );
      const images = testElements(
        fallback,
        (element) => element.tagName === "IMG"
      );

      assert.equal(labels.length, 1);
      assert.equal(bodies.length, 1);
      assert.ok(codeChunks.length > 1);
      assert.equal(
        codeChunks.map((element) => element.textContent).join(""),
        code
      );
      for (const chunk of codeChunks) {
        assert.ok(hasTestClass(chunk, EDITORIAL_PDF_CODE_CHUNK_CLASS));
        assert.ok(
          estimateEditorialPdfCodeRows(chunk.textContent) <=
            EDITORIAL_PDF_CODE_SPLIT_THRESHOLD_ROWS
        );
      }
      assert.equal(tables.length, 1);
      assert.ok(
        hasTestClass(tables[0] as TestElement, EDITORIAL_PDF_SPLITTABLE_TABLE_CLASS)
      );
      assert.equal(images.length, 1);
      assert.equal(images[0]?.src, image);
      assert.equal(images[0]?.alt, index === 0 ? "quote image" : "callout image");
      assert.ok(
        bodies[0]?.textContent.includes(
          index === 0 ? "quote row 42" : "callout row 42"
        )
      );
    }
  });

  it("physically chunks code inside a nested list without changing CRLF bytes or adding a leading blank line", () => {
    const code = Array.from(
      { length: 60 },
      (_, index) => `nested-list-line-${String(index + 1)}`
    ).join("\r\n");
    const nestedList: EditorialBlock = {
      type: "list",
      ordered: false,
      items: [{
        blocks: [{
          type: "list",
          ordered: true,
          items: [{
            blocks: [{ type: "code", language: "text", value: code }]
          }]
        }]
      }]
    };
    const root = buildEditorialPdfRoot(
      createTestDocument(),
      {
        title: "nested list code",
        masthead: [{ type: "text", value: "nested list code" }],
        blocks: [nestedList]
      },
      "nested list code"
    ) as unknown as TestElement;
    const codeChunks = testElements(root, (element) => element.tagName === "PRE");

    assert.ok(codeChunks.length > 1);
    assert.equal(
      codeChunks.map((element) => element.textContent).join(""),
      code
    );
    for (const [index, chunk] of codeChunks.entries()) {
      assert.ok(hasTestClass(chunk, EDITORIAL_PDF_CODE_CHUNK_CLASS));
      assert.ok(
        estimateEditorialPdfCodeRows(chunk.textContent) <=
          EDITORIAL_PDF_CODE_SPLIT_THRESHOLD_ROWS
      );
      if (index > 0) {
        assert.doesNotMatch(chunk.textContent, /^(?:\r\n|\r|\n)/u);
      }
    }
  });

  it("classifies the full oversized block matrix without rewriting content", () => {
    const image =
      "data:image/png;base64," +
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=";
    const longParagraph = `문단시작-${"긴문단".repeat(1_400)}-문단끝`;
    const longHeading = `제목시작-${"제목토큰".repeat(1_400)}-제목끝`;
    const longListItem = `목록시작-${"긴목록".repeat(1_400)}-목록끝`;
    const imageAndText = [
      { type: "image", src: image, alt: "225mm 이미지" },
      { type: "text", value: ` 이미지뒤-${"설명".repeat(120)}-설명끝` }
    ] as const;
    const giantHeader = [
      [{ type: "text", value: `헤더시작-${"긴헤더".repeat(1_600)}-헤더끝` }]
    ] satisfies Extract<EditorialBlock, { type: "table" }>["header"];
    const giantRow = [
      [{ type: "text", value: `행시작-${"긴셀".repeat(1_600)}-행끝` }]
    ] satisfies Extract<EditorialBlock, { type: "table" }>["rows"][number];
    const blocks: EditorialBlock[] = [
      {
        type: "paragraph",
        inlines: [{ type: "text", value: longParagraph }]
      },
      {
        type: "heading",
        level: 2,
        inlines: [{ type: "text", value: longHeading }]
      },
      {
        type: "list",
        ordered: false,
        items: [
          {
            blocks: [{
              type: "paragraph",
              inlines: [{ type: "text", value: longListItem }]
            }]
          },
          ...Array.from({ length: 80 }, (_, index) => ({
            blocks: [{
              type: "paragraph" as const,
              inlines: [{
                type: "text" as const,
                value: `many-list-${String(index + 1)}`
              }]
            }]
          }))
        ]
      },
      {
        type: "quote",
        blocks: [{
          type: "paragraph",
          inlines: [...imageAndText]
        }]
      },
      {
        type: "callout",
        kind: "NOTE",
        blocks: [{
          type: "paragraph",
          inlines: [...imageAndText]
        }]
      },
      {
        type: "table",
        header: giantHeader,
        rows: [giantRow]
      }
    ];

    assert.equal(EDITORIAL_PDF_IMAGE_ESTIMATED_ROWS, 48);
    assert.ok(
      estimateEditorialPdfContainerRows([blocks[0] as EditorialBlock]) >
        EDITORIAL_PDF_CONTAINER_SPLIT_THRESHOLD_ROWS
    );
    assert.ok(
      estimateEditorialPdfContainerRows([blocks[1] as EditorialBlock]) >
        EDITORIAL_PDF_CONTAINER_SPLIT_THRESHOLD_ROWS
    );
    assert.ok(
      estimateEditorialPdfContainerRows([blocks[2] as EditorialBlock]) >
        EDITORIAL_PDF_CONTAINER_SPLIT_THRESHOLD_ROWS
    );
    const quote = blocks[3];
    const callout = blocks[4];
    assert.ok(
      quote?.type === "quote" &&
        estimateEditorialPdfContainerRows(quote.blocks) >
          EDITORIAL_PDF_CONTAINER_SPLIT_THRESHOLD_ROWS
    );
    assert.ok(
      callout?.type === "callout" &&
        estimateEditorialPdfContainerRows(callout.blocks) >
          EDITORIAL_PDF_CONTAINER_SPLIT_THRESHOLD_ROWS
    );
    assert.ok(
      estimateEditorialPdfTableRowRows(
        giantHeader,
        1
      ) > EDITORIAL_PDF_TABLE_ROW_SPLIT_THRESHOLD_ROWS
    );
    assert.ok(
      estimateEditorialPdfTableRowRows(
        giantRow,
        1
      ) > EDITORIAL_PDF_TABLE_ROW_SPLIT_THRESHOLD_ROWS
    );

    const root = buildEditorialPdfRoot(
      createTestDocument(),
      {
        title: "대형 블록 합성",
        masthead: [{ type: "text", value: "대형 블록 합성" }],
        blocks
      },
      "대형 블록 합성"
    ) as unknown as TestElement;
    const paragraphs = testElements(root, (element) => element.tagName === "P");
    const headings = testElements(root, (element) => element.tagName === "H2");
    const listItems = testElements(root, (element) => element.tagName === "LI");
    const containerFallbacks = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_CONTAINER_FALLBACK_CLASS)
    );
    const tableFallbacks = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_CLASS)
    );
    const fallbackRows = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_ROW_CLASS)
    );
    const fallbackValues = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_VALUE_CLASS)
    );

    assert.ok(paragraphs.some((element) => element.textContent === longParagraph));
    assert.ok(headings.some((element) => element.textContent === longHeading));
    assert.ok(listItems.some((element) => element.textContent === longListItem));
    assert.ok(listItems.some((element) => element.textContent === "many-list-1"));
    assert.ok(listItems.some((element) => element.textContent === "many-list-80"));
    assert.ok(listItems.length >= 81);
    for (const naturallyFragmentable of [
      ...paragraphs.filter((element) =>
        element.textContent === longParagraph ||
        element.textContent === longListItem
      ),
      ...headings,
      ...listItems
    ]) {
      assert.doesNotMatch(
        naturallyFragmentable.className,
        new RegExp(EDITORIAL_PDF_SPLITTABLE_CLASS, "u")
      );
    }
    assert.equal(containerFallbacks.length, 2);
    for (const container of containerFallbacks) {
      const labels = testElements(
        container,
        (element) =>
          hasTestClass(element, EDITORIAL_PDF_CONTAINER_FALLBACK_LABEL_CLASS)
      );
      const bodies = testElements(
        container,
        (element) =>
          hasTestClass(element, EDITORIAL_PDF_CONTAINER_FALLBACK_BODY_CLASS)
      );
      assert.equal(labels.length, 1);
      assert.equal(bodies.length, 1);
      assert.doesNotMatch(bodies[0]?.className ?? "", /callout|blockquote/u);
    }
    assert.equal(tableFallbacks.length, 1);
    assert.equal(fallbackRows.length, 2);
    assert.equal(fallbackValues.length, 2);
    assert.ok(
      fallbackRows.some((row) =>
        hasTestClass(row, EDITORIAL_PDF_TABLE_FALLBACK_HEADER_ROW_CLASS)
      )
    );
    for (const row of fallbackRows) {
      assert.ok(hasTestClass(row, EDITORIAL_PDF_SPLITTABLE_CLASS));
    }
    for (const sentinel of [
      "문단시작-",
      "-문단끝",
      "제목시작-",
      "-제목끝",
      "목록시작-",
      "-목록끝",
      "이미지뒤-",
      "-설명끝",
      "헤더시작-",
      "-헤더끝",
      "행시작-",
      "-행끝"
    ]) {
      assert.ok(root.textContent.includes(sentinel), `must preserve ${sentinel}`);
    }
  });

  it("makes image-heavy quote, callout, and table cells fragmentable", () => {
    const image =
      "data:image/png;base64," +
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=";
    const images = Array.from({ length: 3 }, (_, index) => ({
      type: "image" as const,
      src: image,
      alt: `중첩 이미지 ${String(index + 1)}`
    }));
    const quote: EditorialBlock = {
      type: "quote",
      blocks: [{ type: "paragraph", inlines: images }]
    };
    const callout: EditorialBlock = {
      type: "callout",
      kind: "WARNING",
      blocks: [{ type: "paragraph", inlines: images }]
    };
    const table: Extract<EditorialBlock, { type: "table" }> = {
      type: "table",
      header: [[{ type: "text", value: "이미지" }]],
      rows: [[images]]
    };

    assert.ok(
      quote.type === "quote" &&
        estimateEditorialPdfContainerRows(quote.blocks) >
          EDITORIAL_PDF_CONTAINER_SPLIT_THRESHOLD_ROWS
    );
    assert.ok(
      callout.type === "callout" &&
        estimateEditorialPdfContainerRows(callout.blocks) >
          EDITORIAL_PDF_CONTAINER_SPLIT_THRESHOLD_ROWS
    );
    assert.ok(
      estimateEditorialPdfTableRowRows(
        table.rows[0] ?? [],
        1
      ) > EDITORIAL_PDF_TABLE_ROW_SPLIT_THRESHOLD_ROWS
    );

    const root = buildEditorialPdfRoot(
      createTestDocument(),
      {
        title: "이미지 중첩",
        masthead: [{ type: "text", value: "이미지 중첩" }],
        blocks: [quote, callout, table]
      },
      "이미지 중첩"
    ) as unknown as TestElement;
    const containerFallbacks = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_CONTAINER_FALLBACK_CLASS)
    );
    const tableFallbacks = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_CLASS)
    );
    const fallbackRows = testElements(
      root,
      (element) => hasTestClass(element, EDITORIAL_PDF_TABLE_FALLBACK_ROW_CLASS)
    );
    const renderedImages = testElements(root, (element) => element.tagName === "IMG");

    assert.equal(containerFallbacks.length, 2);
    assert.equal(tableFallbacks.length, 1);
    assert.equal(fallbackRows.length, 2);
    assert.equal(
      fallbackRows.filter((row) =>
        hasTestClass(row, EDITORIAL_PDF_TABLE_FALLBACK_HEADER_ROW_CLASS)
      ).length,
      1
    );
    assert.equal(
      fallbackRows.filter((row) =>
        hasTestClass(row, EDITORIAL_PDF_SPLITTABLE_CLASS)
      ).length,
      1
    );
    assert.equal(renderedImages.length, 9);
  });

  it("renders deeply nested blocks below the guard and fails closed above it", () => {
    const nestedDocument = (depth: number): EditorialBlock => {
      let block: EditorialBlock = {
        type: "paragraph",
        inlines: [{ type: "text", value: "깊이 끝 sentinel" }]
      };
      for (let index = 0; index < depth; index += 1) {
        block = { type: "quote", blocks: [block] };
      }
      return block;
    };
    const safeRoot = buildEditorialPdfRoot(
      createTestDocument(),
      {
        title: "깊이 보호",
        masthead: [{ type: "text", value: "깊이 보호" }],
        blocks: [nestedDocument(120)]
      },
      "깊이 보호"
    ) as unknown as TestElement;
    assert.ok(safeRoot.textContent.includes("깊이 끝 sentinel"));

    assert.throws(
      () => buildEditorialPdfRoot(
        createTestDocument(),
        {
          title: "초과 깊이",
          masthead: [{ type: "text", value: "초과 깊이" }],
          blocks: [nestedDocument(130)]
        },
        "초과 깊이"
      ),
      (error: unknown) =>
        error instanceof Error &&
        !(error instanceof RangeError) &&
        /safe rendering limit/u.test(error.message)
    );
  });

  it("parses and builds an image-rich oversized code-and-table document without data loss", () => {
    const image =
      "data:image/png;base64," +
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=";
    const rawHtmlLiteral = `<section data-test="literal"><b>코드 안 HTML</b></section>`;
    const codeBody = [
      rawHtmlLiteral,
      ...Array.from(
        { length: 59 },
        (_, index) => `const synthetic${String(index + 1)} = "보존-${String(index + 1)}";`
      )
    ].join("\n");
    const images = Array.from(
      { length: 8 },
      (_, index) => `![합성 이미지 ${String(index + 1)}](${image})`
    ).join("\n\n");
    const table = [
      "| 항목 | 내용 |",
      "|---|---|",
      ...Array.from(
        { length: EDITORIAL_PDF_TABLE_SPLIT_THRESHOLD_ROWS + 3 },
        (_, index) =>
          `| 행 ${String(index + 1)} | 합성 표 내용 ${String(index + 1)} |`
      )
    ].join("\n");
    const markdown = [
      "# 합성 PDF 회귀 문서",
      images,
      "```typescript",
      codeBody,
      "```",
      table
    ].join("\n\n");

    const editorial = parseEditorialDocument(markdown, "합성 PDF 회귀 문서");
    const parsedCode = editorial.blocks.find(
      (block): block is Extract<EditorialBlock, { type: "code" }> =>
        block.type === "code"
    );
    assert.ok(parsedCode, "the synthetic fenced code block must be parsed");
    const root = buildEditorialPdfRoot(
      createTestDocument(),
      editorial,
      "합성 PDF 회귀 문서"
    ) as unknown as TestElement;
    const pre = testElements(root, (element) => element.tagName === "PRE");
    const tables = testElements(root, (element) => element.tagName === "TABLE");
    const imageElements = testElements(root, (element) => element.tagName === "IMG");

    assert.ok(pre.length > 1);
    assert.equal(
      pre.map((element) => element.textContent).join(""),
      parsedCode.value
    );
    for (const codeChunk of pre) {
      assert.ok(hasTestClass(codeChunk, EDITORIAL_PDF_CODE_CHUNK_CLASS));
      assert.ok(
        estimateEditorialPdfCodeRows(codeChunk.textContent) <=
          EDITORIAL_PDF_CODE_SPLIT_THRESHOLD_ROWS
      );
    }
    assert.equal(tables.length, 1);
    assert.match(
      tables[0]?.className ?? "",
      new RegExp(EDITORIAL_PDF_SPLITTABLE_TABLE_CLASS, "u")
    );
    assert.match(root.textContent, /행 27합성 표 내용 27/u);
    assert.ok(root.textContent.includes(rawHtmlLiteral));
    assert.equal(imageElements.length, 8);
  });

  it("wraps PDF stage failures without echoing private source data", () => {
    const privateSource =
      "https://private.example.test/secret?token=never-log\n# 개인 Markdown 제목";
    const cause = new RangeError(privateSource);
    const failure = createEditorialPdfStageError("인쇄 DOM 생성", cause);

    assert.match(failure.message, /인쇄 DOM 생성 단계에서 실패했습니다/u);
    assert.doesNotMatch(
      failure.message,
      /private\.example|secret|개인 Markdown 제목/u
    );
    assert.equal((failure as Error & { cause?: unknown }).cause, cause);
  });

  it("connects every print stage and sanitizes an actual DOM-stage failure", async () => {
    const source = await readFile("src/io/editorialPdf.ts", "utf8");
    for (const stage of [
      "Markdown 파싱",
      "인쇄 DOM 생성",
      "글꼴·이미지 대기",
      "페이지 조판",
      "인쇄 호출"
    ]) {
      assert.ok(
        source.includes(`"${stage}"`),
        `print must label the ${stage} stage`
      );
    }
    assert.match(source, /runEditorialPdfStage\(\s*"Markdown 파싱"/u);
    assert.match(source, /runEditorialPdfStage\("인쇄 트리 생성"/u);
    assert.match(source, /runEditorialPdfStage\("호스트 DOM 연결"/u);
    assert.match(source, /runEditorialPdfStageAsync\(\s*"글꼴·이미지 대기"/u);
    assert.match(source, /runEditorialPdfStageAsync\(\s*"페이지 조판"/u);
    assert.match(
      source,
      /runEditorialPdfStage\("인쇄 호출", \(\) => view\.print\(\)\)/u
    );

    const privateSource =
      "https://private.example.test/source?apiKey=never-echo 개인 제목";
    const throwingDocument = {
      createElementNS: () => {
        throw new RangeError(privateSource);
      }
    } as unknown as Document;
    const view = {
      navigator: { userAgent: "Chrome/131.0.0.0" }
    } as unknown as Window;

    await assert.rejects(
      new EditorialPdfService().print({
        markdown: `# ${privateSource}`,
        fileName: `${privateSource}.md`,
        window: view,
        document: throwingDocument,
        chromiumMajor: 131
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /인쇄 트리 생성 단계에서 실패했습니다/u);
        assert.doesNotMatch(
          error.message,
          /private\.example|apiKey|개인 제목/u
        );
        assert.ok(
          (error as Error & { cause?: unknown }).cause instanceof RangeError
        );
        return true;
      }
    );
  });

  it("builds the fixed HanMark Editorial cover hierarchy with safe DOM APIs", async () => {
    const source = await readFile("src/io/editorialPdf.ts", "utf8");
    const labels = [
      "HANMARK PDF PRINT",
      "EDITORIAL EDITION",
      "Markdown to Editorial PDF",
      "ACHMAGE / HanMark PDF Edition",
      "HANMARK EXPORT SYSTEM",
      "OBSIDIAN MARKDOWN · PRINT-READY A4",
      "#HANMARK",
      "#MARKDOWN",
      "#EDITORIAL",
      "#PDF"
    ];

    for (const label of labels) {
      assert.ok(source.includes(label), `cover must contain ${label}`);
    }
    for (const className of [
      "hanmark-editorial-pdf-cover-upper",
      "hanmark-editorial-pdf-cover-lower",
      "hanmark-editorial-pdf-cover-kicker",
      "hanmark-editorial-pdf-cover-edition",
      "hanmark-editorial-pdf-cover-title",
      "hanmark-editorial-pdf-cover-title-line",
      "hanmark-editorial-pdf-cover-subtitle",
      "hanmark-editorial-pdf-cover-brand",
      "hanmark-editorial-pdf-cover-system",
      "hanmark-editorial-pdf-cover-detail",
      "hanmark-editorial-pdf-cover-tags",
      "hanmark-editorial-pdf-cover-tag"
    ]) {
      assert.ok(source.includes(className), `cover must create .${className}`);
    }
    assert.match(source, /balanceEditorialPdfCoverTitle\(fileTitle\)/u);
    assert.doesNotMatch(
      source,
      /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|executeJavaScript/u
    );
  });

  it("does not expose an HTML string injection surface", () => {
    const css = createEditorialPdfStyles("</style><script>alert(1)</script>");

    assert.match(css, /content: "<\/style><script>aler…";/u);
    assert.doesNotMatch(css, /innerHTML|outerHTML|executeJavaScript/u);
  });

  it("waits for fonts and every image decode before printing can continue", async () => {
    const order: string[] = [];
    const fontTexts: string[] = [];
    const harness = createPrintHarness();
    const ownerDocument = {
      defaultView: harness.view,
      fonts: {
        load: async (font: string, text = "") => {
          order.push(`font-load:${font}`);
          fontTexts.push(text);
          return [{}];
        },
        ready: Promise.resolve().then(() => {
          order.push("fonts");
        })
      }
    } as unknown as Document;
    const image = {
      alt: "강의 사진",
      complete: true,
      naturalWidth: 640,
      decode: async () => {
        order.push("image");
      }
    } as unknown as HTMLImageElement;
    const root = {
      querySelectorAll: () => [image]
    } as unknown as HTMLElement;

    await waitForEditorialPdfAssets(ownerDocument, root);
    assert.deepEqual(order, [
      'font-load:400 10pt "HanMark Pretendard"',
      'font-load:600 10pt "HanMark Pretendard"',
      "fonts",
      'font-load:400 10pt "HanMark Pretendard", "Pretendard", "Apple SD Gothic Neo", sans-serif',
      'font-load:600 10pt "HanMark Pretendard", "Pretendard", "Apple SD Gothic Neo", sans-serif',
      "image"
    ]);
    assert.equal(fontTexts.length, 4);
    assert.ok(fontTexts.every((text) => text.includes("한글")));
  });

  it("fails closed when an included image cannot decode", async () => {
    const harness = createPrintHarness();
    const ownerDocument = {
      defaultView: harness.view,
      fonts: {
        load: async () => [{}],
        ready: Promise.resolve()
      }
    } as unknown as Document;
    const image = {
      alt: "깨진 사진",
      complete: true,
      naturalWidth: 0,
      decode: async () => {
        throw new Error("invalid image data");
      }
    } as unknown as HTMLImageElement;
    const root = {
      querySelectorAll: () => [image]
    } as unknown as HTMLElement;

    await assert.rejects(
      waitForEditorialPdfAssets(ownerDocument, root),
      /Image failed to decode \(깨진 사진\): invalid image data/u
    );
  });

  it("settles two animation frames and forces layout before opening print", async () => {
    const order: string[] = [];
    const callbacks: FrameRequestCallback[] = [];
    const view = {
      clearTimeout: (_timer: number) => {},
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        order.push("frame-request");
        callbacks.push(callback);
        return callbacks.length;
      },
      setTimeout: (_callback: TimerHandler, _timeout?: number) => 1
    } as unknown as Window;
    const root = {
      getBoundingClientRect: () => {
        order.push("layout");
        return {} as DOMRect;
      }
    } as unknown as HTMLElement;

    const settled = waitForEditorialPdfLayout(root, view);
    callbacks.shift()?.(0);
    await Promise.resolve();
    callbacks.shift()?.(16);
    await settled;

    assert.deepEqual(order, [
      "frame-request",
      "frame-request",
      "layout"
    ]);
  });

  it("synchronously primes print-media styles and geometry for root, cover, and body", () => {
    const harness = createPrintHarness();
    const root = buildEditorialPdfRoot(
      harness.document,
      {
        title: "Cold start",
        masthead: [],
        blocks: [{
          type: "paragraph",
          inlines: [{ type: "text", value: "First print body" }]
        }]
      },
      "Cold start"
    );
    harness.body.appendChild(root as unknown as TestElement);

    primeEditorialPdfPrintLayout(root, harness.view);

    assert.equal(
      harness.eventOrder.filter((entry) => entry.startsWith("computed:")).length,
      3
    );
    assert.equal(
      harness.eventOrder.filter((entry) => entry.startsWith("geometry:")).length,
      3
    );
  });

  it("waits through a cold stylesheet and empty font probes before the first print snapshot", async () => {
    const harness = createPrintHarness({
      fontReadyAfterAttempts: 1,
      stylesheetReadyAfterFrames: 1
    });
    const service = new EditorialPdfService();

    await service.print({
      markdown: "# First cold export\n\nThe first PDF must be complete.",
      fileName: "first-cold-export.md",
      window: harness.view,
      document: harness.document,
      chromiumMajor: 150
    });

    assert.equal(harness.printCalls(), 1);
    assert.deepEqual(harness.fontLoadQueries, [
      '400 10pt "HanMark Pretendard"',
      '600 10pt "HanMark Pretendard"',
      '400 10pt "HanMark Pretendard"',
      '600 10pt "HanMark Pretendard"',
      '400 10pt "HanMark Pretendard", "Pretendard", "Apple SD Gothic Neo", sans-serif',
      '600 10pt "HanMark Pretendard", "Pretendard", "Apple SD Gothic Neo", sans-serif'
    ]);
    assert.ok(harness.fontLoadTexts.every((text) => text.includes("한글")));
    const stylesheetReady = harness.eventOrder.indexOf("stylesheet-ready");
    const firstFont = harness.eventOrder.findIndex((entry) =>
      entry.startsWith("font-load:")
    );
    const hiddenLayout = harness.eventOrder.findIndex((entry) =>
      entry.startsWith("computed:")
    );
    const printCall = harness.eventOrder.indexOf("print-call");
    const firstPrintComputed = harness.eventOrder.findIndex(
      (entry, index) => index > printCall && entry.startsWith("computed:")
    );
    const firstPrintGeometry = harness.eventOrder.findIndex(
      (entry, index) => index > printCall && entry.startsWith("geometry:")
    );
    const snapshot = harness.eventOrder.indexOf("print-snapshot");
    assert.ok(stylesheetReady >= 0 && stylesheetReady < firstFont);
    assert.ok(stylesheetReady < hiddenLayout && hiddenLayout < firstFont);
    assert.ok(firstFont < printCall);
    assert.ok(printCall < firstPrintComputed && firstPrintComputed < snapshot);
    assert.ok(printCall < firstPrintGeometry && firstPrintGeometry < snapshot);
    assert.equal(harness.listenerCount("beforeprint"), 0);

    service.dispose();
  });

  it("removes the beforeprint primer and mounted artifacts when cold-start preparation fails", async () => {
    const harness = createPrintHarness({
      fontsReady: Promise.reject(new Error("font set failed"))
    });
    const service = new EditorialPdfService();

    await assert.rejects(
      service.print({
        markdown: "# Failed first export",
        fileName: "failed-first-export.md",
        window: harness.view,
        document: harness.document,
        chromiumMajor: 150
      }),
      /Editorial PDF/u
    );

    assert.equal(harness.printCalls(), 0);
    assert.equal(harness.listenerCount("beforeprint"), 0);
    assert.equal(harness.listenerCount("afterprint"), 0);
    assert.equal(
      harness.document.querySelector(".hanmark-editorial-pdf-root"),
      null
    );
    assert.equal(
      harness.document.querySelector(".hanmark-editorial-pdf-style"),
      null
    );
    assert.equal(
      harness.body.classList.contains("hanmark-editorial-pdf-active"),
      false
    );
  });

  it("keeps beforeprint priming best-effort so a transient style failure cannot empty the first export", async () => {
    const harness = createPrintHarness({ throwOnComputedStyle: true });
    const service = new EditorialPdfService();

    await service.print({
      markdown: "# 첫 PDF\n\n한글 fallback 레이아웃을 유지합니다.",
      fileName: "첫-pdf.md",
      window: harness.view,
      document: harness.document,
      chromiumMajor: 150
    });

    assert.equal(harness.printCalls(), 1);
    assert.ok(
      harness.eventOrder.indexOf("print-call") <
        harness.eventOrder.indexOf("print-snapshot")
    );
    assert.notEqual(
      harness.document.querySelector(".hanmark-editorial-pdf-root"),
      null
    );
    assert.equal(harness.listenerCount("beforeprint"), 0);

    service.dispose();
  });

  it("primes hidden and print-media layout on both exports without leaking beforeprint listeners", async () => {
    const harness = createPrintHarness();
    const service = new EditorialPdfService();

    for (const fileName of ["first.md", "second.md"]) {
      await service.print({
        markdown: `# ${fileName}\n\nRepeated export body.`,
        fileName,
        window: harness.view,
        document: harness.document,
        chromiumMajor: 150
      });
      assert.equal(harness.listenerCount("beforeprint"), 0);
    }

    assert.equal(harness.printCalls(), 2);
    assert.equal(
      harness.eventOrder.filter((entry) => entry === "print-call").length,
      2
    );
    assert.equal(
      harness.eventOrder.filter((entry) => entry === "print-snapshot").length,
      2
    );
    assert.equal(
      harness.eventOrder.filter((entry) => entry.startsWith("computed:")).length,
      12
    );
    assert.equal(harness.fontLoadQueries.length, 8);

    service.dispose();
    assert.equal(harness.listenerCount("beforeprint"), 0);
    assert.equal(harness.listenerCount("afterprint"), 0);
  });

  it("accepts an 8 MB raster data URI without a recursive regular-expression overflow", async () => {
    const pngSignature = "iVBORw0KGgo";
    const payload =
      pngSignature +
      "A".repeat(8 * 1024 * 1024 - pngSignature.length);
    const imageUri = `data:image/png;base64,${payload}`;
    const editorial = {
      title: "Large raster",
      masthead: [],
      blocks: [{
        type: "paragraph" as const,
        inlines: [{
          type: "image" as const,
          src: imageUri,
          alt: "8 MB raster"
        }]
      }]
    };

    const root = buildEditorialPdfRoot(
      createTestDocument(),
      editorial,
      "Large raster"
    ) as unknown as TestElement;
    const images = testElements(root, (element) => element.tagName === "IMG");

    assert.equal(images.length, 1);
    assert.equal(images[0]?.src.length, imageUri.length);
    assert.equal(images[0]?.src, imageUri);

    const source = await readFile("src/io/editorialPdf.ts", "utf8");
    assert.doesNotMatch(source, /\bSAFE_IMAGE_DATA_URI\b/u);
    assert.match(source, /\bsafeEditorialImageUrl\b/u);
    assert.match(source, /safeEditorialImageUrl\(inline\.src\)/u);
  });

  it("rejects a concurrent print promptly without disturbing the pending first print", async () => {
    let releaseFonts: (() => void) | undefined;
    const fontsReady = new Promise<void>((resolve) => {
      releaseFonts = resolve;
    });
    const harness = createPrintHarness({ fontsReady });
    const service = new EditorialPdfService();
    const first = service.print({
      markdown: "# First export\n\nThe first export must remain mounted.",
      fileName: "first.md",
      window: harness.view,
      document: harness.document,
      chromiumMajor: 150
    });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (
        harness.document.querySelectorAll(
          ".hanmark-editorial-pdf-root"
        ).length === 1
      ) {
        break;
      }
      await Promise.resolve();
    }
    const mountedRoot = harness.document.querySelector(
      ".hanmark-editorial-pdf-root"
    );
    assert.ok(mountedRoot, "the first print tree must be mounted while fonts wait");

    const second = service.print({
      markdown: "# Second export",
      fileName: "second-private-title.md",
      window: harness.view,
      document: harness.document,
      chromiumMajor: 150
    });
    const secondResult = await Promise.race([
      second.then(
        () => "resolved",
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /PDF 내보내기가 이미 진행 중입니다/u);
          return "rejected";
        }
      ),
      new Promise<string>((resolve) => {
        globalThis.setTimeout(() => resolve("timeout"), 100);
      })
    ]);

    assert.equal(secondResult, "rejected");
    assert.equal(
      harness.document.querySelector(".hanmark-editorial-pdf-root"),
      mountedRoot,
      "a rejected concurrent call must not replace or remove the first tree"
    );
    assert.equal(
      harness.body.classList.contains("hanmark-editorial-pdf-active"),
      true
    );

    releaseFonts?.();
    await first;
    assert.equal(harness.printCalls(), 1);
    service.dispose();
  });

  it("sweeps orphan print roots, styles, and the stale body class before mounting a fresh export", async () => {
    const harness = createPrintHarness();
    const orphanRoot = new TestElement("SECTION");
    orphanRoot.className = "hanmark-editorial-pdf-root print";
    const orphanStyle = new TestElement("STYLE");
    orphanStyle.className = "hanmark-editorial-pdf-style";
    harness.body.appendChild(orphanRoot);
    harness.head.appendChild(orphanStyle);
    harness.body.classList.add("hanmark-editorial-pdf-active");

    const service = new EditorialPdfService();
    await service.print({
      markdown: "# Fresh export",
      fileName: "fresh.md",
      window: harness.view,
      document: harness.document,
      chromiumMajor: 150
    });

    assert.equal(orphanRoot.removed, true);
    assert.equal(orphanStyle.removed, true);
    assert.equal(
      harness.document.querySelectorAll(".hanmark-editorial-pdf-root").length,
      1,
      "only the fresh print tree may remain"
    );
    assert.equal(
      harness.document.querySelectorAll(".hanmark-editorial-pdf-style").length,
      1,
      "only the fresh print stylesheet may remain"
    );
    assert.equal(
      harness.body.classList.contains("hanmark-editorial-pdf-active"),
      true,
      "the fresh export must restore the active class after sweeping it"
    );

    service.dispose();
    assert.equal(
      harness.document.querySelectorAll(".hanmark-editorial-pdf-root").length,
      0
    );
    assert.equal(
      harness.document.querySelectorAll(".hanmark-editorial-pdf-style").length,
      0
    );
    assert.equal(
      harness.body.classList.contains("hanmark-editorial-pdf-active"),
      false
    );
  });

  it("reports only a whitelisted stage-error kind and never the private cause message", () => {
    const privateMessage =
      "C:\\Users\\private-user\\Vault\\secret.md?apiKey=never-echo";
    const failure = createEditorialPdfStageError(
      "인쇄 DOM 생성",
      new RangeError(privateMessage)
    );

    assert.match(failure.message, /\(RangeError\)/u);
    assert.doesNotMatch(failure.message, /private-user|secret|apiKey|never-echo/u);

    const disguised = new Error(privateMessage);
    disguised.name = "SecretFileApiKeyError";
    const disguisedFailure = createEditorialPdfStageError(
      "인쇄 DOM 생성",
      disguised
    );
    assert.doesNotMatch(
      disguisedFailure.message,
      /SecretFileApiKeyError|private-user|secret|apiKey|never-echo/u
    );
  });

  it("owns an idempotent print lifecycle without private Electron APIs", async () => {
    const source = await readFile("src/io/editorialPdf.ts", "utf8");

    assert.match(source, /let cleaned = false;/u);
    assert.match(source, /if \(cleaned\) return;\s*cleaned = true;/u);
    assert.match(
      source,
      /addEventListener\("afterprint", schedulePostPrintCleanup/u
    );
    assert.match(
      source,
      /delayedCleanup = view\.setTimeout\(cleanup, POST_PRINT_CLEANUP_DELAY_MS\)/u
    );
    assert.match(source, /addEventListener\("error", cleanup/u);
    assert.match(source, /addEventListener\("beforeunload", cleanup/u);
    assert.match(source, /watchdog = view\.setTimeout\(/u);
    assert.match(source, /root\.remove\(\);\s*style\.remove\(\);/u);
    assert.match(
      source,
      /runEditorialPdfStage\("인쇄 호출", \(\) => view\.print\(\)\);/u
    );
    assert.match(
      source,
      /await runEditorialPdfStageAsync\([\s\S]*?"페이지 조판",[\s\S]*?\(\) => waitForEditorialPdfLayout\([\s\S]*?root,[\s\S]*?view,[\s\S]*?DEFAULT_ASSET_TIMEOUT_MS[\s\S]*?\)[\s\S]*?\);/u
    );
    assert.match(source, /MAX_EDITORIAL_PDF_RENDER_DEPTH = 128/u);
    assert.match(
      source,
      /PDF content nesting exceeds the safe rendering limit/u
    );
    assert.doesNotMatch(
      source,
      /\.innerHTML\b|\.outerHTML\b|executeJavaScript|from\s+["']electron["']|window\.require/u
    );
  });
});
