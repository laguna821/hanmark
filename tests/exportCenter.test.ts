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
      ["pdf", "공유·인쇄·강의자료용 PDF 설정 창을 엽니다."]
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

  it("delegates PDF to Obsidian and explains that it is not HWPX-template output", async () => {
    const { modal, main } = await exportSources();

    assert.match(
      main,
      /commands\.executeCommandById\("workspace:export-pdf"\)/u
    );
    assert.match(
      modal,
      /Obsidian의 기본 PDF 내보내기 설정 창을 엽니다/u
    );
    assert.match(
      modal,
      /PDF는 Obsidian의 인쇄 스타일을 사용하므로 HanMark HWPX 템플릿과 화면이 다를 수 있습니다/u
    );
    assert.match(
      modal,
      /if \(this\.format === "pdf"\) \{[\s\S]{0,240}?super\.close\(\);[\s\S]{0,120}?this\.actions\.exportPdf/u
    );
  });

  it("opens the exact selected format from each existing toolbar button", async () => {
    const { main, toolbar } = await exportSources();
    const buttons = [
      ["HWPX", "openHwpxExport", "hwpx"],
      ["DOCX", "openDocxExport", "docx"],
      ["HTML", "openHtmlExport", "html"]
    ] as const;

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
    }
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
    const { css } = await exportSources();

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
