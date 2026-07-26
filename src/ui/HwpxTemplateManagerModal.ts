import { type App, Modal, Notice, Setting } from "obsidian";
import { defaultDocumentStyleProfile, documentStyleSummary, type DocumentStyleProfile } from "../io/documentStyle";
import {
  activeDocumentTemplate,
  availableDocumentTemplates,
  createDocumentTemplate,
  deleteDocumentTemplate,
  duplicateDocumentTemplate,
  importDocumentStyle,
  renameDocumentTemplate,
  setActiveDocumentTemplate
} from "../io/documentStyleSettings";
import {
  clearTableStyle,
  importTableStyle,
  type HanmarkSettingsPlugin
} from "../io/tableStyle";
import { errorMessage } from "../utils/errors";

type Refresh = () => void;

class TemplateNameModal extends Modal {
  private value: string;

  constructor(
    app: App,
    title: string,
    initial: string,
    private readonly submit: (value: string) => Promise<void>
  ) {
    super(app);
    this.titleEl.setText(title);
    this.value = initial;
  }

  onOpen(): void {
    const { contentEl } = this;
    new Setting(contentEl)
      .setName("템플릿 이름")
      .addText((text) => {
        text.setValue(this.value).onChange((value) => (this.value = value));
        window.setTimeout(() => {
          text.inputEl.focus();
          text.inputEl.select();
        });
      });
    const actions = contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    const cancel = actions.createEl("button", { text: "취소" });
    cancel.onclick = () => this.close();
    const save = actions.createEl("button", { text: "확인" });
    save.classList.add("mod-cta");
    save.onclick = async () => {
      const name = this.value.replace(/\s+/g, " ").trim();
      if (!name) {
        new Notice("템플릿 이름을 입력하세요.");
        return;
      }
      save.disabled = true;
      try {
        await this.submit(name);
        this.close();
      } catch (error: unknown) {
        new Notice(errorMessage(error));
        save.disabled = false;
      }
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function confirmDelete(app: App, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const modal = new Modal(app);
    modal.titleEl.setText("사용자 HWPX 템플릿 삭제");
    modal.contentEl.createEl("p", { text: `“${name}” 템플릿을 삭제할까요? 내보낸 HWPX 파일에는 영향이 없습니다.` });
    const actions = modal.contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    const cancel = actions.createEl("button", { text: "취소" });
    cancel.onclick = () => {
      finish(false);
      modal.close();
    };
    const remove = actions.createEl("button", { text: "삭제" });
    remove.classList.add("mod-warning");
    remove.onclick = () => {
      finish(true);
      modal.close();
    };
    modal.onClose = () => finish(false);
    modal.open();
  });
}

export class HwpxTemplateManagerModal extends Modal {
  private selectedId: string;

  constructor(
    app: App,
    private readonly plugin: HanmarkSettingsPlugin,
    private readonly onEditProfile: (profile: DocumentStyleProfile) => void,
    private readonly onChanged: Refresh
  ) {
    super(app);
    this.selectedId = activeDocumentTemplate(plugin).id;
  }

  onOpen(): void {
    this.modalEl.addClass("hanmark-resizable-workspace-modal");
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("hanmark-template-manager");
    contentEl.createEl("h2", { text: "HWPX 템플릿" });
    contentEl.createEl("small", {
      cls: "hanmark-window-size-hint",
      text: "큰 화면으로 열렸습니다. 창 우하단을 드래그하면 크기를 조절할 수 있습니다."
    });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "글꼴·제목·문단·페이지와 표 스타일을 템플릿별로 함께 보관합니다. HWPX 내보내기와 미리보기에 즉시 적용됩니다."
    });

    const items = availableDocumentTemplates(this.plugin);
    if (!items.some((item) => item.id === this.selectedId)) this.selectedId = activeDocumentTemplate(this.plugin).id;
    for (const [builtIn, heading] of [[true, "내장 템플릿"], [false, "내 템플릿"]] as const) {
      const group = contentEl.createDiv({ cls: "hanmark-template-group" });
      group.createEl("h3", { text: heading });
      const matches = items.filter((item) => item.builtIn === builtIn);
      if (!matches.length) group.createEl("p", { text: "아직 만든 템플릿이 없습니다.", cls: "setting-item-description" });
      for (const item of matches) {
        const row = group.createDiv({ cls: `hanmark-template-row${item.id === this.selectedId ? " is-selected" : ""}` });
        const select = row.createEl("input");
        select.type = "radio";
        select.name = "hanmark-template";
        select.checked = item.id === this.selectedId;
        select.onchange = () => {
          this.selectedId = item.id;
          this.render();
        };
        const info = row.createDiv({ cls: "hanmark-template-info" });
        info.createEl("strong", { text: item.name });
        const details = item.documentStyle ? documentStyleSummary(item.documentStyle) : "Kordoc 기본 문서 스타일";
        info.createEl("small", {
          text: `${details}${item.tableStyle?.tables?.length ? ` · 표 ${item.tableStyle.tables.length}개` : ""}`
        });
        if (item.id === activeDocumentTemplate(this.plugin).id) row.createSpan({ text: "사용 중", cls: "hanmark-template-active" });
        row.onclick = (event) => {
          if (event.target instanceof HTMLElement && event.target.tagName === "INPUT") return;
          this.selectedId = item.id;
          this.render();
        };
      }
    }

