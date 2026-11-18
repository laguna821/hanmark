import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { markdownToHwpx, parse, validateHwpx } from "kordoc";
import { HWP_CONVERT_ENGINE, HwpConvertError, convertHwpToHwpx, formTemplateHwpx, isHwpxBytes } from "../src/io/hwpConvert";
import { FORM_FORMAT_KEY, fillFormHwpx, formNoteProperties, readFormFields } from "../src/io/formFill";
import {
  attachMemos,
  commentsAsMemosSetting,
  extractMemoMarks,
  inlineImportedMemos,
  placeMemos
} from "../src/io/hwpxMemos";
import { generateValidatedHwpx } from "../src/io/kordocEngine";
import { kordocParseOptions } from "../src/io/importOptions";
import { normalizeHanmarkSettings } from "../src/legacy-port/settings";
import { loadHardenedKordocBundle, type HardenedBundle } from "./helpers/hardenedKordocBundle";

const HWP5 = "tests/fixtures/hwp5/textbox-nested.hwp";
const HWP3_LOCKED = "tests/fixtures/password/HWP3-password-123456.hwp";
const NOW = new Date(2026, 10, 18);

const buffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const squeeze = (text: string): string => text.replace(/\s+/gu, "");
/** Letters and digits only, pictures aside (a BMP comes back as PNG): the same words in the same order. */
const letters = (text: string): string => text.replace(/!\[[^\]]*\]\([^)]*\)/gu, "").replace(/[^\p{L}\p{N}]/gu, "");
const same = (a: ArrayBuffer | Uint8Array, b: ArrayBuffer | Uint8Array): boolean =>
  Buffer.compare(Buffer.from(a as ArrayBuffer), Buffer.from(b as ArrayBuffer)) === 0;

async function read(data: ArrayBuffer | Uint8Array, extra: Record<string, unknown> = {}) {
  const input = data instanceof Uint8Array ? buffer(data) : data.slice(0);
  const parsed = await parse(input, kordocParseOptions({ images: false, ...extra }));
  assert.equal(parsed.success, true);
  if (!parsed.success) throw new Error("unreachable");
  return parsed;
}

