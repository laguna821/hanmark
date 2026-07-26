import type {
  DocumentStyleProfile,
  DocumentStyleRole,
  RoleStyleProfile
} from "../io/documentStyle";

export interface HtmlPageLayout {
  widthPt: number;
  heightPt: number;
  marginLeftPt: number;
  marginRightPt: number;
  marginTopPt: number;
  marginBottomPt: number;
}

export interface HtmlExportOptions {
  title: string;
  documentStyle?: DocumentStyleProfile;
  page?: Partial<HtmlPageLayout>;
  theme?: "achmage-editorial" | "classic";
}

export type HtmlBlockType =
  | "empty"
  | "hr"
  | "table"
  | "codeblock"
  | "body"
  | "quote"
  | "list"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6";

export interface HtmlBlock {
  type: HtmlBlockType;
  html: string;
  indent: number;
}

const DEFAULT_PAGE: HtmlPageLayout = {
  widthPt: 595.3,
  heightPt: 841.9,
  marginLeftPt: 72,
  marginRightPt: 72,
  marginTopPt: 42.6,
  marginBottomPt: 49.6
};

const DEFAULT_BODY_STYLE: RoleStyleProfile = {
  character: {
    fontFamily: "함초롬바탕",
    latinFontFamily: "Times New Roman",
    fontSizePt: 10,
    color: "#000000",
    widthPercent: 100,
    letterSpacingPercent: 0
  },
  paragraph: {
    alignment: "JUSTIFY",
    lineSpacingPercent: 160
  }
};

const DEFAULT_HEADING_SIZES = [20, 17, 15, 13, 12, 11] as const;
const TOKEN_OPEN = "\uE000";
const TOKEN_CLOSE = "\uE001";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const SAFE_RASTER_DATA_URL =
  /^data:image\/(png|jpeg|gif|bmp);base64,([A-Za-z0-9+/]+={0,2})$/i;
const RASTER_BASE64_SIGNATURES: Record<string, string> = {
  png: "iVBORw0KGgo",
  jpeg: "/9j/",
  gif: "R0lGOD",
  bmp: "Qk"
};

function isStructurallyValidRasterBase64(mime: string, value: string): boolean {
  return value.length > 0 &&
    value.length % 4 === 0 &&
    value.startsWith(RASTER_BASE64_SIGNATURES[mime.toLowerCase()] ?? "\u0000");
}

function hasUnsafeControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}

function safeUrl(value: string, image: boolean): string {
  const trimmed = value.trim();
  if (!trimmed) return image ? "" : "#";

  if (hasUnsafeControlCharacter(trimmed)) {
    return image ? "" : "#";
  }

  if (image) {
    const match = trimmed.match(SAFE_RASTER_DATA_URL);
    return match && isStructurallyValidRasterBase64(match[1], match[2])
      ? trimmed
      : "";
  }

  try {
    const parsed = new URL(trimmed);
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol.toLowerCase()) ? trimmed : "#";
  } catch {
    return "#";
  }
}

