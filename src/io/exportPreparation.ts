import type { AdapterWarning, AdapterWarningCode } from "./markdownAdapter";
import { assembleNote, type AssemblyHost, type AssemblyIssue, type AssemblyIssueCode } from "./noteAssembly";
import { renderMermaidDiagrams, type DiagramEnvironment, type DiagramTarget } from "./diagramStage";
import { resolveOutputLocale, t, type LanguagePreference } from "../i18n";

/**
 * The single step every export path runs on a note body before converting it
 * (HWPX, DOCX, HTML, Editorial PDF, and both previews), so all formats agree.
 */
export interface ExportPreparationOptions {
  /** Setting `assembleEmbeds` (default on). */
  assembleEmbeds: boolean;
  outputLanguage: LanguagePreference;
  /** Draw Mermaid blocks as diagrams for this export (R-033); omitted when the user switched it off. */
  diagrams?: ExportDiagramOptions;
}

export interface ExportDiagramOptions {
  target: DiagramTarget;
  /** Built only when the note has a Mermaid block. */
  environment: () => Promise<DiagramEnvironment> | DiagramEnvironment;
}

export interface PreparedExportMarkdown {
  markdown: string;
  /** Assembly messages in the adapter's warning shape, ready for any report. */
  warnings: AdapterWarning[];
}

const ISSUE_WARNINGS: Readonly<Record<AssemblyIssueCode, AdapterWarningCode>> = {
  missing: "embed-missing",
  cycle: "embed-cycle",
  depth: "embed-depth",
  section: "embed-section"
};

export function assemblyWarnings(issues: readonly AssemblyIssue[]): AdapterWarning[] {
  const grouped = new Map<AssemblyIssueCode, string[]>();
  for (const issue of issues) {
    const names = grouped.get(issue.code) ?? [];
    if (!names.includes(issue.target)) names.push(issue.target);
    grouped.set(issue.code, names);
  }
  const warnings: AdapterWarning[] = [];
  for (const [code, names] of grouped) {
    const list = names.join(", ");
    const message =
      code === "missing"
        ? t("assembly.warning.missing", { names: list })
        : code === "cycle"
          ? t("assembly.warning.cycle", { names: list })
          : code === "depth"
            ? t("assembly.warning.depth", { names: list })
            : t("assembly.warning.section", { names: list });
    warnings.push({ code: ISSUE_WARNINGS[code], message, count: issues.filter((issue) => issue.code === code).length });
  }
  return warnings;
}

export async function prepareExportMarkdown(
  host: AssemblyHost | null,
  body: string,
  sourcePath: string,
  options: ExportPreparationOptions
): Promise<PreparedExportMarkdown> {
  let markdown = body;
  const warnings: AdapterWarning[] = [];
  if (options.assembleEmbeds && host) {
    const locale = resolveOutputLocale(options.outputLanguage, body);
    const assembled = await assembleNote(host, body, sourcePath, { locale });
    markdown = assembled.markdown;
    warnings.push(...assemblyWarnings(assembled.issues));
  }
  // Diagrams are drawn after assembly, so Mermaid blocks of embedded notes are drawn too.
  if (options.diagrams && /^(?:[ \t]*>)*[ \t]*(?:`{3,}|~{3,})[ \t]*mermaid[ \t]*$/imu.test(markdown)) {
    const drawn = await renderMermaidDiagrams(markdown, options.diagrams.target, await options.diagrams.environment());
    markdown = drawn.markdown;
    warnings.push(...drawn.warnings);
  }
  return { markdown, warnings };
}

/** One-line summary for exports that report through a notice (HTML, PDF, DOCX). */
export function assemblyNotice(all: readonly AdapterWarning[]): string | null {
  const warnings = all.filter((warning) => !warning.code.startsWith("diagram-"));
  if (!warnings.length) return null;
  const count = warnings.reduce((sum, warning) => sum + warning.count, 0);
  return t("assembly.notice", { count, first: warnings[0].message });
}

/** One-line summary of diagram messages for exports that report through a notice. */
export function diagramNotice(all: readonly AdapterWarning[]): string | null {
  const warnings = all.filter((warning) => warning.code.startsWith("diagram-"));
  if (!warnings.length) return null;
  const count = warnings.reduce((sum, warning) => sum + warning.count, 0);
  return t("diagram.notice", { count, first: warnings[0].message });
}

/** Reads `assembleEmbeds` from stored settings; unknown or missing means on. */
export function assembleEmbedsSetting(settings: Record<string, unknown>): boolean {
  return settings.assembleEmbeds !== false;
}
