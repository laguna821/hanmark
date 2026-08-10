# R-005 — HanMark 2.5.6 Editorial PDF 구현 청사진

- 상태: PROPOSED
- 작성일: 2026-08-10
- 최종 갱신: 2026-08-10
- 기준 커밋: 728b2b3495822a667417561ba0d55f9ee3cf7733
- 입력 문서: R-001, R-002, R-003, R-004
- 필수 검증: R-006

## 1. 목적

2.5.5 기본 PDF를 그대로 보존하면서, 초보자가 키 컬러와 문구만 바꾸면 안전한 팔레트가 자동 생성되는 2.5.6 구현 경계를 제안한다. 이 문서는 코드 변경 자체가 아니라 구현자가 따라야 할 구조, 데이터 흐름, 단계와 비변경 영역을 기록한다.

## 2. 설계 원칙

1. 기본 프로필은 2.5.5의 CSS, 문구, 9색을 정확히 재현한다.
2. 사용자 입력은 key와 선택적 accent, 문구로 제한한다.
3. renderer는 의미 기반 token을 받으며 사용자 원문 CSS를 받지 않는다.
4. 정규화·대비 계산은 DOM과 Obsidian API가 없는 순수 TypeScript다.
5. 미리보기와 실제 PDF는 같은 normalize와 palette resolver를 호출한다.
6. 인쇄 시작 시 설정을 깊은 복사한 immutable snapshot을 사용한다.
7. PDF branding은 editorialDocument.ts와 HTML/HWPX/DOCX 출력에 들어가지 않는다.
8. 인쇄 자산 대기, 2-frame 조판, window.print, watchdog, cleanup은 변경 범위와 분리한다.
9. 빈 문자열은 유효한 사용자 의도다.
10. 설정 UI는 draft와 명시적 Apply를 사용한다.

## 3. 제안 파일 경계

### 신규 src/io/editorialPdfTemplate.ts

- 공개 설정 타입과 schema version
- factory default template, clone, normalize
- #RRGGBB 검증과 canonicalization
- 문구·tag 정규화와 grapheme 제한
- WCAG 휘도·대비와 OKLCH 안전 token 파생
- resolved palette와 진단 정보

이 모듈은 Obsidian, DOM, window, Plugin에 의존하지 않는다.

### src/legacy-port/settings.ts

- HanmarkSettings에 editorialPdfTemplate 추가
- settingsVersion 8 → 9
- version 8 및 부분 객체 migration
- 필드 누락과 빈 문자열을 구분
- unknown top-level 설정 보존
- 중첩 객체의 잘못된 타입 방어

### 신규 src/ui/EditorialPdfTemplateModal.ts

- 세 단계 draft 위저드
- color picker + HEX
- 표지와 본문 대표 미리보기
- 문구 편집
- reset, revert, cancel, apply
- 가독성 진단을 초보자 문구로 표시
- 실제 인쇄 service를 preview에 사용하지 않음

### 기존 연결부

| 파일 | 변경 역할 |
|---|---|
| src/ui/HanmarkExportModal.ts | 위저드 진입, 현재 style 요약, draft 전달, 기존 close/focus 유지 |
| src/ui/HanmarkSettingTab.ts | PDF 기본 디자인 편집 진입점과 reset |
| src/main.ts | getter/save action, rollback, immutable snapshot 전달 |
| src/io/editorialPdf.ts | optional template, resolved palette와 안전 문구를 CSS/DOM에 적용 |
| styles.css | 위저드·preview UI만 추가 |
| tests | 순수 template test와 기존 회귀 test 확장 |

## 4. 제안 데이터 모델

아래 schema는 방향을 고정하기 위한 예시다. naming은 구현 시 바꿀 수 있으나 의미와 빈값 계약은 유지한다.

    interface EditorialPdfTemplateV1 {
      schemaVersion: 1;
      mode: "default" | "custom";
      colors: {
        key: string;
        accentMode: "auto" | "custom";
        accent: string;
        highContrastSurface: boolean;
      };
      cover: {
        kicker: string;
        edition: string;
        titleMode: "file-title" | "custom" | "blank";
        titleText: string;
        subtitle: string;
        brand: string;
        system: string;
        detail: string;
        tags: string[];
      };
      page: {
        headerLeft: string;
        headerRightMode: "file-title" | "custom" | "blank";
        headerRightText: string;
        footerLeft: string;
        showPageNumber: boolean;
      };
    }

