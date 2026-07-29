# Changelog

Only versions published as GitHub Releases are listed as releases. The 2.x milestones below preserve the internal development path that was consolidated into the public 2.4.2 release.

## 2.5.5

- Made the first Editorial PDF export after a fresh Obsidian launch deterministic by waiting for the attached print stylesheet, embedded Pretendard weights, images, and stable print layout before opening the native print dialog.
- Added a directly discoverable PDF button to the top HanMark toolbar. It opens the unified export center with PDF selected and preserves the existing `export-pdf` command.
- Kept the 2.5.4 theme-independent Editorial palette, full-bleed cover, headers, footers, page numbering, large-document safeguards, and all HWPX, DOCX, HTML, import, and template behavior unchanged.

## 2.5.4

- Isolated the built-in Editorial PDF from Obsidian's light and dark themes by establishing a fixed light print color scheme and a complete scoped paper, body, navy, teal, border, code, and highlight palette.
- Fixed semantic leaf elements—including emphasis, links, list markers, inline code, tables, callouts, decorations, and images—so inherited theme colors, filters, and opacity cannot leak into the printed result.
- Normalized explicit inline text and background colors to the Editorial PDF palette for deterministic output across themes and computers; supported HTML colors and all HWPX/DOCX behavior remain unchanged.
- Preserved 2.5.3 large-code splitting, adaptive table pagination, safe deep-structure handling, native print lifecycle protection, full-bleed cover, page furniture, and imported BMP rendering.
- Preserved the Markdown source, Kordoc 4.2.5 HWPX generation, templates, optional Pandoc DOCX path, imports, CMDS Eagle bridge, and existing command IDs.

## 2.5.3

- Hardened the built-in Editorial PDF path for large code blocks, multi-page and very wide tables, oversized quotes and callouts, image-heavy containers, long prose, nested lists, and deeply nested structures.
- Physically divided oversized code into bounded print chunks while preserving the exact source text and line endings.
- Kept ordinary multi-page tables as native repeating-header tables, while moving exceptionally tall rows or headers and very wide tables to an ordinary-flow vertical fallback that preserves cell order, complete values, and images.
- Kept the Obsidian print document visible and mounted through native Save-as-PDF handling, waited for layout to settle, rejected concurrent print requests safely, and swept stale HanMark print state before a new export.
- Added bounded, privacy-safe stage diagnostics so failures identify the PDF step without exposing note text, local paths, image payloads, or private cause messages.
- Refined the deterministic Editorial layout with a full-bleed HanMark cover, branded headers, precisely spaced teal rules, one-column body pages, and actual page numbers.
- Rendered signature-validated BMP data images imported from HWPX as actual images in Achmage Editorial HTML instead of literal Markdown or base64 text.
- Preserved the Markdown source, Kordoc 4.2.5 HWPX generation, templates, optional Pandoc DOCX path, imports, CMDS Eagle bridge, and existing command IDs.

## 2.5.2

- Added a shared semantic Editorial document model for Achmage Editorial HTML and PDF, normalizing soft line breaks while preserving headings, nested lists, tasks, tables, quotes, callouts, code, links, wiki links, and images.
- Normalized supported raw HTML into safe elements and removed scripts, event handlers, unsafe URLs, and unsupported subtrees; the selectable Classic HTML theme retains its previous compatibility behavior.
- Replaced generic Obsidian PDF delegation with a built-in Chromium Editorial print pipeline: an A4 filename-only cover followed by a filename header, top and bottom rules, and actual page numbers.
- Made PDF image preparation fail closed with retry or cancellation, kept the Markdown source unchanged, and left Pandoc outside the PDF path.
- Embedded Pretendard 400 and 600 in `styles.css` under the SIL Open Font License 1.1, adding roughly 2 MB while removing the need for a separately installed PDF font.
- Launched Windows Explorer as a visible non-blocking Show-in-folder handoff with the saved file selected, without weakening converter exit-code or timeout handling.
- Added a configurable Vault-relative imported-image folder, skipped unreferenced extracted images, and cleaned only verified HanMark-owned temporary copies after successful CMDS cloud replacement.
- Preserved Kordoc 4.2.5 HWPX generation, templates, optional Pandoc DOCX, document import, CMDS Eagle and optional R2 image paths, toolbar editing, and existing command IDs.
- Raised the minimum desktop Obsidian version to 1.8.9 for the required Chromium print capabilities.

