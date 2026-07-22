import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { parse, patchHwpx, validateHwpx, type GongmunPreset } from "kordoc";
import { generateValidatedHwpx, renderQuickHwpxPreview } from "../src/io/kordocEngine";

const SAMPLE = `# HanMark 검증 문서

일반 본문과 **굵은 글씨**입니다.

- 첫째 항목
  - 둘째 항목

| 이름 | 역할 |
| --- | --- |
| 한마크 | HWPX |

$$a^2 + b^2 = c^2$$
`;

describe("Kordoc 4.2.5 generation", () => {
  it("generates, validates, reparses, and renders a no-install HWPX", async () => {
    const generated = await generateValidatedHwpx(SAMPLE);
    assert.equal(generated.validation.ok, true);
    assert.ok(generated.validation.entryCount >= 5);

    // HWPX is an OPC package, but its first entry has an extra compatibility
    // rule: `mimetype` must be first and stored without compression.
    const bytes = new Uint8Array(generated.data);
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(header.getUint32(0, true), 0x04034b50);
    assert.equal(header.getUint16(8, true), 0);
    const fileNameLength = header.getUint16(26, true);
    const firstEntryName = new TextDecoder().decode(bytes.slice(30, 30 + fileNameLength));
    assert.equal(firstEntryName, "mimetype");

    const parsed = await parse(generated.data);
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.match(parsed.markdown, /HanMark 검증 문서/);
      assert.match(parsed.markdown, /한마크/);
    }

    const preview = await renderQuickHwpxPreview(SAMPLE);
    assert.ok(preview.render.svg.startsWith("<svg"));
    assert.ok(preview.render.pageCount >= 1);
  });

  for (const preset of ["official", "report", "plan", "notice", "minutes", "gaejosik", "press"] as GongmunPreset[]) {
    it(`generates a structurally valid ${preset} public-document preset`, async () => {
      const generated = await generateValidatedHwpx(`# ${preset}\n\n- 추진 배경\n- 추진 계획\n`, {
        gongmun: { preset }
      });
      assert.equal(generated.validation.ok, true);
      assert.ok(generated.data.byteLength > 1_000);
      const parsed = await parse(generated.data);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.match(parsed.markdown, new RegExp(preset));
        assert.match(parsed.markdown, /추진 배경/);
        assert.match(parsed.markdown, /추진 계획/);
      }
    });
  }

  it("keeps native chart parts in the validated full package", async () => {
    const generated = await generateValidatedHwpx(`# 차트\n\n\`\`\`chart\ntype: bar\ncat: 1분기, 2분기\n매출: 10, 20\n\`\`\`\n`);
    const validation = await validateHwpx(generated.data);
    assert.equal(validation.ok, true);
    assert.ok(generated.data.byteLength > 2_000);
    const archive = await JSZip.loadAsync(generated.data);
    assert.ok(Object.keys(archive.files).some((path) => /chart/i.test(path)));
  });

  it("patches a generated HWPX without mutating the input buffer", async () => {
    const generated = await generateValidatedHwpx("# 원본\n\n바꾸기 전 문장\n");
    const before = Buffer.from(generated.data).toString("base64");
    const patched: any = await patchHwpx(new Uint8Array(generated.data), "# 원본\n\n바꾼 문장\n", { verify: true });
    assert.notEqual(patched?.success, false);
    assert.ok(patched?.data);
    assert.equal(Buffer.from(generated.data).toString("base64"), before);
    const validation = await validateHwpx(patched.data);
    assert.equal(validation.ok, true);
  });
});
