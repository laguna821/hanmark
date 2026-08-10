# R-006 — 2.5.6 PDF 사용자 정의 검증·위험·완료 게이트

- 상태: REQUIRED
- 작성일: 2026-08-10
- 최종 갱신: 2026-08-10
- 적용 시점: 2.5.6 PDF template 구현 시작부터 릴리스까지
- 관련 문서: R-001~R-005

## 1. 목적과 완료 정의

기능이 화면에 보인다는 이유만으로 완료 처리하지 않도록 기본 호환성, 색상 안전, 빈 문구, 설정 migration, 주입 방지, 인쇄 생명주기와 실제 출력물을 검증한다.

다음을 모두 충족해야 완료로 표시할 수 있다.

- 적용되는 R 문서를 계획과 변경 설명에서 참조
- unresolved 결정을 기록
- 모든 자동 test와 npm run check 통과
- Windows와 macOS 수동 인쇄 검증
- 기본 profile이 2.5.5 기준선과 동일
- custom profile의 contrast invariant 통과
- 취소·저장 실패·migration에서 설정 손실 없음
- diff에 개인 경로·사용자 파일·비밀값 없음
- 실제 PDF 대표 fixture의 A4, 장식, 문구, 색 확인

## 2. 자동 테스트

### 2.1 기본 호환성

| 사례 | 기대 |
|---|---|
| template 인자 없음 | 2.5.5 기본 문구와 9색 |
| mode default | 2.5.5와 같은 CSS·DOM |
| 기본 표지 | A4, 52/48 |
| 기본 body page | 같은 @page header/footer/rule |
| 파일명 제목 | 기존 grapheme ellipsis와 cover wrap |
| light/dark Obsidian | 동일 PDF palette |
| 원문 inline color | 계속 PDF palette로 억제 |

기존 exact palette test는 “default profile exact”로 유지하고 custom test를 별도로 둔다.

### 2.2 설정 migration

| 입력 | 기대 |
|---|---|
| settings v8 전체 | v9 + factory PDF template |
| 빈 object | 모든 default |
| template 일부 | 누락 field만 default |
| 잘못된 nested type | 안전 default |
| unknown top-level key | 기존 정책대로 보존 |
| 명시적 빈 문구 | 빈값 보존 |
| 빈 tags 배열 | 빈 배열 보존 |
| invalid enum/boolean | allowlisted default |
| save failure | 이전 settings 복원 |

reload 후 두 번째 normalize가 같은 결과여야 한다. normalize는 idempotent여야 한다.

### 2.3 HEX와 주입 방지

허용:

- #123ABC
- 123abc
- 주변 공백

거부:

- #ABC, #12345678
- rgb(0,0,0), red, var(--x)
- #000000; color:red
- url(...)
- null, number, array, object

최종 renderer의 모든 색은 /^#[0-9A-F]{6}$/를 만족해야 한다.

문구 fixture:

- script tag처럼 보이는 문자열
- HTML entity
- 따옴표, 역슬래시, newline
- 한국어, emoji와 결합 grapheme
- 매우 긴 문자열

DOM에는 text node만, @page CSS에는 escape된 string만 생겨야 한다. innerHTML, outerHTML, iframe srcdoc, eval, new Function을 도입하지 않는다.

### 2.4 대비 불변식

대표 key:

- #002E6E, #FFFF00, #FFD400
- #FFFFFF, #000000, #808080
- #FF0000, #00FF00, #00FFFF, #0000FF
- near-white, near-black
- 상대 휘도 0.10, 0.175, 0.183333, 0.30 경계 주변

각 custom profile:

- keySurface/onKey ≥ 4.5
- AAA badge가 있으면 ≥ 7
- paper/keyInk ≥ 7
- paper/accentLine ≥ 3
- keySurface/accentOnKey ≥ 4.5
- softTint/bodyInk ≥ 7
- final quantized #RRGGBB를 다시 계산
- threshold 전 반올림 금지

seeded random RGB와 property test를 추가한다. 별도 개발 script로 24-bit exhaustive keySurface/onKey AA 검사를 실행할 수 있으면 결과와 seed/commit을 기록한다.

### 2.5 빈 문구와 layout

각 문구를 하나씩 빈 문자열로 만든다.

- 기본값이 되살아나지 않음
- 일반 slot 공간 유지, glyph 없음
- header-right blank에는 ellipsis 없음
- footer-left blank와 page counter 독립
- tags []에는 pill 없음, row 높이 유지
- 모든 표지 문구 blank여도 52/48 유지

긴 한글, Latin, emoji를 최대 경계 전후로 검사한다. grapheme 중간 절단, cover overflow, header/footer 충돌이 없어야 한다.

### 2.6 위저드 상태

| 동작 | 기대 |
|---|---|
| open | stored 설정의 deep draft |
| picker drag | preview만 변경 |
| HEX 입력 | picker와 양방향 sync |
| incomplete HEX | last valid preview, aria-invalid |
| PDF→다른 format→PDF | 같은 modal에서 draft 유지 |
| revert | open snapshot |
| factory reset | draft만 default |
| close/cancel | stored settings 불변 |
| apply once | normalized snapshot 전달 |
| save default | saveSettings 1회 |
| save reject | rollback, Notice, input/focus 복구 |
| print start | 모든 editor lock, immutable snapshot |

키보드만으로 모든 단계, 입력, reset, cancel, apply에 도달할 수 있어야 한다. label, accessible name, focus order를 확인한다.

### 2.7 renderer 전달

