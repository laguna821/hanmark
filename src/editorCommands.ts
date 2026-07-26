import { type Editor, Notice, Plugin } from "obsidian";

type TextTransform = (value: string) => string;

function promptUser(message: string, defaultValue: string): string | null {
  const promptFunction = window["prompt"].bind(window);
  return promptFunction(message, defaultValue);
}

/**
 * The legacy text tools intentionally operate on the current selection, or on
 * only the current line when there is no selection.
 */
function transformSelectionOrCurrentLine(editor: Editor, transform: TextTransform): void {
  const selected = editor.getSelection();
  if (selected.length > 0) {
    editor.replaceSelection(transform(selected));
    return;
  }

  const cursor = editor.getCursor();
  editor.setLine(cursor.line, transform(editor.getLine(cursor.line)));
}

/**
 * Only the two document-wide legacy tools use the whole document when there is
 * no selection. The cursor is restored after setValue, matching 2.4.2.
 */
function transformSelectionOrDocument(editor: Editor, transform: TextTransform): void {
  const selected = editor.getSelection();
  if (selected.length > 0) {
    editor.replaceSelection(transform(selected));
    return;
  }

  const cursor = editor.getCursor();
  editor.setValue(transform(editor.getValue()));
  editor.setCursor(cursor);
}

function toggleWrapper(
  editor: Editor,
  open: string,
  close: string,
  placeholder: string
): void {
  const selected = editor.getSelection();
  if (selected.length > 0) {
    const trimmed = selected.trim();
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      editor.replaceSelection(trimmed.slice(open.length, trimmed.length - close.length));
      return;
    }
    editor.replaceSelection(`${open}${selected}${close}`);
    return;
  }

  const cursor = editor.getCursor();
  editor.replaceRange(`${open}${placeholder}${close}`, cursor);
  editor.setSelection(
    { line: cursor.line, ch: cursor.ch + open.length },
    { line: cursor.line, ch: cursor.ch + open.length + placeholder.length }
  );
}

function mapNonEmptyLines(value: string, transform: TextTransform): string {
  return value
    .split("\n")
    .map((line) => line.trim().length > 0 ? transform(line) : line)
    .join("\n");
}

function clearFormatting(value: string): string {
  return value
    .replace(/<p\s+align=["']?(left|center|right|justify)["']?>([\s\S]*?)<\/p>/gi, "$2")
    .replace(/<center>([\s\S]*?)<\/center>/gi, "$1")
    .replace(/<\/?(?:u|sup|sub)>/gi, "")
    .replace(/<font\s+color=["']?[^"'>]+["']?>([\s\S]*?)<\/font>/gi, "$1")
    .replace(/<mark\s+style=["']?background:[^"'>]+["']?>([\s\S]*?)<\/mark>/gi, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/==([^=]+)==/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_]+)_(?!_)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "");
}

function stripOuterAlignment(value: string): string {
  return value
    .replace(/^<p\s+align=["']?(left|center|right|justify)["']?>([\s\S]*)<\/p>$/i, "$2")
    .replace(/^<center>([\s\S]*)<\/center>$/i, "$1");
}

function setAlignment(
  editor: Editor,
  alignment: "left" | "center" | "right" | "justify"
): void {
  transformSelectionOrCurrentLine(editor, (value) =>
    mapNonEmptyLines(value, (line) => `<p align="${alignment}">${stripOuterAlignment(line)}</p>`)
  );
}

function cycleChecklist(editor: Editor): void {
  transformSelectionOrCurrentLine(editor, (value) =>
    value
      .split("\n")
      .map((line) => {
        if (/^\s*[-*+]\s+\[[xX ]\]\s+/.test(line)) {
          return line.replace(/^(\s*[-*+])\s+\[[xX ]\]\s+/, "$1 ");
        }
        if (/^\s*[-*+]\s+/.test(line)) {
          return line.replace(/^(\s*[-*+])\s+/, "$1 [ ] ");
        }
        if (/^\s*\d+\.\s+/.test(line)) {
          return line.replace(/^(\s*)\d+\.\s+/, "$1- [ ] ");
        }
        return line;
      })
      .join("\n")
  );
}

function listToTable(value: string): string {
  const rows = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter((line) => line.length > 0);

  if (rows.length === 0) return value;
  return [
    "| 항목 |",
    "| --- |",
    ...rows.map((line) => `| ${line.replace(/\|/g, "\\|")} |`)
  ].join("\n");
}

function tableToList(value: string): string {
  const tableLines = value
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => line.includes("|"));
  if (tableLines.length < 2) return value;

  const bodyLines = tableLines.slice(2);
  if (bodyLines.length === 0) return value;

  const items = bodyLines
    .map((line) => {
      const cells = line
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0);
      return cells.length === 0 ? "" : `- ${cells.join(" | ")}`;
    })
    .filter((line) => line.length > 0);
  return items.length > 0 ? items.join("\n") : value;
}

