# HanMark

**A two-way bridge between Korean HWP documents and your Obsidian notes.**
Import HWP · HWPX · PDF · DOCX · XLSX as Markdown, and export your notes back to HWP · DOCX · HTML.

> Keep your originals in Markdown — sovereign, future-proof, AI-ready — and hand the
> institution its HWP/DOCX only when it asks.

**English** | [한국어 ↓](#한국어)

---

## Why HanMark?

You believe in Obsidian. But your real material — years of it — already lives in HWP (Hangul)
or Word. Migrating feels impossible, and the moment someone says "just install Python and a
converter," you're out. That gap is where most professors, civil servants, researchers, and
knowledge workers get stuck.

HanMark is built for exactly those people, around one idea — **sovereign PKM**:

- **Your original is Markdown.** Plain text you fully own — app-independent, automation- and
  AI-friendly, and readable decades from now.
- **Institutional formats are just an export.** Produce HWP / DOCX / HTML *only when* an
  organization requires it — not as the place your thinking lives.

Closed formats quietly shape how you think (the medium is the message). HanMark lets you take
your knowledge *out* of those formats and keep its source under your control — **without
becoming a developer first.**

> 📖 More on the philosophy: [당신이 사고하는 지식생산의 주권은 누구에게 있는가 — Sovereign PKM](https://www.linkedin.com/pulse/%EB%8B%B9%EC%8B%A0%EC%9D%B4-%EC%82%AC%EA%B3%A0%ED%95%98%EB%8A%94-%EC%A7%80%EC%8B%9D%EC%83%9D%EC%82%B0%EC%9D%98-%EC%A3%BC%EA%B6%8C%EC%9D%80-%EB%88%84%EA%B5%AC%EC%97%90%EA%B2%8C-%EC%9E%88%EB%8A%94%EA%B0%80-what-you-need-soverign-pkm-ahn-yhtgc/)

## Features

### 📥 Import — liberate documents from closed formats
Convert **HWP, HWPX, PDF, DOCX, XLSX / XLS** into clean Markdown in one click. Powered by a
bundled parser — **no Python, no setup, fully offline.** The result lands as a new note, with
the source recorded in its frontmatter (original path, format, SHA-256 hash, size, import time).

### 👁 Live preview — read Hangul & Word inside Obsidian
Open HWP and DOCX files in a side-by-side preview without leaving your vault.

### 📤 Export — produce the institution's format, on demand
Turn a note back into **HWP, DOCX, or HTML** through templates, for when an organization needs
their format.

## Requirements & platform support

HanMark is **desktop-only** (Windows, macOS, Linux — not mobile).

| | Setup needed |
| --- | --- |
| **Import** | None. Works out of the box, offline. |
| **Live preview & export** | A local **Python + pandoc** toolchain. The plugin walks you through a one-time setup on first use. |

On **Windows**, export/preview can additionally use a Word-based *exact* PDF preview; on macOS
and Linux the same features run through pandoc. Required asset files are embedded in the plugin
and unpacked into the plugin folder automatically on first load — nothing to copy by hand.

## Installation

**From the community catalog:** search for **HanMark** in _Settings → Community plugins →
Browse_, install, and enable.

**Manual:** download `main.js`, `manifest.json`, and `styles.css` from the
[latest release](https://github.com/laguna821/hanmark/releases) and place them in
`<your vault>/.obsidian/plugins/hanmark/`, then enable the plugin.

## Usage

1. Click the **불러오기 (Import)** icon in the editor toolbar, or run the import command from the
   command palette.
2. Pick an `.hwp / .hwpx / .pdf / .docx / .xlsx` file — HanMark converts it and opens a new note.
3. For live preview / export, follow the in-app guide to set up Python + pandoc on first use.

---

## 한국어

**한글(HWP) 문서와 옵시디언 노트를 잇는 양방향 다리.**
HWP · HWPX · PDF · DOCX · XLSX를 마크다운으로 불러오고, 노트를 다시 HWP · DOCX · HTML로 내보냅니다.

> 원본은 내가 온전히 소유하는 마크다운으로 — 앱에 종속되지 않고, 미래에도 열리고, AI가 다룰 수 있게.
> 조직이 요구할 때만 HWP/DOCX로 내보내세요.

### 왜 만들었나

옵시디언이 중요하다는 건 압니다. 그런데 정작 내 자료는 — 수년치가 — 이미 한글(HWP)이나 워드에 들어 있죠.
옮기자니 막막하고, "파이썬 깔고 변환기 설치하세요" 소리에 바로 포기하게 됩니다. 바로 이 지점에서 대부분의
교수·공무원·연구자·지식노동자가 멈춰 섭니다.

HanMark는 정확히 그분들을 위해, 하나의 생각을 중심으로 만들었습니다 — **지식생산의 주권(sovereign PKM)**:

- **원본은 마크다운.** 내가 완전히 통제하는 plain text — 앱에 독립적이고, 자동화·AI와 잘 맞고, 수십 년 뒤에도
  열립니다.
- **조직의 포맷은 '출력물'일 뿐.** HWP / DOCX / HTML은 조직이 요구할 때만 만들어내면 됩니다 — 내 사고가 사는
  곳이 아니라.

닫힌 포맷은 사고방식을 은근히 강제합니다(the medium is the message). HanMark는 그 포맷에 갇힌 지식을 *꺼내어*
원본의 주도권을 내 손에 두게 해줍니다 — **개발자가 되지 않고도.**

> 📖 철학에 관한 글: [당신이 사고하는 지식생산의 주권은 누구에게 있는가 — Sovereign PKM](https://www.linkedin.com/pulse/%EB%8B%B9%EC%8B%A0%EC%9D%B4-%EC%82%AC%EA%B3%A0%ED%95%98%EB%8A%94-%EC%A7%80%EC%8B%9D%EC%83%9D%EC%82%B0%EC%9D%98-%EC%A3%BC%EA%B6%8C%EC%9D%80-%EB%88%84%EA%B5%AC%EC%97%90%EA%B2%8C-%EC%9E%88%EB%8A%94%EA%B0%80-what-you-need-soverign-pkm-ahn-yhtgc/)

### 기능

- **📥 불러오기 — 닫힌 포맷에서 문서를 해방**
  HWP · HWPX · PDF · DOCX · XLSX / XLS를 클릭 한 번으로 깔끔한 마크다운으로 변환합니다. 파서가 내장되어
  **파이썬·설치 불필요, 완전 오프라인.** 변환된 노트의 프론트매터에 출처(원본 경로·형식·SHA-256·크기·시간)가
  기록됩니다.
- **👁 라이브 미리보기 — 한글·워드를 옵시디언 안에서**
  HWP·DOCX 파일을 볼트를 떠나지 않고 분할 화면으로 미리봅니다.
- **📤 내보내기 — 필요할 때 조직의 포맷으로**
  노트를 템플릿 기반으로 **HWP, DOCX, HTML**로 다시 내보냅니다.

### 요구사항 · 플랫폼

**데스크톱 전용**입니다 (Windows · macOS · Linux, 모바일 미지원).

- **불러오기**: 설치 불필요. 오프라인으로 바로 작동.
- **라이브 미리보기 · 내보내기**: 로컬 **Python + pandoc** 환경 필요. 첫 사용 시 플러그인이 설치를 안내합니다.
- Windows는 워드 기반 *정밀* PDF 미리보기를 추가로 쓸 수 있고, macOS·Linux는 같은 기능이 pandoc으로 동작합니다.
- 필요한 에셋 파일은 플러그인에 내장되어 첫 로드 시 플러그인 폴더에 **자동 생성**됩니다 — 수동 복사 불필요.

### 설치

- **커뮤니티 목록**: _설정 → 커뮤니티 플러그인 → 탐색_에서 **HanMark** 검색 후 설치·활성화.
- **수동 설치**: [최신 릴리스](https://github.com/laguna821/hanmark/releases)에서 `main.js`·`manifest.json`·
  `styles.css`를 받아 `<볼트>/.obsidian/plugins/hanmark/`에 넣고 활성화.

---

## 🙏 Special thanks

HanMark stands on the shoulders of three projects that make it possible:

- **[Pandoc](https://pandoc.org/)** — the core engine behind the Markdown → DOCX pipeline, and
  what powers pypandoc-hwpx.
- **[msjang/pypandoc-hwpx](https://github.com/msjang/pypandoc-hwpx)** — the Markdown → HWPX
  export pipeline.
- **[chrisryugj/kordoc](https://github.com/chrisryugj/kordoc)** — the parser logic behind the
  import (불러오기) button.

## Bundled libraries

HanMark also bundles these open-source libraries, with thanks:

| Library | Purpose | License |
| --- | --- | --- |
| [kordoc](https://github.com/chrisryugj/kordoc) | HWP / HWPX / DOCX / XLSX / PDF parsing | MIT |
| [pdf.js (pdfjs-dist)](https://github.com/mozilla/pdf.js) | PDF parsing | Apache-2.0 |
| [JSZip](https://stuk.github.io/jszip/) | HWPX / DOCX (ZIP) packaging | MIT |
| [js-cfb](https://github.com/SheetJS/js-cfb) | Legacy HWP (OLE / CFB) container | Apache-2.0 |
| [@xmldom/xmldom](https://github.com/xmldom/xmldom) | XML parsing | MIT |

## License & author

Released under the [MIT License](LICENSE).

Made by **Achmage** — ACH_안창현 (더베러 단톡방) · 한림대학교 미디어스쿨 / Hallym University School of Media.
