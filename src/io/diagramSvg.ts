/**
 * Colours and safety of diagram SVG written into exports (R-033).
 *
 * Pele draws with CSS variables (`var(--pele-fg, #1f1f1f)`) so a host page can theme
 * a diagram. An exported document has no host page: every variable is replaced by a
 * literal value here, so the file looks the same wherever it is opened.
 */
export interface DiagramPalette {
  bg: string;
  fg: string;
  muted: string;
  line: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  accent: string;
  /** Series colours (`--pele-series-N`), first to last; missing ones keep Pele's own. */
  series?: readonly string[];
}

/** Light paper palette used when the note's own colours would put a dark slab on paper. */
export const BUILTIN_DIAGRAM_PALETTE: Readonly<DiagramPalette> = Object.freeze({
  bg: "#FFFFFF",
  fg: "#182433",
  muted: "#5B6675",
  line: "#182433",
  surface: "#F3F5F7",
  surfaceAlt: "#E6EAEE",
  border: "#8A94A1",
  accent: "#31537D"
});

const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance (0 black to 1 white) of a `#RRGGBB` colour; null when it is not one. */
export function hexLuminance(color: string): number | null {
  if (!HEX_COLOR.test(color)) return null;
  const value = Number.parseInt(color.slice(1), 16);
  return 0.2126 * channel(value >> 16) + 0.7152 * channel((value >> 8) & 0xff) + 0.0722 * channel(value & 0xff);
}

/** True when a background is too dark to sit on white paper. */
export function isDarkBackground(color: string): boolean {
  const luminance = hexLuminance(color);
  return luminance !== null && luminance < 0.4;
}

/** Keeps a palette only when every colour is a literal `#RRGGBB`; else null. */
export function normalizeDiagramPalette(value: Partial<DiagramPalette> | null | undefined): DiagramPalette | null {
  if (!value) return null;
  const keys = ["bg", "fg", "muted", "line", "surface", "surfaceAlt", "border", "accent"] as const;
  const out: Partial<Record<(typeof keys)[number], string>> = {};
  for (const key of keys) {
    const color = value[key];
    if (typeof color !== "string" || !HEX_COLOR.test(color)) return null;
    out[key] = color.toUpperCase();
  }
  const series = (value.series ?? []).filter((color) => HEX_COLOR.test(color)).map((color) => color.toUpperCase());
  return { ...(out as Record<(typeof keys)[number], string>), ...(series.length ? { series } : {}) };
}

/**
 * The palette a diagram is exported with: the note's own colours unless their
 * background is dark (or missing), in which case `paper` applies.
 */
export function exportDiagramPalette(
  resolved: Partial<DiagramPalette> | null | undefined,
  paper: DiagramPalette = BUILTIN_DIAGRAM_PALETTE
): { palette: DiagramPalette; source: "note" | "paper" } {
  const own = normalizeDiagramPalette(resolved);
  if (!own || isDarkBackground(own.bg)) return { palette: paper, source: "paper" };
  return { palette: own, source: "note" };
}

const PALETTE_VARIABLES: Readonly<Record<string, keyof Omit<DiagramPalette, "series">>> = {
  "--pele-bg": "bg",
  "--pele-fg": "fg",
  "--pele-muted": "muted",
  "--pele-line": "line",
  "--pele-surface": "surface",
  "--pele-surface-alt": "surfaceAlt",
  "--pele-border": "border",
  "--pele-accent": "accent"
};

/** `var(--name)` or `var(--name, fallback)`; the fallback may hold one level of brackets. */
const VAR_CALL = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/gu;

