import {
  App,
  Modal,
  Notice,
  TFile,
  normalizePath,
  requestUrl,
  requireApiVersion
} from "obsidian";
import { parse } from "kordoc";
import { BulkImportReportModal } from "./BulkImportReportModal";
import {
  persistImportedImages,
  type PersistedCloudImage
} from "./importImages";
import {
  bridgeActiveNoteImagesThroughCmdsEagle,
  buildCmdsEagleStagingMarkdown,
  type CmdsEagleBridgeImage,
  type CmdsEagleBridgeDependencies
} from "./cmdsEagleBridge";
import {
  bytesAsArrayBuffer,
  createFileGateway,
  splitFilename,
  type SelectedExternalFile
} from "./fileGateway";
import { transformMarkdownImageTokens } from "./markdownImageTokens";
import { R2UploadError, uploadImageToR2 } from "./r2ImageUpload";
import { uploadBatchWithSingleAuthenticationRefresh } from "./r2BatchUpload";
import {
  normalizeImportedImageDestination,
  type ImportedImageDestination
} from "../legacy-port/settings";

const IMPORT_EXTENSIONS = ["hwp", "hwpx", "hwpml", "docx", "pdf", "xlsx", "xls"];
/** Ask for confirmation before bulk-converting at least this many files. */
const BULK_CONFIRM_THRESHOLD = 25;
type ImportImageDestination = Exclude<ImportedImageDestination, "ask">;

interface ImportCloudSettings {
  destination: ImportedImageDestination;
  workerUrl: string;
  publicUrl: string;
  executeCommandById?: (id: string) => boolean;
}

interface CloudImportResult {
  uploaded: number;
  warnings: string[];
}

interface LegacyVaultTrash {
  trash(file: TFile, system: boolean): Promise<void>;
}

const sessionR2Keys = new Map<string, string>();
let cmdsStagingSequence = 0;

