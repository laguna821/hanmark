import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  activeEditorialPdfThemeSnapshot,
  availableEditorialPdfThemeName,
  BUILTIN_EDITORIAL_PDF_PALETTE,
  BUILTIN_EDITORIAL_PDF_THEME,
  BUILTIN_EDITORIAL_PDF_THEME_ID,
  BUILTIN_EDITORIAL_PDF_THEME_NAME,
  builtInEditorialPdfThemeSnapshot,
  canonicalEditorialPdfHex,
  contrastRatio,
  createEditorialPdfTheme,
  deleteEditorialPdfTheme,
  duplicateEditorialPdfTheme,
  editorialPdfGraphemeCount,
  emptyEditorialPdfThemeLibrary,
  listEditorialPdfThemeSnapshots,
  normalizeEditorialPdfTheme,
  normalizeEditorialPdfThemeLibrary,
  parseEditorialPdfThemeExchange,
  relativeLuminance,
  renameEditorialPdfTheme,
  resolveEditorialPdfOnKey,
  resolveEditorialPdfTheme,
  resolveEditorialPdfThemeSnapshot,
  setActiveEditorialPdfTheme,
  stringifyEditorialPdfThemeExchange,
  updateEditorialPdfTheme
} from "../src/io/editorialPdfTheme";
import {
  DEFAULT_HANMARK_SETTINGS,
  normalizeHanmarkSettings
} from "../src/legacy-port/settings";

const FIXED_NOW = "2026-08-10T00:00:00.000Z";
const FIRST_ID = "custom:00000000-0000-4000-8000-000000000001";
const SECOND_ID = "custom:00000000-0000-4000-8000-000000000002";

