import { App, normalizePath } from "obsidian";
import type { ExtractedImage } from "kordoc";
import { rewriteImportedImageReference } from "./imageLinks";

export interface PersistImagesResult {
  markdown: string;
  saved: number;
  warnings: string[];
}

function safeFilename(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|#[\]^]/g, "_").trim();
  return cleaned || "image.png";
}

async function ensureParentFolders(app: App, path: string): Promise<void> {
  const parent = normalizePath(path).split("/").slice(0, -1);
  let current = "";
  for (const part of parent) {
    if (!part) continue;
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}

/** Save kordoc-extracted images through Obsidian's attachment policy and rewrite the note. */
export async function persistImportedImages(
  app: App,
  notePath: string,
  markdown: string,
  images: ExtractedImage[] | undefined
): Promise<PersistImagesResult> {
  if (!images?.length) return { markdown, saved: 0, warnings: [] };

  let rewritten = markdown;
  let saved = 0;
  const warnings: string[] = [];
  const noteBase = notePath.split("/").pop()?.replace(/\.md$/i, "") || "imported";

  for (const image of images) {
    try {
      // Prefixing with the unique note basename prevents races during bounded bulk import.
      const requested = safeFilename(`${noteBase}-${safeFilename(image.filename)}`);
      const attachmentPath = normalizePath(
        await app.fileManager.getAvailablePathForAttachment(requested, notePath)
      );
      await ensureParentFolders(app, attachmentPath);
      const buffer = image.data.buffer.slice(
        image.data.byteOffset,
        image.data.byteOffset + image.data.byteLength
      ) as ArrayBuffer;
      const file = await app.vault.createBinary(attachmentPath, buffer);
      const embed = `!${app.fileManager.generateMarkdownLink(file, notePath)}`;
      const result = rewriteImportedImageReference(rewritten, image.filename, embed);
      rewritten = result.markdown;
      saved++;
      if (result.replacements === 0) {
        warnings.push(`이미지는 저장했지만 본문 참조를 찾지 못했습니다: ${image.filename}`);
      }
    } catch (error: any) {
      warnings.push(`이미지 저장 실패 (${image.filename}): ${error?.message || String(error)}`);
    }
  }

  return { markdown: rewritten, saved, warnings };
}
