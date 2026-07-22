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
}

const ALIASES: Record<string, string[]> = {
  "신명조": ["신명조", "HY신명조", "HYSinMyeongJo", "HYSinMyeongJo-Medium"],
  "한양신명조": ["한양신명조", "신명조", "HY신명조", "HYSinMyeongJo", "HYSinMyeongJo-Medium"],
  "HY신명조": ["HY신명조", "신명조", "HYSinMyeongJo", "HYSinMyeongJo-Medium"],
  "HY견고딕": ["HY견고딕", "HYGothic-Extra"],
  "맑은 고딕": ["맑은 고딕", "Malgun Gothic"],
  "휴먼명조": ["휴먼명조", "Human Myeongjo", "HumanMyungjo"]
};

function quotedLocal(family: string): string {
  return `local("${family.replace(/["\\]/g, "\\$&")}")`;
}

async function browserFontAvailable(family: string): Promise<boolean> {
  const host = typeof activeWindow !== "undefined" ? activeWindow : undefined;
  const FontFaceConstructor = (host as (Window & { FontFace?: typeof FontFace }) | undefined)?.FontFace;
  if (typeof FontFaceConstructor !== "function") return true;
  try {
    const face = new FontFaceConstructor("__hanmark_font_probe__", quotedLocal(family));
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
  if (platform === "win32") return serif ? "바탕" : "맑은 고딕";
  return serif ? "Noto Serif CJK KR" : "Noto Sans CJK KR";
}

export async function resolveDocumentStyleFonts(
  input: DocumentStyleProfile,
  options: FontResolverOptions = {}
): Promise<{ profile: DocumentStyleProfile; substitutions: FontSubstitution[] }> {
  const profile = normalizeDocumentStyleProfile(input);
  // Runtime callers pass Obsidian's Platform-derived value. The neutral default
  // keeps the pure conversion library executable in Node-based unit tests.
  const platform = options.platform ?? "linux";
  const available = options.available ?? browserFontAvailable;
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
  for (const [role, style] of Object.entries(profile.roles) as Array<[DocumentStyleRole, any]>) {
    for (const field of ["fontFamily", "latinFontFamily"] as const) {
      const requested = style?.character?.[field];
      if (!requested) continue;
      const candidates = ALIASES[requested] ?? [requested];
      let satisfied = false;
      for (const candidate of candidates) {
        if (await canUse(candidate)) {
          satisfied = true;
          break;
        }
      }
      if (satisfied) continue;
      const replacement = fallbackFont(requested, platform);
      style.character[field] = replacement;
      const key = `${requested}\u0000${replacement}`;
      const item = substitutions.get(key) ?? { requested, replacement, roles: [] };
      if (!item.roles.includes(role)) item.roles.push(role);
      substitutions.set(key, item);
    }
  }
  return { profile, substitutions: [...substitutions.values()] };
}

export function fontSubstitutionSummary(substitutions: FontSubstitution[]): string[] {
  return substitutions.map((item) => `${item.requested} → ${item.replacement}`);
}
