import type { MessageKey } from "../i18n";

/**
 * The "내보낼 때" switches (R-037): choices about what a note's marks become in the
 * exported document. Each switch is one stored setting, so the export window, the
 * quick export commands, the previews and several-forms-at-once always agree; the
 * export window and the settings tab are two places to flip the same value.
 */
export type ExportSwitchId = "mermaidDiagrams" | "commentsAsMemos" | "hwpxEquations";
export type ExportSwitchFormat = "hwpx" | "docx" | "html" | "pdf";

export interface ExportSwitch {
  id: ExportSwitchId;
  /** Formats whose output the switch changes. */
  formats: readonly ExportSwitchFormat[];
  /** Value of a profile that never chose. */
  defaultOn: boolean;
  name: MessageKey;
  desc: MessageKey;
}

export const EXPORT_SWITCHES: readonly ExportSwitch[] = [
  {
    id: "mermaidDiagrams",
    formats: ["hwpx", "docx", "html", "pdf"],
    defaultOn: true,
    name: "settings.mermaidDiagrams.name",
    desc: "export.switch.mermaidDiagrams.desc"
  },
  {
    id: "commentsAsMemos",
    formats: ["hwpx"],
    defaultOn: false,
    name: "settings.commentsAsMemos.name",
    desc: "export.switch.commentsAsMemos.desc"
  },
  {
    id: "hwpxEquations",
    formats: ["hwpx"],
    defaultOn: false,
    name: "settings.hwpxEquations.name",
    desc: "export.switch.hwpxEquations.desc"
  }
];

/** The switches that change the output of one format, in display order. */
export function exportSwitchesFor(format: ExportSwitchFormat): ExportSwitch[] {
  return EXPORT_SWITCHES.filter((item) => item.formats.includes(format));
}

/** The stored value of a switch; a missing or malformed value is the switch's default. */
export function exportSwitchValue(settings: Record<string, unknown>, id: ExportSwitchId): boolean {
  const item = EXPORT_SWITCHES.find((entry) => entry.id === id);
  const stored = settings[id];
  return typeof stored === "boolean" ? stored : Boolean(item?.defaultOn);
}

/** "수식을 한글 수식 개체로": `$…$` becomes a Hangul equation object in HWPX (R-036). */
export function hwpxEquationsSetting(settings: Record<string, unknown>): boolean {
  return exportSwitchValue(settings, "hwpxEquations");
}
