import {
  assertUserInitiatedAction,
  runUserProcess,
  type ProcessRequest,
  type UserInitiatedAction,
  type UserProcessRunner
} from "../legacy-port/userProcess";

export type OutputRevealPlatform = "windows" | "macos" | "linux";

export interface SavedVaultOutputCandidate {
  status: string;
  vaultPath?: string;
}

export interface TrustedVaultOutput {
  readonly method: "vault";
  readonly vaultPath: string;
}

export interface RevealVaultOutputOptions {
  output: TrustedVaultOutput;
  platform: OutputRevealPlatform;
  /**
   * Desktop wiring supplies `FileSystemAdapter.getFullPath()` here.
   * Browser/download results never reach this boundary.
   */
  resolveVaultPath(vaultPath: string): string;
  processRunner?: UserProcessRunner;
}

const trustedVaultOutputs = new WeakSet<object>();

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

/**
 * Validates and normalizes an Obsidian Vault-relative path without touching the
 * file system. Absolute paths, drive-relative paths, and traversal are refused.
 */
export function normalizeTrustedVaultPath(value: string): string {
  if (!value || value !== value.trim() || containsControlCharacter(value)) {
    throw new Error("The exported Vault path is invalid.");
  }

  const normalized = value.replace(/\\/g, "/").replace(/\/+/g, "/");
  const segments = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Only a trusted Vault-relative export path can be revealed.");
  }
  return normalized;
}

/**
 * Converts a freshly completed Vault save outcome into an opaque reveal token.
 * Save-picker, download, delegated, and cancelled outcomes intentionally return
 * `null`, which lets the UI omit the location button.
 */
export function trustSavedVaultOutput(
  candidate: SavedVaultOutputCandidate
): TrustedVaultOutput | null {
  if (candidate.status !== "saved" || !candidate.vaultPath) return null;
  const output = Object.freeze({
    method: "vault" as const,
    vaultPath: normalizeTrustedVaultPath(candidate.vaultPath)
  });
  trustedVaultOutputs.add(output);
  return output;
}

function assertTrustedVaultOutput(output: TrustedVaultOutput): void {
  if (!output || !trustedVaultOutputs.has(output)) {
    throw new Error("Only a newly saved HanMark Vault output can be revealed.");
  }
}

function hasDotSegment(value: string, separatorPattern: RegExp): boolean {
  return value
    .split(separatorPattern)
    .some((segment) => segment === "." || segment === "..");
}

function checkedAbsolutePath(
  platform: OutputRevealPlatform,
  value: string
): string {
  if (!value || value !== value.trim() || containsControlCharacter(value)) {
    throw new Error("The resolved export path is invalid.");
  }

  if (platform === "windows") {
    const isDrivePath = /^[A-Za-z]:[\\/]/.test(value);
    const isUncPath = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(value);
    const isDevicePath = /^(?:\\\\|\/\/)[?.][\\/]/.test(value);
    if (
      (!isDrivePath && !isUncPath) ||
      isDevicePath ||
      hasDotSegment(value, /[\\/]/)
    ) {
      throw new Error("The resolved Windows export path must be absolute.");
    }
    return value;
  }

  if (!value.startsWith("/") || hasDotSegment(value, /\//)) {
    throw new Error("The resolved export path must be absolute.");
  }
  return value;
}

function linuxParentDirectory(filePath: string): string {
  const withoutTrailingSlashes = filePath.replace(/\/+$/, "");
  const slash = withoutTrailingSlashes.lastIndexOf("/");
  return slash <= 0 ? "/" : withoutTrailingSlashes.slice(0, slash);
}

export function buildOutputRevealRequest(
  platform: OutputRevealPlatform,
  absoluteFilePath: string
): ProcessRequest {
  const fullPath = checkedAbsolutePath(platform, absoluteFilePath);
  if (platform === "windows") {
    return {
      executable: "explorer.exe",
      args: ["/select,", fullPath],
      timeoutMs: 10_000,
      maxBufferBytes: 64 * 1024
    };
  }
  if (platform === "macos") {
    return {
      executable: "/usr/bin/open",
      args: ["-R", fullPath],
      timeoutMs: 10_000,
      maxBufferBytes: 64 * 1024
    };
  }
  return {
    executable: "xdg-open",
    args: [linuxParentDirectory(fullPath)],
    timeoutMs: 10_000,
    maxBufferBytes: 64 * 1024
  };
}

/**
 * Reveals an exported file through HanMark's single `spawn(shell:false)`
 * boundary. Call this directly from a fresh button click and pass that click's
 * `UserInitiatedAction` token.
 */
export async function revealVaultOutputUserInitiated(
  options: RevealVaultOutputOptions,
  action: UserInitiatedAction
): Promise<void> {
  assertUserInitiatedAction(action);
  assertTrustedVaultOutput(options.output);
  const fullPath = options.resolveVaultPath(options.output.vaultPath);
  const request = buildOutputRevealRequest(options.platform, fullPath);
  await (options.processRunner ?? runUserProcess)(request, action);
}