function inlineToHtml(value: string): string {
  const tokens: string[] = [];
  const stash = (html: string): string => {
    const index = tokens.push(html) - 1;
    return `${TOKEN_OPEN}${index}${TOKEN_CLOSE}`;
  };
  let text = value
    .split(TOKEN_OPEN).join("\uFFFD")
    .split(TOKEN_CLOSE).join("\uFFFD");

  text = text.replace(/`([^`\r\n]+)`/g, (_match, code: string) =>
    stash(`<code class="hanmark-inline-code">${escapeHtml(code)}</code>`)
  );
  text = text.replace(/!\[([^\]]*)\]\(([^)\r\n]+)\)/g, (_match, alt: string, source: string) => {
    const url = safeUrl(source, true);
    if (!url) return escapeHtml(alt);
    return stash(
      `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}" loading="lazy">`
    );
  });
  text = text.replace(/\[([^\]\r\n]+)\]\(([^)\r\n]+)\)/g, (_match, label: string, source: string) => {
    const url = safeUrl(source, false);
    return stash(
      `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    );
  });
  text = text.replace(/\[\[([^\]\r\n]*?)\|([^\]\r\n]+)\]\]/g, (_match, _target: string, label: string) =>
    stash(`<span class="hanmark-wikilink">${escapeHtml(label)}</span>`)
  );
  text = text.replace(/\[\[([^\]\r\n]+)\]\]/g, (_match, label: string) =>
    stash(`<span class="hanmark-wikilink">${escapeHtml(label)}</span>`)
  );

  text = escapeHtml(text);
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(?<!\*)\*([^*\r\n]+)\*(?!\*)/g, "<em>$1</em>");
  text = text.replace(/(?<!\w)_([^_\r\n]+)_(?!\w)/g, "<em>$1</em>");
  text = text.replace(/~~(.+?)~~/g, "<del>$1</del>");
  text = text.replace(/==(.+?)==/g, "<mark>$1</mark>");
  return text.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => tokens[Number(index)] ?? "");
}

function tableCells(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => inlineToHtml(cell.trim()));
}

function isTableDelimiter(line: string): boolean {
  const cells = line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderTable(lines: string[]): string | null {
  if (lines.length < 2) return null;
  const delimiterIndex = lines.findIndex(isTableDelimiter);
  const hasHeader = delimiterIndex === 1;
  const header = hasHeader ? tableCells(lines[0]) : null;
  const bodyLines = lines.filter((_line, index) => index !== delimiterIndex && !(hasHeader && index === 0));
  if (bodyLines.length === 0 && !header) return null;

  const headHtml = header
    ? `<thead><tr>${header.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>`
    : "";
  const bodyHtml = bodyLines
    .map((line) => `<tr>${tableCells(line).map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("");
  return `<table>${headHtml}<tbody>${bodyHtml}</tbody></table>`;
}

function semanticHeading(line: string): HtmlBlockType | null {
  if (/^\d+\.\s+/.test(line)) return "h2";
  if (/^[가-힣]\.\s+/.test(line)) return "h3";
  if (/^\d+\)\s+/.test(line)) return "h4";
  if (/^[가-힣]\)\s+/.test(line)) return "h5";
  if (/^\((?:\d+|[가-힣])\)\s+/.test(line)) return "h6";
  return null;
}

/** Pure, dependency-free replacement for the legacy MarkdownPreprocessor. */
export function preprocessMarkdownForHtml(markdown: string): HtmlBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: HtmlBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const sourceLine = lines[index];
    const line = sourceLine.trim();
    if (!line) {
      blocks.push({ type: "empty", html: "", indent: 0 });
      index += 1;
      continue;
    }

    const fence = line.match(/^(```|~~~)\s*([A-Za-z0-9_+-]*)/);
    if (fence) {
      const marker = fence[1];
      const language = fence[2];
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(marker)) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const languageClass = language ? ` class="language-${escapeAttribute(language)}"` : "";
      blocks.push({
        type: "codeblock",
        html: `<pre><code${languageClass}>${escapeHtml(code.join("\n"))}</code></pre>`,
        indent: 0
      });
      continue;
    }

    if (line.startsWith("|") && line.endsWith("|")) {
      const tableLines: string[] = [];
      while (index < lines.length) {
        const candidate = lines[index].trim();
        if (!candidate.startsWith("|") || !candidate.endsWith("|")) break;
        tableLines.push(candidate);
        index += 1;
      }
      const table = renderTable(tableLines);
      if (table) {
        blocks.push({ type: "table", html: table, indent: 0 });
      } else {
        for (const candidate of tableLines) {
          blocks.push({ type: "body", html: escapeHtml(candidate), indent: 0 });
        }
      }
      continue;
    }

    if (/^[-*_]{3,}$/.test(line)) {
      blocks.push({ type: "hr", html: "", indent: 0 });
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: `h${heading[1].length}` as HtmlBlockType,
        html: inlineToHtml(heading[2]),
        indent: 0
      });
      index += 1;
      continue;
    }

    if (line.startsWith("> ")) {
      blocks.push({ type: "quote", html: inlineToHtml(line.slice(2)), indent: 0 });
      index += 1;
      continue;
    }

    const task = line.match(/^[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (task) {
      blocks.push({
        type: "list",
        html: `${task[1] === " " ? "☐" : "☑"} ${inlineToHtml(task[2])}`,
        indent: Math.floor((sourceLine.length - sourceLine.trimStart().length) / 2)
      });
      index += 1;
      continue;
    }

    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      blocks.push({
        type: "list",
        html: `• ${inlineToHtml(bullet[1])}`,
        indent: Math.floor((sourceLine.length - sourceLine.trimStart().length) / 2)
      });
      index += 1;
      continue;
    }

    const numberedHeading = semanticHeading(line);
    blocks.push({
      type: numberedHeading ?? "body",
      html: inlineToHtml(line),
      indent: 0
    });
    index += 1;
  }
  return blocks;
}

function roleForBlock(type: HtmlBlockType): DocumentStyleRole {
  if (/^h[1-6]$/.test(type)) return type as DocumentStyleRole;
  if (type === "quote" || type === "list") return type;
  if (type === "codeblock") return "code";
  return "body";
}

function fallbackStyle(role: DocumentStyleRole): RoleStyleProfile {
  if (!/^h[1-6]$/.test(role)) return DEFAULT_BODY_STYLE;
  const level = Number(role.slice(1));
  return {
    character: {
      ...DEFAULT_BODY_STYLE.character,
      fontFamily: "맑은 고딕",
      latinFontFamily: "Arial",
      fontSizePt: DEFAULT_HEADING_SIZES[level - 1] ?? 11,
      bold: true
    },
    paragraph: {
      ...DEFAULT_BODY_STYLE.paragraph,
      alignment: level <= 2 ? "CENTER" : "LEFT",
      keepWithNext: true
    }
  };
}

function cssFontFamily(value: string): string {
  return `"${value.replace(/["\\]/g, "")}"`;
}

