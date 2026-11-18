import { type App, Modal, Notice } from "obsidian";
import { VERSION, type GongmunPreset } from "kordoc";
import {
  type HanmarkExportFormat,
  type HanmarkExportOutcome,
  type HwpxExportVariant
} from "../io/exportTypes";
import {
  editorialPdfContrastStatus,
  editorialPdfThemeDisplayName,
  resolveEditorialPdfThemeSnapshot,
  type EditorialPdfThemeSnapshot
} from "../io/editorialPdfTheme";
import type { HtmlExportTheme } from "../legacy-port/settings";
import { errorMessage } from "../utils/errors";
import type { PreparedPdf } from "../io/pdfOutputAdapter";
import { normalizeEditorialPdfLayout, editorialPdfLayoutChoices, editorialPdfTableWidthChoices, type EditorialPdfLayout } from "../io/editorialPdfLayout";
import { gongmunPresetLabel, type GongmunFormOption } from "../io/gongmunExport";
import { gongmunLookByName, gongmunLookName } from "../io/gongmunForms";
import { renderGongmunFormPicker, type GongmunPickerHost } from "./gongmunFormPicker";
import { GONGMUN_LOOK_PROPERTY_KEY, GONGMUN_PRESET_PROPERTY_KEY } from "../io/gongmunProperties";
import { templateDisplayName } from "../io/templateLibrary";
import { exportSwitchesFor, type ExportSwitchFormat, type ExportSwitchId } from "../io/exportSwitches";
import { t, tKey, type MessageKey } from "../i18n";
import { setPhase } from "./motion";

type HanmarkExportActionResult =
  | HanmarkExportOutcome
  | PreparedPdf
  | boolean
  | null
  | void;

export interface HanmarkExportActions {
  /** "내보낼 때" switches (R-037): the stored value, and storing a new one. */
  exportSwitch?: (id: ExportSwitchId) => boolean;
  setExportSwitch?: (id: ExportSwitchId, value: boolean) => Promise<void>;
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
    preset?: GongmunPreset,
    formId?: string
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
  exportPdf?: (layout?: EditorialPdfLayout, nativePrint?: boolean) => Promise<HanmarkExportActionResult>;
  savePdf?: (prepared: PreparedPdf) => Promise<HanmarkExportOutcome>;
  activePdfLayout?: () => EditorialPdfLayout;
  pdfThemeChoices?: () => EditorialPdfThemeSnapshot[];
  activePdfTheme?: () => EditorialPdfThemeSnapshot;
  selectPdfTheme?: (id: string) => Promise<void>;
  openPdfThemeManager?: (mode: "manage" | "create") => void;
  revealOutput?: (
    result: HanmarkExportOutcome
  ) => Promise<void>;
  /**
   * Official-document forms (R-026): built-in institution forms, the eight standard
   * types, and the user's own in one list. A form decides both the type and the look.
   */
  gongmunForms?: () => GongmunFormOption[];
  /** Frame and look picker (R-030): the library the forms come from and the favorites toggle. */
  gongmunPicker?: () => GongmunPickerHost;
  /** A form by id, including frame-and-look pairs the short list does not show. */
  describeGongmunForm?: (id: string) => GongmunFormOption | undefined;
  /** The look the note names in 공문_기관서식, as written. */
  noteLookHint?: () => string | undefined;
  /** The form to start with: the active institution form, else the note's type, else the last type. */
  currentGongmunForm?: () => string;
  /** Makes a form active and returns its document type. */
  selectGongmunForm?: (id: string) => Promise<GongmunPreset>;
  /** Opens the form editor; `null` creates a form of `preset`. `changed` gets the saved id ("" after a delete). */
  editGongmunForm?: (id: string | null, preset: GongmunPreset, changed: (id: string) => void) => void;
  /** The document type the note asks for through its properties. */
  notePresetHint?: () => GongmunPreset | undefined;
  insertGongmunProperties?: (preset: GongmunPreset) => Promise<void>;
  lintGongmun?: (preset: GongmunPreset) => void;
  /** Opens the HWPX preview on the chosen form (`formId`) of `preset`. */
  openGongmunPreview?: (preset: GongmunPreset, formId?: string) => Promise<void>;
  /** Several forms at once (R-028). */
  openGongmunBatch?: () => void;
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
  description: MessageKey;
}

