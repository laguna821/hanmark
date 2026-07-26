# HanMark 2.4.4 후속 조사: DOCX 미리보기, 순수 Markdown 가져오기, Kami HTML

조사일: 2026-07-26  
기준 버전: HanMark 2.4.4 / Kordoc 4.2.5  
성격: 구현 전 기술·UX·Community 심사 영향 조사

## 결론

네 가지 요청은 모두 구현 가능하다. 다만 한 번에 큰 기능으로 묶기보다
다음 두 단계로 나누는 편이 회귀와 Community 심사 위험이 가장 낮다.

1. **2.4.5 — Preview & Migration**
   - DOCX 미리보기 버튼을 누르면 새로 고침 없이 즉시 화면을 표시한다.
   - 성공·대기 안내문은 종이 위에서 없애고, 오류만 본문에 남긴다.
   - DOCX 종이를 좁은 leaf에 맞게 축소하되 Word 쪽 나눔은 유지한다.
   - 새 문서 가져오기는 YAML, 원본 안내 callout, 원본 캐시 없이 순수
     Markdown과 첨부 이미지만 만든다.
   - 통합 내보내기에서 `원본 형식 보존` 카드를 제거한다.
   - 기존 가져오기 노트의 레거시 수정 명령은 한두 버전 동안 명령
     팔레트에만 남긴다.
   - 현재 Scorecard의 불필요한 타입 단언 경고를 제거한다.

2. **2.5.0 — Achmage Editorial HTML**
   - 기존 HTML 문자열 변환기를 유지하면서 Kami 원칙과 실제 강의
     보고서 외형을 옮긴 `Achmage Editorial` 정적 테마를 추가한다.
   - 원격·Vault 이미지는 내보내기 시 실제 데이터 URI로 포함한다.
   - 외부 CDN, JavaScript, 상업용 글꼴, Python, WeasyPrint를 요구하지
     않는 자체 포함 HTML을 만든다.
   - 기존 `Classic` 테마도 호환 옵션으로 남긴다.

자동 첫 미리보기는 Scorecard 때문에 불가능한 기능이 아니다. 현재 한 번
더 새로 고침해야 하는 동작은 2.4.3에서 **Obsidian 시작 또는 workspace
복원만으로 Pandoc이 실행되지 않게** 의도적으로 걸어 둔 게이트 때문이다.
사용자가 툴바·명령·내보내기 창에서 DOCX 미리보기를 직접 누른 행위와
workspace lifecycle을 구분하면 편의성과 안전성을 동시에 만족할 수 있다.

---

## 1. 현재 Community 상태와 변경 원칙

2026-07-26의 공개 페이지는 HanMark 2.4.4를 `Health: Excellent`,
`Review: Satisfactory`로 표시한다. 현재 알려진 두 경고는 다음과 같다.

1. `child_process`를 쓰는 선택적 Pandoc·Word·파일 관리자 경계
2. `src/legacy-port/wordFontCatalog.ts`의 불필요한 타입 단언

두 번째는 코드를 고치면 제거할 수 있다. 첫 번째는 Pandoc DOCX와 파일
위치 보기 기능을 유지하는 한 정직한 capability 경고로 남을 가능성이
높다. 자동 첫 미리보기를 추가하더라도 다음 조건을 지키면 새로운
process 경계나 background-execution 유형을 만들 필요가 없다.

- 기존 단일 `spawn(..., shell: false)` 경계를 재사용한다.
- 앱 시작, workspace 복원, leaf 복원, 노트 변경만으로 실행하지 않는다.
- 툴바·명령·내보내기 창에서 사용자가 DOCX 미리보기를 직접 눌렀을
  때만 일회성 사용자 동작 토큰을 만든다.
- README의 capability 설명을 “DOCX 미리보기 버튼을 누르면 한 번
  Pandoc을 실행한다”로 정확히 갱신한다.
