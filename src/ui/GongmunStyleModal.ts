import { Modal, Notice, Setting, type App } from "obsidian";
import { hwpxToProfile, type GongmunPreset } from "kordoc";
import {
  normalizeGongmunStyleOptions,
  resolveGongmunOptions,
  type GongmunStyleOptions
} from "../io/gongmunStyle";
import {
  deleteGongmunTemplateInMemory,
  listGongmunTemplates,
  newGongmunTemplateRecord,
  putGongmunTemplateInMemory,
  setActiveGongmunTemplateInMemory,
  type GongmunTemplateRecord,
  type TemplateLibraryHost
} from "../io/templateLibrary";
import { gongmunPresetLabel } from "../io/gongmunExport";
import { GONGMUN_FRAMES, agencyLook, agencyOfLook, frameOfPreset, LOOK_BASIC, presetsOfFrame, type GongmunFrame } from "../io/gongmunFormId";
import { AGENCY_FRAMES, gongmunFrameDescription, gongmunFrameLabel, isKnownAgency } from "../io/gongmunForms";
import { GongmunLookModal } from "./GongmunLookModal";
import type { GongmunPickerHost } from "./gongmunFormPicker";
import { renderQuickHwpxPreview } from "../io/kordocEngine";
import { bytesAsArrayBuffer, type FileGateway } from "../io/fileGateway";
import { appendSanitizedSvg } from "./svgSanitize";
import { confirmAction } from "./dialogs";
import { errorMessage } from "../utils/errors";
import { t, tKey, type MessageKey } from "../i18n";

// i18n-data-begin: a Korean official-document sample (document content, not UI text)
const PREVIEW_SAMPLE = [
  "# 2026년 주요 업무 추진 계획",
  "",
  "## 추진 배경",
  "",
  "- 현장 의견을 반영해 업무 절차를 간소화함",
  "  - 처리 기간 단축 필요",
  "",
  "## 추진 내용",
  "",
  "| 구분 | 내용 | 일정 |",
  "|---|---|---|",
  "| 1단계 | 현황 조사 | 2026. 3. |",
  "| 2단계 | 개선안 마련 | 2026. 6. |",
  "",
  "※ 세부 계획은 별도 보고",
  ""
].join("\n");
const APPROVAL_EXAMPLE = "담당, 팀장, 과장";
// i18n-data-end

export interface GongmunStyleModalHost {
  templateHost: TemplateLibraryHost;
  gateway: FileGateway;
  /** Called after a save or delete so the caller can refresh its choices. */
  changed(activeId: string): void;
  /** The look chooser's host (favorites, recent looks); without it a form starts from 기본 only. */
  lookPicker?: () => GongmunPickerHost;
}

type TriState = "" | "on" | "off";

function triState(value: boolean | undefined): TriState {
  return value === true ? "on" : value === false ? "off" : "";
}

function fromTriState(value: string): boolean | undefined {
  return value === "on" ? true : value === "off" ? false : undefined;
}

/**
 * Create or edit one of the user's own forms with a live preview rendered by the same
 * engine and options the export uses (2.7.0 W5). Since 3.0.0 (R-030) a form is a look
 * for one frame: the window asks for the frame (and, where a frame has two document
 * types, which one), the look the form starts from, and then the form's own options.
 */
export class GongmunStyleModal extends Modal {
  private draft: GongmunTemplateRecord;
  private readonly isNew: boolean;
  /** Raw form values; normalized for preview and save. */
  private raw: Record<string, unknown>;
  private previewPreset: GongmunPreset = "report";
  private previewEl: HTMLElement | null = null;
  private previewTimer: number | null = null;
  private previewVersion = 0;

  /**
   * `initialPreset` is the document type a new form starts with (the type chosen in
   * the export window); an existing form keeps its own (R-026).
   */
  constructor(
    app: App,
    private readonly host: GongmunStyleModalHost,
    recordId: string | null,
    initialPreset?: GongmunPreset
  ) {
    super(app);
    const existing = recordId
      ? listGongmunTemplates(host.templateHost).find((record) => record.id === recordId)
      : undefined;
    this.isNew = !existing;
    this.draft = existing ?? newGongmunTemplateRecord(host.templateHost, t("template.gongmunDefaultName"), {}, initialPreset);
    this.previewPreset = this.draft.preset ?? initialPreset ?? "report";
    this.raw = structuredClone(this.draft.options) as Record<string, unknown>;
  }

