import {
  markdownImageTokens,
  transformMarkdownImageTokens
} from "./markdownImageTokens";

export const CMDS_EAGLE_CAPABILITIES_EVENT =
  "cmds-eagle:capabilities:v1";
export const CMDS_EAGLE_UPLOAD_IMAGE_EVENT =
  "cmds-eagle:upload-image:v1";
export const CMDS_EAGLE_CONVERT_COMMAND =
  "cmds-eagle:convert-all-to-cloud";

export interface CmdsEagleBridgeImage {
  readonly localSource: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface CmdsEagleCapabilitiesRequestV1 {
  readonly version: 1;
  readonly respond: (response: unknown) => void;
}

export interface CmdsEagleUploadImageRequestV1 {
  readonly version: 1;
  readonly image: {
    readonly fileName: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
  };
  readonly respond: (response: unknown) => void;
}

export interface CmdsEagleBridgeDependencies {
  readonly triggerWorkspaceEvent: (
    eventName: string,
    request: unknown
  ) => void;
  readonly executeCommandById: (commandId: string) => boolean;
  readonly readActiveNote: () => Promise<string>;
  readonly writeActiveNote: (markdown: string) => Promise<void>;
  readonly scheduleTimeout: (
    callback: () => void,
    milliseconds: number
  ) => unknown;
  readonly cancelTimeout: (handle: unknown) => void;
}

export interface CmdsEagleBridgeOptions {
  readonly signal?: AbortSignal;
  readonly allowCommandFallback?: boolean;
  readonly capabilityTimeoutMs?: number;
  readonly uploadTimeoutMs?: number;
  readonly commandTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

export type CmdsEagleBridgeVia =
  | "none"
  | "workspace-event"
  | "command"
  | "workspace-event+command";

export type CmdsEagleBridgeIssue =
  | "cancelled"
  | "event-upload-failed"
  | "note-read-failed"
  | "note-write-failed"
  | "source-not-found"
  | "command-unavailable"
  | "command-timeout";

export interface CmdsEagleUrlReplacement {
  readonly localSource: string;
  readonly remoteUrl: string;
}

interface CmdsEagleBridgeResultBase {
  readonly via: CmdsEagleBridgeVia;
  readonly replacements: readonly CmdsEagleUrlReplacement[];
  readonly unresolvedSources: readonly string[];
  readonly issues: readonly CmdsEagleBridgeIssue[];
  readonly eventResponderFound: boolean;
  readonly eventUploadAttempted: boolean;
  readonly commandDispatched: boolean;
}

export interface CmdsEagleBridgeSuccess
  extends CmdsEagleBridgeResultBase {
  readonly status: "success";
}

export interface CmdsEagleBridgeUnavailable
  extends CmdsEagleBridgeResultBase {
  readonly status: "unavailable";
  readonly via: "none";
}

export interface CmdsEagleBridgePartial
  extends CmdsEagleBridgeResultBase {
  readonly status: "partial";
}

export type CmdsEagleBridgeResult =
  | CmdsEagleBridgeSuccess
  | CmdsEagleBridgeUnavailable
  | CmdsEagleBridgePartial;

interface EventCapabilities {
  readonly canUploadImage: boolean;
}

type ResponseWaitResult =
  | { readonly kind: "response"; readonly value: unknown }
  | { readonly kind: "timeout" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "trigger-failed" };

type CommandPollResult =
  | {
    readonly kind: "complete";
    readonly replacements: readonly CmdsEagleUrlReplacement[];
  }
  | {
    readonly kind: "incomplete";
    readonly replacements: readonly CmdsEagleUrlReplacement[];
    readonly issue: Extract<
      CmdsEagleBridgeIssue,
      "cancelled" | "command-timeout" | "note-read-failed"
    >;
  };

const DEFAULT_CAPABILITY_TIMEOUT_MS = 300;
const DEFAULT_UPLOAD_TIMEOUT_MS = 30_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 150;

function safeTimeout(value: number | undefined, fallback: number): number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
  ) {
    return fallback;
  }
  return Math.floor(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRemoteHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function readCapabilities(value: unknown): EventCapabilities | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (value.canUploadImage === true) {
    return { canUploadImage: true };
  }
  const capabilities = value.capabilities;
  if (
    Array.isArray(capabilities)
    && capabilities.some((entry) => entry === "upload-image")
  ) {
    return { canUploadImage: true };
  }
  return null;
}

function readUploadUrl(value: unknown): string | null {
  if (!isRecord(value) || value.version !== 1 || value.ok !== true) {
    return null;
  }
  if (isRemoteHttpsUrl(value.url)) return value.url;
  if (isRemoteHttpsUrl(value.publicUrl)) return value.publicUrl;
  return null;
}

function uniqueImages(
  images: readonly CmdsEagleBridgeImage[]
): CmdsEagleBridgeImage[] {
  const sources = new Set<string>();
  const unique: CmdsEagleBridgeImage[] = [];
  for (const image of images) {
    if (!image.localSource || sources.has(image.localSource)) continue;
    sources.add(image.localSource);
    unique.push(image);
  }
  return unique;
}

/**
 * Build the complete content of a disposable CMDS command staging note.
 * Each local source appears exactly once, even when the imported document
 * references the same extracted image repeatedly.
 */
export function buildCmdsEagleStagingMarkdown(
  requestedImages: readonly CmdsEagleBridgeImage[]
): string {
  return uniqueImages(requestedImages)
    .map(
      (image, index) =>
        `![HanMark imported image ${index + 1}](${image.localSource})`
    )
    .join("\n");
}

function uniqueIssues(
  issues: readonly CmdsEagleBridgeIssue[]
): CmdsEagleBridgeIssue[] {
  return [...new Set(issues)];
}

function combineVia(
  eventUsed: boolean,
  commandDispatched: boolean
): CmdsEagleBridgeVia {
  if (eventUsed && commandDispatched) return "workspace-event+command";
  if (eventUsed) return "workspace-event";
  if (commandDispatched) return "command";
  return "none";
}

function waitForResponse(
  dependencies: Pick<
    CmdsEagleBridgeDependencies,
    "scheduleTimeout" | "cancelTimeout"
  >,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  trigger: (respond: (response: unknown) => void) => void
): Promise<ResponseWaitResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timeout: unknown = null;

