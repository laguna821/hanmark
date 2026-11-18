# R-031 — 내장 DOCX 작성기 (Pandoc 없이 DOCX 내보내기와 미리보기)

- 상태: REQUIRED (구현·검증 완료, 눈으로 볼 항목은 7절)
- 작성일: 2026-11-18
- 최종 갱신: 2026-11-18
- 기준 버전/커밋: HanMark 2.7.1 + M1(R-029, Kordoc 4.25.0) `fa108aa` → 작업 브랜치 `m7-docx`
- 관련 문서: R-006(문서 모델), R-021(노트 조립·각주), R-029, 3.0.0 통합 계획 4절
- 담당 범위: DOCX 생성 엔진, Word 템플릿 스타일 생성 공유, DOCX 엔진 설정, 내보내기·미리보기 연결

## 1. 조사 질문

DOCX 내보내기와 DOCX 미리보기를 Pandoc 설치 없이, 다른 형식과 같은 수준의 결정성(같은 노트 → 같은 바이트)으로 제공할 수 있는가? 지금의 Word 템플릿 설정을 그대로 쓸 수 있는가?

## 2. 범위

### 포함

- Markdown → 공용 문서 모델(`editorialDocument.ts`) → WordprocessingML 꾸러미 작성기 `src/io/docxWriter.ts`
- Word 템플릿(`WordTemplateSpec`)에서 스타일·쪽·글꼴표를 만드는 코드의 공유(`wordReferenceDoc.ts`)
- DOCX 엔진 설정(`docxEngine`), 내보내기 창·명령·미리보기 연결, 한/영 문구
- Pandoc 경로는 "고급 (Pandoc)" 선택지로 유지

### 제외

- LaTeX 수식을 Word 수식 개체(OMML)로 바꾸기. 변환기가 따로 필요해 Pandoc 경로에 남긴다.
- 인용·참고문헌 처리(citeproc). 지금 Pandoc 경로도 쓰지 않는다.
- Windows Word PDF 미리보기(선택 기능, 그대로 둔다).
- 공문서(HWPX) 코드. 다른 작업 브랜치(양식 재정리)와 겹치지 않게 손대지 않았다.

## 3. 조사 방법과 증거

| 증거 | 유형 | 재현 또는 위치 | 신뢰도/한계 |
|---|---|---|---|
| Pandoc 호출 인자 | 소스 | `src/legacy-port/pandocDocx.ts`, `word-assets/docx_style_map.lua` | 높음 |
| 단위·꾸러미·왕복 테스트 | 재현 | `node --import tsx --test tests/docxWriter.test.ts` (19개) | 높음 |
| Kordoc `parse`로 다시 읽기 | 재현 | 같은 테스트의 왕복 항목(노트 3종) | 높음. Kordoc DOCX 읽기는 굵게·기울임을 내지 않아 글자 서식은 XML로 확인 |
| docx-preview 렌더 | 재현 | `node --import tsx scripts/test-docx-writer.mjs` (Chrome) | 높음. 미리보기 창과 같은 라이브러리 |
| Microsoft Word 열기 | 재현 | 플러그인 밖 검증 스크립트(Word COM, `OpenAndRepair=False`), PDF 내보내기 | 이 PC의 Word 한 판 |
| Pandoc 3.9와 구조 비교 | 재현 | `node --import tsx scripts/compare-docx-pandoc.ts <폴더> <pandoc>` | 문단 스타일·개수 수준 |
| 번들 검사 | 재현 | `scripts/check-bundle.mjs`, `check-community.mjs` | 높음 |

## 4. 확인된 사실

### 4.1 Pandoc이 하던 일

1. 인자는 `--from gfm+footnotes+pipe_tables+task_lists --to docx --standalone --reference-doc … --lua-filter …`뿐이다. citeproc·참고문헌·수식 옵션은 없다.
2. Lua 필터는 문단에 스타일 이름만 붙인다: Heading 1~6, 제목 바로 뒤 First Paragraph, 그 밖 Body Text, 인용 Block Text, 코드 Source Code.
3. Word 템플릿의 스타일은 이미 HanMark가 만든다. Pandoc에서 받는 것은 기본 `reference.docx`(바탕 파일)와 본문 변환뿐이다.
4. Kordoc 4.25.0에는 DOCX를 만드는 기능이 없다(`parseDocx` 읽기만).

### 4.2 내장 작성기가 만드는 것

