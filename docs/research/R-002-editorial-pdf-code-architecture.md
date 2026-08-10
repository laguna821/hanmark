# R-002 — HanMark 2.5.5 Editorial PDF 코드 구조

- 상태: CONFIRMED
- 작성일: 2026-08-10
- 최종 갱신: 2026-08-10
- 기준 커밋: 728b2b3495822a667417561ba0d55f9ee3cf7733
- 관련 문서: R-001, R-005, R-006

## 1. 조사 질문

2.5.5의 PDF 내보내기에서 색상·문구·설정·UI·인쇄 생명주기가 어디에 있으며, 2.5.6 템플릿 기능을 어떤 경계에 넣어야 기존 안정성을 해치지 않는가?

## 2. 결론

2.5.5에는 PDF 템플릿 설정 계층이 없다. main.ts는 Markdown과 파일명만 EditorialPdfService에 전달하고, editorialPdf.ts 하나가 모든 고정 문구와 팔레트, 표지, @page 헤더·푸터를 생성한다. 설정 탭과 내보내기 모달에는 PDF 디자인 필드가 없다.

2.5.6에서는 공유 문서 모델 editorialDocument.ts를 변경하지 않고, 순수 템플릿·정규화·색상 계산 모듈을 만든 뒤 정규화된 snapshot만 PDF 서비스에 주입하는 것이 가장 작은 안전 경계다.

## 3. 현재 호출 흐름

    툴바 PDF 버튼 또는 export-pdf 명령
      → HanmarkExportModal
      → main.exportEditorialPdf
      → frontmatter 제거
      → 이미지 data URI 내장과 실패 처리
      → EditorialPdfService.print({ markdown, fileName })
      → parseEditorialDocument
      → createEditorialPdfStyles(fileTitle)
      → buildEditorialPdfRoot(editorial, fileTitle)
      → style/root 연결
      → stylesheet·font·image·2 frame layout 대기
      → window.print
      → cleanup

근거 위치:

| 단계 | 파일:행 |
|---|---|
| 툴바 PDF 버튼 | src/ui/ToolbarController.ts:660-665 |
| 툴바 액션 연결 | src/main.ts:293-300 |
| export-pdf 명령 | src/main.ts:494-498 |
| Export Center 액션 주입 | src/main.ts:551-601 |
| PDF 준비·호출 | src/main.ts:713-757 |
| 요청 타입 | src/io/editorialPdf.ts:142-150 |
| 서비스 전체 흐름 | src/io/editorialPdf.ts:2620-2754 |

현재 요청 객체는 markdown, fileName과 런타임 옵션만 가진다. 템플릿, 색상, 문구 설정은 없다.

## 4. PDF UI의 현재 상태

src/ui/HanmarkExportModal.ts:526-535의 PDF 상세 화면은 설명문 두 줄만 표시한다. 커스텀 옵션이나 설정 진입점은 없다.

src/ui/HanmarkExportModal.ts:625-677에는 중요한 기존 계약이 있다.

- PDF 실행 시 모달을 먼저 닫아 네이티브 인쇄창에 포커스를 넘긴다.
- 실행 중 전체 입력을 잠근다.
- 실패 시 모달을 다시 렌더링하고 포커스를 복구한다.

따라서 2.5.6은 인쇄 직전에 draft를 정규화하고 깊은 복사한 snapshot을 함수 인자로 캡처해야 한다. 모달을 닫은 뒤 모달 내부 필드나 살아 있는 plugin.settings 객체를 참조하면 안 된다.

## 5. 설정과 마이그레이션

src/legacy-port/settings.ts:

- HanmarkSettings: 99-124
- 현재 settingsVersion 8
- 기본값: 126-146
- 6자리 툴바 HEX 정규화: 237-242
- 설정 보존·정규화: 311-359
- PDF 설정 필드: 없음

src/main.ts:348-368은 loadData 후 메모리 마이그레이션과 전체 정규화를 수행하고, 버전이 바뀐 경우 로드 직후 다시 저장한다.

중요한 결과:

