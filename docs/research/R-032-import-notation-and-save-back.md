# R-032 — 가져오기 표기 선택과 원본 저장(되쓰기)의 관계

- 상태: 가져오기 표기·새 입력은 CONFIRMED(구현·검증), 원본 저장용 표기 어댑터는 BLOCKED(전제 불일치, 5절), 어댑터 설계는 PROPOSED
- 작성일: 2026-11-18
- 기준 버전/커밋: HanMark 2.7.1 + M1(fa108aa, Kordoc 4.25.0), 작업 브랜치 `m3-import`
- 관련 문서: R-018, R-020, R-029(엔진 이식과 고정값)
- 담당 범위: 가져오기 옵션과 기본값, 가져오기 창, 새 입력 형식, 원본 저장 경로의 사실 확인

## 1. 조사 질문

1. 2026-11-18 사용자 결정(틀 표는 유지가 기본, 첨자는 켜고 끄는 옵션, 표는 전부 옵시디언 표가 기본)을 어떻게 옵션으로 옮기는가?
2. 그 결정이 "원본 한글 파일에 다시 저장"과 충돌하는가? 충돌한다면 어떤 설계가 필요한가?
3. Kordoc 4.25.0에서 새로 받을 수 있는 입력과 옵션은 무엇을 들일 수 있는가?

## 2. 범위

### 포함

- `src/io/importOptions.ts`(옵션·화이트리스트·프리셋 대응), `src/ui/ImportModal.ts`(옵션 묶음), 설정 저장(`importAdvanced`), `IMPORT_EXTENSIONS`
- 원본 저장 경로(`src/io/kordocSave.ts`의 `patchSource*`, `src/io/frontmatter.ts`, `src/io/legacyEngine.ts`)의 현재 동작 확인
- Kordoc 4.25.0 `patchHwpx`의 기준 표기와 표기별 실측

### 제외

- 공문서 양식(M2), 내장 DOCX(M7)
- 원본 저장 기능을 새 가져오기에 다시 여는 일(제품 결정이 필요하다. 5절)

## 3. 조사 방법과 증거

| 증거 | 유형 | 재현 또는 위치 | 신뢰도/한계 |
|---|---|---|---|
| 가져오기 실행 코드 | 소스 | `src/io/importRunner.ts` `importOne` | 높음 |
| 원본 저장 코드 | 소스 | `src/io/kordocSave.ts` `patchSourceExperimentalWithOutcome`, `src/io/legacyEngine.ts` | 높음 |
| 변경 기록 | 문서 | `CHANGELOG.md` 2.4.5 "Removed source patching from the public export types…", README "Notes imported by older versions" | 높음 |
| Kordoc 패치 기준 표기 | 외부 소스 | `chrisryugj/kordoc` `src/roundtrip/patcher.ts` 82~94행, `hwp5-patch.ts` 361행 | 높음 |
| 표기별 패치 실측 | 재현 | 세션 임시 `kplay/patchtest.mjs`, 사용자 강의계획서 HWPX 1건, 정책브리핑 보도자료 HWPX 1건 | 파일 2건. 저장소에 넣지 않음 |
| IR 정렬 실측 | 재현 | 세션 임시 `kplay/ir.mjs`, HWPX 2건·HWP 5 1건 | 파일 3건 |
| 표기별 가져오기 실측 | 재현 | 세션 임시 `kplay/opts.mjs`·`img.mjs`, 문서 14건 | 저장소에 넣지 않음 |
| 자동 테스트 | 재현 | `tests/importNotation.test.ts`, `tests/importFlow.test.ts`, `tests/kordocPins.test.ts` | 합성 자료 |

## 4. 확인된 사실

### 4-1. 가져오기 표기

1. Kordoc 4.25.0은 같은 문서를 표기만 바꿔 읽어도 최상위 블록 수와 종류가 같다(`layoutTables: "keep"` 기준, HWPX 2건·HWP 5 1건에서 30/30, 6/6, 222/222). `parse().markdown`은 `blocksToMarkdown(blocks, { tableFormat })`과 바이트까지 같다.
2. `tableFormat: "gfm"`은 합쳐진 표를 파이프 표로 편다. 가로 병합 칸은 빈 칸이 되고, 세로 병합 칸은 같은 글이 줄마다 반복된다. `htmlTables`와 함께 주면 Kordoc이 실패를 돌려준다.
3. `scriptTags`는 IR의 글 자체를 바꾼다(`<sup>`, `<sub>`가 블록 글에 들어간다). 보도자료 6건 중 4건에 1~12곳이 있었고, 사용자 문서 8건에는 없었다.
4. `layoutTables: "visual"`은 사용자 문서 8건에서는 차이가 없었고 보도자료 6건은 모두 달라졌다.
5. 기본값(옵시디언 표, 첨자 켬, 틀 표 유지)으로 보도자료 6건을 읽으면 HTML 표 0개, 그림 토큰과 그림 파일 이름이 모두 맞는다(BMP는 엔진이 PNG로 바꾸고 노트의 토큰도 `.png`다. 토큰 34개 중 파일 없는 토큰 0개).
6. HanMark 생성기(`markdownToHwpx`)는 노트의 `<sup>`/`<sub>`를 첨자 글자 모양으로 만들지 않는다. 태그가 빠지고 "25m2"처럼 본문 글자가 된다(실행 확인). 첨자를 켜고 가져온 노트를 새 HWPX로 내보내도 첨자 서식은 돌아오지 않는다. 2.7.1과 같은 결과이므로 퇴행은 아니다.