function roleStyleToCss(style: RoleStyleProfile, listIndent = 0): string {
  const character = style.character;
  const paragraph = style.paragraph;
  const css: string[] = [];
  if (character?.fontSizePt) css.push(`font-size:${character.fontSizePt}pt`);
  if (character?.fontFamily) {
    const families = [cssFontFamily(character.fontFamily)];
    if (character.latinFontFamily) families.push(cssFontFamily(character.latinFontFamily));
    families.push('"Malgun Gothic"', "serif");
    css.push(`font-family:${families.join(",")}`);
  }
  if (character?.bold) css.push("font-weight:bold");
  if (character?.italic) css.push("font-style:italic");
  if (character?.underline) css.push("text-decoration:underline");
  if (character?.color && /^#[0-9A-Fa-f]{6}$/.test(character.color)) {
    css.push(`color:${character.color}`);
  }
  if (character?.letterSpacingPercent) {
    css.push(`letter-spacing:${(character.letterSpacingPercent / 100).toFixed(2)}em`);
  }
  if (character?.widthPercent && character.widthPercent !== 100) {
    css.push(`font-stretch:${character.widthPercent}%`);
  }
  if (paragraph?.alignment) {
    const alignment = paragraph.alignment === "JUSTIFY" ||
      paragraph.alignment === "DISTRIBUTE" ||
      paragraph.alignment === "DISTRIBUTE_SPACE"
      ? "justify"
      : paragraph.alignment.toLowerCase();
    css.push(`text-align:${alignment}`);
  }
  if (paragraph?.lineSpacingPercent) {
    css.push(`line-height:${(paragraph.lineSpacingPercent / 100).toFixed(2)}`);
  }
  const left = (paragraph?.marginLeftHu ?? 0) / 100 + listIndent * 20;
  if (left) css.push(`margin-left:${left}pt`);
  if (paragraph?.marginRightHu) css.push(`margin-right:${paragraph.marginRightHu / 100}pt`);
  if (paragraph?.firstLineIndentHu && listIndent === 0) {
    css.push(`text-indent:${paragraph.firstLineIndentHu / 100}pt`);
  }
  if (paragraph?.spaceBeforeHu) css.push(`margin-top:${paragraph.spaceBeforeHu / 100}pt`);
  if (paragraph?.spaceAfterHu) css.push(`margin-bottom:${paragraph.spaceAfterHu / 100}pt`);
  return css.join(";");
}

function effectiveRoleStyle(
  profile: DocumentStyleProfile | undefined,
  role: DocumentStyleRole
): RoleStyleProfile {
  const fallback = fallbackStyle(role);
  const body = profile?.roles.body;
  const selected = profile?.roles[role];
  return {
    character: {
      ...fallback.character,
      ...body?.character,
      ...selected?.character
    },
    paragraph: {
      ...fallback.paragraph,
      ...body?.paragraph,
      ...selected?.paragraph
    }
  };
}

function resolvePage(options: HtmlExportOptions): HtmlPageLayout {
  const profilePage = options.documentStyle?.page;
  const fromProfile: Partial<HtmlPageLayout> = profilePage
    ? {
        widthPt: profilePage.widthHu / 100,
        heightPt: profilePage.heightHu / 100,
        marginLeftPt: profilePage.margins.left / 100,
        marginRightPt: profilePage.margins.right / 100,
        marginTopPt: profilePage.margins.top / 100,
        marginBottomPt: profilePage.margins.bottom / 100
      }
    : {};
  return { ...DEFAULT_PAGE, ...fromProfile, ...options.page };
}