const FORMAT_CARDS: readonly FormatCard[] = [
  {
    id: "hwpx",
    title: "HWPX",
    description: "export.card.hwpx"
  },
  {
    id: "docx",
    title: "DOCX",
    description: "export.card.docx"
  },
  {
    id: "html",
    title: "HTML",
    description: "export.card.html"
  },
  {
    id: "pdf",
    title: "PDF",
    description: "export.card.pdf"
  }
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
  // The former "other formats" entry opened with DOCX first.
  return selection === "other" ? "docx" : selection;
}

export class HanmarkExportModal extends Modal {
  private format: HanmarkExportFormat;
  private hwpxVariant: HwpxExportVariant;
  private gongmunPreset: GongmunPreset;
  /** Id of the chosen official-document form (R-026). */
  private gongmunForm: string;
  /** The form was chosen from the note's 공문_종류 property. */
  private presetFromNote: boolean;
  private result: HanmarkExportOutcome | null = null;
  private busy = false;
  private preparedPdf: PreparedPdf | null = null;
  private nativePdfPrint = false;
  private pdfLayout: EditorialPdfLayout;

  constructor(
    app: App,
    private readonly actions: HanmarkExportActions,
    initialSelection: LegacyExportSelection = "hwpx",
    initialVariant: HwpxExportVariant = "quick"
  ) {
    super(app);
    this.format = initialFormat(initialSelection);
    this.hwpxVariant = initialVariant;
    const hint = actions.notePresetHint?.();
    this.gongmunForm = actions.currentGongmunForm?.() ?? "";
    const form = this.describeForm(this.gongmunForm);
    this.gongmunPreset = form?.preset ?? hint ?? "report";
    this.presetFromNote = form !== undefined && !form.fixed && hint !== undefined && form.preset === hint;
    this.pdfLayout = normalizeEditorialPdfLayout(actions.activePdfLayout?.());
  }

