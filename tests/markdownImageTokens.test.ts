import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  markdownImageTokens,
  transformMarkdownImageTokens
} from "../src/io/markdownImageTokens";

describe("Markdown image token scanner", () => {
  it("keeps percent-encoded Korean paths with balanced parentheses intact", () => {
    const source =
      "01.%20핵심연구(기본연구A)%20신규과제%20연구계획서(대표업적%20포함)-image_001.bmp";
    const markdown = `![](${source})`;
    assert.deepEqual(markdownImageTokens(markdown).map((token) => token.source), [source]);
  });

  it("supports angle destinations, escaped parentheses, and optional titles", () => {
    const markdown = [
      "![공백](<attachments/my photo.png>)",
      "![괄호](attachments/a\\(b\\).png \"설명\")"
    ].join(" ");
    assert.deepEqual(
      markdownImageTokens(markdown).map(({ alt, source }) => ({ alt, source })),
      [
        { alt: "공백", source: "attachments/my photo.png" },
        { alt: "괄호", source: "attachments/a(b).png" }
      ]
    );
  });

  it("rewrites only complete image spans", () => {
    const markdown = "앞 ![그림](folder/a(b).bmp) 뒤 [링크](page)";
    assert.equal(
      transformMarkdownImageTokens(markdown, (token) => `![[${token.source}]]`),
      "앞 ![[folder/a(b).bmp]] 뒤 [링크](page)"
    );
  });
});