    const finish = (result: ResponseWaitResult): void => {
      if (settled) return;
      settled = true;
      if (timeout !== null) dependencies.cancelTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish({ kind: "cancelled" });
    if (signal?.aborted) {
      finish({ kind: "cancelled" });
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    timeout = dependencies.scheduleTimeout(
      () => finish({ kind: "timeout" }),
      timeoutMs
    );
    try {
      trigger((value) => finish({ kind: "response", value }));
    } catch {
      finish({ kind: "trigger-failed" });
    }
  });
}

async function discoverEventResponder(
  dependencies: CmdsEagleBridgeDependencies,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<"available" | "unavailable" | "cancelled"> {
  const result = await waitForResponse(
    dependencies,
    timeoutMs,
    signal,
    (respond) => {
      const request: CmdsEagleCapabilitiesRequestV1 = {
        version: 1,
        respond
      };
      dependencies.triggerWorkspaceEvent(
        CMDS_EAGLE_CAPABILITIES_EVENT,
        request
      );
    }
  );
  if (result.kind === "cancelled") return "cancelled";
  if (result.kind !== "response") return "unavailable";
  return readCapabilities(result.value)?.canUploadImage
    ? "available"
    : "unavailable";
}

async function uploadThroughEvent(
  dependencies: CmdsEagleBridgeDependencies,
  image: CmdsEagleBridgeImage,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<
  | { readonly kind: "uploaded"; readonly remoteUrl: string }
  | { readonly kind: "failed" }
  | { readonly kind: "cancelled" }
> {
  const result = await waitForResponse(
    dependencies,
    timeoutMs,
    signal,
    (respond) => {
      const request: CmdsEagleUploadImageRequestV1 = {
        version: 1,
        image: {
          fileName: image.fileName,
          mimeType: image.mimeType,
          bytes: image.bytes
        },
        respond
      };
      dependencies.triggerWorkspaceEvent(
        CMDS_EAGLE_UPLOAD_IMAGE_EVENT,
        request
      );
    }
  );
  if (result.kind === "cancelled") return { kind: "cancelled" };
  if (result.kind !== "response") return { kind: "failed" };
  const remoteUrl = readUploadUrl(result.value);
  return remoteUrl
    ? { kind: "uploaded", remoteUrl }
    : { kind: "failed" };
}

function applyReplacements(
  markdown: string,
  replacements: ReadonlyMap<string, string>
): {
  readonly markdown: string;
  readonly appliedSources: ReadonlySet<string>;
} {
  const appliedSources = new Set<string>();
  const transformed = transformMarkdownImageTokens(markdown, (token) => {
    const remoteUrl = replacements.get(token.source);
    if (!remoteUrl) return token.raw;
    appliedSources.add(token.source);
    const escapedAlt = token.alt
      .replace(/\\/g, "\\\\")
      .replace(/\]/g, "\\]");
    return `![${escapedAlt}](${remoteUrl})`;
  });
  return { markdown: transformed, appliedSources };
}

function sourceOrdinals(
  markdown: string,
  sources: ReadonlySet<string>
): ReadonlyMap<string, readonly number[]> {
  const ordinals = new Map<string, number[]>();
  const tokens = markdownImageTokens(markdown);
  for (let index = 0; index < tokens.length; index += 1) {
    const source = tokens[index].source;
    if (!sources.has(source)) continue;
    const current = ordinals.get(source) ?? [];
    current.push(index);
    ordinals.set(source, current);
  }
  return ordinals;
}

function convertedAtOrdinals(
  markdown: string,
  ordinals: ReadonlyMap<string, readonly number[]>
): CmdsEagleUrlReplacement[] {
  const tokens = markdownImageTokens(markdown);
  const replacements: CmdsEagleUrlReplacement[] = [];
  for (const [localSource, indexes] of ordinals) {
    let remoteUrl: string | null = null;
    let allConverted = indexes.length > 0;
    for (const index of indexes) {
      const source = tokens[index]?.source;
      if (!isRemoteHttpsUrl(source)) {
        allConverted = false;
        break;
      }
      remoteUrl ??= source;
    }
    if (allConverted && remoteUrl) {
      replacements.push({ localSource, remoteUrl });
    }
  }
  return replacements;
}

function delay(
  dependencies: Pick<
    CmdsEagleBridgeDependencies,
    "scheduleTimeout" | "cancelTimeout"
  >,
  milliseconds: number,
  signal: AbortSignal | undefined
): Promise<"elapsed" | "cancelled"> {
  return new Promise((resolve) => {
    let settled = false;
    let timeout: unknown = null;
    const finish = (result: "elapsed" | "cancelled"): void => {
      if (settled) return;
      settled = true;
      if (timeout !== null) dependencies.cancelTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish("cancelled");
    if (signal?.aborted) {
      resolve("cancelled");
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    timeout = dependencies.scheduleTimeout(
      () => finish("elapsed"),
      milliseconds
    );
  });
}

async function pollCommandConversion(
  dependencies: CmdsEagleBridgeDependencies,
  ordinals: ReadonlyMap<string, readonly number[]>,
  timeoutMs: number,
  intervalMs: number,
  signal: AbortSignal | undefined
): Promise<CommandPollResult> {
  const deadline = Date.now() + timeoutMs;
  let replacements: readonly CmdsEagleUrlReplacement[] = [];
  while (true) {
    if (signal?.aborted) {
      return { kind: "incomplete", replacements, issue: "cancelled" };
    }
    let markdown = "";
    try {
      markdown = await dependencies.readActiveNote();
    } catch {
      return {
        kind: "incomplete",
        replacements,
        issue: "note-read-failed"
      };
    }
    replacements = convertedAtOrdinals(markdown, ordinals);
    if (replacements.length === ordinals.size) {
      return { kind: "complete", replacements };
    }
    if (Date.now() >= deadline) {
      return {
        kind: "incomplete",
        replacements,
        issue: "command-timeout"
      };
    }
    const wait = await delay(
      dependencies,
      Math.min(intervalMs, Math.max(0, deadline - Date.now())),
      signal
    );
    if (wait === "cancelled") {
      return { kind: "incomplete", replacements, issue: "cancelled" };
    }
  }
}

/**
 * Uploads staged local image links through CMDS Eagle without reading its
 * settings or secrets. A public workspace event is preferred. Until CMDS
 * Eagle implements that event contract, its registered active-note command is
 * used and the resulting Markdown URLs are verified before success is
 * reported.
 *
 * The command fallback intentionally requires the target note to be active.
 * It may keep running after this helper's AbortSignal is cancelled because
 * Obsidian's command API does not expose cancellation for a dispatched command.
 */
export async function bridgeActiveNoteImagesThroughCmdsEagle(
  dependencies: CmdsEagleBridgeDependencies,
  requestedImages: readonly CmdsEagleBridgeImage[],
  options: CmdsEagleBridgeOptions = {}
): Promise<CmdsEagleBridgeResult> {
  const images = uniqueImages(requestedImages);
  if (images.length === 0) {
    return {
      status: "success",
      via: "none",
      replacements: [],
      unresolvedSources: [],
      issues: [],
      eventResponderFound: false,
      eventUploadAttempted: false,
      commandDispatched: false
    };
  }

  const signal = options.signal;
  const issues: CmdsEagleBridgeIssue[] = [];
  const replacements = new Map<string, string>();
  let eventUsed = false;
  let eventResponderFound = false;
  let eventUploadAttempted = false;
  let commandDispatched = false;

  const eventAvailability = await discoverEventResponder(
    dependencies,
    safeTimeout(
      options.capabilityTimeoutMs,
      DEFAULT_CAPABILITY_TIMEOUT_MS
    ),
    signal
  );
  if (eventAvailability === "cancelled") {
    return {
      status: "partial",
      via: "none",
      replacements: [],
      unresolvedSources: images.map((image) => image.localSource),
      issues: ["cancelled"],
      eventResponderFound: false,
      eventUploadAttempted: false,
      commandDispatched: false
    };
  }
  eventResponderFound = eventAvailability === "available";

  if (eventResponderFound) {
    for (const image of images) {
      // Once an upload event has been dispatched, its remote side effect may
      // have completed even when the response or local note write later fails.
      // Never cascade automatically to the command/direct path in that case:
      // doing so could upload the same extracted image twice.
      eventUploadAttempted = true;
      const uploaded = await uploadThroughEvent(
        dependencies,
        image,
        safeTimeout(options.uploadTimeoutMs, DEFAULT_UPLOAD_TIMEOUT_MS),
        signal
      );
      if (uploaded.kind === "cancelled") {
        issues.push("cancelled");
        break;
      }
      if (uploaded.kind === "uploaded") {
        replacements.set(image.localSource, uploaded.remoteUrl);
        eventUsed = true;
      } else {
        issues.push("event-upload-failed");
      }
    }
  }

  if (replacements.size > 0) {
    let currentMarkdown = "";
    let noteReadSucceeded = false;
    try {
      currentMarkdown = await dependencies.readActiveNote();
      noteReadSucceeded = true;
    } catch {
      replacements.clear();
      issues.push("note-read-failed");
    }
    if (noteReadSucceeded && currentMarkdown) {
      const applied = applyReplacements(currentMarkdown, replacements);
      for (const source of replacements.keys()) {
        if (!applied.appliedSources.has(source)) {
          replacements.delete(source);
          issues.push("source-not-found");
        }
      }
      if (applied.markdown !== currentMarkdown) {
        try {
          await dependencies.writeActiveNote(applied.markdown);
        } catch {
          replacements.clear();
          issues.push("note-write-failed");
        }
      }
    } else if (noteReadSucceeded) {
      for (const source of replacements.keys()) {
        replacements.delete(source);
      }
      issues.push("source-not-found");
    }
  }

  const unresolvedImages = images.filter(
    (image) => !replacements.has(image.localSource)
  );
  if (
    unresolvedImages.length > 0
    && options.allowCommandFallback !== false
    && !signal?.aborted
    && !eventUploadAttempted
  ) {
    let beforeCommand = "";
    try {
      beforeCommand = await dependencies.readActiveNote();
    } catch {
      issues.push("note-read-failed");
    }
    const unresolvedSet = new Set(
      unresolvedImages.map((image) => image.localSource)
    );
    const ordinals = sourceOrdinals(beforeCommand, unresolvedSet);
    if (ordinals.size < unresolvedSet.size) {
      issues.push("source-not-found");
    }

    if (ordinals.size > 0) {
      try {
        commandDispatched = dependencies.executeCommandById(
          CMDS_EAGLE_CONVERT_COMMAND
        );
      } catch {
        commandDispatched = false;
      }
      if (commandDispatched) {
        const polled = await pollCommandConversion(
          dependencies,
          ordinals,
          safeTimeout(options.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS),
          Math.max(
            1,
            safeTimeout(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS)
          ),
          signal
        );
        for (const replacement of polled.replacements) {
          replacements.set(
            replacement.localSource,
            replacement.remoteUrl
          );
        }
        if (polled.kind === "incomplete") issues.push(polled.issue);
      } else {
        issues.push("command-unavailable");
      }
    }
  } else if (
    unresolvedImages.length > 0
    && options.allowCommandFallback === false
  ) {
    issues.push("command-unavailable");
  }

  const finalReplacements = images
    .map((image): CmdsEagleUrlReplacement | null => {
      const remoteUrl = replacements.get(image.localSource);
      return remoteUrl
        ? { localSource: image.localSource, remoteUrl }
        : null;
    })
    .filter((entry): entry is CmdsEagleUrlReplacement => entry !== null);
  const unresolvedSources = images
    .filter((image) => !replacements.has(image.localSource))
    .map((image) => image.localSource);
  const via = combineVia(eventUsed, commandDispatched);
  const finalIssues = uniqueIssues(issues);

  if (unresolvedSources.length === 0) {
    return {
      status: "success",
      via,
      replacements: finalReplacements,
      unresolvedSources,
      issues: finalIssues.filter((issue) => issue !== "event-upload-failed"),
      eventResponderFound,
      eventUploadAttempted,
      commandDispatched
    };
  }
  if (
    replacements.size === 0
    && !eventResponderFound
    && !commandDispatched
    && finalIssues.includes("command-unavailable")
  ) {
    return {
      status: "unavailable",
      via: "none",
      replacements: [],
      unresolvedSources,
      issues: finalIssues,
      eventResponderFound,
      eventUploadAttempted,
      commandDispatched
    };
  }
  return {
    status: "partial",
    via,
    replacements: finalReplacements,
    unresolvedSources,
    issues: finalIssues,
    eventResponderFound,
    eventUploadAttempted,
    commandDispatched
  };
}
