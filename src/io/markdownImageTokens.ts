export interface MarkdownImageToken {
  readonly kind: "markdown";
  readonly raw: string;
  readonly alt: string;
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

function isWhitespace(character: string): boolean {
  return character === " " || character === "\t";
}

function unescapeDestination(value: string): string {
  return value.replace(/\\([\\()<> ])/g, "$1");
}

function unescapeAlt(value: string): string {
  return value.replace(/\\([\\\]])/g, "$1");
}

function findClosingBracket(value: string, start: number): number {
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "]") return index;
  }
  return -1;
}

function findOuterClosingParen(value: string, start: number): number {
  let quote = "";
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === ")") return index;
  }
  return -1;
}

/**
 * Parses a CommonMark-style inline image without recursive regular
 * expressions. Destinations in angle brackets and destinations containing
 * balanced parentheses are supported, including Obsidian's percent-encoded
 * attachment links.
 */
export function parseMarkdownImageTokenAt(
  value: string,
  start: number
): MarkdownImageToken | null {
  if (value[start] !== "!" || value[start + 1] !== "[") return null;
  const altEnd = findClosingBracket(value, start + 2);
  if (altEnd < 0 || value[altEnd + 1] !== "(") return null;

  let cursor = altEnd + 2;
  while (isWhitespace(value[cursor] ?? "")) cursor += 1;
  if (cursor >= value.length) return null;

  let source = "";
  let close = -1;
  if (value[cursor] === "<") {
    const sourceStart = cursor + 1;
    let escaped = false;
    let sourceEnd = -1;
    for (let index = sourceStart; index < value.length; index += 1) {
      const character = value[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === ">") {
        sourceEnd = index;
        cursor = index + 1;
        break;
      }
    }
    if (sourceEnd < 0) return null;
    source = value.slice(sourceStart, sourceEnd);
    while (isWhitespace(value[cursor] ?? "")) cursor += 1;
    close = value[cursor] === ")"
      ? cursor
      : findOuterClosingParen(value, cursor);
  } else {
    const sourceStart = cursor;
    let depth = 0;
    let escaped = false;
    let sourceEnd = -1;
    for (; cursor < value.length; cursor += 1) {
      const character = value[cursor];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === "(") {
        depth += 1;
        continue;
      }
      if (character === ")") {
        if (depth === 0) {
          sourceEnd = cursor;
          close = cursor;
          break;
        }
        depth -= 1;
        continue;
      }
      if (isWhitespace(character) && depth === 0) {
        sourceEnd = cursor;
        close = findOuterClosingParen(value, cursor);
        break;
      }
    }
    if (sourceEnd < 0) return null;
    source = value.slice(sourceStart, sourceEnd);
  }

  if (close < 0 || !source) return null;
  const end = close + 1;
  return {
    kind: "markdown",
    raw: value.slice(start, end),
    alt: unescapeAlt(value.slice(start + 2, altEnd)),
    source: unescapeDestination(source),
    start,
    end
  };
}

export function markdownImageTokens(value: string): MarkdownImageToken[] {
  const tokens: MarkdownImageToken[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "!" || value[index + 1] !== "[") continue;
    const token = parseMarkdownImageTokenAt(value, index);
    if (!token) continue;
    tokens.push(token);
    index = token.end - 1;
  }
  return tokens;
}

export function transformMarkdownImageTokens(
  value: string,
  transform: (token: MarkdownImageToken) => string
): string {
  const tokens = markdownImageTokens(value);
  if (!tokens.length) return value;
  const output: string[] = [];
  let cursor = 0;
  for (const token of tokens) {
    output.push(value.slice(cursor, token.start), transform(token));
    cursor = token.end;
  }
  output.push(value.slice(cursor));
  return output.join("");
}