- HTML 테마에는 외부 script, CDN, 동적 코드 실행을 넣지 않는다.

Obsidian은 모든 새 버전을 자동 검사하고, scorecard의 경고·권고가
오탐일 수도 있음을 공식적으로 설명한다. 따라서 목표는 경고 문구를
우회하는 것이 아니라 실제 동작과 disclosure가 일치하는 구조다.

---

## 2. DOCX 미리보기가 첫 화면에서 비는 정확한 원인

### 현재 호출 흐름

1. 툴바 또는 명령이 `main.toggleDocxPreview()`를 호출한다.
2. `setViewState()`가 `DocxPreviewView.onOpen()`을 실행한다.
3. `onOpen()`은 `view-open` 트리거를 보낸다.
4. `isUserInitiatedFastPreviewTrigger()`는 현재
   `toolbar-refresh`와 `mode-selection`만 사용자 동작으로 인정한다.
5. 따라서 첫 열기에서는 안내문만 그리고, 새로 고침 뒤에야 Pandoc
   DOCX를 만든다.

관련 코드:

- `src/main.ts:590-603`
- `src/ui/DocxPreviewView.ts:213-282`
- `src/ui/DocxPreviewView.ts:331-404`
- `src/ui/DocxPreviewView.ts:425-468`
- `src/ui/docxPackagePreview.ts:14-20`
- `src/ui/docxPackagePreview.ts:39-43`
- `src/io/docxExport.ts:242-291`

이 동작은 커밋 `a920555`에서 보수적으로 도입됐고,
`tests/docxPreview.test.ts` 및 `scripts/check-bundle.mjs`가
“lifecycle event는 Pandoc을 실행하지 않는다”는 계약을 고정한다.

### 권장 동작: 즉시 의미 미리보기 → 실제 DOCX 자동 승격

사용자가 DOCX 미리보기 버튼을 누르면 다음 순서로 작동하게 한다.

1. view를 열자마자 인프로세스 의미 기반 미리보기를 즉시 표시한다.
2. 버튼 클릭 지점에서 만든 `UserInitiatedAction`을
   `toggleDocxPreview(action)`에 전달한다.
3. `setViewState()`가 끝난 뒤 생성된 view의
   `renderFromUserAction(action)`을 한 번 호출한다.
4. Pandoc 결과가 준비되면 같은 자리에 실제 DOCX package 렌더링으로
   조용히 교체한다.
5. Pandoc이 없거나 실패하면 이미 보이는 의미 기반 미리보기를 유지하고
   툴바에만 짧은 오류 상태를 표시한다.

중요한 경계:

- `onOpen()` 내부에서 사용자 토큰을 만들면 안 된다.
- workspace 복원으로 열린 view에는 토큰이 없으므로 Pandoc 0회다.
- 문서 입력·활성 문서 변경·템플릿 변경은 인프로세스 화면만 갱신하거나
  `변경됨` 상태로 표시한다. 실제 Pandoc은 자동 반복 실행하지 않는다.
- 동일 원본·템플릿의 실제 DOCX 결과는 session memory cache에 두면,
  닫았다 다시 열 때 process 실행 없이 즉시 복원할 수 있다.

### 알림 문구 제거

종이 위에서 제거할 요소:

- “새로 고침을 눌러 실제 DOCX를 만드세요”
- “Pandoc이 만든 실제 DOCX 패키지를 렌더링했습니다”
- “변경되어 오래된 미리보기입니다”
- 성공 시의 장문 설명

남길 요소:

- 툴바의 짧은 `role="status"` 상태:
  `생성 중`, `실제 DOCX`, `간이 미리보기`, `변경됨`
- Pandoc 미설치, 잘못된 실행 경로, 변환 실패처럼 사용자가 조치해야
  하는 오류

이렇게 하면 화면 상단 레이아웃 점프가 없어지고 실제 종이가 바로
시작된다.

---

