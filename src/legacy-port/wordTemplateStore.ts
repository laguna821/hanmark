import { sha256Bytes } from "../io/hash";
import { duplicateWordTemplate } from "./defaultWordTemplate";
import type { DocxPreviewMode } from "./settings";
import {
  cloneWordTemplate,
  parseWordTemplateJson,
  type WordTemplateSpec
} from "./wordTypes";

export interface WordTemplateDirectoryListing {
  files: string[];
  folders: string[];
}

/**
 * The subset shared by Obsidian's DataAdapter and an in-memory test adapter.
 * All paths are Vault-relative; no native filesystem access occurs here.
 */
export interface WordTemplateStorage {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<WordTemplateDirectoryListing>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface WordTemplateStoreOptions {
  storage: WordTemplateStorage;
  rootPath: string;
  getActiveTemplateId: () => string;
  setActiveTemplateId: (id: string) => void;
  createId?: () => string;
}

function cleanPathPart(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function joinPath(...parts: string[]): string {
  return parts.map(cleanPathPart).filter(Boolean).join("/");
}

function requireSafeId(id: string): string {
  const normalized = id.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error("Word template id may contain only letters, numbers, underscores, and hyphens.");
  }
  return normalized;
}

function cleanName(name: string): string {
  const normalized = [...name]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0x20 || codePoint === 0x7f ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) throw new Error("Word template name cannot be empty.");
  return normalized.slice(0, 120);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

function hashText(value: string): string {
  return sha256Bytes(new TextEncoder().encode(value));
}

function defaultId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const suffix = Math.random().toString(36).slice(2, 12);
  return `template-${Date.now().toString(36)}-${suffix}`;
}

export class WordTemplateStore {
  private readonly storage: WordTemplateStorage;
  private readonly rootPath: string;
  private readonly getActiveTemplateId: () => string;
  private readonly setActiveTemplateId: (id: string) => void;
  private readonly createId: () => string;

  constructor(options: WordTemplateStoreOptions) {
    this.storage = options.storage;
    this.rootPath = cleanPathPart(options.rootPath);
    this.getActiveTemplateId = options.getActiveTemplateId;
    this.setActiveTemplateId = options.setActiveTemplateId;
    this.createId = options.createId ?? defaultId;
  }

  get templateDir(): string {
    return joinPath(this.rootPath, "word-templates");
  }

  get cacheDir(): string {
    return joinPath(this.rootPath, "cache");
  }

  get referenceCacheDir(): string {
    return joinPath(this.cacheDir, "reference-docx");
  }

  get previewDocxCacheDir(): string {
    return joinPath(this.cacheDir, "preview-docx");
  }

  get previewPdfCacheDir(): string {
    return joinPath(this.cacheDir, "preview-pdf");
  }

  async ensureDirectories(): Promise<void> {
    for (const target of [
      this.templateDir,
      this.cacheDir,
      this.referenceCacheDir,
      this.previewDocxCacheDir,
      this.previewPdfCacheDir
    ]) {
      await this.ensureDirectory(target);
    }
  }

  private async ensureDirectory(path: string): Promise<void> {
    let current = "";
    for (const segment of cleanPathPart(path).split("/")) {
      if (!segment) continue;
      current = current ? `${current}/${segment}` : segment;
      if (!(await this.storage.exists(current))) await this.storage.mkdir(current);
    }
  }

  getTemplatePath(id: string): string {
    return joinPath(this.templateDir, `${requireSafeId(id)}.json`);
  }

  async writeTemplate(template: WordTemplateSpec): Promise<WordTemplateSpec> {
    const normalized = parseWordTemplateJson(JSON.stringify(template));
    requireSafeId(normalized.id);
    normalized.name = cleanName(normalized.name);
    await this.ensureDirectories();
    await this.storage.write(this.getTemplatePath(normalized.id), JSON.stringify(normalized, null, 2));
    return cloneWordTemplate(normalized);
  }

