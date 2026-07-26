import type { App, DataAdapter } from "obsidian";
import { sha256Bytes } from "./hash";

export interface FilePickOptions {
  title?: string;
  extensions: string[];
  multiple?: boolean;
}

export interface SelectedExternalFile {
  name: string;
  bytes: Uint8Array;
  /**
   * A user-facing breadcrumb only. HanMark never reads this path directly.
   * Newer Electron builds intentionally expose only the file name.
   */
  displayPath?: string;
}

export interface SavedFileResult {
  cancelled: boolean;
  fileName: string;
  displayPath?: string;
  method?: "file-system-access" | "download" | "vault";
}

export interface SourceCacheMetadata {
  hash?: string;
  byteLength?: number;
  sourceName?: string;
}

export interface FileGateway {
  pickFiles(options: FilePickOptions): Promise<SelectedExternalFile[]>;
  saveFile(data: Uint8Array | ArrayBuffer, suggestedName: string): Promise<SavedFileResult>;
  saveVaultSibling(
    data: Uint8Array | ArrayBuffer,
    suggestedName: string,
    sourcePath: string
  ): Promise<SavedFileResult>;
  cacheSource(data: Uint8Array, metadata?: SourceCacheMetadata): Promise<string>;
  readCachedSource(cacheId: string): Promise<Uint8Array | null>;
}

interface FileSystemWritableFileStreamLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandleLike {
  name: string;
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
}

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandleLike>;
}

interface ElectronFile extends File {
  path?: unknown;
}

const DEFAULT_PLUGIN_ID = "hanmark";
const SOURCE_CACHE_NAME = "source-cache";
const CACHE_ID_PATTERN = /^sha256-[a-f0-9]{64}\.bin$/;

function normalizeAdapterPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

export function bytesAsArrayBuffer(data: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data.slice(0);
  return data.slice().buffer;
}

export function sourceCacheId(data: Uint8Array, metadata: SourceCacheMetadata = {}): string {
  const declared = String(metadata.hash ?? "").replace(/^sha256:/i, "").toLowerCase();
  const digest = sha256Bytes(data);
  if (/^[a-f0-9]{64}$/.test(declared) && declared !== digest) {
    throw new Error("Source cache metadata hash does not match the selected file.");
  }
  return `sha256-${digest}.bin`;
}

export function isValidSourceCacheId(cacheId: string): boolean {
  return CACHE_ID_PATTERN.test(cacheId);
}

export function sourceBytesMatchContract(
  data: Uint8Array,
  expectedHash: string,
  expectedByteLength: number
): boolean {
  if (expectedByteLength > 0 && data.byteLength !== expectedByteLength) return false;
  const digest = expectedHash.replace(/^sha256:/i, "").toLowerCase();
  return !digest || (/^[a-f0-9]{64}$/.test(digest) && sha256Bytes(data) === digest);
}

export function filenameFromDisplayPath(value: string, fallback = "document"): string {
  const last = value.split(/[\\/]/).filter(Boolean).pop()?.trim();
  return last || fallback;
}

export function splitFilename(value: string): { stem: string; extension: string } {
  const name = filenameFromDisplayPath(value);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, extension: "" };
  return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

export function safeSuggestedName(value: string, fallback = "document.bin"): string {
  const name = Array.from(filenameFromDisplayPath(value, fallback), (character) => {
    const code = character.charCodeAt(0);
    return "\\/:*?\"<>|".includes(character) || code <= 31 || code === 127
      ? "_"
      : character;
  }).join("").trim();
  return name || fallback;
}

async function ensureAdapterFolder(adapter: DataAdapter, path: string): Promise<void> {
  let current = "";
  for (const segment of normalizeAdapterPath(path).split("/")) {
    if (!segment) continue;
    current = current ? `${current}/${segment}` : segment;
    if (await adapter.exists(current)) continue;
    try {
      await adapter.mkdir(current);
    } catch (error) {
      // Concurrent bulk imports can create the same parent between exists/mkdir.
      if (!(await adapter.exists(current))) throw error;
    }
  }
}

function pluginId(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    "manifest" in value &&
    value.manifest &&
    typeof value.manifest === "object" &&
    "id" in value.manifest &&
    typeof value.manifest.id === "string"
  ) {
    return value.manifest.id.trim() || DEFAULT_PLUGIN_ID;
  }
  return DEFAULT_PLUGIN_ID;
}

