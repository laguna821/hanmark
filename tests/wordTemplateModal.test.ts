import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Word template manager preserves the 2.4.2 edit and activation contract", async () => {
  const source = await readFile(
    "src/ui/WordTemplateManagerModal.ts",
    "utf8"
  );

  assert.match(source, /hanmark-resizable-workspace-modal/u);
  assert.match(source, /wordTemplateDraftIsDirty/u);
  assert.match(source, /저장하지 않은 변경을 버리고 닫을까요/u);
  assert.match(source, /저장하고 사용/u);
  assert.match(source, /saveDraft\(false\)/u);
  assert.match(source, /saveDraft\(true\)/u);
  assert.match(
    source,
    /if \(useTemplate\) \{\s*active = await this\.options\.store\.setActiveTemplate/u
  );
  assert.match(source, /style\.basedOn =/u);
  assert.match(source, /style\.nextStyle =/u);
  assert.match(source, /WORD_TEMPLATE_PREVIEW_SAMPLE/u);
  assert.match(source, /getActiveViewOfType\(MarkdownView\)/u);
  assert.match(source, /applyWordTemplatePreview\(paper, rendered, draft\)/u);
  assert.match(source, /MAX_VISIBLE_FONT_RESULTS = 200/u);
});

test("Word template manager is a resizable, internally scrolling workspace", async () => {
  const css = await readFile("styles.css", "utf8");

  assert.match(
    css,
    /\.modal-container \.modal\.hanmark-resizable-workspace-modal \{/u
  );
  assert.match(css, /resize: both;/u);
  assert.match(css, /\.word-template-editor \{\s*overflow: auto;/u);
  assert.match(css, /\.word-template-preview-stage \{[\s\S]*?overflow: auto;/u);
});
