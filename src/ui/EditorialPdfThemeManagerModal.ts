import { type App, Modal, Notice } from "obsidian";
import type { FileGateway } from "../io/fileGateway";
import {
  BUILTIN_EDITORIAL_PDF_THEME_ID,
  EDITORIAL_PDF_THEME_LIMITS,
  EDITORIAL_PDF_THEME_MAX_JSON_BYTES,
  activeEditorialPdfThemeSnapshot,
  availableEditorialPdfThemeName,
  canonicalEditorialPdfHex,
  createEditorialPdfTheme,
  deleteEditorialPdfTheme,
  duplicateEditorialPdfTheme,
  listEditorialPdfThemeSnapshots,
  normalizeEditorialPdfTheme,
  parseEditorialPdfThemeExchange,
  renameEditorialPdfTheme,
  resolveEditorialPdfTheme,
  resolveEditorialPdfThemeSnapshot,
  setActiveEditorialPdfTheme,
  stringifyEditorialPdfThemeExchange,
  updateEditorialPdfTheme,
  type EditorialPdfContrastDiagnostic,
  type EditorialPdfOverrideToken,
  type EditorialPdfThemeLibraryV1,
  type EditorialPdfThemeSnapshot,
  type EditorialPdfThemeV1,
  type EditorialPdfTitleMode,
  type ResolvedEditorialPdfTheme
} from "../io/editorialPdfTheme";
import { errorMessage } from "../utils/errors";

export interface EditorialPdfThemeManagerOptions {
  fileGateway: FileGateway;
  getLibrary(): EditorialPdfThemeLibraryV1;
  replaceLibrary(library: EditorialPdfThemeLibraryV1): Promise<void>;
  onChanged?(): void;
  selectedId?: string;
  startInCreate?: boolean;
}

interface BuilderOptions {
  initialName: string;
  initialTheme: EditorialPdfThemeV1;
  title: string;
  save(name: string, theme: EditorialPdfThemeV1): Promise<void>;
}

type ThemeTextSection = "cover" | "page";

const SAMPLE_FILE_TITLE = "프로젝트 회의 기록";
const OVERRIDE_LABELS: ReadonlyArray<{
  token: EditorialPdfOverrideToken;
  label: string;
  description: string;
}> = [
  {
    token: "onKey",
    label: "키 배경 위 글자",
    description: "표지 상단과 태그처럼 키 컬러 면 위에 놓이는 글자"
  },
  {
    token: "keyInk",
    label: "흰 종이 위 브랜드 글자",
    description: "제목과 머리말처럼 흰 종이 위에 놓이는 브랜드 글자"
  },
  {
    token: "accentLine",
    label: "상·하단 포인트 선",
    description: "본문 페이지의 위·아래 구분선"
  }
];

let controlSequence = 0;

function nextControlId(stem: string): string {
  controlSequence += 1;
  return `hanmark-pdf-theme-${stem}-${controlSequence}`;
}

function safeThemeFilename(snapshot: EditorialPdfThemeSnapshot): string {
  const stem = Array.from(snapshot.name, (character) => {
    const code = character.charCodeAt(0);
    return "\\/:*?\"<>|".includes(character) || code <= 31 || code === 127
      ? "_"
      : character;
  }).join("").trim() || "hanmark-pdf-theme";
  return `${stem}.hanmark-pdf-theme.json`;
}

function themeTitle(
  mode: EditorialPdfTitleMode,
  custom: string
): string {
  if (mode === "blank") return "";
  return mode === "custom" ? custom : SAMPLE_FILE_TITLE;
}

function applyPalette(
  element: HTMLElement,
  resolved: ResolvedEditorialPdfTheme
): void {
  const { palette } = resolved;
  element.style.setProperty("--hanmark-pdf-preview-key", palette.keySurface);
  element.style.setProperty("--hanmark-pdf-preview-on-key", palette.onKey);
  element.style.setProperty("--hanmark-pdf-preview-key-ink", palette.keyInk);
  element.style.setProperty(
    "--hanmark-pdf-preview-muted-ink",
    palette.keyMutedInk
  );
  element.style.setProperty("--hanmark-pdf-preview-accent", palette.accentLine);
  element.style.setProperty("--hanmark-pdf-preview-tint", palette.softTint);
  element.style.setProperty("--hanmark-pdf-preview-body", palette.bodyInk);
  element.style.setProperty("--hanmark-pdf-preview-border", palette.border);
}

function diagnosticLabel(item: EditorialPdfContrastDiagnostic): string {
  return OVERRIDE_LABELS.find(({ token }) => token === item.token)?.label
    ?? item.token;
}

