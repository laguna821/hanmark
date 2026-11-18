import { canonicalGongmunFormId } from "./gongmunExport";
import type { FormMemory } from "./formMemory";
import type { TemplateLibraryHost } from "./templateLibrary";

/**
 * Form ids stored by 2.7.x ("preset:plan", "builtin:hallym-ilsong", "gongmun:<uuid>")
 * become 3.0.0 frame-and-look ids (R-030). An id whose form no longer exists is left
 * as it is: reading the memory already ignores unknown forms, and nothing is thrown
 * away that a later version might understand.
 */
export function migrateGongmunFormMemory(
  host: TemplateLibraryHost,
  memory: Readonly<FormMemory>
): { memory: FormMemory; changed: boolean } {
  const next: FormMemory = {};
  let changed = false;
  for (const [path, id] of Object.entries(memory)) {
    const canonical = canonicalGongmunFormId(host, id) ?? id;
    if (canonical !== id) changed = true;
    next[path] = canonical;
  }
  return { memory: next, changed };
}
