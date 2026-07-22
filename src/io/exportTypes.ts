import type { GongmunPreset } from "kordoc";

/** Public export modes used by the command aliases and the unified export center. */
export type HanmarkExportMode =
  | "quick-hwpx"
  | "gongmun-hwpx"
  | "source-patch"
  | "docx"
  | "html";

export interface HanmarkKordocExportOptions {
  mode: "quick-hwpx" | "gongmun-hwpx";
  gongmunPreset?: GongmunPreset;
}