같은 normalized template이 다음 경로를 통과해야 한다.

    Modal draft → action → main → EditorialPdfRequest → CSS/DOM

- 인쇄 도중 plugin.settings 변경이 현재 출력에 영향 없음
- custom text가 올바른 cover/@page slot에만 적용
- colors가 기본 규칙과 isolation block 모두에 적용
- HTML/DOCX/HWPX output에는 영향 없음

### 2.8 기존 인쇄 생명주기

- 첫 인쇄 stylesheet readiness
- font readiness와 image decode
- two animation frames
- 대형 code/table pagination
- nested lists/callouts
- concurrent print 차단
- orphan root 정리
- afterprint와 watchdog timeout
- idempotent cleanup
- print throw 후 body class와 UI 복구

## 3. 수동 시각 검증

### 환경

- Windows와 macOS
- 지원 최소 Obsidian
- light/dark theme
- 좁은/넓은 modal
- 키보드 only
- mouse color picker drag
- system print preview
- Microsoft Print to PDF 또는 OS Save as PDF

### 프로필

1. untouched default
2. deep navy
3. pure yellow
4. mid gray, exact key에서 AAA 불가
5. white/near-white
6. black/near-black
7. saturated red
8. custom accent가 흰 종이와 3:1 미만
9. 모든 고정 문구 blank
10. 최대 길이 한국어·emoji

### 확인 요소

- cover upper/lower, tags
- H1/H2, body, link, inline code, fenced code
- blockquote, callout label/body
- table header/row/border, mark
- top/bottom rule
- header/footer/page number

## 4. 실제 PDF 산출물 검사

대표 PDF마다:

- A4, rotation 0, cover 52/48
- 표지 번호 없음, 2쪽 이후 번호
- header/footer 반복
- blank text의 glyph 없음
- expected canonical vector/fill colors
- screenshot anti-aliasing 색과 source token을 혼동하지 않음
- 본문과 장식 충돌 없음

가능하면 text extraction과 metadata도 기록하되, R-001의 특정 Microsoft print 결과를 renderer 일반 특성으로 단정하지 않는다.

## 5. 위험 Register

| ID | 위험 | 가능성 | 영향 | 탐지 | 완화/게이트 |
|---|---|---:|---:|---|---|
| V-01 | isolation CSS가 custom 색을 덮음 | 높음 | 높음 | token coverage, visual | 양쪽 block 동일 palette |
| V-02 | 밝은 key에서 흰 글자 | 높음 | 높음 | contrast property | automatic onKey |
| V-03 | AAA 허위 표시 | 중간 | 높음 | #808080 fixture | exact-key 한계 모델 |
| V-04 | @page CSS injection | 중간 | 높음 | hostile strings | CSS escape, length |
| V-05 | cover HTML injection | 낮음 | 높음 | hostile strings | textContent |
| V-06 | 빈값이 default로 부활 | 높음 | 중간 | empty fixture | missing/empty 분리 |
| V-07 | v8 설정 영속화 누락 | 중간 | 중간 | reload migration | settings v9 |
| V-08 | drag save race | 중간 | 중간 | rapid input | draft, single save |
| V-09 | preview/PDF 불일치 | 중간 | 높음 | deep equality | same resolver |
| V-10 | 긴 문구가 표지를 밀어냄 | 높음 | 중간 | boundary fixture | grapheme limit |
| V-11 | first print 회귀 | 중간 | 높음 | lifecycle tests | service 격리 |
| V-12 | 다른 exporter 오염 | 낮음 | 높음 | cross-export | PDF-only module |
| V-13 | default 시각 회귀 | 중간 | 높음 | exact snapshot | legacy constants |
| V-14 | 실제 프린터 색 편차 | 높음 | 중간 | manual print | 보장 한계 고지 |

## 6. 단계별 품질 게이트

### Gate A — 연구

- Research Register와 R-002~R-006을 plan에 명시
- 설계 변경 시 새 R 등록

### Gate B — 순수 로직

- normalize idempotent
- contrast 공식 fixture
- property invariants와 injection strings

### Gate C — 기본 호환

- exact default tests
- 기존 관련 baseline tests 전부 통과
- optional 인자 없음/default 동작 동일

### Gate D — UI

- draft/cancel/save
- keyboard/focus
- invalid input
- representative preview

### Gate E — 인쇄

- full editorialPdf suite
- export center suite
- Windows/macOS actual print
- representative PDF forensic check

### Gate F — release

- npm run check on both OS
- npm audit --omit=dev --omit=optional
- git diff --check
- staged diff personal path/secret scan
- version/release consistency

## 7. 중단 조건

다음 상황에서는 범위를 계속 넓히지 말고 새 R 문서를 작성한다.

- page geometry 또는 font 편집 요구
- raw CSS/HTML 요구
- per-document frontmatter template
- HTML theme와 PDF theme 연결
- WCAG 외 알고리즘을 acceptance 기준으로 변경
- preview 때문에 print lifecycle 변경이 필요
- 기본 profile exact 보존과 기능이 양립하지 않음
- 파괴적 설정 migration 필요

## 8. 증거 보존

익명화한 fixture와 expected 값은 저장소에 둘 수 있다. 사용자 원본 PDF·캡처·개인 경로는 넣지 않는다. 외부 표준 URL, 입력 색, 계산 ratio, test seed, 기준 commit을 문서 또는 test 이름에 남긴다.

## 9. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-08-10 | 자동·수동·산출물 검증, 위험 Register, 품질 게이트 최초 정의 |
