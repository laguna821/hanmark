import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_HANMARK_SETTINGS,
  normalizeHanmarkSettings,
  normalizeHtmlExportTheme
} from "../src/legacy-port/settings";

test("HTML theme settings migrate to version 6 with Achmage Editorial by default", () => {
  const settings = normalizeHanmarkSettings({
    settingsVersion: 5,
    unrelatedFutureSetting: "preserved"
  });

  assert.equal(settings.settingsVersion, 6);
  assert.equal(settings.htmlExportTheme, "achmage-editorial");
  assert.equal(settings.unrelatedFutureSetting, "preserved");
  assert.equal(DEFAULT_HANMARK_SETTINGS.htmlExportTheme, "achmage-editorial");
});

test("HTML theme settings preserve Classic and reject unknown stored values", () => {
  assert.equal(normalizeHtmlExportTheme("classic"), "classic");
  assert.equal(normalizeHtmlExportTheme("achmage-editorial"), "achmage-editorial");
  assert.equal(normalizeHtmlExportTheme("external-theme"), "achmage-editorial");
  assert.equal(
    normalizeHanmarkSettings({ htmlExportTheme: "classic" }).htmlExportTheme,
    "classic"
  );
});

test("settings UI exposes clear Achmage Editorial and Classic choices", async () => {
  const source = await readFile("src/ui/HanmarkSettingTab.ts", "utf8");

  assert.match(source, /HTML 내보내기/u);
  assert.match(source, /Achmage Editorial \(권장\)/u);
  assert.match(source, /Classic \(기존 스타일\)/u);
  assert.doesNotMatch(source, /innerHTML/u);
});