function renderDiagnostics(
  root: HTMLElement,
  resolved: ResolvedEditorialPdfTheme
): void {
  root.empty();
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-atomic", "true");
  const failing = resolved.diagnostics.filter(
    (item) => item.enforced && !item.passes
  );
  root.addClass(failing.length ? "has-warning" : "is-safe");
  root.removeClass(failing.length ? "is-safe" : "has-warning");
  root.createEl("strong", {
    text: failing.length
      ? `대비 경고 ${failing.length}개`
      : "자동 가독성 검사 통과"
  });
  const list = root.createEl("ul");
  for (const item of resolved.diagnostics) {
    list.createEl("li", {
      text:
        `${diagnosticLabel(item)} · ${item.ratio.toFixed(2)}:1 · ` +
        `${item.passes || !item.enforced ? "통과" : `목표 ${item.minimum}:1 미달`}` +
        `${item.manual ? " · 직접 지정" : " · 자동"}`
    });
  }
  if (failing.length) {
    root.createEl("p", {
      text: "직접 지정한 색은 그대로 저장하고 인쇄할 수 있습니다. 잘 보이지 않을 수 있으므로 자동 추천 적용을 권장합니다."
    });
  }
}

function renderPreview(
  root: HTMLElement,
  theme: EditorialPdfThemeV1,
  resolved: ResolvedEditorialPdfTheme
): void {
  root.empty();
  applyPalette(root, resolved);
  const cover = root.createDiv({ cls: "hanmark-pdf-theme-preview-cover" });
  const coverTop = cover.createDiv({ cls: "hanmark-pdf-theme-preview-cover-top" });
  coverTop.createSpan({ text: theme.cover.kicker });
  coverTop.createSpan({ text: theme.cover.edition });
  const coverBody = cover.createDiv({ cls: "hanmark-pdf-theme-preview-cover-body" });
  coverBody.createEl("strong", {
    text: themeTitle(theme.cover.titleMode, theme.cover.titleText)
  });
  coverBody.createSpan({ text: theme.cover.subtitle });
  coverBody.createEl("b", { text: theme.cover.system });
  coverBody.createSpan({ text: theme.cover.detail });
  const tags = coverBody.createDiv({ cls: "hanmark-pdf-theme-preview-tags" });
  for (const tag of theme.cover.tags.filter(Boolean)) {
    tags.createSpan({ text: tag });
  }
  cover.createSpan({
    cls: "hanmark-pdf-theme-preview-brand",
    text: theme.cover.brand
  });

  const page = root.createDiv({ cls: "hanmark-pdf-theme-preview-page" });
  const header = page.createDiv({ cls: "hanmark-pdf-theme-preview-header" });
  header.createSpan({ text: theme.page.headerLeft });
  header.createSpan({
    text: themeTitle(
      theme.page.headerRightMode,
      theme.page.headerRightText
    )
  });
  const body = page.createDiv({ cls: "hanmark-pdf-theme-preview-body" });
  body.createEl("h3", { text: "1. 대표 본문 제목" });
  body.createEl("p", {
    text: "키 컬러를 바꾸면 글자와 배경의 역할을 분리해 읽기 쉬운 색을 자동으로 계산합니다."
  });
  body.createEl("code", { text: "const theme = \"readable\";" });
  const footer = page.createDiv({ cls: "hanmark-pdf-theme-preview-footer" });
  footer.createSpan({ text: theme.page.footerLeft });
  footer.createSpan({ text: theme.page.showPageNumber ? "16" : "" });
}

class ConfirmThemeDeleteModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly name: string,
    private readonly finish: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("사용자 PDF 테마 삭제");
    this.contentEl.createEl("p", {
      text: `“${this.name}” 테마를 삭제할까요? 이미 만든 PDF에는 영향이 없습니다.`
    });
    const actions = this.contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    const cancel = actions.createEl("button", {
      text: "취소",
      attr: { type: "button" }
    });
    cancel.onclick = () => this.complete(false);
    const remove = actions.createEl("button", {
      text: "삭제",
      cls: "mod-warning",
      attr: { type: "button" }
    });
    remove.onclick = () => this.complete(true);
    window.setTimeout(() => cancel.focus());
  }

  onClose(): void {
    if (!this.settled) this.finish(false);
    this.contentEl.empty();
  }

  private complete(value: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.finish(value);
    this.close();
  }
}

function confirmThemeDelete(app: App, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmThemeDeleteModal(app, name, resolve).open();
  });
}

class PdfThemeNameModal extends Modal {
  private value: string;
  private saving = false;

  constructor(
    app: App,
    title: string,
    initial: string,
    private readonly saveName: (value: string) => Promise<void>
  ) {
    super(app);
    this.titleEl.setText(title);
    this.value = initial;
  }

