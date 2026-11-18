# R-037 — 3.0.0 릴리스 전 마감: 번들 문자열과 최소 앱 버전

- 상태: PARTIAL (1번 CONFIRMED, 8번 사실 확인만, 2~7번 미착수)
- 작성일: 2026-11-18
- 기준 버전/커밋: `3.0.0-dev` 1c79c04, Kordoc 4.25.0
- 관련 문서: R-029, R-033
- 담당 범위: main.js에 남은 OCR 모델 주소 제거, 주소 호스트 허용 목록, 최소 앱 버전 근거

## 1. 조사 질문

1. main.js에 남은 `huggingface.co` 주소 6개를 기존 하드닝 방식으로 없앨 수 있는가? 그 뒤 남는 주소는 무엇이고 왜 있는가?
2. 선언한 최소 버전 Obsidian 1.8.9에서 새 코드가 쓰는 웹 API가 모두 있는가?

## 2. 확인된 사실

### 2-1. OCR 모델 표

1. 주소 6개는 Kordoc `dist/chunk-D7B2LPW5.js`(`// src/ocr/models.ts`)의 모델 표에서 왔다. PDF 파서(`parser-*.js`)가 "모델이 캐시에 있는가"를 묻기 위해 이 모듈을 정적으로 불러온다. 내려받는 코드(`chunk-R76ZCT2Z.js`의 다운로드 경로)는 M1에서 이미 도달할 수 없다(fs 차단, fetch 0).
2. 표에는 주소 6개와 SHA-256 고정값 6개가 있었다. main.js에서 `sha256:"…64자"` 6개, `.onnx` 파일 이름 13곳을 확인했다.
3. 빌드에서 표를 선언한 모듈 하나만 골라 주소와 해시를 빈 문자열로 바꿨다(`blankKordocOcrModelTable`). 매니페스트에 `ocrModelUrls: 6`, `ocrModelHashes: 6`을 넣어 개수가 다르면 빌드가 멈춘다.
4. 바꾼 뒤 main.js: `huggingface` 0건, 해시 고정값 0건, 6,060,211바이트(−638).
5. 모델 파일 이름(`det.onnx` 등)은 남는다. 캐시 조회가 이 이름을 쓰고, HanMark에서는 항상 "없음"으로 답한다(`existsSync`가 늘 false).

### 2-2. main.js에 남은 주소 호스트 (허용 목록)

| 호스트 | 왜 있는가 |
|---|---|
| `www.w3.org`, `schemas.openxmlformats.org`, `schemas.microsoft.com`, `purl.org`, `www.idpf.org` | XML 이름공간과 스키마 식별자 (DOCX, HWPX, SVG, OPF) |
| `www.hancom.co.kr` | HWPX(OWPML) 이름공간 |
| `docx` | docx-preview가 관계 대상을 풀 때 쓰는 자리표시 기준 주소 `http://docx/` |
| `www.hancom.com`, `hangeul.naver.com`, `fonts.google.com` | 글꼴 안내에서 사용자가 눌러 여는 내려받기 링크 |
| `github.com` | 글꼴 안내 링크(Pretendard, 본고딕, 본명조)와 docx-preview 라이선스 고지 |
| `stuk.github.io`, `sheetjs.com` | JSZip 오류 문구 속 문서 주소, cfb crc32 라이선스 고지 |
| `example.com`, `example.workers.dev` | 견본 글과 설정 도움말의 예시 주소 |

`scripts/check-bundle.mjs`가 이 목록 밖의 호스트가 main.js에 있으면 실패한다.

### 2-3. 최소 앱 버전