## 2.5.1

- Replaced truncating Markdown image regular expressions with a shared iterative scanner that supports Korean, percent-encoded spaces, angle destinations, escaped characters, and balanced parentheses.
- Kept imported Vault images available to HWPX live preview and HWPX, DOCX, and HTML export; new local imports use unambiguous Vault-root wiki embeds.
- Added Vault, CMDS Eagle's active cloud provider, and ask-every-import image destinations, with an optional direct R2 fallback.
- Added a credential-free CMDS Eagle workspace-event contract and a verified compatibility bridge through `cmds-eagle:convert-all-to-cloud`; HanMark never reads CMDS Eagle private settings or credentials.
- Added an optional HTTPS R2 Worker fallback. Worker/Public URLs are user configured, while the API key remains in memory for the current Obsidian session and is never persisted.
- Removed giant image-string spreading and full-payload regular-expression captures from the standalone HTML renderer, preventing Electron-dependent `Maximum call stack size exceeded` failures.
- Accepted Windows Explorer's handoff exit code only for the fixed Show-in-folder launcher while preserving strict exit handling for every other process.
- Preserved Kordoc 4.2.5 HWPX generation, templates, Achmage Editorial and Classic HTML, optional Pandoc DOCX, PDF delegation, toolbar editing, and existing command IDs.

## 2.5.0

- Added **Achmage Editorial** as the default HTML export theme while preserving the previous output as the selectable **Classic** compatibility theme.
- Added a deterministic editorial masthead, heading bars, callouts, tables, responsive media and code, narrow-screen rules, and dedicated A4 print styling.
- Promoted the first leading H1 to the masthead and removed that one duplicate heading from the article body; the note title remains the fallback.
- Embedded validated local and remote PNG, JPEG, GIF, and BMP images as data URIs so completed HTML files remain self-contained and usable offline.
- Kept the existing `${title}_html.html` output naming and reported image failures through retry, explicit missing-image continuation, or cancellation instead of silently retaining external sources.
- Added a strict Content Security Policy and URL allowlists. Generated HTML contains no JavaScript, event handlers, CDN, external stylesheet, bundled font, iframe, or arbitrary user CSS.
- Added Kami MIT attribution for the adapted document-design language without bundling the Kami package, font assets, build scripts, or example content.
- Preserved HWPX, DOCX, PDF, import, template, toolbar, DOCX preview, legacy command compatibility, and the user-initiated Pandoc boundary from 2.4.5.

## 2.4.5

- Made an explicit Fast DOCX Preview open render the semantic document immediately and upgrade it exactly once to the actual Pandoc-generated package.
- Kept Pandoc outside workspace restoration and view lifecycle events. Typing marks the result as changed, while active-document and template changes refresh only the in-process semantic preview.
- Fitted actual DOCX pages to the available pane without changing page proportions or pagination, with bounded scaling and horizontal overflow for very narrow panes.
- Changed new HWP, HWPX, PDF, DOCX, XLSX, and XLS imports to ordinary Markdown body content and rewritten Vault attachment links, without generated source YAML, source callouts, or round-trip source caching.
- Removed source patching from the public export types and export center while preserving the non-overwriting compatibility path as a command-palette-only legacy command for older imported notes.
- Added a safe migration command that creates a clean Markdown sibling from older HanMark-generated source metadata while preserving user-authored YAML and ordinary callouts.
- Removed an unnecessary `FontFaceSet` type assertion reported by Community review without changing font loading behavior.
- Preserved HWPX generation, embedded images, templates, toolbar editing, DOCX/HTML/PDF export, existing command IDs, and the optional Pandoc workflow.

## 2.4.4