  onOpen(): void {
    const id = nextControlId("name");
    const label = this.contentEl.createEl("label", {
      text: "테마 이름",
      attr: { for: id }
    });
    label.addClass("hanmark-pdf-theme-field-label");
    const input = this.contentEl.createEl("input", {
      type: "text",
      value: this.value,
      attr: { id }
    });
    input.maxLength = EDITORIAL_PDF_THEME_LIMITS.name * 2;
    input.oninput = () => (this.value = input.value);
    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.submit(input);
      }
    };
    const actions = this.contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    const cancel = actions.createEl("button", {
      text: "취소",
      attr: { type: "button" }
    });
    cancel.onclick = () => this.close();
    const save = actions.createEl("button", {
      text: "확인",
      cls: "mod-cta",
      attr: { type: "button" }
    });
    save.onclick = () => void this.submit(input);
    window.setTimeout(() => {
      input.focus();
      input.select();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async submit(input: HTMLInputElement): Promise<void> {
    if (this.saving) return;
    if (!this.value.trim()) {
      input.setAttribute("aria-invalid", "true");
      new Notice("테마 이름을 입력하세요.");
      input.focus();
      return;
    }
    this.saving = true;
    try {
      await this.saveName(this.value);
      this.close();
    } catch (error) {
      this.saving = false;
      new Notice(`PDF 테마 이름을 저장하지 못했습니다: ${errorMessage(error)}`);
      input.focus();
    }
  }
}

export class EditorialPdfThemeBuilderModal extends Modal {
  private readonly draft: EditorialPdfThemeV1;
  private readonly overrideInputs: Record<EditorialPdfOverrideToken, string>;
  private name: string;
  private keyInput: string;
  private step = 0;
  private saving = false;

  constructor(
    app: App,
    private readonly options: BuilderOptions
  ) {
    super(app);
    this.name = options.initialName;
    this.draft = normalizeEditorialPdfTheme(options.initialTheme);
    this.keyInput = this.draft.colors.key;
    this.overrideInputs = {
      onKey: this.draft.colors.overrides.onKey ?? "",
      keyInk: this.draft.colors.overrides.keyInk ?? "",
      accentLine: this.draft.colors.overrides.accentLine ?? ""
    };
  }

  onOpen(): void {
    this.modalEl.addClass("hanmark-resizable-workspace-modal");
    this.modalEl.addClass("hanmark-pdf-theme-workspace-modal");
    this.render();
  }

  onClose(): void {
    this.modalEl.removeClass("hanmark-resizable-workspace-modal");
    this.modalEl.removeClass("hanmark-pdf-theme-workspace-modal");
    this.contentEl.empty();
  }

  private render(): void {
    this.titleEl.setText(this.options.title);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("hanmark-pdf-theme-builder");
    const intro = contentEl.createDiv({ cls: "hanmark-pdf-theme-builder-intro" });
    intro.createEl("p", {
      text: "세 단계만 확인하면 표지와 본문에 함께 적용되는 PDF 테마를 만들 수 있습니다."
    });
    this.renderStepNavigation(intro);

    const panel = contentEl.createDiv({
      cls: "hanmark-pdf-theme-builder-panel",
      attr: {
        role: "region",
        "aria-label": `${this.step + 1}단계`
      }
    });
    if (this.step === 0) this.renderColorStep(panel);
    if (this.step === 1) this.renderTextStep(panel);
    if (this.step === 2) this.renderPreviewStep(panel);
    this.renderFooter(contentEl);
    window.setTimeout(() => {
      contentEl.querySelector<HTMLElement>("[data-hanmark-autofocus]")?.focus();
    });
  }

  private renderStepNavigation(root: HTMLElement): void {
    const nav = root.createDiv({
      cls: "hanmark-pdf-theme-steps",
      attr: { "aria-label": "PDF 테마 만들기 단계" }
    });
    for (const [index, label] of [
      "1. 키 컬러",
      "2. 문구",
      "3. 미리보기"
    ].entries()) {
      const button = nav.createEl("button", {
        text: label,
        attr: {
          type: "button",
          "aria-current": this.step === index ? "step" : "false"
        }
      });
      button.disabled = index > this.step && !this.validThrough(index - 1);
      button.onclick = () => {
        if (button.disabled) return;
        this.step = index;
        this.render();
      };
    }
  }

  private renderColorStep(root: HTMLElement): void {
    root.createEl("h3", { text: "1단계 · 키 컬러 고르기" });
    root.createEl("p", {
      text: "브랜드 색 하나만 고르면 표지 글자, 본문 제목, 선과 옅은 배경을 읽기 쉽게 자동 계산합니다."
    });
    this.renderNameField(root);

    const field = root.createDiv({ cls: "hanmark-pdf-theme-color-field" });
    const id = nextControlId("key-color");
    field.createEl("label", {
      text: "키 컬러",
      cls: "hanmark-pdf-theme-field-label",
      attr: { for: id }
    });
    const picker = field.createEl("input", {
      type: "color",
      value: this.draft.colors.key,
      attr: {
        id,
        "aria-label": "키 컬러 선택",
        "data-hanmark-autofocus": "true"
      }
    });
    const hex = field.createEl("input", {
      type: "text",
      value: this.keyInput,
      attr: {
        "aria-label": "키 컬러 6자리 HEX",
        spellcheck: "false",
        inputmode: "text"
      }
    });
    hex.maxLength = 7;
    const help = field.createEl("small", {
      text: "# 뒤에 6자리 HEX를 입력하거나 색상 선택기를 드래그하세요."
    });
    const diagnostic = root.createDiv({ cls: "hanmark-pdf-theme-diagnostics" });
    const refresh = (): void => {
      const canonical = canonicalEditorialPdfHex(this.keyInput);
      const invalid = canonical === null;
      hex.setAttribute("aria-invalid", String(invalid));
      help.setText(
        invalid
          ? "키 컬러는 #RRGGBB 형식이어야 합니다."
          : `${canonical} · 선택한 색 자체는 바꾸지 않습니다.`
      );
      if (!canonical) {
        diagnostic.empty();
        diagnostic.addClass("has-warning");
        diagnostic.createEl("strong", { text: "올바른 HEX를 입력하세요." });
        return;
      }
      this.draft.colors.key = canonical;
      picker.value = canonical;
      renderDiagnostics(diagnostic, resolveEditorialPdfTheme(this.draft));
    };
    picker.oninput = () => {
      this.keyInput = picker.value.toUpperCase();
      hex.value = this.keyInput;
      refresh();
    };
    hex.oninput = () => {
      this.keyInput = hex.value;
      refresh();
    };
    refresh();
  }

  private renderNameField(root: HTMLElement): void {
    const field = root.createDiv({ cls: "hanmark-pdf-theme-text-field" });
    const id = nextControlId("builder-name");
    field.createEl("label", {
      text: "테마 이름",
      cls: "hanmark-pdf-theme-field-label",
      attr: { for: id }
    });
    const input = field.createEl("input", {
      type: "text",
      value: this.name,
      attr: { id }
    });
    input.maxLength = EDITORIAL_PDF_THEME_LIMITS.name * 2;
    input.oninput = () => {
      this.name = input.value;
      input.setAttribute("aria-invalid", String(!this.name.trim()));
    };
  }

  private renderTextStep(root: HTMLElement): void {
    const heading = root.createEl("h3", {
      text: "2단계 · 표지와 머리말 문구"
    });
    heading.tabIndex = -1;
    heading.setAttribute("data-hanmark-autofocus", "true");
    root.createEl("p", {
      text: "문구를 비우면 글자만 숨고 PDF의 안정적인 자리와 여백은 그대로 유지됩니다."
    });
    const columns = root.createDiv({ cls: "hanmark-pdf-theme-text-columns" });
    const cover = columns.createDiv();
    cover.createEl("h4", { text: "표지" });
    this.textField(cover, "상단 문구", "cover", "kicker", EDITORIAL_PDF_THEME_LIMITS.coverText);
    this.textField(cover, "에디션", "cover", "edition", EDITORIAL_PDF_THEME_LIMITS.coverText);
    this.titleModeField(cover, "표지 제목", "cover");
    this.textField(cover, "부제", "cover", "subtitle", EDITORIAL_PDF_THEME_LIMITS.coverText);
    this.textField(cover, "브랜드", "cover", "brand", EDITORIAL_PDF_THEME_LIMITS.coverText);
    this.textField(cover, "시스템", "cover", "system", EDITORIAL_PDF_THEME_LIMITS.coverText);
    this.textField(cover, "상세 문구", "cover", "detail", EDITORIAL_PDF_THEME_LIMITS.coverText);
    this.tagsField(cover);

    const page = columns.createDiv();
    page.createEl("h4", { text: "두 번째 장부터" });
    this.textField(page, "왼쪽 머리말", "page", "headerLeft", EDITORIAL_PDF_THEME_LIMITS.pageText);
    this.titleModeField(page, "오른쪽 머리말", "page");
    this.textField(page, "왼쪽 꼬리말", "page", "footerLeft", EDITORIAL_PDF_THEME_LIMITS.pageText);
    const id = nextControlId("page-number");
    const toggle = page.createEl("label", {
      cls: "hanmark-pdf-theme-toggle",
      attr: { for: id }
    });
    const checkbox = toggle.createEl("input", {
      type: "checkbox",
      attr: { id }
    });
    checkbox.checked = this.draft.page.showPageNumber;
    checkbox.onchange = () => {
      this.draft.page.showPageNumber = checkbox.checked;
    };
    toggle.createSpan({ text: "쪽번호 표시" });
  }

  private textField(
    root: HTMLElement,
    labelText: string,
    section: ThemeTextSection,
    key: string,
    maximum: number
  ): void {
    const values = this.draft[section] as unknown as Record<string, unknown>;
    const current = values[key];
    if (typeof current !== "string") return;
    const id = nextControlId(`${section}-${String(key)}`);
    const field = root.createDiv({ cls: "hanmark-pdf-theme-text-field" });
    field.createEl("label", {
      text: labelText,
      cls: "hanmark-pdf-theme-field-label",
      attr: { for: id }
    });
    const input = field.createEl("input", {
      type: "text",
      value: current,
      attr: { id }
    });
    input.maxLength = maximum * 2;
    input.oninput = () => {
      values[key] = input.value;
    };
    field.createEl("small", { text: `비워 둘 수 있음 · 최대 ${maximum}글자` });
  }

  private titleModeField(
    root: HTMLElement,
    labelText: string,
    section: "cover" | "page"
  ): void {
    const mode = section === "cover"
      ? this.draft.cover.titleMode
      : this.draft.page.headerRightMode;
    const field = root.createDiv({ cls: "hanmark-pdf-theme-text-field" });
    const id = nextControlId(`${section}-title-mode`);
    field.createEl("label", {
      text: labelText,
      cls: "hanmark-pdf-theme-field-label",
      attr: { for: id }
    });
    const select = field.createEl("select", { attr: { id } });
    select.createEl("option", { value: "file-title", text: "파일명 사용" });
    select.createEl("option", { value: "custom", text: "직접 입력" });
    select.createEl("option", { value: "blank", text: "비움" });
    select.value = mode;
    if (mode === "custom") {
      const input = field.createEl("input", {
        type: "text",
        value: section === "cover"
          ? this.draft.cover.titleText
          : this.draft.page.headerRightText,
        attr: { "aria-label": `${labelText} 직접 입력` }
      });
      input.maxLength = section === "cover"
        ? EDITORIAL_PDF_THEME_LIMITS.coverTitle * 2
        : EDITORIAL_PDF_THEME_LIMITS.pageText * 2;
      input.oninput = () => {
        if (section === "cover") this.draft.cover.titleText = input.value;
        else this.draft.page.headerRightText = input.value;
      };
    }
    select.onchange = () => {
      const next = select.value as EditorialPdfTitleMode;
      if (section === "cover") this.draft.cover.titleMode = next;
      else this.draft.page.headerRightMode = next;
      this.render();
    };
  }

  private tagsField(root: HTMLElement): void {
    const id = nextControlId("tags");
    const field = root.createDiv({ cls: "hanmark-pdf-theme-text-field" });
    field.createEl("label", {
      text: "해시태그",
      cls: "hanmark-pdf-theme-field-label",
      attr: { for: id }
    });
    const input = field.createEl("input", {
      type: "text",
      value: this.draft.cover.tags.join(", "),
      attr: { id }
    });
    input.oninput = () => {
      this.draft.cover.tags = input.value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, EDITORIAL_PDF_THEME_LIMITS.tagCount);
    };
    field.createEl("small", {
      text: `쉼표로 구분 · 최대 ${EDITORIAL_PDF_THEME_LIMITS.tagCount}개 · 모두 지울 수 있음`
    });
  }

  private renderPreviewStep(root: HTMLElement): void {
    const heading = root.createEl("h3", {
      text: "3단계 · 미리보기와 가독성 확인"
    });
    heading.tabIndex = -1;
    heading.setAttribute("data-hanmark-autofocus", "true");
    root.createEl("p", {
      text: "실제 인쇄를 열지 않는 대표 미리보기입니다. 같은 팔레트 계산기가 최종 PDF에도 사용됩니다."
    });
    const preview = root.createDiv({ cls: "hanmark-pdf-theme-preview" });
    const diagnostic = root.createDiv({ cls: "hanmark-pdf-theme-diagnostics" });
    const advanced = root.createEl("details", {
      cls: "hanmark-pdf-theme-advanced"
    });
    advanced.createEl("summary", { text: "고급 색상 3개 직접 지정" });
    advanced.createEl("p", {
      text: "자동 추천이 대부분 가장 안전합니다. 브랜드 규정상 꼭 필요할 때만 색을 직접 지정하세요. 낮은 대비도 저장되지만 경고가 계속 표시됩니다."
    });
    for (const item of OVERRIDE_LABELS) {
      this.renderOverrideField(advanced, item.token, item.label, item.description);
    }
    const refresh = (): void => {
      const resolved = resolveEditorialPdfTheme(this.draft);
      renderPreview(preview, this.draft, resolved);
      renderDiagnostics(diagnostic, resolved);
    };
    refresh();
  }

  private renderOverrideField(
    root: HTMLElement,
    token: EditorialPdfOverrideToken,
    labelText: string,
    description: string
  ): void {
    const row = root.createDiv({ cls: "hanmark-pdf-theme-override" });
    row.createEl("strong", { text: labelText });
    row.createEl("small", { text: description });
    const active = this.draft.colors.overrides[token] !== null;
    if (!active) {
      const useCustom = row.createEl("button", {
        text: "직접 지정",
        attr: { type: "button" }
      });
      useCustom.onclick = () => {
        const resolved = resolveEditorialPdfTheme(this.draft);
        const recommended = resolved.palette[token];
        this.draft.colors.overrides[token] = recommended;
        this.overrideInputs[token] = recommended;
        this.render();
      };
      return;
    }

    const id = nextControlId(`override-${token}`);
    const controls = row.createDiv({ cls: "hanmark-pdf-theme-override-controls" });
    const picker = controls.createEl("input", {
      type: "color",
      value: this.draft.colors.overrides[token] ?? "#000000",
      attr: { id, "aria-label": `${labelText} 색상 선택` }
    });
    const hex = controls.createEl("input", {
      type: "text",
      value: this.overrideInputs[token],
      attr: {
        "aria-label": `${labelText} 6자리 HEX`,
        spellcheck: "false"
      }
    });
    hex.maxLength = 7;
    const reset = controls.createEl("button", {
      text: "자동 추천 적용",
      attr: { type: "button" }
    });
    const ratio = row.createSpan({ cls: "hanmark-pdf-theme-override-ratio" });
    const refresh = (): void => {
      const canonical = canonicalEditorialPdfHex(this.overrideInputs[token]);
      hex.setAttribute("aria-invalid", String(canonical === null));
      if (!canonical) {
        ratio.setText("올바른 #RRGGBB 색상을 입력하세요.");
        ratio.addClass("has-warning");
        return;
      }
      this.draft.colors.overrides[token] = canonical;
      picker.value = canonical;
      const result = resolveEditorialPdfTheme(this.draft);
      const item = result.diagnostics.find((entry) => entry.token === token);
      ratio.setText(
        item
          ? `${item.ratio.toFixed(2)}:1 · ${item.passes ? "통과" : `대비 경고 · 목표 ${item.minimum}:1`}`
          : ""
      );
      ratio.toggleClass("has-warning", item ? !item.passes : false);
    };
    picker.oninput = () => {
      this.overrideInputs[token] = picker.value.toUpperCase();
      hex.value = this.overrideInputs[token];
      refresh();
    };
    picker.onchange = () => this.render();
    hex.oninput = () => {
      this.overrideInputs[token] = hex.value;
      refresh();
    };
    hex.onchange = () => this.render();
    reset.onclick = () => {
      this.draft.colors.overrides[token] = null;
      this.overrideInputs[token] = "";
      this.render();
    };
    refresh();
  }

  private renderFooter(root: HTMLElement): void {
    const footer = root.createDiv({ cls: "hanmark-pdf-theme-builder-footer" });
    const cancel = footer.createEl("button", {
      text: "취소",
      attr: { type: "button" }
    });
    cancel.disabled = this.saving;
    cancel.onclick = () => this.close();
    if (this.step > 0) {
      const previous = footer.createEl("button", {
        text: "이전",
        attr: { type: "button" }
      });
      previous.disabled = this.saving;
      previous.onclick = () => {
        this.step -= 1;
        this.render();
      };
    }
    if (this.step < 2) {
      const next = footer.createEl("button", {
        text: "다음",
        cls: "mod-cta",
        attr: { type: "button" }
      });
      next.disabled = this.saving || !this.validThrough(this.step);
      next.onclick = () => {
        if (next.disabled) return;
        this.step += 1;
        this.render();
      };
    } else {
      const save = footer.createEl("button", {
        text: this.saving ? "저장 중…" : "테마 저장",
        cls: "mod-cta",
        attr: { type: "button" }
      });
      save.disabled = this.saving || !this.validThrough(2);
      save.onclick = () => void this.save();
    }
  }

  private validThrough(step: number): boolean {
    if (!this.name.trim() || !canonicalEditorialPdfHex(this.keyInput)) {
      return false;
    }
    if (step < 2) return true;
    return OVERRIDE_LABELS.every(({ token }) => {
      if (this.draft.colors.overrides[token] === null) return true;
      return canonicalEditorialPdfHex(this.overrideInputs[token]) !== null;
    });
  }

  private async save(): Promise<void> {
    if (this.saving || !this.validThrough(2)) return;
    this.saving = true;
    this.render();
    try {
      for (const { token } of OVERRIDE_LABELS) {
        if (this.draft.colors.overrides[token] === null) continue;
        const canonical = canonicalEditorialPdfHex(this.overrideInputs[token]);
        if (!canonical) throw new Error("고급 색상 HEX를 확인하세요.");
        this.draft.colors.overrides[token] = canonical;
      }
      await this.options.save(
        this.name,
        normalizeEditorialPdfTheme(this.draft)
      );
      this.close();
    } catch (error) {
      this.saving = false;
      this.render();
      new Notice(`PDF 테마를 저장하지 못했습니다: ${errorMessage(error)}`);
    }
  }
}

