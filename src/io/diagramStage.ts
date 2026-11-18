import { PeleError, detectType, render, type TextMeasurer } from "pele";
import type { AdapterWarning } from "./markdownAdapter";
import { applyDiagramRoles, isSafeDiagramSvg, literalizeDiagramSvg, type DiagramPalette } from "./diagramSvg";
import { base64ToBytes, bytesToBase64, withPngDisplayScale } from "./pngMeta";
import { t } from "../i18n";

/**
 * The one step that turns Mermaid code blocks into drawn diagrams for every export
 * (R-033). It runs after note assembly and before any writer, so HWPX, DOCX, HTML,
 * Editorial PDF and both previews agree on what a diagram is and how it looks.
 *
 * - "hwpx" and "docx": the block becomes a PNG picture reference (a data URL the
 *   existing image pipelines already read) and a caption paragraph; the PNG carries a
 *   mark, so the writers centre both and place the picture at its drawn size.
 * - "markup": the block becomes one token paragraph that carries the SVG; the HTML
 *   and PDF writers replace it by inline SVG (vector, selectable text).
 */
export type DiagramTarget = "hwpx" | "docx" | "markup";

/** What the host (Obsidian window, test) supplies to draw diagrams. */
export interface DiagramEnvironment {
  palette: DiagramPalette;
  /** Literal CSS family list written into the SVG and used for measuring. */
  fontFamily: string;
  /** Text measurer for `fontFamily`; without one Pele measures with a canvas or its own metrics. */
  measurer?: TextMeasurer;
  /** Draws an SVG at `scale` image pixels per SVG pixel and returns PNG bytes. */
  rasterize?: (svg: string, width: number, height: number, scale: number) => Promise<Uint8Array>;
  /** Widest a diagram may be laid out, in CSS pixels (the text width of a page). */
  maxWidth?: number;
  fontSize?: number;
  /** Day used for date-dependent drawing (Gantt "today"); fixed in tests. */
  now?: Date;
  /** Said once in the report when the note's font could not be used. */
  fontNotice?: string;
}

export interface DiagramAnnotations {
  caption?: string;
  alt?: string;
  key: string[];
  interpretation: string[];
  aux: string[];
}

export interface RenderedDiagram {
  svg: string;
  width: number;
  height: number;
  type: string;
  caption?: string;
  alt?: string;
}

export interface DiagramStageResult {
  markdown: string;
  warnings: AdapterWarning[];
  /** Blocks drawn as diagrams. */
  rendered: number;
  /** Blocks left as code. */
  kept: number;
}

export const DIAGRAM_RASTER_SCALE = 2;
const DEFAULT_MAX_WIDTH = 600;
const DEFAULT_FONT_SIZE = 14;
/**
 * A diagram wider than the page is drawn in the direction its author wrote and placed
 * smaller, down to this share of its drawn size (14 px text stays near 7.5 pt). Only
 * below it may Pele turn the diagram to fit, as it does in a narrow pane.
 */
const MIN_DIAGRAM_FIT = 0.7;
const MAX_SOURCE_LENGTH = 100_000;
const TOKEN_OPEN = "HMDIAGRAM(";
const TOKEN_CLOSE = ")";
const TOKEN_PATTERN = /HMDIAGRAM\(([A-Za-z0-9+/=]+)\)/gu;

