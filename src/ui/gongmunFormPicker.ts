import { describeGongmunForm, gongmunPresetLabel } from "../io/gongmunExport";
import { FRAME_OPTIONS, GONGMUN_FRAMES, LOOK_BASIC, parseGongmunFormId, type GongmunFrame } from "../io/gongmunFormId";
import {
  gongmunFrameLabel,
  gongmunFrameOptionLabel,
  gongmunLookName,
  listGongmunLooks,
  withGongmunFrame,
  withGongmunFrameOption,
  withGongmunLook,
  type GongmunLookEntry
} from "../io/gongmunForms";
import { getTemplateLibrary, type TemplateLibraryHost } from "../io/templateLibrary";
import { t } from "../i18n";

/**
 * Frame and look picker for official documents (3.0.0, R-030). Every surface that
 * used to show one list of ten forms (export window, HWPX preview toolbar, several
 * forms at once, status bar) shows the same two choices: a frame select, and a look
 * button that opens a searchable chooser. A look list is never a 52-item dropdown:
 * typing part of a name filters it, and recent looks, favorites, 공통, the
 * institution forms, and the user's forms stay on top.
 */
export interface GongmunPickerHost {
  library: TemplateLibraryHost;
  /** Stars or unstars a look and saves. */
  toggleFavorite(look: string): Promise<void> | void;
}

export interface GongmunFormPickerInput {
  host: GongmunPickerHost;
  formId: string;
  /** Prefix of element ids, unique per surface. */
  idPrefix: string;
  disabled?: boolean;
  /** One line for toolbars: no descriptions. */
  compact?: boolean;
  onChange(formId: string): void;
}

function normalized(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, "").toLowerCase();
}

export interface LookChooserInput {
  host: GongmunPickerHost;
  frame: GongmunFrame;
  /** Look id that is chosen now. */
  current: string;
  idPrefix: string;
  /** Narrows the list (the style window offers only the looks a form can start from). */
  filter?: (look: GongmunLookEntry) => boolean;
  onPick(look: string): void;
  onClose(): void;
}

interface LookSection {
  key: string;
  title: string;
  looks: GongmunLookEntry[];
}

/** Sections of the chooser for a query: pinned sections only while nothing is typed. */
export function lookSections(
  looks: readonly GongmunLookEntry[],
  favorites: readonly string[],
  recent: readonly string[],
  query: string
): LookSection[] {
  const wanted = normalized(query);
  const byId = new Map(looks.map((look) => [look.id, look]));
  const sections: LookSection[] = [];
  if (!wanted) {
    const pick = (ids: readonly string[]): GongmunLookEntry[] =>
      ids.map((id) => byId.get(id)).filter((look): look is GongmunLookEntry => look !== undefined);
    const recentLooks = pick(recent);
    if (recentLooks.length) sections.push({ key: "recent", title: t("gongmun.look.group.recent"), looks: recentLooks });
    const favoriteLooks = pick(favorites);
    if (favoriteLooks.length) sections.push({ key: "favorite", title: t("gongmun.look.group.favorite"), looks: favoriteLooks });
  }
  for (const look of looks) {
    if (wanted && !normalized(look.name).includes(wanted)) continue;
    const key = `${look.groupKey}:${look.group}`;
    const section = sections.find((item) => item.key === key);
    if (section) section.looks.push(look);
    else sections.push({ key, title: look.group, looks: [look] });
  }
  return sections;
}

const AGENCY_SECTION = /^(?:ministry|office|agency|committee|other):/u;

/** Room the open panel needs before it opens upwards instead (px). */
const PANEL_MIN_ROOM = 260;
const PANEL_MAX_ROOM = 380;