/** Result of converting one document — a created note (ok) or a captured failure. */
export interface ImportResult {
  ok: boolean;
  rel?: string;
  warnings?: number;
  images?: number;
  cloudImages?: number;
  file?: string;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function importCloudSettings(plugin: unknown): ImportCloudSettings {
  const host = isRecord(plugin) ? plugin : {};
  const settings = isRecord(host.settings) ? host.settings : {};
  const command = host.executeCommandById;
  const executeCommandById =
    typeof command === "function"
      ? (id: string): boolean => command.call(host, id) === true
      : undefined;
  return {
    destination: normalizeImportedImageDestination(
      settings.importedImageDestination
    ),
    workerUrl:
      typeof settings.cmdsEagleWorkerUrl === "string"
        ? settings.cmdsEagleWorkerUrl.trim()
        : "",
    publicUrl:
      typeof settings.cmdsEaglePublicUrl === "string"
        ? settings.cmdsEaglePublicUrl.trim()
        : "",
    executeCommandById
  };
}

function preferredFolder(app: App): string {
  const path = app.workspace.getActiveFile()?.parent?.path;
  return path && path !== "/" ? path : "";
}

/**
 * Resolve a free note path. `reserved` holds paths already claimed by sibling imports running
 * in parallel — vault.create is async so getAbstractFileByPath alone would race.
 */
function uniqueNotePath(app: App, folder: string, base: string, reserved: Set<string>): string {
  const directory = folder ? `${folder}/` : "";
  let relative = normalizePath(`${directory}${base}.md`);
  let index = 1;
  while (app.vault.getAbstractFileByPath(relative) || reserved.has(relative)) {
    relative = normalizePath(`${directory}${base} (${index++}).md`);
  }
  reserved.add(relative);
  return relative;
}

/** Convert one selected document to a note without direct filesystem access. */
async function importOne(
  app: App,
  selected: SelectedExternalFile,
  reserved: Set<string>,
  destination: ImportImageDestination,
  cloudSettings: ImportCloudSettings
): Promise<ImportResult> {
  try {
    const arrayBuffer = bytesAsArrayBuffer(selected.bytes);
    const parsedName = splitFilename(selected.name);
    const result = await parse(arrayBuffer);
    if (result.success === false) {
      throw new Error(result.error || "문서를 파싱하지 못했습니다.");
    }

    const base = parsedName.stem
      .replace(/[\\/:*?"<>|#^[\]]/g, "_")
      .trim() || "불러온 문서";
    const relative = uniqueNotePath(app, preferredFolder(app), base, reserved);
    const persisted = await persistImportedImages(
      app,
      relative,
      result.markdown.trim(),
      result.images,
      { destination }
    );
    const note = await app.vault.create(relative, persisted.markdown.trim() + "\n");

    let cloud: CloudImportResult = { uploaded: 0, warnings: [] };
    if (destination === "cmds-eagle-r2" && persisted.cloudCandidates.length) {
      cloud = await moveImportedImagesToCloud(
        app,
        note,
        persisted.cloudCandidates,
        cloudSettings
      );
    }

    const warnings =
      (result.warnings?.length ?? 0) +
      persisted.warnings.length +
      cloud.warnings.length;
    return {
      ok: true,
      rel: relative,
      warnings,
      images: persisted.saved,
      cloudImages: cloud.uploaded
    };
  } catch (error) {
    return {
      ok: false,
      file: selected.name,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function chooseImportImageDestination(
  app: App
): Promise<ImportImageDestination | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: ImportImageDestination | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const modal = new Modal(app);
    modal.titleEl.setText("가져온 이미지 저장 방식");
    modal.contentEl.createEl("p", {
      text:
        "이번 문서에서 추출한 이미지를 Vault 첨부 파일로 둘지, " +
        "CMDS Eagle의 현재 클라우드 제공자로 올릴지 선택하세요."
    });
    const row = modal.contentEl.createDiv();
    row.setCssStyles({ marginTop: "12px" });
    const local = row.createEl("button", {
      text: "Vault 첨부 파일",
      attr: { type: "button" }
    });
    local.onclick = () => {
      finish("vault");
      modal.close();
    };
    const cloud = row.createEl("button", {
      text: "CMDS Eagle 현재 클라우드",
      attr: { type: "button" }
    });
    cloud.classList.add("mod-cta");
    cloud.setCssStyles({ marginLeft: "8px" });
    cloud.onclick = () => {
      finish("cmds-eagle-r2");
      modal.close();
    };
    const cancel = row.createEl("button", {
      text: "취소",
      attr: { type: "button" }
    });
    cancel.setCssStyles({ marginLeft: "8px" });
    cancel.onclick = () => {
      finish(null);
      modal.close();
    };
    modal.onClose = () => finish(null);
    modal.open();
  });
}

function requestSessionR2Key(
  app: App,
  workerUrl: string,
  forceReplacement = false
): Promise<string | null> {
  const cached = forceReplacement ? undefined : sessionR2Keys.get(workerUrl);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const modal = new Modal(app);
    modal.titleEl.setText("R2 직접 연결 API 키");
    modal.contentEl.createEl("p", {
      text:
        "CMDS Eagle 브리지를 사용할 수 없어 직접 R2 폴백을 시도합니다. " +
        "키는 현재 Obsidian 세션의 메모리에만 두며 설정 파일에 저장하지 않습니다."
    });
    let inputValue = "";
    const setting = modal.contentEl.createDiv();
    const label = setting.createEl("label", {
      text: "API Key"
    });
    const input = setting.createEl("input", {
      attr: {
        type: "password",
        autocomplete: "off",
        spellcheck: "false",
        "aria-label": "Cloudflare R2 API Key"
      }
    });
    label.setCssStyles({ display: "block", marginBottom: "6px" });
    input.setCssStyles({ width: "100%" });
    input.addEventListener("input", () => {
      inputValue = input.value;
    });
    const row = modal.contentEl.createDiv();
    row.setCssStyles({ marginTop: "12px" });
    const submit = row.createEl("button", {
      text: "이번 세션에 사용",
      attr: { type: "button" }
    });
    submit.classList.add("mod-cta");
    const submitValue = (): void => {
      if (!inputValue) {
        new Notice("API 키를 입력해 주세요.");
        return;
      }
      finish(inputValue);
      input.value = "";
      inputValue = "";
      modal.close();
    };
    submit.onclick = submitValue;
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitValue();
      }
    });
    const cancel = row.createEl("button", {
      text: "취소",
      attr: { type: "button" }
    });
    cancel.setCssStyles({ marginLeft: "8px" });
    cancel.onclick = () => {
      input.value = "";
      inputValue = "";
      finish(null);
      modal.close();
    };
    modal.onClose = () => {
      input.value = "";
      inputValue = "";
      finish(null);
    };
    modal.open();
    input.focus();
  });
}