describe("Editorial PDF theme normalization", () => {
  test("keeps the immutable 2.5.5 builtin contract exact", () => {
    assert.equal(BUILTIN_EDITORIAL_PDF_THEME_ID, "builtin:achmage-hanmark");
    assert.equal(BUILTIN_EDITORIAL_PDF_THEME_NAME, "Achmage HanMark 기본");
    assert.deepEqual(BUILTIN_EDITORIAL_PDF_THEME.colors, {
      key: "#002E6E",
      overrides: { onKey: null, keyInk: null, accentLine: null }
    });
    assert.deepEqual(BUILTIN_EDITORIAL_PDF_THEME.cover, {
      kicker: "HANMARK PDF PRINT",
      edition: "EDITORIAL EDITION",
      titleMode: "file-title",
      titleText: "",
      subtitle: "Markdown to Editorial PDF",
      brand: "ACHMAGE / HanMark PDF Edition",
      system: "HANMARK EXPORT SYSTEM",
      detail: "OBSIDIAN MARKDOWN · PRINT-READY A4",
      tags: ["#HANMARK", "#MARKDOWN", "#EDITORIAL", "#PDF"]
    });
    assert.deepEqual(BUILTIN_EDITORIAL_PDF_THEME.page, {
      headerLeft: "HANMARK PDF PRINT",
      headerRightMode: "file-title",
      headerRightText: "",
      footerLeft: "ACHMAGE / HANMARK PDF EDITION",
      showPageNumber: true
    });
    assert.deepEqual(BUILTIN_EDITORIAL_PDF_PALETTE, {
      paper: "#FFFFFF",
      bodyInk: "#182433",
      keySurface: "#002E6E",
      onKey: "#FFFFFF",
      keyInk: "#002E6E",
      keyMutedInk: "#31537D",
      accentLine: "#00B5AD",
      accentOnKey: "#7FE2DC",
      softTint: "#C7F1EE",
      border: "#D9E0E6",
      alternate: "#FAFAFA"
    });
    assert.ok(Object.isFrozen(BUILTIN_EDITORIAL_PDF_THEME));
    assert.ok(Object.isFrozen(BUILTIN_EDITORIAL_PDF_THEME.colors));
    assert.ok(Object.isFrozen(BUILTIN_EDITORIAL_PDF_THEME.cover.tags));

    const resolved = resolveEditorialPdfThemeSnapshot(
      builtInEditorialPdfThemeSnapshot()
    );
    assert.deepEqual(resolved.theme, BUILTIN_EDITORIAL_PDF_THEME);
    assert.equal(
      resolved.theme.page.footerLeft,
      "ACHMAGE / HANMARK PDF EDITION"
    );
    assert.deepEqual(resolved.palette, BUILTIN_EDITORIAL_PDF_PALETTE);
    assert.deepEqual(resolved.warnings, []);
  });

  test("repairs partial values, preserves explicit blanks, and limits graphemes", () => {
    const familyEmoji = "👨‍👩‍👧‍👦";
    const normalized = normalizeEditorialPdfTheme({
      colors: {
        key: " 00b5ad ",
        overrides: {
          onKey: "ffffff",
          keyInk: "not-css",
          accentLine: null
        }
      },
      cover: {
        kicker: "",
        edition: "A\nB\u0000C",
        titleMode: "custom",
        titleText: familyEmoji.repeat(121),
        subtitle: "",
        brand: "",
        system: "",
        detail: "",
        tags: ["", "  ", " #ONE "]
      },
      page: {
        headerLeft: "",
        headerRightMode: "blank",
        headerRightText: "",
        footerLeft: "",
        showPageNumber: false
      }
    });

    assert.equal(normalized.colors.key, "#00B5AD");
    assert.equal(normalized.colors.overrides.onKey, "#FFFFFF");
    assert.equal(normalized.colors.overrides.keyInk, null);
    assert.equal(normalized.cover.kicker, "");
    assert.equal(normalized.cover.edition, "A B C");
    assert.equal(editorialPdfGraphemeCount(normalized.cover.titleText), 120);
    assert.deepEqual(normalized.cover.tags, ["#ONE"]);
    assert.equal(normalized.page.headerLeft, "");
    assert.equal(normalized.page.showPageNumber, false);
    assert.deepEqual(
      normalizeEditorialPdfTheme(normalized),
      normalized,
      "normalization must be idempotent"
    );
  });

  test("accepts only opaque canonical six-digit hex colors", () => {
    assert.equal(canonicalEditorialPdfHex(" #123abc "), "#123ABC");
    assert.equal(canonicalEditorialPdfHex("123ABC"), "#123ABC");
    for (const invalid of [
      "#ABC",
      "#12345678",
      "rgb(0,0,0)",
      "red",
      "var(--x)",
      "#000000; color:red",
      "url(x)",
      null,
      123,
      []
    ]) {
      assert.equal(canonicalEditorialPdfHex(invalid), null);
    }
  });
});