## 3. DOCX 종이를 leaf 폭에 맞추는 방법

### 현재 문제

- `.docx-preview-container`는 `height: 100%`에 padding이 더해지지만
  `box-sizing: border-box`와 flex column 구조가 없다.
- `.docx-preview-content`가 다시 `min-height: 100%`를 차지한다.
- `docx-preview`는 Word page 폭·높이와 wrapper padding을 pt/px로
  고정한다.
- 의미 기반 paper도 `paper.style.width = ${page.widthPt}pt`로 고정된다.
- 실제 package와 의미 paper 모두 leaf 폭에 맞추는 fit-scale이 없다.
- DOM은 `.hanmark-docx-preview-*`인데 일부 CSS는
  `.docx-preview-*`를 사용해 상태 selector도 어긋나 있다.

관련 코드:

- `styles.css:1361-1370`
- `styles.css:1766-1772`
- `src/ui/DocxPreviewView.ts:147-178`
- `node_modules/docx-preview/README.md`의 `ignoreWidth` /
  `ignoreHeight` 옵션

### 권장 구현

Word 쪽 나눔을 보존하려면 단순히 `width: 100%`로 reflow시키지 않고
완성된 page 전체를 균일 축소하는 편이 낫다.

1. 최상위 view를 flex column으로 만든다.
2. toolbar는 고정하고 content만 `flex: 1; overflow: auto`로 둔다.
3. 렌더 후 `ResizeObserver`로 사용 가능한 폭과 원래 page 폭을 잰다.
4. `scale = min(1, availableWidth / pageWidth)`를 계산한다.
5. JavaScript에서 style 값을 직접 쓰지 않고 `data-fit="95"` 같은
   5% 단위 속성만 설정한다.
6. 실제 축소 값은 scoped CSS selector가 `zoom`으로 적용한다.
7. 40% 이하가 필요할 정도로 좁으면 최소 배율을 유지하고 가로 스크롤을
   허용한다.

이 방식은:

- page 내부 줄바꿈과 쪽 나눔을 바꾸지 않고,
- Chromium/Electron에서 wrapper의 실제 차지 크기도 함께 줄이며,
- 공식 self-check의 “JavaScript로 임의 스타일을 주입하지 말라”는
  원칙과도 충돌을 줄인다.

`docx-preview`의 `ignoreWidth: true`는 빠른 대안이지만, 본문이 좁은
leaf 폭으로 다시 흐르면서 Word와 쪽 나눔이 더 달라질 수 있어 기본안으로
권장하지 않는다.

---

## 4. 문서 가져오기를 순수 Markdown migration으로 바꾸기

### 현재 가져오기 동작

`src/io/kordocImport.ts`의 `importOne()`은 현재 모든 지원 형식에 대해:

1. Kordoc 파싱
2. 이미지 저장 및 링크 rewrite
3. 원본 SHA-256 계산
4. 원본 전체 bytes를 plugin source cache에 복제
5. `hwp-source-*` 계약 작성
6. 상단 원본 안내 callout 삽입
7. frontmatter 삽입

을 수행한다.

HWP/HWPX뿐 아니라 실제 source patch가 불가능한 PDF, DOCX, XLS,
XLSX에도 원본 캐시와 계약을 만드는 점은 “모든 문서를 Markdown 편집
시스템으로 이관한다”는 새 철학과 맞지 않는다.

현재 생성 키:

- `hwp-source`
- `hwp-source-cache`
- `hwp-source-format`
- `hwp-source-hash`
- `hwp-source-bytes`
- `hwp-imported-at`
- `hwp-kordoc`

상단 callout은 원본 경로와 “저장 시 원본 구조에 패치”한다는 설명을
넣는데, 일반 Markdown 저장과 실제 동작도 혼동하게 한다.

### 새 기본 계약

새 import 결과는 정확히 다음만 가져야 한다.

