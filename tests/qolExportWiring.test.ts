import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const save = readFileSync("src/io/kordocSave.ts", "utf8");
const main = readFileSync("src/main.ts", "utf8");
const preview = readFileSync("src/ui/QuickHwpxPreviewView.ts", "utf8");
const modal = readFileSync("src/ui/HanmarkExportModal.ts", "utf8");

describe("official-document file names and remembered forms (R-028)", () => {
  it("names saved official documents after their form", () => {
    assert.match(save, /label \? gongmunVaultStem\(file\.basename, label\) : file\.basename/u);
    assert.match(save, /const relative = hwpxPathBesideNote\(app, context\.file, label\);/u);
    assert.match(save, /sourceContractGongmunName\(splitFilename\(sourceName\)\.stem, label, stamp\(\)\)/u);
    assert.match(save, /resolveOutputLocale\(outputLanguage\(plugin\), body\)/u, "the label follows the note's language");
    assert.match(save, /planGongmunExport\(app, file, host, options\.gongmunPreset, options\.gongmunFormId\)/u);
    assert.doesNotMatch(save, /save\.suffix\.gongmun/u);
  });

  it("passes the chosen form from the export window and the preview", () => {
    assert.match(modal, /this\.actions\.exportKordoc\(\s*"gongmun-hwpx",\s*this\.gongmunPreset,\s*this\.gongmunForm\s*\)/u);
    assert.match(preview, /this\.options\.gongmunPlan\(file, mode\.preset, mode\.formId\)/u);
    assert.doesNotMatch(preview, /private chosen:/u, "one note's pick no longer leaks into another note");
    assert.match(preview, /await this\.options\.exportHwpx\?\.\(this\.effectiveMode\(file\)\);/u);
  });

  it("remembers the form per note and follows renames and deletions", () => {
    assert.match(main, /rememberedNoteForm\(this\.settings\.gongmunFormByNote, file\.path/u);
    assert.match(main, /rememberNoteForm\(this\.settings\.gongmunFormByNote, note\.path, formId\)/u);
    assert.match(main, /this\.app\.vault\.on\("rename", \(file, oldPath\) =>/u);
    assert.match(main, /this\.app\.vault\.on\("delete", \(file\) =>/u);
    assert.match(main, /recordRecentExport\(this\.settings\.recentExports/u);
    assert.match(main, /await this\.afterExport\(outcome, mode === "gongmun-hwpx" \? formId : undefined, note\);/u);
  });
});

describe("several forms at once (R-028)", () => {
  const batch = readFileSync("src/ui/GongmunBatchModal.ts", "utf8");
  it("offers the batch from the export window and the command palette", () => {
    assert.match(modal, /t\("gongmun\.batch\.open"\)/u);
    assert.match(main, /id: "gongmun-export-all-forms",/u);
    assert.match(main, /exportGongmunFormBesideNote\(this\.app, this, snapshot, form\.id, allow\)/u);
    assert.match(save, /export async function exportGongmunFormBesideNote\(/u);
  });

  it("shows progress, stops between forms, and lists every file", () => {
    assert.match(batch, /isCancelled: \(\) => this\.stopRequested/u);
    assert.match(batch, /setPhase\(row, id === form\.id \? "waiting" : null\)/u);
    assert.match(batch, /t\("gongmun\.batch\.summary"/u);
    assert.match(batch, /if \(this\.stage === "running"\) return;/u, "the window stays open while forms are made");
  });
});
