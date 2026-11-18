import {
  normalizeDocumentStyleProfile,
  type DocumentStyleProfile,
  type DocumentStyleRole
} from "./documentStyle";

export interface FontSubstitution {
  requested: string;
  replacement: string;
  roles: DocumentStyleRole[];
}

export interface FontResolverOptions {
  platform?: NodeJS.Platform;
  available?: (family: string) => boolean | Promise<boolean>;
  /**
   * Explicit replacements saved with a template (requested -> replacement). They are
   * applied identically on every machine, so the HWPX stays deterministic.
   */
  rules?: Readonly<Record<string, string>>;
}

/** A font the document asks for that this machine does not have. */
export interface MissingFont {
  family: string;
  roles: DocumentStyleRole[];
  /** What previews fall back to on this machine. Never written into the HWPX. */
  previewFallback: string;
}

// i18n-data-begin: font family alias table
const ALIASES: Record<string, string[]> = {
  "신명조": ["신명조", "HY신명조", "HYSinMyeongJo", "HYSinMyeongJo-Medium"],
  "한양신명조": ["한양신명조", "신명조", "HY신명조", "HYSinMyeongJo", "HYSinMyeongJo-Medium"],
  "HY신명조": ["HY신명조", "신명조", "HYSinMyeongJo", "HYSinMyeongJo-Medium"],
  "HY견고딕": ["HY견고딕", "HYGothic-Extra"],
  "맑은 고딕": ["맑은 고딕", "Malgun Gothic"],
  "휴먼명조": ["휴먼명조", "Human Myeongjo", "HumanMyungjo"]
};
// i18n-data-end
const DOCUMENT_STYLE_ROLES: DocumentStyleRole[] = [
  "body",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "quote",
  "code",
  "list"
];

function quotedLocal(family: string): string {
  return `local("${family.replace(/["\\]/g, "\\$&")}")`;
}

async function browserFontAvailable(family: string): Promise<boolean> {
  if (typeof FontFace !== "function") return true;
  try {
    const face = new FontFace("__hanmark_font_probe__", quotedLocal(family));
    await face.load();
    return face.status === "loaded";
  } catch {
    return false;
  }
}

function isSerif(family: string): boolean {
  return /(명조|바탕|myeong|myung|serif|times)/i.test(family);
}

function fallbackFont(family: string, platform: NodeJS.Platform): string {
  const serif = isSerif(family);
  if (platform === "darwin") return serif ? "AppleMyungjo" : "Apple SD Gothic Neo";
  if (platform === "win32") return serif ? "바탕" : "맑은 고딕"; // i18n-data: font family names
  return serif ? "Noto Serif CJK KR" : "Noto Sans CJK KR";
}

/**
 * Decide which fonts the HWPX names. By default the template's font names are kept
 * exactly, so the same note produces the same file on every machine; fonts missing
 * here are only reported (with the preview fallback). Explicit template rules are the
 * only way a font name is replaced (R-018, user decision 2026-09-28).
 */
export async function resolveDocumentStyleFonts(
  input: DocumentStyleProfile,
  options: FontResolverOptions = {}
): Promise<{ profile: DocumentStyleProfile; substitutions: FontSubstitution[]; missing: MissingFont[] }> {
  const profile = normalizeDocumentStyleProfile(input);
  // Runtime callers pass Obsidian's Platform-derived value. The neutral default
  // keeps the pure conversion library executable in Node-based unit tests.
  const platform = options.platform ?? "linux";
  const available = options.available ?? browserFontAvailable;
  const rules = options.rules ?? {};
  const cache = new Map<string, Promise<boolean>>();
  const canUse = (family: string): Promise<boolean> => {
    const key = family.trim().toLocaleLowerCase();
    let pending = cache.get(key);
    if (pending === undefined) {
      pending = Promise.resolve(available(family)).catch(() => false);
      cache.set(key, pending);
    }
    return pending;
  };

  const substitutions = new Map<string, FontSubstitution>();
  const missing = new Map<string, MissingFont>();
  for (const role of DOCUMENT_STYLE_ROLES) {
    const style = profile.roles[role];
    const character = style?.character;
    if (!character) continue;
    for (const field of ["fontFamily", "latinFontFamily"] as const) {
      const requested = character[field];
      if (!requested) continue;
      const replacement = Object.prototype.hasOwnProperty.call(rules, requested)
        ? rules[requested]?.trim()
        : undefined;
      if (replacement && replacement !== requested) {
        character[field] = replacement;
        const key = `${requested}\u0000${replacement}`;
        const item = substitutions.get(key) ?? { requested, replacement, roles: [] };
        if (!item.roles.includes(role)) item.roles.push(role);
        substitutions.set(key, item);
      }
      const family = character[field] ?? requested;
      const candidates = ALIASES[family] ?? [family];
      let satisfied = false;
      for (const candidate of candidates) {
        if (await canUse(candidate)) {
          satisfied = true;
          break;
        }
      }
      if (satisfied) continue;
      const item = missing.get(family) ?? { family, roles: [], previewFallback: fallbackFont(family, platform) };
      if (!item.roles.includes(role)) item.roles.push(role);
      missing.set(family, item);
    }
  }
  return { profile, substitutions: [...substitutions.values()], missing: [...missing.values()] };
}

/** Fonts of a list that this machine does not have (with what previews fall back to). */
export async function missingFontFamilies(families: readonly string[], options: FontResolverOptions = {}): Promise<MissingFont[]> {
  const platform = options.platform ?? "linux";
  const available = options.available ?? browserFontAvailable;
  const missing: MissingFont[] = [];
  const seen = new Set<string>();
  for (const raw of families) {
    const family = raw.trim();
    if (!family || seen.has(family)) continue;
    seen.add(family);
    let satisfied = false;
    for (const candidate of ALIASES[family] ?? [family]) {
      if (await Promise.resolve(available(candidate)).catch(() => false)) {
        satisfied = true;
        break;
      }
    }
    if (!satisfied) missing.push({ family, roles: [], previewFallback: fallbackFont(family, platform) });
  }
  return missing;
}

export function fontSubstitutionSummary(substitutions: FontSubstitution[]): string[] {
  return substitutions.map((item) => `${item.requested} → ${item.replacement}`);
}