export function renderHtmlBody(
  markdown: string,
  profile?: DocumentStyleProfile
): string {
  const bodyStyle = effectiveRoleStyle(profile, "body");
  return preprocessMarkdownForHtml(markdown)
    .map((block) => {
      if (block.type === "empty") {
        return `<div class="hanmark-line hanmark-empty" style="${roleStyleToCss(bodyStyle)}">&nbsp;</div>`;
      }
      if (block.type === "hr") return "<hr>";
      if (block.type === "table") return `<div class="hanmark-table-wrap">${block.html}</div>`;
      if (block.type === "codeblock") return `<div class="hanmark-codeblock">${block.html}</div>`;
      const role = roleForBlock(block.type);
      const style = effectiveRoleStyle(profile, role);
      const extras = block.type === "quote"
        ? ";border-left:2px solid #4a86c8;padding-left:9pt;color:#555"
        : block.type === "list"
          ? ";text-indent:-12pt;padding-left:12pt"
          : "";
      return `<div class="hanmark-line hanmark-${block.type}" style="${roleStyleToCss(style, block.indent)}${extras}">${block.html}</div>`;
    })
    .join("\n");
}

const CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
const KAMI_ATTRIBUTION =
  "Achmage Editorial theme adapted from Kami under the MIT License.";

function renderDocumentHead(title: string, css: string): string {
  return `<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
<title>${escapeHtml(title)}</title>
<style>
${css}
</style>
</head>`;
}

function renderClassicStandaloneHtml(
  markdown: string,
  options: HtmlExportOptions
): string {
  const page = resolvePage(options);
  const body = renderHtmlBody(markdown, options.documentStyle);
  const css = `
* { box-sizing: border-box; }
body { margin: 0; background: #e8e8e8; display: flex; justify-content: center; padding: 40px 20px; }
.hanmark-paper {
  background: #fff;
  width: ${page.widthPt}pt;
  min-height: ${page.heightPt}pt;
  padding: ${page.marginTopPt}pt ${page.marginRightPt}pt ${page.marginBottomPt}pt ${page.marginLeftPt}pt;
  box-shadow: 0 2px 10px rgba(0,0,0,.15);
  color: #1a1a1a;
  word-break: keep-all;
  overflow-wrap: break-word;
}
.hanmark-line { margin: 0; padding: 1px 0; }
a, .hanmark-wikilink { color: #1a73e8; text-decoration: underline; }
img { display: block; max-width: 100%; height: auto; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; table-layout: fixed; }
th, td { border: 1px solid #ccc; padding: 6px 10px; word-break: break-word; overflow-wrap: anywhere; }
th { background: #f0f4f8; font-weight: bold; text-align: left; }
tbody tr:nth-child(even) { background: #fafbfc; }
pre { background: #f8f9fa; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: .9em; }
code { font-family: "Consolas", "D2Coding", monospace; }
.hanmark-inline-code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: .9em; }
mark { background: #fef08a; padding: 0 2px; }
hr { border: 0; border-top: 1px solid #999; margin: 12px 0; }
@media print {
  body { background: none; padding: 0; }
  .hanmark-paper { box-shadow: none; }
}`;
  return `<!DOCTYPE html>
<html lang="ko">
${renderDocumentHead(options.title, css)}
<body><main class="hanmark-paper">${body}</main></body>
</html>`;
}