function bridgeDependencies(
  app: App,
  stagingNote: TFile,
  executeCommandById: ((id: string) => boolean) | undefined
): CmdsEagleBridgeDependencies {
  return {
    triggerWorkspaceEvent: (eventName, request) => {
      app.workspace.trigger(eventName, request);
    },
    executeCommandById: (commandId) => {
      // CMDS Eagle resolves its target from the active file at command
      // execution time. Re-check immediately before dispatch so a user
      // switching tabs during capability discovery cannot mutate another note.
      if (app.workspace.getActiveFile()?.path !== stagingNote.path) return false;
      return executeCommandById?.(commandId) ?? false;
    },
    readActiveNote: () => app.vault.read(stagingNote),
    writeActiveNote: (markdown) => app.vault.modify(stagingNote, markdown),
    scheduleTimeout: (callback, milliseconds) =>
      window.setTimeout(callback, milliseconds),
    cancelTimeout: (handle) => {
      if (typeof handle === "number") window.clearTimeout(handle);
    }
  };
}

function replaceStagedImageUrls(
  markdown: string,
  replacements: ReadonlyMap<string, string>
): {
  markdown: string;
  appliedSources: ReadonlySet<string>;
} {
  const appliedSources = new Set<string>();
  const rewritten = transformMarkdownImageTokens(markdown, (token) => {
    const remoteUrl = replacements.get(token.source);
    if (!remoteUrl) return token.raw;
    appliedSources.add(token.source);
    const escapedAlt = token.alt
      .replace(/\\/gu, "\\\\")
      .replace(/\]/gu, "\\]");
    return `![${escapedAlt}](${remoteUrl})`;
  });
  return { markdown: rewritten, appliedSources };
}

function uniqueCmdsBridgeImages(
  candidates: readonly PersistedCloudImage[]
): CmdsEagleBridgeImage[] {
  const sources = new Set<string>();
  const images: CmdsEagleBridgeImage[] = [];
  for (const candidate of candidates) {
    if (sources.has(candidate.markdownUrl)) continue;
    sources.add(candidate.markdownUrl);
    images.push({
      localSource: candidate.markdownUrl,
      fileName:
        candidate.vaultPath.split("/").pop() || "hanmark-imported-image.png",
      mimeType: candidate.mimeType,
      bytes: candidate.data
    });
  }
  return images;
}

function uniqueCmdsStagingPath(app: App): string {
  const seed = `${Date.now().toString(36)}-${(++cmdsStagingSequence).toString(36)}`;
  let attempt = 0;
  while (true) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const path = normalizePath(
      `HanMark-Imported-Images/HanMark-CMDS-Staging-${seed}${suffix}.md`
    );
    if (!app.vault.getAbstractFileByPath(path)) return path;
    attempt += 1;
  }
}

async function createCmdsStagingNote(
  app: App,
  images: readonly CmdsEagleBridgeImage[]
): Promise<TFile> {
  const path = uniqueCmdsStagingPath(app);
  return app.vault.create(path, `${buildCmdsEagleStagingMarkdown(images)}\n`);
}