- Fixed Pandoc DOCX export and actual-package preview by removing leading Obsidian YAML frontmatter and the generated source callout before Markdown line normalization.
- Added BOM/CRLF-safe frontmatter parsing, preserved YAML examples inside fenced code, and reported an actionable error for an unclosed leading frontmatter block.
- Replaced the tabbed/scrolling export form with one responsive 2×2 HWPX, DOCX, HTML, and PDF format grid using the active toolbar palette.
- Delegated PDF to Obsidian's native PDF export command and clearly separated its print-style output from HanMark HWPX and Word templates.
- Kept completed Vault exports visible with their result path and added an explicit-click **Show in folder** action for newly written Vault files.
- Preserved existing command IDs, template systems, Kordoc 4.2.5 HWPX behavior, optional Pandoc DOCX behavior, and the 2.4.3 Community review safeguards.

## 2.4.3

- Preserved the 2.4.2 HWPX, image, template, toolbar, HTML, and optional Pandoc DOCX behavior while replacing the untyped legacy compatibility runtime with typed modules.
- Moved user-selected imports, Vault writes, export saves, and source-round-trip caching to Obsidian and browser file APIs; retained the `hwp-source-*` contract and added optional `hwp-source-cache`.
- Removed runtime dynamic code evaluation, clipboard access, direct Node filesystem access, and CSS forced-priority declarations.
- Enabled the complete Obsidian/TypeScript safety rule set and added a release-blocking Community review gate.
- Overrode vulnerable optional transitive versions while continuing to exclude OCR/ML and native Kordoc extras from installation and the startup bundle.
- Updated GitHub Actions to Node 24 action runtimes and added Windows/macOS verification, runtime dependency auditing, exact three-file Release publishing, and artifact attestations.
- Kept user-initiated Pandoc DOCX export/preview and Windows Word-to-PDF preview as the sole disclosed shell capability.
- Retained the searchable installed/custom Word font catalog through explicit browser file selection and a private font cache; legacy 2.4.2 preview-font paths may require one re-selection.
- Restored rendering of the actual Pandoc-generated DOCX package while preventing view-open, typing, active-note, and template lifecycle events from starting an executable.
- Restored the resizable three-pane Word template editor, dirty-change guard, style links, toolbar palettes, native color pickers, checklist/callout/script controls, and live HWPX preview switch.

## 2.4.2

- Pinned the built-in HWPX engine to Kordoc 4.2.5.
- Routed every HWPX creation command away from the retired Python/pypandoc-hwpx workflow.
- Embedded remote, data-URI, and Vault images into generated HWPX packages with explicit failure handling.
- Added semantic body and Heading 1–6 typography, paragraph, page, and table profiles.
- Added unlimited user templates with import, create, duplicate, rename, edit, select, and delete operations.
- Added a cached, debounced Kordoc SVG preview and resizable export/template dialogs.
- Added HWP/HWPX source patching without overwriting the original file.
- Added the official Obsidian ESLint rules, release consistency checks, dependency overrides, and Windows/macOS CI.

## 2.x internal development history — not published releases

- **2.0.x:** moved default Markdown-to-HWPX generation to Kordoc and introduced package validation.
- **2.1.x:** added the Obsidian Markdown adapter, public-document presets, import, source patching, and fast preview work.
- **2.2.x:** developed semantic HWPX font, named-style, paragraph, page, and table profile generation; fixed underline and Hancom style-ID interoperability issues.
- **2.3.x:** developed remote/Vault image embedding, attachment extraction, template import, and the first user-template workflow.
- **2.4.0–2.4.1:** replaced the single template slot with a template library, aligned paragraph controls with Hancom F6 units, and enlarged the export/template dialogs.
- **2.4.2:** upgraded to Kordoc 4.2.5 and completed Community review hardening for the first public 2.x release.

## 1.2.0

- Fixed template selection, live preview, and theme color bleed.

## 1.1.0

- Added multi-file parallel import.

## 1.0.2

- Fixed static-style review findings.

## 1.0.1

- Removed a dead dynamic script fallback flagged during review.

## 1.0.0

- Initial Community release.

---

## 한국어 개발 기록

