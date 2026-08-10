import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PDF theme manager exposes immutable built-in and complete custom CRUD", async () => {
  const source = await readFile(
    "src/ui/EditorialPdfThemeManagerModal.ts",
    "utf8"
  );

  assert.match(source, /BUILTIN_EDITORIAL_PDF_THEME_ID/u);
  assert.match(source, /selected\.builtIn \? "복제 후 편집" : "편집"/u);
  assert.match(source, /createEditorialPdfTheme\(/u);
  assert.match(source, /updateEditorialPdfTheme\(/u);
  assert.match(source, /duplicateEditorialPdfTheme\(/u);
  assert.match(source, /renameEditorialPdfTheme\(/u);
  assert.match(source, /deleteEditorialPdfTheme\(/u);
  assert.match(source, /setActiveEditorialPdfTheme\(/u);
  assert.match(source, /await this\.options\.replaceLibrary\(library\)/u);
  assert.doesNotMatch(source, /\.innerHTML|\.outerHTML|srcdoc/u);
});

test("PDF theme builder keeps a three-step novice flow and three overrides", async () => {
  const source = await readFile(
    "src/ui/EditorialPdfThemeManagerModal.ts",
    "utf8"
  );

  assert.match(source, /"1\. 키 컬러"/u);
  assert.match(source, /"2\. 문구"/u);
  assert.match(source, /"3\. 미리보기"/u);
  assert.match(source, /type: "color"/u);
  assert.match(source, /canonicalEditorialPdfHex\(this\.keyInput\)/u);
  assert.match(source, /token: "onKey"/u);
  assert.match(source, /token: "keyInk"/u);
  assert.match(source, /token: "accentLine"/u);
  assert.match(source, /자동 추천 적용/u);
  assert.match(source, /낮은 대비도 저장되며 실제 수치와 경고가 계속 표시됩니다/u);
  assert.match(source, /왜 이 색인가요\?/u);
  assert.match(source, /renderColorChoiceExplanation/u);
  assert.match(source, /editorialPdfContrastStatus\(resolved\)/u);
  assert.match(source, /palette\.keyTextSurface/u);
  assert.match(source, /--hanmark-pdf-preview-key-text-surface/u);
  assert.match(
    source,
    /직접 지정하면 글자용 면 자동 보정이 꺼지고 원 키 컬러 위에 적용됩니다/u
  );
  assert.match(source, /PDF 전체의 WCAG 준수를 뜻하지 않습니다/u);
  assert.match(source, /화면 안티앨리어싱/u);
  assert.doesNotMatch(source, /자동 추천이 대부분 가장 안전합니다/u);
  assert.doesNotMatch(source, /선택한 색 자체는 바꾸지 않습니다/u);
  assert.doesNotMatch(source, /프로젝트 회의 기록/u);
  assert.match(source, /getActiveFile\(\)\?\.basename\.trim\(\)/u);
  assert.match(source, /previewFileTitle/u);
  assert.match(source, /hanmark-pdf-theme-preview-cover-title/u);
  assert.match(source, /editorialPdfContrastGuidance/u);
  assert.match(source, /formatEditorialPdfContrastRatio/u);
  assert.match(source, /3:1은 큰 글자에만 적용되는 기준입니다/u);
  assert.match(source, /role: "status"/u);
  assert.match(source, /"aria-live": "polite"/u);
  assert.match(source, /const codeBlock = body\.createEl\("pre"\)/u);
  assert.match(source, /await this\.options\.save\(/u);
  assert.match(
    source,
    /onClose\(\): void \{\s*this\.modalEl\.removeClass\("hanmark-resizable-workspace-modal"\);\s*this\.modalEl\.removeClass\("hanmark-pdf-theme-workspace-modal"\);\s*this\.contentEl\.empty\(\);\s*\}/u
  );
});

test("PDF theme JSON uses the audited file gateway and strict 256KiB cap", async () => {
  const source = await readFile(
    "src/ui/EditorialPdfThemeManagerModal.ts",
    "utf8"
  );

  assert.match(source, /fileGateway\.pickFiles\(\{/u);
  assert.match(source, /extensions: \["json"\]/u);
  assert.match(source, /maxFiles: 1/u);
  assert.match(
    source,
    /maxFileBytes: EDITORIAL_PDF_THEME_MAX_JSON_BYTES/u
  );
  assert.match(source, /parseEditorialPdfThemeExchange\(file\.bytes\)/u);
  assert.match(source, /fileGateway\.saveFile\(/u);
  assert.match(source, /stringifyEditorialPdfThemeExchange\(/u);
  assert.doesNotMatch(source, /node:fs|from "fs"|clipboard/u);
});

test("export modal persists theme selection with rollback and reports warnings", async () => {
  const source = await readFile("src/ui/HanmarkExportModal.ts", "utf8");
  const main = await readFile("src/main.ts", "utf8");

  assert.match(source, /id: "hanmark-export-pdf-theme-select"/u);
  assert.match(source, /await this\.actions\.selectPdfTheme/u);
  assert.match(source, /select\.value = previousId/u);
  assert.match(source, /editorialPdfContrastStatus\(resolved\)/u);
  assert.match(
    source,
    /--hanmark-pdf-theme-swatch-color"[\s\S]*?resolved\.palette\.keySurface/u
  );
  assert.doesNotMatch(source, /resolved\.palette\.keyTextSurface/u);
  assert.doesNotMatch(source, /자동 가독성 검사 통과/u);
  assert.match(source, /openPdfThemeManager\?\.\("create"\)/u);
  assert.match(source, /openPdfThemeManager\?\.\("manage"\)/u);
  assert.match(main, /const previous = this\.settings\.editorialPdfThemeLibrary/u);
  assert.match(
    main,
    /this\.settings\.editorialPdfThemeLibrary = previous;\s*throw error;/u
  );
  assert.match(main, /theme: activeEditorialPdfThemeSnapshot\(/u);
});

test("settings and CSS expose keyboard-visible PDF theme management", async () => {
  const manager = await readFile(
    "src/ui/EditorialPdfThemeManagerModal.ts",
    "utf8"
  );
  const settings = await readFile("src/ui/HanmarkSettingTab.ts", "utf8");
  const css = await readFile("styles.css", "utf8");

  assert.match(manager, /hanmark-pdf-theme-workspace-modal/u);
  assert.match(settings, /PDF 테마 관리/u);
  assert.match(settings, /openEditorialPdfThemeManager/u);
  assert.match(
    css,
    /\.hanmark-resizable-workspace-modal\.hanmark-pdf-theme-workspace-modal[\s\S]*?width: 96vw;[\s\S]*?height: 94vh;/u
  );
  assert.match(
    css,
    /\.modal\.hanmark-resizable-workspace-modal\.hanmark-pdf-theme-workspace-modal[\s\S]*?> \.modal-content[\s\S]*?flex: 1 1 auto;[\s\S]*?min-height: 0;[\s\S]*?overflow: auto;/u
  );
  assert.match(
    css,
    /> \.modal-content\.hanmark-pdf-theme-builder[\s\S]*?display: flex;[\s\S]*?overflow: hidden;/u
  );
  assert.match(
    css,
    /\.hanmark-pdf-theme-builder-panel \{[\s\S]*?flex: 1 1 auto;[\s\S]*?overflow: auto;/u
  );
  assert.match(css, /@media \(max-width: 1440px\), \(max-height: 900px\)/u);
  assert.match(css, /\.hanmark-pdf-theme-builder button:focus-visible/u);
  assert.match(
    css,
    /\.hanmark-pdf-theme-preview-cover-top \{[\s\S]*?flex: 0 0 52%;[\s\S]*?--bold-color: var\(--hanmark-pdf-preview-on-key\);/u
  );
  assert.match(
    css,
    /\.hanmark-pdf-theme-preview-cover-body \{[\s\S]*?--bold-color: var\(--hanmark-pdf-preview-key-ink\);/u
  );
  assert.match(
    css,
    /\.hanmark-pdf-theme-preview-cover-brand,[\s\S]*?\.hanmark-pdf-theme-preview-cover-system \{\s*color: inherit;/u
  );
  assert.match(
    css,
    /\.hanmark-pdf-theme-preview-body pre \{[\s\S]*?background: var\(--hanmark-pdf-preview-key-text-surface\);[\s\S]*?color: var\(--hanmark-pdf-preview-on-key\);/u
  );
  assert.match(
    css,
    /\.hanmark-pdf-theme-preview-cover-top \{[\s\S]*?background: var\(--hanmark-pdf-preview-key-text-surface\);/u
  );
  assert.match(
    css,
    /\.hanmark-pdf-theme-preview-tags span \{[\s\S]*?background: var\(--hanmark-pdf-preview-key-text-surface\);/u
  );
  assert.match(css, /\.hanmark-pdf-theme-contrast-explanation > summary/u);
  assert.match(
    css,
    /--hanmark-pdf-theme-swatch-color,[\s\S]*?--hanmark-pdf-preview-key/u
  );
  assert.match(css, /\.hanmark-pdf-theme-row:focus-within/u);
  assert.doesNotMatch(css, /:has\(/u);
  assert.match(css, /\.hanmark-pdf-theme-diagnostics\.has-warning/u);
  assert.doesNotMatch(css, /\.hanmark-pdf-theme[^\n{]*\{[^}]*!important/gu);
});
