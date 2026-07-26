import { type App, Modal, Notice, Setting, type TextComponent } from "obsidian";
import {
  defaultDocumentStyleProfile,
  normalizeDocumentStyleProfile,
  type DocumentStyleProfile,
  type DocumentStyleRole,
  type CharacterStyleProfile,
  type ParagraphStyleProfile,
  type RoleStyleProfile
} from "../io/documentStyle";
import { errorMessage } from "../utils/errors";

const HU_PER_MM = 283.4646;
const ROLE_LABELS: Array<[DocumentStyleRole, string]> = [
  ["body", "본문"],
  ["h1", "제목 1 (H1)"],
  ["h2", "제목 2 (H2)"],
  ["h3", "제목 3 (H3)"],
  ["h4", "제목 4 (H4)"],
  ["h5", "제목 5 (H5)"],
  ["h6", "제목 6 (H6)"]
];

function cloneProfile(profile: DocumentStyleProfile): DocumentStyleProfile {
  return structuredClone(profile);
}

function mergedProfile(current?: DocumentStyleProfile): DocumentStyleProfile {
  const defaults = defaultDocumentStyleProfile();
  if (!current) return cloneProfile(defaults);
  const merged = cloneProfile(current);
  for (const [role] of ROLE_LABELS) {
    if (!merged.roles[role]) merged.roles[role] = cloneProfile(defaults).roles[role];
  }
  if (!merged.page) merged.page = cloneProfile(defaults).page;
  return merged;
}

function numericInput(
  component: TextComponent,
  value: number | undefined,
  min: number,
  max: number,
  step: number,
  update: (value: number) => void
): void {
  component.inputEl.type = "number";
  component.inputEl.min = String(min);
  component.inputEl.max = String(max);
  component.inputEl.step = String(step);
  component.setValue(String(value ?? ""));
  component.onChange((raw: string) => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) update(parsed);
  });
}

function millimeters(hu: number | undefined): number {
  return Math.round(((hu ?? 0) / HU_PER_MM) * 10) / 10;
}

function hwpUnits(mm: number): number {
  return Math.round(mm * HU_PER_MM);
}

function points(hu: number | undefined): number {
  return Math.round(((hu ?? 0) / 100) * 10) / 10;
}

function hwpPoints(pt: number): number {
  return Math.round(pt * 100);
}

export class DocumentStyleModal extends Modal {
  private readonly draft: DocumentStyleProfile;
  private openRole: DocumentStyleRole = "body";

