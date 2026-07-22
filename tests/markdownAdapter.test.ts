import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adaptMarkdownForKordoc } from "../src/io/markdownAdapter";

describe("adaptMarkdownForKordoc", () => {
  it("normalizes Obsidian links, embeds, tasks, callouts, and soft wraps", () => {
    const result = adaptMarkdownForKordoc(`첫 문장이 길어서
다음 줄에 이어집니다.

[[문서/대상 노트|표시 이름]]과 [[다른 노트#소제목]]

> [!warning] 꼭 확인
> 세부 내용

- [ ] 준비
- [x] 완료

![[하위 노트]]
`);

    assert.match(result.markdown, /첫 문장이 길어서 다음 줄에 이어집니다\./);
    assert.match(result.markdown, /표시 이름과 다른 노트 — 소제목/);
    assert.match(result.markdown, /> \*\*꼭 확인\*\*/);
    assert.match(result.markdown, /- ☐ 준비/);
    assert.match(result.markdown, /- ☑ 완료/);
    assert.match(result.markdown, /\[임베드: 하위 노트\]/);
    assert.ok(result.warnings.some((warning) => warning.code === "callout-flattened"));
    assert.ok(result.warnings.some((warning) => warning.code === "note-embed-flattened"));
  });

  it("preserves fenced code and structural table/list line boundaries", () => {
    const source = `# 제목

| 이름 | 값 |
| --- | --- |
| 가 | 나 |

- 첫째
  - 둘째

\`\`\`md
[[코드 안 링크]]
- [ ] 코드 안 작업
\`\`\`
`;
    const result = adaptMarkdownForKordoc(source);
    assert.match(result.markdown, /\| 이름 \| 값 \|\n\| --- \| --- \|\n\| 가 \| 나 \|/);
    assert.match(result.markdown, /- 첫째\n  - 둘째/);
    assert.match(result.markdown, /\[\[코드 안 링크\]\]/);
    assert.match(result.markdown, /- \[ \] 코드 안 작업/);
  });

  it("preserves display math and native Kordoc chart fences", () => {
    const source = `$$
a^2 + b^2 = c^2
$$

\`\`\`chart
type: bar
cat: 1분기, 2분기
매출: 10, 20
\`\`\`
`;
    const result = adaptMarkdownForKordoc(source);
    assert.match(result.markdown, /\$\$\na\^2 \+ b\^2 = c\^2\n\$\$/);
    assert.match(result.markdown, /```chart\ntype: bar\ncat: 1분기, 2분기\n매출: 10, 20\n```/);
  });

  it("counts Markdown, HTML, and Obsidian image sources without a false placeholder warning", () => {
    const result = adaptMarkdownForKordoc(
      `![[photo.png|사진]]\n\n![[attachments/my photo.png|공백 경로]]\n\n![도표](assets/chart.jpg)\n\n<img src="https://example.com/chart.png" alt="원격 도표">`
    );
    assert.equal(result.imageCount, 4);
    assert.ok(!result.warnings.some((warning) => warning.code === "image-missing"));
    assert.match(result.markdown, /!\[사진\]\(photo\.png\)/);
    assert.match(result.markdown, /!\[공백 경로\]\(<attachments\/my photo\.png>\)/);
  });
});