### 4-2. 원본 저장(되쓰기)의 현재 동작

1. **2.7.x의 가져오기는 원본 계약을 쓰지 않는다.** `importOne`은 "the note body is exactly the parsed Markdown plus attachment links (no source contract, no frontmatter)"이고, `src` 어디에도 `hwp-source-*` 속성을 쓰는 코드가 없다(읽는 코드와 예전 노트 정리 코드만 있다).
2. 원본 저장 명령(`patch-hwp-experimental`)은 명령 팔레트에만 있고, 노트에 `hwp-source-format`이 `hwp`/`hwpx`인 계약이 있을 때만 보인다. 그 계약은 원본 계약을 쓰던 예전 HanMark가 가져온 노트에만 있다(2.4.5에서 원본 패치를 공개 내보내기에서 뺐다).
3. 그 노트들도 `importedByCurrentEngine`이 거짓이라(계약의 `hwp-kordoc`이 지금 엔진과 다름) 원본을 패치하지 않고 **항상 새 HWPX를 만든다**(R-018, README "the original file is never patched").
4. 따라서 3.0.0 시점에 **새로 가져온 노트를 원본 한글 파일에 다시 저장하는 경로는 제품에 없다.** `patchHwpx`/`patchHwp` 호출은 코드에 남아 있지만 도달하는 노트가 없다.

### 4-3. Kordoc 패치의 기준 표기(어댑터가 필요해지는 경우의 사실)

1. `patchHwpx`는 원본을 `{ layoutTables: "keep" }`로 다시 읽어 편집본과 맞댄다. 기준 표기는 병합·중첩 표 HTML, 첨자 태그 켬, 틀 표 유지다.
2. 실측(강의계획서 1건, 경찰청 보도자료 1건, `structure:false`, `keepLineseg:true`):

| 노트 표기 | 무수정 | 병합 표 칸 한 곳 수정 |
|---|---|---|
| 병합 표 HTML + 첨자 켬 | 강의계획서 건너뜀 0 / 보도자료 건너뜀 1(그림 확장자) | 적용 1, 잔차 0 / 적용 1 |
| 병합 표 HTML + 첨자 끔 (2.7.x 표기) | 건너뜀 0 / 건너뜀 6(첨자 문단) | 적용 1 / 적용 1 |
| 전부 옵시디언 표 + 첨자 켬 (3.0.0 기본) | 건너뜀 1 / 건너뜀 5 ("표 ↔ 비표 변경은 미지원") | **적용 0** / **적용 0** |
| 전부 옵시디언 표 + 첨자 끔 | 건너뜀 1 / 건너뜀 10 | 적용 0 / 적용 0 |
| 틀 표 풀기 | 건너뜀 0 / `success:false` | 적용 1 / 실패 |

3. 그림 토큰은 확장자가 바뀌면(`.bmp` → `.png`) "이미지/구분선 변경은 미지원"으로 보고된다.

## 5. 해석과 제안

### 5-1. 구현한 것 (CONFIRMED)

- 옵션: `tables`("pipe" 기본 / "mixed" / "html"), `scriptTags`(기본 켬), `flattenLayout`(기본 끔), `memos`(기본 끔), `imagesInFlow`(기본 끔). 2.7.x의 `htmlTables: true`가 저장돼 있으면 "html"로 옮긴다.
- Kordoc에 보내는 값: "pipe" → `tableFormat: "gfm"`, "mixed" → `htmlCellLinks: true`, "html" → `htmlTables: true` + `htmlCellLinks: true`. `tableFormat: "gfm"`과 `htmlTables`는 함께 보내지 않는다(테스트로 고정).
- 강제값은 `hancomFallback: false`, `ocr: false` 둘이다. `layoutTables: "keep"`, `scriptTags: false`는 "표기를 고르지 않는 호출"(문서 비교, 양식 읽기)의 기본값으로 남겼다(`PINNED_PARSE_DEFAULTS`). 가져오기 창은 항상 표기를 명시한다.
- 프리셋 대응:

