import { forgetTextWidths } from "pele";
import type { DiagramEnvironment, DiagramTarget } from "../io/diagramStage";
import type { ExportDiagramOptions } from "../io/exportPreparation";
import { BUILTIN_DIAGRAM_PALETTE, exportDiagramPalette, type DiagramPalette } from "../io/diagramSvg";
import { t } from "../i18n";
import { assertEngineCapability } from "../io/engineCapability";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

function createElement<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K): HTMLElementTagNameMap[K] {
  return doc.createElementNS(HTML_NAMESPACE, tag) as HTMLElementTagNameMap[K];
}

/**
 * What the Obsidian window contributes to drawing diagrams (R-033): the colours and
 * font the note's diagrams are shown with, real text measuring, and the rasteriser
 * for pictures. Everything is resolved to literal values; nothing here reaches the
 * network or the file system.
 */
export interface BrowserDiagramOptions {
  /** Always draw with the paper palette instead of the note's colours. */
  usePaperPalette?: boolean;
  /** Paper palette (the active PDF theme for Editorial PDF); the built-in one otherwise. */
  paper?: DiagramPalette;
  maxWidth?: number;
}

const BUNDLED_FAMILY = "HanMark Pretendard";
const PROBE_TEXT = "\uD55C\uAE00\uAC00\uB098\uB2E4 Abc 123"; // i18n-data: glyphs used to probe fonts
const SYSTEM_FALLBACK = "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans CJK KR', sans-serif";
const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif",
  "ui-monospace", "ui-rounded", "emoji", "math", "fangsong", "-apple-system", "blinkmacsystemfont",
  "apple color emoji", "segoe ui emoji", "segoe ui symbol", "noto color emoji", "??"
]);
const PALETTE_VARIABLES: ReadonlyArray<[keyof Omit<DiagramPalette, "series">, string]> = [
  ["bg", "--pele-bg"],
  ["fg", "--pele-fg"],
  ["muted", "--pele-muted"],
  ["line", "--pele-line"],
  ["surface", "--pele-surface"],
  ["surfaceAlt", "--pele-surface-alt"],
  ["border", "--pele-border"],
  ["accent", "--pele-accent"]
];

