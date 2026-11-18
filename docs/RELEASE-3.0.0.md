# HanMark 3.0.0 release checklist

Written 2026-11-18 on branch `m12-release`. Nothing here has been pushed, tagged, or published.

## 1. Before leaving this PC

1. Merge the last local branches into one release commit (`m12-release` plus whatever `m11-docx-polish` finishes) and run:

   ```
   node node_modules/eslint/bin/eslint.js src package.json manifest.json --max-warnings 0
   node scripts/check-i18n.mjs
   node scripts/run-tests.mjs
   node node_modules/typescript/bin/tsc --noEmit --skipLibCheck
   node esbuild.config.mjs production
   node scripts/check-bundle.mjs
   node scripts/check-community.mjs
   node scripts/check-release.mjs
   npm audit --omit=dev --omit=optional
   npm audit --include=dev --include=optional --audit-level=critical
   ```

2. If the minimum Obsidian version must move, change it in three places together: `manifest.json` (`minAppVersion`), `versions.json` (`"3.0.0": …`), and `MIN_APP_VERSION` at the top of `scripts/check-release.mjs`. README limits and `release-notes/3.0.0.md` name 1.8.9 too.
3. Manual checks still open (none of them was done for 3.0.0):
   - Hancom Office display of: official documents with an agency look, 서울방침, a look made from a sample, a converted HWP, memos, equation objects, sub/superscripts, and a document with Mermaid pictures.
   - Obsidian on macOS (built-in DOCX, diagram pictures, PDF import with the embedded engine).
   - An old Obsidian installer (Electron older than the 1.8.9 installer's) for the WebAssembly engines.
   - Community review rules against the 6.3 MB `main.js`.

## 2. Release convention (same steps as 2.7.1)

```
git checkout -b 3.0.0            # the version is the branch name
git push -u origin 3.0.0         # starts "Verify plugin" (ci.yml is pinned to branch 3.0.0)
# wait for CI on Windows, macOS, and Ubuntu to pass
git tag -a 3.0.0 -m "HanMark 3.0.0 - Kordoc 4.25, Frames and Looks, Diagrams, and Built-in DOCX"
git push origin refs/tags/3.0.0  # starts "Publish verified plugin" (release.yml is pinned to tag 3.0.0)
```

Then set the repository default branch to `3.0.0` (GitHub → Settings → General → Default branch). Obsidian reads `manifest.json` from the default branch to offer the update.

The release workflow verifies on three systems, checks that the tag equals `manifest.json`, attests and publishes exactly `main.js`, `manifest.json`, and `styles.css`, with the title `HanMark 3.0.0 — Kordoc 4.25, Frames and Looks, Diagrams, and Built-in DOCX` and `release-notes/3.0.0.md` as notes. Because both a branch and a tag are named `3.0.0`, push them with full refs (`refs/heads/3.0.0`, `refs/tags/3.0.0`) when git says the name is ambiguous.

If a run fails before the release is created, fix on the branch, delete the remote tag (`git push origin :refs/tags/3.0.0`), re-tag the new commit, and push the tag again (this happened with 2.7.1).

## 3. What CI runs

`npm ci --omit=optional`, both audits, `npm run check`, then `npx playwright install --with-deps chromium` and `test:pdf-render`, `test:pdf-ui`, `test:toolbar-ui`, `test:preview-ui` (the last two only in `ci.yml`). The scripts added in 3.0.0 (`test:form-ui`, `test:import-ui`, `test:check-ui`, `test:hwp-convert-ui`, `test:sample-look-ui`, `test:diagram-exports`, `test:docx-writer`, `test:hwp-convert`, `test:sample-looks`, `test:pdf-look`) are local checks and are not in CI.

## 4. What may fail in CI although it passes here

Checked on this PC (Windows, Node 26):

- Both audits pass today (runtime: 0 vulnerabilities; full lockfile at `--audit-level=critical`: exit 0). 2.7.1 failed its first run on advisories published after the lockfile was made, so run the audits again on release day.
- The unit tests (604) pass with `HANMARK_BROWSER_EXECUTABLE` unset and none is skipped: they do not need Chrome, Word, Pandoc, or private files.

Not checkable here:

- CI uses Node 20. On this PC the full suite (609 tests at that point) and the production build with `check-bundle` were also run with Node 20.20.2 and passed; npm 10 (Node 20's) was not used for `npm ci`.
- macOS and Ubuntu were not run. Tests that compare generated HWPX or DOCX against stored hashes (the 2.7.x form baseline of R-030, determinism tests) were only run on Windows.
- `test:pdf-ui`, `test:toolbar-ui`, and `test:preview-ui` were changed in 3.0.0 (Kordoc stand-ins for new modules) and were only run with this PC's Chrome, not with Playwright's Chromium. `test:preview-ui` asserts a page count that depends on fonts; it needed a fixture fix once already.
- `npm ci --omit=optional` leaves out esbuild's platform package; CI gets the binary through esbuild's install script. Local runs here used `--ignore-scripts` and installed `@esbuild/win32-x64` by hand.

## 4a. Order on release day

1. Push the branch `3.0.0` first and wait until "Verify plugin" passes on Windows, macOS and Ubuntu.
2. Only then push the tag. A failed tag run has to be cleaned up (delete the remote tag, re-tag, push again); a failed branch run costs nothing.
3. Known local flake: right after `npm ci` on Windows, the first test or build run can stop with `esbuild ... spawn UNKNOWN` ("The service was stopped"). Run it again; it has not recurred on a second run.

## 5. After publishing

- Confirm the release shows three assets and is marked Latest, and that `manifest.json` on the default branch reads 3.0.0.
- Install from the Community list on a second vault and open a 2.7.x `data.json` to confirm the form migration.