/** The searchable look list. Returns the search input so the caller can focus it. */
export function renderLookChooser(root: HTMLElement, input: LookChooserInput): HTMLInputElement {
  root.empty();
  root.addClass("hanmark-look-chooser");
  const listId = `${input.idPrefix}-look-list`;
  const search = root.createEl("input", {
    cls: "hanmark-look-search",
    attr: {
      id: `${input.idPrefix}-look-search`,
      type: "search",
      role: "combobox",
      placeholder: t("gongmun.look.search"),
      "aria-label": t("gongmun.look.search"),
      "aria-controls": listId,
      "aria-expanded": "true",
      autocomplete: "off"
    }
  });
  const list = root.createDiv({ cls: "hanmark-look-list", attr: { id: listId, role: "listbox", "aria-label": t("gongmun.look.label") } });
  let active = 0;

  const options = (): HTMLElement[] => Array.from(list.querySelectorAll<HTMLElement>(".hanmark-look-option"));
  // `scroll` only for keyboard moves: opening the list keeps its top (the pinned looks) in view.
  const mark = (scroll = false): void => {
    const all = options();
    active = Math.max(0, Math.min(active, all.length - 1));
    all.forEach((option, index) => {
      option.classList.toggle("is-active", index === active);
      if (index === active) {
        search.setAttribute("aria-activedescendant", option.id);
        if (scroll) option.scrollIntoView?.({ block: "nearest" });
      }
    });
    if (!all.length) search.removeAttribute("aria-activedescendant");
  };

  const draw = (): void => {
    list.empty();
    const library = getTemplateLibrary(input.host.library);
    const favorites = library.gongmunLookFavorites;
    const offered = listGongmunLooks(input.host.library, input.frame).filter((look) => input.filter?.(look) ?? true);
    const sections = lookSections(offered, favorites, library.gongmunLookRecent, search.value);
    if (!sections.length) list.createDiv({ cls: "hanmark-look-empty", text: t("gongmun.look.empty") });
    let index = 0;
    for (const section of sections) {
      const group = list.createDiv({ cls: "hanmark-look-group", attr: { role: "group", "aria-label": section.title } });
      const title = group.createDiv({ cls: "hanmark-look-group-title" });
      title.createSpan({ cls: "hanmark-look-group-name", text: section.title });
      // Agency groups say how many agencies they hold (부 19곳, 청 20곳 …).
      if (AGENCY_SECTION.test(section.key)) {
        title.createSpan({ cls: "hanmark-look-group-count", text: t("gongmun.look.group.count", { count: section.looks.length }) });
      }
      for (const look of section.looks) {
        const row = group.createDiv({
          cls: "hanmark-look-option",
          attr: {
            id: `${input.idPrefix}-look-option-${index}`,
            role: "option",
            "aria-selected": String(look.id === input.current),
            "data-look": look.id,
            "data-section": section.key
          }
        });
        index += 1;
        const pick = row.createEl("button", { cls: "hanmark-look-pick", attr: { type: "button", tabindex: "-1" } });
        pick.createSpan({ cls: "hanmark-look-name", text: look.name });
        if (look.smallSample) {
          pick.createSpan({
            cls: "hanmark-look-badge",
            text: t("gongmun.look.smallSample"),
            attr: { title: t("gongmun.look.smallSampleTip") }
          });
        }
        pick.onclick = () => input.onPick(look.id);
        if (look.id !== LOOK_BASIC) {
          const starred = favorites.includes(look.id);
          const star = row.createEl("button", {
            cls: "hanmark-look-star",
            text: starred ? "★" : "☆",
            attr: {
              type: "button",
              "aria-pressed": String(starred),
              "aria-label": t(starred ? "gongmun.look.unstar" : "gongmun.look.star", { name: look.name }),
              title: t(starred ? "gongmun.look.unstar" : "gongmun.look.star", { name: look.name })
            }
          });
          star.onclick = async (event) => {
            event.stopPropagation();
            await input.host.toggleFavorite(look.id);
            draw();
            search.focus();
          };
        }
      }
    }
    mark();
  };

  search.oninput = () => {
    active = 0;
    draw();
  };
  search.onkeydown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = options().length;
      if (count) active = (active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
      mark(true);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const look = options()[active]?.getAttribute("data-look");
      if (look) input.onPick(look);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      input.onClose();
    }
  };
  draw();
  // Start on the chosen look (its first row, pinned or not), so Enter keeps it.
  const chosen = options().findIndex((option) => option.getAttribute("data-look") === input.current);
  if (chosen >= 0) {
    active = chosen;
    mark();
  }
  return search;
}

