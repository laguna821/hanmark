import { Modal, type App } from "obsidian";
import type { GongmunFrame } from "../io/gongmunFormId";
import { listGongmunLooks, type GongmunLookEntry } from "../io/gongmunForms";
import { t } from "../i18n";
import { renderLookChooser, type GongmunPickerHost } from "./gongmunFormPicker";

/**
 * The look chooser in its own window (R-030), for places that have no room for the
 * inline one: the status bar menu and "several forms at once". Same list, same
 * search, same favorites.
 */
export class GongmunLookModal extends Modal {
  constructor(
    app: App,
    private readonly input: {
      host: GongmunPickerHost;
      frame: GongmunFrame;
      current: string;
      /** Narrows the list to the looks the caller can use. */
      filter?: (look: GongmunLookEntry) => boolean;
      /** Window title; the general "choose a look" title when omitted. */
      title?: string;
      pick: (look: string, name: string) => void;
    }
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("hanmark-look-modal");
    this.titleEl.setText(this.input.title ?? t("gongmun.look.choose"));
    const search = renderLookChooser(this.contentEl.createDiv(), {
      host: this.input.host,
      frame: this.input.frame,
      current: this.input.current,
      idPrefix: "hanmark-look-modal",
      filter: this.input.filter,
      onPick: (look) => {
        const name = listGongmunLooks(this.input.host.library, this.input.frame).find((item) => item.id === look)?.name ?? "";
        this.close();
        this.input.pick(look, name);
      },
      onClose: () => this.close()
    });
    search.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
