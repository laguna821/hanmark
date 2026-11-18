import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeOverlaps,
  CHECK_IGNORE_ALIAS,
  CHECK_IGNORE_KEY,
  DEFAULT_CHECK_FAMILIES,
  MAX_CHECK_CHARS,
  addIgnoreEntry,
  buildCheckBlocks,
  fixEdit,
  ignoreEntry,
  isMechanicalFix,
  mechanicalFixEdits,
  readIgnoreList,
  replacementOf,
  runGongmunCheck,
  runGongmunCheckAsync,
  summarizeCheck,
  type CheckFinding
} from "../src/io/gongmunCheck";
import { normalizeHanmarkSettings } from "../src/legacy-port/settings";

const ALL = { notation: true, munche: true, budget: true, logic: true, slop: true } as const;

const NOTE = [
  "---",
  "title: 2026.11.3 점검",
  "공문_종류: 보고서",
  "---",
  "# 계획",
  "",
  "- 👨‍👩‍👧 가족 행사 일시: 2026. 11. 18.(목) 14:00",
  "- 금액: 금113,560원(금일십일만삼천오백원)",
  "- 200,000원 × 2회 = 500,000원",
  "",
  "```mermaid",
  "timeline",
  "    2026.11.3 : 날짜 표기 오류지만 코드",
  "```",
  "",
  "%% 2026.11.3 주석 %%",
  "<!-- 2026.11.3 주석 -->",
  "![[2026.11.3 다른 노트]]",
  "",
  "| 구분 | 금액 |",
  "|---|---|",
  "| 인건비 | 100 |",
  "| 운영비 | 200 |",
  "| 합계 | 350 |",
  "",
  "  - 들여쓴 항목의 기간 2026.11.3 표기"
].join("\n");

const lines = NOTE.split("\n");
const slice = (finding: CheckFinding): string => lines[finding.line].slice(finding.ch, finding.ch + finding.length);

describe("official-document check ranges (R-035)", () => {
  it("counts overlapping findings of one rule on a line once, keeping the longest range", () => {
    const base = { family: "budget" as const, severity: "warning" as const, message: "m", line: 3 };
    const whole = { ...base, rule: "R1", match: "200달러", ch: 13, length: 5 };
    const part = { ...base, rule: "R1", match: "달러", ch: 16, length: 2 };
    const otherRule = { ...base, rule: "R2", match: "달러", ch: 16, length: 2 };
    const otherLine = { ...part, line: 4 };
    const apart = { ...base, rule: "R1", match: "원", ch: 30, length: 1 };
    assert.deepEqual(mergeOverlaps([part, whole, otherRule, otherLine, apart]), [whole, part.rule === "R1" ? otherRule : part, otherLine, apart].sort((a, b) => b.length - a.length || a.line - b.line || a.ch - b.ch));
    assert.deepEqual(mergeOverlaps([part, whole]), [whole]);
    assert.deepEqual(mergeOverlaps([whole, { ...whole }]), [whole]);
  });

  it("skips front matter, code, comments and embeds, and cuts tables into cells", () => {
    const { blocks } = buildCheckBlocks(NOTE);
    const texts = blocks.map((block) => block.text);
    assert.ok(!texts.some((text) => /title:|timeline|주석|다른 노트|^\|/u.test(text)), texts.join(" / "));
    const total = blocks.find((block) => block.text === "350")!;
    assert.deepEqual(total.table, { id: "t1", row: 3, col: 1 });
    assert.equal(lines[total.line].slice(total.ch, total.ch + 3), "350");
    // The delimiter row is not a table row.
    assert.equal(blocks.find((block) => block.text === "인건비")!.table!.row, 1);
  });

  it("points every finding at the text the user typed, in UTF-16 columns", () => {
    const result = runGongmunCheck(NOTE, { families: ALL, preset: "report" });
    assert.equal(result.tooLarge, false);
    assert.ok(result.findings.length >= 4);
    for (const finding of result.findings) assert.equal(slice(finding), finding.match, `${finding.rule} at ${finding.line}:${finding.ch}`);
    const weekday = result.findings.find((finding) => finding.rule === "WEEKDAY_MISMATCH")!;
    // The line starts with a family emoji (surrogate pairs joined by ZWJ) before the date.
    assert.equal(weekday.line, 6);
    assert.equal(slice(weekday), "2026. 11. 18.(목)");
    assert.equal(weekday.replacement, "2026. 11. 18.(수)");
    const total = result.findings.find((finding) => finding.rule === "BUDGET_TOTAL_MISMATCH")!;
    assert.equal(total.line, 23);
    assert.equal(slice(total), "350");
    assert.equal(total.replacement, "300");
    const indented = result.findings.find((finding) => finding.line === 25 && finding.rule === "DATE_NO_SPACE")!;
    assert.equal(slice(indented), "2026.11.3");
    assert.equal(indented.replacement, undefined);
    assert.match(indented.advice ?? "", /^예\)/u);
    // Nothing from the code block, the comments, the embed or the front matter.
    assert.ok(result.findings.every((finding) => finding.line >= 4 && ![11, 12, 15, 16, 17].includes(finding.line)));
  });

  it("keeps combining characters and astral characters in step", () => {
    const note = "가\u0301나 𠮷野家 방문 일시: 2026. 11. 18.(목)";
    const [finding] = runGongmunCheck(note, { families: ALL }).findings.filter((item) => item.rule === "WEEKDAY_MISMATCH");
    assert.equal(note.slice(finding.ch, finding.ch + finding.length), "2026. 11. 18.(목)");
  });

  it("runs only the enabled families, and bullet-style rules only for bullet-style forms", () => {
    assert.deepEqual({ ...DEFAULT_CHECK_FAMILIES }, { notation: true, munche: true, budget: true, logic: false, slop: false });
    const text = "이는 획기적인 계획입니다. 결론적으로 중요합니다.\n- 200,000원 × 2회 = 500,000원";
    const families = (result: { findings: CheckFinding[] }): string[] => [...new Set(result.findings.map((finding) => finding.family))].sort();
    assert.deepEqual(families(runGongmunCheck(text, { preset: "press" })), ["budget"]);
    assert.ok(families(runGongmunCheck(text, { families: ALL, preset: "press" })).includes("slop"));
    assert.ok(!families(runGongmunCheck(text, { families: ALL, preset: "press" })).includes("munche"));
    assert.ok(families(runGongmunCheck(text, { families: ALL, preset: "gaejosik" })).includes("munche"));
    assert.deepEqual(families(runGongmunCheck(text, { families: { ...ALL, budget: false, slop: false, munche: false }, preset: "gaejosik" })), []);
  });
});

