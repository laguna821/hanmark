import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  cloneToolbarSkin,
  normalizeHanmarkSettings,
  normalizeToolbarHex,
  normalizeToolbarSkin,
  TOOLBAR_SKIN_DARK_PRESETS,
  TOOLBAR_SKIN_DEFAULTS,
  type ToolbarSkinPaletteKey
} from "../src/legacy-port/settings";

const PALETTE_KEYS: ToolbarSkinPaletteKey[] = [
  "toolbarBg",
  "toolbarEdge",
  "buttonBorder",
  "logoBody",
  "logoAccent",
  "logoMuted",
  "logoText"
];

test("toolbar skin migration preserves valid 2.4.2 values and repairs invalid CSS", () => {
  const settings = normalizeHanmarkSettings({
    toolbarSkinMode: "dark",
    toolbarSkin: {
      light: {
        toolbarBg: "abcdef",
        toolbarEdge: "#010203",
        buttonBorder: "#not-css",
        logoBody: "#123456",
        logoAccent: "#234567",
        logoMuted: "#345678",
        logoText: "#456789"
      },
      dark: {
        toolbarBg: "#090909",
        toolbarEdge: "#101010",
        buttonBorder: "#ABCDEF; color:red",
        logoBody: "#112233",
        logoAccent: "#223344",
        logoMuted: "#334455",
        logoText: "#445566"
      }
    }
  });

  assert.equal(settings.toolbarSkinMode, "dark");
  assert.equal(settings.toolbarSkin.light.toolbarBg, "#ABCDEF");
  assert.equal(
    settings.toolbarSkin.light.buttonBorder,
    TOOLBAR_SKIN_DEFAULTS.light.buttonBorder
  );
  assert.equal(
    settings.toolbarSkin.dark.buttonBorder,
    TOOLBAR_SKIN_DEFAULTS.dark.buttonBorder
  );
  assert.equal(settings.toolbarSkin.dark.logoBody, "#112233");
  assert.equal(
    normalizeToolbarHex("red; background:url(example)", "#010203"),
    "#010203"
  );
});

test("toolbar skin migration resets the retired overexposed lime palette", () => {
  const skin = normalizeToolbarSkin({
    dark: {
      toolbarBg: "#000000",
      toolbarEdge: "#111111",
      buttonBorder: "#B6FF00",
      logoBody: "#B6FF00",
      logoAccent: "#D4FF4A",
      logoMuted: "#EDFF9A",
      logoText: "#121212"
    }
  });

  assert.deepEqual(skin.dark, TOOLBAR_SKIN_DEFAULTS.dark);
});

test("toolbar skin defaults and legacy dark presets expose all seven colors", () => {
  for (const variant of ["light", "dark"] as const) {
    assert.deepEqual(Object.keys(TOOLBAR_SKIN_DEFAULTS[variant]), PALETTE_KEYS);
  }
  for (const preset of Object.values(TOOLBAR_SKIN_DARK_PRESETS)) {
    assert.deepEqual(Object.keys(preset), PALETTE_KEYS);
    for (const value of Object.values(preset)) {
      assert.match(value, /^#[0-9A-F]{6}$/);
    }
  }

  const clone = cloneToolbarSkin(TOOLBAR_SKIN_DEFAULTS);
  clone.light.toolbarBg = "#000000";
  assert.equal(TOOLBAR_SKIN_DEFAULTS.light.toolbarBg, "#38A9FF");
});

test("toolbar skin is applied through classes and CSS variables without dynamic HTML", async () => {
  const [controller, settingsTab, styles, main] = await Promise.all([
    readFile("src/ui/ToolbarController.ts", "utf8"),
    readFile("src/ui/HanmarkSettingTab.ts", "utf8"),
    readFile("styles.css", "utf8"),
    readFile("src/main.ts", "utf8")
  ]);

  assert.match(controller, /style\.setProperty/);
  assert.match(controller, /hwp-toolbar-skin-\$\{mode\}/);
  assert.doesNotMatch(controller, /innerHTML|createElement\(["']style["']\)/);
  assert.match(styles, /\.theme-dark \.hwp-toolbar-container\.hwp-toolbar-skin-auto/);
  assert.match(settingsTab, /Charcoal Minimal/);
  assert.match(settingsTab, /Neo Lime Dark/);
  assert.match(settingsTab, /Olive Deck/);
  assert.match(main, /\(\) => this\.settings/);
});