  async ensureDefaultTemplate(template: WordTemplateSpec): Promise<WordTemplateSpec> {
    await this.ensureDirectories();
    if (!(await this.storage.exists(this.getTemplatePath(template.id)))) {
      await this.writeTemplate(template);
    }
    return (await this.readTemplate(template.id)) ?? cloneWordTemplate(template);
  }

  async readTemplate(id: string): Promise<WordTemplateSpec | null> {
    const path = this.getTemplatePath(id);
    if (!(await this.storage.exists(path))) return null;
    return parseWordTemplateJson(await this.storage.read(path));
  }

  async readActiveTemplate(): Promise<WordTemplateSpec> {
    const activeId = this.getActiveTemplateId() || "default";
    const active = await this.readTemplate(activeId);
    if (active) return active;
    const fallback = await this.readTemplate("default");
    if (fallback) {
      this.setActiveTemplateId("default");
      return fallback;
    }
    throw new Error(`Word template not found: ${activeId}`);
  }

  async listTemplates(): Promise<WordTemplateSpec[]> {
    await this.ensureDirectories();
    const listing = await this.storage.list(this.templateDir);
    const templates: WordTemplateSpec[] = [];
    for (const filePath of listing.files.filter((path) => path.toLowerCase().endsWith(".json"))) {
      templates.push(parseWordTemplateJson(await this.storage.read(filePath)));
    }
    return templates.sort((left, right) => {
      if (left.id === "default") return -1;
      if (right.id === "default") return 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });
  }

  async createTemplate(name: string, source?: WordTemplateSpec): Promise<WordTemplateSpec> {
    const base = source ?? (await this.readActiveTemplate());
    const template = duplicateWordTemplate(base, requireSafeId(this.createId()), cleanName(name));
    return this.writeTemplate(template);
  }

  async duplicateTemplate(id: string, name: string): Promise<WordTemplateSpec> {
    const source = await this.readTemplate(id);
    if (!source) throw new Error(`Word template not found: ${id}`);
    return this.createTemplate(name, source);
  }

  async renameTemplate(id: string, name: string): Promise<WordTemplateSpec> {
    const template = await this.readTemplate(id);
    if (!template) throw new Error(`Word template not found: ${id}`);
    template.name = cleanName(name);
    return this.writeTemplate(template);
  }

  async deleteTemplate(id: string): Promise<void> {
    const safeId = requireSafeId(id);
    const path = this.getTemplatePath(safeId);
    if (await this.storage.exists(path)) await this.storage.remove(path);
    if (this.getActiveTemplateId() === safeId) this.setActiveTemplateId("default");
  }

  async setActiveTemplate(id: string): Promise<WordTemplateSpec> {
    const template = await this.readTemplate(id);
    if (!template) throw new Error(`Word template not found: ${id}`);
    this.setActiveTemplateId(template.id);
    return template;
  }

  async importTemplateJson(json: string): Promise<WordTemplateSpec> {
    const imported = parseWordTemplateJson(json);
    if (await this.readTemplate(imported.id)) imported.id = requireSafeId(this.createId());
    return this.writeTemplate(imported);
  }

  async exportTemplateJson(id: string): Promise<string> {
    const template = await this.readTemplate(id);
    if (!template) throw new Error(`Word template not found: ${id}`);
    return JSON.stringify(template, null, 2);
  }

  getTemplateHash(template: WordTemplateSpec): string {
    return hashText(JSON.stringify(canonicalize(template)));
  }

  getPreviewCacheKey(
    template: WordTemplateSpec,
    markdown: string,
    mode: DocxPreviewMode
  ): string {
    return `${this.getTemplateHash(template)}-${hashText(markdown)}-${mode}-v3`;
  }

  getReferenceDocPath(templateHash: string): string {
    return joinPath(this.referenceCacheDir, `${templateHash}.docx`);
  }

  getPreviewDocxPath(cacheKey: string): string {
    return joinPath(this.previewDocxCacheDir, `${cacheKey}.docx`);
  }

  getPreviewPdfPath(cacheKey: string): string {
    return joinPath(this.previewPdfCacheDir, `${cacheKey}.pdf`);
  }
}
