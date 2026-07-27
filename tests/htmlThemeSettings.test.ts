import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_HANMARK_SETTINGS,
  normalizeHanmarkSettings,
  normalizeHtmlExportTheme,
  normalizeImportedImageDestination,
  normalizeImportedImageFolder
} from "../src/legacy-port/settings";

test("settings migrate to version 8 with safe HTML and imported-image defaults", () => {
  const settings = normalizeHanmarkSettings({
    settingsVersion: 5,
    unrelatedFutureSetting: "preserved"
  });

  assert.equal(settings.settingsVersion, 8);
  assert.equal(settings.htmlExportTheme, "achmage-editorial");
  assert.equal(settings.importedImageDestination, "vault");
  assert.equal(settings.importedImageFolder, "");
  assert.equal(settings.cmdsEagleWorkerUrl, "");
  assert.equal(settings.cmdsEaglePublicUrl, "");
  assert.equal(settings.unrelatedFutureSetting, "preserved");
  assert.equal(DEFAULT_HANMARK_SETTINGS.htmlExportTheme, "achmage-editorial");
});

test("imported-image settings preserve explicit cloud and ask choices", () => {
  assert.equal(normalizeImportedImageDestination("cmds-eagle-r2"), "cmds-eagle-r2");
  assert.equal(normalizeImportedImageDestination("ask"), "ask");
  assert.equal(normalizeImportedImageDestination("unknown"), "vault");

  const settings = normalizeHanmarkSettings({
    importedImageDestination: "cmds-eagle-r2",
    importedImageFolder: " Attachments\\HanMark ",
    cmdsEagleWorkerUrl: " https://worker.example/ ",
    cmdsEaglePublicUrl: " https://cdn.example/ "
  });
  assert.equal(settings.importedImageDestination, "cmds-eagle-r2");
  assert.equal(settings.importedImageFolder, "Attachments/HanMark");
  assert.equal(settings.cmdsEagleWorkerUrl, "https://worker.example/");
  assert.equal(settings.cmdsEaglePublicUrl, "https://cdn.example/");
});

test("imported-image folder accepts only safe Vault-relative paths", () => {
  assert.equal(normalizeImportedImageFolder("Attachments/HanMark"), "Attachments/HanMark");
  assert.equal(normalizeImportedImageFolder("  Images\\Imported  "), "Images/Imported");
  assert.equal(normalizeImportedImageFolder(""), "");
  assert.equal(normalizeImportedImageFolder("../outside"), "");
  assert.equal(normalizeImportedImageFolder("C:\\outside"), "");
  assert.equal(normalizeImportedImageFolder("/absolute"), "");
  assert.equal(normalizeImportedImageFolder(".obsidian/plugins"), "");
  assert.equal(normalizeImportedImageFolder("Images:Imported"), "");
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
  assert.match(
    source,
    /CMDS Eagle 현재 클라우드 \(R2 폴백 가능\)/u
  );
  assert.match(source, /가져올 때마다 묻기/u);
  assert.match(source, /로컬 이미지 폴더/u);
  assert.match(source, /Obsidian의 첨부 파일 위치 설정/u);
  assert.match(source, /API 키는 필요할 때 묻고 인증 성공 뒤 세션 메모리에만/u);
  assert.doesNotMatch(source, /innerHTML/u);
});

test("plugin load persists the settings version migration", async () => {
  const source = await readFile("src/main.ts", "utf8");

  assert.match(
    source,
    /migrationInput\.settingsVersion !== this\.settings\.settingsVersion/u
  );
  assert.match(source, /await this\.saveData\(this\.settings\)/u);
});
