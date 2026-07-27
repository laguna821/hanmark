import assert from "node:assert/strict";
import { test } from "node:test";
import {
  editorialPlainText,
  parseEditorialDocument
} from "../src/io/editorialDocument";
import { renderStandaloneHtml } from "../src/legacy-port/htmlExport";

function blockText(
  block: ReturnType<typeof parseEditorialDocument>["blocks"][number]
): string {
  if (block.type === "paragraph" || block.type === "heading") {
    return editorialPlainText(block.inlines);
  }
  return "";
}

test("Editorial raw HTML keeps block structure while unwrapping unknown wrappers", () => {
  const document = parseEditorialDocument(
    "<div><h2>Title</h2><p>One</p><p>Two</p></div>",
    "fallback"
  );

  assert.deepEqual(
    document.blocks.map((block) => block.type),
    ["heading", "paragraph", "paragraph"]
  );
  assert.deepEqual(document.blocks.map(blockText), ["Title", "One", "Two"]);
});

test("Editorial raw HTML decodes safe named and numeric entities", () => {
  const document = parseEditorialDocument(
    "<p>&copy; &mdash; &#169; &#x2014; &frac12;</p>",
    "fallback"
  );

  assert.equal(document.blocks[0]?.type, "paragraph");
  assert.equal(
    document.blocks[0]?.type === "paragraph"
      ? editorialPlainText(document.blocks[0].inlines)
      : "",
    "© — © — ½"
  );
});

test("Editorial raw HTML fails closed at 5,000 levels without overflowing", () => {
  const levels = 5_000;
  const inlinePayload = [
    "<p>",
    "<span>".repeat(levels),
    "deep-inline-secret",
    "</span>".repeat(levels),
    "</p>"
  ].join("");
  const blockPayload = [
    "<div>".repeat(levels),
    "deep-block-secret",
    "</div>".repeat(levels)
  ].join("");

  let inlineDocument: ReturnType<typeof parseEditorialDocument> | undefined;
  let blockDocument: ReturnType<typeof parseEditorialDocument> | undefined;
  assert.doesNotThrow(() => {
    inlineDocument = parseEditorialDocument(inlinePayload, "inline");
    blockDocument = parseEditorialDocument(blockPayload, "block");
  });

  const visibleText = [inlineDocument, blockDocument]
    .flatMap((document) => document?.blocks ?? [])
    .map(blockText)
    .join(" ");
  assert.doesNotMatch(visibleText, /deep-(?:inline|block)-secret/);
});

test("Editorial loose lists keep only the first item paragraph inline", () => {
  const html = renderStandaloneHtml(
    [
      "# List",
      "",
      "- [x] First paragraph",
      "",
      "  Second paragraph"
    ].join("\n"),
    { title: "List" }
  );

  assert.match(
    html,
    /\.hanmark-list li > \.hanmark-body:first-of-type \{ display: inline;/
  );
  assert.match(
    html,
    /\.hanmark-list li > \.hanmark-body:not\(:first-of-type\) \{/
  );
  assert.doesNotMatch(
    html,
    /\.hanmark-list li > \.hanmark-body \{ display: inline;/
  );
  assert.match(
    html,
    /<li><span class="hanmark-task"[^>]*>.*?<\/span> <p class="hanmark-line hanmark-body">First paragraph<\/p>\s*<p class="hanmark-line hanmark-body">Second paragraph<\/p><\/li>/s
  );
});