| 노트 구조 | Word 구조 |
|---|---|
| 제목 1~6 | `Heading1`~`Heading6` 문단 |
| 문단 | 제목 바로 뒤 `FirstParagraph`, 그 밖 `BodyText` (Lua 필터와 같은 규칙), 정렬은 `w:jc` |
| 굵게·기울임·취소선·밑줄·형광·위/아래첨자·글자색·배경색 | 런 속성(`w:b`, `w:i`, `w:strike`, `w:u`, `w:highlight`, `w:vertAlign`, `w:color`, `w:shd`) |
| 인라인 코드 | `VerbatimChar` 글자 스타일 |
| 강제 줄바꿈 | `w:br` |
| 외부 링크(http, https, mailto, tel) | `w:hyperlink` + 외부 관계, `Hyperlink` 글자 스타일 |
| 위키링크 | 표시 글자 |
| 순서·비순서 목록(9단계) | `numbering.xml`. 목록마다 자기 인스턴스라 번호가 다시 시작하고, 1이 아닌 시작 번호는 전용 정의를 둔다 |
| 할 일 목록 | ☐ / ☑ 글자 + 내어쓰기 |
| 목록 항목 안의 다른 블록 | 같은 단계 들여쓰기 문단 |
| 인용문 | `BlockText`, 겹친 인용은 더 들여씀 |
| 콜아웃 | `CalloutTitle`(종류 이름) + `CalloutBody`(왼쪽 선과 음영) |
| 코드 블록 | `SourceCode` 한 문단, 줄마다 `w:br`, 공백 보존 |
| 가로줄 | 아래 테두리만 있는 빈 문단 |
| 표 | `w:tbl`, 머리행 반복(`w:tblHeader`), 열 정렬, 칸 안 인라인 서식, 본문 폭에 맞춘 고정 열 폭 |
| 각주 | `footnotes.xml`의 실제 각주와 `w:footnoteReference` |
| 그림(PNG·JPEG·GIF·BMP) | `word/media`에 넣고 `wp:inline`으로 배치. 96dpi 크기, 본문 폭 초과 시 비율 유지 축소. 같은 그림은 한 번만 저장 |
| 노트 조립(`![[노트]]`) | 다른 내보내기와 같은 준비 단계를 거친 뒤 변환 |
| 속성(front matter) | 다른 내보내기처럼 제외 |
| 문서 제목 | `docProps/core.xml`의 `dc:title` |

### 4.3 넣지 않는 것과 알림

조용히 빠지는 것이 없도록, 다르게 쓴 내용은 개수와 함께 내보내기 결과에 알린다.

| 내용 | 처리 | 알림 문구 키 |
|---|---|---|
| 수식 `$…$`, `$$…$$` | 원문 그대로 `MathText` 글자 스타일로 넣는다(백슬래시와 줄 보존) | `docx.notice.math` |
| 넣을 수 없는 그림 | 대체 글 `[…]` | `docx.notice.imageNotEmbedded` |
| 노트 안·다른 노트 링크 | 글자만 | `docx.notice.linkNotExternal` |
| 같은 각주를 다시 가리킴, 각주 안의 각주 | 위첨자 번호(Word는 각주당 참조 하나) | `docx.notice.footnoteRepeated` |
| 본문과 짝이 안 맞는 각주 | 개수 알림 | `docx.notice.footnoteMissing` |
| 콜아웃 접힘 표시 | 펼친 상태로 | `docx.notice.calloutFold` |
| 읽을 수 없는 색 값 | 미적용(문서 모델이 통과시키는 색은 모두 처리해 실제로는 발생하지 않는다) | `docx.notice.colorNotApplied` |
| 불러오지 못한 그림 | HTML 내보내기와 같은 질문(다시 시도·계속·취소) 뒤 누락 표시 | `save.note.imagesMissing` |

문서 모델 자체가 버리는 것(알 수 없는 HTML 태그, 허용 목록 밖 색 이름)은 HTML·PDF 내보내기와 똑같이 빠진다. 이 작성기만의 손실이 아니다.

### 4.4 Word 템플릿 공유

- `wordReferenceDoc.ts`의 스타일·쪽·설정·글꼴표 함수를 내보내(`applyWordTemplateStyles` 등) Pandoc용 reference 문서와 내장 작성기가 **같은 코드**로 스타일을 만든다. 테스트가 두 경로의 `Heading2` 스타일 XML이 같은지 확인한다.
- 스타일 id는 그대로다(`WORD_STYLE_ID_MAP`). 작성기가 더하는 스타일은 `Compact`, `FootnoteText`, `FootnoteReference`, `CalloutTitle`, `CalloutBody`, `MathText` 6개다.
- 새로 만든 스타일의 자식 순서를 ECMA-376 순서(`CT_Style`, `CT_PPr`, `CT_RPr`)로 정렬하게 했다. Pandoc 바탕 파일에 없던 스타일을 만들 때 순서가 어긋나던 것을 고친 것이며, Pandoc 경로에도 같이 적용된다.

### 4.5 바탕 꾸러미와 라이선스