Resolved 값은 settings에 저장하지 않는 것을 권장한다. algorithm 수정과 저장 데이터 불일치를 막기 위해 인쇄와 preview 시 seed에서 계산한다.

    interface ResolvedEditorialPdfPalette {
      paper: string;
      bodyInk: string;
      keySurface: string;
      onKey: string;
      keyInk: string;
      keyMutedInk: string;
      accentLine: string;
      accentOnKey: string;
      softTint: string;
      border: string;
      alternate: string;
      diagnostics: {
        onKeyRatio: number;
        keyInkRatio: number;
        accentLineRatio: number;
        adjustedRoles: string[];
        exactKeyPreserved: boolean;
      };
    }

## 5. 기본값과 custom의 분리

default mode:

- 2.5.5 고정 문구와 기존 9색 exact constants
- 기존 52/48, A4, font, spacing
- header right file-title
- page number true
- algorithm으로 기존 팔레트를 재구성하지 않음

custom mode:

- 사용자 key seed
- R-004 resolver로 파생 token
- 사용자 문구와 빈칸
- geometry와 typography는 default와 동일

사용자가 default mode에서 field를 바꾸기 시작하면 local draft만 custom으로 전환한다. 저장 전에는 실제 mode를 변경하지 않는다.

## 6. 설정 정규화와 migration

- load, save, preview, print 입구에서 같은 순수 normalize 함수 사용
- type guard 없이 raw object를 spread하지 않음
- 필드 누락은 factory default
- string인 빈값은 그대로 보존
- 제어문자와 newline은 문구별 정책으로 정리
- tag 빈 문자열은 제거하고 빈 배열은 보존
- 색은 유효한 #RRGGBB만
- boolean과 enum은 allowlist
- 길이는 grapheme 단위

version 8 → 9:

1. 기존 모든 알려진 설정을 현재 방식으로 복원한다.
2. editorialPdfTemplate이 없으면 factory default를 삽입한다.
3. settingsVersion을 9로 올린다.
4. load 후 version 변화가 있으면 한 번 저장한다.
5. 알 수 없는 top-level key는 기존 호환 정책대로 보존한다.
6. 잘못된 editorialPdfTemplate 내부 key는 안전값으로 정규화하고 renderer에 전달하지 않는다.

## 7. 위저드 상태 기계

    저장 설정
      → open: deep-clone + normalize
      → draft
          ├─ picker/input/text 변경 → preview만 변경
          ├─ revert → open 시 snapshot
          ├─ HanMark 기본값 → factory draft
          ├─ cancel/close → 폐기
          ├─ apply only → 이번 export snapshot
          └─ save default → saveSettings once
                  ├─ 성공 → stored snapshot 갱신
                  └─ 실패 → 이전 설정 rollback + Notice + draft 유지

같은 Export Modal 안에서 다른 format을 잠시 선택했다 PDF로 돌아오면 draft를 유지하는 것을 권장한다. 모달 자체를 닫으면 폐기한다.

인쇄 버튼:

1. 모든 field 유효성 확인
2. draft normalize
3. resolved palette 계산과 불변식 확인
4. deep freeze 또는 동등한 snapshot
5. 기존 Export Modal close 순서
6. main.exportEditorialPdf에 snapshot 전달

## 8. 문구 적용 경계

### 표지 DOM

- createElement와 textContent만 사용
- 사용자 HTML/Markdown을 해석하지 않음
- 빈 일반 문구는 is-empty와 min-height로 슬롯 유지
- 빈 tag element는 만들지 않고 tag row 높이 유지
- 긴 문구는 grapheme truncate와 CSS overflow를 함께 사용

### @page margin box

- headerLeft, headerRight, footerLeft는 CSS content string
- 따옴표, 역슬래시, newline을 escapeEditorialPdfCssString으로 처리
- blank mode는 content: ""를 명시
- file-title mode만 grapheme ellipsis
- footerLeft와 counter(page)는 독립

동적 제목은 기본 file basename을 유지한다. Markdown 선두 H1의 현재 masthead 처리와 섞지 않는다.

## 9. CSS 생성 전략