  private describeForm(id: string): GongmunFormOption | undefined {
    return this.actions.describeGongmunForm?.(id) ?? this.actions.gongmunForms?.().find((item) => item.id === id);
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
    heading.createEl("h2", { text: t("export.title") });
    heading.createEl("p", {
      text: t("export.subtitle")
    });
    header.createEl("small", {
      cls: "hanmark-window-size-hint",
      text: t("export.resizeHint")
    });

    if (this.preparedPdf) {
      contentEl.createEl("p", { text: t("export.pdfReady") });
      contentEl.createEl("code", { text: this.preparedPdf.fileName });
      this.renderFooter(contentEl);
      return;
    }
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
        "aria-label": t("export.formatGroup")
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
        text: tKey(card.description),
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
    root.createEl("h3", { text: t("export.hwpx.heading") });
    root.createEl("p", {
      cls: "hanmark-compact-engine-line",
      text: t("export.hwpx.engine", { version: String(VERSION) })
    });

    const variants = root.createDiv({
      cls: "hanmark-export-variant-grid",
      attr: {
        role: "group",
        "aria-label": t("export.hwpx.variantGroup")
      }
    });
    this.variantButton(
      variants,
      "quick",
      t("export.hwpx.quick.title"),
      t("export.hwpx.quick.desc")
    );
    this.variantButton(
      variants,
      "gongmun",
      t("export.hwpx.gongmun.title"),
      t("export.hwpx.gongmun.desc")
    );

    if (this.hwpxVariant === "gongmun") {
      this.renderGongmunOptions(root);
      this.renderExportSwitches(root, "hwpx");
      return;
    }

    // The document template shapes quick HWPX only; official documents take their
    // look from the institution style instead (2.7.0 W5).
    const template = root.createDiv({ cls: "hanmark-export-template-row" });
    const templateLabel = template.createEl("label", {
      text: t("export.hwpx.template"),
      attr: { for: "hanmark-export-template-select" }
    });
    templateLabel.addClass("hanmark-export-field-label");
    const select = template.createEl("select", {
      attr: { id: "hanmark-export-template-select" }
    });
    for (const item of this.actions.templateChoices()) {
      select.createEl("option", { value: item.id, text: templateDisplayName(item) });
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

    const previewDescriptionId =
      "hanmark-export-hwpx-preview-description";
    const previewRow = root.createDiv({
      cls: "hanmark-export-preview-row"
    });
    const previewCopy = previewRow.createDiv({
      cls: "hanmark-export-preview-copy"
    });
    previewCopy.createEl("strong", { text: t("export.hwpx.previewTitle") });
    previewCopy.createEl("small", {
      text: t("export.hwpx.previewDesc"),
      attr: { id: previewDescriptionId }
    });
    const preview = previewRow.createEl("button", {
      text: t("preview.quick.title"),
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
    this.renderExportSwitches(root, "hwpx");
  }

  /**
   * One "내보낼 때" group per format (R-037). Each box is a stored setting, so the
   * quick commands, the previews and several-forms-at-once follow the same choice.
   */
  private renderExportSwitches(root: HTMLElement, format: ExportSwitchFormat): void {
    const read = this.actions.exportSwitch;
    const write = this.actions.setExportSwitch;
    if (!read || !write) return;
    const switches = exportSwitchesFor(format);
    if (!switches.length) return;
    const group = root.createEl("fieldset", {
      cls: "hanmark-export-switches",
      attr: { "data-hanmark-export-switches": format }
    });
    group.createEl("legend", { text: t("export.switch.heading") });
    for (const item of switches) {
      const id = `hanmark-export-switch-${format}-${item.id}`;
      const row = group.createDiv({ cls: "hanmark-export-switch" });
      const box = row.createEl("input", {
        attr: { type: "checkbox", id, "data-hanmark-export-switch": item.id, "aria-describedby": `${id}-desc` }
      });
      box.checked = read(item.id);
      box.disabled = this.busy;
      const copy = row.createDiv({ cls: "hanmark-export-switch-copy" });
      copy.createEl("label", { text: tKey(item.name), attr: { for: id } });
      copy.createEl("small", { text: tKey(item.desc), attr: { id: `${id}-desc` } });
      box.onchange = async () => {
        const wanted = box.checked;
        box.disabled = true;
        try {
          await write(item.id, wanted);
        } catch (error: unknown) {
          new Notice(t("export.switch.saveFailed", { detail: errorMessage(error) }));
        }
        box.checked = read(item.id);
        box.disabled = this.busy;
      };
    }
  }

  private renderGongmunOptions(root: HTMLElement): void {
    // One choice still decides both the type and the look (R-026), now as a pair
    // (R-030): the frame, the look, and the frame's switches. The window's choice
    // comes first, then the note's properties, then the look's own style.
    const picker = this.actions.gongmunPicker?.();
    if (picker) {
      const current = this.describeForm(this.gongmunForm);
      if (current) {
        this.gongmunPreset = current.preset;
        this.gongmunForm = current.id;
      }
      const formRow = root.createDiv({ cls: "hanmark-export-template-row hanmark-export-form-row" });
      renderGongmunFormPicker(formRow, {
        host: picker,
        formId: this.gongmunForm,
        idPrefix: "hanmark-export-gongmun",
        disabled: this.busy || !this.actions.selectGongmunForm,
        onChange: (id) => {
          void (async () => {
            try {
              const preset = await this.actions.selectGongmunForm?.(id);
              this.gongmunForm = id;
              if (preset) this.gongmunPreset = preset;
              this.presetFromNote = false;
            } catch (error: unknown) {
              new Notice(errorMessage(error));
            }
            this.render();
            this.contentEl.querySelector<HTMLElement>("#hanmark-export-gongmun-look")?.focus();
          })();
        }
      });
      const hint = this.actions.notePresetHint?.();
      const lookHint = this.actions.noteLookHint?.();
      const hintedLook = lookHint ? gongmunLookByName(picker.library, lookHint) : undefined;
      if (current && lookHint && hintedLook === current.look) {
        formRow.createEl("small", { text: t("gongmun.look.fromNote", { key: GONGMUN_LOOK_PROPERTY_KEY }) });
      } else if (current && lookHint) {
        formRow.createEl("small", {
          text: t("gongmun.look.noteDiffers", {
            key: GONGMUN_LOOK_PROPERTY_KEY,
            asked: lookHint,
            look: gongmunLookName(picker.library, current.id)
          })
        });
      }
      if (this.presetFromNote) {
        formRow.createEl("small", { text: t("gongmun.form.fromNote", { key: GONGMUN_PRESET_PROPERTY_KEY }) });
      } else if (current && current.fixed && hint && hint !== current.preset) {
        formRow.createEl("small", {
          text: t("gongmun.form.noteDiffers", {
            key: GONGMUN_PRESET_PROPERTY_KEY,
            asked: gongmunPresetLabel(hint),
            preset: gongmunPresetLabel(current.preset)
          })
        });
      }
      if (this.actions.editGongmunForm) {
        const formActions = formRow.createDiv({ cls: "hanmark-export-secondary-actions" });
        const create = formActions.createEl("button", {
          text: t("gongmun.form.new"),
          attr: { type: "button" }
        });
        create.disabled = this.busy;
        create.onclick = () => this.actions.editGongmunForm?.(null, this.gongmunPreset, (id) => this.formChanged(id));
        if (current?.kind === "custom") {
          const edit = formActions.createEl("button", {
            text: t("gongmun.form.edit"),
            attr: { type: "button" }
          });
          edit.disabled = this.busy;
          edit.onclick = () => this.actions.editGongmunForm?.(current.look, current.preset, (id) => this.formChanged(id));
        }
      }
    }

    if (this.actions.insertGongmunProperties) {
      const properties = root.createDiv({ cls: "hanmark-export-preview-row" });
      const copy = properties.createDiv({ cls: "hanmark-export-preview-copy" });
      copy.createEl("strong", { text: t("gongmun.export.propertiesTitle") });
      copy.createEl("small", {
        text: t("gongmun.export.propertiesDesc", { example: "공문_기관, 공문_수신" }) // i18n-data
      });
      const insert = properties.createEl("button", {
        text: t("gongmun.export.insertProperties"),
        cls: "hanmark-export-secondary-action",
        attr: { type: "button" }
      });
      insert.disabled = this.busy;
      insert.onclick = () => void this.actions.insertGongmunProperties?.(this.gongmunPreset);
    }

    if (this.actions.lintGongmun) {
      const lint = root.createDiv({ cls: "hanmark-export-preview-row" });
      const copy = lint.createDiv({ cls: "hanmark-export-preview-copy" });
      copy.createEl("strong", { text: t("gongmun.export.lint") });
      copy.createEl("small", { text: t("gongmun.export.lintDesc") });
      const check = lint.createEl("button", {
        text: t("gongmun.export.lint"),
        cls: "hanmark-export-secondary-action",
        attr: { type: "button" }
      });
      check.disabled = this.busy;
      check.onclick = () => this.actions.lintGongmun?.(this.gongmunPreset);
    }

    if (this.actions.openGongmunPreview) {
      const previewRow = root.createDiv({ cls: "hanmark-export-preview-row" });
      const copy = previewRow.createDiv({ cls: "hanmark-export-preview-copy" });
      copy.createEl("strong", { text: t("gongmun.export.preview") });
      copy.createEl("small", { text: t("gongmun.export.previewDesc") });
      const preview = previewRow.createEl("button", {
        text: t("gongmun.export.preview"),
        cls: "hanmark-export-secondary-action",
        attr: { type: "button" }
      });
      preview.disabled = this.busy;
      preview.onclick = async () => {
        await this.actions.openGongmunPreview?.(this.gongmunPreset, this.gongmunForm);
        this.close();
      };
    }

    const openBatch = this.actions.openGongmunBatch;
    if (openBatch) {
      const batchRow = root.createDiv({ cls: "hanmark-export-preview-row" });
      const copy = batchRow.createDiv({ cls: "hanmark-export-preview-copy" });
      copy.createEl("strong", { text: t("gongmun.batch.title") });
      copy.createEl("small", { text: t("gongmun.batch.rowDesc") });
      const batch = batchRow.createEl("button", {
        text: t("gongmun.batch.open"),
        cls: "hanmark-export-secondary-action",
        attr: { type: "button" }
      });
      batch.disabled = this.busy;
      batch.onclick = () => {
        this.close();
        openBatch();
      };
    }
  }

  /** After the form editor saves (the saved id) or deletes (""), show what is active now. */
  private formChanged(id: string): void {
    this.gongmunForm = this.describeForm(id)?.id || this.actions.currentGongmunForm?.() || "";
    this.presetFromNote = false;
    this.render();
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
      button.setAttribute("aria-label", t("export.hwpx.variantDisabled", { title }));
    }
    button.onclick = () => {
      this.hwpxVariant = id;
      this.result = null;
      this.render();
    };
  }

  private renderDocxDetail(root: HTMLElement): void {
    root.createEl("h3", { text: t("export.docx.heading") });
    const templateName =
      this.actions.activeWordTemplateName?.() || t("export.docx.currentTemplate");
    const summary = root.createDiv({ cls: "hanmark-export-summary-card" });
    summary.createSpan({ text: t("export.docx.templateLabel") });
    summary.createEl("strong", { text: templateName });
    summary.createEl("small", {
      text: t("export.docx.note")
    });

    const actions = root.createDiv({
      cls: "hanmark-export-secondary-actions"
    });
    if (this.actions.openDocxPreview) {
      const preview = actions.createEl("button", {
        text: t("export.docx.preview"),
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
        text: t("export.docx.pandocSettings"),
        attr: { type: "button" }
      });
      settings.disabled = this.busy;
      settings.onclick = () => {
        this.close();
        this.actions.openPandocSettings?.();
      };
    }
    this.renderExportSwitches(root, "docx");
  }

  private renderHtmlDetail(root: HTMLElement): void {
    root.createEl("h3", { text: t("settings.html.heading") });
    root.createEl("p", {
      text: t("export.html.desc")
    });
    if (this.actions.activeHtmlTheme && this.actions.setHtmlTheme) {
      const option = root.createDiv({ cls: "hanmark-export-option-row" });
      const label = option.createEl("label", {
        text: t("settings.html.theme.name"),
        attr: { for: "hanmark-export-html-theme" }
      });
      label.addClass("hanmark-export-field-label");
      const select = option.createEl("select", {
        attr: { id: "hanmark-export-html-theme" }
      });
      select.createEl("option", {
        value: "achmage-editorial",
        text: t("settings.html.theme.editorial")
      });
      select.createEl("option", {
        value: "classic",
        text: t("settings.html.theme.classic")
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
          new Notice(t("settings.html.theme.saveFailed", { detail: errorMessage(error) }));
        }
      };
      option.createEl("small", {
        text: t("export.html.themeNote")
      });
    }
    this.renderExportSwitches(root, "html");
  }

  private renderPdfDetail(root: HTMLElement): void {
    root.createEl("h3", { text: "Achmage Editorial PDF" });
    root.createEl("p", {
      text: t("export.pdf.desc")
    });
    root.createEl("small", {
      cls: "hanmark-export-native-note",
      text: t("export.pdf.native")
    });

    const layoutRow = root.createDiv({ cls: "hanmark-export-option-row" });
    layoutRow.createEl("label", { text: t("export.pdf.layout"), attr: { for: "hanmark-pdf-layout" } });
    const layout = layoutRow.createEl("select", { attr: { id: "hanmark-pdf-layout" } });
    for (const [value, label] of Object.entries(editorialPdfLayoutChoices())) {
      layout.createEl("option", { value, text: label });
    }
    layout.value = this.pdfLayout.mode;
    layout.disabled = this.busy;
    layout.onchange = () => { this.pdfLayout = normalizeEditorialPdfLayout({ ...this.pdfLayout, mode: layout.value }); this.render(); };
    const gapRow = root.createDiv({ cls: "hanmark-export-option-row" });
    gapRow.createEl("label", { text: t("export.pdf.gap"), attr: { for: "hanmark-pdf-gap" } });
    const gap = gapRow.createEl("select", { attr: { id: "hanmark-pdf-gap" } });
    for (const mm of [8, 10, 12]) gap.createEl("option", { value: String(mm), text: `${mm}mm` });
    gap.value = String(this.pdfLayout.columnGapMm);
    gap.disabled = this.busy || this.pdfLayout.mode === "single";
    gap.onchange = () => { this.pdfLayout = normalizeEditorialPdfLayout({ ...this.pdfLayout, columnGapMm: Number(gap.value) }); };
    const tableRow = root.createDiv({ cls: "hanmark-export-option-row" });
    tableRow.createEl("label", { text: t("export.pdf.tableWidth"), attr: { for: "hanmark-pdf-table-width" } });
    const tableWidth = tableRow.createEl("select", { attr: { id: "hanmark-pdf-table-width" } });
    for (const [value, label] of Object.entries(editorialPdfTableWidthChoices())) {
      tableWidth.createEl("option", { value, text: label });
    }
    tableWidth.value = this.pdfLayout.tableWidth;
    tableWidth.disabled = this.busy || this.pdfLayout.mode === "single";
    tableWidth.onchange = () => { this.pdfLayout = normalizeEditorialPdfLayout({ ...this.pdfLayout, tableWidth: tableWidth.value }); };
    root.createEl("small", { text: t("export.pdf.autoTableNote") });
    const sectionLabel = root.createEl("label", { cls: "hanmark-export-option-row" });
    const sections = sectionLabel.createEl("input", { type: "checkbox" });
    sections.checked = this.pdfLayout.sectionPageBreaks;
    sections.disabled = this.busy;
    sections.onchange = () => { this.pdfLayout.sectionPageBreaks = sections.checked; };
    sectionLabel.createSpan({ text: t("export.pdf.sectionBreaks") });

    const active = this.actions.activePdfTheme?.();
    const choices = this.actions.pdfThemeChoices?.() ?? [];
    if (!active || !choices.length || !this.actions.selectPdfTheme) return;

    const resolved = resolveEditorialPdfThemeSnapshot(active);
    const theme = root.createDiv({ cls: "hanmark-export-pdf-theme" });
    const row = theme.createDiv({ cls: "hanmark-export-option-row" });
    const statusId = "hanmark-export-pdf-theme-status";
    row.createEl("label", {
      text: t("export.pdf.theme"),
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
        text: editorialPdfThemeDisplayName(snapshot)
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
        new Notice(t("export.pdf.themeFailed", { detail: errorMessage(error) }));
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
    status.createEl("strong", { text: editorialPdfThemeDisplayName(active) });
    status.createSpan({
      text: active.builtIn
        ? t("export.pdf.builtinStatus")
        : editorialPdfContrastStatus(resolved)
    });
    const actions = theme.createDiv({
      cls: "hanmark-export-secondary-actions"
    });
    const create = actions.createEl("button", {
      text: t("export.pdf.newTheme"),
      attr: { type: "button" }
    });
    create.disabled = this.busy;
    create.onclick = () => {
      this.close();
      this.actions.openPdfThemeManager?.("create");
    };
    const manage = actions.createEl("button", {
      text: t("export.pdf.manageThemes"),
      attr: { type: "button" }
    });
    manage.disabled = this.busy;
    manage.onclick = () => {
      this.close();
      this.actions.openPdfThemeManager?.("manage");
    };
    this.renderExportSwitches(root, "pdf");
  }

  private renderResult(
    root: HTMLElement,
    result: HanmarkExportOutcome
  ): void {
    const panel = root.createDiv({
      cls: "hanmark-export-result hanmark-arrive",
      attr: {
        role: "status",
        "aria-live": "polite"
      }
    });
    panel.createEl("strong", {
      text: result.delivery === "download" ? t("export.result.download") : t("export.result.done"),
      cls: "hanmark-done-mark"
    });
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
        text: t("export.result.reveal"),
        attr: { type: "button" }
      });
      reveal.onclick = async () => {
        reveal.disabled = true;
        try {
          await this.actions.revealOutput?.(result);
        } catch (error: unknown) {
          new Notice(errorMessage(error, t("export.result.revealFailed")));
        } finally {
          if (reveal.isConnected) reveal.disabled = false;
        }
      };
    }
    const again = actions.createEl("button", {
      text: t("export.result.again"),
      attr: { type: "button" }
    });
    again.onclick = () => {
      this.result = null;
      this.render();
    };
    const close = actions.createEl("button", {
      text: t("common.close"),
      attr: { type: "button" }
    });
    close.onclick = () => this.close();
  }

  private renderFooter(root: HTMLElement): void {
    // The look chooser must leave the export button visible (see gongmunFormPicker).
    const footer = root.createDiv({ cls: "hanmark-export-footer", attr: { "data-hanmark-picker-floor": "" } });
    const execute = footer.createEl("button", {
      text: this.busy ? t("export.footer.busy") : this.primaryActionLabel(),
      cls: "mod-cta hanmark-export-primary-button",
      attr: { type: "button" }
    });
    // The one focal point while HanMark works: a ring orbiting the primary button (R-028).
    setPhase(execute, this.busy ? "waiting" : null);
    execute.disabled =
      this.busy ||
      (this.format === "pdf" && !this.actions.exportPdf);
    execute.onclick = () => void this.run();

    if (this.format === "pdf" && !this.preparedPdf) {
      const print = footer.createEl("button", { text: t("export.footer.print"), attr: { type: "button" } });
      print.disabled = this.busy || !this.actions.exportPdf;
      print.onclick = () => { this.nativePdfPrint = true; void this.run(); };
    }

    const close = footer.createEl("button", {
      text: t("common.close"),
      cls: "hanmark-modal-close",
      attr: { type: "button" }
    });
    close.disabled = this.busy;
    close.onclick = () => this.close();
  }

  private primaryActionLabel(): string {
    if (this.format === "docx") return t("export.action.docx");
    if (this.format === "html") return t("export.action.html");
    if (this.format === "pdf") return this.preparedPdf ? t("export.action.savePdfFile") : t("export.action.savePdf");
    if (this.hwpxVariant === "gongmun") return t("export.action.gongmun");
    return t("export.action.hwpx");
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
      if (this.preparedPdf) return this.actions.savePdf?.(this.preparedPdf);
      if (this.nativePdfPrint) super.close();
      return this.actions.exportPdf?.({ ...this.pdfLayout }, this.nativePdfPrint);
    }
    if (this.hwpxVariant === "gongmun") {
      return this.actions.exportKordoc(
        "gongmun-hwpx",
        this.gongmunPreset,
        this.gongmunForm
      );
    }
    return this.actions.exportKordoc("quick-hwpx");
  }

  private async run(): Promise<void> {
    this.busy = true;
    this.render();
    try {
      const result = await this.executeSelected();
      if (result && typeof result === "object" && result.status === "ready") {
        this.preparedPdf = result;
        this.busy = false;
        this.render();
        return;
      }
      if (isPresentationResult(result)) {
        if (result.status === "delegated" && result.delivery !== "download") {
          super.close();
          return;
        }
        this.result = result.status !== "cancelled" ? result : null;
        if (result.status !== "cancelled") this.preparedPdf = null;
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
      new Notice(errorMessage(error, t("export.failed")));
    } finally {
      this.busy = false;
      this.nativePdfPrint = false;
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
    this.preparedPdf = null;
    super.close();
  }

  onClose(): void {
    this.preparedPdf = null;
    this.modalEl.removeClass("hanmark-resizable-workspace-modal");
    this.contentEl.empty();
  }
}