GitHub Release로 공개된 버전만 정식 릴리스로 표시합니다. 아래 2.x 이력은 공개 2.4.2에 통합된 내부 개발 흐름을 보존하기 위한 기록입니다.

### 2.5.5

- Obsidian을 새로 실행한 뒤 최초 Editorial PDF를 내보낼 때도 연결된 인쇄 스타일시트, 내장 Pretendard 굵기, 이미지와 인쇄 조판이 안정될 때까지 기다린 뒤 네이티브 인쇄 창을 열도록 해 결과를 결정론적으로 만들었습니다.
- 상단 HanMark 툴바에 PDF 버튼을 추가했습니다. 통합 내보내기 센터를 PDF가 선택된 상태로 열며 기존 `export-pdf` 명령도 유지합니다.
- 2.5.4의 테마 독립형 Editorial 팔레트, 전면 표지, 머리말·꼬리말, 쪽 번호, 대형 문서 보호와 HWPX·DOCX·HTML·가져오기·템플릿 동작은 그대로 유지합니다.

### 2.5.4

- 내장 Editorial PDF에 고정된 라이트 인쇄 색상 체계와 지면·본문·남색·청록색·테두리·코드·강조색 팔레트를 설정해 Obsidian 라이트·다크 테마로부터 격리했습니다.
- 강조·링크·목록 기호·인라인 코드·표·콜아웃·장식·이미지 등 말단 의미 요소에 색상 규칙을 고정해 테마의 상속 색상, 필터와 투명도가 인쇄 결과에 섞이지 않게 했습니다.
- 명시적인 인라인 글자색과 배경색을 Editorial PDF 표준 팔레트로 정규화해 테마와 컴퓨터가 달라도 결정론적인 PDF를 만듭니다. HTML에서 지원하던 색상과 HWPX·DOCX 동작은 그대로 유지합니다.
- 2.5.3의 대형 코드 분할, 표 자동 배치, 깊은 구조 안전 처리, 네이티브 인쇄 수명주기 보호, 전면 표지·본문 지면과 가져온 BMP 렌더링을 유지합니다.
- Markdown 원문, Kordoc 4.2.5 HWPX 생성, 템플릿, 선택형 Pandoc DOCX 경로, 가져오기, CMDS Eagle 브리지와 기존 명령 ID를 유지합니다.

### 2.5.3

- 대형 코드 블록, 여러 페이지·초광폭 표, 큰 인용·콜아웃, 이미지가 많은 컨테이너, 장문, 중첩 목록과 깊은 구조에서도 내장 Editorial PDF가 안전하게 조판되도록 보강했습니다.
- 매우 큰 코드 블록을 제한된 크기의 인쇄 청크로 물리적으로 나누면서 원래 코드 문자열과 줄바꿈을 정확히 보존합니다.
- 일반적인 여러 페이지 표는 머리글이 반복되는 실제 표로 유지하고, 지나치게 높은 행·머리글과 매우 넓은 표는 셀 순서·전체 값·이미지를 보존하는 일반 흐름의 세로형 대체 배치로 전환합니다.
- Obsidian 인쇄 문서를 네이티브 PDF 저장 단계까지 보이게 유지하고 조판 안정화를 기다리며, 중복 인쇄 요청은 안전하게 거절하고 다음 내보내기 전에 남은 HanMark 인쇄 상태를 정리합니다.
- PDF 실패 단계를 알려 주면서도 노트 본문, 로컬 경로, 이미지 payload와 비공개 원인 메시지는 노출하지 않는 범위 제한 진단을 추가했습니다.
- 전면 HanMark 표지, 브랜드 머리말, 정밀한 청록색 실선, 1단 본문과 실제 쪽 번호를 갖춘 결정론적 Editorial 배치를 다듬었습니다.
- HWPX에서 가져온 서명 검증 BMP data 이미지가 Achmage Editorial HTML에서 Markdown 또는 base64 글자가 아니라 실제 이미지로 렌더링되도록 수정했습니다.
- Markdown 원문, Kordoc 4.2.5 HWPX 생성, 템플릿, 선택형 Pandoc DOCX 경로, 가져오기, CMDS Eagle 브리지와 기존 명령 ID는 유지합니다.

