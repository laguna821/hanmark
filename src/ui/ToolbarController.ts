import {
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  setIcon,
  type Editor,
  type EditorPosition,
  type WorkspaceLeaf
} from "obsidian";
import {
  applyBackgroundColorValue,
  applyFontColorValue
} from "../editorCommands";
import {
  DEFAULT_HANMARK_SETTINGS,
  normalizeToolbarSkin,
  normalizeToolbarSkinMode,
  type HanmarkSettings,
  type ToolbarSkinPalette
} from "../legacy-port/settings";

interface CommandManager {
  executeCommandById(id: string): boolean;
}

interface AppWithCommands {
  commands: CommandManager;
}

export interface ToolbarActions {
  importDocument: () => void;
  openHwpxExport: () => void;
  openDocxExport: () => void;
  openHtmlExport: () => void;
  toggleHwpxPreview: () => void;
  openTemplateManager: () => void;
  openSettings: () => void;
  toggleDocxPreview?: () => void;
  openWordTemplateEditor?: () => void;
}

interface ToolbarButtonOptions {
  icon?: string;
  label: string;
  text?: string;
  action: (event: MouseEvent) => void;
}

interface ToolbarMenuItem {
  commandId?: string;
  divider?: boolean;
  icon?: string;
  label?: string;
}

interface BrushPattern {
  name: string;
  apply: (value: string) => string;
}

type ToolbarSkinSettings = Pick<
  HanmarkSettings,
  "toolbarSkinMode" | "toolbarSkin"
>;

const TOOLBAR_SKIN_CLASSES = [
  "hwp-toolbar-skin-auto",
  "hwp-toolbar-skin-light",
  "hwp-toolbar-skin-dark"
] as const;

function svgCssUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function toolbarLogoHwp(palette: ToolbarSkinPalette): string {
  const { logoAccent, logoBody, logoMuted, logoText } = palette;
  return svgCssUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">` +
      `<path fill="${logoAccent}" d="M128 248h98c12 0 22-10 22-22v-38H128z"/>` +
      `<path fill="${logoAccent}" d="M128 188h120v-60H128z"/>` +
      `<path fill="${logoBody}" d="M128 128h120V68H128z"/>` +
      `<path fill="${logoMuted}" d="M128 68h120V30c0-12-10-22-22-22h-98z"/>` +
      `<path fill="${logoBody}" d="M39 8h89v240H39C18 248 8 238 8 217V39C8 18 18 8 39 8z"/>` +
      `<path fill="${logoText}" d="M104 57H75V43H62v14H32v12h15c-5 4-8 10-8 17 0 15 12 27 29 27s29-12 29-27c0-7-3-13-8-17h15zm-36 44c-9 0-16-7-16-16s7-16 16-16 16 7 16 16-7 16-16 16z"/>` +
      `</svg>`
  );
}

function toolbarLogoWord(palette: ToolbarSkinPalette): string {
  const { logoAccent, logoBody, logoMuted, logoText } = palette;
  return svgCssUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">` +
      `<path fill="${logoMuted}" d="M9 34l15-19 17 11v13c0 2-2 4-4 4H15c-3 0-6-3-6-6z"/>` +
      `<path fill="${logoAccent}" d="M9 20c0-3 2-5 5-5h22l5-2v13c0 2-2 4-4 4H15c-3 0-6 3-6 6z"/>` +
      `<path fill="${logoAccent}" d="M9 10c0-3 3-6 6-6h22c2 0 4 2 4 4v5c0 2-2 4-4 4H15c-3 0-6 3-6 6z"/>` +
      `<path fill="${logoBody}" d="M8 23h10c2 0 3 2 3 4v10c0 2-1 3-3 3H8c-2 0-4-1-4-3V27c0-2 2-4 4-4z"/>` +
      `<path fill="${logoText}" d="M18 27l-2 9h-2l-2-5-1 5H9l-2-9h2l1 6 1-6h3l1 6 1-6z"/>` +
      `</svg>`
  );
}