1. 새 PDF 필드는 전용 정규화 없이 unknown key로만 보존하면 검증되지 않은 색상·문자열이 렌더러에 도달할 수 있다.
2. 기존 version 8을 그대로 유지하면 메모리 기본값은 생겨도 기존 사용자의 data.json에 즉시 영속화되지 않을 수 있다.
3. 2.5.6은 settingsVersion 9 또는 동등한 누락 필드 감지·저장을 요구한다.
4. 기존 nonEmptyString 방식은 빈 문자열을 기본값으로 되살린다. 사용자가 문구를 지울 수 있어야 하므로 PDF 텍스트에는 사용할 수 없다.
5. 필드 없음은 기본값, 명시적 빈 문자열은 삭제 의도로 구분해야 한다.

## 6. 하드코딩된 페이지 장식

createEditorialPdfStyles는 src/io/editorialPdf.ts:795-1608에 있는 큰 CSS 생성 함수다.

| 위치 | 현재 값 | 코드 |
|---|---|---|
| 좌상단 | HANMARK PDF PRINT | 836-849 |
| 우상단 | 20 grapheme 말줄임 파일명 | 795-801, 860-873 |
| 좌하단 | ACHMAGE / HANMARK PDF EDITION | 875-888 |
| 우하단 | counter(page) | 899-911 |
| 위·아래 선 | #00B5AD | 841, 856, 865, 880, 895, 904 |
| 장식 글자 | #002E6E | 842, 866, 881, 905 |

헤더·푸터 문구는 일반 DOM이 아니라 Chromium @page margin box의 content 속성이다. 사용자 문구는 반드시 기존 escapeEditorialPdfCssString 경계를 거쳐야 한다.

## 7. 하드코딩된 표지

buildEditorialPdfRoot는 src/io/editorialPdf.ts:2155-2234에서 표지를 만든다.

| 슬롯 | 코드 |
|---|---|
| HANMARK PDF PRINT | 2172-2175 |
| EDITORIAL EDITION | 2176-2179 |
| 파일명 제목 | 2181-2191 |
| Markdown to Editorial PDF | 2192-2195 |
| ACHMAGE / HanMark PDF Edition | 2200-2203 |
| HANMARK EXPORT SYSTEM | 2204-2207 |
| OBSIDIAN MARKDOWN · PRINT-READY A4 | 2208-2211 |
| 네 개 태그 | 2212-2220 |

표지 DOM 문자열은 textContent로 삽입돼 현재 HTML 주입을 막는다. 이 계약을 유지해야 한다.

표지 CSS:

- A4와 52/48 grid: 980-992
- 상단 네이비와 흰 글자: 994-1003
- 하단 흰 배경과 네이비 글자: 1053-1062

## 8. 고정 팔레트와 CSS 격리 함정

현재 9색은 R-001에 기록돼 있다. 사용 위치는 editorialPdf.ts의 다음 구간에 흩어져 있다.

| 역할 | 주요 코드 |
|---|---|
| 제목 | 1121-1156 |
| blockquote·callout | 1184-1208 |
| pre/code block | 1217-1230 |
| table header | 1291-1308 |
| link·mark·hr | 1394-1408 |
| inline code | 1515-1522 |
| callout label | 1570-1572 |

핵심 위험은 색상 규칙이 두 번 존재한다는 점이다.

- 앞쪽 기본 규칙: 대략 943-1408
- 더 높은 specificity의 Obsidian theme isolation: 1410-1605

앞쪽만 사용자 색으로 바꾸면 뒤쪽 격리 규칙이 기존 고정색으로 다시 덮어써 사용자의 색이 “씹힌다.” 모든 색은 하나의 resolved palette에서 양쪽 규칙을 함께 생성해야 한다. CSS 변수나 currentColor에 맡겨 host theme가 섞이지 않게 한다.

## 9. 공유 문서 모델과의 경계

src/io/editorialDocument.ts는 HTML과 PDF가 함께 사용하는 의미 문서 모델이다. 제목, 문단, 목록, 표, 인용, callout, code를 파싱한다.

- inline color/backgroundColor 보존: 13-26, 318-327, 736-776
- 선두 H1을 masthead로 이동: 1365-1382

