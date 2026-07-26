# HanMark 2

**A desktop Obsidian plugin that connects durable Markdown notes with editable Korean HWP/HWPX documents.**

HanMark 2.4.3 uses exactly pinned **Kordoc 4.2.5** for HWPX generation, import, source patching, validation, image embedding, document styles, and fast SVG preview. Creating HWPX files requires no Python, pypandoc-hwpx, Pandoc, or executable-path setup.

> Keep the source of knowledge in portable Markdown. Produce the HWPX, DOCX, or HTML that an institution requires when you need it.

[English](#english) · [한국어](#한국어)

---

## English

### What changed in 2.4.3

- **Same document features, smaller review surface:** the 2.4.2 HWPX, image, template, HTML, and optional DOCX behavior is retained in typed modules without the old compatibility bundle.
- **Safer file boundary:** imports use user-selected `File` data, Vault work uses Obsidian APIs, and source-preserving edits use a content-addressed private cache. Runtime Node filesystem access is removed.
- **Review-safe rendering:** dynamic code evaluation, clipboard access, and CSS forced-priority declarations are removed.
- **Audited production graph:** vulnerable optional transitive versions are overridden, while Sharp, ONNX, PDFium, OCR/ML, and other native extras remain excluded from installation and the startup bundle.
- **Verifiable releases:** tagged builds run Windows/macOS checks, rebuild the three Community assets, and publish GitHub artifact attestations.
- **One explicit external capability remains:** optional DOCX export can run a Pandoc executable selected by the user; optional Word-to-PDF preview runs only when the user asks for it.
- **Word workflow parity:** the resizable three-pane template editor, dirty-change guard, style links, searchable installed/custom font catalog, and actual Pandoc-generated DOCX preview remain available. External conversion starts only from a direct refresh or mode-selection action.
- **Toolbar parity:** the 2.4.2 light/dark palettes, color pickers, checklist toggle, superscript/subscript, note/warning callouts, and live-preview switch remain available.

### Core 2.x workflow

- **Kordoc 4.2.5 built in:** generates and validates HWPX without external setup and fixes same-line text around inline `treatAsChar` tables when importing form-style documents.
- **Images are real document assets:** remote HTTP(S), data-URI, and Vault PNG/JPEG/GIF/BMP images are embedded in HWPX `BinData`. Failed images are reported instead of silently becoming placeholders.
- **Reusable HWPX templates:** create, import, duplicate, rename, edit, select, and delete any number of templates.
- **Semantic document styles:** each template combines body and Heading 1–6 typography, paragraph spacing/indentation, page rules, and an optional table profile.
- **Hancom-editable styles:** generated styles expose real font names and paragraph properties in Hancom Office's toolbar and F6 style dialog.
- **Simpler export center:** HWPX work is on one tab; source patching, HTML, and optional Pandoc DOCX export are grouped under Other formats.
- **Resizable full-screen-capable dialogs:** the export center and template manager no longer depend on a narrow fixed modal.
- **No pypandoc-hwpx HWPX workflow:** old Python installation and executable-path setup are retired from all HWPX commands and settings.

### Export modes

| Location | Output | Engine | External setup |
| --- | --- | --- | --- |
| HWPX | Quick HWPX | Kordoc 4.2.5 + selected template | None |
| HWPX | Korean public-document HWPX | Kordoc 4.2.5 preset | None |
| Other formats | Separate patched HWP/HWPX copy | Kordoc 4.2.5 | None |
| Other formats | HTML | Built-in HanMark writer | None |
| Other formats | DOCX | Pandoc + HanMark Word template | Optional Pandoc only |

Pandoc settings appear only for DOCX. HWPX and HTML do not read the Pandoc path.

The fast DOCX preview renders an actual Pandoc-generated DOCX package after you select its mode or press **Refresh**. Opening the view, typing, changing the active note, or changing a template only marks the existing preview as stale; it never starts Pandoc in the background. If DOCX generation is unavailable, HanMark falls back to the semantic browser preview.

### Quick start

1. Install and enable **HanMark** from Obsidian's Community plugins browser.
2. Open the Markdown note you want to export.
3. Select **HWPX** in the toolbar or run **HanMark: Export** from the command palette.
4. Choose a built-in or custom template and select **Create HWPX**.

The HWPX template button opens the template library. Built-in templates are immutable: duplicate one before editing it. Custom templates are Vault-wide and can be renamed or removed.

### Images

Each unique image is loaded once and can be placed multiple times. Remote images need a network connection on their first load; preview and export share an in-memory cache during the current Obsidian session. If an image cannot be downloaded, resolved from the Vault, decoded, or placed in the HWPX, HanMark asks whether to retry, continue with an explicit missing-image label, or cancel.

### Document styles and fonts

- Body and Heading 1–6 are written as independent named HWPX styles.
- Each logical font is connected to the same font ID across the HWPX language tables, so Hancom Office can recognize the actual family name.
- The Word template manager accepts exact family-name entry, a searchable recommended/document font catalog, user-triggered installed-font discovery, and explicitly selected TTF/OTF/TTC/WOFF/WOFF2 files or folders.
- Custom font files are copied to a private, content-addressed plugin cache and are used only for Obsidian's Word-template/DOCX preview. They are not embedded in HWPX or DOCX.
- HWPX stores font names, not font files. A computer without the requested font may show a substitute.
- For documents shared between Windows and macOS, use a font available on both systems where possible.
- Markdown beginning with `##` uses Heading 2. HanMark does not silently shift heading levels.
- Paragraph indentation and spacing use pt, matching Hancom Office's F6 dialog; page margins use mm.

Users who added a preview font by filesystem path in HanMark 2.4.2 may need to select that font file once in 2.4.3. The stored font family and document template remain intact; only the safer private preview copy is newly required.

### Import and source-preserving edits

HanMark imports HWP, HWPX, PDF, DOCX, XLSX, and XLS documents as Markdown. Extracted images are saved through Obsidian's attachment policy and links are rewritten to their real Vault paths. The existing `hwp-source-*` frontmatter contract records the source display path, format, SHA-256, size, and import time. New imports may add `hwp-source-cache`; older imported notes ask the user to reselect and verify the original once before caching it.

Source-preserving edits always create a separate output file. The original HWP/HWPX is never overwritten.

### Limits

- An imported HWPX template reads named Normal and Heading 1–6 styles. Direct formatting applied to only part of a run is not treated as a hierarchy rule.
- The semantic template model does not clone fixed-position covers, approval boxes, headers/footers, text boxes, or arbitrary drawing layouts.
- The Kordoc HWPX SVG preview is an editing aid, not a pixel-identical Hancom Office renderer. Equations, charts, headers, and footers can differ.
- Fast DOCX preview renders the actual generated package, but it is not Microsoft Word; page breaks and some layout can differ.
- HanMark 2.4.3 is desktop-only. Mobile is not supported.
- Optional OCR/ML components such as Sharp, ONNX, and PDFium are not loaded by the plugin startup bundle.

### Privacy and capabilities

- **Network:** HanMark makes an outbound request only when a user previews or exports Markdown containing an HTTP(S) image. It requests the exact image URL present in the note. No other document content is uploaded.
- **Files:** HanMark reads Vault attachments and files explicitly selected by the user. It writes imported attachments and user-requested export files through Obsidian Vault and browser file APIs. A source selected for editable round trips may be stored in a private, content-addressed plugin cache; the original is never overwritten.
- **External programs:** HWPX and HTML use no external executable. A user-configured Pandoc executable can run only for an explicit DOCX export, Fast DOCX **Refresh**, or direct preview-mode selection. Optional Windows Word-to-PDF preview invokes Word only after **Refresh** or direct mode selection.
- **Clipboard and dynamic execution:** HanMark does not read or write the clipboard and does not evaluate downloaded or generated JavaScript.
- **Data collection:** no accounts, analytics, telemetry, advertising, payments, or remote feature flags.

### Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/laguna821/hanmark/releases) and place them in `<vault>/.obsidian/plugins/hanmark/`.

### Development

```bash
npm ci --omit=optional
npm run check
```

`npm run check` runs the official Obsidian ESLint rules, adapter/template/HWPX and characterization tests, TypeScript compilation, the production build, bundle-size/native-module guards, Community review guards, and release consistency checks. See [CONTRIBUTING.md](CONTRIBUTING.md) for the preserved-version branch policy.

### Credits

- [chrisryugj/kordoc](https://github.com/chrisryugj/kordoc) — bundled HWP/HWPX import, Markdown-to-HWPX, source patching, validation, format profiles, and SVG preview.
- [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) 0.4.0 by Volodymyr Baydalka — browser rendering of user-requested DOCX packages; [Apache License 2.0](https://github.com/VolodymyrBaydalka/docxjs/blob/master/LICENSE).
- [Pandoc](https://pandoc.org/) — optional DOCX conversion only.
- [msjang/pypandoc-hwpx](https://github.com/msjang/pypandoc-hwpx) — the project that powered HanMark's earlier HWPX workflow.

---

## 한국어

**Obsidian Markdown과 편집 가능한 한글 HWP/HWPX를 잇는 데스크톱 플러그인입니다.**

HanMark 2.4.3의 HWPX 생성·가져오기·원본 수정·검증·이미지 포함·문서 스타일·빠른 미리보기 엔진은 정확히 고정된 **Kordoc 4.2.5**입니다. HWPX를 만들 때 Python, pypandoc-hwpx, Pandoc 또는 실행 파일 경로 설정이 필요하지 않습니다.

### 2.4.3 핵심 변화

- **문서 기능은 유지하고 심사 표면은 축소:** 2.4.2의 HWPX·이미지·템플릿·HTML·선택적 DOCX 동작을 타입이 있는 모듈로 옮기고 구 호환 번들을 제거했습니다.
- **안전한 파일 경계:** 가져오기는 사용자가 선택한 `File` 데이터를, Vault 작업은 Obsidian API를 사용합니다. 원본 형식 보존 수정은 콘텐츠 해시 기반 비공개 캐시를 사용하며 런타임 Node 파일 시스템 접근을 제거했습니다.
- **심사 친화적 렌더링:** 동적 코드 실행, 클립보드 접근과 CSS 강제 우선순위를 제거했습니다.
- **배포 의존성 감사:** 취약한 선택적 전이 의존성 버전을 안전한 버전으로 고정하고 Sharp·ONNX·PDFium·OCR/ML 네이티브 구성요소는 설치와 시작 번들에서 계속 제외합니다.
- **검증 가능한 Release:** 태그 빌드는 Windows·macOS 검사를 통과한 뒤 Community용 세 파일을 다시 만들고 GitHub artifact attestation을 발행합니다.
- **남아 있는 외부 실행은 하나의 명시적 선택 기능:** DOCX는 사용자가 선택한 Pandoc을 실행할 수 있고, Word-to-PDF 미리보기는 사용자가 요청한 경우에만 실행합니다.
- **Word 작업 기능 유지:** 크기 조절 가능한 3단 템플릿 편집기, 미저장 변경 보호, 스타일 연결, 설치·사용자 글꼴 검색과 Pandoc이 실제로 만든 DOCX 패키지 미리보기를 유지합니다. 외부 변환은 사용자가 새로 고침이나 모드 선택을 직접 실행할 때만 시작합니다.
- **툴바 기능 유지:** 2.4.2의 밝은·어두운 팔레트, 색상 선택기, 체크 상태 전환, 위·아래 첨자, 노트·주의 콜아웃과 실시간 미리보기 스위치를 유지합니다.

### 2.x 핵심 기능

- **Kordoc 4.2.5 내장:** 외부 설치 없이 HWPX를 생성·검증하고, 양식형 문서의 글자처럼 배치된 인라인 표 주변 텍스트를 가져올 때 생기던 줄바꿈 회귀를 수정했습니다.
- **실제 이미지 포함:** 원격 HTTP(S), data URI와 Vault PNG/JPEG/GIF/BMP 이미지를 HWPX `BinData`에 넣습니다. 실패한 이미지는 조용히 사라지지 않습니다.
- **다중 사용자 템플릿:** 템플릿을 제한 없이 만들고, HWPX에서 가져오고, 복제·이름 변경·편집·선택·삭제할 수 있습니다.
- **문서 스타일 규칙:** 템플릿 하나에 바탕글·제목 1~6의 글꼴, 문단 간격·들여쓰기, 페이지 규칙과 선택적인 표 스타일을 함께 저장합니다.
- **한컴오피스 편집 호환:** 생성된 스타일의 실제 글꼴명과 문단 속성을 한컴오피스 상단 도구 모음과 F6 스타일 창에서 확인하고 다시 편집할 수 있습니다.
- **간결한 내보내기 센터:** HWPX 작업은 첫 탭에, 원본 수정·HTML·선택적 Pandoc DOCX는 기타 형식 탭에 모았습니다.
- **확대·크기 조절 가능한 창:** 내보내기 센터와 템플릿 관리자가 좁은 고정 창에 잘리지 않습니다.
- **pypandoc-hwpx HWPX 절차 종료:** 모든 HWPX 명령과 설정에서 Python 설치 및 실행 파일 경로 절차를 제거했습니다.

### 내보내기 모드

| 위치 | 결과 | 엔진 | 외부 설치 |
| --- | --- | --- | --- |
| HWPX | 빠른 HWPX | Kordoc 4.2.5 + 선택 템플릿 | 없음 |
| HWPX | 한국 공문서 HWPX | Kordoc 4.2.5 공문서 프리셋 | 없음 |
| 기타 형식 | 별도 HWP/HWPX 수정본 | Kordoc 4.2.5 | 없음 |
| 기타 형식 | HTML | HanMark 내장 변환 | 없음 |
| 기타 형식 | DOCX | Pandoc + HanMark Word 템플릿 | Pandoc만 선택 설치 |

Pandoc 설정은 DOCX에만 표시됩니다. HWPX와 HTML은 Pandoc 경로를 읽지 않습니다.

빠른 DOCX 미리보기는 사용자가 모드를 선택하거나 **새로 고침**을 누른 뒤 Pandoc이 실제로 만든 DOCX 패키지를 렌더링합니다. 뷰 열기, 입력, 활성 노트 변경, 템플릿 변경은 기존 결과를 오래된 상태로 표시할 뿐 Pandoc을 백그라운드에서 실행하지 않습니다. DOCX 생성이 불가능하면 문서 스타일 기반 간이 미리보기로 전환합니다.

### 빠른 사용법

1. Obsidian 커뮤니티 플러그인 탐색에서 **HanMark**를 설치하고 활성화합니다.
2. 내보낼 Markdown 노트를 엽니다.
3. 툴바에서 **HWPX**를 선택하거나 명령 팔레트에서 **HanMark: 내보내기**를 실행합니다.
4. 내장 또는 사용자 템플릿을 고르고 **HWPX 만들기**를 누릅니다.

HWPX 템플릿 버튼은 템플릿 라이브러리를 엽니다. 내장 템플릿은 직접 변경하지 않고 복제 후 편집합니다. 사용자 템플릿은 Vault 전체에 적용되며 이름 변경과 삭제가 가능합니다.

### 이미지

동일한 이미지는 한 번만 읽어 여러 위치에 배치합니다. 원격 이미지는 처음 불러올 때 인터넷 연결이 필요하며, 현재 Obsidian 실행 중에는 미리보기와 내보내기가 메모리 캐시를 공유합니다. 다운로드·Vault 경로·디코딩·HWPX 배치가 실패하면 재시도, 명시적인 누락 표시로 계속하기, 취소 중 하나를 선택할 수 있습니다.

### 문서 스타일과 글꼴

- 바탕글과 제목 1~6을 독립된 HWPX 이름 스타일로 기록합니다.
- 같은 논리 글꼴을 모든 HWPX 언어 글꼴 표의 같은 ID로 연결해 한컴오피스가 실제 글꼴명을 인식하게 합니다.
- Word 템플릿 관리자는 정확한 글꼴명 직접 입력, 권장·문서 글꼴 검색, 사용자가 누른 경우에만 실행되는 설치 글꼴 검색, 직접 선택한 TTF/OTF/TTC/WOFF/WOFF2 파일·폴더를 지원합니다.
- 사용자 글꼴 파일은 콘텐츠 해시 기반 비공개 플러그인 캐시에 복사해 Obsidian의 Word 템플릿·DOCX 미리보기에만 사용합니다. HWPX나 DOCX 안에 글꼴 파일을 포함하지는 않습니다.
- HWPX에는 글꼴 파일이 아니라 이름이 기록됩니다. 문서를 여는 컴퓨터에 해당 글꼴이 없으면 대체 글꼴이 표시될 수 있습니다.
- Windows와 macOS에서 공유할 문서는 양쪽에 설치할 수 있는 글꼴을 권장합니다.
- Markdown이 `##`부터 시작하면 제목 2가 적용됩니다. 제목 단계를 임의로 당기지 않습니다.
- 문단 들여쓰기와 간격은 한글 F6과 같은 pt, 페이지 여백은 mm를 사용합니다.

HanMark 2.4.2에서 파일 시스템 경로로 미리보기 글꼴을 추가한 사용자는 2.4.3에서 해당 글꼴 파일을 한 번 다시 선택해야 할 수 있습니다. 저장된 글꼴명과 문서 템플릿은 유지되며, 더 안전한 비공개 미리보기 사본만 새로 필요합니다.

### 가져오기와 원본 형식 보존

HWP, HWPX, PDF, DOCX, XLSX, XLS 문서를 Markdown으로 가져옵니다. 추출된 이미지는 Obsidian 첨부 정책에 따라 저장하고 실제 Vault 경로로 링크를 다시 씁니다. 기존 `hwp-source-*` 프런트매터에 원본 표시 경로, 형식, SHA-256, 크기와 가져온 시각을 계속 기록합니다. 새 가져오기는 `hwp-source-cache`를 추가할 수 있고, 예전에 가져온 노트는 처음 한 번 원본을 다시 선택해 해시와 크기를 확인한 뒤 캐시합니다.

원본 형식 보존 수정은 항상 별도 결과 파일을 만듭니다. 원본 HWP/HWPX를 덮어쓰지 않습니다.

### 범위와 한계

- 사용자 HWPX 템플릿은 이름이 지정된 바탕글과 제목 1~6 스타일을 읽습니다. 글자 일부에 직접 적용한 서식은 계층 규칙으로 취급하지 않습니다.
- 표지, 결재란, 머리말·꼬리말, 텍스트 상자와 임의 좌표의 그리기 개체를 통째로 복제하지 않습니다.
- Kordoc HWPX SVG 미리보기는 편집 보조 화면이며 한컴오피스와 완전히 같은 WYSIWYG가 아닙니다. 수식·차트·머리말·꼬리말은 다르게 보일 수 있습니다.
- 빠른 DOCX 미리보기는 실제 생성된 패키지를 렌더링하지만 Microsoft Word 자체는 아니므로 쪽 나눔과 일부 레이아웃은 다를 수 있습니다.
- HanMark 2.4.3은 데스크톱 전용이며 모바일은 지원하지 않습니다.
- Sharp, ONNX, PDFium 같은 선택적 OCR·ML 구성요소는 플러그인 시작 번들에서 불러오지 않습니다.

### 개인정보와 접근 권한

- **네트워크:** 사용자가 HTTP(S) 이미지가 포함된 Markdown을 미리보거나 내보낼 때만 노트에 적힌 해당 이미지 URL로 요청합니다. 다른 문서 내용은 업로드하지 않습니다.
- **파일:** Vault 첨부 파일과 사용자가 직접 선택한 파일을 읽습니다. 가져온 첨부 파일과 사용자가 요청한 결과 파일은 Obsidian Vault와 브라우저 파일 API로 저장합니다. 원본 형식 보존용으로 선택한 원본은 콘텐츠 해시 기반 비공개 플러그인 캐시에 저장될 수 있으며 원본은 덮어쓰지 않습니다.
- **외부 프로그램:** HWPX와 HTML은 외부 실행 파일을 사용하지 않습니다. 사용자가 지정한 Pandoc은 명시적인 DOCX 내보내기, 빠른 DOCX **새로 고침**, 또는 사용자가 직접 미리보기 방식을 선택했을 때만 실행합니다. Windows Word-to-PDF 미리보기 역시 **새로 고침**이나 직접적인 방식 선택 뒤에만 Word를 호출합니다.
- **클립보드와 동적 실행:** 클립보드를 읽거나 쓰지 않으며 다운로드하거나 생성한 JavaScript를 동적으로 실행하지 않습니다.
- **데이터 수집:** 계정, 분석, 텔레메트리, 광고, 결제, 원격 기능 플래그가 없습니다.

### 수동 설치

[최신 Release](https://github.com/laguna821/hanmark/releases)의 `main.js`, `manifest.json`, `styles.css`를 `<vault>/.obsidian/plugins/hanmark/`에 넣습니다.

### 개발

```bash
npm ci --omit=optional
npm run check
```

`npm run check`는 공식 Obsidian ESLint, Markdown 어댑터·템플릿·HWPX 및 특성 보존 테스트, TypeScript 컴파일, 프로덕션 빌드, 번들 크기·네이티브 모듈 검사, Community 심사 게이트와 Release 일치 검사를 실행합니다. 버전 브랜치 보존 원칙은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하십시오.

### 감사

- [chrisryugj/kordoc](https://github.com/chrisryugj/kordoc) — 내장 HWP/HWPX 가져오기, Markdown-to-HWPX, 원본 수정, 검증, 형식 프로필과 SVG 미리보기.
- Volodymyr Baydalka의 [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) 0.4.0 — 사용자가 요청한 DOCX 패키지를 Obsidian 안에서 렌더링하며 [Apache License 2.0](https://github.com/VolodymyrBaydalka/docxjs/blob/master/LICENSE)을 따릅니다.
- [Pandoc](https://pandoc.org/) — 선택적 DOCX 변환에만 사용.
- [msjang/pypandoc-hwpx](https://github.com/msjang/pypandoc-hwpx) — HanMark 초기 HWPX 경로의 기반이 된 프로젝트.

## License

Released under the [MIT License](LICENSE). Made by **Achmage**.
