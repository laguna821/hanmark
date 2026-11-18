# R-037 — 3.0.0 릴리스 전 마감: 번들 문자열, "내보낼 때" 스위치, 도식 강조 주석

- 상태: REQUIRED (1~6절 CONFIRMED, 7절은 다른 작업으로 넘김)
- 작성일: 2026-11-18
- 최종 갱신: 2026-11-18
- 기준 버전/커밋: `3.0.0-dev` 79cf755, Kordoc 4.25.0, Pele 1.13.0
- 관련 문서: R-029, R-033, R-034, R-036
- 담당 범위: main.js에 남은 OCR 모델 주소 제거와 호스트 허용 목록, 내보내기 창 스위치, `%% @key`·`@interp`·`@aux`, 인용 안 도식 알림, 모양 고르기 키보드, 최소 앱 버전 근거

## 1. 조사 질문

1. main.js에 남은 `huggingface.co` 주소를 기존 하드닝 방식으로 없앨 수 있는가? 그 뒤 남는 주소는 무엇인가?
2. Mermaid·메모·수식 선택을 사용자가 내보내는 자리에서 고르게 하되, 빠른 내보내기·미리보기·여러 양식 내보내기가 같은 값을 따르게 하려면 어디에 값을 둬야 하는가?
3. achmage-pele 스킬의 핵심·해석·보조 노드 주석을 HanMark 도식 단계에서 스킬과 같게 그릴 수 있는가?
4. Kordoc 4.25.0은 인용문·콜아웃 안에 그림을 넣을 수 있는가?
5. 선언한 최소 버전 Obsidian 1.8.9에서 새 코드가 쓰는 웹 API가 모두 있는가?

## 2. 번들 문자열 (CONFIRMED)

1. 주소 6개는 Kordoc `dist/chunk-D7B2LPW5.js`(`// src/ocr/models.ts`)의 모델 표에서 왔다. PDF 파서가 "모델이 캐시에 있는가"를 묻기 위해 이 모듈을 정적으로 불러온다. 내려받는 코드는 M1에서 이미 도달할 수 없다.
2. 빌드에서 표를 선언한 모듈 하나만 골라 주소 6개와 SHA-256 고정값 6개를 빈 문자열로 바꾼다(`blankKordocOcrModelTable`). 매니페스트 `ocrModelUrls: 6`, `ocrModelHashes: 6`과 개수가 다르면 빌드가 멈춘다.
3. 모델 파일 이름(`det.onnx` 등)은 남는다. 캐시 조회가 이 이름을 쓰고 HanMark에서는 항상 "없음"으로 답한다.
4. `scripts/check-bundle.mjs`는 아래 목록 밖의 http(s) 호스트나 64자 해시 고정값이 main.js에 있으면 실패한다.

| 호스트 | 왜 있는가 |
|---|---|
| `www.w3.org`, `schemas.openxmlformats.org`, `schemas.microsoft.com`, `purl.org`, `www.idpf.org` | XML 이름공간과 스키마 식별자 |
| `www.hancom.co.kr` | HWPX(OWPML) 이름공간 |
| `docx` | docx-preview의 자리표시 기준 주소 `http://docx/` |
| `www.hancom.com`, `hangeul.naver.com`, `fonts.google.com` | 글꼴 안내에서 사용자가 눌러 여는 링크 |
| `github.com` | 글꼴 안내 링크와 docx-preview 라이선스 고지 |
| `stuk.github.io`, `sheetjs.com` | JSZip 오류 문구, cfb crc32 라이선스 고지 |
| `example.com`, `example.workers.dev` | 견본 글과 설정 도움말의 예시 주소 |

## 3. "내보낼 때" 스위치 (CONFIRMED)

### 3-1. 사실

1. Mermaid 도식(`mermaidDiagrams`)과 메모(`commentsAsMemos`)는 이미 저장된 설정을 생성 단계 한 곳에서 읽고 있었다. HWPX는 `kordocSave.ts`의 `generateBody` 하나가 내보내기 창, 빠른 내보내기 명령, 여러 양식 내보내기를 모두 처리한다.
2. 수식 개체(`GenerateHwpxOptions.inlineMath`, R-036)는 엔진 옵션만 있고 켜는 곳이 없었다.
3. 창마다 따로 값을 두면 창에서 고른 값과 빠른 내보내기·미리보기가 어긋난다.

