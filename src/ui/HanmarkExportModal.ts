import { Modal, Notice } from "obsidian";
import { VERSION, type GongmunPreset } from "kordoc";

export interface HanmarkExportActions {
  sourcePatchAvailable: () => boolean;
  activeTemplateId: () => string;
  templateChoices: () => Array<{ id: string; name: string }>;
  activeTemplateSummary: () => string;
  selectTemplate: (id: string) => Promise<void>;
  openTemplateManager: () => void;
  exportKordoc: (mode: "quick-hwpx" | "gongmun-hwpx", preset?: GongmunPreset) => Promise<boolean>;
  patchSource: () => Promise<void>;
  runOther: (mode: "docx" | "html") => Promise<void>;
  openPreview: () => Promise<void>;
}

const PRESETS: Array<{ value: GongmunPreset; label: string }> = [
  { value: "official", label: "기안문·시행문" },
  { value: "report", label: "보고서" },
  { value: "plan", label: "계획서" },
  { value: "notice", label: "통지·안내" },
  { value: "minutes", label: "회의록" },
  { value: "gaejosik", label: "정부 표준 개조식" },
  { value: "press", label: "보도자료" }
];

type ExportTab = "hwpx" | "other";

export class HanmarkExportModal extends Modal {
  private tab: ExportTab = "hwpx";
  private gongmunPreset: GongmunPreset = "report";

  constructor(app: any, private readonly actions: HanmarkExportActions, initialTab: ExportTab = "hwpx") {
    super(app);
    this.tab = initialTab;
  }

  onOpen(): void {
    this.modalEl.addClass("hanmark-resizable-workspace-modal");
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("hanmark-export-modal", "is-compact");
    contentEl.createEl("h2", { text: "HanMark 내보내기" });
    contentEl.createEl("small", {
      cls: "hanmark-window-size-hint",
      text: "큰 화면으로 열렸습니다. 창 우하단을 드래그하면 크기를 조절할 수 있습니다."
    });

    const tabs = contentEl.createDiv({ cls: "hanmark-export-tabs" });
    for (const [id, label] of [["hwpx", "HWPX"], ["other", "기타 형식"]] as const) {
      const button = tabs.createEl("button", { text: label, cls: this.tab === id ? "is-active" : "" });
      button.onclick = () => {
        this.tab = id;
        this.render();
      };
    }

    if (this.tab === "hwpx") this.renderHwpx(contentEl);
    else this.renderOther(contentEl);

    const close = contentEl.createEl("button", { text: "닫기", cls: "hanmark-modal-close" });
    close.onclick = () => this.close();
  }

  private renderHwpx(root: HTMLElement): void {
    root.createEl("p", {
      cls: "hanmark-compact-engine-line",
      text: `Kordoc ${String(VERSION || "4.2.5")} · 외부 설치 없음 · 원격·Vault 이미지 포함`
    });

    const template = root.createDiv({ cls: "hanmark-export-template-row" });
    const select = template.createEl("select");
    for (const item of this.actions.templateChoices()) select.createEl("option", { value: item.id, text: item.name });
    select.value = this.actions.activeTemplateId();
    select.onchange = async () => {
      await this.actions.selectTemplate(select.value);
      this.render();
    };
    const manage = template.createEl("button", { text: "템플릿 관리" });
    manage.onclick = () => {
      this.close();
      this.actions.openTemplateManager();
    };
    template.createEl("small", { text: this.actions.activeTemplateSummary() });

    const primary = root.createDiv({ cls: "hanmark-export-primary-actions" });
    const exportButton = primary.createEl("button", { text: "HWPX 만들기" });
    exportButton.classList.add("mod-cta");
    exportButton.onclick = () => this.run(exportButton, () => this.actions.exportKordoc("quick-hwpx"));
    const preview = primary.createEl("button", { text: "미리보기" });
    preview.onclick = async () => {
      await this.actions.openPreview();
      this.close();
    };

    const gongmun = root.createDiv({ cls: "hanmark-export-gongmun-row" });
    gongmun.createEl("strong", { text: "공문서" });
    const preset = gongmun.createEl("select");
    for (const item of PRESETS) preset.createEl("option", { value: item.value, text: item.label });
    preset.value = this.gongmunPreset;
    preset.onchange = () => (this.gongmunPreset = preset.value as GongmunPreset);
    const button = gongmun.createEl("button", { text: "공문서 만들기" });
    button.onclick = () => this.run(button, () => this.actions.exportKordoc("gongmun-hwpx", this.gongmunPreset));
  }

  private renderOther(root: HTMLElement): void {
    const actions = root.createDiv({ cls: "hanmark-other-export-list" });
    this.otherRow(
      actions,
      "원본 형식 수정본",
      "가져온 HWP/HWPX의 원본은 유지하고 별도 수정본을 만듭니다.",
      "수정본 만들기",
      async () => {
        await this.actions.patchSource();
        return true;
      },
      !this.actions.sourcePatchAvailable()
    );
    this.otherRow(actions, "HTML", "설치 없이 HTML 파일로 저장합니다.", "HTML 만들기", async () => {
      await this.actions.runOther("html");
      return true;
    });
    this.otherRow(actions, "DOCX", "선택 설치한 Pandoc을 사용합니다. HWPX 기능과는 독립적입니다.", "DOCX 만들기", async () => {
      await this.actions.runOther("docx");
      return true;
    });
  }

  private otherRow(
    root: HTMLElement,
    title: string,
    description: string,
    buttonText: string,
    action: () => Promise<boolean>,
    disabled = false
  ): void {
    const row = root.createDiv({ cls: "hanmark-other-export-row" });
    const info = row.createDiv();
    info.createEl("strong", { text: title });
    info.createEl("small", { text: description });
    const button = row.createEl("button", { text: buttonText });
    button.disabled = disabled;
    if (disabled) button.setAttribute("aria-label", "HWP 또는 HWPX에서 가져온 노트에서만 사용할 수 있습니다");
    button.onclick = () => this.run(button, action);
  }

  private async run(button: HTMLButtonElement, action: () => Promise<boolean>): Promise<void> {
    const original = button.textContent || "실행";
    button.disabled = true;
    button.setText("처리 중…");
    try {
      const success = await action();
      if (success) this.close();
    } catch (error: any) {
      new Notice(error?.message || String(error));
      console.error("[hanmark] export action failed:", error);
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.setText(original);
      }
    }
  }

  onClose(): void {
    this.modalEl.removeClass("hanmark-resizable-workspace-modal");
    this.contentEl.empty();
  }
}
