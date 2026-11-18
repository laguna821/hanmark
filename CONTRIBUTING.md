# Contributing to HanMark

HanMark keeps each published line as a historical branch. Do not rewrite, force-push, delete, merge into, or rebase `main`, any published version branch (`1.2.0`, `2.4.2` through `2.6.1`), or any published tag history. Start maintenance work from the latest published commit on a branch named exactly for the next version.

## Research gate

Before planning or implementing a change, read the [Research Register](docs/research/RESEARCH_REGISTER.md) and every applicable R document. Cite the consulted R IDs in the implementation plan and change description. If a materially new question, assumption, source, compatibility constraint, or risk appears, create the next R document from [R-TEMPLATE](docs/research/R-TEMPLATE.md) and update the Register in the same change. Do not mark work complete while an applicable REQUIRED research gate is unmet.

## Development checklist

1. Install with `npm ci --omit=optional`. OCR/ML and native Kordoc extras are deliberately outside the plugin runtime.
2. Keep `kordoc` pinned exactly to `4.25.0` (the version in `KORDOC_HARDENING_MANIFEST` in `esbuild.config.mjs`). An engine upgrade is its own reviewed change: update the manifest counts, `scripts/check-release.mjs`, and a research note together; the build refuses a Kordoc version the manifest has not reviewed.
3. Use Obsidian `Vault`/adapter APIs and browser `File`/`Blob` APIs. Runtime source and `main.js` must not import Node `fs`.
4. Keep Pandoc and the optional Windows Word-to-PDF preview behind explicit user actions. Do not start a shell, network request, or file picker when the plugin loads.
5. Do not add `eval`, `new Function`, clipboard access, CSS `!important`, or optional native modules to the bundle.
6. Add or update characterization tests before changing command IDs, settings migration, toolbar behavior, HTML/DOCX output, or HWPX output.
7. Run `npm run check` on both Windows and macOS. Run `npm audit --omit=dev --omit=optional` for the shipped dependency surface.
8. Inspect `git diff --check`, review the staged diff for secrets and personal paths, and keep commits small and descriptive. Do not squash the release history.
9. Put interface text in `src/i18n`: add the key to `ko.ts` (the source language) and the same key to `en.ts` in Obsidian sentence case, then call `t()`. Text written into documents uses `tOut()` with the output language (R-019). Korean-by-nature data such as font names is marked `i18n-data`; `scripts/check-i18n.mjs` rejects any other Korean literal in `src/`.

`npm run check` includes the official Obsidian lint rules, the interface-language check, tests, TypeScript compilation, the production build, bundle-size/native-module guards, Community review guards, and version/release consistency checks.

Interface changes also run in a browser: `npm run test:pdf-render` and `npm run test:pdf-ui` (Editorial PDF), `npm run test:toolbar-ui` (toolbar, status bar, empty tabs), and `npm run test:preview-ui` (HWPX preview with a real Kordoc render). They load the real `styles.css` and replace only Obsidian's host functions; install Chromium with `npx playwright install chromium` or set `HANMARK_BROWSER_EXECUTABLE` to an installed Chrome. Screenshots are written to `test-artifacts/`. 3.0.0 adds `npm run test:form-ui` (frame and look), `npm run test:import-ui`, `npm run test:check-ui`, `npm run test:hwp-convert-ui`, `npm run test:sample-look-ui`, `npm run test:diagram-exports`, and `npm run test:docx-writer`. Scripts whose npm entry starts with `node --import tsx` must be run through npm or with that flag. Set `HANMARK_BROWSER_EXECUTABLE` to a local Chrome when Playwright's Chromium is not installed. Only `test:pdf-render`, `test:pdf-ui`, `test:toolbar-ui`, and `test:preview-ui` run in CI.

Release tags are published by GitHub Actions. The tag must match `manifest.json`, `package.json`, and `versions.json`. The workflow builds from that tag, attests the outputs, and attaches exactly `main.js`, `manifest.json`, and `styles.css`.

---

# HanMark 기여 안내

HanMark는 공개 버전별 브랜치를 개발 기록으로 보존합니다. `main`, 모든 공개 버전 브랜치(`1.2.0`, `2.4.2`부터 `2.6.1`까지)와 기존 태그를 리베이스·강제 푸시·삭제·덮어쓰기하지 않습니다. 다음 버전 번호와 정확히 같은 새 브랜치에서 작업합니다.

## 조사 참조 게이트

