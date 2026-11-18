# R-029 — Kordoc 4.15.7 → 4.25.0 엔진 이식과 hayro PDF 엔진 내장

- 상태: REQUIRED (M1 사실은 CONFIRMED, 5절의 고정값 해제와 7절 항목은 PROPOSED)
- 작성일: 2026-11-18
- 최종 갱신: 2026-11-18
- 기준 버전/커밋: HanMark 2.7.1 39fff65 → 작업 브랜치 `trial-kordoc-4.25`, Kordoc npm 4.25.0 (2026-11-18 배포)
- 관련 문서: R-018(4.15.7 이식), R-015(의존성 권고), R-020(불러오기 계약), R-022(공문서 계약), R-023(비교·양식)
- 담당 범위: 엔진 버전 고정, esbuild 하드닝 재작성, PDF 엔진 내장, 번들·릴리스 검사, 엔진 기본값 변화의 고정

## 1. 조사 질문

HanMark의 오프라인·결정적 변환 계약과 Community 심사 조건을 지키면서 Kordoc을 4.15.7에서 4.25.0으로 올리려면 무엇을 바꿔야 하는가. 그리고 기존 사용자가 보는 결과를 바꾸지 않으려면 어떤 엔진 기본값을 고정해야 하는가.

## 2. 범위

### 포함

- `package.json`·lockfile의 Kordoc 고정, `overrides` 재평가
- `esbuild.config.mjs`의 Kordoc 소스 변환(한컴 자동화, OCR, 선택 모듈, wasm), 하드닝 매니페스트
- hayro PDF 엔진(wasm) 내장과 PDF.js·한국어 CMap 주입 제거
- `scripts/check-bundle.mjs`·`check-release.mjs`·`check-i18n.mjs`, 하드닝 테스트
- 엔진 기본값이 바뀐 경로의 고정(불러오기, 공문서 생성, 저장)
- 제3자 고지

### 제외

- 새 기능과 새 화면(서울방침 양식 목록, 기관 서식, PPTX, HWP → HWPX 변환, 검수 확장 등). 각각 별도 R 문서로 등록한다.
- 플러그인 버전, CHANGELOG, 릴리스 노트, 워크플로 변경.
- 실제 문서 회귀 코퍼스와 한컴 실표시 확인(7절).

## 3. 조사 방법과 증거

| 증거 | 유형 | 재현 또는 위치 | 신뢰도/한계 |
|---|---|---|---|
| npm 배포본 4.15.7·4.25.0 | 외부 | `npm pack kordoc@…`, `dist/index.d.ts`를 TypeScript 검사기로 비교 | 높음 |
| 설치된 dist 모듈 그래프 | 소스 | `node_modules/kordoc/dist/index.js`에서 정적·동적 import를 따라간 결과 | 높음(청크 해시 이름은 판마다 바뀜) |
| 빌드·검사 실행 | 재현 | 9절의 명령 | Windows, Node 26.5, npm, esbuild 0.28.1 |
| 하드닝된 번들 실행 | 재현 | `tests/hayroWasm.test.ts`, `tests/buildHardening.test.ts` (`tests/helpers/hardenedKordocBundle.ts`) | 높음(Node에서 실행) |
| 실제 Obsidian 렌더러 | 재현 | Obsidian 1.14.5 (Electron 43.8.3, Chrome 150)에서 `hayro-pdf.wasm` 4,124,364바이트를 동기·비동기로 컴파일·인스턴스화 | 이 판 하나만 확인 |
| 4.15.7과 출력 비교 | 재현 | 같은 Markdown을 두 판으로 공문서 HWPX 생성 후 표 수·쪽 나눔 수·글 순서 비교 | 거친 비교(글꼴·치수는 비교하지 않음) |
| Kordoc CHANGELOG 4.16.0~4.25.0 | 외부 | `chrisryugj/kordoc` CHANGELOG.md | 높음 |

## 4. 확인된 사실

### 4-1. API와 의존성

