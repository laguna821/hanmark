import { type App, Modal, Notice } from "obsidian";
import { VERSION, type GongmunPreset } from "kordoc";
import {
  type HanmarkExportFormat,
  type HanmarkExportOutcome,
  type HwpxExportVariant
} from "../io/exportTypes";
import {
  editorialPdfContrastStatus,
  resolveEditorialPdfThemeSnapshot,
  type EditorialPdfThemeSnapshot
} from "../io/editorialPdfTheme";
import type { HtmlExportTheme } from "../legacy-port/settings";
import { errorMessage } from "../utils/errors";

type HanmarkExportActionResult =
  | HanmarkExportOutcome
  | boolean
  | null
  | void;

export interface HanmarkExportActions {
  activeTemplateId: () => string;
  templateChoices: () => Array<{ id: string; name: string }>;
  activeTemplateSummary: () => string;
  selectTemplate: (id: string) => Promise<void>;
  /**
   * Retained for source compatibility. Template management now lives in its
   * own toolbar command and is deliberately not shown inside this modal.
   */
  openTemplateManager?: () => void;
  exportKordoc: (
    mode: "quick-hwpx" | "gongmun-hwpx",
    preset?: GongmunPreset
  ) => Promise<HanmarkExportActionResult>;
  runOther: (
    mode: "docx" | "html"
  ) => Promise<HanmarkExportActionResult>;
  openPreview: () => Promise<void>;
  openDocxPreview?: () => Promise<void>;
  activeWordTemplateName?: () => string;
  openPandocSettings?: () => void;
  activeHtmlTheme?: () => HtmlExportTheme;
  setHtmlTheme?: (theme: HtmlExportTheme) => Promise<void>;
  exportPdf?: () => Promise<HanmarkExportActionResult>;
  pdfThemeChoices?: () => EditorialPdfThemeSnapshot[];
  activePdfTheme?: () => EditorialPdfThemeSnapshot;
  selectPdfTheme?: (id: string) => Promise<void>;
  openPdfThemeManager?: (mode: "manage" | "create") => void;
  revealOutput?: (
    result: HanmarkExportOutcome
  ) => Promise<void>;
  /**
   * The host may reuse applyToolbarSkin() here. It places the validated light
   * and dark palette variables on this modal without coupling the modal to
   * plugin settings.
   */
  applySkin?: (root: HTMLElement) => void;
}

interface FormatCard {
  id: HanmarkExportFormat;
  title: string;
  description: string;
}

const FORMAT_CARDS: readonly FormatCard[] = [
  {
    id: "hwpx",
    title: "HWPX",
    description: "편집 가능한 한글 문서로 내보냅니다."
  },
  {
    id: "docx",
    title: "DOCX",
    description: "Word 문서로 내보냅니다. Pandoc이 필요합니다."
  },
  {
    id: "html",
    title: "HTML",
    description: "모바일 브라우저에 적합한 HTML로 내보냅니다."
  },
  {
    id: "pdf",
    title: "PDF",
    description: "52/48 전면 표지와 브랜드 머리말을 갖춘 Editorial PDF로 인쇄합니다."
  }
];

const PRESETS: Array<{ value: GongmunPreset; label: string }> = [
  { value: "official", label: "기안문·시행문" },
  { value: "report", label: "보고서" },
  { value: "plan", label: "계획서" },
  { value: "notice", label: "통지·안내" },
  { value: "minutes", label: "회의록" },
  { value: "gaejosik", label: "정부 표준 개조식" },
  { value: "press", label: "보도자료" }
];

type LegacyExportSelection = HanmarkExportFormat | "other";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string>
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

function addSvgPath(
  svg: SVGSVGElement,
  fill: string,
  path: string
): void {
  svg.appendChild(svgElement("path", { fill, d: path }));
}

/**
 * Uses the same path data and palette roles as the toolbar HWP and Word logos.
 * Building the SVG DOM explicitly avoids unsafe HTML string insertion.
 */
