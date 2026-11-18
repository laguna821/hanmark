import { type App, Modal, Notice, Platform, Setting } from "obsidian";
import {
  defaultDocumentStyleProfile,
  documentStyleSummary,
  editableDocumentStyle,
  type DocumentStyleProfile
} from "../io/documentStyle";
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
import {
  activeGongmunTemplate,
  getTemplateLibrary,
  listGongmunStyleChoices,
  setActiveGongmunTemplateInMemory,
  setTemplateFontSubstitutionsInMemory,
  templateDisplayName,
  type HanmarkTemplateItem
} from "../io/templateLibrary";
import { gongmunPresetLabel } from "../io/gongmunExport";
import { resolveDocumentStyleFonts } from "../io/fontResolver";
import { fontGuideLines } from "../io/fontGuide";
import type { FileGateway } from "../io/fileGateway";
import { GongmunStyleModal } from "./GongmunStyleModal";
import { errorMessage } from "../utils/errors";
import { runWithNotice } from "./runWithNotice";
import { t } from "../i18n";

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
      .setName(t("template.manager.nameLabel"))
      .addText((text) => {
        text.setValue(this.value).onChange((value) => (this.value = value));
        window.setTimeout(() => {
          text.inputEl.focus();
          text.inputEl.select();
        });
      });
    const actions = contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    const cancel = actions.createEl("button", { text: t("common.cancel") });
    cancel.onclick = () => this.close();
    const save = actions.createEl("button", { text: t("common.confirm") });
    save.classList.add("mod-cta");
    save.onclick = async () => {
      const name = this.value.replace(/\s+/g, " ").trim();
      if (!name) {
        new Notice(t("template.manager.nameRequired"));
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
    modal.titleEl.setText(t("template.manager.deleteTitle"));
    modal.contentEl.createEl("p", { text: t("template.manager.deleteMessage", { name }) });
    const actions = modal.contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    const cancel = actions.createEl("button", { text: t("common.cancel") });
    cancel.onclick = () => {
      finish(false);
      modal.close();
    };
    const remove = actions.createEl("button", { text: t("template.manager.delete") });
    remove.classList.add("mod-warning");
    remove.onclick = () => {
      finish(true);
      modal.close();
    };
    modal.onClose = () => finish(false);
    modal.open();
  });
}

function fontPlatform(): NodeJS.Platform {
  if (Platform.isWin) return "win32";
  if (Platform.isMacOS) return "darwin";
  return "linux";
}

export class HwpxTemplateManagerModal extends Modal {
  private selectedId: string;
  private fontCheckVersion = 0;