1. 공개 함수는 87개에서 114개가 됐다. 삭제·이름 변경은 0개다. HanMark가 쓰는 API 33개는 모두 남아 있고 `parse`, `markdownToHwpx`, `patchHwpx`, `renderHwpxToSvg`, `renderDocumentToScene`, `diffBlocks`의 시그니처는 같다.
2. 타입 오류는 2건이었다. `GongmunPreset`에 `bangchim`(서울방침, 4.16.1)이 추가돼 `Record<GongmunPreset, …>` 표 두 곳(`gongmunOutline.ts`, `gongmunProperties.ts`)이 맞지 않았다. 번호 체계는 Kordoc `PRESET_DEFAULTS`대로 `report`, 한글 이름은 `서울방침`으로 넣었다. 양식 목록(화면)에는 넣지 않았다.
3. Kordoc 4.25.0의 런타임 의존성은 `@modelcontextprotocol/sdk ^1.32.0`, `cfb`, `commander`, `jszip`, `markdown-it ^14.3.3`, `zod ^4.6.7`이다. `@xmldom/xmldom`은 빠졌다(4.24.60, quick-xml wasm).
4. 2.7.1의 `overrides` 14개 중 12개를 없앴다(`adm-zip`, `body-parser`, `fast-uri`, `hono`, `@hono/node-server`, `ip-address`, `@modelcontextprotocol/sdk`, `protobufjs`, `proxy-addr`, `qs`, `sharp`, `zod`). Kordoc이 고친 판을 직접 요구하거나 더 이상 설치되지 않는다. 남은 것은 `esbuild`, `moment`다. `npm audit --omit=dev --omit=optional`은 0건이다.
5. `pdfjs-dist`는 런타임 의존성에서 빠지고 개발 의존성으로 옮겼다. `src`는 PDF.js를 import하지 않고, `scripts/test-editorial-pdf-render.mjs`만 내보낸 PDF를 다시 읽는 데 쓴다.

### 4-2. 하드닝 (매니페스트 개수)

`KORDOC_HARDENING_MANIFEST`는 번들에 들어가는 Kordoc 파일 전체의 변환 합계다. 하나라도 다르면 빌드가 멈춘다.

| 키 | 값 | 내용 |
|---|---|---|
| `cfbLoaders` | 3 | `createRequire("cfb")` 로더: HWP 5 파서, HWP 5 패처, HWP 5 → HWPX 변환기(신규) |
| `comHelpers` | 1 | `src/hwpx/com-fallback.ts` 청크를 프로세스 없는 스텁으로 교체 |
| `comBranches` | 2 | DRM·배포용 호출 지점: HWPX 파서, HWP 5 파서 |
| `comImports` | 2 | COM 헬퍼 이름을 가져오던 import 목록 |
| `hancomBranches` | 1 | `convertToHwpx()`의 `engine: "hancom"`/`"auto"` 분기 |
| `hancomModules` | 0 | 한컴 저장 모듈(`hancom-*.js`)이 그래프에 들어오면 안 됨 |
| `hayroWasmLoaders` | 1 | `hayro-pdf.wasm` 파일·네트워크 로더를 내장 바이트로 교체 |
| `wasmAssetLookups` | 2 | `createRequire(…).resolve("*.wasm")` 읽기: QR 리더, HWP 5 쓰기 |
| `xmlWasmDecoders` | 1 | quick-xml wasm의 `atob` 해독을 `Buffer`로 교체 |
| `ocrLoaders` | 5 | OCR 청크의 지연 import: 삽입 그림 OCR, 이미지 파일 입력, 수식 OCR, PDF 쪽 OCR 2곳 |

