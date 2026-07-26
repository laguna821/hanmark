import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the 2.4.2 toolbar editing entry points remain available", async () => {
  const toolbar = await readFile("src/ui/ToolbarController.ts", "utf8");
  const commands = await readFile("src/editorCommands.ts", "utf8");

  for (const commandId of [
    "editor:toggle-checklist-status",
    "insert-callout-note",
    "insert-callout-warning",
    "superscript",
    "subscript"
  ]) {
    assert.match(toolbar, new RegExp(commandId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  }
  assert.match(toolbar, /type: "color"/u);
  assert.match(toolbar, /applyFontColorValue/u);
  assert.match(toolbar, /applyBackgroundColorValue/u);
  assert.match(commands, /export function applyFontColorValue/u);
  assert.match(commands, /export function applyBackgroundColorValue/u);
});

test("the live HWPX preview toggle controls automatic lifecycle refreshes", async () => {
  const preview = await readFile(
    "src/ui/QuickHwpxPreviewView.ts",
    "utf8"
  );
  const main = await readFile("src/main.ts", "utf8");
  const settings = await readFile("src/ui/HanmarkSettingTab.ts", "utf8");

  assert.match(preview, /livePreviewEnabled/u);
  assert.match(preview, /scheduleIfEnabled/u);
  assert.match(main, /\(\) => this\.settings\.enableLivePreview/u);
  assert.match(settings, /실시간 HWPX 미리보기/u);
  assert.match(settings, /this\.host\.settings\.enableLivePreview = enabled/u);
});

test("HTML export retains the 2.4.2 default filename", async () => {
  const main = await readFile("src/main.ts", "utf8");
  assert.match(main, /\$\{source\.title\}_html\.html/u);
});