### 2.5.2

- Achmage Editorial HTML과 PDF가 제목·중첩 목록·할 일·표·인용·콜아웃·코드·링크·위키 링크·이미지를 공유하는 의미 구조를 사용하게 하고 소프트 줄바꿈을 정규화했습니다.
- 지원하는 원시 HTML을 안전한 요소로 정규화하고 스크립트·이벤트 핸들러·안전하지 않은 URL과 지원하지 않는 하위 구조를 제거했습니다. Classic HTML 테마의 이전 호환 동작은 유지합니다.
- 일반 Obsidian PDF 위임을 내장 Chromium Editorial 인쇄 파이프라인으로 교체해 A4 파일명 전용 표지와 2쪽 이후 파일명 머리말·위아래 실선·실제 쪽 번호를 제공합니다.
- PDF 이미지 준비를 재시도 또는 취소만 가능한 실패 폐쇄 방식으로 바꾸고, Markdown 원문을 변경하지 않으며 PDF 경로에서 Pandoc을 사용하지 않습니다.
- SIL Open Font License 1.1에 따라 Pretendard 400·600을 `styles.css`에 포함했습니다. 용량은 약 2 MB 늘지만 PDF 글꼴을 따로 설치할 필요가 없습니다.
- Windows Explorer를 보이는 비차단 방식으로 실행해 저장 파일을 선택하되, 변환기 종료코드와 시간 제한 판정은 약화하지 않았습니다.
- 가져온 이미지용 Vault 상대 폴더를 지정할 수 있게 하고, 본문에서 참조하지 않는 추출 이미지는 저장하지 않으며, CMDS 클라우드 교체 성공 뒤 검증된 HanMark 소유 임시 사본만 정리합니다.
- Kordoc 4.2.5 HWPX 생성·템플릿, 선택적 Pandoc DOCX, 문서 가져오기, CMDS Eagle·선택형 R2 이미지 경로, 툴바 편집과 기존 명령 ID를 보존했습니다.
- 필요한 Chromium 인쇄 기능을 위해 데스크톱 Obsidian 최소 버전을 1.8.9로 올렸습니다.

### 2.5.1

- 이미지 Markdown 정규식을 공통 반복형 스캐너로 교체해 한글, `%20` 공백, 꺾쇠 목적지, 이스케이프 문자와 균형 괄호가 섞인 경로를 끝까지 보존합니다.
- 불러온 Vault 이미지를 HWPX 라이브 미리보기와 HWPX·DOCX·HTML 내보내기에서 계속 사용할 수 있게 했고, 새 로컬 가져오기는 모호하지 않은 Vault 루트 위키 임베드를 사용합니다.
- 가져온 이미지 저장 방식을 Vault, CMDS Eagle 현재 클라우드, 매번 묻기 중에서 선택할 수 있게 하고 선택적 직접 R2 폴백을 추가했습니다.
- 자격증명을 공유하지 않는 CMDS Eagle 워크스페이스 이벤트 계약과 `cmds-eagle:convert-all-to-cloud` 등록 명령을 통한 검증형 호환 브리지를 추가했습니다. HanMark는 CMDS Eagle의 비공개 설정이나 자격증명을 읽지 않습니다.
- 선택적 HTTPS R2 Worker 폴백을 추가했습니다. Worker/Public URL만 사용자가 설정하며 API 키는 현재 Obsidian 세션의 메모리에만 두고 저장하지 않습니다.
- 독립형 HTML 렌더러에서 거대한 이미지 문자열 펼치기와 전체 payload 정규식 캡처를 제거해 Electron 환경의 `Maximum call stack size exceeded` 오류를 막았습니다.
- Windows Explorer의 전달 완료 종료코드만 고정된 파일 위치 보기 실행기에 한해 허용하고 다른 프로세스의 종료 판정은 그대로 엄격하게 유지했습니다.
- Kordoc 4.2.5 HWPX 생성, 템플릿, Achmage Editorial·Classic HTML, 선택적 Pandoc DOCX, PDF 위임, 툴바 편집과 기존 명령 ID를 보존했습니다.