function plainHeadingTitle(markdown: string): string | null {
  const firstContentLine = markdown
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)
    ?.trim();
  const heading = firstContentLine?.match(/^#\s+(.+)$/);
  if (!heading) return null;
  return heading[1]
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/`([^`\r\n]+)`/g, "$1")
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<!\*)\*([^*\r\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<!\w)_([^_\r\n]+)_(?!\w)/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/==(.+?)==/g, "$1")
    .trim() || null;
}

function renderEditorialBlock(block: HtmlBlock): string {
  if (block.type === "empty") {
    return `<div class="hanmark-line hanmark-empty" aria-hidden="true">&nbsp;</div>`;
  }
  if (block.type === "hr") return "<hr>";
  if (block.type === "table") {
    return `<div class="hanmark-table-wrap">${block.html}</div>`;
  }
  if (block.type === "codeblock") {
    return `<div class="hanmark-codeblock">${block.html}</div>`;
  }
  if (block.type === "quote") {
    const calloutContent = block.html.replace(
      /^\[![A-Za-z0-9_-]+\][+-]?\s*/i,
      ""
    );
    return `<aside class="hanmark-callout">${calloutContent}</aside>`;
  }
  if (block.type === "list") {
    const level = Math.max(0, Math.min(6, block.indent));
    return `<div class="hanmark-line hanmark-list hanmark-indent-${level}">${block.html}</div>`;
  }
  if (/^h[1-6]$/.test(block.type)) {
    return `<${block.type} class="hanmark-heading">${block.html}</${block.type}>`;
  }
  return `<p class="hanmark-line hanmark-body">${block.html}</p>`;
}

function editorialDocument(markdown: string, fallbackTitle: string): {
  title: string;
  masthead: string;
  body: string;
} {
  const blocks = preprocessMarkdownForHtml(markdown);
  const firstContentIndex = blocks.findIndex((block) => block.type !== "empty");
  const leadingHeading =
    firstContentIndex >= 0 && blocks[firstContentIndex].type === "h1"
      ? blocks[firstContentIndex]
      : null;
  if (leadingHeading && firstContentIndex >= 0) {
    blocks.splice(firstContentIndex, 1);
  }
  return {
    title: plainHeadingTitle(markdown) ?? fallbackTitle,
    masthead: leadingHeading?.html ?? escapeHtml(fallbackTitle),
    body: blocks.map(renderEditorialBlock).join("\n")
  };
}

function renderEditorialStandaloneHtml(
  markdown: string,
  options: HtmlExportOptions
): string {
  const document = editorialDocument(markdown, options.title);
  const css = `