  constructor(
    app: App,
    current: DocumentStyleProfile | undefined,
    private readonly onSaveProfile: (profile: DocumentStyleProfile) => Promise<void>
  ) {
    super(app);
    this.draft = mergedProfile(current);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("hanmark-resizable-workspace-modal");
    contentEl.empty();
    contentEl.addClass("hanmark-document-style-modal");
    contentEl.createEl("h2", { text: "HanMark 문서 스타일 편집" });
    contentEl.createEl("p", {
      text: "빠른 HWPX와 미리보기에 적용됩니다. 본문과 제목 1~6은 각각 독립된 HWPX 스타일로 저장됩니다."
    });

    new Setting(contentEl)
      .setName("스타일 이름")
      .setDesc("내보내기 화면에 표시할 이름")
      .addText((text) => text.setValue(this.draft.name).onChange((value) => (this.draft.name = value)));

    for (const [role, label] of ROLE_LABELS) this.renderRole(contentEl, role, label);
    this.renderPage(contentEl);

    const actions = contentEl.createDiv({ cls: "hanmark-style-modal-actions" });
    actions.setCssStyles({ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" });
    const cancel = actions.createEl("button", { text: "취소" });
    cancel.onclick = () => this.close();
    const save = actions.createEl("button", { text: "저장하고 적용" });
    save.classList.add("mod-cta");
    save.onclick = async () => {
      save.disabled = true;
      try {
        const normalized = normalizeDocumentStyleProfile(this.draft);
        await this.onSaveProfile(normalized);
        this.close();
      } catch (error: unknown) {
        new Notice(`문서 스타일 저장 실패: ${errorMessage(error)}`);
        save.disabled = false;
      }
    };
  }

  private role(
    role: DocumentStyleRole
  ): RoleStyleProfile & { character: CharacterStyleProfile; paragraph: ParagraphStyleProfile } {
    const value = this.draft.roles[role] ?? {};
    value.character ??= {};
    value.paragraph ??= {};
    this.draft.roles[role] = value;
    return {
      ...value,
      character: value.character,
      paragraph: value.paragraph
    };
  }

  private renderRole(root: HTMLElement, role: DocumentStyleRole, label: string): void {
    const value = this.role(role);
    const card = root.createDiv({ cls: "hanmark-document-style-role" });
    card.classList.toggle("is-open", this.openRole === role);
    const heading = card.createEl("button", { cls: "hanmark-document-style-role-toggle" });
    heading.createSpan({ text: label });
    heading.createSpan({ text: this.openRole === role ? "▾" : "▸", cls: "hanmark-document-style-role-chevron" });
    heading.onclick = () => {
      this.openRole = role;
      this.onOpen();
    };
    if (this.openRole !== role) return;

    new Setting(card)
      .setName("한글 글꼴")
      .setDesc("HWPX에 기록할 한글 글꼴 이름. 해당 컴퓨터에 없으면 대체 글꼴을 사용합니다.")
      .addText((text) =>
        text
          .setPlaceholder("함초롬바탕")
          .setValue(value.character.fontFamily || "")
          .onChange((font) => {
            value.character.fontFamily = font;
          })
      );

    new Setting(card)
      .setName("영문·숫자 글꼴")
      .setDesc("비워 두면 한글 글꼴을 함께 사용합니다. 예: Times New Roman, Arial")
      .addText((text) =>
        text
          .setPlaceholder(value.character.fontFamily || "Times New Roman")
          .setValue(value.character.latinFontFamily || "")
          .onChange((font) => {
            value.character.latinFontFamily = font;
          })
      );

    new Setting(card)
      .setName("크기와 굵기")
      .addText((text) =>
        numericInput(text, value.character.fontSizePt, 4, 100, 0.5, (size) => {
          value.character.fontSizePt = size;
        })
      )
      .addToggle((toggle) =>
        toggle
          .setTooltip("굵게")
          .setValue(value.character.bold ?? role !== "body")
          .onChange((bold) => {
            value.character.bold = bold;
          })
      )
      .addToggle((toggle) =>
        toggle
          .setTooltip("밑줄")
          .setValue(value.character.underline ?? false)
          .onChange((underline) => {
            value.character.underline = underline;
          })
      )
      .addColorPicker((picker) =>
        picker.setValue(value.character.color || "#000000").onChange((selected) => {
          value.character.color = selected;
        })
      );

    new Setting(card)
      .setName("문단 정렬과 줄간격")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("JUSTIFY", "양쪽 정렬")
          .addOption("LEFT", "왼쪽")
          .addOption("CENTER", "가운데")
          .addOption("RIGHT", "오른쪽")
          .addOption("DISTRIBUTE", "배분 정렬")
          .setValue(value.paragraph.alignment || "JUSTIFY")
          .onChange((alignment) => {
            if (
              alignment === "JUSTIFY" ||
              alignment === "LEFT" ||
              alignment === "CENTER" ||
              alignment === "RIGHT" ||
              alignment === "DISTRIBUTE" ||
              alignment === "DISTRIBUTE_SPACE"
            ) {
              value.paragraph.alignment = alignment;
            }
          })
      )
      .addText((text) =>
        numericInput(text, value.paragraph.lineSpacingPercent, 70, 400, 5, (spacing) => {
          value.paragraph.lineSpacingPercent = spacing;
        })
      );

    new Setting(card)
      .setName("장평과 자간")
      .setDesc("장평 % / 자간 %")
      .addText((text) =>
        numericInput(text, value.character.widthPercent, 50, 200, 1, (width) => {
          value.character.widthPercent = width;
        })
      )
      .addText((text) =>
        numericInput(text, value.character.letterSpacingPercent, -50, 50, 1, (spacing) => {
          value.character.letterSpacingPercent = spacing;
        })
      );

    new Setting(card)
      .setName("들여쓰기와 좌우 여백")
      .setDesc("첫 줄 / 왼쪽 / 오른쪽, pt · 한글 F6 문단 모양과 같은 단위")
      .addText((text) =>
        numericInput(text, points(value.paragraph.firstLineIndentHu), -200, 500, 0.5, (pt) => {
          value.paragraph.firstLineIndentHu = hwpPoints(pt);
        })
      )
      .addText((text) =>
        numericInput(text, points(value.paragraph.marginLeftHu), 0, 500, 0.5, (pt) => {
          value.paragraph.marginLeftHu = hwpPoints(pt);
        })
      )
      .addText((text) =>
        numericInput(text, points(value.paragraph.marginRightHu), 0, 500, 0.5, (pt) => {
          value.paragraph.marginRightHu = hwpPoints(pt);
        })
      );

    new Setting(card)
      .setName("문단 앞뒤 간격")
      .setDesc("앞 / 뒤, pt")
      .addText((text) =>
        numericInput(text, points(value.paragraph.spaceBeforeHu), 0, 200, 0.5, (pt) => {
          value.paragraph.spaceBeforeHu = hwpPoints(pt);
        })
      )
      .addText((text) =>
        numericInput(text, points(value.paragraph.spaceAfterHu), 0, 200, 0.5, (pt) => {
          value.paragraph.spaceAfterHu = hwpPoints(pt);
        })
      );

    new Setting(card)
      .setName("다음 문단과 함께")
      .setDesc("현재 문단과 다음 문단이 서로 다른 페이지로 나뉘지 않게 합니다.")
      .addToggle((toggle) =>
        toggle.setValue(value.paragraph.keepWithNext ?? role !== "body").onChange((enabled) => {
          value.paragraph.keepWithNext = enabled;
        })
      );
  }

  private renderPage(root: HTMLElement): void {
    const page = this.draft.page;
    if (!page) return;
    const card = root.createDiv({ cls: "hanmark-document-style-page" });
    card.createEl("h3", { text: "페이지 여백" });
    const fields: Array<["top" | "bottom" | "left" | "right", string]> = [
      ["top", "위"], ["bottom", "아래"], ["left", "왼쪽"], ["right", "오른쪽"]
    ];
    for (const [key, label] of fields) {
      new Setting(card)
        .setName(`${label} 여백`)
        .setDesc("mm")
        .addText((text) =>
          numericInput(text, millimeters(page.margins[key]), 0, 100, 0.5, (mm) => {
            page.margins[key] = hwpUnits(mm);
          })
        );
    }
  }

  onClose(): void {
    this.modalEl.removeClass("hanmark-resizable-workspace-modal");
    this.contentEl.empty();
  }
}