```text
Kordoc이 파싱한 Markdown 본문
실제 Vault 첨부 경로로 다시 쓴 이미지 링크
```

제거:

- HanMark 생성 YAML
- 원본 안내 callout
- 원본 SHA·크기·시간
- 원본 전체 cache
- source patch용 계약

유지:

- 이미지 저장과 link rewrite
- 파일별 parse 경고
- 이미지 누락/실패 경고
- bulk import 결과 보고
- 이름 충돌 방지

실제 오류 경고는 안전 정보이므로 없애지 않는다. 사용자가 지적한
“...에서 불러왔습니다”와 원본 보존 약속만 없앤다.

### 내보내기 UI와 레거시 호환

2.4.5에서는:

- 통합 내보내기의 `원본 형식 보존` 카드를 제거한다.
- 새 import는 source contract를 만들지 않는다.
- 기존 command ID `patch-hwp-experimental`은 기존 hotkey와 오래된
  노트를 위해 `고급·레거시: 원본 형식 보존 수정본`으로 명령 팔레트에만
  한두 버전 남긴다.
- 기존 노트의 YAML/callout을 자동 삭제하거나 원본 cache를 자동
  지우지 않는다.
- 기존 노트의 quick HWPX/DOCX/preview가 YAML과 생성 callout을
  계속 제외하도록 `extractEditableBody()` 호환 코드는 유지한다.
- 필요하면 `일반 Markdown 사본 만들기` 명령을 추가해 기존 노트를
  건드리지 않고 정리된 새 `.md`를 만든다.

레거시 patch를 즉시 전부 삭제하면 기존 사용자의 저장 위치와 파일명까지
바뀔 수 있으므로, UI 제거와 내부 삭제를 한 release에 묶지 않는 편이
안전하다.

---

## 5. Kami 및 강의 보고서 분석

### 연구 사본

Achmage OS 원본은 수정하지 않고 다음 연구 사본을 만들었다.

- 위치: workspace `_research/kami-upstream-2026-07-26`
- 파일: 132개
- 크기: 79,306,745 bytes
- 검증: source와 destination의 모든 파일을 SHA-256으로 비교,
  132/132 동일
- 상태: HanMark Git 저장소 밖, 공개 release 대상 아님

`_research/KAMI_SNAPSHOT_PROVENANCE.md`에 출처·검증·라이선스 주의를
기록했다.

### Kami에서 가져올 디자인 언어

- 따뜻한 종이색 또는 깨끗한 white paper
- ink navy 한 가지 강조색과 보조 teal
- serif 중심의 제목·본문 계층
- 얇은 hairline, 왼쪽 chapter bar
- 약한 ivory callout
- 숫자와 distinctive phrase만 제한적으로 강조
- A4 print rule, widow/orphan, heading break 방지
- 표의 강한 header와 읽기 쉬운 alternating row
- 4pt 기반 spacing rhythm

### 실제 강의 reports 분석

분석 위치:

`2. 학부강의/- 2026-1학기/AI활용조사방법론/AI활조방 글쓰기 메타분석 모음/reports`

확인 결과:

- HTML 21개
- 모든 문서가 동일한 4,458-byte inline CSS 사용
- script 0개
- event handler 0개
- 외부 stylesheet 0개
- 각 문서 table 3개
- masthead + ACH navy/blue/teal + A4 white paper 구조

대표 외형은 `reports/20202582_최승묵.html`과 생성 template
`reflective-archive-metacognition/assets/templates/report-ko-ach.html`에서
확인했다.

### 그대로 복사하면 안 되는 것

- Kami 전체 79MB skill
- Python build script
- WeasyPrint 설치 경로
- `TsangerJinKai02` 상업용 TTF 두 개
- 15MB가 넘는 Source Han Serif OTF 두 개를 plugin bundle에 포함
- jsDelivr `@main` font URL
- 학생 보고서 본문
- exported HTML의 JavaScript