### 3-2. 결정

- **스위치 하나 = 저장된 설정 하나.** 내보내기 창의 "내보낼 때" 묶음과 설정 탭은 같은 값을 바꾸는 두 자리다. 창에서 바꾸면 바로 저장하고 미리보기를 다시 그린다.
- 새 설정 `hwpxEquations`(기본 꺼짐)를 추가했다. HWPX 생성(`generateBody`)과 HWPX 미리보기가 읽는다. 미리보기 캐시 키에도 넣었다.
- 형식별 스위치 목록은 `src/io/exportSwitches.ts` 한 곳에 있다.

| 스위치 | 설정 키 | 기본 | 보이는 형식 |
|---|---|---|---|
| Mermaid 도식을 그림으로 | `mermaidDiagrams` | 켬 | HWPX, DOCX, HTML, PDF |
| 주석을 한글 메모로 | `commentsAsMemos` | 끔 | HWPX |
| 수식을 한글 수식 개체로 | `hwpxEquations` | 끔 | HWPX (빠른, 공문서) |

- 끄면 그 스위치가 없던 때와 같은 바이트가 나온다. 엔진 옵션은 켰을 때만 넘긴다(`tests/exportSwitches.test.ts`).
- 내 견본으로 만드는 문서(R-036)는 엔진이 수식 옵션을 받지 않는다. 설명 문구에 적었다.

### 3-3. 함께 고친 것

- 모양 고르기 목록이 내보내기 단추를 덮지 않게 했다. 창이 `data-hanmark-picker-floor`로 표시한 요소(내보내기 창의 아래 단추 줄) 위에서 아래쪽 여유를 끝낸다. 스위치 묶음으로 창이 길어지자 목록이 아래로 열리며 단추를 덮는 것을 UI 스크립트가 잡았다.
- UI 검증 도구 세 개(`test-gongmun-form-ui`, `test-pdf-export-ui`, `test-preview-ui`)가 79cf755에서 빌드되지 않았다. 견본 모양 모듈(R-036)이 가져오는 Kordoc 이름이 도구의 대역에 없어서다. 대역에 이름을 채웠다.

### 3-4. 한계

- HWPX 미리보기는 메모를 그리지 않는다. 메모 스위치를 켜도 미리보기 본문은 같다(주석은 원래 본문에 나오지 않는다).
- DOCX 미리보기는 `refreshPreviews`로 다시 그려지지만 이번에 브라우저에서 따로 확인하지는 않았다.

## 4. 도식 강조 주석 (CONFIRMED)

1. 스킬 런타임(`runtime/render.mjs`의 `decorate`, `runtime/brand.mjs`의 `semanticCSS`)은 `pele-node`이면서 `data-id`가 주석의 ID와 같은 묶음이 **정확히 하나**일 때 클래스를 붙이고, 그 묶음의 직계 도형만 칠한다.

| 주석 | 대상 도형 | 처리 |
|---|---|---|
| `%% @key` | rect, path, polygon | 테두리 = 강조색, 굵기 3 |
| `%% @interp` | rect, polygon | 점선 5 3 |
| `%% @aux` | rect, polygon | 채움 = 보조 바탕색 |

2. HanMark는 같은 규칙을 색을 글자 값으로 푼 SVG에 속성으로 쓴다(`applyDiagramRoles`). 스타일시트가 없어도 PNG·HTML·PDF에서 같게 보인다. 묶음에는 `hanmark-diagram-key` 같은 클래스를 붙인다.
3. 하나로 정할 수 없는 ID(없는 ID, 여러 노드에 걸린 ID)는 강조하지 않고 내보내기 보고서에 건수와 함께 한 번 알린다(`diagram-role`). 예: 순서도의 참여자는 위아래 두 번 그려져 대상이 아니다.
4. 노드 ID가 없는 도식 종류(gantt 등)는 주석을 조용히 무시한다. 주석이 없으면 SVG가 그대로다.
5. 대조: 같은 원문(`tmp/m8-shots/roles-source.mmd`)을 스킬 렌더러(Pele 1.6.0, `scripts/render-diagram.mjs --profile report`)와 HanMark(Pele 1.13.0)로 그려 노드별 처리를 비교했다. 같은 노드에 같은 처리가 붙었다. 스킬은 클래스와 CSS, HanMark는 속성이라는 점만 다르다. 배치와 화살표 모양은 Pele 버전 차이로 다를 수 있다.

