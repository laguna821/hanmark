# R-033 — Mermaid 도식을 모든 내보내기에 그림으로 넣기

- 상태: REQUIRED (1~7절 사실은 CONFIRMED, 8절 미해결 항목은 PROPOSED)
- 작성일: 2026-11-18
- 기준 버전/커밋: 3.0.0 준비 브랜치 `3.0.0-dev` 43cc341 → 작업 브랜치 `m9-mermaid`, Kordoc 4.25.0, Pele 1.13.0
- 관련 문서: R-021(노트 조립), R-029(엔진 이식), R-031(내장 DOCX), R-014(PDF 그림 배치)
- 담당 범위: Mermaid 코드 블록의 도식 변환 단계, 형식별 출력, 색·글꼴 결정, 번들·고지

## 1. 조사 질문

노트의 Mermaid 코드 블록이 HWPX·DOCX·HTML·Editorial PDF와 두 미리보기에서 원문 줄("timeline", "section 소개", "%% @caption: …")로 찍힌다. Obsidian에서 보이는 도식을 같은 모양으로, 오프라인·결정적 변환 계약을 지키면서 모든 출력에 넣으려면 어디에 무엇을 두어야 하는가?

## 2. 범위

### 포함

- Mermaid 펜스 찾기(목록·인용·콜아웃·조립된 임베드 안 포함), `%% @caption`·`%% @alt` 주석
- 도식 엔진 번들, 색·글꼴을 문자 값으로 굳히기, PNG 래스터
- HWPX(빠른·공문서·미리보기), 내장 DOCX, Pandoc DOCX, HTML(두 테마), Editorial PDF
- 실패 처리, 설정, 번들 검사, 제3자 고지

### 제외

- `%% @key`·`@interp`·`@aux` 강조(8절)
- 통계 도표·노드 탐색 등 achmage-pele 스킬의 다른 기능
- 한글에서 도형을 개별 편집할 수 있는 벡터 삽입

## 3. 조사 방법과 증거

| 증거 | 유형 | 재현 또는 위치 | 신뢰도/한계 |
|---|---|---|---|
| Obsidian 1.14.5 실행 창 | 재현 | CLI `eval`로 `.mermaid svg` 속성·`window.pele`·`--pele-*` 계산값 확인(2026-11-18) | 높음. 1.8.9~1.13의 도식 엔진은 확인하지 않음 |
| npm `pele` 1.13.0 | 소스 | `node_modules/pele/dist`(타입 선언, `pele.js` 729,332바이트) | 높음 |
| 도식 5종 Node 렌더 | 재현 | timeline·flowchart·mindmap·sequence·gantt, 한글 라벨 | 높음 |
| 내보내기 증명 | 재현 | `scripts/test-diagram-exports.mjs` (Chrome 실행, 합성 노트와 사용자 노트) | 높음. 한컴 오피스 실표시는 확인하지 않음 |
| Word 열기 | 재현 | Word COM, 복구 끄고 열어 PDF로 내보냄 | 높음 |
| achmage-pele 스킬 1.0.0-rc.2 | 사용자 제공 | `references/hwpx.md`, `runtime/render.mjs` (읽기만) | 설계 참고 |

## 4. 확인된 사실

