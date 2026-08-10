# HanMark 2

**A desktop Obsidian plugin that connects durable Markdown notes with editable Korean HWP/HWPX documents.**

HanMark 2.5.6 uses exactly pinned **Kordoc 4.2.5** for HWPX generation, import, legacy source patching, validation, image embedding, document styles, and fast SVG preview. Creating HWPX files, self-contained HTML, and Editorial PDF requires no Python, pypandoc-hwpx, Pandoc, or executable-path setup.

> Keep the source of knowledge in portable Markdown. Produce HWPX, DOCX, HTML, or PDF when an institution requires it.

[English](#english) · [한국어](#한국어)

---

## English

### What changed in 2.5.6

- **Custom PDF theme library:** keep the immutable Achmage HanMark design or create, duplicate, rename, edit, select, and delete any number of named PDF themes per Vault.
- **One-color safe palette:** choose one six-digit key color and HanMark derives readable brand surfaces, text, rules, tints, code, callout, and table colors using WCAG contrast calculations.
- **Simple control with an escape hatch:** three advanced foreground/rule colors can be overridden. Low contrast remains allowed with a visible ratio warning instead of silently replacing a required brand color.
- **Fully editable page furniture:** cover, tag, header, footer, dynamic-title, and page-number fields can be customized or intentionally left blank without collapsing their layout slots.
- **Portable theme JSON:** export one selected theme and import it as a new non-overwriting user theme through the existing explicit file picker.
- **Compatibility preserved:** the built-in theme reproduces the 2.5.5 PDF output exactly. Markdown, print lifecycle, Kordoc HWPX, optional Pandoc DOCX, HTML, imports, and existing command IDs remain unchanged.

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
| PDF | A4 Editorial PDF with cover and page furniture | Built-in Chromium print pipeline | None |

Pandoc settings appear only for DOCX. HWPX, HTML, and PDF do not read the Pandoc path. Editorial PDF opens the operating system print dialog; choose **Save as PDF** there. It does not apply a HanMark HWPX or Word template and never changes the source note.

HTML uses **Achmage Editorial** by default. You can switch to **Classic** in HanMark settings or the export center when compatibility with the earlier appearance matters. Achmage Editorial turns the first leading H1 into a masthead, applies the fixed white/ivory/navy/blue/teal system, fits images and code to narrow screens, and supplies A4 print rules. Export remains deterministic and script-free: CSS is inline, validated local/remote PNG/JPEG/GIF/BMP assets are embedded, and no CDN, web font, external stylesheet, or JavaScript is loaded. The file name remains `${title}_html.html`.

Explicitly opening Fast DOCX Preview from a HanMark button or command renders the semantic preview immediately and requests the actual Pandoc-generated package once. Pressing **Refresh** or directly selecting a preview mode is also an explicit request. Typing marks an existing result as changed; active-note and template changes refresh only the in-process semantic preview. Workspace restoration and these lifecycle events never start Pandoc. If DOCX generation is unavailable, the semantic browser preview remains visible.

### Quick start

1. Install and enable **HanMark** from Obsidian's Community plugins browser.
2. Open the Markdown note you want to export.
3. Select an export button in the toolbar or run **HanMark: Export** from the command palette.
4. Choose HWPX, DOCX, HTML, or PDF in the format grid, review its options, and start the export.

The HWPX template button opens the template library. Built-in templates are immutable: duplicate one before editing it. Custom templates are Vault-wide and can be renamed or removed.

### Images

Each unique image is loaded once and can be placed multiple times. Remote images need a network connection during export; preview and export share an in-memory cache during the current Obsidian session. HWPX, Achmage Editorial HTML, and Editorial PDF accept validated PNG/JPEG/GIF/BMP assets. HTML converts them to embedded data URIs so the saved document can be opened offline. HTML can continue with an explicit missing-image label after a warning; PDF instead fails closed and offers retry or cancellation so a missing image cannot be overlooked in the printed result.

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

HanMark imports HWP, HWPX, PDF, DOCX, XLSX, and XLS documents as ordinary Markdown. Extracted images can stay as Vault attachments, be sent to the active CMDS Eagle cloud provider, or be decided on each import. The CMDS Eagle path first uses a public workspace bridge and then its registered active-note conversion command. The compatibility command runs only on a disposable staging note containing each unique image once; verified HTTPS URLs are token-patched into the latest imported Markdown, so CMDS never rewrites the document body. HanMark rechecks the staging target immediately before dispatch and never reads CMDS Eagle's private settings or credentials. Once a remote upload may have started, HanMark does not cascade the same unresolved image into another uploader. An optional direct R2 fallback uses user-entered Worker and Public URLs and asks for the API key without saving it; the key is retained for the session only after a successful authenticated upload. New imports contain the parsed document body and image links only; HanMark does not prepend source YAML or a source-path callout and does not cache the original solely for a future round trip.

For compatible notes imported by an earlier HanMark release, the command-palette-only **고급·레거시: 원본 형식 보존 수정본 만들기** command remains available. It always creates a separate output file and never overwrites the original HWP/HWPX. A separate migration command can create a clean Markdown sibling from HanMark's older generated metadata while preserving user-authored YAML and ordinary callouts.

### Limits

- An imported HWPX template reads named Normal and Heading 1–6 styles. Direct formatting applied to only part of a run is not treated as a hierarchy rule.
- The semantic template model does not clone fixed-position covers, approval boxes, headers/footers, text boxes, or arbitrary drawing layouts.
- The Kordoc HWPX SVG preview is an editing aid, not a pixel-identical Hancom Office renderer. Equations, charts, headers, and footers can differ.
- Fast DOCX preview renders the actual generated package, but it is not Microsoft Word; page breaks and some layout can differ.
- HTML intentionally excludes SVG, WebP, video, iframe, script, event-handler, raw user CSS, external font, and CDN resources. Ordinary links are limited to `http:`, `https:`, and `mailto:`.
- The generated HTML Content Security Policy is `default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`.
- Editorial PDF uses the desktop Chromium print engine. It is not rendered through a HanMark HWPX template, and final pagination can vary with the selected printer/PDF settings.
- HanMark 2.5.6 requires Obsidian 1.8.9 or newer and is desktop-only. Mobile Obsidian is not supported; exported HTML itself is responsive in mobile browsers.
- Optional OCR/ML components such as Sharp, ONNX, and PDFium are not loaded by the plugin startup bundle.

### Privacy and capabilities

- **Network:** HanMark requests the exact HTTP(S) image URL present in a note only when the user previews or exports that note. If the user explicitly selects CMDS Eagle's active cloud for imported images, the extracted image bytes are uploaded through CMDS Eagle's configured provider; only when that bridge is unavailable and the user has configured the optional fallback does HanMark send those image bytes to the entered HTTPS Worker URL. No document text is uploaded. The fallback API key is cached in memory only after a successful authenticated upload, cleared after an authentication rejection, and never written to HanMark settings. Achmage Editorial embeds validated images into the saved HTML, which makes that output independent of the network after export.
- **Files:** HanMark reads Vault attachments and files explicitly selected by the user. It writes imported attachments and user-requested export files through Obsidian Vault and browser file APIs. New imports do not cache the original source. If the user invokes the legacy source-patching command for an older imported note, HanMark may ask for the original again and stores only the private data required for that explicit compatibility action; it never overwrites the original.
- **External programs:** HWPX and HTML use no external converter. Editorial PDF uses the built-in Chromium print pipeline and opens the operating system print dialog without starting Pandoc. A user-configured Pandoc executable can run only after an explicit DOCX export, an explicit Fast DOCX Preview open, **Refresh**, or direct preview-mode selection. Workspace restoration, view lifecycle events, typing, active-note changes, and template changes never start Pandoc. Optional Windows Word-to-PDF preview invokes Word only after a corresponding explicit preview request. For a newly saved Vault result, **Show in folder** can start the operating system's file manager with that result selected, only after the user clicks the button.
- **Clipboard and dynamic execution:** HanMark does not read or write the clipboard and does not evaluate downloaded or generated JavaScript.
- **Data collection:** no accounts, analytics, telemetry, advertising, payments, or remote feature flags.

### Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/laguna821/hanmark/releases) and place them in `<vault>/.obsidian/plugins/hanmark/`.

### Development

```bash
npm ci --omit=optional
npm run check
```

The public, credential-free CMDS Eagle interoperability contract is documented
in [`docs/cmds-eagle-bridge-v1.md`](docs/cmds-eagle-bridge-v1.md).

`npm run check` runs the official Obsidian ESLint rules, adapter/template/HWPX and characterization tests, TypeScript compilation, the production build, bundle-size/native-module guards, Community review guards, and release consistency checks. See [CONTRIBUTING.md](CONTRIBUTING.md) for the preserved-version branch policy.

### Credits

- [chrisryugj/kordoc](https://github.com/chrisryugj/kordoc) — bundled HWP/HWPX import, Markdown-to-HWPX, source patching, validation, format profiles, and SVG preview.
- [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) 0.4.0 by Volodymyr Baydalka — browser rendering of user-requested DOCX packages; [Apache License 2.0](https://github.com/VolodymyrBaydalka/docxjs/blob/master/LICENSE).
- [Kami](https://github.com/tw93/kami) by Tw93 — the Achmage Editorial visual language adapts selected document-design principles under the MIT License; no Kami package, font, build script, or content is bundled. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- [Pretendard](https://github.com/orioncactus/pretendard) 400/600 via `@fontsource/pretendard` 5.3.0 — embedded for Editorial PDF under the SIL Open Font License 1.1. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- [Pandoc](https://pandoc.org/) — optional DOCX conversion only.
- [msjang/pypandoc-hwpx](https://github.com/msjang/pypandoc-hwpx) — the project that powered HanMark's earlier HWPX workflow.

---

## 한국어

**Obsidian Markdown과 편집 가능한 한글 HWP/HWPX를 잇는 데스크톱 플러그인입니다.**

HanMark 2.5.6의 HWPX 생성·가져오기·레거시 원본 수정·검증·이미지 포함·문서 스타일·빠른 미리보기 엔진은 정확히 고정된 **Kordoc 4.2.5**입니다. HWPX·독립형 HTML·Editorial PDF를 만들 때 Python, pypandoc-hwpx, Pandoc 또는 실행 파일 경로 설정이 필요하지 않습니다.

### 2.5.6 핵심 변화

- **사용자 PDF 테마 라이브러리:** 수정 불가능한 Achmage HanMark 기본 디자인을 유지하거나 Vault마다 이름 있는 PDF 테마를 제한 없이 생성·복제·이름 변경·편집·선택·삭제할 수 있습니다.
- **키 컬러 하나로 안전한 팔레트:** 6자리 키 컬러를 고르면 HanMark가 WCAG 대비 계산으로 브랜드 면·글자·실선·연한 배경·코드·콜아웃·표 색을 읽기 쉽게 파생합니다.
- **쉬운 기본값과 수동 선택권:** 고급 영역의 글자·실선 3색은 직접 덮어쓸 수 있습니다. 낮은 대비를 강제로 바꾸지 않고 실제 비율과 경고를 표시합니다.
- **표지와 페이지 문구 전체 편집:** 표지·태그·머리말·꼬리말·동적 제목·쪽 번호를 바꾸거나 빈칸으로 둘 수 있으며 빈칸도 기존 자리 구조를 유지합니다.
- **테마 JSON 공유:** 선택한 테마 하나를 내보내고 기존 파일을 덮어쓰지 않는 새 사용자 테마로 가져올 수 있습니다.
- **호환성 유지:** 내장 기본 테마는 2.5.5 PDF 출력을 정확히 재현합니다. Markdown, 인쇄 수명주기, Kordoc HWPX, 선택형 Pandoc DOCX, HTML, 가져오기와 기존 명령 ID는 그대로입니다.

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
| PDF | 표지와 페이지 장식을 갖춘 A4 Editorial PDF | 내장 Chromium 인쇄 파이프라인 | 없음 |

Pandoc 설정은 DOCX에만 표시됩니다. HWPX·HTML·PDF는 Pandoc 경로를 읽지 않습니다. Editorial PDF는 운영체제 인쇄 창을 열며 그곳에서 **PDF로 저장**을 선택합니다. HanMark HWPX 또는 Word 템플릿을 적용하지 않고 원본 노트를 변경하지도 않습니다.

HTML은 기본으로 **Achmage Editorial**을 사용합니다. 이전 외형과의 호환이 필요하면 HanMark 설정 또는 내보내기 센터에서 **Classic**을 선택할 수 있습니다. Achmage Editorial은 맨 앞 첫 H1을 마스트헤드로 옮기고, 고정된 white/ivory/navy/blue/teal 색상 체계와 좁은 화면에 맞는 이미지·코드, A4 인쇄 규칙을 적용합니다. CSS는 문서 내부에 있으며 검증된 로컬·원격 PNG·JPEG·GIF·BMP는 data URI로 포함됩니다. CDN, 웹 글꼴, 외부 스타일시트와 JavaScript는 불러오지 않습니다. 파일명은 `${title}_html.html`을 그대로 사용합니다.

HanMark 버튼이나 명령으로 빠른 DOCX 미리보기를 직접 열면 간이 미리보기를 즉시 렌더링하고 Pandoc이 만든 실제 DOCX 패키지를 한 번 요청합니다. **새로 고침**을 누르거나 미리보기 방식을 직접 선택하는 것도 명시적인 요청입니다. 입력은 기존 결과를 `변경됨`으로 표시하고, 활성 노트와 템플릿 변경은 프로세스 없는 간이 미리보기만 갱신합니다. 작업공간 복원과 이런 생명주기 이벤트는 Pandoc을 실행하지 않습니다. DOCX 생성이 불가능해도 간이 미리보기는 그대로 남습니다.

### 빠른 사용법

1. Obsidian 커뮤니티 플러그인 탐색에서 **HanMark**를 설치하고 활성화합니다.
2. 내보낼 Markdown 노트를 엽니다.
3. 툴바의 내보내기 버튼을 선택하거나 명령 팔레트에서 **HanMark: 내보내기**를 실행합니다.
4. 형식 그리드에서 HWPX·DOCX·HTML·PDF 중 하나를 고르고 세부 옵션을 확인한 뒤 내보냅니다.

HWPX 템플릿 버튼은 템플릿 라이브러리를 엽니다. 내장 템플릿은 직접 변경하지 않고 복제 후 편집합니다. 사용자 템플릿은 Vault 전체에 적용되며 이름 변경과 삭제가 가능합니다.

### 이미지

동일한 이미지는 한 번만 읽어 여러 위치에 배치합니다. 원격 이미지는 내보낼 때 인터넷 연결이 필요하며, 현재 Obsidian 실행 중에는 미리보기와 내보내기가 메모리 캐시를 공유합니다. HWPX·Achmage Editorial HTML·Editorial PDF는 검증된 PNG·JPEG·GIF·BMP를 사용합니다. HTML은 이미지를 data URI로 포함하므로 저장 후에는 오프라인으로 열 수 있습니다. HTML은 경고 뒤에 명시적인 누락 표시로 계속할 수 있지만 PDF는 누락을 놓치지 않도록 실패 폐쇄 방식으로 재시도 또는 취소만 제공합니다.

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

HWP, HWPX, PDF, DOCX, XLSX, XLS 문서를 일반 Markdown으로 가져옵니다. 추출된 이미지는 Vault 첨부 파일로 두거나, CMDS Eagle의 현재 클라우드 제공자로 보내거나, 가져올 때마다 선택할 수 있습니다. CMDS Eagle 경로는 공개 워크스페이스 브리지를 먼저 시도하고 현재 버전에서는 서로 다른 이미지 링크를 한 번씩만 담은 전용 임시 스테이징 노트에서 등록 명령을 실행합니다. 검증된 HTTPS URL만 최신 Markdown의 이미지 토큰에 적용하므로 CMDS가 가져온 문서 본문을 다시 쓰지 않습니다. 명령 실행 직전에 대상 스테이징 노트를 다시 확인하고, 원격 업로드가 시작됐을 가능성이 있으면 같은 이미지를 다른 업로더로 연쇄 전송하지 않아 중복을 막습니다. HanMark가 CMDS Eagle의 비공개 설정이나 자격증명을 읽지는 않습니다. 선택적 직접 R2 폴백은 사용자가 입력한 Worker/Public URL만 저장하고 API 키는 인증 업로드가 성공한 뒤에만 현재 Obsidian 세션 메모리에 보관하며 인증 거절 시 지웁니다. 새 가져오기 노트에는 파싱된 문서 본문과 이미지 링크만 들어가며, HanMark가 원본 YAML이나 원본 경로 콜아웃을 앞에 붙이지 않고 향후 왕복만을 위해 원본을 캐시하지도 않습니다.

이전 HanMark 버전으로 가져온 호환 노트에는 명령 팔레트 전용 **고급·레거시: 원본 형식 보존 수정본 만들기**를 계속 제공합니다. 이 명령은 항상 별도 결과 파일을 만들고 원본 HWP/HWPX를 덮어쓰지 않습니다. 별도의 마이그레이션 명령은 사용자가 작성한 YAML과 일반 콜아웃을 보존하면서 HanMark가 예전에 생성한 메타데이터만 제거한 깨끗한 Markdown 형제 노트를 만듭니다.

### 범위와 한계

- 사용자 HWPX 템플릿은 이름이 지정된 바탕글과 제목 1~6 스타일을 읽습니다. 글자 일부에 직접 적용한 서식은 계층 규칙으로 취급하지 않습니다.
- 표지, 결재란, 머리말·꼬리말, 텍스트 상자와 임의 좌표의 그리기 개체를 통째로 복제하지 않습니다.
- Kordoc HWPX SVG 미리보기는 편집 보조 화면이며 한컴오피스와 완전히 같은 WYSIWYG가 아닙니다. 수식·차트·머리말·꼬리말은 다르게 보일 수 있습니다.
- 빠른 DOCX 미리보기는 실제 생성된 패키지를 렌더링하지만 Microsoft Word 자체는 아니므로 쪽 나눔과 일부 레이아웃은 다를 수 있습니다.
- HTML은 SVG·WebP·동영상·iframe·스크립트·이벤트 핸들러·사용자 원시 CSS·외부 글꼴·CDN 자원을 의도적으로 제외합니다. 일반 링크는 `http:`, `https:`, `mailto:`만 허용합니다.
- 생성된 HTML의 Content Security Policy는 `default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`입니다.
- Editorial PDF는 데스크톱 Chromium 인쇄 엔진을 사용합니다. HanMark HWPX 템플릿으로 렌더링하지 않으며 최종 쪽 나눔은 선택한 프린터·PDF 설정에 따라 달라질 수 있습니다.
- HanMark 2.5.6은 Obsidian 1.8.9 이상이 필요한 데스크톱 전용 플러그인입니다. 모바일 Obsidian은 지원하지 않지만 내보낸 HTML 자체는 모바일 브라우저 화면에 반응합니다.
- Sharp, ONNX, PDFium 같은 선택적 OCR·ML 구성요소는 플러그인 시작 번들에서 불러오지 않습니다.

### 개인정보와 접근 권한

- **네트워크:** 사용자가 HTTP(S) 이미지가 포함된 노트를 미리보거나 내보낼 때만 노트에 적힌 해당 이미지 URL로 요청합니다. 가져온 이미지에 대해 사용자가 명시적으로 CMDS Eagle 현재 클라우드를 선택하면 추출된 이미지 바이트를 CMDS Eagle의 현재 제공자를 통해 업로드합니다. 그 브리지를 사용할 수 없고 사용자가 선택적 폴백을 설정한 경우에만 입력한 HTTPS Worker URL로 이미지 바이트를 보냅니다. 문서 본문은 업로드하지 않으며 폴백 API 키는 인증 업로드가 성공한 뒤에만 현재 Obsidian 세션 메모리에 보관하고 인증 거절 시 지우며 HanMark 설정에는 기록하지 않습니다. Achmage Editorial은 검증된 이미지를 저장할 HTML 안에 포함하므로 내보낸 뒤에는 네트워크가 필요하지 않습니다.
- **파일:** Vault 첨부 파일과 사용자가 직접 선택한 파일을 읽습니다. 가져온 첨부 파일과 사용자가 요청한 결과 파일은 Obsidian Vault와 브라우저 파일 API로 저장합니다. 새 가져오기는 원본을 캐시하지 않습니다. 사용자가 예전 가져오기 노트에서 레거시 원본 수정 명령을 직접 실행한 경우에는 원본을 다시 선택하라고 요청할 수 있고 해당 호환 동작에 필요한 비공개 데이터만 저장합니다. 원본은 절대 덮어쓰지 않습니다.
- **외부 프로그램:** HWPX와 HTML은 외부 변환기를 사용하지 않습니다. Editorial PDF는 내장 Chromium 인쇄 파이프라인과 운영체제 인쇄 창을 사용하며 Pandoc을 실행하지 않습니다. 사용자가 지정한 Pandoc은 명시적인 DOCX 내보내기, 빠른 DOCX 미리보기 직접 열기, **새로 고침**, 또는 사용자가 직접 미리보기 방식을 선택했을 때만 실행합니다. 작업공간 복원, 뷰 생명주기, 입력, 활성 노트 변경과 템플릿 변경은 Pandoc을 실행하지 않습니다. Windows Word-to-PDF 미리보기 역시 해당 미리보기 동작을 직접 요청한 뒤에만 Word를 호출합니다. 방금 저장한 Vault 결과의 **파일 위치 보기**는 사용자가 버튼을 누른 경우에만 운영체제 파일 관리자를 실행해 해당 파일을 선택합니다.
- **클립보드와 동적 실행:** 클립보드를 읽거나 쓰지 않으며 다운로드하거나 생성한 JavaScript를 동적으로 실행하지 않습니다.
- **데이터 수집:** 계정, 분석, 텔레메트리, 광고, 결제, 원격 기능 플래그가 없습니다.

### 수동 설치

[최신 Release](https://github.com/laguna821/hanmark/releases)의 `main.js`, `manifest.json`, `styles.css`를 `<vault>/.obsidian/plugins/hanmark/`에 넣습니다.

### 개발

```bash
npm ci --omit=optional
npm run check
```

CMDS Eagle와 자격증명을 공유하지 않는 공개 연동 계약은
[`docs/cmds-eagle-bridge-v1.md`](docs/cmds-eagle-bridge-v1.md)에 정리되어 있습니다.

`npm run check`는 공식 Obsidian ESLint, Markdown 어댑터·템플릿·HWPX 및 특성 보존 테스트, TypeScript 컴파일, 프로덕션 빌드, 번들 크기·네이티브 모듈 검사, Community 심사 게이트와 Release 일치 검사를 실행합니다. 버전 브랜치 보존 원칙은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하십시오.

### 감사

- [chrisryugj/kordoc](https://github.com/chrisryugj/kordoc) — 내장 HWP/HWPX 가져오기, Markdown-to-HWPX, 원본 수정, 검증, 형식 프로필과 SVG 미리보기.
- Volodymyr Baydalka의 [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) 0.4.0 — 사용자가 요청한 DOCX 패키지를 Obsidian 안에서 렌더링하며 [Apache License 2.0](https://github.com/VolodymyrBaydalka/docxjs/blob/master/LICENSE)을 따릅니다.
- Tw93의 [Kami](https://github.com/tw93/kami) — Achmage Editorial의 시각 언어는 MIT License로 공개된 문서 디자인 원칙 일부를 응용했습니다. Kami 패키지·글꼴·빌드 스크립트·콘텐츠는 포함하지 않습니다. 자세한 표기는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하십시오.
- [Pretendard](https://github.com/orioncactus/pretendard) 400·600 (`@fontsource/pretendard` 5.3.0) — SIL Open Font License 1.1에 따라 Editorial PDF용으로 포함합니다. 자세한 표기는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하십시오.
- [Pandoc](https://pandoc.org/) — 선택적 DOCX 변환에만 사용.
- [msjang/pypandoc-hwpx](https://github.com/msjang/pypandoc-hwpx) — HanMark 초기 HWPX 경로의 기반이 된 프로젝트.

## License

Released under the [MIT License](LICENSE). Made by **Achmage**.