  onOpen(): void {
    this.modalEl.addClass("hanmark-gongmun-style-modal");
    this.titleEl.setText(t("gongmun.style.title"));
    this.render();
  }

  onClose(): void {
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    this.contentEl.empty();
  }

  /** The form's options as stored and previewed: a base look only where the frame takes one. */
  private savedOptions(): GongmunStyleOptions {
    const options = this.options();
    const agency = this.baseAgency();
    if (agency) options.agency = agency;
    else delete options.agency;
    return options;
  }

  private options(): GongmunStyleOptions {
    return normalizeGongmunStyleOptions(this.raw);
  }

  private set(path: string, value: unknown): void {
    const parts = path.split(".");
    let node = this.raw;
    for (const part of parts.slice(0, -1)) {
      if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    const key = parts[parts.length - 1];
    if (value === undefined || value === "") delete node[key];
    else node[key] = value;
    this.schedulePreview();
  }

  private get(path: string): unknown {
    let node: unknown = this.raw;
    for (const part of path.split(".")) {
      if (typeof node !== "object" || node === null) return undefined;
      node = (node as Record<string, unknown>)[part];
    }
    return node;
  }

  private text(container: HTMLElement, name: string, path: string, desc?: string, placeholder = ""): void {
    const setting = new Setting(container).setName(name).addText((input) => {
      const current = this.get(path);
      input.setPlaceholder(placeholder).setValue(typeof current === "string" || typeof current === "number" ? String(current) : "");
      input.onChange((value) => this.set(path, value.trim() || undefined));
    });
    if (desc) setting.setDesc(desc);
  }

  private choice(container: HTMLElement, name: string, path: string, options: ReadonlyArray<[string, string]>): void {
    new Setting(container).setName(name).addDropdown((dropdown) => {
      dropdown.addOption("", t("gongmun.style.default"));
      for (const [value, label] of options) dropdown.addOption(value, label);
      const current = this.get(path);
      dropdown.setValue(typeof current === "string" ? current : "");
      dropdown.onChange((value) => this.set(path, value || undefined));
    });
  }

  private toggle(container: HTMLElement, name: MessageKey, path: string): void {
    new Setting(container).setName(tKey(name)).addDropdown((dropdown) => {
      dropdown
        .addOption("", t("gongmun.style.default"))
        .addOption("on", t("gongmun.style.on"))
        .addOption("off", t("gongmun.style.off"))
        .setValue(triState(this.get(path) as boolean | undefined))
        .onChange((value) => this.set(path, fromTriState(value)));
    });
  }

  private color(container: HTMLElement, name: string, path: string): void {
    new Setting(container)
      .setName(name)
      .addColorPicker((picker) => {
        const current = this.get(path);
        if (typeof current === "string") picker.setValue(current);
        picker.onChange((value) => this.set(path, value.toUpperCase()));
      })
      .addExtraButton((button) =>
        button.setIcon("rotate-ccw").setTooltip(t("gongmun.style.default")).onClick(() => {
          this.set(path, undefined);
          this.render();
        })
      );
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    const layout = contentEl.createDiv({ cls: "hanmark-gongmun-style-layout" });
    const form = layout.createDiv({ cls: "hanmark-gongmun-style-form" });
    const previewColumn = layout.createDiv({ cls: "hanmark-gongmun-style-preview" });

    new Setting(form).setName(t("gongmun.style.name")).addText((input) => {
      input.setValue(this.draft.name).onChange((value) => {
        this.draft = { ...this.draft, name: value };
      });
    });
    this.renderFrameAndBase(form);
    this.text(form, t("gongmun.style.org.name"), "org", t("gongmun.style.org.desc"));
    this.choice(form, t("gongmun.style.bodyFont.name"), "bodyFont", [
      ["myeongjo", t("gongmun.style.bodyFont.myeongjo")],
      ["gothic", t("gongmun.style.bodyFont.gothic")]
    ]);
    this.text(form, t("gongmun.style.bodyPt.name"), "bodyPt", undefined, "15");
    this.text(form, t("gongmun.style.lineSpacing.name"), "lineSpacing", undefined, "160");
    this.choice(form, t("gongmun.style.numbering.name"), "numbering", [
      ["standard", t("gongmun.style.numbering.standard")],
      ["report", t("gongmun.style.numbering.report")],
      ["gaejosik", t("gongmun.style.numbering.gaejosik")]
    ]);
    this.choice(form, t("gongmun.style.bullet2.name"), "bullet2", [
      ["ㅇ", "ㅇ"], // i18n-data
      ["○", "○"]
    ]);
    this.choice(form, t("gongmun.style.h2Marker.name"), "h2Marker", [
      ["band", t("gongmun.style.h2Marker.band")],
      ["roman", t("gongmun.style.h2Marker.roman")],
      ["number", t("gongmun.style.h2Marker.number")],
      ["box", t("gongmun.style.h2Marker.box")],
      ["none", t("gongmun.style.h2Marker.none")]
    ]);
    this.color(form, t("gongmun.style.bandColor.name"), "bandColor");
    this.color(form, t("gongmun.style.bandTextColor.name"), "bandTextColor");

    const fonts = form.createEl("details", { cls: "hanmark-gongmun-style-group" });
    fonts.createEl("summary", { text: t("gongmun.style.fonts.name") });
    fonts.createEl("p", { cls: "setting-item-description", text: t("gongmun.style.fonts.desc") });
    this.text(fonts, t("gongmun.style.fonts.body"), "fonts.body");
    this.text(fonts, t("gongmun.style.fonts.heading"), "fonts.heading");
    this.text(fonts, t("gongmun.style.fonts.ref"), "fonts.ref");
    this.text(fonts, t("gongmun.style.fonts.table"), "fonts.table");

    const levels = form.createEl("details", { cls: "hanmark-gongmun-style-group" });
    levels.createEl("summary", { text: t("gongmun.style.levels.name") });
    levels.createEl("p", { cls: "setting-item-description", text: t("gongmun.style.levels.desc") });
    for (const level of ["0", "1", "2", "3"]) {
      new Setting(levels)
        .setName(t("gongmun.style.levels.level", { level: Number(level) + 1 }))
        .addText((input) => {
          const current = this.get(`levels.${level}.font`);
          input.setPlaceholder(t("gongmun.style.fonts.body")).setValue(typeof current === "string" ? current : "");
          input.onChange((value) => this.set(`levels.${level}.font`, value.trim() || undefined));
        })
        .addText((input) => {
          const current = this.get(`levels.${level}.pt`);
          input.setPlaceholder("pt").setValue(typeof current === "number" || typeof current === "string" ? String(current) : "");
          input.inputEl.addClass("hanmark-gongmun-style-number");
          input.onChange((value) => this.set(`levels.${level}.pt`, value.trim() || undefined));
        })
        .addToggle((toggle) => {
          toggle.setTooltip(t("gongmun.style.levels.bold")).setValue(this.get(`levels.${level}.bold`) === true);
          toggle.onChange((value) => this.set(`levels.${level}.bold`, value ? true : undefined));
        });
    }

    const page = form.createEl("details", { cls: "hanmark-gongmun-style-group" });
    page.createEl("summary", { text: t("gongmun.style.margins.name") });
    page.createEl("p", { cls: "setting-item-description", text: t("gongmun.style.margins.desc") });
    const margins = new Setting(page).setName(t("gongmun.style.margins.name"));
    for (const side of ["top", "bottom", "left", "right"]) {
      margins.addText((input) => {
        const current = this.get(`margins.${side}`);
        input.setPlaceholder(side === "bottom" ? "10" : "20");
        input.setValue(typeof current === "number" || typeof current === "string" ? String(current) : "");
        input.inputEl.addClass("hanmark-gongmun-style-number");
        input.onChange((value) => this.set(`margins.${side}`, value.trim() || undefined));
      });
    }

    this.toggle(form, "gongmun.style.cover.name", "cover");
    this.toggle(form, "gongmun.style.toc.name", "toc");
    this.toggle(form, "gongmun.style.pageNumbers.name", "pageNumbers");
    this.toggle(form, "gongmun.style.endMark.name", "endMark");
    this.toggle(form, "gongmun.style.centerTitle.name", "centerTitle");
    this.toggle(form, "gongmun.style.suppressSingle.name", "suppressSingle");
    this.toggle(form, "gongmun.style.autoFit.name", "autoFit");

    new Setting(form)
      .setName(t("gongmun.style.approval.name"))
      .setDesc(t("gongmun.style.approval.desc", { example: APPROVAL_EXAMPLE, key: "공문_결재" })) // i18n-data
      .addText((input) => {
        const current = this.get("approval");
        input.setPlaceholder(APPROVAL_EXAMPLE).setValue(Array.isArray(current) ? current.join(", ") : "");
        input.onChange((value) => {
          const labels = value.split(/[,，]/u).map((item) => item.trim()).filter(Boolean);
          this.set("approval", labels.length ? labels : undefined);
        });
      });

    const table = new Setting(form)
      .setName(t("gongmun.style.table.name"))
      .setDesc(
        `${t("gongmun.style.table.desc")} ${
          this.draft.tableStyle?.tables.length
            ? t("gongmun.style.table.loaded", { count: this.draft.tableStyle.tables.length })
            : t("gongmun.style.table.none")
        }`
      )
      .addButton((button) => button.setButtonText(t("gongmun.style.table.import")).onClick(() => void this.importTableStyle()));
    if (this.draft.tableStyle) {
      table.addButton((button) =>
        button.setButtonText(t("gongmun.style.table.clear")).onClick(() => {
          const { tableStyle: _removed, ...rest } = this.draft;
          this.draft = rest;
          this.render();
        })
      );
    }

    new Setting(previewColumn)
      .setName(t("gongmun.style.preview.name"))
      .setDesc(t("gongmun.style.preview.of", { frame: gongmunFrameLabel(this.frame()), look: this.draft.name.trim() || t("template.gongmunDefaultName") }))
      .setHeading();
    this.previewEl = previewColumn.createDiv({ cls: "hanmark-gongmun-style-paper" });

    const actions = contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    if (!this.isNew) {
      const remove = actions.createEl("button", { text: t("gongmun.style.delete") });
      remove.classList.add("mod-warning");
      remove.onclick = () => void this.remove();
    }
    actions.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    const save = actions.createEl("button", { text: t("gongmun.style.save") });
    save.classList.add("mod-cta");
    save.onclick = () => void this.save();
    this.schedulePreview(0);
  }

  private frame(): GongmunFrame {
    return frameOfPreset(this.previewPreset).frame;
  }

  /** The Kordoc agency the form starts from, when its frame takes agency looks. */
  private baseAgency(): string | undefined {
    const agency = this.get("agency");
    return typeof agency === "string" && AGENCY_FRAMES.includes(this.frame()) && isKnownAgency(agency) ? agency : undefined;
  }

  /**
   * 틀 and 바탕 모양 (R-030): the frame the form is a look for, the document type where
   * the frame has two, and the look whose measured values sit under the form's options.
   */
  private renderFrameAndBase(form: HTMLElement): void {
    const frame = this.frame();
    new Setting(form)
      .setName(t("gongmun.frame.label"))
      .setDesc(`${gongmunFrameDescription(frame)} ${t("gongmun.style.frame.desc")}`)
      .addDropdown((dropdown) => {
        dropdown.selectEl.id = "hanmark-style-frame";
        for (const item of GONGMUN_FRAMES) dropdown.addOption(item, gongmunFrameLabel(item));
        dropdown.setValue(frame).onChange((value) => {
          const next = GONGMUN_FRAMES.find((item) => item === value) ?? "report";
          this.previewPreset = presetsOfFrame(next)[0] ?? "report";
          this.render();
        });
      });
    const kinds = presetsOfFrame(frame);
    if (kinds.length > 1) {
      new Setting(form)
        .setName(t("gongmun.style.preset.name"))
        .setDesc(t("gongmun.style.preset.desc"))
        .addDropdown((dropdown) => {
          dropdown.selectEl.id = "hanmark-style-kind";
          for (const preset of kinds) dropdown.addOption(preset, gongmunPresetLabel(preset));
          dropdown.setValue(this.previewPreset).onChange((value) => {
            this.previewPreset = kinds.find((preset) => preset === value) ?? kinds[0];
            this.schedulePreview(0);
          });
        });
    }
    const base = new Setting(form).setName(t("gongmun.style.base.name"));
    const picker = this.host.lookPicker;
    if (!AGENCY_FRAMES.includes(frame) || !picker) {
      base.setDesc(t("gongmun.style.base.none"));
      return;
    }
    const agency = this.baseAgency();
    base.setDesc(t("gongmun.style.base.desc"));
    base.addButton((button) => {
      button.buttonEl.id = "hanmark-style-base";
      button.setButtonText(agency ?? t("gongmun.look.basic")).onClick(() => {
        new GongmunLookModal(this.app, {
          host: picker(),
          frame,
          current: agency ? agencyLook(agency) : LOOK_BASIC,
          title: t("gongmun.style.base.choose"),
          // A form starts from 기본, 공통, or an agency; never from another form.
          filter: (look) => look.kind === "basic" || look.kind === "common" || look.kind === "agency",
          pick: (look) => {
            this.set("agency", agencyOfLook(look));
            this.render();
          }
        }).open();
      });
    });
  }

  private schedulePreview(delay = 500): void {
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      void this.renderPreview();
    }, delay);
  }

  private async renderPreview(): Promise<void> {
    const target = this.previewEl;
    if (!target) return;
    const version = ++this.previewVersion;
    target.empty();
    target.createEl("p", { cls: "setting-item-description", text: t("gongmun.style.preview.loading") });
    try {
      const result = await renderQuickHwpxPreview(PREVIEW_SAMPLE, {
        gongmun: resolveGongmunOptions({ preset: this.previewPreset, style: this.savedOptions() }),
        profile: this.draft.tableStyle
      });
      if (version !== this.previewVersion || !target.isConnected) return;
      target.empty();
      const svg = appendSanitizedSvg(target, result.render.svg);
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "auto");
    } catch (error: unknown) {
      if (version !== this.previewVersion || !target.isConnected) return;
      target.empty();
      target.createEl("p", { cls: "hanmark-preview-error", text: t("gongmun.style.preview.failed", { detail: errorMessage(error) }) });
    }
  }

  private async importTableStyle(): Promise<void> {
    try {
      const [picked] = await this.host.gateway.pickFiles({ extensions: ["hwpx"], multiple: false });
      if (!picked) return;
      const profile = await hwpxToProfile(bytesAsArrayBuffer(picked.bytes));
      this.draft = { ...this.draft, tableStyle: profile };
      this.render();
    } catch (error: unknown) {
      new Notice(t("gongmun.style.table.failed", { detail: errorMessage(error) }));
    }
  }

  private async save(): Promise<void> {
    const host = this.host.templateHost;
    const previous = structuredClone(host.settings.hanmarkTemplateLibrary);
    try {
      const saved = putGongmunTemplateInMemory(host, { ...this.draft, preset: this.previewPreset, options: this.savedOptions() });
      if (this.isNew) setActiveGongmunTemplateInMemory(host, saved.id);
      await host.saveSettings();
      new Notice(t("gongmun.style.saved", { name: saved.name }));
      this.host.changed(saved.id);
      this.close();
    } catch (error: unknown) {
      host.settings.hanmarkTemplateLibrary = previous;
      new Notice(t("gongmun.style.saveFailed", { detail: errorMessage(error) }));
    }
  }

  private async remove(): Promise<void> {
    const confirmed = await confirmAction(this.app, {
      title: t("gongmun.style.delete"),
      message: t("gongmun.style.deleteConfirm", { name: this.draft.name }),
      confirmText: t("gongmun.style.delete"),
      warning: true
    });
    if (!confirmed) return;
    const host = this.host.templateHost;
    const previous = structuredClone(host.settings.hanmarkTemplateLibrary);
    try {
      deleteGongmunTemplateInMemory(host, this.draft.id);
      await host.saveSettings();
      this.host.changed("");
      this.close();
    } catch (error: unknown) {
      host.settings.hanmarkTemplateLibrary = previous;
      new Notice(t("gongmun.style.saveFailed", { detail: errorMessage(error) }));
    }
  }
}