6. 4.15.7용 치환은 4.25.0에서 다음과 같이 깨졌다. COM 헬퍼가 별도 청크(`chunk-W252FN42.js`)로 분리됐고 `execFileSync`가 `execFile`+`promisify`가 됐다. 가드 조건이 `isComFallbackAvailable(options)`로 바뀌었다. 한컴 저장 엔진이 동적 import 청크(`hancom-FH2TJVXG.js`)로 새로 생겼다. PDF.js 자산 탐색 블록은 사라졌다.
7. 모듈 이름 지우기에 버그가 있었다. 4.25.0에는 일반 따옴표 문자열 안에 `'sharp'`가 들어 있다(`"… optional dependency 'sharp' 가 …"`). 큰따옴표로 바꾸면 문법이 깨지므로 원래 따옴표를 유지하게 고쳤다. 시험 중에는 치환 문자열 `$1`이 글자 그대로 들어가는 실수도 테스트가 잡았다.
8. OCR은 2.7.x까지 "번들에 남지만 호출 경로가 없는" 상태였다. 이제 지연 import 5곳을 거절 프라미스로 바꿔 OCR 엔진, 모델 내려받기(`fetch`), 모델 캐시 코드가 번들에 들어오지 않는다. 2.7.1 `main.js`의 `fetch(` 10건이 0건이 됐다.
9. PDF 파서가 OCR 모델 캐시 확인 함수를 정적으로 import해서, 파일시스템 차단 shim에 이름 두 개(`readlinkSync`, `readdir`)만 더했다. 실제 `fs` import는 0건이다.
10. 최종 `main.js`에서 `child_process`는 1건(HanMark의 `node:child_process`, 사용자가 실행하는 Pandoc 경계)이다. `HWPFrame`, `Hwp.Application`, `execFile`, `extractTextViaCom`, `hwpToHwpxViaHancom`은 0건이다. `powershell`은 1건인데 Kordoc 것이 아니라 2.7.1에도 있던 HanMark의 Word 미리보기(`executable: "powershell.exe"`, 사용자 실행 경계)다. `check-bundle.mjs`가 이 1건만 허용한다.
11. OCR 모델 표의 주소 문자열(`huggingface.co`) 6건은 데이터로 남아 있다. PDF 파서가 정적으로 가져오는 모델 표이며, 이를 내려받는 코드는 번들에 없다.

### 4-3. hayro PDF 엔진

12. Kordoc 4.24.82가 PDF 글 추출 엔진을 PDF.js에서 hayro(Rust, wasm)로 바꿨다. `dist/hayro-pdf.wasm`은 4,124,364바이트, SHA-256 `5da10f8423f48d6c40236f49db956afac25e160e170f80c957cebfd2a7e187e5`다.
13. Kordoc의 로더는 `new URL("./hayro-pdf.wasm", import.meta.url)`을 Node에서는 `fs`로 읽고 브라우저에서는 `fetch`한다. 둘 다 `main.js` 안에서는 쓸 수 없다.
14. HanMark는 wasm을 raw DEFLATE(1,686,184바이트) 뒤 base64(2,248,248자)로 `src/io/hayroWasmData.ts`에 넣고, 로더를 `src/io/hayroWasm.ts`의 `hayroWasmBytes()`로 바꿨다. 풀 때는 `node:zlib`의 `inflateRawSync`를 쓴다.
15. 데이터 파일은 커밋한다. `scripts/gen-hayro-wasm.mjs`는 파일이 설치된 wasm으로 풀리면 다시 쓰지 않는다. 압축 결과는 zlib 빌드(운영체제·CPU)에 따라 달라질 수 있으므로, 이렇게 해야 같은 커밋이 어디서나 같은 `main.js`를 만든다. 빌드는 설치된 wasm, 매니페스트(`KORDOC_HAYRO_WASM`), 데이터 파일의 SHA-256이 모두 같은지 확인한다.
16. 하드닝된 번들에서 KSCms-UHC-H 인코딩 시험 PDF(`tests/fixtures/koreanCMapPdf.ts`)가 CMap 파일 없이 "한글 PDF"로 읽혔다. hayro가 CMap을 자체 내장한다. 그래서 한국어 CMap 24개 주입(`src/io/pdfCMaps.ts`, `pdfCMapData.ts`, `scripts/gen-pdf-cmaps.mjs`)과 PDF.js 소스 하드닝을 지웠다.
17. quick-xml wasm(Kordoc 안 base64)은 번들에서 동기 컴파일로 뜬다. HWPX 생성 → 검증 → 다시 읽기 → SVG 렌더가 번들 안에서 통과했다.
18. WebAssembly는 `main.js` 안 바이트에서만 컴파일한다. `check-bundle.mjs`가 `WebAssembly.Module`, `Instance`, `compile`, `RuntimeError`만 허용하고, 네트워크 응답을 받는 스트리밍 API가 보이면 실패한다.
19. 실제 Obsidian 1.14.5 렌더러에서 4.1MB wasm의 동기 컴파일(`new WebAssembly.Module`)과 동기 인스턴스화가 됐다. `node:zlib`도 쓸 수 있었다.

### 4-4. 번들 크기

| 시점 | `main.js` 바이트 |
|---|---|
| 2.7.1 (Kordoc 4.15.7) | 4,262,290 |
| 4.25.0, hayro 내장 전 | 약 2,973,000 |
| 4.25.0, hayro 내장 | 5,221,758 |

