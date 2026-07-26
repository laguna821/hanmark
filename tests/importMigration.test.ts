import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import type { App, TFile } from "obsidian";
import {
  createCleanLegacyImportCopy,
  hasHanmarkSourceMetadata,
  stripHanmarkSourceMetadata
} from "../src/io/legacyImportMigration";

const GENERATED_CALLOUT = [
  "> [!hwp-source] 원본: C:/documents/paper.hwpx",
  "> 한글 문서에서 불러온 노트입니다. **저장** 시 원본 서식 그대로 패치되거나(분기 A), 새 한글 파일이 생성됩니다(분기 B/C).",
  ""
].join("\n");

describe("legacy imported-note migration", () => {
  it("removes only HanMark source keys and its generated callout", () => {
    const source = [
      "---",
      "title: 사용자 제목",
      "tags:",
      "  - 연구",
      "hwp-source: C:/documents/paper.hwpx",
      "hwp-source-cache: sha256-abc.bin",
      "hwp-source-format: hwpx",
      "hwp-source-hash: sha256:abc",
      "hwp-source-bytes: 42",
      "hwp-imported-at: 2026-07-01T00:00:00.000Z",
      "hwp-kordoc: 4.2.5",
      "custom: 그대로",
      "---",
      GENERATED_CALLOUT,
      "> [!note] 사용자 콜아웃",
      "> 이 내용은 보존합니다.",
      "",
      "# 본문"
    ].join("\n");

    const result = stripHanmarkSourceMetadata(source);
    assert.equal(result.changed, true);
    assert.equal(hasHanmarkSourceMetadata(source), true);
    assert.deepEqual(
      new Set(result.removedFrontmatterKeys),
      new Set([
        "hwp-source",
        "hwp-source-cache",
        "hwp-source-format",
        "hwp-source-hash",
        "hwp-source-bytes",
        "hwp-imported-at",
        "hwp-kordoc"
      ])
    );
    assert.equal(result.removedSourceCallout, true);
    assert.match(result.markdown, /title: 사용자 제목/u);
    assert.match(result.markdown, /tags:\n  - 연구/u);
    assert.match(result.markdown, /custom: 그대로/u);
    assert.match(result.markdown, /> \[!note\] 사용자 콜아웃/u);
    assert.match(result.markdown, /# 본문/u);
    assert.doesNotMatch(result.markdown, /^hwp-(?:source|imported|kordoc)/mu);
    assert.doesNotMatch(result.markdown, /\[!hwp-source\] 원본:/u);
  });

  it("removes an otherwise empty generated frontmatter block", () => {
    const source = [
      "---",
      "hwp-source: paper.hwpx",
      "hwp-source-format: hwpx",
      "---",
      "# 본문"
    ].join("\r\n");

    const result = stripHanmarkSourceMetadata(source);
    assert.equal(result.markdown, "# 본문");
  });

  it("preserves user-authored hwp-source callouts and fenced examples", () => {
    const source = [
      "> [!hwp-source] 사용 예",
      "> 사용자가 직접 작성했습니다.",
      "",
      "````md",
      "```",
      GENERATED_CALLOUT,
      "```",
      "````"
    ].join("\n");

    const result = stripHanmarkSourceMetadata(source);
    assert.equal(result.changed, false);
    assert.equal(hasHanmarkSourceMetadata(source), false);
    assert.equal(result.markdown, source);
  });

  it("fails closed for malformed frontmatter", () => {
    const source = [
      "---",
      "hwp-source: paper.hwpx",
      "title: 사용자 제목",
      "# 닫는 구분선이 없는 문서",
      GENERATED_CALLOUT
    ].join("\n");

    const result = stripHanmarkSourceMetadata(source);
    assert.equal(result.changed, false);
    assert.equal(result.markdown, source);
  });

  it("does not treat an isolated user YAML key as a legacy contract", () => {
    const source = [
      "---",
      "hwp-source: 사용자가 정의한 값",
      "title: 사용자 제목",
      "---",
      "# 본문"
    ].join("\n");

    const result = stripHanmarkSourceMetadata(source);
    assert.equal(result.changed, false);
    assert.equal(result.markdown, source);
  });

  it("creates a unique sibling without modifying the legacy original", async () => {
    const sourcePath = "자료/paper.md";
    const source = {
      path: sourcePath,
      basename: "paper",
      parent: { path: "자료" }
    } as TFile;
    const original = [
      "---",
      "title: 보존",
      "hwp-source: paper.hwpx",
      "hwp-source-format: hwpx",
      "---",
      GENERATED_CALLOUT,
      "본문"
    ].join("\n");
    const files = new Map<string, string>([
      [sourcePath, original],
      ["자료/paper (일반 Markdown).md", "기존 파일"]
    ]);
    const app = {
      vault: {
        read: async (file: TFile) => files.get(file.path) ?? "",
        getAbstractFileByPath: (path: string) =>
          files.has(path) ? { path } : null,
        create: async (path: string, content: string) => {
          files.set(path, content);
          return { path } as TFile;
        }
      }
    } as unknown as App;

    const result = await createCleanLegacyImportCopy(app, source);
    assert.equal(result.file.path, "자료/paper (일반 Markdown) (1).md");
    assert.equal(files.get(sourcePath), original);
    assert.match(
      files.get(result.file.path) ?? "",
      /^---\ntitle: 보존\n---\n본문$/u
    );
  });
});

it("new Kordoc imports write only parsed Markdown and attachment links", async () => {
  const source = await readFile("src/io/kordocImport.ts", "utf8");
  assert.match(
    source,
    /persistImportedImages\([\s\S]*?result\.markdown\.trim\(\),[\s\S]*?result\.images/u
  );
  assert.match(
    source,
    /app\.vault\.create\(relative, persisted\.markdown\.trim\(\) \+ "\\n"\)/u
  );
  assert.match(
    source,
    /\(result\.warnings\?\.length \?\? 0\) \+[\s\S]*?persisted\.warnings\.length \+[\s\S]*?cloud\.warnings\.length/u
  );
  assert.doesNotMatch(
    source,
    /cacheSource|processFrontMatter|renderSourceCallout|sha256Bytes|hwp-source/u
  );
});

it("public export types no longer expose source-patch", async () => {
  const [source, main] = await Promise.all([
    readFile("src/io/exportTypes.ts", "utf8"),
    readFile("src/main.ts", "utf8")
  ]);
  assert.doesNotMatch(source, /source-patch/u);
  assert.match(source, /"quick-hwpx"/u);
  assert.match(source, /"gongmun-hwpx"/u);
  assert.match(source, /type HwpxExportVariant =\s*\| "quick"\s*\| "gongmun"/u);
  assert.match(main, /id:\s*"patch-hwp-experimental"[\s\S]*?checkCallback/u);
  assert.match(
    main,
    /고급·레거시: 원본 형식 보존 수정본 만들기/u
  );
  assert.match(
    main,
    /id:\s*"create-clean-markdown-copy"[\s\S]*?createCleanLegacyMarkdownCopy/u
  );
  assert.doesNotMatch(
    main,
    /sourcePatchAvailable|patchSourceExperimentalWithOutcome/u
  );
});