변경을 계획하거나 구현하기 전에 [Research Register](docs/research/RESEARCH_REGISTER.md)와 적용되는 모든 R 문서를 읽습니다. 구현 계획과 변경 설명에 참조한 R 번호를 적습니다. 실질적으로 새로운 질문, 가정, 출처, 호환성 제약, 위험이 생기면 [R-TEMPLATE](docs/research/R-TEMPLATE.md)로 다음 번호의 R 문서를 만들고 같은 변경에서 Register를 갱신합니다. 적용되는 REQUIRED 조사 게이트를 충족하지 않은 작업은 완료로 표시하지 않습니다.

## 개발 확인 항목

1. `npm ci --omit=optional`로 설치합니다. Kordoc의 OCR·ML·네이티브 선택 모듈은 플러그인 런타임에 넣지 않습니다.
2. `kordoc`은 정확히 `4.25.0`(`esbuild.config.mjs`의 `KORDOC_HARDENING_MANIFEST` 버전)로 유지합니다. 엔진 업그레이드는 따로 검토하는 변경입니다. 매니페스트 개수, `scripts/check-release.mjs`, 연구 노트를 함께 고치며, 매니페스트가 검토하지 않은 Kordoc 버전은 빌드가 거부합니다.
3. 파일은 Obsidian `Vault`/adapter와 브라우저 `File`/`Blob` API로 처리합니다. 런타임 소스와 `main.js`에서 Node `fs`를 사용하지 않습니다.
4. Pandoc과 선택적 Windows Word-to-PDF 미리보기는 사용자가 직접 실행한 경우에만 동작해야 합니다. 플러그인 로드 시 셸·네트워크·파일 선택기를 시작하지 않습니다.
5. 번들에 동적 코드 실행, 클립보드 접근, CSS 강제 우선순위, 선택적 네이티브 모듈을 추가하지 않습니다.
6. 명령 ID, 설정 마이그레이션, 툴바, HTML/DOCX, HWPX 동작을 바꾸기 전에 특성 보존 테스트를 추가하거나 갱신합니다.
7. Windows와 macOS에서 `npm run check`를 실행하고, 배포 의존성은 `npm audit --omit=dev --omit=optional`로 확인합니다.
8. `git diff --check`와 staged diff에서 비밀값·개인 경로를 점검하고 작은 설명형 커밋을 남깁니다. 릴리스 이력은 squash하지 않습니다.
9. 화면 문구는 `src/i18n`에 둡니다. 기준 언어인 `ko.ts`에 키를 추가하고 같은 키를 `en.ts`에 Obsidian 문장형 대소문자로 넣은 뒤 `t()`로 부릅니다. 문서 안에 쓰는 글은 출력 언어로 `tOut()`을 씁니다(R-019). 글꼴 이름처럼 본래 한국어인 데이터는 `i18n-data`로 표시하며, `scripts/check-i18n.mjs`는 그 밖의 `src/` 한국어 문자열을 거부합니다.

화면을 바꾸면 브라우저 테스트도 실행합니다. `npm run test:pdf-render`·`npm run test:pdf-ui`(Editorial PDF), `npm run test:toolbar-ui`(툴바·상태 표시줄·빈 탭), `npm run test:preview-ui`(실제 Kordoc 렌더로 HWPX 미리보기)는 실제 `styles.css`를 쓰고 Obsidian 호스트 기능만 대신합니다. `npx playwright install chromium`으로 Chromium을 설치하거나 `HANMARK_BROWSER_EXECUTABLE`에 설치된 Chrome을 지정합니다. 화면 사진은 `test-artifacts/`에 남습니다. 3.0.0에서 `npm run test:form-ui`(틀과 모양), `npm run test:import-ui`, `npm run test:check-ui`, `npm run test:hwp-convert-ui`, `npm run test:sample-look-ui`, `npm run test:diagram-exports`, `npm run test:docx-writer`가 추가됐습니다. npm 항목이 `node --import tsx`로 시작하는 스크립트는 npm으로 실행하거나 그 플래그를 붙여 실행합니다. Playwright의 Chromium이 없으면 `HANMARK_BROWSER_EXECUTABLE`에 설치된 Chrome 경로를 지정합니다. CI에서는 `test:pdf-render`, `test:pdf-ui`, `test:toolbar-ui`, `test:preview-ui`만 실행합니다.

버전 태그를 푸시하면 GitHub Actions가 태그 소스를 다시 검증·빌드하고 산출물을 증명한 뒤 `main.js`, `manifest.json`, `styles.css` 세 파일만 Release에 첨부합니다.