20. 패키지별 크기(esbuild 메타파일): hayro 데이터 2,248,287, Kordoc 1,679,652, HanMark 소스 857,102, docx-preview 77,330, @xmldom/xmldom 63,645, entities 56,913, markdown-it 52,458, pako 46,507, jszip 43,623, cfb 33,978, 나머지 약 60,000.
21. PDF.js, 한국어 CMap, OCR 코드가 빠져 엔진 코드는 줄었다. 늘어난 약 96만 바이트는 내장 PDF 엔진 때문이다. 상한은 5,380,000바이트(실측 +약 3%)로 올렸다. 사용자 결정(2026-11-18): 번들 크기는 문제 삼지 않는다.
22. 같은 소스로 두 번 빌드한 `main.js`는 바이트까지 같았다.

### 4-5. HanMark 후처리와의 관계

23. 각주 번호 제어(`hp:autoNum`)는 Kordoc 4.16.0부터 엔진이 직접 넣는다. HanMark의 `addFootnoteAutoNumbers`는 이미 있으면 건너뛰므로 4.25.0 출력에서는 0개를 더한다. 제어가 없는 꾸러미를 고치는 방어 코드로 남겼다.
24. `version.xml`은 Kordoc 4.24.62부터 엔진이 `mimetype` 바로 뒤에 넣는다. HanMark의 꾸러미 마감은 원래 순서대로 옮기므로 중복되거나 순서가 바뀌지 않는다. 같은 입력의 HWPX는 두 번 만들어도 바이트가 같다.
25. 긴 표 머리행 반복은 4.25.0에도 없다. HanMark 후처리를 그대로 둔다. ZIP 날짜 고정도 그대로다.

## 5. 해석과 제안

### 5-1. 강제값 (오프라인 계약)

`kordocParseOptions()`가 모든 `parse()` 호출(불러오기, 비교, 양식)에 덧씌운다. 호출하는 쪽이 켤 수 없다.

| 옵션 | 값 | 이유 |
|---|---|---|
| `hancomFallback` | `false` | 한컴 오피스를 띄우지 않는다. 코드도 번들에서 지웠다. |
| `ocr` | `false` | 4.25.0은 이미지 입력과 모델이 캐시된 스캔 쪽에서 OCR을 스스로 켠다. |

### 5-2. 고정값 (4.15.7 결과 유지, 나중에 풀지 결정)

| # | 위치 | 고정 | 4.25.0 기본 | 풀면 달라지는 것 |
|---|---|---|---|---|
| 1 | `parse` | `layoutTables: "keep"` | `"visual"` (4.17.0) | 테두리 없는 틀 표가 글로 풀리고 분수가 `$\frac{}{}$`가 된다. 저장·양식 경로는 계속 `"keep"`이어야 한다. |
| 2 | `parse` | `scriptTags: false` | HWP·HWPX·DOCX 켬 (4.16.2) | 위·아래첨자가 `<sup>`·`<sub>`로 나온다. |
| 3 | 공문서 | `totalRow: "keep"` | `"top"` (4.23.0) | 합계 행이 머리행 바로 아래로 옮겨진다. |
| 4 | 개조식, 표지 없음 | `bodyTitleBox: false` | 켬 (4.25.0) | 첫 `#`이 장 Ⅰ이 아니라 제목 상자가 된다. |
| 5 | 개조식, 표지 없음 | `toc: true` | 표지를 따름 (4.25.0) | 표지가 없으면 목차 쪽이 사라진다. |
| 6 | 저장(HWPX) | `structure: false` | `true` (4.22.15) | 문단 추가·삭제가 건너뛰어지지 않고 반영된다. |
| 7 | 저장(HWP 5) | `keepLineseg: true` | `false` (4.22.16) | 바뀐 문단의 줄 나눔 정보를 지워 한컴이 다시 짠다. |

고정값은 호출하는 쪽이 값을 직접 주면 그 값이 이긴다(3~5). 4.15.7과 비교한 결과, 같은 Markdown으로 만든 기안문·보고서·계획서·표지 없는 개조식은 표 수, 쪽 나눔 수, 글 순서가 같았다.

### 5-3. 고정할 수 없는 변화 (옵션 없음)