    const selected = items.find((item) => item.id === this.selectedId) || items[0];
    if (!selected) {
      contentEl.createEl("p", { text: "사용할 수 있는 HWPX 템플릿이 없습니다." });
      return;
    }
    const actions = contentEl.createDiv({ cls: "hanmark-template-actions" });
    const apply = actions.createEl("button", { text: "적용" });
    apply.classList.add("mod-cta");
    apply.onclick = async () => {
      await setActiveDocumentTemplate(this.plugin, selected.id);
      this.onChanged();
      this.render();
    };
    const edit = actions.createEl("button", { text: selected.builtIn ? "복제 후 편집" : "편집" });
    edit.onclick = async () => {
      const editable = selected.builtIn ? await duplicateDocumentTemplate(this.plugin, selected.id) : selected;
      await setActiveDocumentTemplate(this.plugin, editable.id);
      this.onChanged();
      this.close();
      this.onEditProfile(editable.documentStyle || defaultDocumentStyleProfile());
    };
    const duplicate = actions.createEl("button", { text: "복제" });
    duplicate.onclick = async () => {
      const copied = await duplicateDocumentTemplate(this.plugin, selected.id);
      this.selectedId = copied.id;
      this.onChanged();
      this.render();
    };
    const importTable = actions.createEl("button", { text: "표 스타일 가져오기" });
    importTable.onclick = async () => {
      await setActiveDocumentTemplate(this.plugin, selected.id);
      if (await importTableStyle(this.plugin)) {
        this.selectedId = activeDocumentTemplate(this.plugin).id;
        this.onChanged();
        this.render();
      }
    };
    if (!selected.builtIn) {
      const rename = actions.createEl("button", { text: "이름 변경" });
      rename.onclick = () => new TemplateNameModal(this.app, "HWPX 템플릿 이름 변경", selected.name, async (name) => {
        await renameDocumentTemplate(this.plugin, selected.id, name);
        this.onChanged();
        this.render();
      }).open();
      const remove = actions.createEl("button", { text: "삭제" });
      remove.onclick = async () => {
        if (!(await confirmDelete(this.app, selected.name))) return;
        await deleteDocumentTemplate(this.plugin, selected.id);
        this.selectedId = activeDocumentTemplate(this.plugin).id;
        this.onChanged();
        this.render();
      };
      if (selected.tableStyle?.tables?.length) {
        const clearTable = actions.createEl("button", { text: "표 스타일 제거" });
        clearTable.onclick = async () => {
          await setActiveDocumentTemplate(this.plugin, selected.id);
          await clearTableStyle(this.plugin);
          this.selectedId = activeDocumentTemplate(this.plugin).id;
          this.onChanged();
          this.render();
        };
      }
    }

    const add = contentEl.createDiv({ cls: "hanmark-template-add" });
    const create = add.createEl("button", { text: "새 템플릿" });
    create.onclick = () => new TemplateNameModal(this.app, "새 HWPX 템플릿", "새 사용자 템플릿", async (name) => {
      const current = activeDocumentTemplate(this.plugin);
      const record = await createDocumentTemplate(
        this.plugin,
        name,
        current.documentStyle || defaultDocumentStyleProfile(),
        current.tableStyle
      );
      this.selectedId = record.id;
      this.onChanged();
      this.close();
      this.onEditProfile(record.documentStyle || defaultDocumentStyleProfile());
    }).open();
    const importButton = add.createEl("button", { text: "HWPX에서 추가" });
    importButton.onclick = async () => {
      if (await importDocumentStyle(this.plugin)) {
        this.selectedId = activeDocumentTemplate(this.plugin).id;
        this.onChanged();
        this.render();
      }
    };
    const close = add.createEl("button", { text: "닫기" });
    close.onclick = () => this.close();
  }

  onClose(): void {
    this.modalEl.removeClass("hanmark-resizable-workspace-modal");
    this.contentEl.empty();
  }
}
