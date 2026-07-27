# Contributing to HanMark

HanMark keeps each published line as a historical branch. Do not rewrite, force-push, delete, merge into, or rebase `main`, any published version branch (`1.2.0`, `2.4.2` through `2.5.4`), or any published tag history. Start maintenance work from the latest published commit on a branch named exactly for the next version.

## Development checklist

1. Install with `npm ci --omit=optional`. OCR/ML and native Kordoc extras are deliberately outside the plugin runtime.
2. Keep `kordoc` pinned exactly to `4.2.5` unless a dedicated engine-upgrade release has been approved and tested.
3. Use Obsidian `Vault`/adapter APIs and browser `File`/`Blob` APIs. Runtime source and `main.js` must not import Node `fs`.
4. Keep Pandoc and the optional Windows Word-to-PDF preview behind explicit user actions. Do not start a shell, network request, or file picker when the plugin loads.
5. Do not add `eval`, `new Function`, clipboard access, CSS `!important`, or optional native modules to the bundle.
6. Add or update characterization tests before changing command IDs, settings migration, toolbar behavior, HTML/DOCX output, or HWPX output.
7. Run `npm run check` on both Windows and macOS. Run `npm audit --omit=dev --omit=optional` for the shipped dependency surface.
8. Inspect `git diff --check`, review the staged diff for secrets and personal paths, and keep commits small and descriptive. Do not squash the release history.

`npm run check` includes the official Obsidian lint rules, tests, TypeScript compilation, the production build, bundle-size/native-module guards, Community review guards, and version/release consistency checks.

Release tags are published by GitHub Actions. The tag must match `manifest.json`, `package.json`, and `versions.json`. The workflow builds from that tag, attests the outputs, and attaches exactly `main.js`, `manifest.json`, and `styles.css`.

---

# HanMark 기여 안내

HanMark는 공개 버전별 브랜치를 개발 기록으로 보존합니다. `main`, 모든 공개 버전 브랜치(`1.2.0`, `2.4.2`부터 `2.5.4`까지)와 기존 태그를 리베이스·강제 푸시·삭제·덮어쓰기하지 않습니다. 다음 버전 번호와 정확히 같은 새 브랜치에서 작업합니다.

## 개발 확인 항목

1. `npm ci --omit=optional`로 설치합니다. Kordoc의 OCR·ML·네이티브 선택 모듈은 플러그인 런타임에 넣지 않습니다.
2. 별도의 엔진 업그레이드 검증이 없는 한 `kordoc`은 정확히 `4.2.5`로 유지합니다.
3. 파일은 Obsidian `Vault`/adapter와 브라우저 `File`/`Blob` API로 처리합니다. 런타임 소스와 `main.js`에서 Node `fs`를 사용하지 않습니다.
4. Pandoc과 선택적 Windows Word-to-PDF 미리보기는 사용자가 직접 실행한 경우에만 동작해야 합니다. 플러그인 로드 시 셸·네트워크·파일 선택기를 시작하지 않습니다.
5. 번들에 동적 코드 실행, 클립보드 접근, CSS 강제 우선순위, 선택적 네이티브 모듈을 추가하지 않습니다.
6. 명령 ID, 설정 마이그레이션, 툴바, HTML/DOCX, HWPX 동작을 바꾸기 전에 특성 보존 테스트를 추가하거나 갱신합니다.
7. Windows와 macOS에서 `npm run check`를 실행하고, 배포 의존성은 `npm audit --omit=dev --omit=optional`로 확인합니다.
8. `git diff --check`와 staged diff에서 비밀값·개인 경로를 점검하고 작은 설명형 커밋을 남깁니다. 릴리스 이력은 squash하지 않습니다.

버전 태그를 푸시하면 GitHub Actions가 태그 소스를 다시 검증·빌드하고 산출물을 증명한 뒤 `main.js`, `manifest.json`, `styles.css` 세 파일만 Release에 첨부합니다.
