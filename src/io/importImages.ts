import type { App } from "obsidian";
import type { ExtractedImage } from "kordoc";
import { rewriteImportedImageReference } from "./imageLinks";
import { normalizeImportedImageFolder } from "../legacy-port/settings";
import { errorMessage } from "../utils/errors";

export interface PersistImagesResult {
  markdown: string;
  saved: number;
  warnings: string[];
  cloudCandidates: PersistedCloudImage[];
}

export interface PersistedCloudImage {
  markdownUrl: string;
  vaultPath: string;
  filename: string;
  mimeType: string;
  data: Uint8Array;
  /**
   * Provenance guard for cleanup. This is set only after Vault.createBinary
   * succeeds at a path that was confirmed not to exist.
   */
  ownedStagingFile: true;
}

export interface PersistImagesOptions {
  destination?: "vault" | "cmds-eagle-r2";
  /** Empty preserves Obsidian's configured attachment policy. */
  localFolder?: string;
}

export const CLOUD_STAGING_FOLDER = "HanMark-Imported-Images";

/**
 * The image persistence layer only needs Obsidian's stable Vault-relative
 * separator normalization. Keeping this tiny utility local means the module
 * has no runtime dependency on Obsidian and can be exercised with a mock
 * Vault, while the public `App` contract remains type checked.
 */
function normalizeVaultPath(value: string): string {
  return value
    .replace(/\\/gu, "/")
    .replace(/\/{2,}/gu, "/")
    .replace(/^\/+|\/+$/gu, "");
}

function safeFilename(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|#[\]^]/g, "_").trim();
  return cleaned || "image.png";
}

async function ensureParentFolders(app: App, path: string): Promise<void> {
  const parent = normalizeVaultPath(path).split("/").slice(0, -1);
  let current = "";
  for (const part of parent) {
    if (!part) continue;
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}

function shortHash(value: string): string {
  const bytes = new TextEncoder().encode(value.normalize("NFC"));
  let hash = 2_166_136_261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function safeImageExtension(image: ExtractedImage): string {
  const filenameExtension = /\.([a-z0-9]{1,8})$/iu.exec(image.filename)?.[1]
    ?.toLowerCase();
  if (filenameExtension && /^[a-z0-9]+$/u.test(filenameExtension)) {
    return filenameExtension;
  }
  const byMime: Record<string, string> = {
    "image/bmp": "bmp",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/x-ms-bmp": "bmp"
  };
  return byMime[image.mimeType.toLowerCase()] ?? "png";
}

function availableCloudPath(
  app: App,
  notePath: string,
  image: ExtractedImage,
  index: number
): string {
  const fingerprint = shortHash(`${notePath}\u0000${index}\u0000${image.filename}`);
  const extension = safeImageExtension(image);
  let attempt = 0;
  while (true) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const path = normalizeVaultPath(
      `${CLOUD_STAGING_FOLDER}/hanmark-${fingerprint}-${index + 1}${suffix}.${extension}`
    );
    if (!app.vault.getAbstractFileByPath(path)) return path;
    attempt++;
  }
}

function availableFolderPath(
  app: App,
  folder: string,
  preferredFilename: string
): string {
  const extension = /(\.[a-z0-9]{1,8})$/iu.exec(preferredFilename)?.[1] ?? "";
  const stem = extension
    ? preferredFilename.slice(0, -extension.length)
    : preferredFilename;
  let attempt = 0;
  while (true) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const path = normalizeVaultPath(
      `${folder}/${stem}${suffix}${extension}`
    );
    if (!app.vault.getAbstractFileByPath(path)) return path;
    attempt += 1;
  }
}

function permittedLocalFolder(app: App, value: string | undefined): string {
  if (!value) return "";
  const folder = normalizeImportedImageFolder(value);
  if (!folder) return "";
  const configDir = normalizeVaultPath(app.vault.configDir);
  if (folder === configDir || folder.startsWith(`${configDir}/`)) return "";
  return folder;
}

/** Save kordoc-extracted images through Obsidian's attachment policy and rewrite the note. */
export async function persistImportedImages(
  app: App,
  notePath: string,
  markdown: string,
  images: ExtractedImage[] | undefined,
  options: PersistImagesOptions = {}
): Promise<PersistImagesResult> {
  if (!images?.length) {
    return { markdown, saved: 0, warnings: [], cloudCandidates: [] };
  }

  let rewritten = markdown;
  let saved = 0;
  const warnings: string[] = [];
  const cloudCandidates: PersistedCloudImage[] = [];
  const noteBase = notePath.split("/").pop()?.replace(/\.md$/i, "") || "imported";
  const localFolder = permittedLocalFolder(app, options.localFolder);
  if (options.localFolder && !localFolder) {
    warnings.push(
      "가져온 이미지 폴더가 Vault 설정 폴더와 겹쳐 Obsidian의 첨부 파일 위치 설정을 사용했습니다."
    );
  }

  for (const [index, image] of images.entries()) {
    try {
      const cloudDestination = options.destination === "cmds-eagle-r2";
      // Cloud candidates use a Vault-root ASCII path so CMDS Eagle 1.7's
      // note-scoped converter can resolve it without ambiguity from spaces,
      // percent escapes, Korean characters, or balanced parentheses.
      const attachmentPath = cloudDestination
        ? availableCloudPath(app, notePath, image, index)
        : localFolder
          ? availableFolderPath(
              app,
              localFolder,
              safeFilename(`${noteBase}-${safeFilename(image.filename)}`)
            )
          : normalizeVaultPath(
              await app.fileManager.getAvailablePathForAttachment(
                safeFilename(`${noteBase}-${safeFilename(image.filename)}`),
                notePath
              )
            );
      // Imported documents always use a Vault-root wiki embed. Depending on
      // Obsidian's `useMarkdownLinks` preference here used to produce an
      // ambiguous `![](name(with parentheses).bmp)` destination that HanMark
      // and other converters could truncate at the first closing parenthesis.
      const embed = cloudDestination
        ? `![](${attachmentPath})`
        : `![[${attachmentPath}]]`;
      const result = rewriteImportedImageReference(
        rewritten,
        image.filename,
        embed
      );
      // Do not create an orphan file when Kordoc returned image bytes that are
      // not referenced by the parsed Markdown. In cloud mode such a file would
      // never become an upload candidate and could otherwise accumulate in the
      // plugin staging folder indefinitely.
      if (result.replacements === 0) {
        warnings.push(
          `본문 참조를 찾지 못해 이미지를 저장하지 않았습니다: ${image.filename}`
        );
        continue;
      }
      await ensureParentFolders(app, attachmentPath);
      const buffer = image.data.slice().buffer;
      const file = await app.vault.createBinary(attachmentPath, buffer);
      rewritten = result.markdown;
      saved++;
      if (cloudDestination) {
        cloudCandidates.push({
          markdownUrl: file.path,
          vaultPath: file.path,
          filename: image.filename,
          mimeType: image.mimeType,
          data: image.data.slice(),
          ownedStagingFile: true
        });
      }
    } catch (error: unknown) {
      warnings.push(`이미지 저장 실패 (${image.filename}): ${errorMessage(error)}`);
    }
  }

  return { markdown: rewritten, saved, warnings, cloudCandidates };
}