function createOfficeIcon(format: HanmarkExportFormat): HTMLElement {
  const wrapper = createSpan({
    cls: `hanmark-export-format-icon is-${format}`
  });
  wrapper.setAttribute("aria-hidden", "true");
  const svg = svgElement("svg", {
    viewBox: format === "hwpx" ? "0 0 256 256" : "0 0 48 48",
    "aria-hidden": "true",
    focusable: "false"
  });
  wrapper.appendChild(svg);

  if (format === "hwpx") {
    addSvgPath(svg, "var(--hanmark-export-logo-accent)", "M128 248h98c12 0 22-10 22-22v-38H128z");
    addSvgPath(svg, "var(--hanmark-export-logo-accent)", "M128 188h120v-60H128z");
    addSvgPath(svg, "var(--hanmark-export-logo-body)", "M128 128h120V68H128z");
    addSvgPath(svg, "var(--hanmark-export-logo-muted)", "M128 68h120V30c0-12-10-22-22-22h-98z");
    addSvgPath(
      svg,
      "var(--hanmark-export-logo-body)",
      "M39 8h89v240H39C18 248 8 238 8 217V39C8 18 18 8 39 8z"
    );
    addSvgPath(
      svg,
      "var(--hanmark-export-logo-text)",
      "M104 57H75V43H62v14H32v12h15c-5 4-8 10-8 17 0 15 12 27 29 27s29-12 29-27c0-7-3-13-8-17h15zm-36 44c-9 0-16-7-16-16s7-16 16-16 16 7 16 16-7 16-16 16z"
    );
    return wrapper;
  }

  if (format === "docx") {
    addSvgPath(svg, "var(--hanmark-export-logo-muted)", "M9 34l15-19 17 11v13c0 2-2 4-4 4H15c-3 0-6-3-6-6z");
    addSvgPath(svg, "var(--hanmark-export-logo-accent)", "M9 20c0-3 2-5 5-5h22l5-2v13c0 2-2 4-4 4H15c-3 0-6 3-6 6z");
    addSvgPath(svg, "var(--hanmark-export-logo-accent)", "M9 10c0-3 3-6 6-6h22c2 0 4 2 4 4v5c0 2-2 4-4 4H15c-3 0-6 3-6 6z");
    addSvgPath(svg, "var(--hanmark-export-logo-body)", "M8 23h10c2 0 3 2 3 4v10c0 2-1 3-3 3H8c-2 0-4-1-4-3V27c0-2 2-4 4-4z");
    addSvgPath(svg, "var(--hanmark-export-logo-text)", "M18 27l-2 9h-2l-2-5-1 5H9l-2-9h2l1 6 1-6h3l1 6 1-6z");
    return wrapper;
  }

  svg.setAttribute("viewBox", "0 0 48 48");
  svg.addClass("is-generic");
  addSvgPath(
    svg,
    "none",
    "M12 4h17l8 8v32H12z"
  );
  const outline = svg.lastElementChild as SVGPathElement | null;
  outline?.setAttribute("stroke", "currentColor");
  outline?.setAttribute("stroke-width", "3");
  outline?.setAttribute("stroke-linejoin", "round");
  addSvgPath(svg, "currentColor", "M28 5v9h9z");

  if (format === "html") {
    const code = svgElement("path", {
      d: "m21 21-6 6 6 6m7-12 6 6-6 6",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round"
    });
    svg.appendChild(code);
  } else {
    const label = svgElement("text", {
      x: "24",
      y: "33",
      "text-anchor": "middle",
      fill: "currentColor",
      "font-size": "10",
      "font-weight": "700",
      "font-family": "sans-serif"
    });
    label.textContent = "PDF";
    svg.appendChild(label);
  }
  return wrapper;
}

function isPresentationResult(
  value: HanmarkExportActionResult
): value is HanmarkExportOutcome {
  if (!value || typeof value !== "object") return false;
  return (
    (value.status === "saved" ||
      value.status === "delegated" ||
      value.status === "cancelled") &&
    (value.format === "hwpx" ||
      value.format === "docx" ||
      value.format === "html" ||
      value.format === "pdf")
  );
}

function initialFormat(
  selection: LegacyExportSelection
): HanmarkExportFormat {
  // The former "기타 형식" entry opened with DOCX first.
  return selection === "other" ? "docx" : selection;
}

export class HanmarkExportModal extends Modal {
  private format: HanmarkExportFormat;
  private hwpxVariant: HwpxExportVariant = "quick";
  private gongmunPreset: GongmunPreset = "report";
  private result: HanmarkExportOutcome | null = null;
  private busy = false;

  constructor(
    app: App,
    private readonly actions: HanmarkExportActions,
    initialSelection: LegacyExportSelection = "hwpx"
  ) {
    super(app);
    this.format = initialFormat(initialSelection);
  }

