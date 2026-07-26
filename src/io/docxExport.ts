import {
  FileSystemAdapter,
  Platform,
  normalizePath,
  type App,
  type DataAdapter
} from "obsidian";
import { adaptMarkdownForKordoc } from "./markdownAdapter";
import { extractEditableBodyStrict } from "./frontmatter";
import type { FileGateway, SavedFileResult } from "./fileGateway";
import { safeSuggestedName, splitFilename } from "./fileGateway";
import { PandocDocxService } from "../legacy-port/pandocDocx";
import type { UserInitiatedAction } from "../legacy-port/userProcess";
import { WordPdfPreviewService } from "../legacy-port/wordPdfPreview";
import { buildReferenceDocx } from "../legacy-port/wordReferenceDoc";
import type {
  WordTemplateDirectoryListing,
  WordTemplateStorage,
  WordTemplateStore
} from "../legacy-port/wordTemplateStore";
import type { WordTemplateSpec } from "../legacy-port/wordTypes";

export interface DocxSource {
  markdown: string;
  title: string;
  /** Vault-relative path of the Markdown source, when one exists. */
  sourcePath?: string;
}

export interface PreparedDocx {
  bytes: Uint8Array;
  suggestedName: string;
  template: WordTemplateSpec;
}

export interface DocxExportResult extends PreparedDocx {
  saved: SavedFileResult;
}

export interface DocxExportServiceOptions {
  app: App;
  pluginId: string;
  fileGateway: FileGateway;
  templateStore: WordTemplateStore;
  getPandocPath: () => string;
  pandocService?: PandocDocxService;
  wordPdfPreviewService?: WordPdfPreviewService;
}

export interface ExactDocxPreview {
  docxBytes: Uint8Array;
  pdfBytes: Uint8Array;
  template: WordTemplateSpec;
}

const DOCX_MIME_EXTENSION = ".docx";
const WORK_DIR_NAME = "docx-work";
const WORD_ASSET_DIR_NAME = "word-assets";
const STYLE_FILTER_NAME = "docx_style_map.lua";
const WORD_PDF_SCRIPT_NAME = "Convert-WordToPdf.ps1";

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function cleanPathPart(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function joinAdapterPath(...parts: string[]): string {
  return normalizePath(parts.map(cleanPathPart).filter(Boolean).join("/"));
}

function parentAdapterPath(path: string): string {
  const parts = normalizePath(path).split("/");
  parts.pop();
  return parts.join("/");
}

function nativeAdapter(app: App): FileSystemAdapter {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) {
    throw new Error("Advanced DOCX export requires the Obsidian desktop app.");
  }
  return adapter;
}

async function ensureAdapterFolder(adapter: DataAdapter, path: string): Promise<void> {
  let current = "";
  for (const segment of normalizePath(path).split("/")) {
    if (!segment) continue;
    current = current ? `${current}/${segment}` : segment;
    if (await adapter.exists(current)) continue;
    try {
      await adapter.mkdir(current);
    } catch (error) {
      if (!(await adapter.exists(current))) throw error;
    }
  }
}