1. HanMark 소스에 `mermaid` 문자열이 없었다. 모든 내보내기가 Mermaid 블록을 일반 코드 블록으로 다뤘다.
2. 사용자 Obsidian(1.14.5)의 Mermaid 블록은 Mermaid.js가 아니라 **Pele**가 그린다. SVG 루트 클래스가 `pele pele-…`이고 `foreignObject`가 없으며 글자는 `<text>`다.
3. Pele SVG의 색은 전부 CSS 변수다. 루트 `style`에서 `--_fg:var(--pele-fg,#1f1f1f)`처럼 내부 변수를 정의하고 요소는 `var(--_fg)`를 쓴다. 다섯 종류 렌더에서 `color-mix()`·`calc()`·`<style>`·`<marker>`·`<filter>`는 0건이었다. 문자열 치환만으로 변수를 모두 없앨 수 있다.
4. Obsidian `app.css`가 `body, .mermaid`에서 `--pele-*`를 `--mermaid-*`·`--font-mermaid`에 연결한다. 이 볼트의 계산값은 배경 흰색, 글자·선 `#17243A`, 강조 `#016CC3`, 글꼴 `"Achmage SameTone", "Pretendard Variable", …`이고, 앱이 어두운 테마여도 같았다. 계열 색(`--pele-series-N`)은 정의돼 있지 않아 Pele 기본값을 쓴다.
5. Pele 1.13.0은 MIT(Copyright (c) 2026 kepano), 의존성 0, `eval`·`new Function`·`fetch`·동적 `import` 0건이다. 측정기를 주지 않으면 브라우저에서는 canvas로, 그 밖에서는 내장 글자 폭 표로 잰다.
6. Kordoc의 Markdown → HWPX는 그림을 **독립 문단**일 때만 그림 개체로 만든다. `<center>![…](…)</center>`와 인용문 안 그림은 배치되지 않는다. HanMark 어댑터는 `<center>`를 글자로 바꾼다.
7. SVG를 `<img>`로 그리면 문서의 웹폰트를 쓰지 못한다(격리). 컴퓨터에 설치된 글꼴과 SVG 안에 데이터로 넣은 `@font-face`만 쓴다.
8. Editorial PDF의 문서 모델은 서명 검사한 래스터 data URL만 그림으로 받는다. SVG data URL은 거부된다.
9. 번들: `main.js` 5,286,717 → 6,050,166바이트(+763,449). Pele 729KB와 도식 단계 코드다.

## 5. 설계

### 5-1. 단계 하나

`prepareExportMarkdown`(노트 조립과 같은 자리)이 조립 뒤에 `renderMermaidDiagrams`를 한 번 부른다. 모든 내보내기와 두 미리보기가 이 함수를 거치므로 형식별 복사본이 없다. 조립이 꺼져 있어도 도식 단계는 돈다. Mermaid 블록이 없는 노트는 환경(색·글꼴 조사)을 만들지 않는다.

- 펜스: ``` 와 `~~~`, 정보 문자열 `mermaid`. 목록 들여쓰기와 `>` 인용 표지를 걷고 읽는다. 다른 코드 블록 안에 보이는 Mermaid 펜스는 글자로 둔다. 닫히지 않은 펜스는 건드리지 않는다.
- 주석: `%% @caption:`은 그림 제목, `%% @alt:`는 대체 글. 주석 줄은 어느 출력에도 글자로 나오지 않는다.

### 5-2. 색과 글꼴

- 내보낼 때 창에서 `--pele-*` 변수를 색 문자 값(`#RRGGBB`)으로 계산해 SVG에 써 넣는다. 내보낸 SVG에는 `var(`가 남지 않는다(검사함).
- 계산한 배경이 어두우면(상대 휘도 0.4 미만) 문서용 기본 색으로 바꾼다. Editorial PDF는 활성 PDF 테마의 색을 문서용 색으로 쓴다. 설정 "도식 색을 문서용 기본 색으로"를 켜면 항상 문서용 색이다.
- 글꼴: 노트 글꼴 목록에서 **컴퓨터에 설치된** 첫 글꼴을 쓴다. 문서의 웹폰트이거나 설치돼 있지 않으면 HanMark가 싣고 있는 Pretendard로 그리고(그림에는 `@font-face` 데이터를 SVG에 넣어 래스터), 보고서에 한 번 알린다. 측정도 같은 글꼴로 한다.

### 5-3. 형식별 전달

| 형식 | 들어가는 것 | 제목(@caption) | 대체 글(@alt) |
|---|---|---|---|
| HWPX(빠른·공문서·미리보기) | PNG 그림, 그린 크기의 2배 화소, 가운데, 본문 폭 이하 | 그림 바로 아래 가운데 문단, 그림 문단에 "다음 문단과 함께" | 넣지 않음(Markdown → HWPX 경로에 설명 칸이 없음) |
| 내장 DOCX | PNG 그림, 가운데 | `Image Caption` 스타일, 가운데, 그림 문단에 `keepNext` | 그림 설명(`descr`) |
| Pandoc DOCX | Markdown의 PNG data URL(Pandoc이 직접 읽음) | 일반 문단 | Pandoc의 그림 대체 글 |
| HTML(두 테마) | 인라인 SVG `<figure class="hanmark-diagram">` | `<figcaption>` | SVG `<title>` |
| Editorial PDF | 인라인 SVG(글자를 고를 수 있음) | 그림 아래 가운데 8pt 문단 | SVG `<title>` |