1. Obsidian 1.8.9 데스크톱(2025-03-05) 설치본은 Electron 34.3.0이다(공식 변경 기록: https://obsidian.md/changelog/2025-03-05-desktop-v1.8.9). Electron 34는 Chromium 131~132다.
2. 그러나 앱 버전과 설치본(Electron) 버전은 따로다. 앱 자동 업데이트는 Electron을 올리지 않는다. Obsidian Typings의 Electron 변경 기록은 업데이트를 받는 최저 설치본을 1.1.9(Electron 21, Chromium 106)로 적고 있다(https://obsidian-typings.github.io/obsidian-typings/public/resources/electron-changelog/, 2026-11-03 확인 표기). 즉 `minAppVersion` 1.8.9는 Chromium 106까지 내려갈 수 있다.
3. 새 코드가 쓰는 API와 필요한 Chromium:

| API | 쓰는 곳 | 필요 버전 | Chromium 106에서 |
|---|---|---|---|
| `WebAssembly.compile` (비동기, 4.1MB) | hayro PDF 엔진 (Kordoc) | 57 | 있음 |
| WebAssembly SIMD128 | hayro | 91 | 있음 |
| `new WebAssembly.Module` (동기, 98KB) | Kordoc XML 파서 | 57, 단 메인 스레드 크기 제한은 미확인 | **미확인** |
| `node:zlib` `inflateRawSync` | hayro 바이트 풀기 | Node (Electron 전 버전) | 있음. `DecompressionStream`은 쓰지 않는다 |
| `canvas.toBlob` | Mermaid PNG | 50 | 있음. `OffscreenCanvas`는 쓰지 않는다 |
| CSS `color-mix()` | styles.css 27곳 | 111 | **없음** |
| CSS `@container` | styles.css 1곳 | 105 | 있음 |

4. `color-mix()` 27곳과 `@container` 1곳은 2.7.1 `styles.css`에도 같은 수로 있다. 3.0.0이 새로 들인 위험이 아니다.

## 3. 해석과 제안

- 변환 엔진 쪽(PDF, XML, 도식)은 Chromium 91 이상이면 필요한 API가 있다. 1.8.9 설치본(Chromium 132)에서는 문제가 없다.
- 오래된 설치본(Electron 21~23)에서는 `color-mix()`가 없어 일부 색이 빠져 보일 수 있다. 2.7.1부터 있던 상태다.
- 동기 `WebAssembly.Module`(98KB)이 옛 Chromium 메인 스레드에서 허용되는지는 실행해 보지 못했다. Obsidian 1.14.5(Electron 43)에서는 M1이 동작을 확인했다.
- 제안(PROPOSED): PDF 가져오기 앞에 능력 검사(WebAssembly와 SIMD 검증 바이트)를 두고, 없으면 "Obsidian 설치본을 새로 받아 주세요"라는 안내를 낸다. 이번에는 구현하지 않았다.

## 4. 이번에 하지 않은 것

시간 제한으로 아래는 착수하지 않았다. 코드 변경 없음.

- 내보내기 창의 Mermaid 스위치 (2번)
- `%% @key`, `@interp`, `@aux` 강조 (3번)
- 인용문 안 도식의 HWPX 배치 확인과 알림 (4번)
- Pandoc DOCX 경로의 도식 가운데 정렬 (5번)
- 내장 DOCX 다듬기: 표 뒤 간격, 각주 안 링크 크기, 목록 줄간격 (6번)
- 모양 고르기 묶음 제목과 키보드 조작 확인 (7번)
- PDF 가져오기 능력 검사 구현 (8번의 뒷부분)

## 5. 검증

- `node esbuild.config.mjs production`: 통과. 하드닝 합계가 매니페스트와 일치
- `scripts/check-bundle.mjs`: 통과 (호스트 허용 목록, 해시 고정값 0건 규칙 추가)
- `scripts/run-tests.mjs`: 548개 통과 (모델 표 테스트 1개 추가)
- eslint, i18n, tsc, check-community, check-release: 통과
- UI 스크립트와 PDF 렌더 테스트는 이번 변경과 무관해 다시 돌리지 않았다.

## 6. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-11-18 | 최초 작성. 1번 구현, 8번 사실 확인 |