async function deleteCmdsStagingNote(
  app: App,
  stagingNote: TFile
): Promise<boolean> {
  try {
    // Do not permanently delete even this plugin-owned staging note. Older
    // supported Obsidian versions lack FileManager.trashFile, so retain it and
    // surface the cleanup warning instead of bypassing the user's trash policy.
    if (requireApiVersion("1.6.6")) {
      await app.fileManager.trashFile(stagingNote);
      return true;
    }
    // Vault.trash is the public, recoverable predecessor used only on the
    // explicitly supported 1.5.x compatibility path.
    const legacyVault = app.vault as unknown as LegacyVaultTrash;
    await legacyVault.trash(stagingNote, false);
    return true;
  } catch {
    return false;
  }
}

async function applyVerifiedCloudReplacements(
  app: App,
  note: TFile,
  entries: readonly { localSource: string; remoteUrl: string }[]
): Promise<ReadonlySet<string>> {
  if (!entries.length) return new Set<string>();
  const replacements = new Map(
    entries.map((entry) => [entry.localSource, entry.remoteUrl])
  );
  const current = await app.vault.read(note);
  const rewritten = replaceStagedImageUrls(current, replacements);
  if (rewritten.markdown !== current) {
    await app.vault.modify(note, rewritten.markdown);
  }
  return rewritten.appliedSources;
}

async function directR2Fallback(
  app: App,
  note: TFile,
  candidates: readonly PersistedCloudImage[],
  settings: ImportCloudSettings
): Promise<CloudImportResult> {
  if (!settings.workerUrl || !settings.publicUrl) {
    return {
      uploaded: 0,
      warnings: [
        "CMDS Eagle 브리지를 사용할 수 없고 직접 R2 폴백 URL도 설정되지 않아 로컬 이미지 링크를 유지했습니다."
      ]
    };
  }
  const batch = await uploadBatchWithSingleAuthenticationRefresh(candidates, {
    requestInitialKey: () => requestSessionR2Key(app, settings.workerUrl),
    requestReplacementKey: () =>
      requestSessionR2Key(app, settings.workerUrl, true),
    upload: async (candidate, apiKey) => {
      const filename =
        candidate.vaultPath.split("/").pop() || "hanmark-imported-image.png";
      const uploaded = await uploadImageToR2(
        async (request) => {
          const response = await requestUrl(request);
          return { status: response.status, text: response.text };
        },
        {
          workerUrl: settings.workerUrl,
          publicUrl: settings.publicUrl,
          apiKey
        },
        {
          data: candidate.data,
          filename,
          contentType: candidate.mimeType
        }
      );
      return uploaded.publicUrl;
    },
    isAuthenticationFailure: (error) =>
      error instanceof R2UploadError
      && error.code === "http-error"
      && (error.status === 401 || error.status === 403),
    cacheAuthenticatedKey: (apiKey) => {
      // Cache only a key that completed an authenticated upload.
      sessionR2Keys.set(settings.workerUrl, apiKey);
    },
    clearRejectedKey: () => {
      sessionR2Keys.delete(settings.workerUrl);
    }
  });

  if (batch.initialKeyCancelled) {
    return {
      uploaded: 0,
      warnings: [
        "R2 직접 연결이 취소되어 안전한 로컬 이미지 링크를 유지했습니다."
      ]
    };
  }

  const replacements = new Map(
    batch.successes.map(({ item, remoteUrl }) => [item.markdownUrl, remoteUrl])
  );
  const warnings = batch.failures.map(({ item, kind }) =>
    kind === "authentication"
      ? `R2 인증을 확인하지 못해 이 이미지부터 남은 이미지는 로컬로 유지했습니다: ${item.filename}`
      : `R2 직접 업로드에 실패해 로컬 이미지를 유지했습니다: ${item.filename}`
  );
  if (batch.replacementKeyCancelled) {
    warnings.push(
      "새 API 키 입력이 취소되어 남은 이미지의 직접 업로드를 중단했습니다."
    );
  }

  if (replacements.size) {
    const markdown = await app.vault.read(note);
    const rewritten = replaceStagedImageUrls(markdown, replacements);
    if (rewritten.markdown !== markdown) {
      await app.vault.modify(note, rewritten.markdown);
    }
  }
  return { uploaded: replacements.size, warnings };
}

