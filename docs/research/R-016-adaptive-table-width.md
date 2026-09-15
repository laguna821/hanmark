# R-016 — 2.6.1 표 자동 폭과 배포 후보

- 상태: CONFIRMED (구현·로컬 출력 검증), 원격 동일 커밋 검사는 후보 확정 후 실행
- 작성일: 2026-09-15
- 기준: 공개 2.5.6, 로컬 PDF 개발 변경 14aeb62
- 관련 연구: R-001–R-006, R-008–R-015

## 계약

사용자가 2.6.1 구현과 후보 커밋·push·CI·Community Review branch 검사를 승인했다. 그림 A/B와 독립된 표 폭 auto/column/full을 제공하며 기본은 auto다. 설정 v11로 이관하고 1단·테마 JSON·원본 Markdown은 보존한다.

표 전체를 글꼴 로딩 후 같은 스타일로 한 단/전체 폭에서 측정한다. 한 단에서만 넘침·과대 행이 발생하면 전체 폭으로 전환한다. 머리행 3줄 이상이 2줄 이하가 되거나, 비어 있지 않은 본문 셀의 20% 이상이 4줄 이상이고 높이가 25% 이상 감소하거나, 8줄 이상 셀의 줄 수가 절반 이하가 되면 전체 폭으로 전환한다. 행 수/총 문자 수는 단독 기준이 아니다. 글자를 축소하거나 자르지 않는다.

내용에 맞는 열 너비는 전체 표에서 정하고 분할 후 고정한다. 행 단위 분할과 머리행 반복, 제목 묶음과 첫 조각의 동행, sections 경계를 보존한다. 전체 폭 표는 현재/다음 페이지에서 시작하고 4mm 간격으로 2단 본문을 채운다. 이어지는 표 조각은 연속 배치한다. 담을 수 없는 행/머리행은 세로 항목으로 전환한다.

## 실제 증거와 재현

사용자 PDF 2개(31/28쪽)와 동일 제목의 로컬 Markdown을 확인했다. 원고에는 표 20개, 6열 71행(머리행 포함) 표가 있다. 첫 PDF 14쪽 왼쪽 표에 셀 글자가 겹친다. 원고 내용·개인 경로·PDF는 저장소에 넣지 않고 익명 fixture와 검사 결과만 기록한다.

## 구현과 검증 결과

- 원본 표 → 한 단/전체 폭 비교 → colgroup 고정 → 행 분할 → 항목별 폭으로 페이지 배치 순서로 변경했다. 수동 선택은 자동 판단을 대체한다.
- 설정 v11, auto 기본값, 설정·내보내기 선택창을 연결했다. single 출력 경로에는 새 표 정책을 적용하지 않는다.
- 9pt 글꼴은 유지한다. 2단 표에 18px 줄 높이와 6px/8px 셀 여백을 명시했다. 폭 비교와 최종 출력이 같은 선언을 사용한다.
- 기존 개발 코드의 현재 Chrome 출력에서는 첨부 14쪽 겹침이 재현되지 않았다. 동일 원고 재출력의 해당 표는 기존 12쪽과 새 12쪽에서 정상이다. 첨부 산출물의 정확한 호스트 원인은 미확인으로 남긴다.
- 별도로 Edge 135의 긴 합성 부록표에서 DOM 행 위치와 PDF 문자 위치가 누적해서 어긋나는 회귀를 재현했다. t6:r29:c0 영역에서 앞 행 R27과 현재 행 R28이 함께 검출됐다. 명시적 줄 높이·셀 여백 적용 후 전체 12조합의 PDF 셀 위치 검사까지 통과했다. 폭 확대만으로 수정됐다고 판단하지 않았다.
- 각 표/행/셀에 안정적인 원본 ID를 부여한다. DOM에서 누락·중복·순서·고정 열 폭을 검사하고, 생성 PDF를 PDF.js로 다시 읽어 페이지 좌표에 해당하는 각 셀 텍스트를 대조한다. 반복 머리행은 별도 표시해 원본 중복과 구분한다.
- 본문 순서, 표 첫 조각의 원문 앵커 거리(한 페이지 이내), 연속된 표 조각의 페이지, 표·그림·본문 사이의 겹침, 셀 내부 텍스트·이미지 경계를 검사했다.

