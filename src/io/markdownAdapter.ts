import { markdownImageTokens } from "./markdownImageTokens";

export type AdapterWarningCode =
  | "image-missing"
  | "note-embed-flattened"
  | "callout-flattened"
  | "highlight-flattened"
  | "footnote-flattened"
  | "font-substituted"
  | "document-style-level-unused";

export interface AdapterWarning {
  code: AdapterWarningCode;
  message: string;
  count: number;
}

export interface MarkdownAdapterResult {
  markdown: string;
  warnings: AdapterWarning[];
  /** Number of unique Markdown/HTML image sources found outside fenced code. */
  imageCount: number;
}

const IMAGE_EXT = /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp|wmf|emf)$/i;
const FENCE = /^\s*(`{3,}|~{3,})/;

function labelForCallout(type: string): string {
  const labels: Record<string, string> = {
    note: "참고",
    info: "정보",
    tip: "팁",
    warning: "주의",
    caution: "주의",
    danger: "위험",
    error: "오류",
    example: "예시",
    quote: "인용",
    question: "질문",
    success: "완료",
    failure: "실패",
    bug: "버그",
    todo: "할 일"
  };
  return labels[type.toLowerCase()] ?? type;
}

function warning(
  map: Map<AdapterWarningCode, AdapterWarning>,
  code: AdapterWarningCode,
  message: string,
  increment = 1
): void {
  const current = map.get(code);
  if (current) current.count += increment;
  else map.set(code, { code, message, count: increment });
}

function isHardBlock(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^#{1,6}\s/.test(trimmed)) return true;
  if (/^(?:[-+*]|\d+[.)])\s+/.test(trimmed)) return true;
  if (/^>/.test(trimmed)) return true;
  if (/^(?:`{3,}|~{3,}|\$\$)/.test(trimmed)) return true;
  if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return true;
  if (/^</.test(trimmed) || /^!\[/.test(trimmed)) return true;
  if (/\|/.test(trimmed)) return true; // GFM/HTML table rows must keep their line boundaries.
  return /^ {4}/.test(line);
}

/**
 * Kordoc intentionally treats every non-empty source line as a paragraph. Obsidian users
 * commonly hard-wrap prose, so join only consecutive plain-text lines and leave every
 * structural Markdown line untouched.
 */
function joinSoftWrappedLines(lines: string[]): string[] {
  const out: string[] = [];
  let fenceMarker = "";
  for (const line of lines) {
    const fence = line.match(FENCE)?.[1] ?? "";
    if (fence) {
      if (!fenceMarker) fenceMarker = fence[0];
      else if (fence[0] === fenceMarker) fenceMarker = "";
      out.push(line);
      continue;
    }
    if (fenceMarker || !line.trim() || isHardBlock(line)) {
      out.push(line);
      continue;
    }

    const previous = out[out.length - 1];
    const canJoin =
      typeof previous === "string" &&
      previous.trim().length > 0 &&
      !isHardBlock(previous) &&
      !/ {2}$/.test(previous) &&
      !/\\$/.test(previous);
    if (canJoin) out[out.length - 1] = `${previous.trimEnd()} ${line.trimStart()}`;
    else out.push(line);
  }
  return out;
}

/** Convert Obsidian-specific Markdown into the conservative subset kordoc generates well. */
export function adaptMarkdownForKordoc(source: string): MarkdownAdapterResult {
  const warnings = new Map<AdapterWarningCode, AdapterWarning>();
  const imageRefs = new Set<string>();
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const converted: string[] = [];
  let fenceMarker = "";

  for (let line of lines) {
    const fence = line.match(FENCE)?.[1] ?? "";
    if (fence) {
      if (!fenceMarker) fenceMarker = fence[0];
      else if (fence[0] === fenceMarker) fenceMarker = "";
      converted.push(line);
      continue;
    }
    if (fenceMarker) {
      converted.push(line);
      continue;
    }

    // Obsidian embeds must be handled before ordinary wiki links.
    line = line.replace(/!\[\[([^\]]+)\]\]/g, (_all, inner: string) => {
      const [targetPart, aliasPart] = String(inner).split("|", 2);
      const target = targetPart.split("#", 1)[0].trim();
      const alias = (aliasPart || nodeLabel(target)).trim();
      if (IMAGE_EXT.test(target)) {
        imageRefs.add(target);
        const destination = /[\s()]/.test(target) ? `<${target}>` : target;
        return `![${alias}](${destination})`;
      }
      warning(
        warnings,
        "note-embed-flattened",
        "노트 임베드는 링크 텍스트로 펼쳐집니다. 포함된 노트 본문은 자동 삽입되지 않습니다."
      );
      return `[임베드: ${alias}]`;
    });

    line = line.replace(/\[\[([^\]]+)\]\]/g, (_all, inner: string) => {
      const [targetAndHeading, aliasPart] = String(inner).split("|", 2);
      const [target, heading] = targetAndHeading.split("#", 2);
      return (aliasPart || (heading ? `${nodeLabel(target)} — ${heading}` : nodeLabel(target))).trim();
    });

    const callout = line.match(/^(\s*>\s*)\[!([^\]]+)\][+-]?\s*(.*)$/i);
    if (callout) {
      const title = callout[3].trim() || labelForCallout(callout[2]);
      line = `${callout[1]}**${title}**`;
      warning(warnings, "callout-flattened", "Obsidian 콜아웃은 제목이 있는 인용문으로 변환됩니다.");
    }

    line = line.replace(/^(\s*[-+*]\s+)\[([ xX])\]\s+/, (_all, prefix: string, checked: string) => {
      return `${prefix}${checked.trim() ? "☑" : "☐"} `;
    });

    if (/==[^=\n]+==/.test(line)) {
      line = line.replace(/==([^=\n]+)==/g, "$1");
      warning(warnings, "highlight-flattened", "형광펜 표시는 일반 텍스트로 변환됩니다.");
    }
    if (/\[\^[^\]]+\]/.test(line) || /^\s*\[\^[^\]]+\]:/.test(line)) {
      warning(warnings, "footnote-flattened", "각주는 일반 텍스트로 남으며 각주 개체로 변환되지 않습니다.");
    }

    for (const token of markdownImageTokens(line)) {
      imageRefs.add(token.source);
    }
    for (const match of line.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
      imageRefs.add(match[1]);
    }
    converted.push(line);
  }

  return {
    markdown: joinSoftWrappedLines(converted).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n",
    warnings: [...warnings.values()],
    imageCount: imageRefs.size
  };
}

function nodeLabel(target: string): string {
  const normalized = target.replace(/\\/g, "/");
  const last = normalized.split("/").pop() || normalized;
  return last.replace(/\.[^.]+$/, "");
}