describe("fixing and ignoring findings (R-035)", () => {
  it("reads a replacement only from the engine's \"matched → replacement\" form", () => {
    assert.equal(replacementOf("350", "350 → 300"), "300");
    assert.equal(replacementOf("2026.11.3", "예) 2025. 1. 6."), undefined);
    assert.equal(replacementOf("가", "가 → 가"), undefined);
    assert.equal(replacementOf("가", undefined), undefined);
  });

  it("fixes exactly the checked range and refuses when the text changed", () => {
    const result = runGongmunCheck(NOTE, { families: ALL, preset: "report" });
    const weekday = result.findings.find((finding) => finding.rule === "WEEKDAY_MISMATCH")!;
    const edit = fixEdit(lines[weekday.line], weekday)!;
    const fixed = lines[weekday.line].slice(0, edit.ch) + edit.text + lines[weekday.line].slice(edit.ch + edit.length);
    assert.equal(fixed, "- 👨‍👩‍👧 가족 행사 일시: 2026. 11. 18.(수) 14:00");
    assert.equal(fixEdit(`x${lines[weekday.line]}`, weekday), null, "shifted text is refused");
    assert.equal(fixEdit(undefined, weekday), null);
    const advice = result.findings.find((finding) => finding.replacement === undefined)!;
    assert.equal(fixEdit(lines[advice.line], advice), null);
  });

  it("calls a fix mechanical only when letters and digits stay as they are", () => {
    assert.equal(isMechanicalFix({ match: "2. 20.~2. 24. 까지", replacement: "2. 20.∼2. 24. 까지" }), true);
    assert.equal(isMechanicalFix({ match: "붙임 계획서", replacement: "붙임  계획서" }), true);
    assert.equal(isMechanicalFix({ match: "2026. 11. 18.(목)", replacement: "2026. 11. 18.(수)" }), false);
    assert.equal(isMechanicalFix({ match: "350", replacement: "300" }), false);
    assert.equal(isMechanicalFix({ match: "350" }), false);
    const make = (line: number, ch: number, match: string, replacement: string): CheckFinding => ({
      family: "notation", rule: "T", severity: "warning", message: "", match, line, ch, length: match.length, replacement
    });
    const text = ["붙임 계획서 1부. 붙임 요약서", "350"];
    const edits = mechanicalFixEdits(text, [make(0, 0, "붙임 계획서", "붙임  계획서"), make(0, 11, "붙임 요약서", "붙임  요약서"), make(1, 0, "350", "300"), make(0, 3, "계획서 1부", "계획서  1부")]);
    // Last first, the sum left out, and the overlapping range skipped.
    assert.deepEqual(edits.map((edit) => [edit.line, edit.ch, edit.text]), [[0, 11, "붙임  요약서"], [0, 3, "계획서  1부"]]);
  });

  it("hides ignored findings by rule or by exact text and keeps the list in a note property", () => {
    const base = runGongmunCheck(NOTE, { families: ALL, preset: "report" });
    const weekday = base.findings.find((finding) => finding.rule === "WEEKDAY_MISMATCH")!;
    const one = runGongmunCheck(NOTE, { families: ALL, preset: "report", ignored: [ignoreEntry(weekday)] });
    assert.equal(one.findings.length, base.findings.length - 1);
    assert.equal(one.ignored, 1);
    const dates = base.findings.filter((finding) => finding.rule === "DATE_NO_SPACE").length;
    const rule = runGongmunCheck(NOTE, { families: ALL, preset: "report", ignored: ["DATE_NO_SPACE"] });
    assert.equal(rule.ignored, dates);
    const frontmatter: Record<string, unknown> = {};
    addIgnoreEntry(frontmatter, "DATE_NO_SPACE");
    addIgnoreEntry(frontmatter, ignoreEntry(weekday));
    addIgnoreEntry(frontmatter, "DATE_NO_SPACE");
    assert.deepEqual(frontmatter[CHECK_IGNORE_KEY], ["DATE_NO_SPACE", "WEEKDAY_MISMATCH|2026. 11. 18.(목)"]);
    assert.deepEqual(readIgnoreList(frontmatter), ["DATE_NO_SPACE", "WEEKDAY_MISMATCH|2026. 11. 18.(목)"]);
    const english: Record<string, unknown> = { [CHECK_IGNORE_ALIAS]: "A" };
    addIgnoreEntry(english, "B");
    assert.deepEqual(english[CHECK_IGNORE_ALIAS], ["A", "B"]);
    assert.deepEqual(readIgnoreList(null), []);
  });

  it("summarises by family", () => {
    const summary = summarizeCheck(runGongmunCheck(NOTE, { families: ALL, preset: "report" }).findings);
    assert.equal(summary.total, summary.byFamily.notation + summary.byFamily.munche + summary.byFamily.budget + summary.byFamily.logic + summary.byFamily.slop);
    assert.ok(summary.byFamily.budget >= 2 && summary.errors >= 3);
  });
});

