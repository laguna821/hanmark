import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  extractEditableBodyStrict,
  stripFrontmatterStrict
} from "../src/io/frontmatter";
import { adaptMarkdownForKordoc } from "../src/io/markdownAdapter";

function prepareForDocx(markdown: string): string {
  return adaptMarkdownForKordoc(extractEditableBodyStrict(markdown)).markdown;
}

describe("DOCX Markdown preparation", () => {
  it("removes BOM/CRLF frontmatter and the generated source callout before line normalization", () => {
    const source = [
      "\uFEFF---",
      'title: "문서: 부제"',
      "aliases:",
      "  - 첫 번째 별칭",
      "nested:",
      "  owner: ach",
      "---",
      "> [!hwp-source] 원본 문서",
      "> 경로와 해시 정보",
      "",
      "첫 문장은",
      "다음 줄과 이어집니다."
    ].join("\r\n");

    const prepared = prepareForDocx(source);
    assert.equal(prepared, "첫 문장은 다음 줄과 이어집니다.\n");
    assert.doesNotMatch(prepared, /title:|aliases:|hwp-source/u);
  });

  it("accepts the YAML document-end delimiter", () => {
    const source = "---\ntitle: 테스트\n...\n# 본문\n";
    assert.equal(prepareForDocx(source), "# 본문\n");
  });

  it("preserves YAML examples and delimiter lines inside fenced code", () => {
    const source = [
      "```yaml",
      "---",
      "title: '예제: 보존'",
      "---",
      "```",
      "",
      "본문"
    ].join("\n");

    const prepared = prepareForDocx(source);
    assert.match(
      prepared,
      /```yaml\n---\ntitle: '예제: 보존'\n---\n```/u
    );
  });

  it("preserves a literal hwp-source callout inside fenced code", () => {
    const source = [
      "```md",
      "> [!hwp-source] 사용 예",
      "> 이 줄은 코드입니다.",
      "```"
    ].join("\n");

    assert.equal(prepareForDocx(source), `${source}\n`);
  });

  it("reports an actionable Korean error for unclosed leading frontmatter", () => {
    assert.throws(
      () => stripFrontmatterStrict("---\ntitle: 닫히지 않음\n# 본문"),
      /YAML 속성 영역이 닫히지 않았습니다.*---/u
    );
  });

  it("is used by the shared DOCX byte builder for export and exact preview", async () => {
    const source = await readFile("src/io/docxExport.ts", "utf8");
    assert.match(
      source,
      /buildDocxBytesUserInitiated[\s\S]*?extractEditableBodyStrict\(source\.markdown\)/u
    );
    assert.match(
      source,
      /exportUserInitiated[\s\S]*?this\.buildDocxBytesUserInitiated\(source, action\)/u
    );
    assert.match(
      source,
      /buildExactPdfPreviewUserInitiated[\s\S]*?this\.buildDocxBytesUserInitiated\(source, action\)/u
    );
  });
});
