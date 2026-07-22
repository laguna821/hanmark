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
});