HTML exporter는 해당 inline 색을 실제 HTML 스타일로 사용하지만, PDF renderer는 의도적으로 적용하지 않는다. PDF 테스트도 원문 빨강·노랑 inline 색이 PDF 팔레트를 뚫지 못하도록 고정한다.

따라서 PDF branding을 editorialDocument.ts에 넣으면 HTML까지 영향을 줄 수 있다. PDF 템플릿은 PDF 전용 모듈과 editorialPdf.ts 경계에만 둔다.

## 10. 이미 있는 컬러 입력 선례

사용자가 요구한 마우스 컬러피커와 6자리 HEX 입력은 툴바 설정에 이미 구현돼 있다.

- 의미 기반 색상 필드: src/ui/HanmarkSettingTab.ts:37-49
- 팔레트 preset과 reset: 282-370
- Obsidian color picker와 HEX 양방향 동기화: 372-409
- 정규화·저장·갱신: 580-625
- Obsidian API ColorComponent는 기본적으로 6자리 #RRGGBB를 사용한다: node_modules/obsidian/obsidian.d.ts:1643-1667

이 interaction을 재사용할 수 있지만 기존 툴바처럼 drag 이벤트마다 비동기 저장하면 경합 위험이 있다. PDF 위저드는 로컬 draft를 갱신하고 Apply 시 한 번 저장하는 편이 안전하다.

## 11. 현재 테스트가 고정하는 불변조건

| 계약 | 테스트 위치 |
|---|---|
| A4, 52/48 표지, named page | tests/editorialPdf.test.ts:531-617 |
| 한글 grapheme 제목 균형 배치 | 458-518 |
| Obsidian dark/light theme 격리 | 619-727 |
| 원문 inline 색 억제 | 729-778 |
| 고정 문구 | 532-541 |
| innerHTML/outerHTML/Electron 우회 금지 | 2058-2104; tests/exportCenter.test.ts:196-205 |
| asset 대기, 2 frame 조판, 중복 인쇄 차단, cleanup | 2106-2593 |
| Export Modal 선택·busy·focus | tests/exportModalUi.test.ts:5-17, 62-73 |
| 내보내기 버튼 순서 | tests/exportCenter.test.ts:92-140 |

기존 팔레트 테스트는 정확히 9개 색을 기대한다. 구현 시 다음 두 계약으로 나눠야 한다.

1. 기본 프로필은 2.5.5의 정확한 9색과 문구를 재현한다.
2. 사용자 프로필은 정규화와 대비 불변식을 만족한다.

조사 중 관련 테스트 60개를 실행했고 모두 통과했다. 이는 728b2b3 기준선의 확인이며 아직 2.5.6 기능 테스트가 아니다.

## 12. 안전한 변경 경계

| 계층 | 역할 |
|---|---|
| 새 순수 모듈 | 타입, 기본값, clone, normalize, HEX·대비·팔레트 계산, 문구 제한 |
| settings.ts | version 9, 중첩 PDF template 영속화 |
| Export Modal | draft 위저드, 현재 스타일 요약, 명시적 적용 |
| Settings Tab | 영구 기본값 편집 진입점 |
| main.ts | 정규화된 immutable snapshot 캡처와 전달 |
| editorialPdf.ts | resolved palette와 안전 문구를 CSS/DOM에 적용 |
| styles.css | 위저드·미리보기 UI만 담당 |

EditorialPdfService의 asset 대기, 인쇄 잠금, body class, watchdog, cleanup에는 템플릿 로직을 섞지 않는다. styles.css로 PDF 팔레트를 이동하지도 않는다. 요청별 인라인 print CSS가 host theme 격리를 유지하기에 적합하다.

## 13. 한계

- 이 문서는 코드 구조와 현재 테스트를 조사한 것이며 제안한 파일 분리가 유일한 구현법임을 증명하지 않는다.
- Obsidian과 Chromium의 향후 API 변경은 별도 검증이 필요하다.
- 실제 설정 데이터의 다양한 손상 사례는 구현 시 fixture로 추가 조사해야 한다.

## 14. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-08-10 | 2.5.5 PDF 호출·설정·CSS·DOM·테스트 경계를 최초 기록 |
