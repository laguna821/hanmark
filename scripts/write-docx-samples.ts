// Verification helper (not shipped): writes the built-in DOCX of the fixture notes,
// and of any Markdown files given as arguments, into an output folder.
// Usage: node --import tsx scripts/write-docx-samples.ts <outDir> [note.md ...]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { writeDocx } from "../src/io/docxWriter";
import { extractEditableBodyStrict } from "../src/io/frontmatter";
import { createDefaultWordTemplate } from "../src/legacy-port/defaultWordTemplate";
import { ENGLISH_PAPER_NOTE, KOREAN_REPORT_NOTE, PLAIN_MEMO_NOTE } from "../tests/fixtures/docxNotes";

async function main(): Promise<void> {
  const [outDir, ...files] = process.argv.slice(2);
  if (!outDir) throw new Error("Output folder is required.");
  await mkdir(outDir, { recursive: true });
  const notes: Array<{ name: string; markdown: string }> = [
    { name: "korean-report", markdown: KOREAN_REPORT_NOTE },
    { name: "english-paper", markdown: ENGLISH_PAPER_NOTE },
    { name: "plain-memo", markdown: PLAIN_MEMO_NOTE }
  ];
  for (const [index, file] of files.entries()) {
    notes.push({ name: `vault-note-${index + 1}`, markdown: extractEditableBodyStrict(await readFile(file, "utf8")) });
    console.log(`vault-note-${index + 1} <- ${basename(file).length} chars of file name`);
  }
  const template = createDefaultWordTemplate();
  for (const note of notes) {
    const first = await writeDocx(note.markdown, { template, title: note.name });
    const second = await writeDocx(note.markdown, { template, title: note.name });
    const same = Buffer.compare(Buffer.from(first.bytes), Buffer.from(second.bytes)) === 0;
    await writeFile(join(outDir, `${note.name}.docx`), first.bytes);
    await writeFile(join(outDir, `${note.name}.md`), note.name.startsWith("vault-note") ? "" : note.markdown);
    console.log(`${note.name}: ${first.bytes.length} bytes, identical=${same}, notices=${JSON.stringify(first.notices)}`);
  }
}

void main();