| 프리셋 | 표 | 첨자 | 틀 표 |
|---|---|---|---|
| 기본 | 사용자 선택 | 사용자 선택 | 사용자 선택 |
| 글 위주 | 사용자 선택 | 항상 끔(글만) | 사용자 선택 |
| 서식·양식 | "pipe"면 "mixed"로(칸 구조 보존), "html"은 그대로 | 사용자 선택 | 항상 유지 |
| 시험지·안내문 PDF | 표 없음 | 사용자 선택 | 사용자 선택 |

- 가져오기 창: 고급 옵션을 "노트에 쓰는 방식 / 그림 / 문서 종류별" 세 묶음으로 나눴다. 프리셋이 막는 옵션은 꺼진 채 이유를 보여 준다. 고급 옵션(쪽 범위 제외)은 가져오기를 시작할 때 설정 `importAdvanced`에 저장되고 다음에 창을 열 때와 메뉴·끌어놓기 가져오기에 적용된다.
- 새 입력: `.pptx`를 `IMPORT_EXTENSIONS`에 넣었다. 선택기, 리본, 파일 탐색기 명령, 끌어놓기, 폴더 가져오기가 모두 이 목록을 쓴다. 숨은 슬라이드는 `HIDDEN_TEXT_FILTERED` 경고로 보고서에 나온다. 그림 파일(TIFF·HEIC 등)은 OCR이 필요해 목록에 넣지 않았다(테스트로 고정).
- 경고·오류 문구: `messageCatalog`의 표가 Kordoc 4.25.0의 `WarningCode`·`ErrorCode` 타입 전체를 덮는다(타입 검사로 강제). 새 코드를 추가할 필요가 없었다.

### 5-2. 원본 저장용 표기 어댑터: 만들지 않고 멈춘 이유 (BLOCKED)

M3 지시는 "어떤 표기로 가져온 노트든 원본에 저장되게 하는 어댑터"를 요구했다. 그 전제는 "새로 가져온 노트를 원본에 저장하는 기능이 지금 있다"였는데, 4-2대로 사실이 아니다. 어댑터를 쓰는 호출 경로가 없고, 유일하게 남은 예전 노트 경로는 엔진 차이 때문에 표기와 무관하게 새 HWPX를 만든다.

어댑터를 의미 있게 하려면 먼저 "가져올 때 원본 계약과 원본 사본을 다시 남기고 원본 저장 명령을 새 노트에 여는" 제품 결정이 필요하다. 이것은 2.4.5에서 일부러 뺀 기능을 되살리는 일이고(README "Markdown 우선 가져오기와 예전 노트"), 이번 결정 과정에서 사용자에게 설명된 적이 없다. 그래서 이 항목은 구현하지 않았다.

사용자 결정에 미치는 영향:
- "틀 표를 풀면 원본에 저장할 수 없다"는 설명은 현재 제품에서는 해당하지 않는다. 어느 표기로 가져와도 원본 저장은 없고, 새 HWPX 내보내기는 모두 된다.
- "표를 전부 옵시디언 표로" 기본값이 저장 기능과 충돌한다는 걱정도 현재 제품에서는 해당하지 않는다. 실제로 잃는 것은 병합 칸 정보다. 그 노트를 새 HWPX로 내보내면 병합되지 않은 표가 나온다.

### 5-3. 원본 저장을 되살릴 경우의 설계 (PROPOSED)

4-1의 1번 사실 덕분에 흐릿한 글 맞추기 없이 만들 수 있다.

1. 가져올 때 노트에 표기 기록을 남긴다(표 형식, 첨자, 틀 표, 엔진 버전)과 원본 사본(기존 `hwp-source-cache`).
2. 저장할 때 원본을 메모리에서 두 번 읽는다. 노트 표기 N과 패치 표기 P. 블록 i마다 `blocksToMarkdown([블록])`으로 N쪽 글과 P쪽 글을 얻는다. 블록 수가 같으므로 짝이 정확하다.
3. 노트 본문을 단위(문단, 파이프 표, HTML 표)로 나눠 N과 맞댄다. 바뀌지 않은 단위는 P쪽 글로 바꿔 넣는다(패치가 차이를 보지 않는다. 그림 토큰은 자리표시로 비교).
4. 바뀐 단위만 옮긴다.
   - 파이프 표 → 병합 HTML 표: IR 격자의 병합 정보로 (행, 열) → 주인 칸을 찾아 칸 단위로 옮긴다. 세로 병합으로 반복된 값은 한 번만 센다. 같은 주인 칸의 사본을 서로 다르게 고쳤으면 옮기지 않고 보고한다. 가로 병합의 빈 칸에 쓴 글도 보고한다.
   - 첨자 없는 문단 → 첨자 있는 문단: 바뀐 구간을 태그 뺀 위치로 옮긴다. 구간이 태그 경계를 걸치면(지운 범위 안의 태그 짝이 맞지 않으면) 옮기지 않고 보고한다. 경계에 끼워 넣은 글은 태그 밖(본문)으로 본다.
   - 중첩 표(gfm이 부모 뒤로 꺼낸 표)의 수정은 1차에서는 옮기지 않고 보고한다.