function setToolbarPaletteVariables(
  toolbar: HTMLElement,
  variant: "light" | "dark",
  palette: ToolbarSkinPalette
): void {
  const prefix = `--hwp-toolbar-${variant}`;
  toolbar.style.setProperty(`${prefix}-bg`, palette.toolbarBg);
  toolbar.style.setProperty(`${prefix}-edge`, palette.toolbarEdge);
  toolbar.style.setProperty(`${prefix}-btn-border`, palette.buttonBorder);
  toolbar.style.setProperty(`${prefix}-logo-body`, palette.logoBody);
  toolbar.style.setProperty(`${prefix}-logo-accent`, palette.logoAccent);
  toolbar.style.setProperty(`${prefix}-logo-muted`, palette.logoMuted);
  toolbar.style.setProperty(`${prefix}-logo-text`, palette.logoText);
  toolbar.style.setProperty(`${prefix}-logo-hwp`, toolbarLogoHwp(palette));
  toolbar.style.setProperty(`${prefix}-logo-word`, toolbarLogoWord(palette));
}

/**
 * Applies only validated palette values to a toolbar element. Theme switching
 * remains live because CSS selects the light or dark variable set by class.
 */
export function applyToolbarSkin(
  toolbar: HTMLElement,
  settings: Partial<ToolbarSkinSettings>
): void {
  const mode = normalizeToolbarSkinMode(settings.toolbarSkinMode);
  const skin = normalizeToolbarSkin(settings.toolbarSkin);
  toolbar.classList.remove(...TOOLBAR_SKIN_CLASSES);
  toolbar.classList.add(`hwp-toolbar-skin-${mode}`);
  setToolbarPaletteVariables(toolbar, "light", skin.light);
  setToolbarPaletteVariables(toolbar, "dark", skin.dark);
}

function commandManager(plugin: Plugin): CommandManager {
  return (plugin.app as unknown as AppWithCommands).commands;
}

function orderedPositions(left: EditorPosition, right: EditorPosition): [EditorPosition, EditorPosition] {
  if (left.line < right.line || (left.line === right.line && left.ch <= right.ch)) return [left, right];
  return [right, left];
}

function selectedLineRange(editor: Editor): [number, number] {
  const [from, to] = orderedPositions(editor.getCursor("from"), editor.getCursor("to"));
  const end = to.ch === 0 && to.line > from.line ? to.line - 1 : to.line;
  return [from.line, Math.max(from.line, end)];
}

function mapSelectedLines(editor: Editor, transform: (line: string, lineNumber: number) => string): void {
  const [start, end] = selectedLineRange(editor);
  for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
    editor.setLine(lineNumber, transform(editor.getLine(lineNumber), lineNumber));
  }
}

function wrapSelection(editor: Editor, open: string, close = open): void {
  const selection = editor.getSelection();
  if (selection) {
    editor.replaceSelection(`${open}${selection}${close}`);
    return;
  }
  const cursor = editor.getCursor();
  editor.replaceRange(`${open}${close}`, cursor);
  const next = { line: cursor.line, ch: cursor.ch + open.length };
  editor.setCursor(next);
}

function setHeading(editor: Editor, level: number): void {
  const prefix = `${"#".repeat(Math.min(6, Math.max(1, level)))} `;
  const cursor = editor.getCursor();
  const line = editor.getLine(cursor.line);
  editor.setLine(
    cursor.line,
    `${prefix}${line.replace(/^\s{0,3}#{1,6}\s+/, "")}`
  );
}

function setParagraph(editor: Editor): void {
  const cursor = editor.getCursor();
  editor.setLine(
    cursor.line,
    editor.getLine(cursor.line).replace(/^\s{0,3}#{1,6}\s+/, "")
  );
}

function toggleLinePrefix(editor: Editor, expression: RegExp, prefix: string): void {
  const [start, end] = selectedLineRange(editor);
  let allPrefixed = true;
  for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
    if (!expression.test(editor.getLine(lineNumber))) {
      allPrefixed = false;
      break;
    }
  }
  mapSelectedLines(editor, (line, index) => {
    if (allPrefixed) return line.replace(expression, "");
    const cleaned = line.replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "");
    return prefix.includes("{n}") ? prefix.replace("{n}", String(index - start + 1)) + cleaned : prefix + cleaned;
  });
}