## 5. 인용문·콜아웃 안의 도식 (CONFIRMED)

1. Kordoc 4.25.0 `markdownToHwpx`에 인용문 안 그림을 주면 그림 개체가 0개다. 대체 글자만 남는다(빠른 문서), 또는 `![…](…)` 원문이 글자로 남는다(공문서). 콜아웃도 같다. 최상위와 목록 안 그림은 1개가 들어간다.
2. 그래서 HWPX에서는 지금처럼 도식을 그 자리에서 인용문 밖 문단으로 꺼낸다. 인용문은 그림 앞뒤로 나뉜다.
3. 이제 꺼낸 건수를 보고서에 한 번 알린다(`diagram-moved`). DOCX·HTML·PDF는 인용 안에 그대로 두므로 알림이 없다.
4. 엔진이 인용 안 그림을 지원하게 되면 `tests/diagramStage.test.ts`의 "records the engine limit" 테스트가 실패해 알려 준다.

## 6. 모양 고르기 (CONFIRMED)

- 묶음 제목은 `부`, `처`, `청`, `위원회`, `그 밖의 기관` 다섯이고 각각 "N곳"을 보인다. 합이 52다. 고칠 것이 없었다.
- 키보드: 단추에서 Enter로 열면 검색 칸에 초점이 가고 지금 고른 모양에서 시작한다. 위·아래 화살표로 옮기면 그 줄이 보이게 스크롤된다. 글자를 치면 걸러지고 첫 결과가 활성이 된다. Enter로 고르고, Esc는 목록만 닫고 단추로 초점을 돌려준다. `scripts/test-gongmun-form-ui.mjs`에 넣었다. 고칠 것이 없었다.

## 7. 최소 앱 버전 (사실만; 구현은 다른 작업)