  onOpen(): void {
    this.modalEl.addClass("hanmark-resizable-workspace-modal");
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("hanmark-export-modal");
    this.actions.applySkin?.(contentEl);

    const header = contentEl.createDiv({ cls: "hanmark-export-header" });
    const heading = header.createDiv();
    heading.createEl("h2", { text: "HanMark 내보내기" });
    heading.createEl("p", {
      text: "원하는 형식을 고른 다음 세부 옵션을 확인하세요."
    });
    header.createEl("small", {
      cls: "hanmark-window-size-hint",
      text: "창 우하단을 드래그하면 크기를 조절할 수 있습니다."
    });

    this.renderFormatGrid(contentEl);

    const detail = contentEl.createDiv({
      cls: "hanmark-export-detail",
      attr: {
        "aria-live": "polite"
      }
    });
    if (this.format === "hwpx") this.renderHwpxDetail(detail);
    if (this.format === "docx") this.renderDocxDetail(detail);
    if (this.format === "html") this.renderHtmlDetail(detail);
    if (this.format === "pdf") this.renderPdfDetail(detail);

    if (this.result) {
      this.renderResult(contentEl, this.result);
    } else {
      this.renderFooter(contentEl);
    }
  }

  private renderFormatGrid(root: HTMLElement): void {
    const grid = root.createDiv({
      cls: "hanmark-export-format-grid",
      attr: {
        role: "group",
        "aria-label": "내보낼 파일 형식"
      }
    });

    for (const card of FORMAT_CARDS) {
      const selected = this.format === card.id;
      const descriptionId = `hanmark-export-${card.id}-description`;
      const button = grid.createEl("button", {
        cls: `hanmark-export-format-card${selected ? " is-selected" : ""}`,
        attr: {
          type: "button",
          "aria-pressed": String(selected),
          "aria-describedby": descriptionId
        }
      });
      button.disabled = this.busy;
      button.appendChild(createOfficeIcon(card.id));
      const copy = button.createSpan({ cls: "hanmark-export-format-copy" });
      copy.createEl("strong", { text: card.title });
      copy.createEl("small", {
        text: card.description,
        attr: { id: descriptionId }
      });
      button.onclick = () => {
        if (this.busy || this.format === card.id) return;
        this.format = card.id;
        this.result = null;
        this.render();
      };
    }
  }

  private renderHwpxDetail(root: HTMLElement): void {
    root.createEl("h3", { text: "HWPX 옵션" });
    root.createEl("p", {
      cls: "hanmark-compact-engine-line",
      text: `Kordoc ${String(VERSION || "4.2.5")} · 외부 설치 없음 · 원격·Vault 이미지 포함`
    });

    const template = root.createDiv({ cls: "hanmark-export-template-row" });
    const templateLabel = template.createEl("label", {
      text: "문서 템플릿",
      attr: { for: "hanmark-export-template-select" }
    });
    templateLabel.addClass("hanmark-export-field-label");
    const select = template.createEl("select", {
      attr: { id: "hanmark-export-template-select" }
    });
    for (const item of this.actions.templateChoices()) {
      select.createEl("option", { value: item.id, text: item.name });
    }
    select.value = this.actions.activeTemplateId();
    select.disabled = this.busy;
    select.onchange = async () => {
      await this.actions.selectTemplate(select.value);
      this.render();
    };
    template.createEl("small", {
      text: this.actions.activeTemplateSummary()
    });

    const variants = root.createDiv({
      cls: "hanmark-export-variant-grid",
      attr: {
        role: "group",
        "aria-label": "HWPX 생성 방식"
      }
    });
    this.variantButton(
      variants,
      "quick",
      "빠른 HWPX",
      "현재 템플릿으로 일반 문서를 만듭니다."
    );
    this.variantButton(
      variants,
      "gongmun",
      "공문서 HWPX",
      "보고서·계획서 등 공문서 프리셋을 적용합니다."
    );
    if (this.hwpxVariant === "gongmun") {
      const gongmun = root.createDiv({ cls: "hanmark-export-option-row" });
      const label = gongmun.createEl("label", {
        text: "공문서 종류",
        attr: { for: "hanmark-export-gongmun-preset" }
      });
      label.addClass("hanmark-export-field-label");
      const preset = gongmun.createEl("select", {
        attr: { id: "hanmark-export-gongmun-preset" }
      });
      for (const item of PRESETS) {
        preset.createEl("option", { value: item.value, text: item.label });
      }
      preset.value = this.gongmunPreset;
      preset.disabled = this.busy;
      preset.onchange = () => {
        this.gongmunPreset = preset.value as GongmunPreset;
      };
    }

    const previewDescriptionId =
      "hanmark-export-hwpx-preview-description";
    const previewRow = root.createDiv({
      cls: "hanmark-export-preview-row"
    });
    const previewCopy = previewRow.createDiv({
      cls: "hanmark-export-preview-copy"
    });
    previewCopy.createEl("strong", { text: "내보내기 전에 확인" });
    previewCopy.createEl("small", {
      text: "현재 템플릿과 문서 내용을 빠른 미리보기로 확인합니다.",
      attr: { id: previewDescriptionId }
    });
    const preview = previewRow.createEl("button", {
      text: "빠른 HWPX 미리보기",
      cls: "hanmark-export-secondary-action",
      attr: {
        type: "button",
        "aria-describedby": previewDescriptionId
      }
    });
    preview.disabled = this.busy;
    preview.onclick = async () => {
      await this.actions.openPreview();
      this.close();
    };
  }