- Pandoc의 `reference.docx`와 그 스타일 문구는 GPL이라 번들에 넣지 않았다. 복사하거나 고쳐 쓰지도 않았다.
- 바탕은 작성기가 직접 쓰는 최소 XML이다: `docDefaults`만 있는 `styles.xml`, 각주 구분선 2개, 호환 모드 15 설정, 빈 글꼴표. 테마 파일은 없다.
- 스타일 이름·id(`Heading 1`, `Body Text`, `First Paragraph` 등)는 Word와 Pandoc이 공통으로 쓰는 식별자이며 저작물이 아니다.
- 새 제3자 코드는 없다(JSZip·xmldom은 이미 의존성).

### 4.6 결정성

- ZIP 항목 날짜는 1980-01-01로 고정, 항목 순서 고정, 압축 수준 고정.
- XML에 시간·난수 id가 없다(`core.xml`에 작성·수정 시각을 쓰지 않는다).
- 테스트: 노트 3종을 두 번 만들어 바이트가 같음을 확인.

### 4.7 검증 결과

| 검사 | 결과 |
|---|---|
| 단위·꾸러미·왕복 테스트 | 19개 통과(전체 492개 통과) |
| 꾸러미 온전성 | 필수 파트, 관계 대상, 목록·각주·스타일 id 참조가 모두 맞음. 모든 XML 정형 |
| Kordoc 왕복(노트 3종) | 제목 5개, 목록 번호(1~3, 5~6), 표 4행 4열, 각주 글 2개, 그림 2개, 링크가 원문과 일치 |
| docx-preview(Chrome) | 3종 모두 오류 없이 렌더. 표·그림·각주 표시 확인, 그림은 본문 폭 안 |
| Microsoft Word | 4개 파일(예시 3종 + 실제 볼트 노트 1개) 모두 복구 안내 없이 열림. 각주 2, 표 1, 그림 2, 링크 2, 목록 번호 `1. 2. / 1. 2. 3. / 5. 6.` 확인. PDF 내보내기 성공 |
| 실제 볼트 노트(10쪽, 표 4개) | Word에서 열림. 노트 링크 1개는 글자로 남기고 알림 |
| eslint, i18n(1,543키), tsc, 빌드, 번들·커뮤니티·릴리스 검사 | 통과 |
| main.js | 5,250,841바이트(+29,083). `child_process` 1곳, `fetch(` 0, `eval`·`new Function` 0. 상한 5,380,000 그대로 |
| 기존 UI 스크립트 | `test-pdf-export-ui`, `test-toolbar-ui` 통과. `test-preview-ui`는 HWPX 미리보기 쪽 수 기대값(8쪽) 때문에 실패하는데, M1 기준 브랜치에서도 같은 실패다(9쪽). 이 작업과 무관 |

### 4.8 Pandoc 3.9와 구조 비교 (같은 노트, 같은 템플릿)

| 항목 | 내장 | Pandoc 경로 | 비고 |
|---|---|---|---|
| 제목 1·2·3 | 1·3·1 | 1·3·1 | 같음 |
| 표 / 행 / 머리행 | 1 / 4 / 1 | 1 / 4 / 1 | 같음 |
| 각주 / 참조 | 2 / 2 | 2 / 2 | 같음 |
| 외부 링크 | 2 | 2 | 같음 |
| 그림 | 2 | 2 | 같음 |
| 목록 문단(`Compact`) | 31 | 31 | 같음 |
| 번호 매긴 문단 / 목록 인스턴스 | 13 / 7 | 15 / 8 | Pandoc은 할 일 항목도 목록으로 둔다. 내장은 ☐·☑ 내어쓰기 문단 |
| 인용문 | `BlockText` 2 | `BodyText` | Lua 필터가 인용 안 문단을 Body Text로 다시 싸서 Pandoc 쪽이 인용 스타일을 잃는다 |
| 콜아웃 | `CalloutTitle` + `CalloutBody` | 인용과 같은 문단 | 내장만 구분 |
| 제목 뒤 첫 문단 | `FirstParagraph` 2 | 1 | Pandoc은 각주 든 문단에서 규칙이 달라진다 |
| 수식 | 글자 + 알림 | Word 수식 개체 | Pandoc 경로의 장점 |

## 5. 해석과 제안

- 기본 엔진을 내장으로 바꾼다. 설치가 필요 없고 Windows·macOS에서 같은 파일이 나온다.
- Pandoc은 설정의 "고급 (Pandoc)"으로 남긴다. 고를 때 `pandoc --version`을 실행해 보고, 실행되지 않으면 내장을 유지한다. 사용자 조작으로만 실행하는 경계(`userProcess.ts`)는 그대로다.
- 이전 사용자: 저장된 설정에 `docxEngine`이 없고 Pandoc 경로를 직접 지정해 둔 경우(`pandoc`이 아닌 값)에만 Pandoc 엔진을 유지한다. 나머지는 내장으로 간다.
- 미리보기 창은 같은 생성 경로를 쓰므로 Pandoc 없이 실제 DOCX를 보여 준다.