Source Han Serif K는 OFL이지만 Regular+Medium 원본을 base64로
HTML마다 넣으면 약 20MB가 추가된다. 기본 HTML에 폰트를 내장하는 것은
크기 면에서 부적절하다.

---

## 6. 권장 HTML 엔진: Achmage Editorial

### 구조

기존 `src/legacy-port/htmlExport.ts`의 안전한 Markdown block 변환을
버리지 않는다. 새로 필요한 것은 다음 네 층이다.

1. `HtmlExportTheme = "achmage-editorial" | "classic"`
2. theme token 및 정적 CSS 생성기
3. title을 넣는 masthead wrapper
4. 이미지 asset resolution 및 data URI 포함 단계

기본 선택:

- 새 설치: `Achmage Editorial`
- 기존 사용자: 저장된 값이 없으면 새 기본을 쓰되 `Classic`으로
  즉시 되돌릴 수 있게 한다.

### deterministic의 정확한 의미

첫 버전에서 보장할 것:

- 같은 Markdown은 같은 semantic HTML 구조를 만든다.
- 같은 설정은 같은 inline CSS와 색상·간격·표 구조를 만든다.
- script, CDN, 외부 stylesheet가 없다.
- 이미지 bytes가 같으면 같은 data URI를 만든다.
- offline에서 문서 내용과 이미지가 모두 열린다.

첫 버전에서 보장하지 않을 것:

- OS와 브라우저가 달라도 glyph metrics와 줄바꿈이 pixel-identical
- 사용자의 시스템 글꼴 차이까지 제거한 bitwise-identical screenshot

기본 font stack:

```css
"Source Han Serif K", "Noto Serif KR", "KoPub Batang",
"AppleMyungjo", "Batang", Georgia, serif
```

추후 사용자가 명시적으로 선택한 라이선스 허용 글꼴을 현재 private
font cache에서 읽어 HTML 한 파일에 포함하는 `글꼴도 포함` 옵션을 별도
실험 기능으로 검토할 수 있다.

### 이미지

현재 HTML exporter는 원격 image URL을 그대로 남길 수 있어 완전한
self-contained 결과가 아니다. 새 경로는:

1. 기존 Vault/remote image gateway로 bytes를 읽는다.
2. PNG/JPEG/GIF/WebP만 허용한다.
3. 크기·개수·총 byte budget을 검사한다.
4. `data:image/...;base64,`로 변환한다.
5. 실패한 이미지는 조용히 지우지 않고 내보내기 전 결과 보고에 남긴다.

첫 버전에서는 SVG를 제외하거나 별도 sanitizer를 거친 경우만 허용한다.

### 보안

생성 HTML head에 다음과 같은 CSP를 넣는다.

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; font-src data:;
               style-src 'unsafe-inline'; connect-src 'none';
               object-src 'none'; frame-src 'none';
               base-uri 'none'; form-action 'none'">