  private variantButton(
    root: HTMLElement,
    id: HwpxExportVariant,
    title: string,
    description: string,
    disabled = false
  ): void {
    const selected = this.hwpxVariant === id;
    const descriptionId = `hanmark-export-${id}-description`;
    const button = root.createEl("button", {
      cls: `hanmark-export-variant${selected ? " is-selected" : ""}`,
      attr: {
        type: "button",
        "aria-pressed": String(selected),
        "aria-describedby": descriptionId
      }
    });
    button.createEl("strong", { text: title });
    button.createEl("small", {
      text: description,
      attr: { id: descriptionId }
    });
    button.disabled = this.busy || disabled;
    if (disabled) {
      button.setAttribute(
        "aria-label",
        `${title}: HWP 또는 HWPX에서 가져온 노트에서만 사용할 수 있습니다`
      );
    }
    button.onclick = () => {
      this.hwpxVariant = id;
      this.result = null;
      this.render();
    };
  }

  private renderDocxDetail(root: HTMLElement): void {
    root.createEl("h3", { text: "DOCX 옵션" });
    const templateName =
      this.actions.activeWordTemplateName?.() || "현재 Word 템플릿";
    const summary = root.createDiv({ cls: "hanmark-export-summary-card" });
    summary.createSpan({ text: "적용할 Word 템플릿" });
    summary.createEl("strong", { text: templateName });
    summary.createEl("small", {
      text: "고급 DOCX 내보내기는 Pandoc을 사용합니다. Pandoc 경로는 HanMark 설정에서 변경할 수 있습니다."
    });

    const actions = root.createDiv({
      cls: "hanmark-export-secondary-actions"
    });
    if (this.actions.openDocxPreview) {
      const preview = actions.createEl("button", {
        text: "DOCX 미리보기",
        attr: { type: "button" }
      });
      preview.disabled = this.busy;
      preview.onclick = async () => {
        await this.actions.openDocxPreview?.();
        this.close();
      };
    }
    if (this.actions.openPandocSettings) {
      const settings = actions.createEl("button", {
        text: "Pandoc 설정",
        attr: { type: "button" }
      });
      settings.disabled = this.busy;
      settings.onclick = () => {
        this.close();
        this.actions.openPandocSettings?.();
      };
    }
  }