export class EditorialPdfThemeManagerModal extends Modal {
  private selectedId: string;
  private busy = false;

  constructor(
    app: App,
    private readonly options: EditorialPdfThemeManagerOptions
  ) {
    super(app);
    this.selectedId = options.selectedId
      ?? activeEditorialPdfThemeSnapshot(options.getLibrary()).id;
  }

  onOpen(): void {
    this.modalEl.addClass("hanmark-resizable-workspace-modal");
    this.modalEl.addClass("hanmark-pdf-theme-workspace-modal");
    this.render();
    if (this.options.startInCreate) {
      this.options.startInCreate = false;
      window.setTimeout(() => this.openBuilder());
    }
  }

  onClose(): void {
    this.modalEl.removeClass("hanmark-resizable-workspace-modal");
    this.modalEl.removeClass("hanmark-pdf-theme-workspace-modal");
    this.contentEl.empty();
  }

  private render(): void {
    this.titleEl.setText("Editorial PDF 테마");
    const library = this.options.getLibrary();
    const snapshots = listEditorialPdfThemeSnapshots(library);
    if (!snapshots.some(({ id }) => id === this.selectedId)) {
      this.selectedId = activeEditorialPdfThemeSnapshot(library).id;
    }
    const active = activeEditorialPdfThemeSnapshot(library);
    const selected = snapshots.find(({ id }) => id === this.selectedId)
      ?? active;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("hanmark-pdf-theme-manager");
    contentEl.createEl("p", {
      text: "기본 테마는 수정되지 않습니다. 내 테마를 만들고 선택하면 이 Vault의 다음 PDF 내보내기에도 기억됩니다."
    });

    const list = contentEl.createDiv({
      cls: "hanmark-pdf-theme-list",
      attr: { role: "radiogroup", "aria-label": "PDF 테마 목록" }
    });
    for (const snapshot of snapshots) {
      const resolved = resolveEditorialPdfThemeSnapshot(snapshot);
      const label = list.createEl("label", {
        cls:
          `hanmark-pdf-theme-row${snapshot.id === this.selectedId ? " is-selected" : ""}`
      });
      applyPalette(label, resolved);
      const radio = label.createEl("input", { type: "radio" });
      radio.name = "hanmark-editorial-pdf-theme";
      radio.value = snapshot.id;
      radio.checked = snapshot.id === this.selectedId;
      radio.disabled = this.busy;
      radio.onchange = () => {
        if (!radio.checked) return;
        this.selectedId = snapshot.id;
        this.render();
      };
      label.createSpan({
        cls: "hanmark-pdf-theme-swatch",
        attr: { "aria-hidden": "true" }
      });
      const info = label.createSpan({ cls: "hanmark-pdf-theme-row-copy" });
      info.createEl("strong", { text: snapshot.name });
      info.createEl("small", {
        text: snapshot.builtIn
          ? "내장 · HanMark 2.5.5 원본 출력 유지"
          : resolved.warnings.length
            ? `대비 경고 ${resolved.warnings.length}개 · 직접 지정 색상 확인 필요`
            : "자동 가독성 검사 통과"
      });
      if (snapshot.id === active.id) {
        label.createSpan({ text: "사용 중", cls: "hanmark-template-active" });
      }
    }

    const selectedResolved = resolveEditorialPdfThemeSnapshot(selected);
    const status = contentEl.createDiv({
      cls:
        `hanmark-pdf-theme-manager-status${selectedResolved.warnings.length ? " has-warning" : ""}`,
      attr: { role: "status", "aria-live": "polite" }
    });
    applyPalette(status, selectedResolved);
    status.createSpan({
      cls: "hanmark-pdf-theme-swatch",
      attr: { "aria-hidden": "true" }
    });
    status.createEl("strong", { text: selected.name });
    status.createSpan({
      text: selectedResolved.warnings.length
        ? `대비 경고 ${selectedResolved.warnings.length}개`
        : selected.builtIn
          ? "기본 출력 보존"
          : "가독성 검사 통과"
    });

    this.renderSelectedActions(contentEl, selected, active.id);
    this.renderLibraryActions(contentEl);
  }