async function moveImportedImagesToCloud(
  app: App,
  note: TFile,
  candidates: readonly PersistedCloudImage[],
  settings: ImportCloudSettings
): Promise<CloudImportResult> {
  const progress = new Notice(
    `CMDS Eagle로 이미지 ${candidates.length}개를 업로드하는 중…`,
    0
  );
  try {
    const images = uniqueCmdsBridgeImages(candidates);
    const stagingNote = await createCmdsStagingNote(app, images);
    await app.workspace.getLeaf(false).openFile(stagingNote);
    const targetIsActive =
      app.workspace.getActiveFile()?.path === stagingNote.path;
    const bridge = await bridgeActiveNoteImagesThroughCmdsEagle(
      bridgeDependencies(app, stagingNote, settings.executeCommandById),
      images,
      {
        allowCommandFallback: targetIsActive,
        commandTimeoutMs: Math.min(
          15 * 60_000,
          Math.max(60_000, candidates.length * 20_000)
        )
      }
    );
    const appliedSources = await applyVerifiedCloudReplacements(
      app,
      note,
      bridge.replacements
    );
    const allVerifiedReplacementsApplied =
      appliedSources.size === bridge.replacements.length;

    if (bridge.status === "success") {
      const warnings: string[] = [];
      if (allVerifiedReplacementsApplied) {
        if (!(await deleteCmdsStagingNote(app, stagingNote))) {
          warnings.push(
            `업로드는 완료했지만 임시 staging 노트를 정리하지 못했습니다: ${stagingNote.path}`
          );
        }
      } else {
        warnings.push(
          `검증된 URL 일부를 최종 노트에 적용하지 못해 staging 노트를 보존했습니다: ${stagingNote.path}`
        );
      }
      await app.workspace.getLeaf(false).openFile(note);
      return { uploaded: bridge.replacements.length, warnings };
    }
    if (bridge.commandDispatched) {
      await app.workspace.getLeaf(false).openFile(note);
      return {
        uploaded: bridge.replacements.length,
        warnings: [
          `CMDS Eagle에 업로드 명령을 전달했지만 ${
            bridge.unresolvedSources.length
          }개 URL의 교체를 확인하지 못했습니다. 중복 업로드를 막기 위해 직접 R2 폴백은 실행하지 않았습니다. ` +
          `늦은 CMDS 쓰기와 복구를 위해 staging 노트를 보존했습니다: ${stagingNote.path}`
        ]
      };
    }
    if (bridge.eventUploadAttempted) {
      await app.workspace.getLeaf(false).openFile(note);
      return {
        uploaded: bridge.replacements.length,
        warnings: [
          `CMDS Eagle 공개 브리지에서 ${
            bridge.unresolvedSources.length
          }개 URL의 교체를 확인하지 못했습니다. 원격 업로드가 이미 일어났을 수 있어 중복 방지를 위해 다른 업로드 경로는 자동 실행하지 않았습니다. ` +
          `복구를 위해 staging 노트를 보존했습니다: ${stagingNote.path}`
        ]
      };
    }

    const cleanupWarnings: string[] = [];
    if (bridge.status === "unavailable") {
      if (!(await deleteCmdsStagingNote(app, stagingNote))) {
        cleanupWarnings.push(
          `실행되지 않은 임시 staging 노트를 정리하지 못했습니다: ${stagingNote.path}`
        );
      }
    } else {
      // A partial result is deliberately recoverable even when neither public
      // event nor command reported dispatch (for example, cancellation).
      cleanupWarnings.push(
        `부분 완료 상태를 복구할 수 있도록 staging 노트를 보존했습니다: ${stagingNote.path}`
      );
    }
    await app.workspace.getLeaf(false).openFile(note);
    const unresolved = new Set(bridge.unresolvedSources);
    const remaining = candidates.filter((candidate) =>
      unresolved.has(candidate.markdownUrl)
    );
    if (bridge.status !== "unavailable") {
      return {
        uploaded: bridge.replacements.length,
        warnings: cleanupWarnings
      };
    }
    const direct = await directR2Fallback(app, note, remaining, settings);
    return {
      uploaded: bridge.replacements.length + direct.uploaded,
      warnings: [...cleanupWarnings, ...direct.warnings]
    };
  } finally {
    progress.hide();
  }
}