```

URL allowlist:

- link: `https:`, `http:`, `mailto:`
- image: asset resolver가 만든 raster `data:`만

금지:

- `javascript:`
- 임의 protocol
- external CSS/JS/font
- HTML export preview를 Obsidian DOM에 `innerHTML`로 삽입
- 사용자 CSS raw injection

Kami의 실질적 CSS를 옮기는 경우 MIT notice를
`THIRD_PARTY_NOTICES.md`와 exported HTML comment에 남긴다.

---

## 7. PDF는 다음 단계로 미루는 이유

Kami의 원래 PDF 경로는 WeasyPrint와 Python을 사용한다. 이를 HanMark의
“무설치” 철학에 그대로 넣으면 Python·native library 의존성이 다시
생긴다.

2.5.0에서는 먼저 Achmage Editorial HTML을 안정화하고, PDF는 이후:

1. 같은 HTML/CSS를 전용 print view에 렌더링
2. Obsidian/Electron의 기존 print dialog에 넘김
3. 사용자가 직접 PDF로 저장

하는 방향을 조사한다.

headless Chromium 자동 실행, WeasyPrint 내장, PDF native module 추가는
초기 범위에서 제외한다.

---

## 8. 구현 순서

### 2.4.5 — Preview & Migration

1. `explicit-open` 사용자 동작 토큰 추가
2. 즉시 semantic preview + 실제 DOCX one-shot upgrade
3. 성공/대기 안내문 제거, toolbar status로 이동
4. DOCX page fit-scale 및 responsive flex 구조
5. `importOne()`을 순수 Markdown output builder로 분리
6. 새 import의 frontmatter/callout/cache 생성 제거
7. export modal에서 `source-patch` 제거
8. 레거시 command-palette patch 경로 유지
9. 불필요한 `MutableFontFaceSet` 단언 제거
10. README capability/import/preview 설명 갱신

### 2.5.0 — Achmage Editorial HTML

1. HTML theme type과 설정 추가
2. static token/CSS module 구현
3. masthead 및 semantic block mapping
4. async image resolver와 byte budget
5. CSP 및 strict URL allowlist
6. Classic compatibility theme 유지
7. MIT/OFL third-party notice 정리
8. representative Markdown fixture를 HTML snapshot으로 검증
9. screen 320/480/768/1200px 및 print preview 확인

---

## 9. 필수 테스트

### DOCX preview

- workspace restore: Pandoc 0회
- 툴바/명령/내보내기 창 직접 열기: 실제 build 1회
- 열자마자 semantic preview가 먼저 존재
- 성공 뒤 장문 notice DOM 없음
- document change: process 0회, status만 `변경됨`
- 동일 source/template session cache: process 없이 재표시
- 320/480/800/1200px에서 page가 잘리지 않음
- A4 portrait/landscape에서 원래 pagination style 유지

### Import

- HWP/HWPX/PDF/DOCX/XLS/XLSX 결과에 HanMark YAML 0개
- 생성 source callout 0개
- default import에서 `cacheSource()` 0회
- 이미지 저장·링크 rewrite 유지
- 실제 parse/image 경고 유지
- 기존 contract note의 preview/export 정상
- export modal에 source-patch 카드 없음
- old command ID와 hotkey 호환
- 원본 파일 비덮어쓰기

### HTML

- script/event handler/external link stylesheet 0개
- CSP 존재
- `javascript:` 및 임의 protocol 차단
- 원격/Vault 이미지가 허용된 raster data URI로 포함
- 이미지 실패 보고
- table/list/blockquote/code/callout/heading snapshot
- Classic theme 회귀 없음
- 생성 결과 offline open
- bundle에 Tsanger, Source Han OTF, Python, WeasyPrint 없음

### 전체

- `npm ci --omit=optional`
- `npm run check`
- Windows/macOS 실제 DOCX preview
- Community branch Preview Scan
- `main.js` native/optional module guard

---

## 10. 완료 조건

- DOCX 미리보기 버튼을 한 번만 눌러도 빈 화면 없이 즉시 내용이 보인다.
- 앱 시작과 workspace 복원은 Pandoc을 실행하지 않는다.
- DOCX 종이는 좁은 leaf에서 균일 축소되고 잘리지 않는다.
- 새 import note는 본문과 이미지 링크만 가진다.
- 통합 내보내기에서 `원본 형식 보존`이 보이지 않는다.
- 기존 imported note는 자동 파괴·자동 삭제되지 않는다.
- Achmage Editorial HTML은 offline, script-free, CDN-free다.
- HanMark bundle과 release에 Kami 원본·상업용 글꼴·Python이 없다.
- 현재 기능 HWPX/DOCX/HTML/PDF의 기존 명령 ID와 핵심 결과가 유지된다.
- Community Preview Scan에서 새 error가 0건이고, 불필요한 타입 단언
  경고가 사라진다.