:root {
  --hanmark-white: #FFFFFF;
  --hanmark-ivory: #F4F8FB;
  --hanmark-navy: #002E6E;
  --hanmark-blue: #0066B3;
  --hanmark-teal: #00B5AD;
  --hanmark-ink: #17233A;
  --hanmark-muted: #5A6B82;
  --hanmark-rule: #D8E2EC;
}
* { box-sizing: border-box; }
html { background: var(--hanmark-ivory); }
body {
  margin: 0;
  padding: 48px 24px;
  background: var(--hanmark-ivory);
  color: var(--hanmark-ink);
  font-family: Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif;
  font-size: 16px;
  line-height: 1.75;
  word-break: keep-all;
  overflow-wrap: anywhere;
}
.hanmark-paper {
  width: min(100%, 840px);
  min-height: 1040px;
  margin: 0 auto;
  padding: 72px 76px 80px;
  background: var(--hanmark-white);
  border-top: 8px solid var(--hanmark-navy);
  box-shadow: 0 18px 54px rgba(0, 46, 110, .14);
}
.hanmark-masthead { margin: 0 0 56px; }
.hanmark-kicker {
  margin: 0 0 12px;
  color: var(--hanmark-blue);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .14em;
  text-transform: uppercase;
}
.hanmark-masthead h1 {
  margin: 0;
  color: var(--hanmark-navy);
  font-size: clamp(30px, 5vw, 48px);
  line-height: 1.18;
  letter-spacing: -.035em;
}
.hanmark-masthead-rule {
  width: 88px;
  height: 6px;
  margin-top: 26px;
  background: linear-gradient(90deg, var(--hanmark-blue), var(--hanmark-teal));
}
.hanmark-heading {
  position: relative;
  margin: 2.15em 0 .8em;
  padding-left: 17px;
  color: var(--hanmark-navy);
  line-height: 1.35;
  letter-spacing: -.018em;
  break-after: avoid-page;
}
.hanmark-heading::before {
  content: "";
  position: absolute;
  inset: .12em auto .12em 0;
  width: 5px;
  border-radius: 3px;
  background: var(--hanmark-teal);
}
h1.hanmark-heading { font-size: 2rem; }
h2.hanmark-heading { font-size: 1.55rem; }
h3.hanmark-heading { font-size: 1.28rem; }
h4.hanmark-heading, h5.hanmark-heading, h6.hanmark-heading { font-size: 1.08rem; }
.hanmark-line { margin: 0; }
.hanmark-body { margin: 0 0 .72em; }
.hanmark-empty { min-height: .72em; }
.hanmark-list { position: relative; margin: .32em 0; padding-left: 1.35em; }
.hanmark-indent-1 { margin-left: 1.4em; }
.hanmark-indent-2 { margin-left: 2.8em; }
.hanmark-indent-3 { margin-left: 4.2em; }
.hanmark-indent-4 { margin-left: 5.6em; }
.hanmark-indent-5 { margin-left: 7em; }
.hanmark-indent-6 { margin-left: 8.4em; }
.hanmark-callout {
  margin: 1.6em 0;
  padding: 18px 20px;
  border: 1px solid rgba(0, 181, 173, .34);
  border-left: 6px solid var(--hanmark-teal);
  border-radius: 0 12px 12px 0;
  background: rgba(0, 181, 173, .08);
  color: #183F4B;
}
a { color: var(--hanmark-blue); text-decoration-thickness: .08em; text-underline-offset: .15em; }
.hanmark-wikilink { color: var(--hanmark-blue); }
img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 1.5em auto;
  border-radius: 8px;
}
.hanmark-table-wrap {
  max-width: 100%;
  margin: 1.6em 0;
  overflow-x: auto;
  border: 1px solid var(--hanmark-rule);
  border-radius: 10px;
}
table { width: 100%; border-collapse: collapse; table-layout: auto; }
th, td { padding: 11px 13px; border: 1px solid var(--hanmark-rule); text-align: left; vertical-align: top; }
th { background: var(--hanmark-navy); color: var(--hanmark-white); font-weight: 750; }
tbody tr:nth-child(even) { background: var(--hanmark-ivory); }
.hanmark-codeblock { max-width: 100%; margin: 1.5em 0; overflow-x: auto; }
pre {
  margin: 0;
  padding: 18px 20px;
  overflow-x: auto;
  border-left: 5px solid var(--hanmark-blue);
  border-radius: 6px;
  background: #EAF1F8;
  color: #12243D;
  white-space: pre;
}
code { font-family: "D2Coding", "Consolas", "SFMono-Regular", monospace; }
.hanmark-inline-code { padding: .12em .35em; border-radius: 4px; background: #EAF1F8; font-size: .92em; }
mark { padding: 0 .18em; background: #DDF7F4; color: inherit; }
hr { margin: 2.2em 0; border: 0; border-top: 2px solid var(--hanmark-rule); }
@media (max-width: 760px) {
  body { padding: 0; background: var(--hanmark-white); font-size: 15px; }
  .hanmark-paper {
    width: 100%;
    min-height: 0;
    margin: 0;
    padding: 38px 20px 52px;
    border-top-width: 6px;
    box-shadow: none;
  }
  .hanmark-masthead { margin-bottom: 38px; }
  .hanmark-masthead h1 { font-size: clamp(28px, 9vw, 38px); }
  .hanmark-indent-4, .hanmark-indent-5, .hanmark-indent-6 { margin-left: 4.2em; }
}
@page { size: A4; margin: 18mm 17mm 20mm; }
@media print {
  html, body { background: none; }
  body { padding: 0; font-size: 10.5pt; line-height: 1.65; }
  .hanmark-paper {
    width: auto;
    min-height: 0;
    margin: 0;
    padding: 0;
    border: 0;
    box-shadow: none;
  }
  .hanmark-masthead { break-after: avoid-page; }
  .hanmark-heading { break-after: avoid-page; }
  .hanmark-body, .hanmark-list { orphans: 3; widows: 3; }
  .hanmark-table-wrap, table, pre, img, .hanmark-callout { break-inside: avoid; }
  a { color: inherit; }
}`;
  return `<!DOCTYPE html>
<!-- ${KAMI_ATTRIBUTION} -->
<html lang="ko">
${renderDocumentHead(document.title, css)}
<body>
<main class="hanmark-paper">
<header class="hanmark-masthead">
<p class="hanmark-kicker">HanMark Editorial</p>
<h1>${document.masthead}</h1>
<div class="hanmark-masthead-rule" aria-hidden="true"></div>
</header>
${document.body}
</main>
</body>
</html>`;
}

export function renderStandaloneHtml(markdown: string, options: HtmlExportOptions): string {
  return options.theme === "classic"
    ? renderClassicStandaloneHtml(markdown, options)
    : renderEditorialStandaloneHtml(markdown, options);
}

export function renderStandaloneHtmlBytes(
  markdown: string,
  options: HtmlExportOptions
): Uint8Array {
  return new TextEncoder().encode(renderStandaloneHtml(markdown, options));
}