  private renderSelectedActions(
    root: HTMLElement,
    selected: EditorialPdfThemeSnapshot,
    activeId: string
  ): void {
    const actions = root.createDiv({ cls: "hanmark-pdf-theme-actions" });
    const apply = actions.createEl("button", {
      text: selected.id === activeId ? "사용 중" : "적용",
      cls: "mod-cta",
      attr: { type: "button" }
    });
    apply.disabled = this.busy || selected.id === activeId;
    apply.onclick = () => void this.applySelected(selected.id);

    const edit = actions.createEl("button", {
      text: selected.builtIn ? "복제 후 편집" : "편집",
      attr: { type: "button" }
    });
    edit.disabled = this.busy;
    edit.onclick = () => this.openBuilder(selected);

    const duplicate = actions.createEl("button", {
      text: "복제",
      attr: { type: "button" }
    });
    duplicate.disabled = this.busy;
    duplicate.onclick = () => void this.duplicateSelected(selected);

    const exportButton = actions.createEl("button", {
      text: "JSON 내보내기",
      attr: { type: "button" }
    });
    exportButton.disabled = this.busy;
    exportButton.onclick = () => void this.exportSelected(selected);

    if (!selected.builtIn) {
      const rename = actions.createEl("button", {
        text: "이름 변경",
        attr: { type: "button" }
      });
      rename.disabled = this.busy;
      rename.onclick = () => this.renameSelected(selected);
      const remove = actions.createEl("button", {
        text: "삭제",
        cls: "mod-warning",
        attr: { type: "button" }
      });
      remove.disabled = this.busy;
      remove.onclick = () => void this.deleteSelected(selected);
    }
  }