function substitute(text: string, lookup: (name: string, fallback: string | undefined) => string | undefined): string {
  let current = text;
  for (let pass = 0; pass < 6 && current.includes("var("); pass += 1) {
    const next = current.replace(VAR_CALL, (whole, name: string, fallback: string | undefined) => {
      const value = lookup(name, fallback?.trim());
      return value === undefined ? whole : value;
    });
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Replaces every CSS variable in a Pele SVG by a literal value: palette colours,
 * the font family, and Pele's own defaults for everything else. The result holds
 * no `var(` and draws the same without any stylesheet.
 */
export function literalizeDiagramSvg(svg: string, palette: DiagramPalette, fontFamily: string): string {
  const family = fontFamily.replace(/"/gu, "'");
  const external = (name: string, fallback: string | undefined): string | undefined => {
    if (name === "--pele-font") return family;
    const key = PALETTE_VARIABLES[name];
    if (key) return palette[key];
    const series = /^--pele-series-(\d+)$/u.exec(name);
    if (series) return palette.series?.[Number(series[1]) - 1] ?? fallback;
    return name.startsWith("--pele-") ? fallback : undefined;
  };
  const open = /^<svg\b[^>]*>/u.exec(svg)?.[0];
  if (!open) return svg;
  const style = /\sstyle="([^"]*)"/u.exec(open)?.[1] ?? "";
  const internal = new Map<string, string>();
  const kept: string[] = [];
  for (const declaration of style.split(";")) {
    const at = declaration.indexOf(":");
    if (at < 0) continue;
    const name = declaration.slice(0, at).trim();
    const value = substitute(declaration.slice(at + 1).trim(), (variable, fallback) => external(variable, fallback) ?? internal.get(variable));
    if (name.startsWith("--")) internal.set(name, value);
    else kept.push(`${name}:${value}`);
  }
  const lookup = (name: string, fallback: string | undefined): string | undefined =>
    internal.get(name) ?? external(name, fallback) ?? fallback;
  const rootOpen = open.replace(/\sstyle="[^"]*"/u, ` style="${kept.join(";")}"`);
  let body = substitute(rootOpen, lookup) + substitute(svg.slice(open.length), lookup);
  // `rx` as a CSS property is ignored by renderers that read only attributes.
  body = body.replace(/\sstyle="rx:\s*([\d.]+)(?:px)?"/gu, ' rx="$1"');
  return body;
}

export type DiagramRole = "key" | "interpretation" | "aux";

export interface DiagramRoleResult {
  svg: string;
  /** Node groups that got a treatment. */
  applied: number;
  /** Ids named by an annotation that are not exactly one node of the diagram. */
  unmatched: string[];
}

const ROLE_ORDER: readonly DiagramRole[] = ["key", "interpretation", "aux"];
const ROLE_SHAPES: Readonly<Record<DiagramRole, ReadonlySet<string>>> = {
  key: new Set(["rect", "path", "polygon"]),
  interpretation: new Set(["rect", "polygon"]),
  aux: new Set(["rect", "polygon"])
};

function unescapeAttribute(value: string): string {
  return value.replace(/&quot;/gu, '"').replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&");
}

function setAttribute(tag: string, name: string, value: string): string {
  const present = new RegExp(`\\s${name}="[^"]*"`, "u");
  if (present.test(tag)) return tag.replace(present, ` ${name}="${value}"`);
  return tag.replace(/\s*\/?>$/u, (end) => ` ${name}="${value}"${end.trim()}`);
}

/** End of the element whose open tag ends at `from` (index just past its close tag); -1 when unbalanced. */
function elementEnd(svg: string, from: number): number {
  let depth = 1;
  const tags = /<(\/?)g\b[^>]*?(\/?)>/gu;
  tags.lastIndex = from;
  for (let match = tags.exec(svg); match; match = tags.exec(svg)) {
    if (match[1]) depth -= 1;
    else if (!match[2]) depth += 1;
    if (depth === 0) return match.index + match[0].length;
  }
  return -1;
}

/** Rewrites the shapes that are direct children of one node group. */
function treatShapes(inner: string, treatments: readonly DiagramRole[], palette: DiagramPalette): string {
  let depth = 0;
  return inner.replace(/<(\/?)([A-Za-z][\w:-]*)\b[^>]*?(\/?)>/gu, (tag: string, closing: string, name: string, selfClosing: string) => {
    if (closing) {
      depth -= 1;
      return tag;
    }
    const direct = depth === 0;
    if (!selfClosing) depth += 1;
    if (!direct) return tag;
    let next = tag;
    for (const role of treatments) {
      if (!ROLE_SHAPES[role].has(name)) continue;
      if (role === "key") next = setAttribute(setAttribute(next, "stroke", palette.accent), "stroke-width", "3");
      else if (role === "interpretation") next = setAttribute(next, "stroke-dasharray", "5 3");
      else next = setAttribute(next, "fill", palette.surfaceAlt);
    }
    return next;
  });
}

/**
 * Applies the note's `%% @key`, `@interp` and `@aux` annotations to a literal Pele
 * SVG (R-037), the way the achmage-pele skill draws them: a key node gets an accent
 * outline three units wide, an interpretation node a dashed outline, an auxiliary
 * node the alternate surface. Only node groups (`pele-node` with a `data-id`) can be
 * named; a diagram type without them is returned untouched and silently. An id that
 * is not exactly one node is listed in `unmatched` and nothing is guessed.
 */
export function applyDiagramRoles(
  svg: string,
  roles: Readonly<Record<DiagramRole, readonly string[]>>,
  palette: DiagramPalette
): DiagramRoleResult {
  const nodes: Array<{ id: string; start: number; openEnd: number }> = [];
  for (const match of svg.matchAll(/<g\b[^>]*>/gu)) {
    const tag = match[0];
    if (tag.endsWith("/>")) continue;
    const classes = /\sclass="([^"]*)"/u.exec(tag)?.[1] ?? "";
    const id = /\sdata-id="([^"]*)"/u.exec(tag)?.[1];
    if (id === undefined || !/(?:^|\s)pele-node(?:\s|$)/u.test(classes)) continue;
    nodes.push({ id: unescapeAttribute(id), start: match.index, openEnd: match.index + tag.length });
  }
  if (!nodes.length) return { svg, applied: 0, unmatched: [] };
  const plan = new Map<number, DiagramRole[]>();
  const unmatched: string[] = [];
  for (const role of ROLE_ORDER) {
    for (const id of new Set(roles[role])) {
      const found = nodes.filter((node) => node.id === id);
      if (found.length !== 1) {
        if (!unmatched.includes(id)) unmatched.push(id);
        continue;
      }
      plan.set(found[0].start, [...(plan.get(found[0].start) ?? []), role]);
    }
  }
  let out = svg;
  let applied = 0;
  for (const node of [...nodes].sort((a, b) => b.start - a.start)) {
    const treatments = plan.get(node.start);
    if (!treatments) continue;
    const end = elementEnd(out, node.openEnd);
    if (end < 0) {
      if (!unmatched.includes(node.id)) unmatched.push(node.id);
      continue;
    }
    const close = out.lastIndexOf("</g>", end);
    const open = out
      .slice(node.start, node.openEnd)
      .replace(/\sclass="/u, ` class="${treatments.map((role) => `hanmark-diagram-${role}`).join(" ")} `);
    out = out.slice(0, node.start) + open + treatShapes(out.slice(node.openEnd, close), treatments, palette) + out.slice(close);
    applied += 1;
  }
  return { svg: out, applied, unmatched };
}

const SAFE_ELEMENTS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan",
  "title", "desc", "defs", "marker", "clipPath", "linearGradient", "radialGradient", "stop", "pattern", "mask"
]);

/**
 * True when an SVG string holds only drawing elements: no script, style sheet,
 * foreign content, embedded image, link, external reference or event handler.
 * Diagram SVG is written into HTML as markup, so anything else is refused.
 */
export function isSafeDiagramSvg(svg: string): boolean {
  if (!/^<svg\b[^>]*\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/u.test(svg) || !svg.endsWith("</svg>")) return false;
  if (/<!|<\?|\]\]>/u.test(svg)) return false;
  if (/\son[a-z]+\s*=|javascript:|data:|(?:xlink:)?href\s*=|url\(\s*["']?(?!#)/iu.test(svg)) return false;
  for (const tag of svg.matchAll(/<\/?\s*([A-Za-z][\w:-]*)/gu)) {
    if (!SAFE_ELEMENTS.has(tag[1])) return false;
  }
  return true;
}