/** Frame select, look button with its chooser, and the frame's switches. */
export function renderGongmunFormPicker(root: HTMLElement, input: GongmunFormPickerInput): void {
  const library = input.host.library;
  const form = describeGongmunForm(library, input.formId);
  const picker = root.createDiv({ cls: input.compact ? "hanmark-form-picker is-compact" : "hanmark-form-picker" });
  const frame = form?.frame ?? "report";

  const frameField = picker.createDiv({ cls: "hanmark-form-picker-field" });
  const frameId = `${input.idPrefix}-frame`;
  frameField.createEl("label", { text: t("gongmun.frame.label"), cls: "hanmark-export-field-label", attr: { for: frameId } });
  const frameSelect = frameField.createEl("select", { attr: { id: frameId } });
  for (const item of GONGMUN_FRAMES) frameSelect.createEl("option", { value: item, text: gongmunFrameLabel(item) });
  frameSelect.value = frame;
  frameSelect.disabled = Boolean(input.disabled);
  frameSelect.onchange = () => input.onChange(withGongmunFrame(library, input.formId, frameSelect.value as GongmunFrame));

  const lookField = picker.createDiv({ cls: "hanmark-form-picker-field hanmark-form-picker-look" });
  const lookId = `${input.idPrefix}-look`;
  lookField.createEl("label", { text: t("gongmun.look.label"), cls: "hanmark-export-field-label", attr: { for: lookId } });
  const lookButton = lookField.createEl("button", {
    cls: "hanmark-look-button",
    attr: { id: lookId, type: "button", "aria-haspopup": "listbox", "aria-expanded": "false", title: t("gongmun.look.choose") }
  });
  lookButton.createSpan({ cls: "hanmark-look-button-name", text: gongmunLookName(library, input.formId) });
  lookButton.createSpan({ cls: "hanmark-look-button-caret", text: "▾", attr: { "aria-hidden": "true" } });
  lookButton.disabled = Boolean(input.disabled);
  const panel = lookField.createDiv({ cls: "hanmark-look-panel hanmark-is-hidden" });
  const close = (): void => {
    panel.addClass("hanmark-is-hidden");
    panel.empty();
    lookButton.setAttribute("aria-expanded", "false");
  };
  lookButton.onclick = () => {
    if (!panel.classList.contains("hanmark-is-hidden")) {
      close();
      return;
    }
    panel.removeClass("hanmark-is-hidden");
    lookButton.setAttribute("aria-expanded", "true");
    const search = renderLookChooser(panel, {
      host: input.host,
      frame,
      current: form?.look ?? LOOK_BASIC,
      idPrefix: input.idPrefix,
      onPick: (look) => {
        close();
        input.onChange(withGongmunLook(library, input.formId, look));
      },
      onClose: () => {
        close();
        lookButton.focus();
      }
    });
    // Near the right edge (the preview toolbar) the panel opens leftwards instead of being cut off.
    const bounds = (panel.closest(".view-content, .modal") ?? panel.ownerDocument.documentElement).getBoundingClientRect();
    panel.toggleClass("is-right", panel.getBoundingClientRect().right > bounds.right);
    // The panel stays inside its window: it opens upwards when there is more room above
    // (the export window keeps its export button visible), and its list never runs off the edge.
    const anchor = lookButton.getBoundingClientRect();
    // A window may mark what the open panel must not cover (the export window's footer
    // with the export button): the room below ends there, however tall the window is.
    const container = panel.closest(".view-content, .modal") ?? panel.ownerDocument.documentElement;
    const floors = Array.from(container.querySelectorAll("[data-hanmark-picker-floor]"))
      .map((element) => element.getBoundingClientRect().top)
      .filter((top) => top >= anchor.bottom);
    const bottom = Math.min(bounds.bottom, ...floors);
    const below = bottom - anchor.bottom - 12;
    const above = anchor.top - bounds.top - 12;
    const up = below < PANEL_MIN_ROOM && above > below;
    panel.toggleClass("is-up", up);
    const room = Math.round(Math.max(160, Math.min(PANEL_MAX_ROOM, up ? above : below)));
    panel.setCssProps({ "--hanmark-look-room": `${room}px` });
    search.focus();
  };

  const switches = FRAME_OPTIONS[frame];
  if (form && !form.fixed && switches.length) {
    const group = picker.createDiv({ cls: "hanmark-form-picker-switches", attr: { role: "group", "aria-label": t("gongmun.frameOption.group") } });
    const chosen = parseGongmunFormId(form.id)?.options ?? {};
    for (const option of switches) {
      const id = `${input.idPrefix}-option-${option}`;
      const label = group.createEl("label", { cls: "hanmark-form-picker-switch", attr: { for: id } });
      const box = label.createEl("input", { attr: { id, type: "checkbox" } });
      label.createSpan({ text: gongmunFrameOptionLabel(frame, option) });
      box.checked = Boolean(chosen[option]);
      box.disabled = Boolean(input.disabled);
      box.onchange = () => input.onChange(withGongmunFrameOption(library, form.id, option, box.checked));
    }
  }
  if (!input.compact) {
    if (form?.fixed) picker.createEl("small", { text: t("gongmun.look.fixed", { preset: gongmunPresetLabel(form.preset) }) });
    picker.createEl("small", { cls: "hanmark-form-picker-desc", text: form?.description ?? t("gongmun.frame.help") });
  }
}