function toHalfwidth(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0)
    )
    .replace(/\u3000/g, " ");
}

function toFullwidth(value: string): string {
  return value
    .replace(/[!-~]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) + 0xfee0)
    )
    .replace(/ /g, "\u3000");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function insertCallout(editor: Editor, type: "note" | "warning"): void {
  const block = `> [!${type}] ${type === "warning" ? "주의" : "메모"}
> 내용을 입력하세요
`;
  editor.replaceRange(block, editor.getCursor());
}

export function applyFontColorValue(editor: Editor, color: string): void {
  transformSelectionOrCurrentLine(editor, (value) =>
    mapNonEmptyLines(
      value,
      (line) =>
        `<font color="${color}">${line.replace(
          /<font\s+color=["']?[^"'>]+["']?>([\s\S]*?)<\/font>/gi,
          "$1"
        )}</font>`
    )
  );
}

function applyFontColor(editor: Editor): void {
  const color = promptUser(
    "글자색을 입력하세요 (예: #1a73e8, red)",
    "#1a73e8"
  );
  if (color) applyFontColorValue(editor, color);
}

export function applyBackgroundColorValue(
  editor: Editor,
  color: string
): void {
  transformSelectionOrCurrentLine(editor, (value) =>
    mapNonEmptyLines(
      value,
      (line) =>
        `<mark style="background:${color}">${line.replace(
          /<mark\s+style=["']?background:[^"'>]+["']?>([\s\S]*?)<\/mark>/gi,
          "$1"
        )}</mark>`
    )
  );
}

function applyBackgroundColor(editor: Editor): void {
  const color = promptUser(
    "배경색을 입력하세요 (예: #fff59d, yellow)",
    "#fff59d"
  );
  if (color) applyBackgroundColorValue(editor, color);
}

function moveCurrentLine(editor: Editor, direction: -1 | 1): void {
  const cursor = editor.getCursor();
  const targetLine = cursor.line + direction;
  if (targetLine < 0 || targetLine >= editor.lineCount()) return;

  const current = editor.getLine(cursor.line);
  const target = editor.getLine(targetLine);
  editor.setLine(targetLine, current);
  editor.setLine(cursor.line, target);
  editor.setCursor({ line: targetLine, ch: cursor.ch });
}

function duplicateCurrentLine(editor: Editor): void {
  const cursor = editor.getCursor();
  const line = editor.getLine(cursor.line);
  editor.replaceRange(`\n${line}`, { line: cursor.line, ch: line.length });
  editor.setCursor({ line: cursor.line + 1, ch: cursor.ch });
}

function addEditorCommand(
  plugin: Plugin,
  id: string,
  name: string,
  run: (editor: Editor) => void
): void {
  plugin.addCommand({ id, name, editorCallback: run });
}