function clearFormatting(editor: Editor): void {
  const selection = editor.getSelection();
  if (selection) {
    editor.replaceSelection(
      selection
        .replace(/(\*\*|__|~~|==|`)(.*?)\1/gs, "$2")
        .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
        .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1")
        .replace(/<u>(.*?)<\/u>/gis, "$1")
        .replace(/<span\b[^>]*>(.*?)<\/span>/gis, "$1")
    );
    return;
  }
  setParagraph(editor);
}

function insertTable(editor: Editor): void {
  editor.replaceSelection("| 제목 1 | 제목 2 |\n| --- | --- |\n| 내용 1 | 내용 2 |\n");
}

function insertCodeBlock(editor: Editor): void {
  const selection = editor.getSelection();
  editor.replaceSelection(`\`\`\`\n${selection}\n\`\`\`\n`);
}

const INLINE_BRUSH_WRAPPERS: ReadonlyArray<{
  name: string;
  open: string;
  close: string;
}> = [
  { name: "굵게", open: "**", close: "**" },
  { name: "굵게", open: "__", close: "__" },
  { name: "취소선", open: "~~", close: "~~" },
  { name: "형광펜", open: "==", close: "==" },
  { name: "인라인 코드", open: "`", close: "`" },
  { name: "인라인 수식", open: "$", close: "$" },
  { name: "기울임", open: "*", close: "*" },
  { name: "기울임", open: "_", close: "_" }
];

function activeEditor(plugin: Plugin): Editor | null {
  return plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? null;
}

function activeMarkdownLeaf(plugin: Plugin): WorkspaceLeaf | null {
  return plugin.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ?? null;
}

export class ToolbarController {
  private currentToolbar: HTMLElement | null = null;
  private visible: boolean;
  private formatBrushActive = false;
  private formatBrushApply: ((value: string) => string) | null = null;
  private formatBrushButton: HTMLButtonElement | null = null;
  private formatBrushArmedAt = 0;
  private lastBrushAppliedSelection = "";
  private lastBrushPattern: BrushPattern | null = null;

  constructor(
    private readonly plugin: Plugin,
    private readonly actions: ToolbarActions,
    visibleOnStartup: boolean,
    private readonly getToolbarSkinSettings: () => ToolbarSkinSettings = () =>
      DEFAULT_HANMARK_SETTINGS
  ) {
    this.visible = visibleOnStartup;
  }

  initialize(): void {
    this.plugin.registerEvent(
      this.plugin.app.workspace.on("active-leaf-change", (leaf) => {
        if (this.visible) this.injectToolbar(leaf);
      })
    );
    this.plugin.registerEvent(
      this.plugin.app.workspace.on("layout-change", () => {
        if (this.visible) this.injectToolbar(activeMarkdownLeaf(this.plugin));
      })
    );
    this.plugin.app.workspace.onLayoutReady(() => {
      if (this.visible) this.injectToolbar(activeMarkdownLeaf(this.plugin));
    });
    this.plugin.registerDomEvent(document, "keydown", (event) => {
      if (event.key === "Escape" && this.formatBrushActive) {
        this.clearFormatBrush(false);
      }
    });
    this.plugin.registerDomEvent(document, "mouseup", () => {
      this.applyFormatBrushFromSelection();
    });
    this.plugin.registerDomEvent(document, "keyup", () => {
      this.applyFormatBrushFromSelection();
    });
  }

  isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) this.injectToolbar(activeMarkdownLeaf(this.plugin));
    else this.removeToolbar();
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  refresh(): void {
    if (this.visible) this.injectToolbar(activeMarkdownLeaf(this.plugin));
  }

  destroy(): void {
    this.removeToolbar();
  }

  private injectToolbar(leaf: WorkspaceLeaf | null): void {
    this.removeToolbar();
    if (!leaf || !(leaf.view instanceof MarkdownView)) return;
    const container = leaf.view.containerEl;
    const toolbar = createDiv({ cls: "hwp-toolbar-container" });
    applyToolbarSkin(toolbar, this.getToolbarSkinSettings());
    this.currentToolbar = toolbar;
    this.renderMainToolbar(toolbar.createDiv({ cls: "hwp-toolbar-main" }));
    this.renderFormatToolbar(toolbar.createDiv({ cls: "hwp-toolbar-format" }));
    container.insertBefore(toolbar, container.firstChild);
  }

  private removeToolbar(): void {
    this.clearFormatBrush(false);
    this.currentToolbar?.remove();
    this.currentToolbar = null;
    this.formatBrushButton = null;
    document.querySelectorAll(".hwp-toolbar-container").forEach((element) => element.remove());
  }

  private runCommand(id: string): boolean {
    return commandManager(this.plugin).executeCommandById(id);
  }

  private runPluginCommand(id: string): boolean {
    return this.runCommand(`${this.plugin.manifest.id}:${id}`);
  }

  private runFirstCommand(ids: readonly string[], fallback?: string): boolean {
    for (const id of ids) {
      if (this.runCommand(id)) return true;
    }
    return fallback ? this.runPluginCommand(fallback) : false;
  }

  private addButton(root: HTMLElement, options: ToolbarButtonOptions): HTMLButtonElement {
    const button = root.createEl("button", {
      cls: "hwp-toolbar-btn",
      attr: {
        type: "button",
        "aria-label": options.label,
        title: options.label
      }
    });
    if (options.icon) setIcon(button, options.icon);
    if (options.text) button.createSpan({ cls: "hwp-toolbar-btn-label", text: options.text });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      options.action(event);
    });
    return button;
  }

  private addColorButton(
    root: HTMLElement,
    options: {
      icon: string;
      label: string;
      text: string;
      initialColor: string;
      apply: (editor: Editor, color: string) => void;
    }
  ): HTMLButtonElement {
    const picker = root.createEl("input", {
      type: "color",
      attr: {
        "aria-label": `${options.label} 선택`
      }
    });
    picker.value = options.initialColor;
    picker.hidden = true;
    picker.addEventListener("change", () => {
      const editor = activeEditor(this.plugin);
      if (editor) options.apply(editor, picker.value);
    });
    return this.addButton(root, {
      icon: options.icon,
      label: options.label,
      text: options.text,
      action: () => picker.click()
    });
  }

  private addMenuButton(
    root: HTMLElement,
    label: string,
    text: string,
    items: readonly ToolbarMenuItem[],
    icon?: string
  ): HTMLButtonElement {
    return this.addButton(root, {
      icon,
      label,
      text,
      action: (event) => {
        const menu = new Menu();
        for (const option of items) {
          if (option.divider) {
            menu.addSeparator();
            continue;
          }
          if (!option.commandId || !option.label) continue;
          menu.addItem((item) => {
            item.setTitle(option.label ?? "");
            if (option.icon) item.setIcon(option.icon);
            item.onClick(() => {
              this.runPluginCommand(option.commandId ?? "");
            });
          });
        }
        menu.showAtMouseEvent(event);
      }
    });
  }

  private addDivider(root: HTMLElement): void {
    root.createDiv({ cls: "hwp-toolbar-divider" });
  }

  private buildBrushPattern(
    headingLevel: number | null,
    wrappers: ReadonlyArray<{ name: string; open: string; close: string }>
  ): BrushPattern {
    const names = [
      headingLevel ? `제목 ${headingLevel}` : "",
      ...wrappers.map((wrapper) => wrapper.name)
    ].filter(Boolean);
    return {
      name: names.join(" + "),
      apply: (value) => {
        let result = value;
        let changed = true;
        while (changed && result.length > 1) {
          changed = false;
          for (const wrapper of INLINE_BRUSH_WRAPPERS) {
            if (
              result.length > wrapper.open.length + wrapper.close.length &&
              result.startsWith(wrapper.open) &&
              result.endsWith(wrapper.close)
            ) {
              result = result.slice(wrapper.open.length, -wrapper.close.length);
              changed = true;
              break;
            }
          }
        }
        for (const wrapper of wrappers) {
          result = `${wrapper.open}${result}${wrapper.close}`;
        }
        if (headingLevel) {
          const prefix = `${"#".repeat(headingLevel)} `;
          result = result
            .split(/\r?\n/)
            .map((line) => `${prefix}${line.replace(/^\s{0,3}#{1,6}\s+/, "")}`)
            .join("\n");
        }
        return result;
      }
    };
  }

  private detectBrushPattern(value: string): BrushPattern | null {
    let remaining = value.trim();
    if (!remaining) return null;
    const heading = remaining.match(/^(#{1,6})\s+([\s\S]*)$/);
    const headingLevel = heading ? heading[1].length : null;
    if (heading) remaining = heading[2];
    const wrappers: Array<{ name: string; open: string; close: string }> = [];
    let changed = true;
    while (changed && remaining.length > 1) {
      changed = false;
      for (const wrapper of INLINE_BRUSH_WRAPPERS) {
        if (
          remaining.length > wrapper.open.length + wrapper.close.length &&
          remaining.startsWith(wrapper.open) &&
          remaining.endsWith(wrapper.close)
        ) {
          remaining = remaining.slice(wrapper.open.length, -wrapper.close.length);
          wrappers.push(wrapper);
          changed = true;
          break;
        }
      }
    }
    if (!headingLevel && wrappers.length === 0) return null;
    wrappers.reverse();
    return this.buildBrushPattern(headingLevel, wrappers);
  }

  private detectBrushPatternFromEditorContext(editor: Editor): BrushPattern | null {
    const [from, to] = orderedPositions(
      editor.getCursor("from"),
      editor.getCursor("to")
    );
    if (from.line !== to.line || from.ch === to.ch) return null;
    const line = editor.getLine(from.line);
    const before = line.slice(0, from.ch);
    const selected = line.slice(from.ch, to.ch);
    const after = line.slice(to.ch);
    if (!selected) return null;
    const heading = line.match(/^\s{0,3}(#{1,6})\s+/);
    const headingLevel =
      heading && from.ch >= heading[0].length ? heading[1].length : null;
    const wrappers: Array<{ name: string; open: string; close: string }> = [];
    let left = before;
    let right = after;
    let changed = true;
    while (changed) {
      changed = false;
      for (const wrapper of INLINE_BRUSH_WRAPPERS) {
        if (left.endsWith(wrapper.open) && right.startsWith(wrapper.close)) {
          wrappers.push(wrapper);
          left = left.slice(0, -wrapper.open.length);
          right = right.slice(wrapper.close.length);
          changed = true;
          break;
        }
      }
    }
    if (!headingLevel && wrappers.length === 0) return null;
    wrappers.reverse();
    return this.buildBrushPattern(headingLevel, wrappers);
  }

  private rememberHeadingBrush(level: number): void {
    this.lastBrushPattern = this.buildBrushPattern(level, []);
  }

  private rememberInlineBrush(
    name: string,
    open: string,
    close: string
  ): void {
    this.lastBrushPattern = this.buildBrushPattern(null, [{ name, open, close }]);
  }

  private toggleFormatBrush(): void {
    if (this.formatBrushActive) {
      this.clearFormatBrush(true);
      return;
    }
    const editor = activeEditor(this.plugin);
    if (!editor) {
      new Notice("활성 편집기가 없습니다.");
      return;
    }
    const selection = editor.getSelection();
    const pattern =
      this.detectBrushPatternFromEditorContext(editor) ??
      (selection.trim() ? this.detectBrushPattern(selection) : null) ??
      this.lastBrushPattern;
    if (!pattern) {
      new Notice("서식을 먼저 한 번 적용하거나, 서식이 있는 텍스트를 선택하세요.");
      return;
    }
    this.formatBrushActive = true;
    this.formatBrushApply = pattern.apply;
    this.formatBrushArmedAt = Date.now();
    this.lastBrushAppliedSelection = "";
    this.formatBrushButton?.classList.add("is-active");
    new Notice(`서식 브러시 ON: ${pattern.name} (적용할 텍스트를 선택하세요)`);
  }

  private applyFormatBrushFromSelection(): void {
    if (
      !this.formatBrushActive ||
      !this.formatBrushApply ||
      Date.now() - this.formatBrushArmedAt < 180
    ) {
      return;
    }
    const editor = activeEditor(this.plugin);
    if (!editor) return;
    const selection = editor.getSelection();
    if (!selection.trim()) return;
    const cursor = editor.getCursor();
    const signature = `${cursor.line}:${cursor.ch}:${selection}`;
    if (signature === this.lastBrushAppliedSelection) return;
    this.lastBrushAppliedSelection = signature;
    editor.replaceSelection(this.formatBrushApply(selection));
  }

  private clearFormatBrush(showNotice: boolean): void {
    this.formatBrushActive = false;
    this.formatBrushApply = null;
    this.formatBrushArmedAt = 0;
    this.lastBrushAppliedSelection = "";
    this.formatBrushButton?.classList.remove("is-active");
    if (showNotice) new Notice("서식 브러시 OFF");
  }

  private renderMainToolbar(root: HTMLElement): void {
    const files = root.createDiv({ cls: "hwp-toolbar-group" });
    this.addButton(files, {
      icon: "file-plus",
      label: "새 문서",
      action: () => void this.runCommand("file-explorer:new-file")
    });
    this.addButton(files, {
      icon: "folder-open",
      label: "Vault 문서 열기",
      action: () => void this.runCommand("switcher:open")
    });
    this.addButton(files, {
      icon: "file-input",
      label: "HWP/HWPX/PDF/DOCX/XLS 문서 가져오기",
      action: this.actions.importDocument
    });
    this.addButton(files, {
      icon: "save",
      label: "저장",
      action: () => void this.runCommand("editor:save-file")
    });

    this.addDivider(root);
    const exports = root.createDiv({ cls: "hwp-toolbar-group" });
    this.addButton(exports, {
      icon: "file-output",
      label: "HWPX 내보내기",
      text: "HWPX",
      action: this.actions.openHwpxExport
    });
    this.addButton(exports, {
      icon: "file-text",
      label: "DOCX 내보내기",
      text: "DOCX",
      action: this.actions.openDocxExport
    });
    this.addButton(exports, {
      icon: "code",
      label: "HTML 내보내기",
      text: "HTML",
      action: this.actions.openHtmlExport
    });

    this.addDivider(root);
    const history = root.createDiv({ cls: "hwp-toolbar-group" });
    this.addButton(history, {
      icon: "undo",
      label: "되돌리기",
      action: () => void this.runCommand("editor:undo")
    });
    this.addButton(history, {
      icon: "redo",
      label: "다시 실행",
      action: () => void this.runCommand("editor:redo")
    });

    this.addDivider(root);
    const inserts = root.createDiv({ cls: "hwp-toolbar-group" });
    this.addButton(inserts, {
      icon: "table",
      label: "표 삽입",
      action: () => void this.runPluginCommand("insert-table")
    });
    this.addButton(inserts, {
      icon: "minus",
      label: "수평선 삽입",
      action: () => void this.runPluginCommand("insert-hr")
    });
    this.addButton(inserts, {
      icon: "square-code",
      label: "코드 블록 삽입",
      action: () => void this.runPluginCommand("insert-codeblock")
    });
    this.addButton(inserts, {
      icon: "paperclip",
      label: "첨부 파일 삽입",
      action: () =>
        void this.runFirstCommand(["editor:attach-file"], "insert-embed")
    });

    this.addDivider(root);
    const previews = root.createDiv({ cls: "hwp-toolbar-group" });
    this.addButton(previews, {
      icon: "columns-2",
      label: "빠른 HWPX 미리보기",
      text: "HWPX 미리보기",
      action: this.actions.toggleHwpxPreview
    });
    if (this.actions.toggleDocxPreview) {
      this.addButton(previews, {
        icon: "file-search",
        label: "DOCX 미리보기",
        text: "DOCX 미리보기",
        action: this.actions.toggleDocxPreview
      });
    }

    this.addDivider(root);
    const templates = root.createDiv({ cls: "hwp-toolbar-group" });
    this.addButton(templates, {
      icon: "file-check",
      label: "HWPX 템플릿 관리",
      text: "HWPX 템플릿",
      action: this.actions.openTemplateManager
    });
    if (this.actions.openWordTemplateEditor) {
      this.addButton(templates, {
        icon: "file-cog",
        label: "Word 템플릿 편집",
        text: "Word 템플릿",
        action: this.actions.openWordTemplateEditor
      });
    }
    this.addButton(templates, {
      icon: "settings",
      label: "HanMark 설정",
      action: this.actions.openSettings
    });
  }

  private renderFormatToolbar(root: HTMLElement): void {
    const styleGroup = root.createDiv({ cls: "hwp-toolbar-group" });
    const style = styleGroup.createEl("select", {
      cls: "hwp-style-dropdown",
      attr: { "aria-label": "문단 스타일" }
    });
    [
      ["p", "본문"],
      ["h1", "제목 1"],
      ["h2", "제목 2"],
      ["h3", "제목 3"],
      ["h4", "제목 4"],
      ["h5", "제목 5"],
      ["h6", "제목 6"]
    ].forEach(([value, label]) => style.createEl("option", { value, text: label }));
    style.addEventListener("change", () => {
      const editor = activeEditor(this.plugin);
      if (!editor) return;
      if (style.value === "p") setParagraph(editor);
      else {
        const level = Number(style.value.slice(1));
        setHeading(editor, level);
        this.rememberHeadingBrush(level);
      }
      style.value = "p";
    });

    this.addDivider(root);
    const headings = root.createDiv({ cls: "hwp-toolbar-group" });
    this.formatBrushButton = this.addButton(headings, {
      icon: "paintbrush",
      label: "서식 브러시",
      action: () => this.toggleFormatBrush()
    });
    this.addButton(headings, {
      icon: "eraser",
      label: "서식 지우기",
      action: () =>
        void this.runFirstCommand(
          ["editor:clear-formatting"],
          "clear-formatting"
        )
    });
    for (const level of [2, 3]) {
      this.addButton(headings, {
        label: `제목 ${level}`,
        text: `H${level}`,
        action: () => {
          if (
            this.runFirstCommand(
              [`editor:set-heading-${level}`],
              `set-heading-${level}`
            )
          ) {
            this.rememberHeadingBrush(level);
          }
        }
      });
    }
    this.addButton(headings, {
      label: "추가 제목 수준",
      text: "Hn",
      action: (event) => {
        const menu = new Menu();
        for (const level of [1, 4, 5, 6]) {
          menu.addItem((item) =>
            item.setTitle(`제목 ${level}`).onClick(() => {
              if (
                this.runFirstCommand(
                  [`editor:set-heading-${level}`],
                  `set-heading-${level}`
                )
              ) {
                this.rememberHeadingBrush(level);
              }
            })
          );
        }
        menu.showAtMouseEvent(event);
      }
    });

    this.addDivider(root);
    const inline = root.createDiv({ cls: "hwp-toolbar-group" });
    const inlineButtons: Array<[
      string,
      string,
      string,
      string,
      readonly string[],
      string | undefined
    ]> = [
      ["굵게", "B", "**", "**", ["editor:toggle-bold"], undefined],
      ["기울임", "I", "*", "*", ["editor:toggle-italics"], undefined],
      ["취소선", "S", "~~", "~~", ["editor:toggle-strikethrough"], undefined],
      ["밑줄", "U", "<u>", "</u>", [], "toggle-underline"],
      ["형광펜", "H", "==", "==", ["editor:toggle-highlight"], undefined],
      ["인라인 코드", "<>", "`", "`", ["editor:toggle-code"], undefined],
      ["인라인 수식", "∑", "$", "$", [], "toggle-inline-math"]
    ];
    for (const [label, text, open, close, commandIds, fallback] of inlineButtons) {
      this.addButton(inline, {
        label,
        text,
        action: () => {
          const applied =
            commandIds.length > 0
              ? this.runFirstCommand(commandIds, fallback)
              : fallback
                ? this.runPluginCommand(fallback)
                : false;
          if (!applied) {
            const editor = activeEditor(this.plugin);
            if (editor) wrapSelection(editor, open, close);
          }
          this.rememberInlineBrush(label, open, close);
        }
      });
    }

    this.addDivider(root);
    const blocks = root.createDiv({ cls: "hwp-toolbar-group" });
    this.addButton(blocks, {
      icon: "list",
      label: "글머리 기호",
      action: () => {
        if (!this.runCommand("editor:toggle-bullet-list")) {
          const editor = activeEditor(this.plugin);
          if (editor) toggleLinePrefix(editor, /^\s*[-+*]\s+/, "- ");
        }
      }
    });
    this.addButton(blocks, {
      icon: "list-ordered",
      label: "번호 매기기",
      action: () => {
        if (!this.runCommand("editor:toggle-numbered-list")) {
          const editor = activeEditor(this.plugin);
          if (editor) toggleLinePrefix(editor, /^\s*\d+[.)]\s+/, "{n}. ");
        }
      }
    });
    this.addButton(blocks, {
      icon: "list-checks",
      label: "할 일 목록",
      action: () => void this.runPluginCommand("cycle-list-checklist")
    });
    this.addButton(blocks, {
      icon: "check-check",
      label: "할 일 완료·미완료 전환",
      action: () => void this.runCommand("editor:toggle-checklist-status")
    });
    this.addButton(blocks, {
      icon: "quote",
      label: "인용문",
      action: () => void this.runPluginCommand("toggle-blockquote")
    });
    this.addMenuButton(
      blocks,
      "콜아웃",
      "콜아웃",
      [
        {
          label: "노트 콜아웃",
          commandId: "insert-callout-note",
          icon: "message-square"
        },
        {
          label: "주의 콜아웃",
          commandId: "insert-callout-warning",
          icon: "message-square-warning"
        }
      ],
      "message-square-warning"
    );

    this.addDivider(root);
    const tools = root.createDiv({ cls: "hwp-toolbar-group" });
    this.addMenuButton(
      tools,
      "링크·이미지·수식 삽입",
      "삽입/수식",
      [
        { label: "Markdown 링크", commandId: "insert-link", icon: "link" },
        { label: "위키 링크", commandId: "insert-wikilink", icon: "file-symlink" },
        { label: "이미지", commandId: "insert-image", icon: "image" },
        { label: "Obsidian 임베드", commandId: "insert-embed", icon: "paperclip" },
        { divider: true },
        { label: "표", commandId: "insert-table", icon: "table" },
        { label: "코드 블록", commandId: "insert-codeblock", icon: "square-code" },
        { label: "수식 블록", commandId: "insert-mathblock", icon: "sigma" },
        { label: "인라인 수식", commandId: "toggle-inline-math", icon: "function-square" },
        { label: "위 첨자", commandId: "superscript", icon: "superscript" },
        { label: "아래 첨자", commandId: "subscript", icon: "subscript" },
        { label: "가로줄", commandId: "insert-hr", icon: "minus" }
      ],
      "plus-circle"
    );
    this.addMenuButton(
      tools,
      "정렬",
      "정렬",
      [
        { label: "왼쪽 정렬", commandId: "align-left", icon: "align-left" },
        { label: "가운데 정렬", commandId: "align-center", icon: "align-center" },
        { label: "오른쪽 정렬", commandId: "align-right", icon: "align-right" },
        { label: "양쪽 정렬", commandId: "align-justify", icon: "align-justify" }
      ],
      "align-justify"
    );
    this.addColorButton(tools, {
      icon: "palette",
      label: "글자색",
      text: "글자색",
      initialColor: "#1A73E8",
      apply: applyFontColorValue
    });
    this.addColorButton(tools, {
      icon: "paint-bucket",
      label: "배경색",
      text: "배경색",
      initialColor: "#FFF59D",
      apply: applyBackgroundColorValue
    });
    this.addMenuButton(
      tools,
      "텍스트 도구",
      "텍스트 도구",
      [
        { label: "일반 텍스트로 정리", commandId: "text-get-plain" },
        { label: "전각/반각 변환", commandId: "text-smart-symbols" },
        { divider: true },
        { label: "빈 줄 삽입", commandId: "text-insert-blank-lines" },
        { label: "빈 줄 제거", commandId: "text-remove-blank-lines" },
        { label: "줄 분할", commandId: "text-split-lines" },
        { label: "줄 합치기", commandId: "text-merge-lines" },
        { label: "중복 줄 제거", commandId: "text-dedupe-lines" },
        { divider: true },
        { label: "접두/접미 추가", commandId: "text-add-wrap" },
        { label: "줄 번호 매기기", commandId: "text-number-lines" },
        { label: "줄 끝 공백 제거", commandId: "text-trim-line-ends" },
        { label: "연속 공백 압축", commandId: "text-compress-spaces" },
        { label: "모든 공백 제거", commandId: "text-remove-all-whitespace" },
        { divider: true },
        { label: "목록 → 표", commandId: "text-list-to-table" },
        { label: "표 → 목록", commandId: "text-table-to-list" },
        { label: "문자열 사이 추출", commandId: "text-extract-between" }
      ],
      "wrench"
    );

    this.addDivider(root);
    const indent = root.createDiv({ cls: "hwp-toolbar-group" });
    this.addButton(indent, {
      icon: "indent-increase",
      label: "들여쓰기",
      action: () => {
        if (!this.runCommand("editor:indent-list")) {
          const editor = activeEditor(this.plugin);
          if (editor) mapSelectedLines(editor, (line) => `  ${line}`);
        }
      }
    });
    this.addButton(indent, {
      icon: "indent-decrease",
      label: "내어쓰기",
      action: () => {
        if (!this.runCommand("editor:unindent-list")) {
          const editor = activeEditor(this.plugin);
          if (editor) {
            mapSelectedLines(editor, (line) =>
              line.replace(/^(?: {1,2}|\t)/, "")
            );
          }
        }
      }
    });
  }
}

export const editorFormatting = {
  clearFormatting,
  insertCodeBlock,
  insertTable,
  setHeading,
  setParagraph,
  toggleLinePrefix,
  wrapSelection
};