1. Obsidian 1.8.9 데스크톱(2025-03-05) 설치본은 Electron 34.3.0, Chromium 131~132다(https://obsidian.md/changelog/2025-03-05-desktop-v1.8.9).
2. 앱 자동 업데이트는 Electron을 올리지 않는다. 업데이트를 받는 최저 설치본은 1.1.9(Electron 21, Chromium 106)로 기록돼 있다(https://obsidian-typings.github.io/obsidian-typings/public/resources/electron-changelog/).

| API | 쓰는 곳 | 필요 Chromium | 106에서 |
|---|---|---|---|
| `WebAssembly.compile` (비동기, 4.1MB) | hayro PDF 엔진 | 57 | 있음 |
| WebAssembly SIMD128 | hayro | 91 | 있음 |
| `new WebAssembly.Module` (동기, 98KB) | Kordoc XML 파서 | 57, 메인 스레드 크기 제한 미확인 | 미확인 |
| `node:zlib` `inflateRawSync` | hayro 바이트 풀기 | Node | 있음 |
| `canvas.toBlob` | Mermaid PNG | 50 | 있음 |
| CSS `color-mix()` | styles.css 27곳 | 111 | 없음 (2.7.1에도 같은 27곳) |
| CSS `@container` | styles.css 1곳 | 105 | 있음 |

3. PDF 가져오기 앞의 능력 검사, DOCX 다듬기, Pandoc 경로의 도식 가운데 정렬은 다른 작업(M11)이 맡는다.

## 8. 미해결

- 한컴오피스와 실제 Obsidian 화면에서 스위치, 강조 노드, 수식 개체를 확인하지 않았다. 브라우저 검증 도구로만 확인했다.
- 강조 노드의 PNG는 사용자 볼트 색(강조 `#016CC3`)과 맑은 고딕으로 그린 견본이다. 실제 내보내기는 노트 글꼴을 쓴다.
- 순서도 참여자처럼 두 번 그려지는 노드를 `@key`로 강조하려면 스킬과 규칙을 함께 정해야 한다.

## 9. 검증

- `scripts/run-tests.mjs`: 594개 통과
- eslint, check-i18n(1,717키), tsc, 프로덕션 빌드, check-bundle(6,196,150바이트), check-community, check-release: 통과
- UI 스크립트 7개(`test-gongmun-check-ui`, `test-gongmun-form-ui`, `test-hwp-convert-ui`, `test-import-ui`, `test-pdf-export-ui`, `test-preview-ui`, `test-toolbar-ui`), `test-diagram-exports`(합성 견본), `test-editorial-pdf-render`, `test-docx-writer`: 통과
- 증거 그림: 세션 임시 폴더 `m8-shots` (`09-export-window-switches-hwpx.png`, `10-export-window-switches-docx.png`, `roles-before-no-annotations.png`, `roles-after-key-interp-aux.png`, `roles-skill-renderer.svg`)

## 10. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-11-18 | 최초 작성. 번들 문자열 구현, 최소 버전 사실 확인 |
| 2026-11-18 | "내보낼 때" 스위치, 도식 강조 주석, 인용 밖 도식 알림, 모양 고르기 키보드 검증. DOCX 다듬기와 능력 검사는 M11로 넘김 |

## 부록 A. 동기 WebAssembly 컴파일 한도와 최소 버전 판정 (2026-11-18, M11)

### 확인한 사실

1. Chromium은 메인 스레드의 동기 컴파일(`new WebAssembly.Module`)에 크기 한도를 둔다. 한도는 `third_party/blink/renderer/bindings/core/v8/v8_initializer.cc`의 `kWasmWireBytesLimit`이다. 태그별 소스를 직접 읽었다.

| Chromium | `kWasmWireBytesLimit` | 오류 문구 |
|---|---|---|
| 106, 108, 110, 112, 114 | `1 << 12` (4KB) | "…larger than 4KB" |
| 115, 116, 117, 118, 119, 120, 132 | `1 << 23` (8MB) | "…larger than 8MB" |

2. Kordoc 4.25.0의 XML 파서는 98KB 모듈을 동기로 컴파일한다(`dist/chunk-2DTBVHQD.js`의 `new WebAssembly.Module(...)`). 4KB 한도에서는 `RangeError`가 난다.
3. 따라서 Chromium 114 이하, 곧 **Electron 25 이하 설치본**에서는 HWPX·DOCX·PPTX·XLSX 읽기와 HWPX 생성이 모두 실패한다. Electron 26(Chromium 116)부터는 된다.
4. hayro PDF 엔진(4.1MB)은 비동기 `WebAssembly.compile`을 쓰므로 한도와 무관하다. 다만 PDF 경로도 XML 파서 청크를 함께 쓰므로 같은 조건으로 묶었다.
5. Obsidian 1.8.9 설치본은 Electron 34(Chromium 131~132)라 문제가 없다. 문제가 되는 것은 Electron 25 이하의 옛 설치본에서 앱만 자동 업데이트한 경우다.

### 판정

- `minAppVersion` 1.8.9는 **유지할 수 있다.** 이 값은 앱 버전만 가리고 설치본(Electron)은 가리지 못하므로, 값을 올려도 옛 설치본 문제는 막지 못한다.
- 대신 실행 중 검사를 넣었다(`src/io/engineCapability.ts`). 4KB보다 큰 빈 모듈(8KB)을 동기 컴파일해 본다.
  - 플러그인이 켜질 때 한 번 검사하고, 안 되면 닫히지 않는 알림으로 "Obsidian 설치 프로그램을 새로 받아 설치하세요"를 보여 준다.
  - 문서 가져오기, HWPX 생성, 도식 그림 변환 직전에도 검사해 엔진 예외 대신 같은 안내를 낸다.
- 릴리스 노트에 "Obsidian 설치본이 2023년 중반 이전 것이면 설치 프로그램을 새로 받아야 한다"는 문장을 넣을 것을 권한다.

### 한계

- 옛 Electron에서 실제로 실행해 보지는 않았다. 근거는 Chromium 소스의 한도 값과, 한도를 흉내 낸 단위 테스트다.
- 2.7.1(Kordoc 4.15.7, xmldom)은 이 한도와 무관했다. 3.0.0에서 새로 생기는 조건이다.
