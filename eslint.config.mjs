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
      // Keep the same type-safety checks used by the Community review scanner
      // as release-blocking errors.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
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
