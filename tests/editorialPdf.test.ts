import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  EDITORIAL_PDF_MIN_CHROMIUM,
  createEditorialPdfStyles,
  detectChromiumMajor,
  escapeEditorialPdfCssString,
  getEditorialPdfRuntimeSupport,
  truncateEditorialPdfHeader,
  waitForEditorialPdfAssets
} from "../src/io/editorialPdf";

describe("Achmage Editorial PDF helpers", () => {
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

  it("builds A4 print CSS with a filename-only cover and p2+ margin boxes", () => {
    const css = createEditorialPdfStyles("강의 \"문서\" 제목");

    assert.match(css, /@page \{\s*size: A4 portrait;/u);
    assert.match(css, /@top-center \{\s*content: "강의 \\"문서\\" 제목";/u);
    assert.match(css, /@bottom-center \{\s*content: counter\(page\);/u);
    assert.match(css, /@page :first \{[\s\S]*?content: none;[\s\S]*?border-bottom: none;/u);
    assert.match(css, /break-after: page;/u);
    assert.match(css, /widows: 3;/u);
    assert.match(css, /orphans: 3;/u);
    assert.match(css, /"HanMark Pretendard"/u);
    assert.doesNotMatch(css, /COLLOQUIUM|author|subtitle|tag/u);
    assert.doesNotMatch(css, /!important/u);
  });

  it("does not expose an HTML string injection surface", () => {
    const css = createEditorialPdfStyles("</style><script>alert(1)</script>");

    assert.match(css, /content: "<\/style><script>alert\(1\)<\/script>";/u);
    assert.doesNotMatch(css, /innerHTML|outerHTML|executeJavaScript/u);
  });

  it("waits for fonts and every image decode before printing can continue", async () => {
    const order: string[] = [];
    const ownerDocument = {
      fonts: {
        load: async () => {
          order.push("font-load");
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
    assert.deepEqual(order, ["font-load", "fonts", "image"]);
  });

  it("fails closed when an included image cannot decode", async () => {
    const ownerDocument = {
      fonts: { ready: Promise.resolve() }
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

  it("owns an idempotent print lifecycle without private Electron APIs", async () => {
    const source = await readFile("src/io/editorialPdf.ts", "utf8");

    assert.match(source, /let cleaned = false;/u);
    assert.match(source, /if \(cleaned\) return;\s*cleaned = true;/u);
    assert.match(source, /addEventListener\("afterprint", cleanup/u);
    assert.match(source, /addEventListener\("error", cleanup/u);
    assert.match(source, /addEventListener\("beforeunload", cleanup/u);
    assert.match(source, /watchdog = view\.setTimeout\(/u);
    assert.match(source, /root\.remove\(\);\s*style\.remove\(\);/u);
    assert.match(source, /view\.print\(\);/u);
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