/** Re-registers every public 2.4.2 editor command without loading the legacy bundle. */
export function registerEditorCompatibilityCommands(plugin: Plugin): void {
  addEditorCommand(plugin, "clear-formatting", "서식 지우기", (editor) => {
    transformSelectionOrCurrentLine(editor, clearFormatting);
  });
  addEditorCommand(plugin, "toggle-underline", "밑줄", (editor) => {
    toggleWrapper(editor, "<u>", "</u>", "밑줄 텍스트");
  });
  addEditorCommand(plugin, "toggle-inline-math", "인라인 수식", (editor) => {
    toggleWrapper(editor, "$", "$", "x+y");
  });
  addEditorCommand(plugin, "superscript", "위 첨자", (editor) => {
    toggleWrapper(editor, "<sup>", "</sup>", "위첨자");
  });
  addEditorCommand(plugin, "subscript", "아래 첨자", (editor) => {
    toggleWrapper(editor, "<sub>", "</sub>", "아래첨자");
  });

  addEditorCommand(plugin, "insert-link", "링크 삽입", (editor) => {
    const selected = editor.getSelection();
    if (selected.length > 0) {
      editor.replaceSelection(`[${selected}](https://)`);
      return;
    }
    const cursor = editor.getCursor();
    editor.replaceRange("[링크 텍스트](https://)", cursor);
    editor.setSelection(
      { line: cursor.line, ch: cursor.ch + 1 },
      { line: cursor.line, ch: cursor.ch + 6 }
    );
  });
  addEditorCommand(plugin, "insert-wikilink", "위키링크 삽입", (editor) => {
    const selected = editor.getSelection();
    if (selected.length > 0) {
      editor.replaceSelection(`[[${selected}]]`);
      return;
    }
    editor.replaceRange("[[문서명]]", editor.getCursor());
  });
  addEditorCommand(plugin, "insert-embed", "임베드 삽입", (editor) => {
    const selected = editor.getSelection();
    if (selected.length > 0) {
      editor.replaceSelection(`![[${selected}]]`);
      return;
    }
    editor.replaceRange("![[첨부파일]]", editor.getCursor());
  });
  addEditorCommand(plugin, "insert-table", "표 삽입", (editor) => {
    const table = [
      "",
      "| 제목 1 | 제목 2 | 제목 3 |",
      "|--------|--------|--------|",
      "| 내용 1 | 내용 2 | 내용 3 |",
      "| 내용 4 | 내용 5 | 내용 6 |",
      ""
    ].join("\n");
    editor.replaceRange(table, editor.getCursor());
  });
  addEditorCommand(plugin, "insert-hr", "수평선 삽입", (editor) => {
    editor.replaceRange("\n---\n", editor.getCursor());
  });
  addEditorCommand(plugin, "insert-codeblock", "코드블록 삽입", (editor) => {
    const selected = editor.getSelection();
    if (selected.length > 0) {
      editor.replaceSelection(`\`\`\`\n${selected}\n\`\`\``);
      return;
    }
    const cursor = editor.getCursor();
    editor.replaceRange("```\n\n```", cursor);
    editor.setCursor({ line: cursor.line + 1, ch: 0 });
  });
  addEditorCommand(plugin, "insert-mathblock", "수식 블록 삽입", (editor) => {
    const selected = editor.getSelection();
    if (selected.length > 0) {
      editor.replaceSelection(`$$\n${selected}\n$$`);
      return;
    }
    const cursor = editor.getCursor();
    editor.replaceRange("$$\n\n$$", cursor);
    editor.setCursor({ line: cursor.line + 1, ch: 0 });
  });
  addEditorCommand(plugin, "toggle-blockquote", "인용문 토글", (editor) => {
    transformSelectionOrCurrentLine(editor, (value) =>
      value
        .split("\n")
        .map((line) =>
          line.startsWith("> ")
            ? line.slice(2)
            : line.trim().length > 0
              ? `> ${line}`
              : line
        )
        .join("\n")
    );
  });
  addEditorCommand(plugin, "insert-callout-note", "콜아웃 삽입 (노트)", (editor) => {
    insertCallout(editor, "note");
  });
  addEditorCommand(plugin, "insert-callout-warning", "콜아웃 삽입 (주의)", (editor) => {
    insertCallout(editor, "warning");
  });

  addEditorCommand(plugin, "align-left", "왼쪽 정렬", (editor) => setAlignment(editor, "left"));
  addEditorCommand(plugin, "align-center", "가운데 정렬", (editor) => setAlignment(editor, "center"));
  addEditorCommand(plugin, "align-right", "오른쪽 정렬", (editor) => setAlignment(editor, "right"));
  addEditorCommand(plugin, "align-justify", "양쪽 맞춤", (editor) => setAlignment(editor, "justify"));
  addEditorCommand(plugin, "change-font-color", "글자색 변경", applyFontColor);
  addEditorCommand(plugin, "change-background-color", "배경색 변경", applyBackgroundColor);
  addEditorCommand(plugin, "cycle-list-checklist", "목록/체크리스트 순환", cycleChecklist);

  addEditorCommand(plugin, "text-get-plain", "텍스트 도구: 순수 텍스트", (editor) => {
    transformSelectionOrDocument(editor, clearFormatting);
    new Notice("서식을 제거해 순수 텍스트로 변환했습니다.");
  });
  addEditorCommand(plugin, "text-smart-symbols", "텍스트 도구: 전각/반각 변환", (editor) => {
    transformSelectionOrDocument(
      editor,
      (value) => /[\uFF01-\uFF5E\u3000]/.test(value) ? toHalfwidth(value) : toFullwidth(value)
    );
  });
  addEditorCommand(plugin, "text-insert-blank-lines", "텍스트 도구: 빈 줄 삽입", (editor) => {
    transformSelectionOrCurrentLine(editor, (value) => value.split("\n").join("\n\n"));
  });
  addEditorCommand(plugin, "text-remove-blank-lines", "텍스트 도구: 빈 줄 제거", (editor) => {
    transformSelectionOrCurrentLine(editor, (value) =>
      value
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .join("\n")
    );
  });
  addEditorCommand(plugin, "text-split-lines", "텍스트 도구: 줄 분할", (editor) => {
    const separator = promptUser("분할 기준 문자를 입력하세요", ",");
    if (!separator) return;
    transformSelectionOrCurrentLine(editor, (value) =>
      value
        .split("\n")
        .flatMap((line) => line.split(separator))
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join("\n")
    );
  });
  addEditorCommand(plugin, "text-merge-lines", "텍스트 도구: 줄 합치기", (editor) => {
    transformSelectionOrCurrentLine(editor, (value) =>
      value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(" ")
    );
  });
  addEditorCommand(plugin, "text-dedupe-lines", "텍스트 도구: 중복 줄 제거", (editor) => {
    transformSelectionOrCurrentLine(editor, (value) => {
      const seen = new Set<string>();
      const unique: string[] = [];
      for (const line of value.split("\n")) {
        if (seen.has(line)) continue;
        seen.add(line);
        unique.push(line);
      }
      return unique.join("\n");
    });
  });
  addEditorCommand(plugin, "text-add-wrap", "텍스트 도구: 접두/접미 추가", (editor) => {
    const prefix = promptUser("접두어", "") ?? "";
    const suffix = promptUser("접미어", "") ?? "";
    transformSelectionOrCurrentLine(editor, (value) =>
      value
        .split("\n")
        .map((line) => `${prefix}${line}${suffix}`)
        .join("\n")
    );
  });
  addEditorCommand(plugin, "text-number-lines", "텍스트 도구: 줄 번호 매기기", (editor) => {
    const requestedStart = promptUser("시작 번호", "1");
    const parsedStart = requestedStart ? Number(requestedStart) : 1;
    const start = Number.isFinite(parsedStart) ? parsedStart : 1;
    transformSelectionOrCurrentLine(editor, (value) =>
      value
        .split("\n")
        .map((line, index) => `${start + index}. ${line}`)
        .join("\n")
    );
  });
  addEditorCommand(plugin, "text-trim-line-ends", "텍스트 도구: 줄 끝 공백 제거", (editor) => {
    transformSelectionOrCurrentLine(editor, (value) =>
      value
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
    );
  });
  addEditorCommand(plugin, "text-compress-spaces", "텍스트 도구: 연속 공백 압축", (editor) => {
    transformSelectionOrCurrentLine(editor, (value) => value.replace(/[ \t]{2,}/g, " "));
  });
  addEditorCommand(plugin, "text-remove-all-whitespace", "텍스트 도구: 모든 공백 제거", (editor) => {
    transformSelectionOrCurrentLine(editor, (value) => value.replace(/\s+/g, ""));
  });
  addEditorCommand(plugin, "text-list-to-table", "텍스트 도구: 목록→표", (editor) => {
    transformSelectionOrCurrentLine(editor, listToTable);
  });
  addEditorCommand(plugin, "text-table-to-list", "텍스트 도구: 표→목록", (editor) => {
    transformSelectionOrCurrentLine(editor, tableToList);
  });
  addEditorCommand(plugin, "text-extract-between", "텍스트 도구: 문자열 사이 추출", (editor) => {
    const start = promptUser("시작 문자열", "");
    const end = promptUser("끝 문자열", "");
    if (!start || !end) return;
    transformSelectionOrCurrentLine(editor, (value) => {
      const expression = new RegExp(
        `${escapeRegExp(start)}([\\s\\S]*?)${escapeRegExp(end)}`,
        "g"
      );
      const matches: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = expression.exec(value)) !== null) matches.push(match[1]);
      if (matches.length === 0) {
        new Notice("일치하는 구간을 찾지 못했습니다.");
        return value;
      }
      return matches.join("\n");
    });
  });

  addEditorCommand(plugin, "insert-image", "이미지 삽입", (editor) => {
    editor.replaceRange("![[이미지파일.png]]", editor.getCursor());
  });
  addEditorCommand(plugin, "move-line-up", "줄 위로 이동", (editor) => {
    moveCurrentLine(editor, -1);
  });
  addEditorCommand(plugin, "move-line-down", "줄 아래로 이동", (editor) => {
    moveCurrentLine(editor, 1);
  });
  addEditorCommand(plugin, "duplicate-line", "줄 복제", duplicateCurrentLine);
  addEditorCommand(plugin, "insert-callout", "콜아웃 삽입", (editor) => {
    insertCallout(editor, "note");
  });
}