- 표지 있는 개조식에서 표가 1개 늘어난다(요약이 ※ 문단이 아니라 1×1 요약 상자, 4.21.2).
- 개조식 번호 붙은 `###` 띠, 표 캡션·단위 줄 서식, 보도자료 표 모양 등 공문서 모양 다듬기(4.16~4.25).
- PNG·JPEG·WebP 외 그림(BMP 등)을 PNG로 바꾼다(4.24.74). BMP는 내장 해독기로 바뀌고, 나머지는 `sharp`가 없어 원본 그대로 나가며 `SKIPPED_IMAGE` 경고가 붙는다.
- 불러오기 Markdown 표기: HWP 5 굵게·기울임 출력, 아래 캡션은 표 뒤, 소프트 하이픈 `-`, `\<`·`\$`·문단 첫 `\>` 이스케이프, PDF 각주 위치 등.
- 글자 폭 계산(4 HWPUNIT 양자화, 폭표 18종)과 미리보기 조판. `measureTextWidth`·`simulateWrap` 값이 달라져 공문서 틀 맞춤 결과가 바뀔 수 있다.
- `normalizeGongmunPreset("서울방침")`이 이제 `bangchim`을 돌려준다. 노트 속성에 이 이름을 쓰면 새 양식으로 만들어진다.

### 5-4. 제안

- 고정값 1~7은 3.0.0 기능 작업에서 하나씩 풀지 정한다. 1·2는 가져오기 옵션으로, 6은 저장 보고서 문구와 함께 푸는 것이 자연스럽다. (PROPOSED)
- 4차 실기의 "10개 양식 바이트 동일" 기준선은 새 엔진으로 다시 잡아야 한다. (PROPOSED)

## 6. 대안과 기각 사유

| 대안 | 장점 | 위험/기각 사유 | 재검토 조건 |
|---|---|---|---|
| 4.24.81(PDF.js 마지막 판)로 이식 | 번들 증가 작음, CMap 주입 유지 | 같은 하드닝 작업을 다음에 또 한다. 보고서·계획서 목차, `hancomFallback` 옵션, PowerShell 전체 경로 수정이 빠진다 | 없음 |
| wasm을 무압축 base64로 내장 | 풀기 코드 없음 | `main.js` 약 8.5MB | 없음 |
| 빌드 때마다 다시 압축 | 데이터 파일을 커밋하지 않음 | zlib 빌드마다 결과가 달라 같은 커밋의 `main.js`가 달라질 수 있다 | 없음 |
| wasm을 별도 파일로 배포하거나 실행 중 내려받기 | `main.js` 작음 | Obsidian은 파일 3개만 배포한다. 내려받기는 오프라인 계약 위반 | 없음 |
| OCR 코드를 종전처럼 번들에 남김 | 변환 하나 덜 씀 | `fetch`와 모델 주소가 `main.js`에 남아 심사 부담, 약 70만 바이트 | 없음 |
| COM 청크만 스텁으로 바꾸고 호출 지점은 남김 | 간단 | 호출 코드가 남아 검토 부담. 4.15.7 때와 같은 이유로 기각 | 없음 |
| PDF.js 하드닝 코드를 남김 | 변경 작음 | 번들에 PDF.js가 없어 죽은 코드와 죽은 테스트가 된다 | PDF.js를 다시 묶을 때 |

## 7. 한계와 미해결 질문

1. 실제 문서 회귀 코퍼스(HWP, HWPX, PDF, DOCX)로 4.15.7 대비 Markdown 차이를 보지 않았다. 5-3의 표기 변화가 기존 노트 흐름에 미치는 영향은 확인이 필요하다.
2. 공문서 모양은 표 수·쪽 나눔 수·글 순서만 비교했다. 글꼴, 치수, 틀 맞춤은 한컴 실표시로 확인해야 한다.
3. `scriptTags`와 `layoutTables` 고정은 옵션 값으로만 테스트했다. 실제 첨자나 틀 표가 든 시험 문서가 없다.
4. wasm 동기 컴파일은 Obsidian 1.14.5 하나에서만 확인했다. `minAppVersion` 1.8.9의 Electron에서도 4.1MB 모듈의 동기 인스턴스화가 되는지 확인이 필요하다.
5. hayro는 상위 커밋에 고정돼 있고 알려진 한계가 있다(표준 글꼴 접미사 글리프 폭 0, 일부 progressive JPEG 그림). Kordoc 측 실측으로 실제 문서 742개 중 732개가 PDF.js 결과와 같았다.
6. 제3자 고지는 Kordoc이 싣는 라이선스 파일을 `third-party-licenses/kordoc-4.25.0/`에 그대로 옮겼다. `THIRD_PARTY_NOTICES.md`에 전문을 직접 실을지는 정해야 한다.
7. 전체 테스트를 한 번 돌릴 때 `tests/hayroWasm.test.ts`의 esbuild 서비스가 "The service was stopped"로 끝난 적이 한 번 있다. 그때 같은 폴더에서 다른 빌드가 돌고 있었고, 이후 실행에서는 재현되지 않았다.