describe("Editorial PDF theme library", () => {
  test("creates, updates, renames, duplicates, lists, activates, and deletes themes", () => {
    const empty = emptyEditorialPdfThemeLibrary();
    const first = createEditorialPdfTheme(empty, "연구소 테마", undefined, {
      id: FIRST_ID,
      now: FIXED_NOW
    });
    assert.equal(Object.keys(empty.customThemes).length, 0, "CRUD is immutable");
    assert.equal(first.record.name, "연구소 테마");

    const duplicate = duplicateEditorialPdfTheme(
      first.library,
      FIRST_ID,
      "연구소 테마",
      { id: SECOND_ID, now: FIXED_NOW }
    );
    assert.equal(duplicate.record.name, "연구소 테마 2");

    const renamed = renameEditorialPdfTheme(
      duplicate.library,
      SECOND_ID,
      "연구소 테마",
      "2026-08-10T00:00:01.000Z"
    );
    assert.equal(renamed.record.name, "연구소 테마 2");

    const editedTheme = normalizeEditorialPdfTheme({
      ...renamed.record.theme,
      colors: {
        key: "#FFFF00",
        overrides: { onKey: null, keyInk: null, accentLine: null }
      }
    });
    const updated = updateEditorialPdfTheme(
      renamed.library,
      SECOND_ID,
      editedTheme,
      "2026-08-10T00:00:02.000Z"
    );
    assert.equal(updated.record.theme.colors.key, "#FFFF00");
    assert.equal(updated.record.createdAt, FIXED_NOW);

    const active = setActiveEditorialPdfTheme(updated.library, SECOND_ID);
    assert.equal(activeEditorialPdfThemeSnapshot(active).id, SECOND_ID);
    assert.deepEqual(
      listEditorialPdfThemeSnapshots(active).map(({ id }) => id),
      [BUILTIN_EDITORIAL_PDF_THEME_ID, FIRST_ID, SECOND_ID]
    );

    const deleted = deleteEditorialPdfTheme(active, SECOND_ID);
    assert.equal(deleted.activeId, BUILTIN_EDITORIAL_PDF_THEME_ID);
    assert.equal(activeEditorialPdfThemeSnapshot(deleted).builtIn, true);
    assert.equal(deleteEditorialPdfTheme(deleted, BUILTIN_EDITORIAL_PDF_THEME_ID).activeId,
      BUILTIN_EDITORIAL_PDF_THEME_ID);
  });

  test("uses Korean-aware unique names and repairs a damaged active selection", () => {
    const first = createEditorialPdfTheme(
      emptyEditorialPdfThemeLibrary(),
      "한글 테마",
      undefined,
      { id: FIRST_ID, now: FIXED_NOW }
    );
    assert.equal(
      availableEditorialPdfThemeName(first.library, "한글 테마"),
      "한글 테마 2"
    );
    assert.equal(
      availableEditorialPdfThemeName(first.library, BUILTIN_EDITORIAL_PDF_THEME_NAME),
      `${BUILTIN_EDITORIAL_PDF_THEME_NAME} 2`
    );
    assert.equal(
      editorialPdfGraphemeCount(
        availableEditorialPdfThemeName(first.library, "가".repeat(120))
      ),
      100
    );

    const duplicateNames = normalizeEditorialPdfThemeLibrary({
      schemaVersion: 1,
      activeId: FIRST_ID,
      customThemes: {
        [FIRST_ID]: first.record,
        [SECOND_ID]: { ...first.record, id: SECOND_ID }
      }
    });
    assert.equal(duplicateNames.customThemes[FIRST_ID]?.name, "한글 테마");
    assert.equal(duplicateNames.customThemes[SECOND_ID]?.name, "한글 테마 2");

    const damaged = normalizeEditorialPdfThemeLibrary({
      ...first.library,
      activeId: "custom:missing"
    });
    assert.equal(damaged.activeId, BUILTIN_EDITORIAL_PDF_THEME_ID);
    assert.equal(activeEditorialPdfThemeSnapshot(damaged).builtIn, true);
    assert.throws(
      () => setActiveEditorialPdfTheme(damaged, "custom:missing"),
      /찾을 수 없습니다/u
    );
  });
});