### 2.5.0

- HTML 내보내기의 기본 테마로 **Achmage Editorial**을 추가하고, 이전 출력 외형은 선택 가능한 **Classic** 호환 테마로 보존했습니다.
- 편집 디자인 마스트헤드, 제목 막대, 콜아웃, 표, 반응형 이미지·코드, 좁은 화면 규칙과 A4 전용 인쇄 스타일을 추가했습니다.
- 맨 앞 첫 H1을 마스트헤드로 옮겨 본문에서는 한 번만 제거하고, 해당 H1이 없으면 노트 제목을 사용합니다.
- 검증된 로컬·원격 PNG·JPEG·GIF·BMP 이미지를 data URI로 포함해 완성된 HTML이 독립형으로 오프라인에서 열리게 했습니다.
- 기존 `${title}_html.html` 파일명을 유지하고, 외부 이미지 주소를 조용히 남기는 대신 재시도·명시적인 누락 표시로 계속·취소 절차로 실패를 알립니다.
- 엄격한 Content Security Policy와 URL 허용 목록을 추가했습니다. 생성 HTML에는 JavaScript, 이벤트 핸들러, CDN, 외부 스타일시트, 내장 글꼴, iframe과 임의 사용자 CSS가 없습니다.
- Kami 패키지·글꼴·빌드 스크립트·예제 콘텐츠를 포함하지 않으면서 응용한 문서 디자인 언어에 MIT 저작자 표시를 추가했습니다.
- 2.4.5의 HWPX·DOCX·PDF·가져오기·템플릿·툴바·DOCX 미리보기·레거시 명령 호환과 사용자 요청 기반 Pandoc 경계를 유지했습니다.

### 2.4.5

- 사용자가 빠른 DOCX 미리보기를 직접 열면 간이 문서를 즉시 표시한 뒤 Pandoc이 생성한 실제 패키지로 정확히 한 번 전환하도록 했습니다.
- 작업공간 복원과 뷰 생명주기 이벤트에서는 Pandoc을 실행하지 않습니다. 입력은 기존 결과를 `변경됨`으로 표시하고, 활성 문서와 템플릿 변경은 프로세스 없는 간이 미리보기만 갱신합니다.
- 실제 DOCX 페이지의 비율과 페이지 구분을 바꾸지 않으면서 패널 폭에 맞추고, 아주 좁은 패널에서는 제한된 축척과 가로 스크롤을 사용합니다.
- 새 HWP·HWPX·PDF·DOCX·XLSX·XLS 가져오기는 생성된 원본 YAML·원본 콜아웃·왕복 원본 캐시 없이 일반 Markdown 본문과 실제 Vault 첨부 링크만 만듭니다.
- 공개 내보내기 타입과 내보내기 센터에서 원본 수정을 제거하고, 예전 가져오기 노트를 위한 비덮어쓰기 호환 경로만 명령 팔레트 전용 레거시 명령으로 유지했습니다.
- 사용자가 작성한 YAML과 일반 콜아웃을 보존하면서 예전 HanMark 생성 원본 메타데이터만 제거한 깨끗한 Markdown 형제 노트를 만드는 안전한 마이그레이션 명령을 추가했습니다.
- 글꼴 로딩 동작을 바꾸지 않으면서 Community 심사에서 지적한 불필요한 `FontFaceSet` 타입 단언을 제거했습니다.
- HWPX 생성, 이미지 포함, 템플릿, 툴바 편집, DOCX·HTML·PDF 내보내기, 기존 명령 ID와 선택적 Pandoc 절차를 유지했습니다.

### 2.4.4

