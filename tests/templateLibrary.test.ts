import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultDocumentStyleProfile } from "../src/io/documentStyle";
import {
  activeTemplateItem,
  deleteTemplateRecordInMemory,
  getTemplateLibrary,
  listTemplateItems,
  migrateTemplateLibrarySettingsInMemory,
  newTemplateRecord,
  putTemplateRecord,
  setActiveTemplateInMemory
} from "../src/io/templateLibrary";

function plugin(settings: Record<string, unknown> = {}): any {
  return { settings };
}

function tableStyle(name = "표 스타일"): any {
  return { name, tables: [{ rows: 2, cols: 2, cells: [] }] };
}

describe("HWPX template library", () => {
  it("migrates the former document and table slots into one active custom template", () => {
    const profile = defaultDocumentStyleProfile();
    profile.name = "이전 사용자 스타일";
    const settings: any = {
      hanmarkDocumentStylePreset: "custom",
      hanmarkDocumentStyle: profile,
      hanmarkTableProfile: tableStyle(),
      hanmarkTableProfileName: "이전 표",
      defaultTemplatePath: "old-template.hwpx",
      cachedTemplateStyles: { Normal: {} },
      cachedTemplatePageLayout: { width_pt: 100 }
    };

    assert.equal(migrateTemplateLibrarySettingsInMemory(settings), true);
    const library = settings.hanmarkTemplateLibrary;
    assert.match(library.activeId, /^custom:/);
    assert.equal(Object.keys(library.customTemplates).length, 1);
    assert.equal(library.customTemplates[library.activeId].documentStyle.name, "이전 사용자 스타일");
    assert.equal(library.customTemplates[library.activeId].tableStyle.tables.length, 1);
    for (const key of [
      "hanmarkDocumentStylePreset",
      "hanmarkDocumentStyle",
      "hanmarkTableProfile",
      "hanmarkTableProfileName",
      "defaultTemplatePath",
      "cachedTemplateStyles",
      "cachedTemplatePageLayout"
    ]) assert.equal(Object.hasOwn(settings, key), false, `${key} should be removed`);

    const snapshot = JSON.stringify(settings);
    assert.equal(migrateTemplateLibrarySettingsInMemory(settings), false);
    assert.equal(JSON.stringify(settings), snapshot);
  });

  it("preserves an old built-in preset and table style as a combined custom template", () => {
    const settings: any = {
      hanmarkDocumentStylePreset: "youth-studies",
      hanmarkTableProfile: tableStyle("청소년학 표"),
      hanmarkTableProfileName: "청소년학 표"
    };
    migrateTemplateLibrarySettingsInMemory(settings);

    const library = settings.hanmarkTemplateLibrary;
    const record = library.customTemplates[library.activeId];
    assert.ok(record);
    assert.equal(record.documentStyle.name, record.name);
    assert.match(record.name, /청소년학/);
    assert.equal(record.tableStyle.tables.length, 1);
  });

  it("supports multiple named templates, active switching, duplication names and safe deletion", () => {
    const target = plugin();
    migrateTemplateLibrarySettingsInMemory(target.settings);
    const first = putTemplateRecord(target, newTemplateRecord(target, "수업안", defaultDocumentStyleProfile(), tableStyle()));
    const second = putTemplateRecord(target, newTemplateRecord(target, "수업안", defaultDocumentStyleProfile()));

    assert.equal(first.name, "수업안");
    assert.equal(second.name, "수업안 2");
    assert.equal(first.documentStyle?.name, "수업안");
    assert.equal(second.documentStyle?.name, "수업안 2");
    assert.equal(listTemplateItems(target).filter((item) => !item.builtIn).length, 2);

    setActiveTemplateInMemory(target, second.id);
    assert.equal(activeTemplateItem(target).id, second.id);
    assert.equal(activeTemplateItem(target).tableStyle, undefined);

    assert.equal(deleteTemplateRecordInMemory(target, second.id), true);
    assert.equal(getTemplateLibrary(target).activeId, "builtin:kordoc-default");
    assert.equal(deleteTemplateRecordInMemory(target, "builtin:kordoc-default"), false);
    assert.equal(listTemplateItems(target).filter((item) => !item.builtIn).length, 1);
  });
});