describe("Editorial PDF color resolution", () => {
  test("implements unrounded W3C luminance and contrast fixtures", () => {
    assert.equal(relativeLuminance("#FFFFFF"), 1);
    assert.equal(relativeLuminance("#000000"), 0);
    assert.ok(Math.abs(contrastRatio("#FFFF00", "#FFFFFF") - 1.0738392309265699) < 1e-12);
    assert.ok(Math.abs(contrastRatio("#FFFF00", "#000000") - 19.555999999999997) < 1e-12);
  });

  test("preserves the exact key and meets automatic contrast invariants", () => {
    const keys = [
      "#002E6E",
      "#FFFF00",
      "#FFD400",
      "#808080",
      "#FFFFFF",
      "#000000",
      "#FF0000",
      "#00FF00",
      "#00FFFF",
      "#0000FF",
      "#FEFEFE",
      "#010101"
    ];
    for (const key of keys) {
      const theme = normalizeEditorialPdfTheme({
        colors: {
          key,
          overrides: { onKey: null, keyInk: null, accentLine: null }
        }
      });
      const resolved = resolveEditorialPdfTheme(theme);
      assert.equal(resolved.palette.keySurface, key);
      assert.ok(contrastRatio(resolved.palette.onKey, key) >= 4.5, key);
      assert.ok(contrastRatio(resolved.palette.keyInk, "#FFFFFF") >= 7, key);
      assert.ok(contrastRatio(resolved.palette.keyMutedInk, "#FFFFFF") >= 4.5, key);
      assert.ok(contrastRatio(resolved.palette.accentLine, "#FFFFFF") >= 3, key);
      assert.ok(contrastRatio(resolved.palette.accentOnKey, key) >= 4.5, key);
      assert.ok(contrastRatio(resolved.palette.bodyInk, resolved.palette.softTint) >= 7, key);
      assert.ok(contrastRatio(resolved.palette.border, "#FFFFFF") >= 3, key);
      assert.deepEqual(resolved.warnings, []);
      for (const color of Object.values(resolved.palette)) {
        assert.match(color, /^#[0-9A-F]{6}$/u);
      }
    }
  });

  test("the fast on-key selector uses production logic for the exhaustive gate", () => {
    assert.deepEqual(resolveEditorialPdfOnKey("#002E6E"), {
      color: "#FFFFFF",
      ratio: contrastRatio("#FFFFFF", "#002E6E"),
      aaa: true
    });
    const gray = resolveEditorialPdfOnKey("#808080");
    assert.equal(gray.color, "#000000");
    assert.ok(gray.ratio >= 4.5);
    assert.equal(gray.aaa, false);
  });

  test("keeps valid low-contrast manual overrides and reports exact warnings", () => {
    const theme = normalizeEditorialPdfTheme({
      colors: {
        key: "#FFFF00",
        overrides: {
          onKey: "#FFFFFF",
          keyInk: "#FFFF00",
          accentLine: "#FFFFFF"
        }
      }
    });
    const resolved = resolveEditorialPdfTheme(theme);
    assert.equal(resolved.palette.onKey, "#FFFFFF");
    assert.equal(resolved.palette.keyInk, "#FFFF00");
    assert.equal(resolved.palette.accentLine, "#FFFFFF");
    assert.equal(resolved.warnings.length, 3);
    assert.deepEqual(
      resolved.diagnostics.map(({ token, manual, passes }) => ({ token, manual, passes })),
      [
        { token: "onKey", manual: true, passes: false },
        { token: "keyInk", manual: true, passes: false },
        { token: "accentLine", manual: true, passes: false }
      ]
    );
  });
});

describe("Editorial PDF theme JSON exchange", () => {
  test("round-trips one allowlisted theme without local metadata", () => {
    const sourceTheme = normalizeEditorialPdfTheme({
      colors: {
        key: "#FFD400",
        overrides: { onKey: "#182433", keyInk: null, accentLine: null }
      },
      cover: { kicker: "", tags: [] },
      page: { footerLeft: "" }
    });
    const json = stringifyEditorialPdfThemeExchange("공유 테마", sourceTheme);
    assert.doesNotMatch(json, /createdAt|updatedAt|activeId|custom:/u);
    const imported = parseEditorialPdfThemeExchange(json);
    assert.equal(imported.name, "공유 테마");
    assert.deepEqual(imported.theme, sourceTheme);

    const withUnknownFields = JSON.parse(json) as Record<string, unknown>;
    withUnknownFields.id = "custom:do-not-import";
    const importedAgain = parseEditorialPdfThemeExchange(
      JSON.stringify(withUnknownFields)
    );
    assert.equal("id" in importedAgain, false);
  });

  test("removes blank imported tags before enforcing the eight-tag limit", () => {
    const exchange = JSON.parse(stringifyEditorialPdfThemeExchange(
      "Tag limit",
      BUILTIN_EDITORIAL_PDF_THEME
    )) as { theme: { cover: { tags: unknown[] } } };
    exchange.theme.cover.tags = [
      "",
      "  ",
      "#ONE",
      "#TWO",
      "#THREE",
      "#FOUR",
      "#FIVE",
      "#SIX",
      "#SEVEN",
      "#EIGHT"
    ];
    assert.deepEqual(
      parseEditorialPdfThemeExchange(JSON.stringify(exchange)).theme.cover.tags,
      ["#ONE", "#TWO", "#THREE", "#FOUR", "#FIVE", "#SIX", "#SEVEN", "#EIGHT"]
    );
    exchange.theme.cover.tags.push("#NINE");
    assert.throws(
      () => parseEditorialPdfThemeExchange(JSON.stringify(exchange)),
      /8/u
    );
  });

  test("rejects oversized, malformed, and invalid-schema exchanges", () => {
    assert.throws(
      () => parseEditorialPdfThemeExchange("x".repeat(256 * 1024 + 1)),
      /256KiB/u
    );
    assert.throws(
      () => parseEditorialPdfThemeExchange("{not-json"),
      /JSON/u
    );
    assert.throws(
      () => parseEditorialPdfThemeExchange(JSON.stringify({
        format: "hanmark-editorial-pdf-theme",
        schemaVersion: 2
      })),
      /형식/u
    );

    const valid = JSON.parse(stringifyEditorialPdfThemeExchange(
      "검증",
      BUILTIN_EDITORIAL_PDF_THEME
    )) as {
      format: string;
      schemaVersion: number;
      name: string;
      theme: Record<string, unknown>;
    };
    const cover = valid.theme.cover as Record<string, unknown>;
    cover.titleMode = "raw-css";
    assert.throws(
      () => parseEditorialPdfThemeExchange(JSON.stringify(valid)),
      /제목 모드/u
    );
    cover.titleMode = "file-title";
    valid.name = "👨‍👩‍👧‍👦".repeat(101);
    assert.throws(
      () => parseEditorialPdfThemeExchange(JSON.stringify(valid)),
      /100/u
    );
  });
});

describe("settings v9 migration", () => {
  test("adds an empty builtin-active library to v8 settings", () => {
    const settings = normalizeHanmarkSettings({
      settingsVersion: 8,
      futureSetting: { remains: true }
    });
    assert.equal(settings.settingsVersion, 9);
    assert.deepEqual(settings.editorialPdfThemeLibrary, {
      schemaVersion: 1,
      activeId: BUILTIN_EDITORIAL_PDF_THEME_ID,
      customThemes: {}
    });
    assert.deepEqual(settings.futureSetting, { remains: true });
    assert.deepEqual(
      normalizeHanmarkSettings(settings).editorialPdfThemeLibrary,
      settings.editorialPdfThemeLibrary
    );
  });

  test("normalizes stored libraries and the default settings are isolated", () => {
    const created = createEditorialPdfTheme(
      emptyEditorialPdfThemeLibrary(),
      "저장 테마",
      undefined,
      { id: FIRST_ID, now: FIXED_NOW }
    );
    const settings = normalizeHanmarkSettings({
      settingsVersion: 9,
      editorialPdfThemeLibrary: {
        ...created.library,
        activeId: FIRST_ID
      }
    });
    assert.equal(settings.editorialPdfThemeLibrary.activeId, FIRST_ID);
    assert.equal(
      settings.editorialPdfThemeLibrary.customThemes[FIRST_ID]?.name,
      "저장 테마"
    );
    assert.notEqual(
      settings.editorialPdfThemeLibrary,
      DEFAULT_HANMARK_SETTINGS.editorialPdfThemeLibrary
    );
  });
});
