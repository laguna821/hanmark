import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rewriteImportedImageReference } from "../src/io/imageLinks";

describe("rewriteImportedImageReference", () => {
  it("rewrites Markdown and HTML references to an Obsidian attachment embed", () => {
    const source = `![그림](image_001.png)\n\n<img src="image_001.png" alt="그림">`;
    const result = rewriteImportedImageReference(source, "image_001.png", "![[attachments/note-image_001.png]]");
    assert.equal(result.replacements, 2);
    assert.equal((result.markdown.match(/!\[\[attachments\/note-image_001\.png\]\]/g) || []).length, 2);
  });

  it("supports encoded filenames", () => {
    const result = rewriteImportedImageReference(
      "![그림](my%20image.png)",
      "my image.png",
      "![[my note-my image.png]]"
    );
    assert.equal(result.replacements, 1);
  });

  it("rewrites mixed Korean, percent-encoded spaces, and balanced parentheses", () => {
    const source =
      "01.%20핵심연구(기본연구A)%20연구계획서(대표업적%20포함)-image_001.bmp";
    const result = rewriteImportedImageReference(
      `앞\n![](${source})\n뒤`,
      "01. 핵심연구(기본연구A) 연구계획서(대표업적 포함)-image_001.bmp",
      "![[90. Settings/92. Attachments/import-image_001.bmp]]"
    );
    assert.equal(result.replacements, 1);
    assert.match(
      result.markdown,
      /!\[\[90\. Settings\/92\. Attachments\/import-image_001\.bmp\]\]/u
    );
  });

  it("does not rewrite image examples inside fenced code", () => {
    const source = "```md\n![예시](image_001.png)\n```\n![실제](image_001.png)";
    const result = rewriteImportedImageReference(
      source,
      "image_001.png",
      "![[attachments/image_001.png]]"
    );
    assert.equal(result.replacements, 1);
    assert.match(result.markdown, /```md\n!\[예시\]\(image_001\.png\)\n```/u);
  });
});