  private renderHtmlDetail(root: HTMLElement): void {
    root.createEl("h3", { text: "HTML 내보내기" });
    root.createEl("p", {
      text: "현재 문서를 이미지가 포함된 독립형 HTML 파일로 저장합니다. 설치가 필요 없고 모바일 브라우저에서 읽기 좋습니다."
    });
    if (this.actions.activeHtmlTheme && this.actions.setHtmlTheme) {
      const option = root.createDiv({ cls: "hanmark-export-option-row" });
      const label = option.createEl("label", {
        text: "HTML 테마",
        attr: { for: "hanmark-export-html-theme" }
      });
      label.addClass("hanmark-export-field-label");
      const select = option.createEl("select", {
        attr: { id: "hanmark-export-html-theme" }
      });
      select.createEl("option", {
        value: "achmage-editorial",
        text: "Achmage Editorial (권장)"
      });
      select.createEl("option", {
        value: "classic",
        text: "Classic (기존 스타일)"
      });
      select.value = this.actions.activeHtmlTheme();
      select.disabled = this.busy;
      select.onchange = async () => {
        const theme: HtmlExportTheme =
          select.value === "classic" ? "classic" : "achmage-editorial";
        try {
          await this.actions.setHtmlTheme?.(theme);
        } catch (error: unknown) {
          select.value = this.actions.activeHtmlTheme?.() ?? "achmage-editorial";
          new Notice(
            errorMessage(error, "HTML 테마 설정을 저장하지 못했습니다.")
          );
        }
      };
      option.createEl("small", {
        text: "Achmage Editorial은 화면·모바일·인쇄에 맞춘 기본 테마이며, Classic은 이전 HanMark HTML 모양을 유지합니다."
      });
    }
  }

  private renderPdfDetail(root: HTMLElement): void {
    root.createEl("h3", { text: "Achmage Editorial PDF" });
    root.createEl("p", {
      text: "A4 첫 장은 여백 없는 52/48 HanMark Editorial 표지로 구성하고, 2쪽부터 브랜드 머리말·청록 실선·푸터·페이지 번호와 함께 본문을 자동 배치합니다."
    });
    root.createEl("small", {
      cls: "hanmark-export-native-note",
      text: "원문은 변경하지 않으며 이미지와 Pretendard 글꼴을 준비한 뒤 운영체제의 PDF 저장 인쇄 창을 엽니다."
    });

    const active = this.actions.activePdfTheme?.();
    const choices = this.actions.pdfThemeChoices?.() ?? [];
    if (!active || !choices.length || !this.actions.selectPdfTheme) return;

    const resolved = resolveEditorialPdfThemeSnapshot(active);
    const theme = root.createDiv({ cls: "hanmark-export-pdf-theme" });
    const row = theme.createDiv({ cls: "hanmark-export-option-row" });
    const statusId = "hanmark-export-pdf-theme-status";
    row.createEl("label", {
      text: "PDF 테마",
      cls: "hanmark-export-field-label",
      attr: {
        for: "hanmark-export-pdf-theme-select",
        "aria-describedby": statusId
      }
    });
    const select = row.createEl("select", {
      attr: {
        id: "hanmark-export-pdf-theme-select",
        "aria-describedby": statusId
      }
    });
    for (const snapshot of choices) {
      select.createEl("option", {
        value: snapshot.id,
        text: snapshot.name
      });
    }
    select.value = active.id;
    select.disabled = this.busy;
    select.onchange = async () => {
      const previousId = active.id;
      select.disabled = true;
      try {
        await this.actions.selectPdfTheme?.(select.value);
        this.render();
      } catch (error) {
        select.value = previousId;
        select.disabled = this.busy;
        new Notice(
          `PDF 테마 선택을 저장하지 못했습니다: ${errorMessage(error)}`
        );
      }
    };

    const status = theme.createDiv({
      cls:
        `hanmark-export-pdf-theme-status${resolved.warnings.length ? " has-warning" : ""}`,
      attr: {
        id: statusId,
        role: "status",
        "aria-live": "polite"
      }
    });
    status.style.setProperty(
      "--hanmark-pdf-theme-swatch-color",
      resolved.palette.keySurface
    );
    status.createSpan({
      cls: "hanmark-export-pdf-theme-swatch",
      attr: { "aria-hidden": "true" }
    });
    status.createEl("strong", { text: active.name });
    status.createSpan({
      text: active.builtIn
        ? "HanMark 2.5.5 기본 출력 보존"
        : editorialPdfContrastStatus(resolved)
    });
    const actions = theme.createDiv({
      cls: "hanmark-export-secondary-actions"
    });
    const create = actions.createEl("button", {
      text: "새 테마",
      attr: { type: "button" }
    });
    create.disabled = this.busy;
    create.onclick = () => {
      this.close();
      this.actions.openPdfThemeManager?.("create");
    };
    const manage = actions.createEl("button", {
      text: "편집·관리",
      attr: { type: "button" }
    });
    manage.disabled = this.busy;
    manage.onclick = () => {
      this.close();
      this.actions.openPdfThemeManager?.("manage");
    };
  }