- Markdown 줄 정규화 전에 Obsidian YAML 프런트매터와 생성된 원본 안내 콜아웃을 제거해 Pandoc DOCX 내보내기와 실제 패키지 미리보기를 복구했습니다.
- BOM·CRLF에 안전한 프런트매터 처리를 추가하고 코드 펜스 안의 YAML 예제를 보존하며, 닫히지 않은 선두 프런트매터에는 해결 방법이 포함된 오류를 표시합니다.
- 탭과 긴 스크롤 방식의 내보내기 화면을 현재 툴바 팔레트를 따르는 반응형 2×2 HWPX·DOCX·HTML·PDF 형식 그리드로 교체했습니다.
- PDF를 Obsidian 기본 PDF 내보내기 명령에 위임하고, 해당 인쇄 스타일 결과가 HanMark HWPX·Word 템플릿 변환이 아님을 명확히 했습니다.
- 완료된 Vault 내보내기의 결과 경로를 창에 유지하고, 방금 저장한 Vault 파일에 한해 사용자가 직접 누르는 **파일 위치 보기**를 추가했습니다.
- 기존 명령 ID, 템플릿 시스템, Kordoc 4.2.5 HWPX 동작, 선택적 Pandoc DOCX와 2.4.3 Community 심사 안전장치를 유지했습니다.

### 2.4.3

- 2.4.2의 HWPX·이미지·템플릿·툴바·HTML·선택적 Pandoc DOCX 동작을 유지하면서 타입이 없던 구 호환 런타임을 타입 모듈로 교체했습니다.
- 사용자 선택 파일, Vault 저장, 결과 파일 저장과 원본 왕복 캐시를 Obsidian·브라우저 파일 API로 옮겼습니다. `hwp-source-*` 계약을 유지하고 선택적인 `hwp-source-cache`를 추가했습니다.
- 런타임 동적 코드 실행, 클립보드 접근, Node 파일 시스템 직접 접근과 CSS 강제 우선순위를 제거했습니다.
- Obsidian·TypeScript 안전 규칙 전체와 Release 차단형 Community 심사 게이트를 활성화했습니다.
- 취약한 선택적 전이 의존성 버전을 안전하게 고정하면서 OCR·ML·Kordoc 네이티브 선택 모듈은 설치와 시작 번들에서 계속 제외했습니다.
- GitHub Actions 자체 런타임을 Node 24 계열로 갱신하고 Windows·macOS 검증, 배포 의존성 감사, 정확한 세 파일 Release 발행과 artifact attestation을 추가했습니다.
- 사용자가 직접 실행하는 Pandoc DOCX 내보내기·미리보기와 Windows Word-to-PDF 미리보기만 명시적인 셸 기능으로 유지했습니다.
- 설치·사용자 Word 글꼴 검색을 명시적인 브라우저 파일 선택과 비공개 글꼴 캐시로 유지했습니다. 2.4.2에서 경로로 등록한 미리보기 글꼴은 한 번 다시 선택해야 할 수 있습니다.
- 뷰 열기·입력·활성 노트·템플릿 변경이 실행 파일을 시작하지 않도록 막으면서 Pandoc이 실제로 만든 DOCX 패키지 렌더링을 복원했습니다.
- 크기 조절 가능한 3단 Word 템플릿 편집기, 미저장 변경 보호, 스타일 연결, 툴바 팔레트, 네이티브 색상 선택기, 체크·콜아웃·첨자 도구와 실시간 HWPX 미리보기 스위치를 복원했습니다.

- **2.0.x:** Kordoc을 기본 Markdown-to-HWPX 엔진으로 전환하고 패키지 검증을 도입했습니다.
- **2.1.x:** Obsidian Markdown 어댑터, 공문서 프리셋, 문서 가져오기, 원본 수정과 빠른 미리보기를 개발했습니다.
- **2.2.x:** 글꼴·이름 스타일·문단·페이지·표 프로필 생성을 개발하고 밑줄 및 한컴 스타일 ID 호환 문제를 수정했습니다.
- **2.3.x:** 원격·Vault 이미지 포함, 첨부 이미지 추출, HWPX 템플릿 가져오기와 초기 사용자 템플릿 절차를 개발했습니다.
- **2.4.0–2.4.1:** 단일 템플릿 슬롯을 다중 라이브러리로 바꾸고 한글 F6 단위에 문단 편집기를 맞추며 내보내기·템플릿 창을 확대했습니다.
- **2.4.2:** Kordoc 4.2.5로 업데이트하고 첫 공개 2.x 버전을 위한 Community 자동심사 대응을 완료했습니다.
