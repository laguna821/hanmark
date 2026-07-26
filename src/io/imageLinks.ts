import { transformMarkdownImageTokens } from "./markdownImageTokens";

const FENCE = /^\s*(`{3,}|~{3,})/;

function decodeReference(value: string): string {
  let decoded = value.trim().replace(/^<|>$/g, "").replace(/\\/g, "/");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURI(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded
    .replace(/^\.\//, "")
    .replace(/[?#].*$/, "")
    .normalize("NFC");
}

function basename(value: string): string {
  return value.split("/").pop() ?? value;
}

function sameImportedImage(source: string, originalFilename: string): boolean {
  const normalizedSource = decodeReference(source);
  const normalizedOriginal = decodeReference(originalFilename);
  return normalizedSource === normalizedOriginal ||
    basename(normalizedSource) === basename(normalizedOriginal);
}

function rewriteLine(
  line: string,
  originalFilename: string,
  replacement: string
): { line: string; replacements: number } {
  let replacements = 0;
  let output = transformMarkdownImageTokens(line, (token) => {
    if (!sameImportedImage(token.source, originalFilename)) return token.raw;
    replacements += 1;
    return replacement;
  });
  output = output.replace(/<img\b[^>]*>/gi, (raw) => {
    const source = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1];
    if (!source || !sameImportedImage(source, originalFilename)) return raw;
    replacements += 1;
    return replacement;
  });
  return { line: output, replacements };
}

/** Pure reference rewrite kept separate from Obsidian so it is portable and unit-testable. */
export function rewriteImportedImageReference(
  markdown: string,
  originalFilename: string,
  obsidianEmbed: string
): { markdown: string; replacements: number } {
  const output: string[] = [];
  let replacements = 0;
  let fenceMarker = "";
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const fence = line.match(FENCE)?.[1] ?? "";
    if (fence) {
      if (!fenceMarker) fenceMarker = fence[0];
      else if (fence[0] === fenceMarker) fenceMarker = "";
      output.push(line);
      continue;
    }
    if (fenceMarker) {
      output.push(line);
      continue;
    }
    const rewritten = rewriteLine(line, originalFilename, obsidianEmbed);
    output.push(rewritten.line);
    replacements += rewritten.replacements;
  }
  return { markdown: output.join("\n"), replacements };
}
