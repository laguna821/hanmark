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

function safeUrl(value: string, image: boolean): string {
  const trimmed = value.trim();
  if (!trimmed) return image ? "" : "#";
  const compact = [...trimmed]
    .filter((character) => (character.codePointAt(0) ?? 0) > 0x20)
    .join("")
    .toLowerCase();
  if (compact.startsWith("javascript:") || compact.startsWith("vbscript:")) {
    return image ? "" : "#";
  }
  if (compact.startsWith("data:") && !(image && compact.startsWith("data:image/"))) {
    return image ? "" : "#";
  }
  return trimmed;
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

export function renderStandaloneHtml(markdown: string, options: HtmlExportOptions): string {
  const page = resolvePage(options);
  const body = renderHtmlBody(markdown, options.documentStyle);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(options.title)}</title>
<style>
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
}
</style>
</head>
<body><main class="hanmark-paper">${body}</main></body>
</html>`;
}

export function renderStandaloneHtmlBytes(
  markdown: string,
  options: HtmlExportOptions
): Uint8Array {
  return new TextEncoder().encode(renderStandaloneHtml(markdown, options));
}