function cacheRoot(app: App, plugin?: unknown): string {
  return normalizeAdapterPath(
    `${app.vault.configDir}/plugins/${pluginId(plugin)}/cache/${SOURCE_CACHE_NAME}`
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : Boolean(
        error &&
        typeof error === "object" &&
        "name" in error &&
        (error as { name?: unknown }).name === "AbortError"
      );
}

async function selectedExternalFile(file: File): Promise<SelectedExternalFile> {
  const data = await file.arrayBuffer();
  const legacyPath = (file as ElectronFile).path;
  return {
    name: file.name,
    bytes: new Uint8Array(data),
    displayPath: typeof legacyPath === "string" && legacyPath.trim()
      ? legacyPath.replace(/\\/g, "/")
      : file.name
  };
}

function acceptString(extensions: string[]): string {
  return extensions
    .map((extension) => extension.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean)
    .map((extension) => `.${extension}`)
    .join(",");
}

function pickWithInput(options: FilePickOptions): Promise<SelectedExternalFile[]> {
  return new Promise((resolve) => {
    const input = createEl("input");
    input.type = "file";
    input.multiple = options.multiple === true;
    input.accept = acceptString(options.extensions);
    input.setAttribute("aria-label", options.title || "Choose files");
    input.hidden = true;
    document.body.appendChild(input);

    let settled = false;
    const finish = (files: SelectedExternalFile[]): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };

    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      void Promise.all(files.map(selectedExternalFile)).then(finish, () => finish([]));
    }, { once: true });
    input.addEventListener("cancel", () => finish([]), { once: true });
    input.click();
  });
}

function mimeForName(name: string): string {
  const extension = splitFilename(name).extension.toLowerCase();
  if (extension === ".hwpx") return "application/vnd.hancom.hwpx";
  if (extension === ".hwp") return "application/x-hwp";
  if (extension === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (extension === ".html" || extension === ".htm") return "text/html";
  return "application/octet-stream";
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = createEl("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function vaultSiblingPath(
  sourcePath: string,
  fileName: string,
  copyIndex = 0
): string {
  const normalizedSource = normalizeAdapterPath(sourcePath);
  const slash = normalizedSource.lastIndexOf("/");
  const folder = slash >= 0 ? normalizedSource.slice(0, slash) : "";
  const { stem, extension } = splitFilename(fileName);
  const indexedName = copyIndex > 0
    ? `${stem || "document"} (${copyIndex})${extension}`
    : fileName;
  return normalizeAdapterPath(folder ? `${folder}/${indexedName}` : indexedName);
}

export function createFileGateway(app: App, plugin?: unknown): FileGateway {
  const root = cacheRoot(app, plugin);
  const adapter = app.vault.adapter;

  return {
    pickFiles: pickWithInput,

    async saveFile(data, suggestedName) {
      const fileName = safeSuggestedName(suggestedName);
      const blob = new Blob([bytesAsArrayBuffer(data)], { type: mimeForName(fileName) });
      const pickerWindow = window as SaveFilePickerWindow;

      if (typeof pickerWindow.showSaveFilePicker === "function") {
        try {
          const extension = splitFilename(fileName).extension;
          const handle = await pickerWindow.showSaveFilePicker({
            suggestedName: fileName,
            types: [{
              description: extension ? `${extension.slice(1).toUpperCase()} document` : "Document",
              accept: { [mimeForName(fileName)]: extension ? [extension] : [] }
            }]
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          return {
            cancelled: false,
            fileName: handle.name || fileName,
            displayPath: handle.name || fileName,
            method: "file-system-access"
          };
        } catch (error) {
          if (isAbortError(error)) return { cancelled: true, fileName };
          // Some Electron/WebView versions expose the API but do not permit writes.
          // The browser download path below remains safe and never overwrites a source.
        }
      }

      downloadBlob(blob, fileName);
      return {
        cancelled: false,
        fileName,
        displayPath: fileName,
        method: "download"
      };
    },

    async saveVaultSibling(data, suggestedName, sourcePath) {
      const fileName = safeSuggestedName(suggestedName);
      let copyIndex = 0;
      let relativePath = vaultSiblingPath(sourcePath, fileName, copyIndex);
      while (app.vault.getAbstractFileByPath(relativePath)) {
        copyIndex += 1;
        relativePath = vaultSiblingPath(sourcePath, fileName, copyIndex);
      }
      await app.vault.createBinary(relativePath, bytesAsArrayBuffer(data));
      return {
        cancelled: false,
        fileName: filenameFromDisplayPath(relativePath, fileName),
        displayPath: relativePath,
        method: "vault"
      };
    },

    async cacheSource(data, metadata = {}) {
      if (metadata.byteLength !== undefined && metadata.byteLength !== data.byteLength) {
        throw new Error("Source cache metadata byte length does not match the selected file.");
      }
      const cacheId = sourceCacheId(data, metadata);
      await ensureAdapterFolder(adapter, root);
      const path = normalizeAdapterPath(`${root}/${cacheId}`);
      if (!(await adapter.exists(path))) {
        await adapter.writeBinary(path, bytesAsArrayBuffer(data));
      }
      return cacheId;
    },

    async readCachedSource(cacheId) {
      if (!isValidSourceCacheId(cacheId)) return null;
      const path = normalizeAdapterPath(`${root}/${cacheId}`);
      if (!(await adapter.exists(path))) return null;
      return new Uint8Array(await adapter.readBinary(path));
    }
  };
}
