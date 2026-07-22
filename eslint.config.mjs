import tsparser from "@typescript-eslint/parser";
import json from "@eslint/json";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: [
      "main.js",
      "legacy-main.cjs",
      "node_modules/**",
      "release/**",
      "src/io/embeddedAssets.ts"
    ]
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // HanMark's compatibility shell is intentionally dynamic. Keep every
      // Obsidian, DOM-safety and security rule from the official preset, while
      // leaving a gradual strict-typing migration outside this release.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      // The interface is Korean-first. The English sentence-case rule produces
      // false positives for Korean text containing format and brand names.
      "obsidianmd/ui/sentence-case": "off"
    }
  },
  {
    files: ["manifest.json"],
    language: "json/json",
    plugins: { json, obsidianmd },
    rules: {
      "no-irregular-whitespace": "off",
      "obsidianmd/validate-manifest": "error"
    }
  }
]);