## 6. 대안과 기각 사유

| 대안 | 장점 | 위험/기각 사유 | 재검토 조건 |
|---|---|---|---|
| Pandoc 유지 | 수식·기능 폭 | 설치 장벽으로 사용 빈도가 낮다(사용자 보고) | 없음 |
| Pandoc wasm 내장 | Pandoc 그대로 | 수십 MB, GPL 배포 조건 | 없음 |
| `docx` npm 라이브러리 | 구현량 감소 | 새 의존성, 스타일 생성 코드를 공유할 수 없음, 결정성 통제가 어렵다 | 없음 |
| Pandoc `reference.docx` 내장 | 스타일 기본값 동일 | GPL 파일 재배포 | 없음 |
| 콜아웃을 한 칸 표로 | 상자 모양 | 다시 읽을 때 표가 되고 쪽 넘김이 나쁘다 | 사용자 요청 시 |

## 7. 한계와 미해결 질문

- **눈으로 볼 것**: Word에서 표 바로 아래 문단·그림 사이 간격이 없다. 목록 줄 간격은 본문 줄 간격(기본 1.5)을 따른다. 각주 안 링크는 `Hyperlink` 스타일 크기(템플릿 값)를 따라 각주 글보다 크게 보인다.
- 미리보기 창은 지금처럼 열 때·새로고침 때 다시 만든다. 내장 엔진은 프로그램을 띄우지 않으므로 글을 고칠 때 자동으로 다시 그리게 할 수 있다(후속 작업 후보).
- 수식 개체(OMML) 변환은 범위 밖이다. Kordoc에 LaTeX → 한글 수식 변환이 있어 재사용 가능성을 따로 조사할 만하다.
- 그림 캡션(`Image Caption`, `Table Caption` 스타일)은 Markdown에 대응 문법이 없어 쓰지 않는다.
- macOS Word와 한컴오피스 Word 호환 열기는 확인하지 않았다(이 PC에 없음). LibreOffice도 없다.
- 표 열 폭은 균등 분배다. 내용에 따른 폭 조정은 하지 않는다.

## 8. 구현 영향

- 새 파일: `src/io/docxWriter.ts`, `tests/docxWriter.test.ts`, `tests/fixtures/docxNotes.ts`, `scripts/test-docx-writer.mjs`, `scripts/write-docx-samples.ts`, `scripts/compare-docx-pandoc.ts`
- 변경 파일: `src/io/editorialDocument.ts`(구조화 파싱 `parseEditorialBlocks`, HTML·PDF 모델은 불변), `src/legacy-port/wordReferenceDoc.ts`(공유 함수·순서 정렬), `src/io/docxExport.ts`(엔진 선택·내장 경로·알림), `src/legacy-port/settings.ts`(`docxEngine`), `src/ui/HanmarkSettingTab.ts`(엔진 선택), `src/main.ts`(연결 4곳), `src/i18n/ko.ts`·`en.ts`(문구), `tests/exportCenter.test.ts`, `package.json`(`test:docx-writer`)
- 유지해야 할 불변조건: `main.js`의 `child_process` 1곳, 네트워크 0, 같은 노트·템플릿 → 같은 바이트, HTML·PDF 문서 모델 불변(테스트로 고정)
- 마이그레이션: `normalizeDocxEngine`(5절). 설정 버전은 올리지 않았다.
- 보안·개인정보: 내장 경로는 프로그램 실행·임시 파일·네트워크가 없다.

## 9. 검증 조건

- 자동 테스트: `node scripts/run-tests.mjs`(492개), `npm run test:docx-writer`(Chrome)
- 수동 테스트: Word에서 예시 3종 열기(복구 안내 없음), 설정에서 엔진 전환, Pandoc 없는 PC에서 DOCX 내보내기와 미리보기
- 완료 기준: 위 검사 통과, Pandoc 미설치 상태에서 DOCX 내보내기·미리보기 동작

## 10. 출처

- 저장소 소스: `src/legacy-port/pandocDocx.ts`, `word-assets/docx_style_map.lua`, `src/legacy-port/wordReferenceDoc.ts`, `src/io/editorialDocument.ts`
- 공식 문서: ECMA-376 Part 1(WordprocessingML: `CT_Style`, `CT_PPr`, `CT_RPr`, `CT_Settings`, 각주·번호 매기기)
- 사용자 제공 증거: 2026-11-18 사용자 결정(내장 DOCX 작성기를 3.0.0에 넣는다)

## 11. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-11-18 | 최초 작성(구현·검증 결과 기록) |
