import {
  extractClickHereFields,
  extractFormSchema,
  fillHwpx,
  inferFieldType,
  parse,
  validateHwpx,
  type FillValue,
  type FormFieldType,
  type IRTable
} from "kordoc";
import { bytesAsArrayBuffer } from "./fileGateway";
import { finalizeHwpxPackage } from "./hwpxPostProcess";
import { sha256Bytes } from "./hash";
import { kordocParseOptions } from "./importOptions";
import { tOut, translate, type Locale, type MessageKey } from "../i18n";

/**
 * Filling HWPX forms from note properties (2.7.0 W8).
 *
 * A form note holds one property per form field plus two bookkeeping properties
 * (the form and its hash). Filling writes a new HWPX next to the note; the form
 * itself is never modified.
 */
export const FORM_LINK_KEY = "hanmark-form";
export const FORM_HASH_KEY = "hanmark-form-hash";
export const BUILTIN_FORM_PREFIX = "builtin:";

/** Obsidian's own properties never become form values. */
const RESERVED_KEYS = new Set([FORM_LINK_KEY, FORM_HASH_KEY, "tags", "tag", "aliases", "alias", "cssclasses", "cssclass", "publish", "position"]);

export interface FormFieldSpec {
  /** Property name = the field's click-here name or table label. */
  name: string;
  /** The form's own guidance text (click-here placeholder). */
  hint?: string;
  type: FormFieldType;
  required?: boolean;
  /** Click-here field, label–value cell pair, or a column of a header-row table. */
  source: "clickhere" | "label" | "column";
  /** Current value in the form ("" for an empty form). */
  value: string;
  /** Blank rows of a column field; two or more make the property a list. */
  rows?: number;
  /** Row names of a column field's table (its first filled column), in order. */
  rowLabels?: string[];
}

/** Values that did not fit: the form has fewer blank rows than list items. */
export interface FormOverflow {
  name: string;
  filled: number;
  total: number;
}

const TYPE_HINTS: Readonly<Record<FormFieldType, MessageKey | null>> = {
  text: null,
  date: "output.form.type.date",
  phone: "output.form.type.phone",
  email: "output.form.type.email",
  amount: "output.form.type.amount",
  checkbox: "output.form.type.checkbox",
  idnum: "output.form.type.idnum"
};

/** A blank cell, or one holding only an underline or empty brackets. */
const BLANK_CELL = /^[\s_()（）[\]]*$/u;
/** Row numbers such as "1", "①", "가.", "iv)". */
const SEQUENCE_CELL = /^(?:\d{1,3}|[①-⑳]|[가-하]|[A-Za-z]|[ivxIVX]{1,4})[.)]?$/u;
const MAX_HEADER_LABEL = 20;

function comparable(name: string): string {
  return name.replace(/[\s:：·*※★()（）]/gu, "").toLowerCase();
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytesAsArrayBuffer(bytes.slice());
}

export function formHash(bytes: Uint8Array): string {
  return sha256Bytes(bytes);
}

/** The form a note points at: "[[path/form.hwpx|alias]]", a plain path, or "builtin:gian". */
export function formLinkTarget(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const inner = /^\[\[([^\]]+)\]\]$/u.exec(trimmed)?.[1] ?? trimmed;
  return inner.split("|", 1)[0].trim() || null;
}

/**
 * Columns to fill in a header-row table: labels across the top and blank rows
 * below (an applicant list, a budget table). Kordoc's label–value reading would
 * pair each header with its right neighbour ("번호 = 성명"), so such tables are
 * read here: every blank column becomes a field, a list when there are several
 * rows. A table with row names and a single blank column stays a label–value
 * table ("성명 | ", "주소 | "), which reads better as named fields.
 */
export function headerRowColumns(table: IRTable): Array<{ name: string; rows: number; rowLabels: string[] }> | null {
  if (table.rows < 2 || table.cols < 2) return null;
  const header = table.cells[0] ?? [];
  const labels: string[] = [];
  for (let col = 0; col < table.cols; col += 1) {
    const text = header[col]?.text.trim() ?? "";
    if (!text || text.length > MAX_HEADER_LABEL || BLANK_CELL.test(text)) return null;
    labels.push(text);
  }
  const dataRows = table.cells.slice(1);
  const columns = labels.map((_, col) => dataRows.map((row) => row[col]?.text.trim() ?? ""));
  const blank = columns.map((texts) => texts.every((text) => BLANK_CELL.test(text)));
  const blankCount = blank.filter(Boolean).length;
  if (!blankCount) return null;
  const filledColumns = columns.filter((_, col) => !blank[col]);
  const numbered = filledColumns.every((texts) => texts.every((text) => !text || SEQUENCE_CELL.test(text)));
  if (!numbered && blankCount < 2) return null;
  const rowLabels = numbered ? [] : (filledColumns[0] ?? []).filter(Boolean);
  return labels.flatMap((name, col) => (blank[col] ? [{ name, rows: dataRows.length, rowLabels }] : []));
}

/**
 * Fields of a form, in document order: click-here fields first (the form author's
 * declared names), then table fields and inline "label: ____" fields that no
 * earlier field already covers.
 */