function uniqueWorkId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `work-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function withDocxExtension(value: string): string {
  const safe = safeSuggestedName(value, "document.docx");
  const { stem, extension } = splitFilename(safe);
  return extension.toLowerCase() === DOCX_MIME_EXTENSION
    ? safe
    : `${stem || "document"}${DOCX_MIME_EXTENSION}`;
}

function sourceTitle(source: DocxSource): string {
  const title = source.title.trim();
  return title || "document";
}

function sourceResourceFolders(
  adapter: FileSystemAdapter,
  sourcePath: string | undefined
): string[] {
  const paths = [adapter.getBasePath()];
  if (sourcePath) {
    const parent = parentAdapterPath(sourcePath);
    if (parent) paths.unshift(adapter.getFullPath(parent));
  }
  return Array.from(new Set(paths));
}

async function removeIfPresent(adapter: DataAdapter, path: string): Promise<void> {
  try {
    if (await adapter.exists(path)) await adapter.remove(path);
  } catch {
    // Cache cleanup is best-effort and never changes an export result.
  }
}

/**
 * Adapts Obsidian's DataAdapter to the pure WordTemplateStore contract.
 * Every path remains Vault-relative.
 */
export function createWordTemplateStorage(adapter: DataAdapter): WordTemplateStorage {
  return {
    exists: (path) => adapter.exists(normalizePath(path)),
    mkdir: (path) => adapter.mkdir(normalizePath(path)),
    async list(path): Promise<WordTemplateDirectoryListing> {
      const listing = await adapter.list(normalizePath(path));
      return { files: listing.files, folders: listing.folders };
    },
    read: (path) => adapter.read(normalizePath(path)),
    write: (path, data) => adapter.write(normalizePath(path), data),
    remove: (path) => adapter.remove(normalizePath(path))
  };
}

/**
 * Desktop-only orchestration for the optional Pandoc DOCX path.
 *
 * The service writes temporary inputs through Obsidian's adapter. Native paths
 * are derived only after a FileSystemAdapter guard, and final output is handed
 * to FileGateway rather than written directly to an arbitrary path.
 */
export class DocxExportService {
  private readonly app: App;
  private readonly pluginId: string;
  private readonly fileGateway: FileGateway;
  private readonly templateStore: WordTemplateStore;
  private readonly getPandocPath: () => string;
  private readonly pandocService: PandocDocxService;
  private readonly wordPdfPreviewService: WordPdfPreviewService;

  constructor(options: DocxExportServiceOptions) {
    this.app = options.app;
    this.pluginId = options.pluginId;
    this.fileGateway = options.fileGateway;
    this.templateStore = options.templateStore;
    this.getPandocPath = options.getPandocPath;
    this.pandocService = options.pandocService ?? new PandocDocxService();
    this.wordPdfPreviewService =
      options.wordPdfPreviewService ?? new WordPdfPreviewService();
  }

  get pluginRoot(): string {
    return joinAdapterPath(
      this.app.vault.configDir,
      "plugins",
      this.pluginId
    );
  }

  get workRoot(): string {
    return joinAdapterPath(this.pluginRoot, "cache", WORK_DIR_NAME);
  }

  get styleFilterPath(): string {
    return joinAdapterPath(
      this.pluginRoot,
      WORD_ASSET_DIR_NAME,
      STYLE_FILTER_NAME
    );
  }

  get wordPdfScriptPath(): string {
    return joinAdapterPath(
      this.pluginRoot,
      WORD_ASSET_DIR_NAME,
      WORD_PDF_SCRIPT_NAME
    );
  }

  private async referenceDocPath(
    adapter: FileSystemAdapter,
    template: WordTemplateSpec,
    action: UserInitiatedAction
  ): Promise<string> {
    const templateHash = this.templateStore.getTemplateHash(template);
    const path = this.templateStore.getReferenceDocPath(templateHash);
    if (await adapter.exists(path)) return path;

    await ensureAdapterFolder(adapter, parentAdapterPath(path));
    const base = await this.pandocService.readDefaultReferenceDocUserInitiated(
      this.getPandocPath(),
      action
    );
    const reference = await buildReferenceDocx(base, template);
    await adapter.writeBinary(path, arrayBuffer(reference));
    return path;
  }

  private async assertSupportAssets(adapter: FileSystemAdapter): Promise<void> {
    if (!(await adapter.exists(this.styleFilterPath))) {
      throw new Error(
        "The bundled DOCX style filter is missing. Reload HanMark and try again."
      );
    }
  }

  async buildDocxBytesUserInitiated(
    source: DocxSource,
    action: UserInitiatedAction
  ): Promise<PreparedDocx> {
    const adapter = nativeAdapter(this.app);
    await this.assertSupportAssets(adapter);
    await this.templateStore.ensureDirectories();
    await ensureAdapterFolder(adapter, this.workRoot);

    const template = await this.templateStore.readActiveTemplate();
    const referencePath = await this.referenceDocPath(adapter, template, action);
    const workId = uniqueWorkId();
    const markdownPath = joinAdapterPath(this.workRoot, `${workId}.md`);
    const outputPath = joinAdapterPath(this.workRoot, `${workId}.docx`);

    try {
      // Pandoc does not understand Obsidian wiki embeds or callout markers.
      // Reuse the conservative Markdown adapter so local images, tasks and
      // links keep the same meaning as the HWPX path.
      await adapter.write(
        markdownPath,
        adaptMarkdownForKordoc(
          extractEditableBodyStrict(source.markdown)
        ).markdown
      );
      await this.pandocService.convertUserInitiated(
        {
          pandocPath: this.getPandocPath(),
          inputPath: adapter.getFullPath(markdownPath),
          outputPath: adapter.getFullPath(outputPath),
          referenceDocPath: adapter.getFullPath(referencePath),
          luaFilterPath: adapter.getFullPath(this.styleFilterPath),
          resourcePaths: sourceResourceFolders(adapter, source.sourcePath)
        },
        action
      );
      if (!(await adapter.exists(outputPath))) {
        throw new Error("Pandoc did not produce a DOCX file.");
      }
      const bytes = new Uint8Array(await adapter.readBinary(outputPath));
      return {
        bytes,
        suggestedName: withDocxExtension(sourceTitle(source)),
        template
      };
    } finally {
      await removeIfPresent(adapter, markdownPath);
      await removeIfPresent(adapter, outputPath);
    }
  }

  async exportUserInitiated(
    source: DocxSource,
    action: UserInitiatedAction
  ): Promise<DocxExportResult> {
    const prepared = await this.buildDocxBytesUserInitiated(source, action);
    const saved = source.sourcePath
      ? await this.fileGateway.saveVaultSibling(
          prepared.bytes,
          prepared.suggestedName,
          source.sourcePath
        )
      : await this.fileGateway.saveFile(
          prepared.bytes,
          prepared.suggestedName
        );
    return { ...prepared, saved };
  }

  async buildExactPdfPreviewUserInitiated(
    source: DocxSource,
    action: UserInitiatedAction
  ): Promise<ExactDocxPreview> {
    if (!Platform.isWin || !Platform.isDesktopApp) {
      throw new Error("Word exact preview is only available on Windows desktop.");
    }
    const adapter = nativeAdapter(this.app);
    if (!(await adapter.exists(this.wordPdfScriptPath))) {
      throw new Error(
        "The bundled Word PDF preview script is missing. Reload HanMark and try again."
      );
    }
    const prepared = await this.buildDocxBytesUserInitiated(source, action);
    await ensureAdapterFolder(adapter, this.workRoot);
    const workId = uniqueWorkId();
    const docxPath = joinAdapterPath(this.workRoot, `${workId}.docx`);
    const pdfPath = joinAdapterPath(this.workRoot, `${workId}.pdf`);

    try {
      await adapter.writeBinary(docxPath, arrayBuffer(prepared.bytes));
      await this.wordPdfPreviewService.convertUserInitiated(
        {
          platform: "windows",
          scriptPath: adapter.getFullPath(this.wordPdfScriptPath),
          inputDocxPath: adapter.getFullPath(docxPath),
          outputPdfPath: adapter.getFullPath(pdfPath),
          outputExists: () => adapter.exists(pdfPath)
        },
        action
      );
      const pdfBytes = new Uint8Array(await adapter.readBinary(pdfPath));
      return {
        docxBytes: prepared.bytes,
        pdfBytes,
        template: prepared.template
      };
    } finally {
      await removeIfPresent(adapter, docxPath);
      await removeIfPresent(adapter, pdfPath);
    }
  }
}
