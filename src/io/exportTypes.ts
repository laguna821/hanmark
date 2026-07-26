import type { GongmunPreset } from "kordoc";

/** Public export modes used by the command aliases and the unified export center. */
export type HanmarkExportMode =
  | "quick-hwpx"
  | "gongmun-hwpx"
  | "source-patch"
  | "docx"
  | "html";

/** Formats presented by the unified HanMark export center. */
export type HanmarkExportFormat = "hwpx" | "docx" | "html" | "pdf";

/** HWPX-specific choices shown after the HWPX format card is selected. */
export type HwpxExportVariant =
  | "quick"
  | "gongmun"
  | "source-patch";

/**
 * A presentation-neutral result returned to the export center.
 *
 * `vaultPath` is present only when HanMark itself created a file inside the
 * current Vault. Browser downloads and native save pickers intentionally do
 * not expose an operating-system path.
 */
export interface HanmarkExportOutcome {
  format: HanmarkExportFormat;
  status: "saved" | "delegated" | "cancelled";
  fileName?: string;
  displayPath?: string;
  vaultPath?: string;
  warnings?: string[];
}

export interface HanmarkKordocExportOptions {
  mode: "quick-hwpx" | "gongmun-hwpx";
  gongmunPreset?: GongmunPreset;
}