  private renderLibraryActions(root: HTMLElement): void {
    const actions = root.createDiv({ cls: "hanmark-pdf-theme-library-actions" });
    const create = actions.createEl("button", {
      text: "새 테마",
      cls: "mod-cta",
      attr: { type: "button" }
    });
    create.disabled = this.busy;
    create.onclick = () => this.openBuilder();
    const importButton = actions.createEl("button", {
      text: "JSON 가져오기",
      attr: { type: "button" }
    });
    importButton.disabled = this.busy;
    importButton.onclick = () => void this.importTheme();
    const close = actions.createEl("button", {
      text: "닫기",
      attr: { type: "button" }
    });
    close.disabled = this.busy;
    close.onclick = () => this.close();
  }

  private openBuilder(source?: EditorialPdfThemeSnapshot): void {
    const library = this.options.getLibrary();
    const isEdit = source && !source.builtIn;
    const initialName = isEdit
      ? source.name
      : availableEditorialPdfThemeName(
          library,
          source ? `${source.name} 복사본` : "새 사용자 PDF 테마"
        );
    const initialTheme = source?.theme
      ?? activeEditorialPdfThemeSnapshot(library).theme;
    new EditorialPdfThemeBuilderModal(this.app, {
      initialName,
      initialTheme,
      title: isEdit ? "PDF 테마 편집" : "새 PDF 테마",
      save: async (name, theme) => {
        let next: EditorialPdfThemeLibraryV1;
        let selectedId: string;
        if (isEdit) {
          const updated = updateEditorialPdfTheme(
            this.options.getLibrary(),
            source.id,
            theme
          );
          const renamed = renameEditorialPdfTheme(
            updated.library,
            source.id,
            name
          );
          next = renamed.library;
          selectedId = source.id;
        } else {
          const created = createEditorialPdfTheme(
            this.options.getLibrary(),
            name,
            theme
          );
          next = created.library;
          selectedId = created.record.id;
        }
        await this.persist(next);
        this.selectedId = selectedId;
        this.render();
      }
    }).open();
  }