- **그린 크기 표시**: 래스터 PNG에 사설 `tEXt` 청크 `hanmark-scale`(값 `2` 또는 제목이 따르면 `2c`)와 `pHYs`를 넣는다. HWPX 그림 파이프라인과 DOCX 작성기가 이 표시를 읽어 그린 크기로 놓고 가운데로 맞춘다. 표시가 없는 그림의 배치는 그대로다.
- **HWPX 가운데 맞춤**: 그림 문단과 제목 문단의 문단 모양을 복제해 정렬만 CENTER로 바꾼 모양을 `header.xml`에 더한다. 들여쓰기·간격은 생성기가 정한 그대로다.
- **인용·콜아웃 안 도식(HWPX)**: 그림을 인용 밖 독립 문단으로 꺼내 그 자리 바로 뒤에 둔다(사실 6). DOCX·HTML·PDF는 인용 안에 그대로 둔다. R-037부터 내보내기 보고서에 건수와 함께 한 번 알린다(`diagram-moved`).
- **HTML·PDF 전달**: SVG는 문서 모델을 통과할 수 없어(사실 8) 토큰 문단 `HMDIAGRAM(base64)`로 싣는다. HTML은 렌더 뒤 토큰 문단을 figure로 바꾸고, PDF는 문단을 만들 때 SVG를 DOM으로 넣는다. 토큰은 그리기 요소만 든 SVG일 때만 풀린다(스크립트·스타일·외부 참조·이벤트 속성·`foreignObject`·`image`·`a`·`use`가 있으면 글자로 남는다).
- **PDF 2단 배치**: 도식은 기존 그림 떠 있기 규칙(R-014)을 따른다. 그린 폭의 1.25배보다 크게 늘리지 않고 칸 안에서 가운데에 둔다.

### 5-4. 실패와 끄기

- Pele가 읽지 못하거나 지원하지 않는 블록은 지금처럼 코드 블록으로 남고, 블록마다 안내 한 건(종류, 첫 줄, 이유)이 나간다. HWPX는 보고서에, DOCX·HTML·PDF는 알림에 나온다.
- 설정 "Mermaid 도식을 그림으로"(기본 켬)를 끄면 2.7.x와 같은 출력이다. 값은 저장된다.

## 6. 대안과 기각 사유

| 대안 | 장점 | 위험/기각 사유 | 재검토 조건 |
|---|---|---|---|
| `window.pele`·Obsidian `loadMermaid` 사용 | 번들 증가 없음 | Obsidian 판마다 엔진과 결과가 달라짐. 1.8.9에는 Pele가 없을 수 있음. 결정적 변환 계약 위반 | 없음 |
| Mermaid.js 번들 | 원조 엔진 | 약 3MB, `foreignObject` 글자라 래스터·PDF에 불리, 사용자 화면과 다른 모양 | 없음 |
| 형식별 작성기마다 변환 | 작성기 맞춤 | 다섯 군데 복사, 모양 불일치 | 없음 |
| 화면의 렌더된 SVG를 DOM에서 복사 | 화면과 동일 | 노트가 읽기 보기로 열려 있어야 하고 임베드·스크롤 밖 블록은 없음 | 없음 |
| HWPX에 SVG·벡터 삽입 | 편집 가능 | Markdown → HWPX 경로가 그림 개체만 지원 | Kordoc이 도형 삽입을 지원할 때 |
| PDF에 `<img>` SVG | 그림 배치 코드 그대로 | 글자를 고를 수 없고 웹폰트를 못 씀 | 없음 |

## 7. 기기에 따라 달라지는 것

- **글꼴**: 노트 글꼴이 설치된 PC와 아닌 PC는 글자 폭이 달라 도식 배치가 달라진다. 없는 PC는 Pretendard로 그리고 알린다.
- **PNG 바이트**: 같은 PC에서는 두 번 내보내면 PNG와 HWPX·DOCX 바이트가 같다(검사함). Chromium 판이나 운영체제가 다르면 래스터 화소가 달라질 수 있다.
- **SVG 문자열**: 같은 노트·색·글꼴·날짜면 같다. 간트의 오늘 표시 때문에 날짜(그날 0시)가 입력에 든다.
- **HTML**: 열어 보는 PC에 글꼴이 없으면 브라우저 대체 글꼴로 보인다. 배치는 내보낸 PC에서 잰 값이다.