const FENCE_OPEN = /^((?:[ \t]*>)*[ \t]*)(`{3,}|~{3,})[ \t]*mermaid[ \t]*$/iu;
const ANY_FENCE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})/u;
const ANNOTATION = /^\s*%%\s*@(caption|alt|key|interp|aux):\s*(.*?)\s*$/u;

/** Reads `%% @caption:` style comments; they steer the export and never show as text. */
export function readDiagramAnnotations(source: string): DiagramAnnotations {
  const out: DiagramAnnotations = { key: [], interpretation: [], aux: [] };
  for (const line of source.split(/\r?\n/u)) {
    const match = ANNOTATION.exec(line);
    if (!match) continue;
    const [, role, value] = match;
    if (role === "caption" || role === "alt") {
      if (value) out[role] = value;
    } else {
      const names = value.split(",").map((name) => name.trim()).filter(Boolean);
      out[role === "interp" ? "interpretation" : role === "key" ? "key" : "aux"].push(...names);
    }
  }
  return out;
}

export interface MermaidBlock {
  /** First and last line index (the fence lines). */
  start: number;
  end: number;
  /** Container prefix of the opening fence (quote markers and indentation). */
  prefix: string;
  source: string;
}

function stripContainer(line: string, quoteDepth: number, indent: number): string | null {
  let rest = line;
  for (let depth = 0; depth < quoteDepth; depth += 1) {
    const marker = /^[ \t]*>[ ]?/u.exec(rest);
    if (!marker) return null;
    rest = rest.slice(marker[0].length);
  }
  let removed = 0;
  while (removed < indent && (rest[removed] === " " || rest[removed] === "\t")) removed += 1;
  return rest.slice(removed);
}

function isClosingFence(line: string, fence: string): boolean {
  const close = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line)?.[1];
  return Boolean(close && close[0] === fence[0] && close.length >= fence.length);
}

/** Finds closed Mermaid fences, also inside quotes, callouts and list items. */
export function findMermaidBlocks(markdown: string): MermaidBlock[] {
  const lines = markdown.split("\n").map((line) => line.replace(/\r$/u, ""));
  const blocks: MermaidBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const open = FENCE_OPEN.exec(lines[index]);
    if (!open) {
      // A Mermaid fence shown inside another code block is text, not a diagram.
      const other = ANY_FENCE.exec(lines[index])?.[1];
      if (other) {
        for (let at = index + 1; at < lines.length; at += 1) {
          if (isClosingFence(lines[at].replace(/^(?:[ \t]*>)*/u, ""), other)) {
            index = at;
            break;
          }
        }
      }
      continue;
    }
    const [, prefix, fence] = open;
    const quoteDepth = (prefix.match(/>/gu) ?? []).length;
    const tail = prefix.slice(prefix.lastIndexOf(">") + 1);
    const indent = quoteDepth && tail.startsWith(" ") ? tail.length - 1 : tail.length;
    const body: string[] = [];
    let end = -1;
    for (let at = index + 1; at < lines.length; at += 1) {
      const inner = stripContainer(lines[at], quoteDepth, indent);
      if (inner === null) break;
      if (isClosingFence(inner, fence)) {
        end = at;
        break;
      }
      body.push(inner);
    }
    if (end < 0) continue;
    blocks.push({ start: index, end, prefix, source: body.join("\n") });
    index = end;
  }
  return blocks;
}

function firstLine(source: string): string {
  const line = source.split("\n").map((item) => item.trim()).find((item) => item && !item.startsWith("%%")) ?? "";
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

function cleanLabel(text: string): string {
  return text.replace(/[\r\n]+/gu, " ").replace(/[[\]]/gu, " ").replace(/\s+/gu, " ").trim();
}

function escapeHtml(text: string): string {
  return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

/** A caption written as a plain Markdown paragraph: nothing in it may start a list, heading or emphasis. */
function escapeMarkdown(text: string): string {
  return text
    .replace(/([\\`*_[\]<>#|~$])/gu, "\\$1")
    .replace(/^(\d+)([.)])(\s)/u, "$1\\$2$3")
    .replace(/^([-+])(\s)/u, "\\$1$2");
}

const base64 = bytesToBase64;