  private async applySelected(id: string): Promise<void> {
    await this.runBusy(async () => {
      await this.persist(setActiveEditorialPdfTheme(this.options.getLibrary(), id));
      this.selectedId = id;
      new Notice("PDF 테마를 이 Vault의 기본 선택으로 적용했습니다.");
    });
  }

  private async duplicateSelected(
    selected: EditorialPdfThemeSnapshot
  ): Promise<void> {
    await this.runBusy(async () => {
      const result = duplicateEditorialPdfTheme(
        this.options.getLibrary(),
        selected.id
      );
      await this.persist(result.library);
      this.selectedId = result.record.id;
      new Notice(`PDF 테마를 복제했습니다: ${result.record.name}`);
    });
  }

  private renameSelected(selected: EditorialPdfThemeSnapshot): void {
    new PdfThemeNameModal(
      this.app,
      "PDF 테마 이름 변경",
      selected.name,
      async (name) => {
        const result = renameEditorialPdfTheme(
          this.options.getLibrary(),
          selected.id,
          name
        );
        await this.persist(result.library);
        this.selectedId = result.record.id;
        this.render();
      }
    ).open();
  }

  private async deleteSelected(
    selected: EditorialPdfThemeSnapshot
  ): Promise<void> {
    if (!(await confirmThemeDelete(this.app, selected.name))) return;
    await this.runBusy(async () => {
      const next = deleteEditorialPdfTheme(
        this.options.getLibrary(),
        selected.id
      );
      await this.persist(next);
      this.selectedId = activeEditorialPdfThemeSnapshot(next).id;
      new Notice(`PDF 테마를 삭제했습니다: ${selected.name}`);
    });
  }

