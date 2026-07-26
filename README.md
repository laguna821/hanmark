# HanMark 2

**A desktop Obsidian plugin that connects durable Markdown notes with editable Korean HWP/HWPX documents.**

HanMark 2.5.0 uses exactly pinned **Kordoc 4.2.5** for HWPX generation, import, legacy source patching, validation, image embedding, document styles, and fast SVG preview. Creating HWPX files and self-contained HTML requires no Python, pypandoc-hwpx, Pandoc, or executable-path setup.

> Keep the source of knowledge in portable Markdown. Produce HWPX, DOCX, HTML, or PDF when an institution requires it.

[English](#english) · [한국어](#한국어)

---

## English

### What changed in 2.5.0

- **Achmage Editorial by default:** HTML export now uses a deterministic editorial layout with a masthead, clear heading bars, readable tables, callouts, code blocks, and responsive media. The previous HanMark HTML appearance remains available as **Classic**.
- **Offline, self-contained output:** local and remote PNG, JPEG, GIF, and BMP images are validated and embedded as data URIs. The completed HTML has no external stylesheet, font, CDN, or script dependency.
- **Strict export boundary:** generated HTML contains a restrictive Content Security Policy, no JavaScript or event handlers, and allows ordinary links only through `http:`, `https:`, or `mailto:`.
- **Document-aware presentation:** the first leading H1 becomes the masthead title and is removed once from the article body. The layout adapts to narrow mobile screens and includes dedicated A4 print rules.
- **Predictable compatibility:** the saved name stays `${title}_html.html`. An image failure is never silent: HanMark offers retry, continuation with an explicit missing-image label, or cancellation.

### Core 2.x workflow

- **Kordoc 4.2.5 built in:** generates and validates HWPX without external setup and fixes same-line text around inline `treatAsChar` tables when importing form-style documents.
- **Images are real document assets:** remote HTTP(S), data-URI, and Vault PNG/JPEG/GIF/BMP images are embedded in HWPX `BinData`. Failed images are reported instead of silently becoming placeholders.
- **Reusable HWPX templates:** create, import, duplicate, rename, edit, select, and delete any number of templates.
- **Semantic document styles:** each template combines body and Heading 1–6 typography, paragraph spacing/indentation, page rules, and an optional table profile.
- **Hancom-editable styles:** generated styles expose real font names and paragraph properties in Hancom Office's toolbar and F6 style dialog.
- **Unified export center:** HWPX, DOCX, HTML, and PDF use one responsive format grid; HWPX-specific variants appear only after selecting HWPX.
- **Resizable full-screen-capable dialogs:** the export center and template manager no longer depend on a narrow fixed modal.
- **No pypandoc-hwpx HWPX workflow:** old Python installation and executable-path setup are retired from all HWPX commands and settings.

### Export modes

| Format | Output | Engine | External setup |
| --- | --- | --- | --- |
| HWPX | Quick HWPX | Kordoc 4.2.5 + selected template | None |
| HWPX | Korean public-document HWPX | Kordoc 4.2.5 preset | None |
| DOCX | Styled Word document | Pandoc + HanMark Word template | Optional Pandoc only |
| HTML | Self-contained Achmage Editorial or Classic HTML | Built-in HanMark writer | None |
| PDF | Obsidian PDF export settings | Native Obsidian command | None |

Pandoc settings appear only for DOCX. HWPX, HTML, and PDF do not read the Pandoc path. PDF delegates to Obsidian; it does not apply a HanMark HWPX or Word template.

HTML uses **Achmage Editorial** by default. You can switch to **Classic** in HanMark settings or the export center when compatibility with the earlier appearance matters. Achmage Editorial turns the first leading H1 into a masthead, applies the fixed white/ivory/navy/blue/teal system, fits images and code to narrow screens, and supplies A4 print rules. Export remains deterministic and script-free: CSS is inline, validated local/remote PNG/JPEG/GIF/BMP assets are embedded, and no CDN, web font, external stylesheet, or JavaScript is loaded. The file name remains `${title}_html.html`.

Explicitly opening Fast DOCX Preview from a HanMark button or command renders the semantic preview immediately and requests the actual Pandoc-generated package once. Pressing **Refresh** or directly selecting a preview mode is also an explicit request. Typing marks an existing result as changed; active-note and template changes refresh only the in-process semantic preview. Workspace restoration and these lifecycle events never start Pandoc. If DOCX generation is unavailable, the semantic browser preview remains visible.

### Quick start

1. Install and enable **HanMark** from Obsidian's Community plugins browser.
2. Open the Markdown note you want to export.
3. Select an export button in the toolbar or run **HanMark: Export** from the command palette.
4. Choose HWPX, DOCX, HTML, or PDF in the format grid, review its options, and start the export.

The HWPX template button opens the template library. Built-in templates are immutable: duplicate one before editing it. Custom templates are Vault-wide and can be renamed or removed.

### Images

Each unique image is loaded once and can be placed multiple times. Remote images need a network connection during export; preview and export share an in-memory cache during the current Obsidian session. HWPX and Achmage Editorial HTML accept validated PNG/JPEG/GIF/BMP assets. HTML converts them to embedded data URIs so the saved document can be opened offline. If an image cannot be downloaded, resolved from the Vault, decoded, or embedded, HanMark asks whether to retry, continue with an explicit missing-image label, or cancel.

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

### Markdown-first import and legacy source patching

HanMark imports HWP, HWPX, PDF, DOCX, XLSX, and XLS documents as ordinary Markdown. Extracted images are saved through Obsidian's attachment policy and links are rewritten to their real Vault paths. New imports contain the parsed document body and attachment links only; HanMark does not prepend source YAML or a source-path callout and does not cache the original solely for a future round trip.

For compatible notes imported by an earlier HanMark release, the command-palette-only **고급·레거시: 원본 형식 보존 수정본 만들기** command remains available. It always creates a separate output file and never overwrites the original HWP/HWPX. A separate migration command can create a clean Markdown sibling from HanMark's older generated metadata while preserving user-authored YAML and ordinary callouts.

### Limits

- An imported HWPX template reads named Normal and Heading 1–6 styles. Direct formatting applied to only part of a run is not treated as a hierarchy rule.
- The semantic template model does not clone fixed-position covers, approval boxes, headers/footers, text boxes, or arbitrary drawing layouts.
- The Kordoc HWPX SVG preview is an editing aid, not a pixel-identical Hancom Office renderer. Equations, charts, headers, and footers can differ.
- Fast DOCX preview renders the actual generated package, but it is not Microsoft Word; page breaks and some layout can differ.
- HTML intentionally excludes SVG, WebP, video, iframe, script, event-handler, raw user CSS, external font, and CDN resources. Ordinary links are limited to `http:`, `https:`, and `mailto:`.
- The generated HTML Content Security Policy is `default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`.
- PDF uses Obsidian's native PDF export and print styles. It is not rendered through a HanMark HWPX template.
- HanMark 2.5.0 is desktop-only. Mobile Obsidian is not supported; exported HTML itself is responsive in mobile browsers.
- Optional OCR/ML components such as Sharp, ONNX, and PDFium are not loaded by the plugin startup bundle.

### Privacy and capabilities

- **Network:** HanMark makes an outbound request only when a user previews or exports Markdown containing an HTTP(S) image. It requests the exact image URL present in the note. No other document content is uploaded. Achmage Editorial embeds a validated result into the saved HTML, which makes that output independent of the network after export.
- **Files:** HanMark reads Vault attachments and files explicitly selected by the user. It writes imported attachments and user-requested export files through Obsidian Vault and browser file APIs. New imports do not cache the original source. If the user invokes the legacy source-patching command for an older imported note, HanMark may ask for the original again and stores only the private data required for that explicit compatibility action; it never overwrites the original.
- **External programs:** HWPX and HTML use no external converter. PDF delegates to Obsidian's built-in PDF command. A user-configured Pandoc executable can run only after an explicit DOCX export, an explicit Fast DOCX Preview open, **Refresh**, or direct preview-mode selection. Workspace restoration, view lifecycle events, typing, active-note changes, and template changes never start Pandoc. Optional Windows Word-to-PDF preview invokes Word only after a corresponding explicit preview request. For a newly saved Vault result, **Show in folder** can start the operating system's file manager with that result selected, only after the user clicks the button.
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
- [Kami](https://github.com/tw93/kami) by Tw93 — the Achmage Editorial visual language adapts selected document-design principles under the MIT License; no Kami package, font, build script, or content is bundled. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- [Pandoc](https://pandoc.org/) — optional DOCX conversion only.
- [msjang/pypandoc-hwpx](https://github.com/msjang/pypandoc-hwpx) — the project that powered HanMark's earlier HWPX workflow.

---

## 한국어

**Obsidian Markdown과 편집 가능한 한글 HWP/HWPX를 잇는 데스크톱 플러그인입니다.**

HanMark 2.5.0의 HWPX 생성·가져오기·레거시 원본 수정·검증·이미지 포함·문서 스타일·빠른 미리보기 엔진은 정확히 고정된 **Kordoc 4.2.5**입니다. HWPX와 독립형 HTML을 만들 때 Python, pypandoc-hwpx, Pandoc 또는 실행 파일 경로 설정이 필요하지 않습니다.

### 2.5.0 핵심 변화

- **Achmage Editorial 기본 적용:** HTML 내보내기에 마스트헤드, 분명한 제목 막대, 읽기 쉬운 표·콜아웃·코드 블록과 반응형 미디어를 갖춘 결정론적 편집 디자인을 기본 적용합니다. 이전 HanMark HTML 외형은 **Classic**으로 계속 선택할 수 있습니다.
- **오프라인 독립형 결과:** 로컬·원격 PNG·JPEG·GIF·BMP 이미지를 검증해 data URI로 포함합니다. 완성된 HTML은 외부 스타일시트, 글꼴, CDN 또는 스크립트에 의존하지 않습니다.
- **엄격한 내보내기 경계:** 생성된 HTML에 제한적인 Content Security Policy를 넣고 JavaScript·이벤트 핸들러를 배제하며 일반 링크는 `http:`, `https:`, `mailto:`만 허용합니다.
- **문서 구조를 살린 표현:** 맨 앞 첫 H1을 마스트헤드 제목으로 사용하고 본문에서는 한 번 제거합니다. 좁은 모바일 화면과 A4 인쇄에 각각 맞는 스타일을 제공합니다.
- **예측 가능한 호환:** 저장 이름은 `${title}_html.html`을 유지합니다. 이미지 실패는 조용히 지나가지 않고 재시도, 명시적인 누락 표시로 계속, 취소 중 하나를 선택하게 합니다.

### 2.x 핵심 기능

- **Kordoc 4.2.5 내장:** 외부 설치 없이 HWPX를 생성·검증하고, 양식형 문서의 글자처럼 배치된 인라인 표 주변 텍스트를 가져올 때 생기던 줄바꿈 회귀를 수정했습니다.
- **실제 이미지 포함:** 원격 HTTP(S), data URI와 Vault PNG/JPEG/GIF/BMP 이미지를 HWPX `BinData`에 넣습니다. 실패한 이미지는 조용히 사라지지 않습니다.
- **다중 사용자 템플릿:** 템플릿을 제한 없이 만들고, HWPX에서 가져오고, 복제·이름 변경·편집·선택·삭제할 수 있습니다.
- **문서 스타일 규칙:** 템플릿 하나에 바탕글·제목 1~6의 글꼴, 문단 간격·들여쓰기, 페이지 규칙과 선택적인 표 스타일을 함께 저장합니다.
- **한컴오피스 편집 호환:** 생성된 스타일의 실제 글꼴명과 문단 속성을 한컴오피스 상단 도구 모음과 F6 스타일 창에서 확인하고 다시 편집할 수 있습니다.
- **통합 내보내기 센터:** HWPX·DOCX·HTML·PDF를 하나의 반응형 형식 그리드에서 고르며, HWPX 전용 세부 방식은 HWPX를 선택했을 때만 표시합니다.
- **확대·크기 조절 가능한 창:** 내보내기 센터와 템플릿 관리자가 좁은 고정 창에 잘리지 않습니다.
- **pypandoc-hwpx HWPX 절차 종료:** 모든 HWPX 명령과 설정에서 Python 설치 및 실행 파일 경로 절차를 제거했습니다.

### 내보내기 모드

| 형식 | 결과 | 엔진 | 외부 설치 |
| --- | --- | --- | --- |
| HWPX | 빠른 HWPX | Kordoc 4.2.5 + 선택 템플릿 | 없음 |
| HWPX | 한국 공문서 HWPX | Kordoc 4.2.5 공문서 프리셋 | 없음 |
| DOCX | 스타일이 적용된 Word 문서 | Pandoc + HanMark Word 템플릿 | Pandoc만 선택 설치 |
| HTML | Achmage Editorial 또는 Classic 독립형 HTML | HanMark 내장 변환 | 없음 |
| PDF | Obsidian PDF 내보내기 설정 | Obsidian 기본 명령 | 없음 |

Pandoc 설정은 DOCX에만 표시됩니다. HWPX·HTML·PDF는 Pandoc 경로를 읽지 않습니다. PDF는 Obsidian에 위임하므로 HanMark HWPX 또는 Word 템플릿을 적용하지 않습니다.

HTML은 기본으로 **Achmage Editorial**을 사용합니다. 이전 외형과의 호환이 필요하면 HanMark 설정 또는 내보내기 센터에서 **Classic**을 선택할 수 있습니다. Achmage Editorial은 맨 앞 첫 H1을 마스트헤드로 옮기고, 고정된 white/ivory/navy/blue/teal 색상 체계와 좁은 화면에 맞는 이미지·코드, A4 인쇄 규칙을 적용합니다. CSS는 문서 내부에 있으며 검증된 로컬·원격 PNG·JPEG·GIF·BMP는 data URI로 포함됩니다. CDN, 웹 글꼴, 외부 스타일시트와 JavaScript는 불러오지 않습니다. 파일명은 `${title}_html.html`을 그대로 사용합니다.

HanMark 버튼이나 명령으로 빠른 DOCX 미리보기를 직접 열면 간이 미리보기를 즉시 렌더링하고 Pandoc이 만든 실제 DOCX 패키지를 한 번 요청합니다. **새로 고침**을 누르거나 미리보기 방식을 직접 선택하는 것도 명시적인 요청입니다. 입력은 기존 결과를 `변경됨`으로 표시하고, 활성 노트와 템플릿 변경은 프로세스 없는 간이 미리보기만 갱신합니다. 작업공간 복원과 이런 생명주기 이벤트는 Pandoc을 실행하지 않습니다. DOCX 생성이 불가능해도 간이 미리보기는 그대로 남습니다.

### 빠른 사용법

1. Obsidian 커뮤니티 플러그인 탐색에서 **HanMark**를 설치하고 활성화합니다.
2. 내보낼 Markdown 노트를 엽니다.
3. 툴바의 내보내기 버튼을 선택하거나 명령 팔레트에서 **HanMark: 내보내기**를 실행합니다.
4. 형식 그리드에서 HWPX·DOCX·HTML·PDF 중 하나를 고르고 세부 옵션을 확인한 뒤 내보냅니다.

HWPX 템플릿 버튼은 템플릿 라이브러리를 엽니다. 내장 템플릿은 직접 변경하지 않고 복제 후 편집합니다. 사용자 템플릿은 Vault 전체에 적용되며 이름 변경과 삭제가 가능합니다.

### 이미지

동일한 이미지는 한 번만 읽어 여러 위치에 배치합니다. 원격 이미지는 내보낼 때 인터넷 연결이 필요하며, 현재 Obsidian 실행 중에는 미리보기와 내보내기가 메모리 캐시를 공유합니다. HWPX와 Achmage Editorial HTML은 검증된 PNG·JPEG·GIF·BMP를 사용합니다. HTML은 이미지를 data URI로 포함하므로 저장 후에는 오프라인으로 열 수 있습니다. 다운로드·Vault 경로·디코딩·포함이 실패하면 재시도, 명시적인 누락 표시로 계속하기, 취소 중 하나를 선택할 수 있습니다.

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

### Markdown 우선 가져오기와 레거시 원본 수정

HWP, HWPX, PDF, DOCX, XLSX, XLS 문서를 일반 Markdown으로 가져옵니다. 추출된 이미지는 Obsidian 첨부 정책에 따라 저장하고 실제 Vault 경로로 링크를 다시 씁니다. 새 가져오기 노트에는 파싱된 문서 본문과 첨부 링크만 들어가며, HanMark가 원본 YAML이나 원본 경로 콜아웃을 앞에 붙이지 않고 향후 왕복만을 위해 원본을 캐시하지도 않습니다.

이전 HanMark 버전으로 가져온 호환 노트에는 명령 팔레트 전용 **고급·레거시: 원본 형식 보존 수정본 만들기**를 계속 제공합니다. 이 명령은 항상 별도 결과 파일을 만들고 원본 HWP/HWPX를 덮어쓰지 않습니다. 별도의 마이그레이션 명령은 사용자가 작성한 YAML과 일반 콜아웃을 보존하면서 HanMark가 예전에 생성한 메타데이터만 제거한 깨끗한 Markdown 형제 노트를 만듭니다.

### 범위와 한계

- 사용자 HWPX 템플릿은 이름이 지정된 바탕글과 제목 1~6 스타일을 읽습니다. 글자 일부에 직접 적용한 서식은 계층 규칙으로 취급하지 않습니다.
- 표지, 결재란, 머리말·꼬리말, 텍스트 상자와 임의 좌표의 그리기 개체를 통째로 복제하지 않습니다.
- Kordoc HWPX SVG 미리보기는 편집 보조 화면이며 한컴오피스와 완전히 같은 WYSIWYG가 아닙니다. 수식·차트·머리말·꼬리말은 다르게 보일 수 있습니다.
- 빠른 DOCX 미리보기는 실제 생성된 패키지를 렌더링하지만 Microsoft Word 자체는 아니므로 쪽 나눔과 일부 레이아웃은 다를 수 있습니다.
- HTML은 SVG·WebP·동영상·iframe·스크립트·이벤트 핸들러·사용자 원시 CSS·외부 글꼴·CDN 자원을 의도적으로 제외합니다. 일반 링크는 `http:`, `https:`, `mailto:`만 허용합니다.
- 생성된 HTML의 Content Security Policy는 `default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`입니다.
- PDF는 Obsidian 기본 PDF 내보내기와 인쇄 스타일을 사용합니다. HanMark HWPX 템플릿으로 렌더링하는 기능이 아닙니다.
- HanMark 2.5.0은 데스크톱 전용이며 모바일 Obsidian은 지원하지 않습니다. 내보낸 HTML 자체는 모바일 브라우저 화면에 반응합니다.
- Sharp, ONNX, PDFium 같은 선택적 OCR·ML 구성요소는 플러그인 시작 번들에서 불러오지 않습니다.

### 개인정보와 접근 권한

- **네트워크:** 사용자가 HTTP(S) 이미지가 포함된 Markdown을 미리보거나 내보낼 때만 노트에 적힌 해당 이미지 URL로 요청합니다. 다른 문서 내용은 업로드하지 않습니다. Achmage Editorial은 검증된 결과를 저장할 HTML 안에 포함하므로 내보낸 뒤에는 네트워크가 필요하지 않습니다.
- **파일:** Vault 첨부 파일과 사용자가 직접 선택한 파일을 읽습니다. 가져온 첨부 파일과 사용자가 요청한 결과 파일은 Obsidian Vault와 브라우저 파일 API로 저장합니다. 새 가져오기는 원본을 캐시하지 않습니다. 사용자가 예전 가져오기 노트에서 레거시 원본 수정 명령을 직접 실행한 경우에는 원본을 다시 선택하라고 요청할 수 있고 해당 호환 동작에 필요한 비공개 데이터만 저장합니다. 원본은 절대 덮어쓰지 않습니다.
- **외부 프로그램:** HWPX와 HTML은 외부 변환기를 사용하지 않습니다. PDF는 Obsidian 기본 PDF 명령에 위임합니다. 사용자가 지정한 Pandoc은 명시적인 DOCX 내보내기, 빠른 DOCX 미리보기 직접 열기, **새로 고침**, 또는 사용자가 직접 미리보기 방식을 선택했을 때만 실행합니다. 작업공간 복원, 뷰 생명주기, 입력, 활성 노트 변경과 템플릿 변경은 Pandoc을 실행하지 않습니다. Windows Word-to-PDF 미리보기 역시 해당 미리보기 동작을 직접 요청한 뒤에만 Word를 호출합니다. 방금 저장한 Vault 결과의 **파일 위치 보기**는 사용자가 버튼을 누른 경우에만 운영체제 파일 관리자를 실행해 해당 파일을 선택합니다.
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
- Tw93의 [Kami](https://github.com/tw93/kami) — Achmage Editorial의 시각 언어는 MIT License로 공개된 문서 디자인 원칙 일부를 응용했습니다. Kami 패키지·글꼴·빌드 스크립트·콘텐츠는 포함하지 않습니다. 자세한 표기는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하십시오.
- [Pandoc](https://pandoc.org/) — 선택적 DOCX 변환에만 사용.
- [msjang/pypandoc-hwpx](https://github.com/msjang/pypandoc-hwpx) — HanMark 초기 HWPX 경로의 기반이 된 프로젝트.

## License

Released under the [MIT License](LICENSE). Made by **Achmage**.