describe("check limits (R-035)", () => {
  it("finishes adversarial input inside the time budget", () => {
    // Kordoc 4.24.1 (sparse table coordinates) and 4.20.0 (quadratic rules) regressions.
    const long = `${"금".repeat(19_000)}원 2026.11.3~11.5 까지`;
    const sparse = ["| 구분 | 금액 |", "|---|---|", ...Array.from({ length: 300 }, (_unused, at) => `| 항목${at} | ${at} |`), "| 합계 | 5 |"];
    const note = [long, long, ...sparse, `- ${"1,000원 × 2회 = 3,000원 ".repeat(400)}`].join("\n");
    const started = Date.now();
    const result = runGongmunCheck(note, { families: ALL, preset: "gaejosik" });
    assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
    assert.equal(result.tooLarge, false);
    // A 200,000-character line is skipped, not checked, and the run says so.
    const huge = runGongmunCheck(`${"가".repeat(200_000)}\n2026.11.3`, { families: ALL });
    assert.equal(huge.partial, true);
    assert.equal(huge.findings.length, 1);
    assert.equal(runGongmunCheck("가".repeat(MAX_CHECK_CHARS + 1)).tooLarge, true);
  });

  it("stops at its budget and reports a partial run", () => {
    const note = Array.from({ length: 2000 }, (_unused, at) => `- 항목 ${at} 2026.11.3`).join("\n");
    let clock = 0;
    const result = runGongmunCheck(note, { budgetMs: 10, now: () => (clock += 8) });
    assert.equal(result.partial, true);
    assert.ok(result.checkedLines > 0 && result.checkedLines < 2000);
  });

  it("drops a typing-time run when the note changes again", async () => {
    const note = Array.from({ length: 1500 }, (_unused, at) => `- 항목 ${at} 2026.11.3`).join("\n");
    let slices = 0;
    const cancelled = await runGongmunCheckAsync(note, { cancelled: () => (slices += 1) > 1, pause: () => Promise.resolve() });
    assert.equal(cancelled, null);
    const done = await runGongmunCheckAsync(note, { pause: () => Promise.resolve() });
    assert.equal(done!.findings.length, 1500);
  });
});

describe("check settings (R-035)", () => {
  it("defaults logic and AI-style checks and the pre-flight to off and keeps stored choices", () => {
    const fresh = normalizeHanmarkSettings({});
    assert.deepEqual(fresh.gongmunCheckFamilies, { notation: true, munche: true, budget: true, logic: false, slop: false });
    assert.equal(fresh.gongmunPreflight, false);
    const stored = normalizeHanmarkSettings({ gongmunCheckFamilies: { slop: true, notation: false, other: 1 }, gongmunPreflight: true });
    assert.deepEqual(stored.gongmunCheckFamilies, { notation: false, munche: true, budget: true, logic: false, slop: true });
    assert.equal(stored.gongmunPreflight, true);
  });
});