- 모든 색 literal은 resolved palette의 canonical #RRGGBB만 사용
- 앞쪽 기본 규칙과 높은 specificity theme isolation 규칙이 같은 token 사용
- @page margin box에도 token을 직접 사용
- host CSS variable, currentColor, color-mix, light-dark를 쓰지 않음
- !important를 도입하지 않음
- 기존 light color-scheme 격리 유지

리팩터링 순서:

1. createEditorialPdfStyles의 literal을 모두 token reference로 바꾼다.
2. default palette CSS를 기존 expectation과 비교한다.
3. isolation block 누락을 token coverage test로 검출한다.
4. geometry/pagination rule과 color interpolation을 별도 review한다.

## 10. 미리보기

실제 PDF service는 body class, style root, print lock, cleanup을 소유하므로 실시간 preview에 호출하지 않는다.

대표 preview:

- A4 비율 cover와 body thumbnail
- 52/48 분할
- header left/right, top/bottom rule, footer/page number
- H1/H2, code, table header, callout, mark
- 선택 key와 실제 보정 token 비교

preview도 innerHTML과 iframe srcdoc를 쓰지 않는다. 입력은 textContent, 색은 canonical token만 사용한다. 실제 PDF와 같은 resolver를 사용하지만 preview layout이 실제 조판과 픽셀 일치를 약속하지는 않는다.

## 11. 저장과 오류 복구

기존 HTML theme 저장의 rollback 패턴을 따른다.

1. previous settings snapshot 보관
2. normalized next settings 할당
3. saveSettings
4. reject 시 previous 복원
5. UI 입력과 focus 복구
6. Notice 표시

drag 중에는 저장하지 않는다. Apply 또는 “기본값으로 저장”에서 한 번만 저장한다.

## 12. 구현 단계

### A — characterization

- default CSS/DOM, fixed strings, 9 colors
- settings v8 fixture
- Export Modal PDF 흐름

### B — 순수 template 모듈

- 타입, default, normalize
- contrast와 palette resolver
- property test
- 아직 UI/renderer에 연결하지 않음

### C — renderer 주입

- optional request.template
- default exact
- custom palette/text, empty slot
- print lifecycle 회귀

### D — settings persistence

- settingsVersion 9
- load/save normalize와 rollback

### E — 위저드와 preview

- draft, picker/HEX, text, preview
- 가독성 진단, keyboard/focus

### F — Export Center

- current style summary
- normalized snapshot 전달
- native print focus 유지

각 단계는 R-006 test를 먼저 또는 같은 변경에 추가하고 작은 commit으로 분리한다.

## 13. 비변경 영역

- Markdown parser와 editorial semantic document
- HTML/DOCX/HWPX renderer
- inline author color suppression
- A4와 52/48 geometry
- font asset 생성
- stylesheet/font/image readiness
- two animation frames
- concurrent print guard
- afterprint/watchdog/cleanup
- export button order

변경 필요성이 발견되면 범위를 조용히 넓히지 말고 새 R 문서를 등록한다.

## 14. 주요 위험과 완화

| 위험 | 원인 | 완화 |
|---|---|---|
| 색이 일부 요소에서 씹힘 | isolation block 중복 literal | 한 resolver, token coverage |
| CSS injection | @page content와 color interpolation | allowlisted HEX, CSS escape |
| HTML injection | cover 문구 | textContent |
| 빈 문구 부활 | nonEmptyString fallback | missing/empty 분리 |
| 설정 손상 | version 유지/얕은 merge | version 9, nested normalize |
| preview 불일치 | 별도 색 계산 | same resolver |
| exact key가 몰래 바뀜 | AAA 자동 조정 | 기본 AA exact, 전후 swatch |
| drag 저장 경합 | input마다 async save | draft, single Apply |
| 긴 한글/emoji overflow | 무제한 slot | grapheme limit |
| 첫 인쇄 회귀 | lifecycle 수정 | template 계산을 service 입구에서 완료 |

## 15. 구현 시작 전 결정

1. “매우 선명” surface 조정 옵션을 2.5.6에 포함할지
2. cover title custom/blank를 포함할지
3. accent override를 기본 또는 고급에 둘지
4. “이번 PDF에만 적용”과 “기본값 저장”을 둘 다 제공할지
5. 문구별 최종 grapheme 제한

다른 방향을 택하면 R-003과 R-004 대비 이유를 새 R 문서에 기록한다.

## 16. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-08-10 | 순수 template 모듈, v9 migration, draft 위저드, renderer 경계와 단계별 구현안 기록 |