  private async importTheme(): Promise<void> {
    await this.runBusy(async () => {
      const [file] = await this.options.fileGateway.pickFiles({
        title: "HanMark PDF 테마 JSON 가져오기",
        extensions: ["json"],
        maxFiles: 1,
        maxFileBytes: EDITORIAL_PDF_THEME_MAX_JSON_BYTES,
        maxTotalBytes: EDITORIAL_PDF_THEME_MAX_JSON_BYTES
      });
      if (!file) return;
      const exchange = parseEditorialPdfThemeExchange(file.bytes);
      const created = createEditorialPdfTheme(
        this.options.getLibrary(),
        exchange.name,
        exchange.theme
      );
      await this.persist(created.library);
      this.selectedId = created.record.id;
      new Notice(
        `PDF 테마를 가져왔습니다: ${created.record.name}. 적용 버튼을 누르면 사용합니다.`
      );
    });
  }

  private async exportSelected(
    selected: EditorialPdfThemeSnapshot
  ): Promise<void> {
    await this.runBusy(async () => {
      const json = stringifyEditorialPdfThemeExchange(
        selected.name,
        selected.theme
      );
      const result = await this.options.fileGateway.saveFile(
        new TextEncoder().encode(json),
        safeThemeFilename(selected)
      );
      if (!result.cancelled) {
        new Notice(`PDF 테마를 내보냈습니다: ${result.fileName}`);
      }
    });
  }

  private async persist(library: EditorialPdfThemeLibraryV1): Promise<void> {
    await this.options.replaceLibrary(library);
    this.options.onChanged?.();
  }

  private async runBusy(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await action();
    } catch (error) {
      new Notice(`PDF 테마 작업을 완료하지 못했습니다: ${errorMessage(error)}`);
    } finally {
      this.busy = false;
      if (this.contentEl.isConnected) this.render();
    }
  }
}

export function activeEditorialPdfThemeSummary(
  library: EditorialPdfThemeLibraryV1
): string {
  const snapshot = activeEditorialPdfThemeSnapshot(library);
  const resolved = resolveEditorialPdfThemeSnapshot(snapshot);
  if (snapshot.id === BUILTIN_EDITORIAL_PDF_THEME_ID) {
    return `${snapshot.name} · 기본 출력 보존`;
  }
  return resolved.warnings.length
    ? `${snapshot.name} · 대비 경고 ${resolved.warnings.length}개`
    : `${snapshot.name} · 가독성 검사 통과`;
}