5. 패치 뒤 결과를 N 표기로 다시 읽어 노트와 블록별로 비교한다. 다르면 "쓴 대로 반영되지 않음"으로 보고한다(잘못 반영을 조용히 넘기지 않는 장치).
6. 틀 표를 풀어 가져온 노트는 원본 저장을 제공하지 않고 새 HWPX 내보내기를 안내한다.

## 6. 대안과 기각 사유

| 대안 | 장점 | 위험/기각 사유 | 재검토 조건 |
|---|---|---|---|
| 지시대로 어댑터를 지금 구현 | 지시 충족 | 쓰는 경로가 없는 코드. 전제가 틀린 채 번들·테스트만 늘어남 | 원본 저장을 되살리기로 결정될 때 |
| 원본 저장을 이 작업에서 함께 되살림 | 사용자가 기대한 기능 | 2.4.5에서 뺀 기능의 부활. 원본 사본 보관, 명령·화면, 안전 규칙이 따로 필요. 사용자 결정 없이 할 수 없음 | 사용자 결정 |
| 기본 표를 "mixed"로 유지 | 병합 칸 보존 | 사용자가 전부 옵시디언 표를 골랐다 | 사용자가 바꿀 때 |

## 7. 한계와 미해결 질문

- 가져오기 창의 화면 자동화(Playwright) 스크립트와 캡처는 만들지 못했다. 기존 UI 스크립트에 가져오기 창 하네스가 없다. 옵션 대응과 저장·복원은 단위 테스트로만 확인했다.
- 첨자 켜기/끄기의 실제 출력은 사용자 파일과 공개 보도자료에서만 확인했다. 저장소 테스트는 옵션 수준이다(HanMark 생성기가 첨자를 만들지 못해 합성 자료를 만들 수 없다).
- 각주 속 표 보존, 메모 가져오기, PDF 그림 제자리는 옵션 전달만 테스트했다. 각주 속 표와 메모가 든 합성 문서를 만들지 못했다.
- PPTX는 합성 슬라이드(제목, 본문, 숨은 슬라이드)로만 확인했다. 실제 발표 자료(표, 그림, 노트)는 확인하지 못했다.
- 미해결: 새로 가져온 노트의 원본 저장을 3.0.0에서 되살릴 것인가.
- 미해결: 노트의 `<sup>`/`<sub>`를 HWPX 내보내기에서 실제 첨자로 만들 것인가(지금은 빠진다).

## 8. 구현 영향

- 변경 파일: `src/io/importOptions.ts`, `src/io/importRunner.ts`, `src/ui/ImportModal.ts`, `src/legacy-port/settings.ts`(필드 1개), `src/main.ts`(가져오기 호스트 2줄), `src/i18n/ko.ts`·`en.ts`, `tests/importNotation.test.ts`(신규), `tests/importFlow.test.ts`, `tests/kordocPins.test.ts`
- 유지해야 할 불변조건: `hancomFallback: false`·`ocr: false` 강제, 화이트리스트 밖 옵션 0, `tableFormat: "gfm"`과 `htmlTables` 동시 전달 0, 비교·양식 읽기 경로의 표기 불변
- 마이그레이션: 설정에 `importAdvanced`가 없으면 3.0.0 기본값. `htmlTables: true`는 "html"
- 보안·개인정보: 새 네트워크·프로세스·파일 경로 없음. 그림 파일 입력은 제공하지 않음

## 9. 검증 조건

- 자동 테스트: `node scripts/run-tests.mjs` 482개 통과(M1 473 + 9). eslint, i18n(1,549키), tsc, 프로덕션 빌드, 번들·Community·Release 검사 통과. `main.js` 5,228,481바이트.
- 수동 테스트: 가져오기 창에서 세 묶음과 프리셋별 잠금, 옵션 기억을 눈으로 확인해야 한다(미실시).
- 완료 기준: 5-1 전부 통과. 5-2는 결정 대기.

## 10. 출처

- 저장소 소스: `src/io/importRunner.ts`, `src/io/kordocSave.ts`, `src/io/legacyEngine.ts`, `src/io/frontmatter.ts`, `CHANGELOG.md`, `README.md`
- 공식 문서: Kordoc 4.25.0 `dist/index.d.ts`(ParseOptions, MarkdownOptions, PatchOptions), `src/roundtrip/patcher.ts`
- 사용자 제공 증거: 2026-11-18 사용자 결정 세 가지

## 11. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-11-18 | 최초 작성. 가져오기 표기 옵션·PPTX 구현, 원본 저장 어댑터는 전제 불일치로 중단하고 설계만 기록 |