  private renderResult(
    root: HTMLElement,
    result: HanmarkExportOutcome
  ): void {
    const panel = root.createDiv({
      cls: "hanmark-export-result",
      attr: {
        role: "status",
        "aria-live": "polite"
      }
    });
    panel.createEl("strong", { text: "내보내기를 마쳤습니다." });
    if (result.displayPath || result.fileName) {
      panel.createEl("code", {
        text: result.displayPath || result.fileName || ""
      });
    }
    if (result.warnings?.length) {
      const warnings = panel.createEl("ul");
      for (const warning of result.warnings) {
        warnings.createEl("li", { text: warning });
      }
    }
    const actions = panel.createDiv({ cls: "hanmark-export-result-actions" });
    if (
      result.status === "saved" &&
      result.vaultPath &&
      this.actions.revealOutput
    ) {
      const reveal = actions.createEl("button", {
        text: "파일 위치 보기",
        attr: { type: "button" }
      });
      reveal.onclick = async () => {
        reveal.disabled = true;
        try {
          await this.actions.revealOutput?.(result);
        } catch (error: unknown) {
          new Notice(errorMessage(error, "파일 위치를 열지 못했습니다."));
        } finally {
          if (reveal.isConnected) reveal.disabled = false;
        }
      };
    }
    const again = actions.createEl("button", {
      text: "같은 형식 다시 내보내기",
      attr: { type: "button" }
    });
    again.onclick = () => {
      this.result = null;
      this.render();
    };
    const close = actions.createEl("button", {
      text: "닫기",
      attr: { type: "button" }
    });
    close.onclick = () => this.close();
  }

  private renderFooter(root: HTMLElement): void {
    const footer = root.createDiv({ cls: "hanmark-export-footer" });
    const execute = footer.createEl("button", {
      text: this.busy ? "처리 중…" : this.primaryActionLabel(),
      cls: "mod-cta hanmark-export-primary-button",
      attr: { type: "button" }
    });
    execute.disabled =
      this.busy ||
      (this.format === "pdf" && !this.actions.exportPdf);
    execute.onclick = () => void this.run();

    const close = footer.createEl("button", {
      text: "닫기",
      cls: "hanmark-modal-close",
      attr: { type: "button" }
    });
    close.disabled = this.busy;
    close.onclick = () => this.close();
  }

  private primaryActionLabel(): string {
    if (this.format === "docx") return "DOCX 내보내기";
    if (this.format === "html") return "HTML 내보내기";
    if (this.format === "pdf") return "Editorial PDF 인쇄";
    if (this.hwpxVariant === "gongmun") return "공문서 HWPX 내보내기";
    return "HWPX 내보내기";
  }

  private async executeSelected(): Promise<HanmarkExportActionResult> {
    if (this.format === "docx") {
      return this.actions.runOther("docx");
    }
    if (this.format === "html") {
      return this.actions.runOther("html");
    }
    if (this.format === "pdf") {
      // Let the system print dialog own focus instead of opening behind the
      // resizable HanMark workspace modal.
      super.close();
      return this.actions.exportPdf?.();
    }
    if (this.hwpxVariant === "gongmun") {
      return this.actions.exportKordoc(
        "gongmun-hwpx",
        this.gongmunPreset
      );
    }
    return this.actions.exportKordoc("quick-hwpx");
  }

  private async run(): Promise<void> {
    this.busy = true;
    this.render();
    try {
      const result = await this.executeSelected();
      if (isPresentationResult(result)) {
        if (result.status === "delegated") {
          super.close();
          return;
        }
        this.result = result.status === "saved" ? result : null;
        this.busy = false;
        this.render();
        this.contentEl
          .querySelector<HTMLButtonElement>(".hanmark-export-result button")
          ?.focus();
        return;
      }
      // Preserve 2.4.3 action behavior until callers return structured results.
      if (result !== false && result !== null) super.close();
    } catch (error: unknown) {
      new Notice(errorMessage(error, "내보내기에 실패했습니다."));
    } finally {
      this.busy = false;
      if (this.contentEl.isConnected && !this.result) {
        this.render();
        this.contentEl
          .querySelector<HTMLButtonElement>(".hanmark-export-primary-button")
          ?.focus();
      }
    }
  }

  close(): void {
    if (this.busy) return;
    super.close();
  }

  onClose(): void {
    this.modalEl.removeClass("hanmark-resizable-workspace-modal");
    this.contentEl.empty();
  }
}
