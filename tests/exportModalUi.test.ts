import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("unified export modal exposes four accessible format cards", async () => {
  const source = await readFile("src/ui/HanmarkExportModal.ts", "utf8");

  for (const format of ["hwpx", "docx", "html", "pdf"]) {
    assert.match(source, new RegExp(`id: "${format}"`, "u"));
  }
  assert.match(source, /role: "group"/u);
  assert.match(source, /"aria-pressed": String\(selected\)/u);
  assert.match(source, /"aria-describedby": descriptionId/u);
  assert.match(source, /type: "button"/u);
  assert.doesNotMatch(source, /hanmark-export-tabs|renderOther\(/u);
  assert.doesNotMatch(source, /\.innerHTML|\.outerHTML/u);
});

test("unified export modal keeps format-specific options and one active footer", async () => {
  const source = await readFile("src/ui/HanmarkExportModal.ts", "utf8");

  assert.match(source, /"quick"/u);
  assert.match(source, /"gongmun"/u);
  assert.doesNotMatch(source, /"source-patch"|sourcePatchAvailable|patchSource/u);
  assert.match(source, /cls: "hanmark-export-variant-grid"/u);
  assert.match(source, /"aria-pressed": String\(selected\)/u);
  assert.match(source, /this\.actions\.openPreview\(\)/u);
  assert.match(source, /this\.actions\.openDocxPreview/u);
  assert.match(source, /this\.actions\.openPandocSettings/u);
  assert.match(source, /this\.actions\.exportPdf/u);
  assert.match(
    source,
    /if \(this\.result\) \{\s*this\.renderResult\(contentEl, this\.result\);\s*\} else \{\s*this\.renderFooter\(contentEl\);/u
  );
  assert.match(
    source,
    /this\.result = result\.status !== "cancelled" \? result : null;/u
  );
  assert.match(source, /result !== false && result !== null/u);
  assert.doesNotMatch(source, /text: "템플릿 관리"/u);
});

test("official documents are chosen as a frame and a look in the export window and the preview (R-026, R-030)", async () => {
  const modal = await readFile("src/ui/HanmarkExportModal.ts", "utf8");
  // One shared picker: the frame select, the searchable look chooser, and the frame's switches.
  assert.match(modal, /renderGongmunFormPicker\(formRow, \{/u);
  assert.match(modal, /idPrefix: "hanmark-export-gongmun"/u);
  assert.match(modal, /await this\.actions\.selectGongmunForm\?\.\(id\)/u);
  assert.doesNotMatch(modal, /fillGongmunFormSelect|hanmark-export-gongmun-preset|hanmark-export-gongmun-style/u);
  // Where the choice came from: the note's type and the note's look.
  assert.match(modal, /t\("gongmun\.form\.fromNote"/u);
  assert.match(modal, /t\("gongmun\.form\.noteDiffers"/u);
  assert.match(modal, /t\("gongmun\.look\.fromNote"/u);
  assert.match(modal, /t\("gongmun\.look\.noteDiffers"/u);
  const picker = await readFile("src/ui/gongmunFormPicker.ts", "utf8");
  assert.match(picker, /form\?\.description \?\? t\("gongmun\.frame\.help"\)/u);
  assert.match(picker, /role: "combobox"/u);
  assert.match(picker, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/u);

  const preview = await readFile("src/ui/QuickHwpxPreviewView.ts", "utf8");
  // The preview switches between quick HWPX and official documents, shows the same picker, refreshes, and saves.
  assert.match(preview, /select\.createEl\("option", \{ value: QUICK_VALUE, text: t\("preview\.hwpx\.quick"\) \}\);/u);
  assert.match(preview, /renderGongmunFormPicker\(toolbar, \{/u);
  assert.match(preview, /idPrefix: "hanmark-preview-gongmun"/u);
  assert.match(preview, /t\("preview\.hwpx\.save"\)/u);
  assert.match(preview, /await this\.options\.exportHwpx\?\.\(this\.effectiveMode\(file\)\);/u);
  assert.match(preview, /await this\.options\.rememberMode\?\.\(this\.mode\.kind\);/u);
});

test("export cards form a responsive skin-aware two-by-two grid", async () => {
  const css = await readFile("styles.css", "utf8");

  assert.match(
    css,
    /\.hanmark-export-format-grid \{\s*display: grid;\s*grid-template-columns: 1fr 1fr;/u
  );
  assert.match(css, /@container \(max-width: 700px\)/u);
  assert.match(
    css,
    /@container \(max-width: 700px\) \{[\s\S]*?\.hanmark-export-format-grid \{\s*grid-template-columns: 1fr;/u
  );
  assert.match(css, /--hanmark-export-key-color/u);
  assert.match(css, /--hwp-toolbar-light-logo-hwp/u);
  assert.match(css, /--hwp-toolbar-dark-logo-word/u);
  assert.match(css, /\.hanmark-export-format-card:focus-visible/u);
  assert.match(css, /\.hanmark-export-format-card\.is-selected/u);
});

test("long exports lock the whole modal and restore focus afterwards", async () => {
  const source = await readFile("src/ui/HanmarkExportModal.ts", "utf8");

  assert.match(source, /this\.busy = true;\s*this\.render\(\);/u);
  assert.match(source, /button\.disabled = this\.busy/u);
  assert.match(source, /select\.disabled = this\.busy/u);
  assert.match(source, /close\(\): void \{\s*if \(this\.busy\) return;/u);
  assert.match(
    source,
    /querySelector<HTMLButtonElement>\(\s*"\.hanmark-export-result button"\s*\)\s*\?\.focus\(\)/u
  );
});