function unquote(family: string): string {
  return family.trim().replace(/^["']|["']$/gu, "").trim();
}

/** Splits a CSS font-family list into names (quotes removed). */
export function parseFontFamilies(value: string): string[] {
  const names: string[] = [];
  let current = "";
  let quote = "";
  for (const char of value) {
    if (quote) {
      if (char === quote) quote = "";
      current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ",") {
      if (current.trim()) names.push(unquote(current));
      current = "";
    } else current += char;
  }
  if (current.trim()) names.push(unquote(current));
  return names.filter(Boolean);
}

function hexByte(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0").toUpperCase();
}

/** `#RRGGBB` of a computed CSS colour, blended over `backdrop` when it is translucent. */
export function computedColorToHex(color: string, backdrop = "#FFFFFF"): string | null {
  let channels: number[] | null = null;
  let alpha = 1;
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/u.exec(color.trim());
  const srgb = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/u.exec(color.trim());
  if (rgb) channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  else if (srgb) channels = [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
  if (!channels) return null;
  const rawAlpha = (rgb ?? srgb)?.[4];
  if (rawAlpha) alpha = rawAlpha.endsWith("%") ? Number(rawAlpha.slice(0, -1)) / 100 : Number(rawAlpha);
  if (alpha <= 0) return null;
  if (alpha < 1) {
    const base = Number.parseInt(backdrop.slice(1), 16);
    const under = [base >> 16, (base >> 8) & 0xff, base & 0xff];
    channels = channels.map((value, index) => value * alpha + under[index] * (1 - alpha));
  }
  return `#${channels.map(hexByte).join("")}`;
}

interface ResolvedLook {
  palette: Partial<DiagramPalette>;
  families: string[];
}

/** Reads the diagram colours and font Obsidian shows, as literal values. */
function resolveLook(doc: Document): ResolvedLook {
  const view = doc.defaultView;
  if (!view || !doc.body) return { palette: {}, families: [] };
  const probe = createElement(doc, "div");
  probe.className = "mermaid";
  const hidden = "position:absolute;visibility:hidden;pointer-events:none;";
  probe.setAttribute("style", hidden);
  doc.body.appendChild(probe);
  try {
    const style = view.getComputedStyle(probe);
    const colorOf = (name: string, backdrop?: string): string | undefined => {
      if (!style.getPropertyValue(name).trim()) return undefined;
      probe.setAttribute("style", `${hidden}color:var(${name});`);
      const hex = computedColorToHex(view.getComputedStyle(probe).color, backdrop);
      probe.setAttribute("style", hidden);
      return hex ?? undefined;
    };
    const palette: Partial<DiagramPalette> = {};
    const bg = colorOf("--pele-bg");
    for (const [key, name] of PALETTE_VARIABLES) {
      const value = key === "bg" ? bg : colorOf(name, bg);
      if (value) palette[key] = value;
    }
    const series: string[] = [];
    for (let index = 1; index <= 12; index += 1) {
      const value = colorOf(`--pele-series-${index}`, bg);
      if (!value) break;
      series.push(value);
    }
    if (series.length) palette.series = series;
    const families = parseFontFamilies(style.getPropertyValue("--pele-font") || style.fontFamily || "");
    return { palette, families };
  } finally {
    probe.remove();
  }
}

/** True when a family is installed on this computer (not a web font of the page). */
function isInstalledFamily(doc: Document, family: string): boolean {
  const canvas = createElement(doc, "canvas");
  const context = canvas.getContext("2d");
  if (!context) return false;
  const width = (font: string): number => {
    context.font = `72px ${font}`;
    return context.measureText(PROBE_TEXT).width;
  };
  const quoted = `"${family.replace(/"/gu, "")}"`;
  const overMono = width(`${quoted}, monospace`);
  const overSerif = width(`${quoted}, serif`);
  return overMono === overSerif && (overMono !== width("monospace") || overSerif !== width("serif"));
}

function isPageWebFont(doc: Document, family: string): boolean {
  let found = false;
  doc.fonts.forEach((face) => {
    if (unquote(face.family).toLowerCase() === family.toLowerCase()) found = true;
  });
  return found;
}

/** `@font-face` rules of HanMark's bundled Pretendard, when they carry their data inline. */
function bundledFontCss(doc: Document): string {
  const rules: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(list)) {
      const text = rule.cssText;
      if (text.startsWith("@font-face") && text.includes(BUNDLED_FAMILY) && text.includes("data:")) rules.push(text);
    }
  }
  return rules.join("");
}

interface FontChoice {
  family: string;
  /** `@font-face` CSS a rasterised SVG needs, since an SVG picture cannot see page fonts. */
  embedCss: string;
  notice?: string;
}

async function chooseFont(doc: Document, families: readonly string[]): Promise<FontChoice> {
  const wanted = families.filter((family) => !GENERIC_FAMILIES.has(family.toLowerCase()));
  const usable = wanted.find((family) => !isPageWebFont(doc, family) && isInstalledFamily(doc, family));
  if (usable) return { family: `'${usable.replace(/'/gu, "")}', ${SYSTEM_FALLBACK}`, embedCss: "" };
  const embedCss = bundledFontCss(doc);
  if (embedCss) {
    try {
      await Promise.all([doc.fonts.load(`400 14px "${BUNDLED_FAMILY}"`, PROBE_TEXT), doc.fonts.load(`600 14px "${BUNDLED_FAMILY}"`, PROBE_TEXT)]);
    } catch {
      /* measured with whatever the page has */
    }
    return {
      family: `'${BUNDLED_FAMILY}', ${SYSTEM_FALLBACK}`,
      embedCss,
      ...(wanted.length ? { notice: t("diagram.warning.fontFallback", { wanted: wanted[0], used: "Pretendard" }) } : {})
    };
  }
  return {
    family: SYSTEM_FALLBACK,
    embedCss: "",
    ...(wanted.length ? { notice: t("diagram.warning.fontFallback", { wanted: wanted[0], used: "sans-serif" }) } : {})
  };
}

function rasterizer(doc: Document, background: string, embedCss: string): DiagramEnvironment["rasterize"] {
  return async (svg, width, height, scale) => {
    assertEngineCapability("diagrams");
    const source = embedCss ? svg.replace(/^<svg\b[^>]*>/u, (open) => `${open}<style>${embedCss}</style>`) : svg;
    const image = createElement(doc, "img");
    image.decoding = "sync";
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    await image.decode();
    const canvas = createElement(doc, "canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(t("diagram.error.noRaster"));
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error(t("diagram.error.noRaster"));
    return new Uint8Array(await blob.arrayBuffer());
  };
}

/** Builds the drawing environment of one export from the given window. */
export async function createBrowserDiagramEnvironment(
  doc: Document,
  options: BrowserDiagramOptions = {}
): Promise<DiagramEnvironment> {
  const look = resolveLook(doc);
  const paper = options.paper ?? BUILTIN_DIAGRAM_PALETTE;
  const palette = options.usePaperPalette ? paper : exportDiagramPalette(look.palette, paper).palette;
  const font = await chooseFont(doc, look.families);
  forgetTextWidths();
  return {
    palette,
    fontFamily: font.family,
    rasterize: rasterizer(doc, palette.bg, font.embedCss),
    ...(options.maxWidth ? { maxWidth: options.maxWidth } : {}),
    ...(font.notice ? { fontNotice: font.notice } : {})
  };
}

/**
 * Diagram options of one export, read from stored settings: undefined when the
 * user switched "Mermaid 도식을 그림으로" off (blocks then stay code as before).
 */
export function exportDiagramOptions(
  settings: Record<string, unknown>,
  target: DiagramTarget,
  paper?: DiagramPalette
): ExportDiagramOptions | undefined {
  if (settings.mermaidDiagrams === false) return undefined;
  // The window the user works in (a pop-out window has its own document).
  const doc = typeof activeDocument !== "undefined" ? activeDocument : typeof document !== "undefined" ? document : undefined;
  if (!doc) return undefined;
  return {
    target,
    environment: () =>
      createBrowserDiagramEnvironment(doc, { usePaperPalette: settings.mermaidPaperPalette === true, ...(paper ? { paper } : {}) })
  };
}