/** Run `worker` over `items` with at most `limit` in flight at once. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const runner = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
}

/** Confirm before a large bulk import. Resolves false on cancel/close. */
function confirmBulk(app: App, count: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const modal = new Modal(app);
    modal.titleEl.setText("여러 파일 불러오기");
    modal.contentEl.createEl("p", {
      text: `${count}개 파일을 변환해 각각 새 노트로 만듭니다. 계속할까요?`
    });
    const row = modal.contentEl.createDiv();
    row.setCssStyles({ marginTop: "12px" });
    const yes = row.createEl("button", { text: `네, ${count}개 변환` });
    yes.classList.add("mod-cta");
    yes.onclick = () => {
      finish(true);
      modal.close();
    };
    const no = row.createEl("button", { text: "취소" });
    no.setCssStyles({ marginLeft: "8px" });
    no.onclick = () => {
      finish(false);
      modal.close();
    };
    modal.onClose = () => finish(false);
    modal.open();
  });
}

/**
 * Pick one or many Kordoc-supported documents and convert each to a Markdown note.
 * The browser File API supplies bytes; absolute paths are never opened by HanMark.
 */
export async function importDocument(app: App, plugin?: unknown): Promise<void> {
  const gateway = createFileGateway(app, plugin);
  const cloudSettings = importCloudSettings(plugin);
  const selectedFiles = await gateway.pickFiles({
    title: "한글·문서 불러오기 (여러 개 선택 가능)",
    extensions: IMPORT_EXTENSIONS,
    multiple: true
  });
  if (!selectedFiles.length) return;
  const destination =
    cloudSettings.destination === "ask"
      ? await chooseImportImageDestination(app)
      : cloudSettings.destination;
  if (!destination) return;
  const reserved = new Set<string>();

  if (selectedFiles.length === 1) {
    const progress = new Notice("문서를 변환하는 중…", 0);
    try {
      const result = await importOne(
        app,
        selectedFiles[0],
        reserved,
        destination,
        cloudSettings
      );
      if (result.ok) {
        const file = app.vault.getAbstractFileByPath(result.rel ?? "");
        if (
          file instanceof TFile &&
          app.workspace.getActiveFile()?.path !== file.path
        ) {
          await app.workspace.getLeaf(true).openFile(file);
        }
        new Notice(
          `불러오기 완료: ${result.rel}${
            result.images ? ` · 이미지 ${result.images}개 저장` : ""
          }${result.cloudImages ? ` · R2 ${result.cloudImages}개` : ""}${
            result.warnings ? ` (경고 ${result.warnings}건)` : ""
          }`
        );
      } else {
        new Notice(`불러오기 실패: ${result.error}`);
      }
    } finally {
      progress.hide();
    }
    return;
  }

  if (
    selectedFiles.length >= BULK_CONFIRM_THRESHOLD &&
    !(await confirmBulk(app, selectedFiles.length))
  ) return;

  const limit =
    destination === "cmds-eagle-r2"
      ? 1
      : Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
  const progress = new Notice(`변환 중 0/${selectedFiles.length}…`, 0);
  const results: ImportResult[] = [];
  let done = 0;
  try {
    await runPool(selectedFiles, limit, async (selected, index) => {
      results[index] = await importOne(
        app,
        selected,
        reserved,
        destination,
        cloudSettings
      );
      done++;
      progress.setMessage(`변환 중 ${done}/${selectedFiles.length}…`);
    });
  } finally {
    progress.hide();
  }

  const succeeded = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  const warned = succeeded.filter((result) => (result.warnings ?? 0) > 0);
  new Notice(`불러오기: ✅ ${succeeded.length} · ⚠️ ${warned.length} · ❌ ${failed.length}`);
  if (failed.length || warned.length) new BulkImportReportModal(app, { results }).open();
}