| 검사 | 결과 |
|---|---|
| npm run check | 265 tests, lint·타입·build·bundle·Community·release 검사 통과 |
| npm audit --omit=dev --omit=optional | 0 vulnerabilities |
| 저장 UI | 폭 선택 스냅샷, 취소/재시도, 사용자 클릭 활성화, native print 통과 |
| Chrome 153 합성 문서 | A/B × auto/column/full × sections 12조합 통과 |
| Edge 135 합성 문서 | 같은 12조합 통과 |
| 표 20개 실제 원고 | 2단 12조합 + 기존 1단 2조합 통과 |
| 이미지 11개 긴 실제 원고 | 자동 폭 A/B·1단 × sections 6조합 통과 |

표 원고 SHA-256: a8eecc6067c7593ddd4ec907ef84b4c12a50ad1dfa3ef5edd44e33e38c5dad01 (125,562 bytes).
자동 폭은 t8·t14 설명표와 t16의 6열 71행 부록표를 full로 선택했다. 작은 숫자 집계표 t10·t11은 column이다.

| 표 원고 출력 | sections off | sections on |
|---|---:|---:|
| 기존 개발 기준 A/B | 26 | 30 |
| 2.6.1 A/B auto | 27 | 30 |
| 2.6.1 A/B column | 27 | 30 |
| 2.6.1 A/B full | 29 | 33 |
| 기존·신규 single | 29 | 33 |

두 A/B의 페이지 수가 같은 이유는 이 원고에 이미지가 없기 때문이다. 명시적 표 줄 간격으로 가독성과 출력 위치 안정성을 확보해 총 쪽수가 늘 수도 있다. 행 수를 기준으로 무조건 확대하거나 페이지 수만 최적화하지 않는다.
이미지 11개 원고는 A 19/22쪽, B 13/17쪽, single 22/24쪽이다. 위 숫자는 표지 포함이다.

## 후보 산출물과 원격 검사 기록

- dist-plugin/hanmark-2.6.1.zip: main.js, manifest.json, styles.css 세 파일만 포함하고 원본과 ZIP 안의 바이트를 대조했다.
- dist-plugin/table-width-before-after.pdf: 첨부 겹침 예시, 현재 엔진의 이전 코드, 숫자표, 부록표를 새 자동 폭 출력과 비교한다.
- 기존 2.6.0 ZIP과 시험 PDF는 보존했다. 개인 원고·비교 PDF는 Git에서 제외된 로컬 산출물이다.
- 공개 버전 metadata, CI branch, 향후 release tag/title/notes는 2.6.1로 일치한다. 2.6.0 release notes는 미공개 개발 이력으로만 보존한다.
- 최종 commit/push 후 GitHub의 Verify plugin 3 OS와 Community Review branch를 같은 SHA로 실행한다. 실행 URL·SHA·결과는 로컬 dist-plugin/release-verification-2.6.1.json에 기록한다. 릴리스 태그 생성과 기본 브랜치 변경은 이번 작업 범위에 없다.

## 승인된 검증 범위 변경

사용자가 macOS 장비 부재를 이유로 실기 검증 생략을 명시했다. R-014의 macOS 실기 필수 배포 조건은 이 결정으로 대체한다. macOS CI는 유지하고 릴리스 문서에는 실기 미검증을 명시한다. 그 밖의 CI·Community 검사를 생략한 것으로 해석하지 않는다.

## 완료 조건

표 20개 실제 자료와 합성 경계 자료를 A/B × auto/column/full × sections 조합으로 출력한다. 숫자 집계표의 한 단 유지, 설명표와 부록표 확대, 셀/페이지 경계, 표 행·셀 순서와 누락·중복, 그림과의 공존, 설정 이관, 저장 UI를 검사한다. 로컬 전체 검사와 배포 의존성 감사 후 2.6.1 ZIP·비교 PDF를 작성한다. 최종 커밋 CI와 Community preview 결과를 별도로 기록한다.

## 출처

- 사용자 확정 계획 및 macOS 검증 생략 결정 (2026-09-15)
- src/io/editorialPdf.ts, editorialPdfFlow.ts, editorialPdfMeasure.ts
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/table-layout
- https://developer.mozilla.org/en-US/docs/Web/API/Range/getClientRects
- https://docs.obsidian.md/community-directory/manage-entry
