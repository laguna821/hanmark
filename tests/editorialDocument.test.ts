import assert from "node:assert/strict";
import { test } from "node:test";
import {
  editorialPlainText,
  parseEditorialDocument
} from "../src/io/editorialDocument";

const ONE_PIXEL_GIF =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

test("Editorial document parsing is immutable and preserves semantic block types", () => {
  const markdown = [
    "# 문서",
    "",
    "문단 첫 줄",
    "문단 둘째 줄",
    "",
    "- [x] 완료 [[대상|표시]]",
    "  - 중첩",
    "",
    "1. 첫째",
    "2. 둘째",
    "",
    "| 이름 | 값 |",
    "| --- | --- |",
    "| A | **B** |",
    "",
    "> [!warning]- 주의",
    "> 설명",
    "",
    "```html",
    "<script>문자 그대로</script>",
    "```",
    "",
    `![그림](${ONE_PIXEL_GIF})`
  ].join("\n");
  const original = `${markdown}`;
  const document = parseEditorialDocument(markdown, "대체 제목");

  assert.equal(markdown, original);
  assert.equal(document.title, "문서");
  assert.equal(editorialPlainText(document.masthead), "문서");
  assert.equal(document.blocks[0]?.type, "paragraph");
  assert.equal(
    document.blocks[0]?.type === "paragraph"
      ? editorialPlainText(document.blocks[0].inlines)
      : "",
    "문단 첫 줄 문단 둘째 줄"
  );
  const taskList = document.blocks.find(
    (block) => block.type === "list" && !block.ordered
  );
  assert.equal(taskList?.type === "list" && taskList.items[0].checked, true);
  assert.ok(
    taskList?.type === "list" &&
      taskList.items[0].blocks.some((block) => block.type === "list")
  );
  assert.ok(document.blocks.some((block) => block.type === "table"));
  assert.ok(
    document.blocks.some(
      (block) =>
        block.type === "callout" &&
        block.kind === "warning" &&
        block.collapsed === true
    )
  );
  assert.ok(
    document.blocks.some(
      (block) =>
        block.type === "code" &&
        block.value === "<script>문자 그대로</script>"
    )
  );
  assert.ok(
    document.blocks.some(
      (block) =>
        block.type === "paragraph" &&
        block.inlines.some(
          (inline) =>
            inline.type === "image" &&
            inline.src === ONE_PIXEL_GIF
        )
    )
  );
});

test("Editorial parser turns softbreaks into spaces and keeps explicit hardbreaks", () => {
  const document = parseEditorialDocument(
    "첫째\n둘째  \n셋째\\\n넷째",
    "파일"
  );
  const paragraph = document.blocks[0];
  assert.equal(paragraph?.type, "paragraph");
  if (paragraph?.type !== "paragraph") return;

  assert.deepEqual(paragraph.inlines, [
    { type: "text", value: "첫째 둘째" },
    { type: "hardbreak" },
    { type: "text", value: "셋째" },
    { type: "hardbreak" },
    { type: "text", value: "넷째" }
  ]);
});

test("Editorial parser drops unsafe HTML subtrees and preserves safe visible children", () => {
  const document = parseEditorialDocument(
    [
      "<p><strong>안전</strong><iframe>숨김</iframe></p>",
      "<unknown><u>보존</u></unknown>"
    ].join("\n"),
    "파일"
  );
  const visible = document.blocks
    .map((block) =>
      block.type === "paragraph" ? editorialPlainText(block.inlines) : ""
    )
    .join(" ");

  assert.match(visible, /안전/);
  assert.match(visible, /보존/);
  assert.doesNotMatch(visible, /숨김/);
});