export async function readFormFields(bytes: Uint8Array): Promise<FormFieldSpec[]> {
  const fields: FormFieldSpec[] = [];
  const seen = new Set<string>();
  const add = (field: FormFieldSpec): void => {
    const name = field.name.trim();
    const key = comparable(name);
    if (!name || !key || seen.has(key) || RESERVED_KEYS.has(name)) return;
    seen.add(key);
    fields.push({ ...field, name });
  };
  for (const field of await extractClickHereFields(copyBuffer(bytes))) {
    add({
      name: field.name,
      hint: field.placeholder?.trim() || undefined,
      type: inferFieldType(field.name, field.value),
      source: "clickhere",
      value: field.value
    });
  }
  // Offline whitelist, as in the "form" import preset.
  const parsed = await parse(
    copyBuffer(bytes),
    kordocParseOptions({ keepTrailingEmptyCols: true, includeFieldPlaceholders: true })
  );
  if (!parsed.success) return fields;
  for (const block of parsed.blocks) {
    const columns = block.type === "table" && block.table ? headerRowColumns(block.table) : null;
    if (columns) {
      for (const column of columns) {
        add({
          name: column.name,
          type: inferFieldType(column.name, ""),
          source: "column",
          value: "",
          rows: column.rows > 1 ? column.rows : undefined,
          rowLabels: column.rows > 1 && column.rowLabels.length ? column.rowLabels : undefined
        });
      }
      continue;
    }
    for (const field of extractFormSchema([block]).fields) {
      add({
        name: field.label,
        type: field.type,
        required: field.required,
        source: "label",
        value: field.empty ? "" : field.value.trim()
      });
    }
  }
  return fields;
}

/** Properties of a new (or refreshed) form note; existing values win over form values. */
export function formNoteProperties(
  fields: readonly FormFieldSpec[],
  link: string,
  hash: string,
  existing: Readonly<Record<string, unknown>> = {}
): { properties: Record<string, unknown>; added: string[] } {
  const properties: Record<string, unknown> = {};
  const added: string[] = [];
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(existing, field.name)) continue;
    properties[field.name] = field.rows ? [] : field.value;
    added.push(field.name);
  }
  properties[FORM_LINK_KEY] = link;
  properties[FORM_HASH_KEY] = hash;
  return { properties, added };
}

/** Body of a form note: how to fill it, per-field hints, and a privacy warning. */
export function formNoteBody(fields: readonly FormFieldSpec[], formTitle: string, locale: Locale): string {
  const lines = [`# ${tOut(locale, "output.form.title", { form: formTitle })}`, ""];
  lines.push(`> [!info] ${tOut(locale, "output.form.howTitle")}`);
  lines.push(`> ${tOut(locale, "output.form.how")}`, "");
  if (fields.length) {
    lines.push(`## ${tOut(locale, "output.form.fields")}`, "");
    for (const field of fields) {
      const typeKey = TYPE_HINTS[field.type];
      const notes = [
        field.hint,
        typeKey ? translate(locale, typeKey) : undefined,
        field.required ? tOut(locale, "output.form.required") : undefined,
        field.rows ? tOut(locale, "output.form.rows", { count: field.rows }) : undefined,
        field.rowLabels?.length ? tOut(locale, "output.form.rowLabels", { labels: field.rowLabels.join(", ") }) : undefined
      ].filter(Boolean);
      lines.push(`- **${field.name}**${notes.length ? `: ${notes.join(" · ")}` : ""}`);
    }
    lines.push("");
  } else {
    lines.push(tOut(locale, "output.form.noFields"), "");
  }
  if (fields.some((field) => field.type === "idnum")) {
    lines.push(`> [!warning] ${tOut(locale, "output.form.privacyTitle")}`);
    lines.push(`> ${tOut(locale, "output.form.privacy")}`, "");
  }
  return lines.join("\n");
}

/** Values to fill, from the note's properties: text, numbers, and lists (repeated rows). */
export function collectFormValues(frontmatter: Readonly<Record<string, unknown>> | null | undefined): Record<string, FillValue> {
  const values: Record<string, FillValue> = {};
  for (const [key, raw] of Object.entries(frontmatter ?? {})) {
    if (RESERVED_KEYS.has(key)) continue;
    if (typeof raw === "string") {
      if (raw.trim()) values[key] = raw;
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      values[key] = String(raw);
    } else if (Array.isArray(raw)) {
      const items = raw
        .map((item) => (typeof item === "string" ? item : typeof item === "number" ? String(item) : ""))
        .filter((item) => item.trim());
      if (items.length) values[key] = items;
    }
  }
  return values;
}

export interface FilledForm {
  data: ArrayBuffer;
  filled: string[];
  unmatched: string[];
  /** List values with more items than the form has blank rows (Kordoc drops the rest). */
  overflow: FormOverflow[];
  warnings: string[];
}

/** Fill a copy of the form, verify it, and package it deterministically. */
export async function fillFormHwpx(template: Uint8Array, values: Record<string, FillValue>): Promise<FilledForm> {
  const result = await fillHwpx(copyBuffer(template), values);
  const validation = await validateHwpx(result.buffer);
  if (!validation.ok) {
    throw new Error(validation.issues.slice(0, 3).map((issue) => issue.message).join(" / "));
  }
  const overflow: FormOverflow[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (!Array.isArray(value)) continue;
    const filled = result.filled.filter((field) => comparable(field.label) === comparable(name)).length;
    if (filled > 0 && filled < value.length) overflow.push({ name, filled, total: value.length });
  }
  const finalized = await finalizeHwpxPackage(result.buffer);
  return {
    data: finalized.data,
    filled: [...new Set(result.filled.map((field) => field.label))],
    unmatched: result.unmatched,
    overflow,
    warnings: result.warnings ?? []
  };
}
