import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function exportSources(): Promise<{
  modal: string;
  main: string;
  toolbar: string;
  css: string;
}> {
  const [modal, main, toolbar, css] = await Promise.all([
    readFile("src/ui/HanmarkExportModal.ts", "utf8"),
    readFile("src/main.ts", "utf8"),
    readFile("src/ui/ToolbarController.ts", "utf8"),
    readFile("styles.css", "utf8")
  ]);
  return { modal, main, toolbar, css };
}

describe("HanMark unified export center", () => {
  it("offers all four formats with concise format-specific microcopy", async () => {
    const { modal } = await exportSources();
    const cards = [
      ["hwpx", "편집 가능한 한글 문서로 내보냅니다."],
      ["docx", "Word 문서로 내보냅니다. Pandoc이 필요합니다."],
      ["html", "모바일 브라우저에 적합한 HTML로 내보냅니다."],
      ["pdf", "52/48 전면 표지와 브랜드 머리말을 갖춘 Editorial PDF로 인쇄합니다."]
    ] as const;

    for (const [format, microcopy] of cards) {
      assert.match(modal, new RegExp(`id: "${format}"`, "u"));
      assert.ok(
        modal.includes(microcopy),
        `${format} card must retain its user-facing microcopy`
      );
    }
  });

  it("removes the old tab interface and preserves accessible selection states", async () => {
    const { modal, css } = await exportSources();

    assert.doesNotMatch(
      `${modal}\n${css}`,
      /hanmark-export-tabs|hanmark-export-tab\b|activeTab|role:\s*"tab(?:list)?"/u
    );
    assert.match(modal, /"aria-pressed": String\(selected\)/u);
    assert.match(modal, /"aria-describedby": descriptionId/u);
    assert.match(
      modal,
      /cls: "hanmark-export-variant-grid",[\s\S]{0,120}?role: "group"/u
    );
    assert.match(modal, /"aria-pressed": String\(selected\)/u);
  });

  it("prints a self-contained Editorial PDF without the legacy Obsidian command", async () => {
    const { modal, main } = await exportSources();
    const pdf = await readFile("src/io/editorialPdf.ts", "utf8");

    assert.doesNotMatch(main, /workspace:export-pdf/u);
    assert.match(main, /new EditorialPdfService\(\)/u);
    assert.match(main, /this\.editorialPdf\.print\(\{/u);
    assert.match(main, /prepareSelfContainedHtmlMarkdown\(body,/u);
    assert.match(main, /choosePdfImageFailureAction/u);
    assert.match(main, /this\.editorialPdf\.dispose\(\)/u);
    assert.match(pdf, /EDITORIAL_PDF_MIN_CHROMIUM = 131/u);
    assert.match(pdf, /@page hanmark-cover/u);
    assert.match(pdf, /@page hanmark-body/u);
    assert.match(pdf, /@top-left/u);
    assert.match(pdf, /@top-right/u);
    assert.match(pdf, /@bottom-left/u);
    assert.match(pdf, /@bottom-right/u);
    assert.match(pdf, /view\.print\(\)/u);
    assert.doesNotMatch(pdf, /!important/u);
    assert.match(
      modal,
      /A4 첫 장은 여백 없는 52\/48 HanMark Editorial 표지로 구성하고/u
    );
    assert.match(
      modal,
      /2쪽부터 브랜드 머리말·청록 실선·푸터·페이지 번호와 함께/u
    );
    assert.match(
      modal,
      /원문은 변경하지 않으며 이미지와 Pretendard 글꼴을 준비한 뒤/u
    );
    assert.match(
      modal,
      /if \(this\.format === "pdf"\) \{[\s\S]{0,240}?super\.close\(\);[\s\S]{0,120}?this\.actions\.exportPdf/u
    );
  });

  it("opens the exact selected format from each toolbar button in document-format order", async () => {
    const { main, toolbar, css } = await exportSources();
    const buttons = [
      ["HWPX", "openHwpxExport", "hwpx"],
      ["DOCX", "openDocxExport", "docx"],
      ["HTML", "openHtmlExport", "html"],
      ["PDF", "openPdfExport", "pdf"]
    ] as const;

    let previousButton = -1;
    for (const [label, action, format] of buttons) {
      assert.match(
        main,
        new RegExp(
          `${action}: \\(\\) => this\\.openExportCenter\\("${format}"\\)`,
          "u"
        )
      );
      assert.match(
        toolbar,
        new RegExp(
          `label: "${label} 내보내기",[\\s\\S]{0,180}?action: this\\.actions\\.${action}`,
          "u"
        )
      );
      const currentButton = toolbar.indexOf(`text: "${label}"`);
      assert.ok(
        currentButton > previousButton,
        `${label} must follow the preceding export button`
      );
      previousButton = currentButton;
    }
    assert.match(
      toolbar,
      /cls: "hwp-toolbar-group hwp-toolbar-export-group"/u
    );
    assert.match(
      toolbar,
      /icon: "printer",[\s\S]{0,120}?label: "PDF 내보내기",[\s\S]{0,120}?text: "PDF"/u
    );
    assert.match(
      toolbar,
      /"aria-label": options\.label,[\s\S]{0,80}?title: options\.label/u
    );
    assert.match(
      css,
      /\.hwp-toolbar-export-group \{[\s\S]{0,180}?flex-wrap: wrap;[\s\S]{0,180}?max-width: 100%;/u
    );
  });

  it("offers file reveal only for a saved result carrying a Vault path", async () => {
    const { modal } = await exportSources();
    const resultStart = modal.indexOf("private renderResult(");
    const footerStart = modal.indexOf("private renderFooter(", resultStart);
    assert.ok(resultStart >= 0 && footerStart > resultStart);
    const resultBlock = modal.slice(resultStart, footerStart);

    assert.match(
      resultBlock,
      /result\.status === "saved"\s*&&\s*result\.vaultPath\s*&&\s*this\.actions\.revealOutput/u
    );
    assert.match(resultBlock, /text: "파일 위치 보기"/u);
    assert.equal(
      (modal.match(/text: "파일 위치 보기"/gu) ?? []).length,
      1,
      "the reveal control must not be rendered outside the guarded result panel"
    );
  });

  it("uses a two-column grid that collapses to one column", async () => {
    const { modal, css } = await exportSources();

    assert.match(
      css,
      /\.hanmark-export-format-grid \{\s*display: grid;\s*grid-template-columns: 1fr 1fr;/u
    );
    assert.match(
      css,
      /@container \(max-width: 700px\) \{[\s\S]{0,180}?\.hanmark-export-format-grid \{\s*grid-template-columns: 1fr;/u
    );
    assert.match(css, /\.hanmark-export-format-card\.is-selected/u);
    assert.match(css, /border-color: var\(--hanmark-export-key-color\)/u);
    assert.match(
      css,
      /\.hanmark-export-variant-grid \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/u
    );
    assert.doesNotMatch(
      css,
      /\.hanmark-export-variant-grid \{[\s\S]{0,140}?repeat\(3,/u
    );
    assert.match(
      css,
      /@container \(max-width: 700px\) \{[\s\S]{0,360}?\.hanmark-export-variant-grid \{\s*grid-template-columns: 1fr;/u
    );
    assert.match(
      modal,
      /cls: "hanmark-export-preview-row"[\s\S]{0,600}?cls: "hanmark-export-secondary-action"[\s\S]{0,180}?"aria-describedby": previewDescriptionId/u
    );
    assert.match(
      modal,
      /const descriptionId = `hanmark-export-\$\{id\}-description`;[\s\S]{0,300}?"aria-describedby": descriptionId/u
    );
  });

  it("does not reintroduce unsafe HTML or Electron escape hatches", async () => {
    const sources = await exportSources();
    const combined = Object.values(sources).join("\n");

    assert.doesNotMatch(combined, /\.innerHTML\b|\.outerHTML\b/u);
    assert.doesNotMatch(combined, /window\s*\.\s*require\b/u);
    assert.doesNotMatch(
      combined,
      /(?:from\s+|require\()\s*["']electron["']|showItemInFolder|electron\.shell/u
    );
  });

  it("routes HTML through the self-contained image service and selected theme", async () => {
    const { modal, main } = await exportSources();
    const imageService = await readFile(
      "src/io/htmlExportService.ts",
      "utf8"
    );

    assert.match(main, /prepareSelfContainedHtmlMarkdown\(body,/u);
    assert.match(main, /createObsidianImageLoader\(this\.app, view\.file\)/u);
    assert.match(main, /theme: this\.settings\.htmlExportTheme/u);
    assert.match(main, /"retry" \| "continue" \| "cancel"/u);
    assert.match(main, /실패한 외부 주소는 HTML에 남지 않습니다/u);
    assert.match(modal, /Achmage Editorial \(권장\)/u);
    assert.match(modal, /Classic \(기존 스타일\)/u);
    assert.match(imageService, /maxImages: 100/u);
    assert.match(imageService, /maxImageBytes: 20 \* 1024 \* 1024/u);
    assert.match(imageService, /maxTotalBytes: 200 \* 1024 \* 1024/u);
    assert.match(imageService, /concurrency: 4/u);
  });
});
