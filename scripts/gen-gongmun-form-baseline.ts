/**
 * Writes tests/fixtures/gongmunFormBaseline.json: sha256 of section0.xml and
 * header.xml for the ten 2.7.x official-document forms, made from the sources of a
 * given commit (R-030). The 3.0.0 frame-and-look model must reproduce them.
 *
 *   git archive <commit> src | tar -x -C .baseline
 *   node --import tsx scripts/gen-gongmun-form-baseline.ts .baseline <commit>
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { BASELINE_DAY, BASELINE_FORMS, BASELINE_FRONTMATTER, BASELINE_NOTE } from "../tests/fixtures/gongmunFormBaselineNote";

async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? ".");
  const commit = process.argv[3] ?? "working tree";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const load = async (path: string): Promise<Record<string, any>> => {
    const loaded = (await import(pathToFileURL(join(root, path)).href)) as Record<string, unknown>;
    return { ...((loaded.default as object | undefined) ?? {}), ...loaded };
  };
  const exportModule = await load("src/io/gongmunExport.ts");
  const engine = await load("src/io/kordocEngine.ts");
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length) super(...(args as [number]));
      else super(BASELINE_DAY);
    }
    static now(): number {
      return new RealDate(BASELINE_DAY).getTime();
    }
  }
  globalThis.Date = FixedDate as DateConstructor;
  const app = { metadataCache: { getFileCache: () => ({ frontmatter: BASELINE_FRONTMATTER }) } };
  const file = { basename: "기준 노트", path: "기준 노트.md" };
  const forms: Record<string, { section: string; header: string }> = {};
  for (const id of BASELINE_FORMS) {
    const host = { settings: {}, saveSettings: async () => {} };
    const plan = exportModule.planGongmunExport(app, file, host, undefined, id);
    const generated = await engine.generateValidatedHwpx(BASELINE_NOTE, exportModule.gongmunGenerateOptions(plan));
    const zip = await JSZip.loadAsync(generated.data);
    const hash = async (name: string): Promise<string> =>
      createHash("sha256").update(await zip.file(name)!.async("uint8array")).digest("hex");
    forms[id] = { section: await hash("Contents/section0.xml"), header: await hash("Contents/header.xml") };
  }
  globalThis.Date = RealDate;
  await writeFile("tests/fixtures/gongmunFormBaseline.json", `${JSON.stringify({ commit, day: BASELINE_DAY, forms }, null, 2)}\n`);
  console.log(`Baseline of ${Object.keys(forms).length} forms from ${commit}`);
}

void main();