/** Draws one Mermaid source; throws PeleError (or Error) when it cannot be drawn. */
export function renderDiagram(
  source: string,
  environment: DiagramEnvironment,
  idPrefix: string,
  /** Receives the ids of `@key`, `@interp`, `@aux` annotations that are not exactly one node. */
  unmatchedRoles?: string[]
): RenderedDiagram {
  if (source.length > MAX_SOURCE_LENGTH) throw new Error(t("diagram.error.tooLong"));
  const annotations = readDiagramAnnotations(source);
  const maxWidth = environment.maxWidth ?? DEFAULT_MAX_WIDTH;
  const options = {
    ...(environment.measurer ? { measurer: environment.measurer } : {}),
    fontFamily: environment.fontFamily,
    fontFamilyMono: environment.fontFamily,
    fontSize: environment.fontSize ?? DEFAULT_FONT_SIZE,
    maxWidth,
    idPrefix,
    links: false,
    images: false,
    maxEdges: 500,
    now: environment.now ?? new Date(new Date().setHours(0, 0, 0, 0))
  };
  // Keep the direction the note shows in a normal pane (a timeline stays horizontal);
  // a diagram wider than the page is placed smaller instead of being turned.
  let result = render(source, { ...options, autoDirection: false });
  let fit = Math.min(1, maxWidth / result.width);
  if (fit < MIN_DIAGRAM_FIT) {
    const turned = render(source, options);
    const turnedFit = Math.min(1, maxWidth / turned.width);
    if (turnedFit > fit) {
      result = turned;
      fit = turnedFit;
    }
  }
  const width = Math.round(result.width * fit * 100) / 100;
  const height = Math.round(result.height * fit * 100) / 100;
  const title = escapeHtml(annotations.alt ?? annotations.caption ?? result.type);
  // `%% @key`, `@interp`, `@aux` (R-037): drawn on the literal SVG, so every writer gets them.
  const roles = applyDiagramRoles(
    literalizeDiagramSvg(result.svg, environment.palette, environment.fontFamily),
    { key: annotations.key, interpretation: annotations.interpretation, aux: annotations.aux },
    environment.palette
  );
  unmatchedRoles?.push(...roles.unmatched);
  const svg = roles.svg.replace(
    /^<svg\b([^>]*)>/u,
    (_whole, attributes: string) => {
      let kept = attributes.replace(/\s(?:role|aria-roledescription)="[^"]*"/gu, "");
      if (fit < 1) {
        // Placed smaller: the viewBox keeps the drawing, width and height give the placed size.
        if (!/\sviewBox="/u.test(kept)) kept += ` viewBox="0 0 ${result.width} ${result.height}"`;
        kept = kept.replace(/\swidth="[^"]*"/u, "").replace(/\sheight="[^"]*"/u, "");
        kept += ` width="${width}" height="${height}"`;
      }
      return `<svg${kept} role="img"><title>${title}</title>`;
    }
  );
  if (svg.includes("var(") || !isSafeDiagramSvg(svg)) throw new Error(t("diagram.error.unsafe"));
  return {
    svg,
    width,
    height,
    type: result.type,
    ...(annotations.caption ? { caption: annotations.caption } : {}),
    ...(annotations.alt ? { alt: annotations.alt } : {})
  };
}

/** The paragraph text that carries a drawn diagram to the HTML and PDF writers. */
export function encodeDiagramToken(diagram: RenderedDiagram): string {
  return TOKEN_OPEN + base64(new TextEncoder().encode(JSON.stringify(diagram))) + TOKEN_CLOSE;
}

/** Reads a token back; null unless it holds a well-formed, safe diagram. */
export function decodeDiagramToken(text: string): RenderedDiagram | null {
  const match = /^HMDIAGRAM\(([A-Za-z0-9+/=]+)\)$/u.exec(text.trim());
  if (!match) return null;
  try {
    const bytes = base64ToBytes(match[1]);
    if (!bytes) return null;
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<RenderedDiagram>;
    if (typeof value.svg !== "string" || !isSafeDiagramSvg(value.svg) || value.svg.includes("var(")) return null;
    const width = Number(value.width);
    const height = Number(value.height);
    if (!(width > 0 && height > 0 && width < 20_000 && height < 20_000)) return null;
    return {
      svg: value.svg,
      width,
      height,
      type: typeof value.type === "string" ? value.type : "",
      ...(typeof value.caption === "string" && value.caption ? { caption: value.caption } : {}),
      ...(typeof value.alt === "string" && value.alt ? { alt: value.alt } : {})
    };
  } catch {
    return null;
  }
}

/** Figure markup of a diagram for HTML output (the SVG is already checked as safe). */
export function diagramFigureHtml(diagram: RenderedDiagram): string {
  const caption = diagram.caption ? `<figcaption>${escapeHtml(diagram.caption)}</figcaption>` : "";
  return `<figure class="hanmark-diagram">${diagram.svg}${caption}</figure>`;
}

/**
 * Replaces diagram tokens in rendered HTML by figures. A token that fills a whole
 * paragraph replaces the paragraph; text that only looks like a token is left alone.
 */
export function replaceDiagramTokensInHtml(html: string): string {
  if (!html.includes(TOKEN_OPEN)) return html;
  return html
    .replace(/<p\b[^>]*>\s*(HMDIAGRAM\([A-Za-z0-9+/=]+\))\s*<\/p>/gu, (whole: string, token: string) => {
      const diagram = decodeDiagramToken(token);
      return diagram ? diagramFigureHtml(diagram) : whole;
    })
    .replace(TOKEN_PATTERN, (whole: string) => {
      const diagram = decodeDiagramToken(whole);
      return diagram ? diagramFigureHtml(diagram) : whole;
    });
}

function fallbackWarning(type: string | null, source: string, reason: string): AdapterWarning {
  return {
    code: "diagram-kept-as-code",
    message: t("diagram.warning.keptAsCode", { type: type ?? "?", first: firstLine(source), reason }),
    count: 1
  };
}

function reasonOf(error: unknown): string {
  if (error instanceof PeleError) {
    return error.code === "unsupported-diagram"
      ? t("diagram.reason.unsupported")
      : t("diagram.reason.syntax", { line: error.line || 1 });
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Draws every Mermaid block of a note for one export target. A block that cannot be
 * drawn stays a code block and is named in a warning; nothing is dropped.
 */
export async function renderMermaidDiagrams(
  markdown: string,
  target: DiagramTarget,
  environment: DiagramEnvironment
): Promise<DiagramStageResult> {
  const blocks = findMermaidBlocks(markdown);
  if (!blocks.length) return { markdown, warnings: [], rendered: 0, kept: 0 };
  const lines = markdown.split("\n");
  const warnings: AdapterWarning[] = [];
  let rendered = 0;
  let kept = 0;
  const unmatchedRoles: string[] = [];
  const output: string[] = [];
  let cursor = 0;
  for (const [ordinal, block] of blocks.entries()) {
    output.push(...lines.slice(cursor, block.start));
    cursor = block.end + 1;
    let type: string | null = null;
    try {
      type = detectType(block.source);
      const diagram = renderDiagram(block.source, environment, `hmd${ordinal + 1}-`, unmatchedRoles);
      const blank = block.prefix.trimEnd();
      if (target === "markup") {
        output.push(blank, `${block.prefix}${encodeDiagramToken(diagram)}`, blank);
      } else {
        if (!environment.rasterize) throw new Error(t("diagram.error.noRaster"));
        const png = withPngDisplayScale(
          await environment.rasterize(diagram.svg, diagram.width, diagram.height, DIAGRAM_RASTER_SCALE),
          DIAGRAM_RASTER_SCALE,
          Boolean(diagram.caption)
        );
        const alt = cleanLabel(diagram.alt ?? diagram.caption ?? t("diagram.defaultAlt"));
        const image = `![${alt}](data:image/png;base64,${base64(png)})`;
        // The picture and its caption are plain paragraphs; the PNG's mark tells each writer
        // to centre them. The HWPX engine places a picture only as a paragraph of its own
        // outside quotes, so a diagram inside a quote or callout is set right after the
        // lines before it.
        const prefix = target === "hwpx" && block.prefix.includes(">") ? "" : block.prefix;
        const gap = prefix.trimEnd();
        output.push(gap, `${prefix}${image}`);
        if (diagram.caption) output.push(gap, `${prefix}${escapeMarkdown(cleanLabel(diagram.caption))}`);
        output.push(gap);
      }
      rendered += 1;
    } catch (error: unknown) {
      output.push(...lines.slice(block.start, block.end + 1));
      warnings.push(fallbackWarning(type, block.source, reasonOf(error)));
      kept += 1;
    }
  }
  output.push(...lines.slice(cursor));
  if (unmatchedRoles.length) {
    warnings.push({
      code: "diagram-role",
      message: t("diagram.warning.roleUnmatched", { ids: [...new Set(unmatchedRoles)].join(", ") }),
      count: unmatchedRoles.length
    });
  }
  if (rendered && environment.fontNotice) {
    warnings.push({ code: "diagram-font", message: environment.fontNotice, count: 1 });
  }
  return { markdown: output.join("\n"), warnings, rendered, kept };
}