## 8. 구현 영향

- 변경 파일: `package.json`, `package-lock.json`, `.gitattributes`, `esbuild.config.mjs`, `scripts/check-bundle.mjs`, `scripts/check-release.mjs`, `scripts/check-i18n.mjs`, `scripts/gen-hayro-wasm.mjs`(신규), `src/io/hayroWasm.ts`·`hayroWasmData.ts`·`patchOptions.ts`(신규), `src/io/importOptions.ts`, `importRunner.ts`, `documentDiff.ts`, `formFill.ts`, `kordocEngine.ts`, `kordocSave.ts`, `gongmunOutline.ts`, `gongmunProperties.ts`, `hwpxPostProcess.ts`, `tests/buildHardening.test.ts`, `tests/hwpxPostProcess.test.ts`, `tests/importFlow.test.ts`, `tests/hayroWasm.test.ts`·`kordocPins.test.ts`·`helpers/hardenedKordocBundle.ts`(신규), `THIRD_PARTY_NOTICES.md`, `third-party-licenses/kordoc-4.25.0/`(신규)
- 삭제 파일: `src/io/pdfCMaps.ts`, `src/io/pdfCMapData.ts`, `scripts/gen-pdf-cmaps.mjs`, `tests/pdfCMaps.test.ts`
- 유지해야 할 불변조건: `node:child_process` 정확히 1개, `main.js`에 `fs` import 0, `fetch` 0, 동적 import 0, 선택 모듈 이름 0, `parse()`는 반드시 `kordocParseOptions()`를 거침, WebAssembly는 번들 안 바이트에서만 컴파일
- 마이그레이션: 없음(설정·노트 형식 불변)
- 보안·개인정보: 네트워크 0 유지. 한컴 자동화와 OCR 코드가 번들에서 사라졌다.

## 9. 검증 조건

- 자동 테스트: `node scripts/run-tests.mjs` 473개 통과. `eslint`, `check-i18n`(1,528키), `tsc --noEmit --skipLibCheck`, 운영 빌드, `check-bundle`(5,221,758바이트), `check-community`, `check-release`, `test-editorial-pdf-render` 통과.
- 번들 종단 시험(`tests/hayroWasm.test.ts`): 한국어 CMap PDF 읽기, HWPX 생성 → 검증 → 다시 읽기 → SVG 렌더, 이미지 파일 입력에서 OCR이 돌지 않음, 네트워크 호출 0.
- 수동 테스트: 7절 1~4.
- 완료 기준: 매니페스트가 설치 버전·wasm 해시와 일치, 기존 기능 테스트 전부 통과, 상한 안의 번들 크기.

## 10. 출처

- 저장소 소스: `esbuild.config.mjs`, `scripts/check-bundle.mjs`, `scripts/check-release.mjs`, `scripts/gen-hayro-wasm.mjs`, `tests/buildHardening.test.ts`, `tests/hayroWasm.test.ts`, `tests/kordocPins.test.ts`
- 공식 문서: Kordoc README·CHANGELOG·NOTICE·THIRD_PARTY (4.25.0), hayro <https://github.com/LaurenzV/hayro>
- 사용자 제공 증거: 2026-11-18 사용자 결정(4.25.0 전체 이식, 번들 크기는 문제 삼지 않음, 오프라인·결정성은 양보하지 않음)

## 11. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-11-18 | 최초 작성(M1 이식 결과). 번들 4,262,290 → 5,221,758바이트: PDF.js·한국어 CMap·OCR 코드가 빠져 엔진 코드는 약 2.97MB로 줄고, 내장 hayro PDF 엔진이 2,248,248바이트(wasm 4,124,364바이트, raw DEFLATE, base64)를 더한다. 상한 4,305,000 → 5,380,000바이트. |
