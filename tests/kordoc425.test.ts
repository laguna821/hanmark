import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { parseHwpx } from "kordoc";

const SECTION_NS =
  `xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" ` +
  `xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"`;

function flowTable(id: number, text: string, inline = true): string {
  return `<hp:tbl id="${id}" rowCnt="1" colCnt="1">` +
    `<hp:pos treatAsChar="${inline ? "1" : "0"}" vertRelTo="PARA" horzRelTo="COLUMN"/>` +
    `<hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p></hp:subList>` +
    `<hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>` +
    `<hp:cellSz width="1000" height="300"/></hp:tc></hp:tr></hp:tbl>`;
}

async function parseMixedCell(content: string): Promise<any> {
  const cellParagraph =
    `<hp:p id="2" paraPrIDRef="0"><hp:run charPrIDRef="0">${content}</hp:run></hp:p>`;
  const outerTable =
    `<hp:tbl id="100" rowCnt="1" colCnt="1">` +
    `<hp:pos treatAsChar="1" vertRelTo="PARA" horzRelTo="PARA"/>` +
    `<hp:tr><hp:tc><hp:subList>${cellParagraph}</hp:subList>` +
    `<hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>` +
    `<hp:cellSz width="4000" height="400"/></hp:tc></hp:tr></hp:tbl>`;
  const section =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<hs:sec ${SECTION_NS}><hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0">` +
    `${outerTable}</hp:run></hp:p></hs:sec>`;

  const archive = new JSZip();
  archive.file("mimetype", "application/hwp+zip");
  archive.file("Contents/section0.xml", section);
  const parsed = await parseHwpx(await archive.generateAsync({ type: "arraybuffer" }));
  assert.equal(parsed.success, true);
  if (!parsed.success) assert.fail(parsed.error);

  const outer = parsed.blocks.find((block) => block.type === "table");
  assert.ok(outer?.table);
  return outer.table.cells[0][0];
}

function blockShape(block: any): string {
  if (block.type === "table") return `table(${block.table.cells[0][0].text})`;
  return `${block.type}(${block.text})`;
}

describe("Kordoc 4.2.5 inline-table parsing regression", () => {
  it("keeps inline date tables and their labels on one flattened line", async () => {
    const cell = await parseMixedCell(
      flowTable(200, "0000-00-00") + `<hp:t> 부터 </hp:t>` +
      flowTable(201, "0000-00-00") + `<hp:t> 까지</hp:t>`
    );

    assert.equal(cell.text, "0000-00-00 부터 0000-00-00 까지");
    assert.deepEqual(cell.blocks.map(blockShape), [
      "table(0000-00-00)",
      "paragraph(부터)",
      "table(0000-00-00)",
      "paragraph(까지)"
    ]);
  });

  it("does not insert newlines around same-line contact tables", async () => {
    const cell = await parseMixedCell(
      flowTable(210, "홍길동") + `<hp:t> ~ </hp:t>` +
      flowTable(211, "김철수") + `<hp:t> 연락처 :</hp:t>`
    );

    assert.equal(cell.text, "홍길동 ~ 김철수 연락처 :");
    assert.equal(cell.text.includes("\n"), false);
  });

  it("retains a newline before a block table", async () => {
    const cell = await parseMixedCell(
      `<hp:t>앞 문장</hp:t>` + flowTable(220, "일반현황", false)
    );

    assert.equal(cell.text, "앞 문장\n일반현황");
  });
});
