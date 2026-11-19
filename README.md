# HanMark 2

**A desktop Obsidian plugin that connects durable Markdown notes with editable Korean HWP/HWPX documents.**

HanMark 3.0.0 uses exactly pinned **Kordoc 4.25.0** for import, HWPX generation (quick and official documents), validation, image embedding, document styles, document comparison, form filling, and fast SVG preview. Creating HWPX files, DOCX, self-contained HTML, and Editorial PDF requires no Python, pypandoc-hwpx, Pandoc, or executable-path setup. Everything runs offline and uses no AI tokens.

> Keep the source of knowledge in portable Markdown. Produce HWPX, DOCX, HTML, or PDF when an institution requires it.

[English](#english) · [한국어](#한국어)

---

## English

### New in 3.0.0

Kordoc 4.25.0 with its PDF engine built in; official documents chosen as a frame and a look, with 52 central-agency looks and looks made from your own sample; Mermaid diagrams drawn in HWPX, DOCX, HTML, and PDF; DOCX without Pandoc; HWP to HWPX conversion; PPTX import; and a document checker with marks in the editor. See the [3.0.0 notes](release-notes/3.0.0.md) for what changed and the known limits. The sections below still describe 2.7.0 and 2.6.1 as released.

### New in 2.7.0

- **New engine, better imports:** Kordoc 4.15.7 keeps nested tables, captions, and footnotes, gives HWP 5 and HWPX the same Markdown, restores two-column text, tables, headings, and footnotes from PDF, and reports real page numbers. Korean PDFs that use Adobe CMaps (KSC, UniKS) no longer lose their text: 24 Korean CMaps are built in.
- **Import from anywhere:** a ribbon icon, right-click on one or many files in the file explorer, and drag-and-drop of files and whole folders. Four presets (standard, text only, forms, exam paper or notice PDF), a page range, and advanced options. Choose where new notes go. Password-protected HWPX files ask for the password, which is kept in memory only. A report shows warnings with page numbers, links to each new note, and buttons to retry. Large files ask first, and a batch can be stopped between files.
- **Hangul document viewer:** open `.hwp` and `.hwpx` files inside Obsidian (read-only) and convert, compare, or make a form note from the viewer.
- **Stronger HWPX:** real footnotes that Hancom Office numbers, clickable hyperlinks, and long tables that split across pages with the header row repeated. The same note always produces the same file.
- **Official documents:** eight types (the ministry briefing is new), chosen with the Hallym University forms and your own forms from one form list, institution styles with a live preview, cover, approval, heading, and closing blocks filled from note properties (Korean keys such as `공문_수신` or English aliases such as `gongmun-to`), a button that inserts the properties a type needs, an official-style notation check, and a preview. The note's headings become the document's levels (for example 1. → 가. → 1) in a draft letter), and a note without a `#` title uses its file name.
- **Built-in Hallym University forms:** Ilsong College of Liberal Arts minutes and meeting materials, and the AI Convergence Research Institute interim report, listed first in the form list. The research institute report cover carries the Hallym University emblem (the university's mark, for Hallym documents only).
- **Cover logo for your own looks:** add your organization's logo (PNG, JPG, SVG, WebP) to a look of your own; it is centred at the bottom of the cover. Start from one of the 52 agencies to keep its fonts and colours. HanMark ships no government logos, because the government symbol may not be used without permission.
- **HWPX preview toolbar:** switch between quick HWPX and any official-document form, refresh, and save as HWPX from the preview; it reopens the way it was last used.
- **Note assembly:** `![[note]]`, `![[note#heading]]`, and `![[note#^block]]` embeds are exported as their actual content in every format and in the preview. Cycles and missing notes are marked. It can be turned off in settings.
- **Old–new comparison table (신구대조표):** compare two versions of a document (HWP, HWPX, PDF, DOCX, or XLSX, mixed as you like) and get a note with a table of what changed, changed words in bold. Export that note to HWPX or DOCX to submit it.
- **Fill a form:** turn an HWPX form (click-here fields, label cells, or rows under a header) or a built-in standard draft letter into a form note, type values into its properties, and save a filled copy. The form itself is never changed.
- **Footnotes in HTML and PDF.**
- **English interface:** HanMark follows Obsidian's language and can be fixed to Korean or English in settings. Notes without Hangul get English labels in the exported document.
- **Font guide:** HWPX keeps the template's font names on every computer. HanMark shows which fonts are missing on this computer, what the preview uses instead, and where to get them. Substitutions can be saved per template when you want them.
- **Notes imported by older versions:** saving in the original format now always creates a new HWPX from the note; the original file is never patched.
- **Finishing touches:** the toolbar folds into a slim strip and stays on one line in every pane; the HWPX and DOCX previews keep their place while redrawing, page, zoom, and follow the heading you are editing; the status bar counts characters the Korean way (with and without spaces, 200-character manuscript sheets) and shows the note's form; empty tabs offer import, a new note, and recent exports.
- **Official-document files named after their form** (`무제 - 업무보고.hwpx`), export to several forms at once, and a remembered form per note.
- See the [2.7.0 notes](release-notes/2.7.0.md) for behavior changes and validation.

### What changed in 2.6.1

- **Direct PDF save:** generate the PDF, then choose **파일로 저장**. Native printing remains a separate action.
- **Journal layout:** two-column A uses full-width figures; B uses column-width figures. Both place nearby figures to reduce empty space.
- **Independent table width:** choose automatic, one column, or full body width. Automatic sizing uses actual wrapping and overflow at both widths; compact numeric tables stay narrow while dense tables expand. Long tables keep fixed column widths and repeat their headers.
- **Independent section breaks:** optionally start each top-level heading group on a fresh page. The default remains single-column with this option off.
- See [2.6.1 notes and validation limits](release-notes/2.6.1.md). macOS hardware testing was waived by the maintainer; macOS CI remains enabled.

Earlier releases are described in the [changelog](CHANGELOG.md).

### Core 2.x workflow

- **Kordoc 4.25.0 built in:** imports, generates, validates, compares, and fills documents without external setup.
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
| HWPX | Quick HWPX | Kordoc 4.25.0 + selected template | None |
| HWPX | Korean official document (7 frames, each with a look) | Kordoc 4.25.0 preset + look (기본, 공통, 52 central agencies, Hallym, your own) + note properties | None |
| DOCX | Styled Word document | Built-in writer + HanMark Word template (Pandoc as an advanced choice for Word equation objects) | None |
| HTML | Self-contained Achmage Editorial or Classic HTML | Built-in HanMark writer | None |
| PDF | A4 Editorial PDF with cover and page furniture | Built-in Chromium print pipeline | None |

DOCX is made by HanMark's built-in writer and needs no installation. The **DOCX 엔진** setting is **내장 (설치 없음)** by default. **고급 (Pandoc)** is an optional engine for equation-heavy papers: Pandoc turns LaTeX equations into Word equation objects, while the built-in writer keeps them as text and reports how many. The Pandoc path setting sits under DOCX and is used only by that engine; when the path cannot be run, the setting stays on the built-in engine and says why. HWPX, HTML, and PDF do not read the Pandoc path. Editorial PDF generates a PDF directly; click **파일로 저장** when it is ready. **프린터로 인쇄** opens the operating system print dialog. It does not apply a HanMark HWPX or Word template and never changes the source note.

HTML uses **Achmage Editorial** by default. You can switch to **Classic** in HanMark settings or the export center when compatibility with the earlier appearance matters. Achmage Editorial turns the first leading H1 into a masthead, applies the fixed white/ivory/navy/blue/teal system, fits images and code to narrow screens, and supplies A4 print rules. Export remains deterministic and script-free: CSS is inline, validated local/remote PNG/JPEG/GIF/BMP assets are embedded, and no CDN, web font, external stylesheet, or JavaScript is loaded. The file name remains `${title}_html.html`.

Explicitly opening Fast DOCX Preview from a HanMark button or command renders the semantic preview immediately and then shows the actual generated DOCX package. With the built-in engine this starts no program and works without Pandoc or Word; with **고급 (Pandoc)** it runs Pandoc once. Pressing **Refresh** or directly selecting a preview mode is also an explicit request. Typing marks an existing result as changed; the package is rebuilt on open or refresh, not while you type. Active-note and template changes refresh only the in-process semantic preview. Workspace restoration and these lifecycle events never start Pandoc. If DOCX generation is unavailable, the semantic browser preview remains visible. The **Windows Word PDF** preview mode stays optional and Windows-only: it asks Microsoft Word for a PDF of the generated DOCX, only on request.

### Quick start

1. Install and enable **HanMark** from Obsidian's Community plugins browser.
2. Open the Markdown note you want to export.
3. Select an export button in the toolbar or run **HanMark: Export** from the command palette.
4. Choose HWPX, DOCX, HTML, or PDF in the format grid, review its options, and start the export.

The HWPX template button opens the template library. Built-in templates are immutable: duplicate one before editing it. Custom templates are Vault-wide and can be renamed or removed.

To import, click the HanMark import icon in the ribbon, right-click a document in the file explorer, or drop files and folders into the import window. To compare two documents or fill a form, run the corresponding HanMark command or right-click the document.

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

### Markdown-first import and older notes

HanMark imports HWP, HWPX, HWPML (`.hml`), PDF, DOCX, XLSX, and XLS documents as ordinary Markdown. Extracted images can stay as Vault attachments, be sent to the active CMDS Eagle cloud provider, or be decided on each import. The CMDS Eagle path first uses a public workspace bridge and then its registered active-note conversion command. The compatibility command runs only on a disposable staging note containing each unique image once; verified HTTPS URLs are token-patched into the latest imported Markdown, so CMDS never rewrites the document body. HanMark rechecks the staging target immediately before dispatch and never reads CMDS Eagle's private settings or credentials. Once a remote upload may have started, HanMark does not cascade the same unresolved image into another uploader. An optional direct R2 fallback uses user-entered Worker and Public URLs and asks for the API key without saving it; the key is retained for the session only after a successful authenticated upload. New imports contain the parsed document body and image links only; HanMark does not prepend source YAML or a source-path callout and does not cache the original solely for a future round trip.

For notes imported by an earlier HanMark release, the command-palette-only advanced command for an original-format copy remains available. Because those notes were read by an older engine (Kordoc 4.2.5), HanMark 2.7.0 no longer patches the original: the command always generates a new HWPX from the note, explains why in its report, and never changes the original HWP/HWPX. A separate migration command can create a clean Markdown sibling from HanMark's older generated metadata while preserving user-authored YAML and ordinary callouts.

### Limits

- An imported HWPX template reads named Normal and Heading 1–6 styles. Direct formatting applied to only part of a run is not treated as a hierarchy rule.
- The semantic template model does not clone fixed-position covers, approval boxes, headers/footers, text boxes, or arbitrary drawing layouts.
- The Kordoc HWPX SVG preview is an editing aid, not a pixel-identical Hancom Office renderer. Equations, charts, headers, and footers can differ.
- Fast DOCX preview renders the actual generated package, but it is not Microsoft Word; page breaks and some layout can differ.
- HTML intentionally excludes SVG, WebP, video, iframe, script, event-handler, raw user CSS, external font, and CDN resources. Ordinary links are limited to `http:`, `https:`, and `mailto:`.
- The generated HTML Content Security Policy is `default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`.
- Editorial PDF uses the desktop Chromium print engine. It is not rendered through a HanMark HWPX template, and final pagination can vary with the selected printer/PDF settings.
- HanMark 3.0.0 requires Obsidian 1.8.9 or newer and is desktop-only. Mobile Obsidian is not supported; exported HTML itself is responsive in mobile browsers.
- Scanned PDFs are not OCRed. Kordoc's optional OCR code is never called, no model is downloaded, and pages without text are reported instead.
- Password-protected PDFs cannot be imported; password-protected HWPX files can.
- Form filling works with HWPX forms only. Save an HWP form as HWPX in Hancom Office first.
- The comparison table compares table cells by position, so inserting a row marks the rows below it as changed. Detecting form fields from table layout is a best guess; unmatched properties are listed in the report.
- The official-document notation check follows the style-guide rules built into Kordoc. It is not a full spelling check, and its messages are in Korean.
- The Hangul document viewer and the HWPX preview look fonts up by name, so fonts missing on this computer look different.

### Privacy and capabilities

- **Network:** HanMark requests the exact HTTP(S) image URL present in a note only when the user previews or exports that note. If the user explicitly selects CMDS Eagle's active cloud for imported images, the extracted image bytes are uploaded through CMDS Eagle's configured provider; only when that bridge is unavailable and the user has configured the optional fallback does HanMark send those image bytes to the entered HTTPS Worker URL. No document text is uploaded. The fallback API key is cached in memory only after a successful authenticated upload, cleared after an authentication rejection, and never written to HanMark settings. Achmage Editorial embeds validated images into the saved HTML, which makes that output independent of the network after export. Import, comparison, form filling, note assembly, and the Hangul document viewer never use the network.
- **Files:** HanMark reads Vault attachments and files explicitly selected by the user. It writes imported attachments and user-requested export files through Obsidian Vault and browser file APIs. New imports do not cache the original source. Comparison notes, filled forms, and imported notes are always new files; an original document or form is never modified. A form chosen from outside the Vault is copied into the Vault's attachment folder first, with a notice. Passwords for protected documents are kept in memory only for that import. The advanced command for notes imported by older versions creates a new HWPX from the note through a save dialog and does not read or overwrite the original.
- **External programs:** HWPX and HTML use no external converter. Editorial PDF uses the built-in Chromium PDF pipeline; native printing is an explicit secondary action, without starting Pandoc. DOCX uses the built-in writer by default and starts no program. Only when the DOCX engine is set to **고급 (Pandoc)** can the user-configured Pandoc executable run, and then only after an explicit DOCX export, an explicit Fast DOCX Preview open, **Refresh**, or direct preview-mode selection. Workspace restoration, view lifecycle events, typing, active-note changes, and template changes never start Pandoc. Optional Windows Word-to-PDF preview invokes Word only after a corresponding explicit preview request. For a newly saved Vault result, **Show in folder** can start the operating system's file manager with that result selected, only after the user clicks the button. In the Hangul document viewer, **Open in default app** starts the operating system's default application for that file, again only after the user clicks it. If a program is missing, HanMark says which one and how to fix the path instead of showing a raw system error.
- **Clipboard and dynamic execution:** HanMark does not read or write the clipboard and does not evaluate downloaded or generated JavaScript.
- **Data collection:** no accounts, analytics, telemetry, advertising, payments, or remote feature flags.
- **Personal data in form notes:** values you type into a form note, such as a resident registration number, stay in that note as plain text and are synced and backed up with your Vault. The form note shows a warning when a form has such a field.

### Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/laguna821/hanmark/releases) and place them in `<vault>/.obsidian/plugins/hanmark/`.

### Development

```bash
npm ci --omit=optional
npm run check
```

The public, credential-free CMDS Eagle interoperability contract is documented
in [`docs/cmds-eagle-bridge-v1.md`](docs/cmds-eagle-bridge-v1.md).

`npm run check` runs the official Obsidian ESLint rules, the interface-language check (Korean and English message tables, no untranslated interface text), adapter/template/HWPX, comparison, form, and characterization tests, TypeScript compilation, the production build, bundle-size/native-module guards, Community review guards, and release consistency checks. Browser tests of the Editorial PDF, the toolbar, and the previews run with `npm run test:pdf-render`, `npm run test:pdf-ui`, `npm run test:toolbar-ui`, and `npm run test:preview-ui`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the preserved-version branch policy and [`docs/research`](docs/research/RESEARCH_REGISTER.md) for the research register behind each change.

### Credits

- [chrisryugj/kordoc](https://github.com/chrisryugj/kordoc) 4.25.0 — bundled HWP/HWPX/HWPML/PDF/DOCX/XLSX import, Markdown-to-HWPX (quick and official documents), validation, comparison, form filling, format profiles, and SVG rendering.
- [rhwp](https://github.com/edwardkim/rhwp) by Edward Kim — the two built-in standard draft letter forms (MIT), bundled through Kordoc.
- [Pele](https://github.com/obsidianmd/pele) by kepano (MIT) — draws Mermaid diagrams for every export.
- [hayro](https://github.com/LaurenzV/hayro) (LaurenzV) — the PDF engine Kordoc 4.25.0 embeds as WebAssembly.
- [markdown-it-footnote](https://github.com/markdown-it/markdown-it-footnote) 4.0.0 — footnotes in HTML and PDF (MIT).
- [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) 0.4.0 by Volodymyr Baydalka — browser rendering of user-requested DOCX packages; [Apache License 2.0](https://github.com/VolodymyrBaydalka/docxjs/blob/master/LICENSE).
- [Kami](https://github.com/tw93/kami) by Tw93 — the Achmage Editorial visual language adapts selected document-design principles under the MIT License; no Kami package, font, build script, or content is bundled. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- [Pretendard](https://github.com/orioncactus/pretendard) 400/600 via `@fontsource/pretendard` 5.3.0 — embedded for Editorial PDF under the SIL Open Font License 1.1. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- [Pandoc](https://pandoc.org/) — optional advanced DOCX conversion only; DOCX works without it.
- [msjang/pypandoc-hwpx](https://github.com/msjang/pypandoc-hwpx) — the project that powered HanMark's earlier HWPX workflow.

---

## 한국어

**Obsidian Markdown과 편집 가능한 한글 HWP/HWPX를 잇는 데스크톱 플러그인입니다.**

HanMark 3.0.0의 불러오기·HWPX 생성(빠른 HWPX·공문서)·검증·이미지 포함·문서 스타일·문서 비교·양식 채우기·빠른 미리보기 엔진은 정확히 고정된 **Kordoc 4.25.0**입니다. HWPX·DOCX·독립형 HTML·Editorial PDF를 만들 때 Python, pypandoc-hwpx, Pandoc 또는 실행 파일 경로 설정이 필요하지 않습니다. 모든 변환은 오프라인으로 동작하며 AI 토큰을 쓰지 않습니다.

### 3.0.0 핵심 변화

PDF 엔진을 내장한 Kordoc 4.25.0, 틀과 모양으로 고르는 공문서(중앙행정기관 52곳 모양과 내 견본으로 만든 모양), HWPX·DOCX·HTML·PDF에 그림으로 들어가는 Mermaid 도식, Pandoc 없는 DOCX, HWP를 HWPX로 변환, PPTX 불러오기, 편집기 밑줄까지 지원하는 문서 점검이 들어갔습니다. 바뀐 점과 알려진 한계는 [3.0.0 안내](release-notes/3.0.0.md)를 참고하십시오. 아래 절은 2.7.0과 2.6.1 출시 당시의 설명입니다.

### 2.7.0 핵심 변화

- **새 엔진, 더 정확한 불러오기:** Kordoc 4.15.7은 표 안의 표·캡션·각주를 보존하고, HWP 5와 HWPX에서 같은 Markdown을 만들며, PDF의 2단 본문·표·제목·각주를 되살리고, 실제 쪽 번호로 알려 줍니다. Adobe CMap(KSC·UniKS)을 쓰는 한국어 PDF에서 글자가 통째로 사라지던 문제는 한국어 CMap 24개를 내장해 해결했습니다.
- **어디서나 불러오기:** 리본 아이콘, 파일 탐색기에서 파일 하나 또는 여러 개 우클릭, 파일·폴더 끌어 놓기를 지원합니다. 프리셋 4종(기본·글 위주·서식 문서·시험지·안내문 PDF), 쪽 범위, 고급 옵션을 고를 수 있고 새 노트를 둘 폴더도 정할 수 있습니다. 암호가 걸린 HWPX는 암호를 물어 보며 암호는 메모리에만 둡니다. 결과 보고서는 쪽 번호가 붙은 경고, 새 노트 링크, 다시 시도 버튼을 보여 줍니다. 큰 파일은 먼저 확인하고, 여러 파일은 파일 사이에서 멈출 수 있습니다.
- **한글 파일 보기 화면:** 볼트 안의 `.hwp`·`.hwpx`를 옵시디언에서 읽기 전용으로 열고, 그 화면에서 노트로 변환·다른 문서와 비교·양식 입력 노트 만들기를 할 수 있습니다.
- **더 강한 HWPX:** 한컴오피스가 번호를 매기는 실제 각주, 누를 수 있는 하이퍼링크, 쪽에서 나뉘며 머리행이 반복되는 긴 표를 만듭니다. 같은 노트는 언제나 같은 파일이 됩니다.
- **공문서:** 8종(업무보고 추가)을 한림대 양식·내 양식과 함께 "양식" 목록 하나에서 고르고, 실시간 미리보기가 있는 기관 서식, 노트 속성으로 채우는 표지·결재란·두문·결문(`공문_수신` 같은 한국어 키 또는 `gongmun-to` 같은 영어 별칭), 종류별 속성을 한 번에 넣는 버튼, 공문서 표기 점검, 공문서 미리보기를 제공합니다. 노트의 제목 단계가 문서의 단계가 됩니다(예: 기안문 1. → 가. → 1)). `#` 제목이 없는 노트는 파일 이름을 제목으로 씁니다.
- **한림대학교 내장 양식:** 일송자유교양대학 회의록·회의자료, AI융합연구원 중간 보고서를 양식 목록 맨 위에서 고를 수 있습니다. AI융합연구원 보고서 표지에는 한림대학교 상징이 들어갑니다(학교의 표지이므로 한림대 문서에만 쓰세요).
- **내 양식 표지 로고:** 내 양식에 기관 로고(PNG·JPG·SVG·WebP)를 넣으면 표지 아래쪽 가운데에 들어갑니다. 52개 중앙행정기관 모양 중 하나에서 시작하면 그 기관의 글꼴·색을 그대로 쓰면서 로고를 더할 수 있습니다. 정부상징은 허락 없이 쓰면 법에 걸릴 수 있어 HanMark에는 정부 로고를 넣지 않았습니다.
- **HWPX 미리보기 막대:** 미리보기 안에서 빠른 HWPX와 공문서 양식을 바꾸고, 새로 고치고, 바로 HWPX로 저장합니다. 툴바 버튼은 마지막에 쓴 방식으로 미리보기를 엽니다.
- **노트 조립:** `![[노트]]`, `![[노트#제목]]`, `![[노트#^블록]]` 임베드를 모든 내보내기 형식과 미리보기에서 실제 본문으로 합칩니다. 순환·없는 노트는 표시해 알려 주며 설정에서 끌 수 있습니다.
- **신구대조표:** 두 판의 문서(HWP·HWPX·PDF·DOCX·XLSX, 형식을 섞어도 됨)를 비교해 바뀐 부분을 표로 정리한 노트를 만들고, 바뀐 낱말은 굵게 표시합니다. 이 노트를 HWPX·DOCX로 내보내면 제출용 대조표가 됩니다.
- **양식 채우기:** HWPX 양식(누름틀·항목 칸·머리행 아래 빈 행)이나 내장 표준 기안문으로 입력 노트를 만들고, 속성에 값을 적은 뒤 채운 사본을 저장합니다. 양식 원본은 바뀌지 않습니다.
- **HTML·PDF 각주** 표시.
- **영어 화면:** 옵시디언 언어를 따라 자동으로 바뀌고, 설정에서 한국어나 영어로 고정할 수 있습니다. 한글이 없는 노트를 내보내면 문서 안의 라벨도 영어가 됩니다.
- **글꼴 안내:** HWPX에는 템플릿 글꼴 이름을 어느 PC에서나 그대로 씁니다. 이 PC에 없는 글꼴, 미리보기에서 대신 쓴 글꼴, 받는 곳을 알려 주며, 원하면 템플릿마다 대체 규칙을 저장할 수 있습니다.
- **예전 버전으로 불러온 노트:** 원본 형식 보존 저장은 이제 원본을 패치하지 않고 언제나 노트로 새 HWPX를 만듭니다.
- **마감 손질:** 툴바를 얇은 띠로 접고 창마다 한 줄로 유지합니다. HWPX·DOCX 미리보기는 다시 그려도 읽던 자리에 머물고, 쪽 이동·확대·편집 위치 따라가기를 지원합니다. 상태 표시줄은 한국어 방식으로 글자 수(공백 포함·제외, 200자 원고지)와 노트의 양식을 보여 주고, 빈 탭에서는 문서 불러오기·새 노트·최근 내보낸 파일을 바로 엽니다.
- **공문서 파일 이름에 양식**(`무제 - 업무보고.hwpx`), 여러 양식 한 번에 내보내기, 노트별 마지막 양식 기억.
- 동작 변화와 검증 범위는 [2.7.0 안내](release-notes/2.7.0.md)를 참고하십시오.

### 2.6.1 핵심 변화

- **PDF 직접 저장:** PDF를 만든 뒤 **파일로 저장**을 누릅니다. 가상 PDF 프린터를 고를 필요가 없으며, **프린터로 인쇄**도 별도로 제공합니다.
- **2단 A/B:** A는 그림을 본문 전체 폭으로, B는 한 단 폭으로 배치합니다. 기본 단 사이 간격은 10mm이며 그림 주변의 빈 공간을 본문으로 채웁니다.
- **표 폭 자동 / 한 단 / 본문 전체 폭:** 그림 모드와 별도로 선택합니다. 자동 모드는 실제 줄바꿈과 넘침을 측정해 작은 집계표는 한 단에, 복잡한 설명표는 전체 폭에 배치합니다.
- **긴 표 이어 출력:** 열 너비와 행 순서를 유지하고 머리행을 반복합니다. 한 페이지에 담지 못하는 긴 셀은 세로 항목형으로 이어 출력합니다. 표 앞 제목과 목록·인용·콜아웃 문맥도 보존합니다.
- **절별 새 페이지:** 최상위 제목 묶음에서 새 페이지를 시작할 수 있습니다. 기본은 기존 1단 출력이며, 2단 설정과 표 폭 기본값은 플러그인 설정에서 지정할 수 있습니다.
- 설정은 v11로 이관됩니다. 기존 테마 JSON과 Markdown 형식은 유지합니다. macOS 실기 검증은 사용자 결정으로 생략했고 macOS CI는 유지합니다. [검증 범위와 제한](release-notes/2.6.1.md)을 참고하십시오.

이전 버전의 변화는 [변경 기록](CHANGELOG.md)을 참고하십시오.

### 2.x 핵심 기능

- **Kordoc 4.25.0 내장:** 외부 설치 없이 문서를 불러오고, HWPX를 생성·검증하며, 문서를 비교하고 양식을 채웁니다.
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
| HWPX | 빠른 HWPX | Kordoc 4.25.0 + 선택 템플릿 | 없음 |
| HWPX | 한국 공문서 HWPX(틀 7가지와 모양) | Kordoc 4.25.0 공문서 프리셋 + 모양(기본·공통·중앙행정기관 52곳·한림대·내 양식) + 노트 속성 | 없음 |
| DOCX | 스타일이 적용된 Word 문서 | 내장 작성기 + HanMark Word 템플릿(수식 개체가 필요하면 고급 Pandoc 선택) | 없음 |
| HTML | Achmage Editorial 또는 Classic 독립형 HTML | HanMark 내장 변환 | 없음 |
| PDF | 표지와 페이지 장식을 갖춘 A4 Editorial PDF | 내장 Chromium 인쇄 파이프라인 | 없음 |

DOCX는 HanMark 내장 작성기가 직접 만들며 따로 설치할 프로그램이 없습니다. **DOCX 엔진** 설정의 기본값은 **내장 (설치 없음)**입니다. **고급 (Pandoc)**은 수식이 많은 논문을 위한 선택 엔진입니다. Pandoc은 LaTeX 수식을 Word 수식 개체로 바꾸고, 내장 작성기는 수식을 글자 그대로 넣은 뒤 몇 개인지 알려 줍니다. Pandoc 경로 설정은 DOCX 항목에 있고 이 엔진에서만 사용합니다. 그 경로를 실행할 수 없으면 설정은 내장 엔진에 그대로 머물고 이유를 알려 줍니다. HWPX·HTML·PDF는 Pandoc 경로를 읽지 않습니다. Editorial PDF는 **PDF로 저장**으로 생성한 뒤 **파일로 저장**을 눌러 저장합니다. **프린터로 인쇄**는 운영체제 인쇄 창을 엽니다. HanMark HWPX 또는 Word 템플릿을 적용하지 않고 원본 노트를 변경하지도 않습니다.

HTML은 기본으로 **Achmage Editorial**을 사용합니다. 이전 외형과의 호환이 필요하면 HanMark 설정 또는 내보내기 센터에서 **Classic**을 선택할 수 있습니다. Achmage Editorial은 맨 앞 첫 H1을 마스트헤드로 옮기고, 고정된 white/ivory/navy/blue/teal 색상 체계와 좁은 화면에 맞는 이미지·코드, A4 인쇄 규칙을 적용합니다. CSS는 문서 내부에 있으며 검증된 로컬·원격 PNG·JPEG·GIF·BMP는 data URI로 포함됩니다. CDN, 웹 글꼴, 외부 스타일시트와 JavaScript는 불러오지 않습니다. 파일명은 `${title}_html.html`을 그대로 사용합니다.

HanMark 버튼이나 명령으로 빠른 DOCX 미리보기를 직접 열면 간이 미리보기를 즉시 렌더링한 뒤 실제로 만든 DOCX 패키지를 보여 줍니다. 내장 엔진에서는 프로그램을 실행하지 않으므로 Pandoc이나 Word 없이 동작하고, **고급 (Pandoc)** 엔진에서는 Pandoc을 한 번 실행합니다. **새로 고침**을 누르거나 미리보기 방식을 직접 선택하는 것도 명시적인 요청입니다. 입력은 기존 결과를 `변경됨`으로 표시합니다. 패키지는 열 때와 새로 고칠 때 다시 만들며 입력하는 동안에는 다시 만들지 않습니다. 활성 노트와 템플릿 변경은 프로세스 없는 간이 미리보기만 갱신합니다. 작업공간 복원과 이런 생명주기 이벤트는 Pandoc을 실행하지 않습니다. DOCX 생성이 불가능해도 간이 미리보기는 그대로 남습니다. **Windows Word PDF** 미리보기 방식은 Windows 전용 선택 기능으로, 사용자가 요청한 경우에만 Microsoft Word로 생성된 DOCX의 PDF를 만듭니다.

### 빠른 사용법

1. Obsidian 커뮤니티 플러그인 탐색에서 **HanMark**를 설치하고 활성화합니다.
2. 내보낼 Markdown 노트를 엽니다.
3. 툴바의 내보내기 버튼을 선택하거나 명령 팔레트에서 **HanMark: 내보내기**를 실행합니다.
4. 형식 그리드에서 HWPX·DOCX·HTML·PDF 중 하나를 고르고 세부 옵션을 확인한 뒤 내보냅니다.

HWPX 템플릿 버튼은 템플릿 라이브러리를 엽니다. 내장 템플릿은 직접 변경하지 않고 복제 후 편집합니다. 사용자 템플릿은 Vault 전체에 적용되며 이름 변경과 삭제가 가능합니다.

불러오려면 리본의 HanMark 불러오기 아이콘을 누르거나, 파일 탐색기에서 문서를 우클릭하거나, 불러오기 창에 파일·폴더를 끌어다 놓습니다. 두 문서 비교와 양식 채우기는 해당 HanMark 명령을 실행하거나 문서를 우클릭해 시작합니다.

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

### Markdown 우선 가져오기와 예전 노트

HWP, HWPX, HWPML(`.hml`), PDF, DOCX, XLSX, XLS 문서를 일반 Markdown으로 가져옵니다. 추출된 이미지는 Vault 첨부 파일로 두거나, CMDS Eagle의 현재 클라우드 제공자로 보내거나, 가져올 때마다 선택할 수 있습니다. CMDS Eagle 경로는 공개 워크스페이스 브리지를 먼저 시도하고 현재 버전에서는 서로 다른 이미지 링크를 한 번씩만 담은 전용 임시 스테이징 노트에서 등록 명령을 실행합니다. 검증된 HTTPS URL만 최신 Markdown의 이미지 토큰에 적용하므로 CMDS가 가져온 문서 본문을 다시 쓰지 않습니다. 명령 실행 직전에 대상 스테이징 노트를 다시 확인하고, 원격 업로드가 시작됐을 가능성이 있으면 같은 이미지를 다른 업로더로 연쇄 전송하지 않아 중복을 막습니다. HanMark가 CMDS Eagle의 비공개 설정이나 자격증명을 읽지는 않습니다. 선택적 직접 R2 폴백은 사용자가 입력한 Worker/Public URL만 저장하고 API 키는 인증 업로드가 성공한 뒤에만 현재 Obsidian 세션 메모리에 보관하며 인증 거절 시 지웁니다. 새 가져오기 노트에는 파싱된 문서 본문과 이미지 링크만 들어가며, HanMark가 원본 YAML이나 원본 경로 콜아웃을 앞에 붙이지 않고 향후 왕복만을 위해 원본을 캐시하지도 않습니다.

이전 HanMark 버전으로 가져온 노트에는 명령 팔레트 전용 **고급·레거시: 원본 형식 보존 수정본 만들기**를 계속 제공합니다. 이런 노트는 예전 엔진(Kordoc 4.2.5)이 읽은 것이어서 HanMark 2.7.0은 원본을 패치하지 않습니다. 이 명령은 언제나 노트로 새 HWPX를 만들고 그 이유를 보고서에 적으며, 원본 HWP/HWPX는 바꾸지 않습니다. 별도의 마이그레이션 명령은 사용자가 작성한 YAML과 일반 콜아웃을 보존하면서 HanMark가 예전에 생성한 메타데이터만 제거한 깨끗한 Markdown 형제 노트를 만듭니다.

### 범위와 한계

- 사용자 HWPX 템플릿은 이름이 지정된 바탕글과 제목 1~6 스타일을 읽습니다. 글자 일부에 직접 적용한 서식은 계층 규칙으로 취급하지 않습니다.
- 표지, 결재란, 머리말·꼬리말, 텍스트 상자와 임의 좌표의 그리기 개체를 통째로 복제하지 않습니다.
- Kordoc HWPX SVG 미리보기는 편집 보조 화면이며 한컴오피스와 완전히 같은 WYSIWYG가 아닙니다. 수식·차트·머리말·꼬리말은 다르게 보일 수 있습니다.
- 빠른 DOCX 미리보기는 실제 생성된 패키지를 렌더링하지만 Microsoft Word 자체는 아니므로 쪽 나눔과 일부 레이아웃은 다를 수 있습니다.
- HTML은 SVG·WebP·동영상·iframe·스크립트·이벤트 핸들러·사용자 원시 CSS·외부 글꼴·CDN 자원을 의도적으로 제외합니다. 일반 링크는 `http:`, `https:`, `mailto:`만 허용합니다.
- 생성된 HTML의 Content Security Policy는 `default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`입니다.
- Editorial PDF는 데스크톱 Chromium 인쇄 엔진을 사용합니다. HanMark HWPX 템플릿으로 렌더링하지 않으며 최종 쪽 나눔은 선택한 프린터·PDF 설정에 따라 달라질 수 있습니다.
- HanMark 3.0.0은 Obsidian 1.8.9 이상이 필요한 데스크톱 전용 플러그인입니다. 모바일 Obsidian은 지원하지 않지만 내보낸 HTML 자체는 모바일 브라우저 화면에 반응합니다.
- 스캔 PDF는 OCR하지 않습니다. Kordoc의 선택형 OCR 코드는 호출하지 않고 모델도 내려받지 않으며, 글자가 없는 쪽은 보고서로 알려 줍니다.
- 암호가 걸린 PDF는 불러올 수 없습니다. 암호가 걸린 HWPX는 불러올 수 있습니다.
- 양식 채우기는 HWPX 양식만 지원합니다. HWP 양식은 한컴오피스에서 HWPX로 저장한 뒤 사용하십시오.
- 신구대조표는 표 셀을 같은 위치끼리 비교하므로 행을 넣으면 그 아래 행이 모두 바뀐 것으로 나옵니다. 표 모양으로 양식 칸을 찾는 것은 추정이며, 찾지 못한 속성은 보고서에 표시합니다.
- 공문서 표기 점검은 Kordoc에 들어 있는 편람 규칙을 따릅니다. 맞춤법 전체 검사가 아니며 점검 메시지는 한국어로만 표시합니다.
- 한글 파일 보기 화면과 HWPX 미리보기는 글꼴을 이름으로 찾으므로 이 PC에 없는 글꼴은 모양이 다를 수 있습니다.

### 개인정보와 접근 권한

- **네트워크:** 사용자가 HTTP(S) 이미지가 포함된 노트를 미리보거나 내보낼 때만 노트에 적힌 해당 이미지 URL로 요청합니다. 가져온 이미지에 대해 사용자가 명시적으로 CMDS Eagle 현재 클라우드를 선택하면 추출된 이미지 바이트를 CMDS Eagle의 현재 제공자를 통해 업로드합니다. 그 브리지를 사용할 수 없고 사용자가 선택적 폴백을 설정한 경우에만 입력한 HTTPS Worker URL로 이미지 바이트를 보냅니다. 문서 본문은 업로드하지 않으며 폴백 API 키는 인증 업로드가 성공한 뒤에만 현재 Obsidian 세션 메모리에 보관하고 인증 거절 시 지우며 HanMark 설정에는 기록하지 않습니다. Achmage Editorial은 검증된 이미지를 저장할 HTML 안에 포함하므로 내보낸 뒤에는 네트워크가 필요하지 않습니다. 불러오기·문서 비교·양식 채우기·노트 조립·한글 파일 보기 화면은 네트워크를 쓰지 않습니다.
- **파일:** Vault 첨부 파일과 사용자가 직접 선택한 파일을 읽습니다. 가져온 첨부 파일과 사용자가 요청한 결과 파일은 Obsidian Vault와 브라우저 파일 API로 저장합니다. 새 가져오기는 원본을 캐시하지 않습니다. 신구대조표 노트·채운 양식·불러온 노트는 언제나 새 파일이며 원본 문서나 양식은 바꾸지 않습니다. Vault 밖에서 고른 양식은 먼저 Vault 첨부 폴더로 복사하고 알려 줍니다. 암호 문서의 암호는 그 불러오기 동안 메모리에만 둡니다. 예전 버전으로 불러온 노트의 고급 명령은 저장 창을 거쳐 노트로 새 HWPX를 만들며 원본을 읽거나 덮어쓰지 않습니다.
- **외부 프로그램:** HWPX와 HTML은 외부 변환기를 사용하지 않습니다. Editorial PDF는 내장 Chromium으로 PDF를 직접 생성합니다. 운영체제 인쇄 창은 별도 인쇄 버튼으로 열며 Pandoc을 실행하지 않습니다. DOCX는 기본으로 내장 작성기를 쓰며 프로그램을 실행하지 않습니다. DOCX 엔진을 **고급 (Pandoc)**으로 바꾼 경우에만 사용자가 지정한 Pandoc을 실행하며, 그때도 명시적인 DOCX 내보내기, 빠른 DOCX 미리보기 직접 열기, **새로 고침**, 또는 사용자가 직접 미리보기 방식을 선택했을 때만 실행합니다. 작업공간 복원, 뷰 생명주기, 입력, 활성 노트 변경과 템플릿 변경은 Pandoc을 실행하지 않습니다. Windows Word-to-PDF 미리보기 역시 해당 미리보기 동작을 직접 요청한 뒤에만 Word를 호출합니다. 방금 저장한 Vault 결과의 **파일 위치 보기**는 사용자가 버튼을 누른 경우에만 운영체제 파일 관리자를 실행해 해당 파일을 선택합니다. 한글 파일 보기 화면의 **기본 앱으로 열기**도 사용자가 누른 경우에만 그 파일의 운영체제 기본 앱을 실행합니다. 프로그램을 찾지 못하면 날것의 시스템 오류 대신 어떤 프로그램인지와 경로 확인 방법을 알려 줍니다.
- **클립보드와 동적 실행:** 클립보드를 읽거나 쓰지 않으며 다운로드하거나 생성한 JavaScript를 동적으로 실행하지 않습니다.
- **데이터 수집:** 계정, 분석, 텔레메트리, 광고, 결제, 원격 기능 플래그가 없습니다.
- **양식 입력 노트의 개인정보:** 주민등록번호처럼 양식 입력 노트에 적은 값은 노트에 평문으로 남고 Vault와 함께 동기화·백업됩니다. 그런 칸이 있는 양식이면 입력 노트에 주의 문구를 넣습니다.

### 수동 설치

[최신 Release](https://github.com/laguna821/hanmark/releases)의 `main.js`, `manifest.json`, `styles.css`를 `<vault>/.obsidian/plugins/hanmark/`에 넣습니다.

### 개발

```bash
npm ci --omit=optional
npm run check
```

CMDS Eagle와 자격증명을 공유하지 않는 공개 연동 계약은
[`docs/cmds-eagle-bridge-v1.md`](docs/cmds-eagle-bridge-v1.md)에 정리되어 있습니다.

`npm run check`는 공식 Obsidian ESLint, 화면 언어 검사(한국어·영어 문구 표 일치, 옮기지 않은 화면 문자열 없음), Markdown 어댑터·템플릿·HWPX·문서 비교·양식 및 특성 보존 테스트, TypeScript 컴파일, 프로덕션 빌드, 번들 크기·네이티브 모듈 검사, Community 심사 게이트와 Release 일치 검사를 실행합니다. Editorial PDF·툴바·미리보기 브라우저 테스트는 `npm run test:pdf-render`, `npm run test:pdf-ui`, `npm run test:toolbar-ui`, `npm run test:preview-ui`로 실행합니다. 버전 브랜치 보존 원칙은 [CONTRIBUTING.md](CONTRIBUTING.md), 변경마다의 조사 근거는 [연구 등록부](docs/research/RESEARCH_REGISTER.md)를 참고하십시오.

### 감사

- [chrisryugj/kordoc](https://github.com/chrisryugj/kordoc) 4.25.0 — 내장 HWP/HWPX/HWPML/PDF/DOCX/XLSX 불러오기, Markdown-to-HWPX(빠른 HWPX·공문서), 검증, 문서 비교, 양식 채우기, 형식 프로필과 SVG 렌더링.
- Edward Kim의 [rhwp](https://github.com/edwardkim/rhwp) — Kordoc을 통해 포함한 내장 표준 기안문 서식 2종(MIT).
- kepano의 [Pele](https://github.com/obsidianmd/pele)(MIT) — 모든 내보내기에서 Mermaid 도식을 그립니다.
- LaurenzV의 [hayro](https://github.com/LaurenzV/hayro) — Kordoc 4.25.0이 WebAssembly로 내장한 PDF 엔진.
- [markdown-it-footnote](https://github.com/markdown-it/markdown-it-footnote) 4.0.0 — HTML·PDF 각주 표시(MIT).
- Volodymyr Baydalka의 [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) 0.4.0 — 사용자가 요청한 DOCX 패키지를 Obsidian 안에서 렌더링하며 [Apache License 2.0](https://github.com/VolodymyrBaydalka/docxjs/blob/master/LICENSE)을 따릅니다.
- Tw93의 [Kami](https://github.com/tw93/kami) — Achmage Editorial의 시각 언어는 MIT License로 공개된 문서 디자인 원칙 일부를 응용했습니다. Kami 패키지·글꼴·빌드 스크립트·콘텐츠는 포함하지 않습니다. 자세한 표기는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하십시오.
- [Pretendard](https://github.com/orioncactus/pretendard) 400·600 (`@fontsource/pretendard` 5.3.0) — SIL Open Font License 1.1에 따라 Editorial PDF용으로 포함합니다. 자세한 표기는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하십시오.
- [Pandoc](https://pandoc.org/) — 선택 사항인 고급 DOCX 변환에만 사용합니다. DOCX는 Pandoc 없이도 만들어집니다.
- [msjang/pypandoc-hwpx](https://github.com/msjang/pypandoc-hwpx) — HanMark 초기 HWPX 경로의 기반이 된 프로젝트.

## License

Released under the [MIT License](LICENSE). Made by **Achmage**.