  constructor(
    app: App,
    private readonly plugin: HanmarkSettingsPlugin,
    private readonly onEditProfile: (profile: DocumentStyleProfile) => void,
    private readonly onChanged: Refresh,
    private readonly gateway?: FileGateway
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
    contentEl.createEl("h2", { text: t("settings.hwpxTemplate.heading") });
    contentEl.createEl("small", {
      cls: "hanmark-window-size-hint",
      text: t("template.manager.sizeHint")
    });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: t("template.manager.desc")
    });

    const items = availableDocumentTemplates(this.plugin);
    if (!items.some((item) => item.id === this.selectedId)) this.selectedId = activeDocumentTemplate(this.plugin).id;
    for (const [builtIn, heading] of [[true, t("template.manager.builtIn")], [false, t("template.manager.custom")]] as const) {
      const group = contentEl.createDiv({ cls: "hanmark-template-group" });
      group.createEl("h3", { text: heading });
      const matches = items.filter((item) => item.builtIn === builtIn);
      if (!matches.length) group.createEl("p", { text: t("template.manager.none"), cls: "setting-item-description" });
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
        info.createEl("strong", { text: templateDisplayName(item) });
        const details = item.documentStyle ? documentStyleSummary(item.documentStyle) : t("template.manager.kordocDefault");
        info.createEl("small", {
          text: `${details}${item.tableStyle?.tables?.length ? t("template.manager.tables", { count: item.tableStyle.tables.length }) : ""}`
        });
        if (item.id === activeDocumentTemplate(this.plugin).id) row.createSpan({ text: t("template.manager.active"), cls: "hanmark-template-active" });
        row.onclick = (event) => {
          if (event.target instanceof HTMLElement && event.target.tagName === "INPUT") return;
          this.selectedId = item.id;
          this.render();
        };
      }
    }

    const selected = items.find((item) => item.id === this.selectedId) || items[0];
    if (!selected) {
      contentEl.createEl("p", { text: t("template.manager.empty") });
      return;
    }
    const actions = contentEl.createDiv({ cls: "hanmark-template-actions" });
    const apply = actions.createEl("button", { text: t("template.manager.apply") });
    apply.classList.add("mod-cta");
    apply.onclick = () => {
      void runWithNotice(t("template.manager.applyFailed"), async () => {
        await setActiveDocumentTemplate(this.plugin, selected.id);
        this.onChanged();
        this.render();
      });
    };
    const edit = actions.createEl("button", { text: selected.builtIn ? t("template.manager.duplicateEdit") : t("template.manager.edit") });
    edit.onclick = () => {
      void runWithNotice(t("template.manager.editFailed"), async () => {
        const editable = selected.builtIn ? await duplicateDocumentTemplate(this.plugin, selected.id) : selected;
        await setActiveDocumentTemplate(this.plugin, editable.id);
        this.onChanged();
        this.close();
        this.onEditProfile(editableDocumentStyle(editable));
      });
    };
    const duplicate = actions.createEl("button", { text: t("template.manager.duplicate") });
    duplicate.onclick = () => {
      void runWithNotice(t("template.manager.duplicateFailed"), async () => {
        const copied = await duplicateDocumentTemplate(this.plugin, selected.id);
        this.selectedId = copied.id;
        this.onChanged();
        this.render();
      });
    };
    const importTable = actions.createEl("button", { text: t("template.manager.importTable") });
    importTable.onclick = () => {
      void runWithNotice(t("template.manager.importTableFailed"), async () => {
        await setActiveDocumentTemplate(this.plugin, selected.id);
        if (await importTableStyle(this.plugin)) {
          this.selectedId = activeDocumentTemplate(this.plugin).id;
          this.onChanged();
          this.render();
        }
      });
    };
    if (!selected.builtIn) {
      const rename = actions.createEl("button", { text: t("template.manager.rename") });
      rename.onclick = () => new TemplateNameModal(this.app, t("template.manager.renameTitle"), selected.name, async (name) => {
        await renameDocumentTemplate(this.plugin, selected.id, name);
        this.onChanged();
        this.render();
      }).open();
      const remove = actions.createEl("button", { text: t("template.manager.delete") });
      remove.onclick = () => {
        void runWithNotice(t("template.manager.deleteFailed"), async () => {
          if (!(await confirmDelete(this.app, selected.name))) return;
          await deleteDocumentTemplate(this.plugin, selected.id);
          this.selectedId = activeDocumentTemplate(this.plugin).id;
          this.onChanged();
          this.render();
        });
      };
      if (selected.tableStyle?.tables?.length) {
        const clearTable = actions.createEl("button", { text: t("template.manager.clearTable") });
        clearTable.onclick = () => {
          void runWithNotice(t("template.manager.clearTableFailed"), async () => {
            await setActiveDocumentTemplate(this.plugin, selected.id);
            await clearTableStyle(this.plugin);
            this.selectedId = activeDocumentTemplate(this.plugin).id;
            this.onChanged();
            this.render();
          });
        };
      }
    }

    this.renderFontGuide(contentEl, selected);

    const add = contentEl.createDiv({ cls: "hanmark-template-add" });
    const create = add.createEl("button", { text: t("template.manager.new") });
    create.onclick = () => new TemplateNameModal(this.app, t("template.manager.newTitle"), t("template.manager.newName"), async (name) => {
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
      this.onEditProfile(editableDocumentStyle(record));
    }).open();
    const importButton = add.createEl("button", { text: t("template.manager.importHwpx") });
    importButton.onclick = () => {
      void runWithNotice(t("template.manager.importHwpxFailed"), async () => {
        if (await importDocumentStyle(this.plugin)) {
          this.selectedId = activeDocumentTemplate(this.plugin).id;
          this.onChanged();
          this.render();
        }
      });
    };

    this.renderGongmunStyles(contentEl);

    const footer = contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    const close = footer.createEl("button", { text: t("common.close") });
    close.onclick = () => this.close();
  }

  /**
   * Font guide for the selected template: which fonts this computer lacks, what
   * the preview draws instead, where to get them, and the opt-in rules that make
   * exports write a substitute (R-018, 2.7.0 font decision).
   */
  private renderFontGuide(container: HTMLElement, selected: HanmarkTemplateItem): void {
    const section = container.createDiv({ cls: "hanmark-template-fonts" });
    section.createEl("h3", { text: t("template.fonts.heading") });
    const status = section.createEl("p", { cls: "setting-item-description", text: t("template.fonts.checking") });
    const rules = selected.fontSubstitutions ?? {};
    const ruleText = Object.entries(rules).map(([from, to]) => `${from} → ${to}`).join(", ");
    if (ruleText) section.createEl("p", { text: t("template.fonts.rules", { rules: ruleText }) });
    const actions = section.createDiv({ cls: "hanmark-template-actions" });
    if (ruleText && !selected.builtIn) {
      actions.createEl("button", { text: t("template.fonts.clearRules") }).onclick = () => {
        void runWithNotice(t("template.fonts.saveFailed"), async () => {
          setTemplateFontSubstitutionsInMemory(this.plugin, selected.id, undefined);
          await this.plugin.saveSettings();
          this.onChanged();
          this.render();
        });
      };
    }
    const version = ++this.fontCheckVersion;
    const profile = selected.documentStyle ?? defaultDocumentStyleProfile();
    void resolveDocumentStyleFonts(profile, { platform: fontPlatform(), rules }).then(
      (resolved) => {
        if (version !== this.fontCheckVersion || !status.isConnected) return;
        if (!resolved.missing.length) {
          status.setText(t("template.fonts.allInstalled"));
          return;
        }
        status.setText(t("template.fonts.keepNames"));
        const list = section.createEl("ul");
        for (const line of fontGuideLines(resolved.missing)) list.createEl("li", { text: line });
        if (selected.builtIn) {
          section.createEl("p", { cls: "setting-item-description", text: t("template.fonts.builtInHint") });
          return;
        }
        section.createEl("p", { cls: "setting-item-description", text: t("template.fonts.saveRulesDesc") });
        const save = actions.createEl("button", { text: t("template.fonts.saveRules") });
        save.classList.add("mod-cta");
        save.onclick = () => {
          void runWithNotice(t("template.fonts.saveFailed"), async () => {
            const next = { ...rules };
            for (const missing of resolved.missing) next[missing.family] = missing.previewFallback;
            setTemplateFontSubstitutionsInMemory(this.plugin, selected.id, next);
            await this.plugin.saveSettings();
            new Notice(t("template.fonts.saved"));
            this.onChanged();
            this.render();
          });
        };
      },
      (error: unknown) => {
        if (version === this.fontCheckVersion && status.isConnected) status.setText(errorMessage(error));
      }
    );
  }

  private renderGongmunStyles(container: HTMLElement): void {
    const section = container.createDiv({ cls: "hanmark-template-group" });
    section.createEl("h3", { text: t("template.gongmun.heading") });
    section.createEl("p", { cls: "setting-item-description", text: t("template.gongmun.desc") });
    const activeId = activeGongmunTemplate(this.plugin)?.id ?? "";
    // Built-in styles first (for example Hallym University), then "none", then the user's own.
    const all = listGongmunStyleChoices(this.plugin);
    const none = { id: "", name: t("gongmun.export.styleNone"), builtIn: false, description: undefined, group: undefined, preset: undefined };
    const choices = [...all.filter((choice) => choice.builtIn), none, ...all.filter((choice) => !choice.builtIn)];
    for (const choice of choices) {
      const row = section.createDiv({ cls: `hanmark-template-row${choice.id === activeId ? " is-selected" : ""}` });
      const radio = row.createEl("input");
      radio.type = "radio";
      radio.name = "hanmark-gongmun-style";
      radio.checked = choice.id === activeId;
      radio.onchange = () => {
        void runWithNotice(t("template.gongmun.selectFailed"), async () => {
          setActiveGongmunTemplateInMemory(this.plugin, choice.id);
          await this.plugin.saveSettings();
          this.onChanged();
          this.render();
        });
      };
      const info = row.createDiv({ cls: "hanmark-template-info" });
      info.createEl("strong", { text: choice.builtIn && choice.group ? `${choice.group} · ${choice.name}` : choice.name });
      if (choice.builtIn) {
        if (choice.description) info.createEl("small", { text: choice.description });
        info.createEl("small", { text: t("template.gongmun.builtinBadge") });
      } else if (choice.id) {
        // A user's form makes one document type (R-026).
        info.createEl("small", {
          text: t("gongmun.form.customDesc", { preset: gongmunPresetLabel(choice.preset ?? getTemplateLibrary(this.plugin).activeGongmunPreset) })
        });
      } else {
        info.createEl("small", { text: t("template.gongmun.standardDesc") });
      }
      if (choice.id === activeId) row.createSpan({ text: t("template.manager.active"), cls: "hanmark-template-active" });
      if (choice.id && !choice.builtIn && this.gateway) {
        const edit = row.createEl("button", { text: t("gongmun.form.edit") });
        edit.onclick = () => this.openGongmunStyle(choice.id);
      }
    }
    if (this.gateway) {
      const add = section.createDiv({ cls: "hanmark-template-add" });
      add.createEl("button", { text: t("gongmun.form.new") }).onclick = () => this.openGongmunStyle(null);
      add.createEl("button", { text: t("gongmun.sample.title"), attr: { id: "hanmark-form-from-sample" } }).onclick = () => this.openGongmunStyle(null, true);
    }
  }

  private openGongmunStyle(id: string | null, startFromSample = false): void {
    if (!this.gateway) return;
    new GongmunStyleModal(
      this.app,
      {
        templateHost: this.plugin,
        gateway: this.gateway,
        startFromSample,
        changed: () => {
          this.onChanged();
          this.render();
        }
      },
      id
    ).open();
  }

  onClose(): void {
    this.fontCheckVersion += 1;
    this.modalEl.removeClass("hanmark-resizable-workspace-modal");
    this.contentEl.empty();
  }
}