describe("HWP to HWPX conversion (R-034)", () => {
  it("uses Kordoc's lean converter and never the wrapper that offers a Hancom Office engine", async () => {
    assert.equal(HWP_CONVERT_ENGINE, "kordoc");
    const source = await readFile("src/io/hwpConvert.ts", "utf8");
    assert.match(source, /import \{ hwpToHwpx, parse, validateHwpx \} from "kordoc";/u);
    for (const file of ["src/io/hwpConvert.ts", "src/ui/hwpConvertFlow.ts", "src/io/formFill.ts", "src/io/hwpxMemos.ts"]) {
      assert.doesNotMatch(await readFile(file, "utf8"), /\bconvertToHwpx\s*\(|engine:\s*"(?:hancom|auto)"/u, file);
    }
  });

  it("converts an HWP 5.x document with its formatting, valid and identical on every run", async () => {
    const source = new Uint8Array(await readFile(HWP5));
    assert.equal(isHwpxBytes(source), false);
    const first = await convertHwpToHwpx(source);
    assert.equal(first.mode, "preserve");
    assert.deepEqual(first.notes, []);
    assert.equal(isHwpxBytes(new Uint8Array(first.data)), true);
    assert.equal((await validateHwpx(first.data.slice(0))).ok, true);
    // Kordoc's raw output differs between runs (ZIP dates); HanMark's package does not.
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const second = await convertHwpToHwpx(source);
    assert.ok(same(first.data, second.data), "same bytes twice");
    const before = await read(source);
    const afterward = await read(first.data);
    assert.equal(squeeze(afterward.markdown), squeeze(before.markdown));
    const grid = (blocks: typeof before.blocks): string[] =>
      blocks.filter((block) => block.type === "table").map((block) => `${block.table?.rows}x${block.table?.cols}`);
    assert.deepEqual(grid(afterward.blocks), grid(before.blocks));
  });

  it("asks for the password of a locked document and converts HWP 3.x as text and tables", async () => {
    const source = new Uint8Array(await readFile(HWP3_LOCKED));
    await assert.rejects(
      () => convertHwpToHwpx(source),
      (error: unknown) => error instanceof HwpConvertError && error.passwordHelps === true
    );
    await assert.rejects(
      () => convertHwpToHwpx(source, "wrong-password"),
      (error: unknown) => error instanceof HwpConvertError
    );
    const converted = await convertHwpToHwpx(source, "123456");
    assert.equal(converted.mode, "content");
    assert.equal(converted.notes.length, 1, "says that formatting was not carried over");
    assert.equal((await validateHwpx(converted.data.slice(0))).ok, true);
    // Read both with the document's own structure kept, so only the conversion can differ.
    const before = await read(source, { password: "123456", layoutTables: "keep" });
    const afterward = await read(converted.data, { layoutTables: "keep" });
    assert.equal(letters(afterward.markdown), letters(before.markdown));
  });

  it("refuses what is not a Hangul document without asking for a password", async () => {
    await assert.rejects(
      () => convertHwpToHwpx(new TextEncoder().encode("not a document at all, just text ".repeat(20))),
      (error: unknown) => error instanceof HwpConvertError && error.passwordHelps === false && error.message.length > 0
    );
  });
});

describe("HWP 5.x forms (R-034)", () => {
  it("reads and fills an HWP 5.x form through its HWPX conversion; the result is HWPX", async () => {
    const source = new Uint8Array(await readFile(HWP5));
    const template = await formTemplateHwpx(source);
    assert.equal(template.source, "hwp");
    const fields = await readFormFields(source);
    const names = fields.map((field) => field.name);
    assert.ok(names.includes("결재 비고 사항"), names.join(", "));
    const filled = await fillFormHwpx(source, { "협조 의견란": "이견 없음" });
    assert.equal(isHwpxBytes(new Uint8Array(filled.data)), true);
    assert.deepEqual(filled.unmatched, []);
    const text = (await read(filled.data)).markdown;
    assert.ok(text.includes("이견 없음"));
    // Neighbouring labels are still there (no label cell was overwritten).
    for (const label of ["결재 구분", "1차 검토", "2차 검토", "담당 부서", "협조 의견란", "결재 비고 사항", "검토자 서명"]) {
      assert.ok(text.includes(label), label);
    }
    const again = await fillFormHwpx(source, { "협조 의견란": "이견 없음" });
    assert.ok(same(filled.data, again.data), "same bytes twice");
  });

  it("records the source format only for HWP forms, so HWPX form notes stay as they were", () => {
    const fields = [{ name: "성명", type: "text" as const, source: "label" as const, value: "" }];
    const plainNote = formNoteProperties(fields, "[[form.hwpx]]", "sha256:x").properties;
    assert.equal(FORM_FORMAT_KEY in plainNote, false);
    assert.deepEqual(formNoteProperties(fields, "[[form.hwpx]]", "sha256:x", {}, "hwpx").properties, plainNote);
    assert.equal(formNoteProperties(fields, "[[form.hwp]]", "sha256:x", {}, "hwp").properties[FORM_FORMAT_KEY], "hwp");
  });

  it("an HWPX form passes through untouched; an HWP 3.x form is refused with a reason", async () => {
    const hwpx = new Uint8Array(await markdownToHwpx("# 신청서\n\n| 성명 |  |\n|---|---|\n| 연락처 |  |\n"));
    const template = await formTemplateHwpx(hwpx);
    assert.equal(template.source, "hwpx");
    assert.equal(template.hwpx, hwpx);
    await assert.rejects(() => formTemplateHwpx(new Uint8Array(0)));
  });

  it("fills beside labels without overwriting them and keeps the seal mark", async () => {
    const form = new Uint8Array(
      await markdownToHwpx(
        ["# 참가 신청서", "", "| 성명 |  | 연락처 |  |", "|---|---|---|---|", "| 소속 |  | 직위 |  |", "", "신청인:            (인)", ""].join("\n")
      )
    );
    const filled = await fillFormHwpx(form, { 성명: "홍길동", 연락처: "010-0000-0000", 소속: "미디어스쿨", 신청인: "홍길동" });
    const text = (await read(filled.data)).markdown;
    for (const label of ["성명", "연락처", "소속", "직위"]) assert.ok(text.includes(label), `${label} label kept`);
    assert.ok(text.includes("홍길동") && text.includes("미디어스쿨"));
    assert.ok(text.includes("(인)"), "the seal mark stays");
    assert.equal((await validateHwpx(filled.data.slice(0))).ok, true);
  });
});

describe("comments as Hangul memos (R-034)", () => {
  const NOTE = [
    "# 워크숍 준비",
    "",
    "일정은 ==1월 13일==%%날짜 최종 확인 필요%% 이며 장소는 ==가평==%%@안창현: 대관료 문의\n단체가 확인%% 이다.",
    "",
    "%%형광펜 없이 쓴 주석은 메모가 아니다%%",
    "",
    "| 구분 | 금액 |",
    "|---|---|",
    "| 숙박 | ==93만 원==%%추정값%% |",
    "",
    "`==코드==%%안%%` 는 그대로 둔다.",
    "",
    "```",
    "==펜스==%%안%%",
    "```",
    ""
  ].join("\n");

  it("is off unless the stored setting says otherwise", () => {
    assert.equal(commentsAsMemosSetting({}), false);
    assert.equal(commentsAsMemosSetting({ commentsAsMemos: "yes" }), false);
    assert.equal(commentsAsMemosSetting({ commentsAsMemos: true }), true);
    assert.equal(normalizeHanmarkSettings({}).commentsAsMemos, false);
    assert.equal(normalizeHanmarkSettings({ commentsAsMemos: true }).commentsAsMemos, true);
  });

  it("reads highlight + comment pairs, outside code, and leaves other comments alone", () => {
    const { markdown, memos } = extractMemoMarks(NOTE);
    assert.deepEqual(
      memos.map((memo) => [memo.anchor, memo.text, memo.author]),
      [
        ["1월 13일", "날짜 최종 확인 필요", undefined],
        ["가평", "대관료 문의\n단체가 확인", "안창현"],
        ["93만 원", "추정값", undefined]
      ]
    );
    assert.ok(markdown.includes("일정은 1월 13일 이며 장소는 가평 이다."));
    assert.ok(markdown.includes("| 숙박 | 93만 원 |"));
    assert.ok(markdown.includes("%%형광펜 없이 쓴 주석은 메모가 아니다%%"), "a plain comment is untouched here");
    assert.ok(markdown.includes("`==코드==%%안%%`"));
    assert.ok(markdown.includes("==펜스==%%안%%"));
    const none = "본문에 ==형광펜== 만 있고 %%주석%% 은 떨어져 있다.";
    assert.equal(extractMemoMarks(none).markdown, none);
    assert.deepEqual(extractMemoMarks(none).memos, []);
  });

  it("attaches the memos to the generated document, at the right repeat, and reads them back", async () => {
    const note = ["# 보고", "", "첫 문단의 검토 대상이다.", "", "둘째 문단의 ==검토 대상==%%둘째 것에 단다%% 이다.", ""].join("\n");
    const { markdown, memos } = extractMemoMarks(note);
    assert.equal(memos[0].ordinal, 0, "the note counts only marked anchors");
    const generated = await generateValidatedHwpx(markdown);
    const withMemos = await attachMemos(generated, memos, NOW);
    assert.notEqual(withMemos.data, generated.data);
    assert.equal((await validateHwpx(withMemos.data.slice(0))).ok, true);
    assert.ok(withMemos.warnings.some((warning) => warning.code === "memo-placed" && warning.count === 1));
    const back = await read(withMemos.data, { memos: true });
    assert.equal(back.memos?.length, 1);
    assert.equal(back.memos?.[0].anchor, "검토 대상");
    assert.equal(back.memos?.[0].text, "둘째 것에 단다");
    assert.ok(back.memos?.[0].paragraph.startsWith("둘째 문단"), back.memos?.[0].paragraph);
    // The body reads the same with or without the memo.
    assert.equal(squeeze((await read(withMemos.data)).markdown), squeeze((await read(generated.data)).markdown));
    const again = await attachMemos(await generateValidatedHwpx(markdown), memos, NOW);
    assert.ok(same(withMemos.data, again.data), "same bytes twice");
  });

  it("returns the very same document when there is nothing to attach, and reports text it cannot find", async () => {
    const generated = await generateValidatedHwpx("# 제목\n\n본문 문단.\n");
    assert.equal(await attachMemos(generated, [], NOW), generated);
    const missing = await placeMemos(generated.data, [{ anchor: "문서에 없는 글", text: "메모", context: "문서에없는글", ordinal: 0 }], NOW);
    assert.equal(missing.placed, 0);
    assert.equal(missing.unplaced.length, 1);
    assert.equal(missing.data, generated.data);
    const reported = await attachMemos(generated, [{ anchor: "문서에 없는 글", text: "메모", context: "문서에없는글", ordinal: 0 }], NOW);
    assert.equal(reported.data, generated.data);
    assert.ok(reported.warnings.some((warning) => warning.code === "memo-unplaced"));
  });

  it("round trip: memos imported from a document come back at the same text on export", async () => {
    const first = extractMemoMarks(NOTE);
    const exported = await attachMemos(await generateValidatedHwpx(first.markdown), first.memos, NOW);
    // Import with the memo option: the engine lists memos at the end; HanMark moves them to their text.
    const imported = await read(exported.data, { memos: true, tableFormat: "gfm" });
    assert.equal(imported.memos?.length, 3);
    const inlined = inlineImportedMemos(imported.markdown, imported.memos);
    assert.equal(inlined.inlined, 2, "body memos move into the text");
    assert.equal(inlined.kept, 1, "the memo in a table cell stays in the list");
    assert.ok(inlined.markdown.includes("==1월 13일==%%날짜 최종 확인 필요%%"));
    assert.ok(inlined.markdown.includes("==가평==%%@안창현: 대관료 문의\n단체가 확인%%"));
    assert.match(inlined.markdown, /\*\*메모\*\*\n\n1\. .*「93만 원」/u);
    // Export the imported note again: the two inline memos are back on the same text.
    const second = extractMemoMarks(inlined.markdown);
    assert.deepEqual(second.memos.map((memo) => memo.anchor), ["1월 13일", "가평"]);
    const reexported = await attachMemos(await generateValidatedHwpx(second.markdown), second.memos, NOW);
    const back = await read(reexported.data, { memos: true });
    assert.deepEqual(
      back.memos?.map((memo) => [memo.anchor, memo.text, memo.author]),
      [
        ["1월 13일", "날짜 최종 확인 필요", "HanMark"],
        ["가평", "대관료 문의\n단체가 확인", "안창현"]
      ]
    );
    // Without memos in the result the note is left exactly as the engine wrote it.
    assert.equal(inlineImportedMemos(imported.markdown, []).markdown, imported.markdown);
  });
});

interface Runtime {
  convert(bytes: Uint8Array, engine: string): Promise<{ mode: string; engine: string; byteLength: number }>;
  lean(bytes: Uint8Array): Promise<number>;
}

describe("HWP conversion inside the plugin bundle (R-034)", () => {
  let bundle: HardenedBundle<Runtime>;

  before(async () => {
    bundle = await loadHardenedKordocBundle<Runtime>(
      'import { convertToHwpx, hwpToHwpx } from "kordoc";\n' +
        "export async function lean(bytes) { return (await hwpToHwpx(new Uint8Array(bytes))).byteLength; }\n" +
        "export async function convert(bytes, engine) {\n" +
        "  const result = await convertToHwpx(new Uint8Array(bytes), { engine });\n" +
        "  return { mode: result.mode, engine: result.engine, byteLength: result.data.byteLength };\n" +
        "}\n"
    );
  });

  after(async () => {
    await bundle?.dispose();
  });

  it("converts with Kordoc's own engine and cannot reach Hancom Office by any option", async () => {
    const source = new Uint8Array(await readFile(HWP5));
    const converted = await bundle.runtime.convert(source, "kordoc");
    assert.deepEqual([converted.mode, converted.engine], ["preserve", "kordoc"]);
    assert.ok(converted.byteLength > 1000);
    assert.equal(await bundle.runtime.lean(source), converted.byteLength, "the converter HanMark calls gives the same document");
    for (const engine of ["hancom", "auto"]) {
      await assert.rejects(() => bundle.runtime.convert(source, engine), /does not bundle Hancom Office automation/u, engine);
    }
    assert.doesNotMatch(bundle.text, /hwpToHwpxViaHancom|HWPFrame|powershell|child_process/iu);
  });
});
