import JSZip from "jszip";
import { t } from "../i18n";

/**
 * Every ZIP entry receives this timestamp so the same Markdown, settings, and engine
 * always produce the same HWPX bytes (JSZip otherwise stamps the current time).
 */
export const HWPX_FIXED_ENTRY_DATE = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

const FOOTNOTE_ELEMENT = /<hp:footNote\s[^>]*>[\s\S]*?<\/hp:footNote>/g;
const FOOTNOTE_NUMBER = /^<hp:footNote\s[^>]*\bnumber="(\d+)"/;
const FIRST_NOTE_PARAGRAPH = /(<hp:subList\b[^>]*>\s*<hp:p\b[^>]*>)/;
const FIRST_RUN_CHAR_PR = /<hp:run\s[^>]*\bcharPrIDRef="(\d+)"/;

/**
 * Hancom draws the number in front of each footnote ("1) …") from a leading autoNum
 * control. Kordoc 4.15.7 left it out and HanMark inserted it; Kordoc 4.16.0 and later
 * write it themselves (R-029), so on a package from the bundled engine this adds
 * nothing. The guard stays so a note without the control never reaches the user.
 */
export function addFootnoteAutoNumbers(sectionXml: string): { xml: string; added: number } {
  let added = 0;
  const xml = sectionXml.replace(FOOTNOTE_ELEMENT, (note) => {
    if (/<hp:autoNum\b[^>]*\bnumType="FOOTNOTE"/.test(note)) return note;
    const number = note.match(FOOTNOTE_NUMBER)?.[1];
    const paragraph = note.match(FIRST_NOTE_PARAGRAPH);
    if (!number || !paragraph || paragraph.index === undefined) return note;
    const afterParagraph = note.slice(paragraph.index + paragraph[0].length);
    const charPr = afterParagraph.match(FIRST_RUN_CHAR_PR)?.[1] ?? "0";
    const autoNum =
      `<hp:run charPrIDRef="${charPr}"><hp:ctrl><hp:autoNum num="${number}" numType="FOOTNOTE">` +
      '<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>' +
      "</hp:autoNum></hp:ctrl><hp:t> </hp:t></hp:run>";
    added += 1;
    const insertAt = paragraph.index + paragraph[0].length;
    return note.slice(0, insertAt) + autoNum + note.slice(insertAt);
  });
  return { xml, added };
}

/**
 * Kordoc splits long tables across pages (pageBreak="CELL") but repeats the header row
 * only in public-document mode. Turn repetition on for any table whose first row is
 * marked as a header, so a table that continues on the next page keeps its titles.
 */
export function repeatTableHeaderRows(sectionXml: string): { xml: string; changed: number } {
  let changed = 0;
  let output = "";
  let cursor = 0;
  const openTag = /<hp:tbl\s[^>]*>/g;
  for (const match of sectionXml.matchAll(openTag)) {
    const start = match.index ?? 0;
    if (start < cursor) continue;
    const tag = match[0];
    if (!/\brepeatHeader="0"/.test(tag)) continue;
    const bodyStart = start + tag.length;
    const firstRowEnd = sectionXml.indexOf("</hp:tr>", bodyStart);
    const nestedTable = sectionXml.indexOf("<hp:tbl", bodyStart);
    const firstRow = sectionXml.slice(
      bodyStart,
      firstRowEnd === -1 ? bodyStart : nestedTable !== -1 && nestedTable < firstRowEnd ? nestedTable : firstRowEnd
    );
    if (!/<hp:tc\s[^>]*\bheader="1"/.test(firstRow)) continue;
    output += sectionXml.slice(cursor, start) + tag.replace('repeatHeader="0"', 'repeatHeader="1"');
    cursor = bodyStart;
    changed += 1;
  }
  output += sectionXml.slice(cursor);
  return { xml: output, changed };
}

export interface FinalizeHwpxOptions {
  /** Add the leading footnote number control (see addFootnoteAutoNumbers). */
  footnoteAutoNumbers?: boolean;
  /** Repeat marked header rows of long tables on each page. */
  repeatHeaderRows?: boolean;
}

export interface FinalizedHwpx {
  data: ArrayBuffer;
  footnoteNumbersAdded: number;
  headerRowsRepeated: number;
}

const SECTION_ENTRY = /^Contents\/section\d+\.xml$/;

/**
 * Last step of every generated HWPX: apply the XML corrections above and rebuild the
 * package with a fixed entry order (mimetype first, stored) and fixed timestamps.
 */
export async function finalizeHwpxPackage(
  input: ArrayBuffer,
  options: FinalizeHwpxOptions = {}
): Promise<FinalizedHwpx> {
  const source = await JSZip.loadAsync(input);
  const output = new JSZip();
  let footnoteNumbersAdded = 0;
  let headerRowsRepeated = 0;

  const mimetype = source.file("mimetype");
  if (!mimetype) throw new Error(t("hwpx.packageMissingMimetype"));
  output.file("mimetype", await mimetype.async("uint8array"), {
    compression: "STORE",
    date: HWPX_FIXED_ENTRY_DATE,
    createFolders: false
  });

  const entries: Array<{ name: string; dir: boolean }> = [];
  source.forEach((name, entry) => {
    if (name !== "mimetype") entries.push({ name, dir: entry.dir });
  });
  for (const { name, dir } of entries) {
    if (dir) {
      output.file(name, null, { dir: true, date: HWPX_FIXED_ENTRY_DATE });
      continue;
    }
    const entry = source.file(name);
    if (!entry) continue;
    if (SECTION_ENTRY.test(name) && (options.footnoteAutoNumbers || options.repeatHeaderRows)) {
      let xml = await entry.async("text");
      if (options.footnoteAutoNumbers) {
        const numbered = addFootnoteAutoNumbers(xml);
        xml = numbered.xml;
        footnoteNumbersAdded += numbered.added;
      }
      if (options.repeatHeaderRows) {
        const repeated = repeatTableHeaderRows(xml);
        xml = repeated.xml;
        headerRowsRepeated += repeated.changed;
      }
      output.file(name, xml, { date: HWPX_FIXED_ENTRY_DATE, createFolders: false });
    } else {
      output.file(name, await entry.async("uint8array"), { date: HWPX_FIXED_ENTRY_DATE, createFolders: false });
    }
  }

  const data = await output.generateAsync({ type: "arraybuffer" });
  return { data, footnoteNumbersAdded, headerRowsRepeated };
}