## 8. 한계와 미해결 질문

- `%% @key`·`@interp`·`@aux` 강조는 R-037에서 구현했다(핵심 노드 강조색 테두리 3, 해석 노드 점선 5 3, 보조 노드 보조 바탕). 스킬 렌더러와 같은 노드에 같은 처리를 하는 것을 같은 원문으로 대조했다.
- 폭 600px에 맞추면 Pele가 가로 타임라인을 세로로 바꾼다(`autoDirection`). 넓은 창의 Obsidian 화면과 방향이 다를 수 있다.
- HWPX 그림에 대체 글을 넣지 못한다.
- 내보내기 창 안의 스위치는 R-037에서 만들었다(형식마다 "내보낼 때" 묶음, 설정과 같은 값).
- Editorial PDF 2단 배치에서 제목 문단이 떠 있는 도식과 떨어질 수 있다(1단은 붙어 있음).
- 한컴 오피스 실표시는 확인하지 않았다. Kordoc 재렌더와 재파싱으로만 확인했다.
- Obsidian 1.8.9 창에서의 실행은 확인하지 않았다(Chrome과 Node로 확인).
- Pandoc DOCX는 그림을 가운데로 맞추지 않고 제목에 캡션 스타일을 주지 않는다.

## 9. 구현 영향

- 새 파일: `src/io/diagramStage.ts`, `src/io/diagramSvg.ts`, `src/io/pngMeta.ts`, `src/ui/diagramEnvironment.ts`, `tests/diagramStage.test.ts`, `scripts/test-diagram-exports.mjs`, `scripts/diagram-export-writers.ts`
- 바뀐 파일: `exportPreparation.ts`, `imageAssets.ts`, `docxWriter.ts`, `editorialPdf.ts`, `editorialPdfFlow.ts`, `htmlExport.ts`, `markdownAdapter.ts`(경고 코드 2개), `kordocSave.ts`, `QuickHwpxPreviewView.ts`, `main.ts`, `settings.ts`, `HanmarkSettingTab.ts`, i18n, `check-bundle.mjs`, `package.json`
- 유지해야 할 불변조건: 내보낸 SVG에 `var(` 0, 토큰은 안전 검사를 통과한 SVG만, `main.js`에 네트워크·`fs`·`eval` 0, `child_process` 1(변동 없음)
- 마이그레이션: 설정 `mermaidDiagrams`(기본 true), `mermaidPaperPalette`(기본 false) 추가. 없는 값은 기본값으로 읽는다.
- 번들 상한: 5,380,000 → 6,230,000바이트(실측 6,050,166 + 약 3%)

## 10. 검증 조건

- 자동 테스트: `tests/diagramStage.test.ts` 16개(펜스·주석·색·안전·PNG 표시·HWPX·DOCX·HTML·공용 단계), 전체 `npm run check`
- 실행 증명: `scripts/test-diagram-exports.mjs` — 합성 5종과 사용자 노트(실행 때만 읽음, 저장소에 넣지 않음). HWPX 유효성·재파싱 그림 수·가운데 정렬·바이트 반복, DOCX 그림·캡션 수·바이트 반복, HTML figure 수, PDF 인라인 SVG와 글자, 어두운 배경·글꼴 없음 경우
- 수동 확인: Word COM으로 복구 없이 열림(그림 7, Image Caption 7)
- 남은 수동 확인: 한컴 오피스 실표시, Obsidian 실창

## 11. 출처

- 저장소 소스: 9절의 파일
- 공식 문서: Pele `dist/*.d.ts`(1.13.0), <https://pele.run/api>, <https://pele.run/theming>
- 사용자 제공 증거: 2026-11-18 요청과 화면 갈무리, achmage-pele 스킬 문서

## 12. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-11-18 | 최초 작성(단계·작성기 구현과 검증 기록) |
| 2026-11-18 | R-037 반영: `@key`·`@interp`·`@aux` 강조 구현, 내보내기 창 스위치, 인용 밖으로 꺼낸 도식 알림 |
