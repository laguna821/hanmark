import { spawn } from "node:child_process";
import {
  clearTimeout as clearNodeTimeout,
  setTimeout as setNodeTimeout
} from "node:timers";

const USER_INITIATED = Symbol("hanmark-user-initiated-process");

export type UserActionSource = "command" | "toolbar" | "modal";

export interface UserInitiatedAction {
  readonly source: UserActionSource;
  readonly createdAt: number;
  readonly [USER_INITIATED]: true;
}

export interface ProcessRequest {
  executable: string;
  args: readonly string[];
  timeoutMs?: number;
  maxBufferBytes?: number;
  /**
   * Keeps converter console windows hidden by default. GUI launchers can opt
   * out when the requested result is the visible application window itself.
   */
  windowsHide?: boolean;
  /**
   * `exit` captures output and waits for a process result. `spawn` completes
   * once the operating system has accepted a GUI launcher request.
   */
  completionMode?: "exit" | "spawn";
  /**
   * Exit codes that mean the requested operation was handed off successfully.
   * Most processes use the default `[0]`; launcher-style platform utilities
   * may document additional non-error completion codes.
   */
  successExitCodes?: readonly number[];
}

export interface ProcessResult {
  stdout: Uint8Array;
  stderr: string;
}

export type UserProcessRunner = (
  request: ProcessRequest,
  action: UserInitiatedAction
) => Promise<ProcessResult>;

export function createUserInitiatedAction(source: UserActionSource): UserInitiatedAction {
  return Object.freeze({
    source,
    createdAt: Date.now(),
    [USER_INITIATED]: true as const
  });
}

export function assertUserInitiatedAction(action: UserInitiatedAction): void {
  if (!action || action[USER_INITIATED] !== true) {
    throw new Error("External conversion must be started by an explicit user action.");
  }
}

function cleanExecutable(value: string): string {
  const executable = value.trim();
  if (!executable || executable.includes("\u0000")) {
    throw new Error("The external executable path is invalid.");
  }
  return executable;
}

function appendChunk(chunks: Buffer[], chunk: Buffer, total: number, limit: number): number {
  const nextTotal = total + chunk.byteLength;
  if (nextTotal > limit) throw new Error("External process output exceeded the safety limit.");
  chunks.push(chunk);
  return nextTotal;
}

function toError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error("External process failed with a non-Error reason.");
}

function checkedSuccessExitCodes(values: readonly number[] | undefined): Set<number> {
  const codes = values ?? [0];
  if (
    codes.length === 0 ||
    codes.some((code) => !Number.isInteger(code) || code < 0 || code > 255)
  ) {
    throw new Error("External process success exit codes are invalid.");
  }
  return new Set(codes);
}

/**
 * The single intentional shell-process boundary in HanMark.
 *
 * `spawn` receives an executable and an argument array with `shell: false`; no
 * command string is evaluated. Callers must provide a fresh UI action token.
 */
export const runUserProcess: UserProcessRunner = async (request, action) => {
  assertUserInitiatedAction(action);
  const executable = cleanExecutable(request.executable);
  const completionMode = request.completionMode ?? "exit";
  const windowsHide = request.windowsHide ?? true;

  if (completionMode === "spawn") {
    return new Promise<ProcessResult>((resolve, reject) => {
      const child = spawn(executable, [...request.args], {
        windowsHide,
        shell: false,
        stdio: "ignore"
      });
      let settled = false;

      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
      child.once("spawn", () => {
        if (settled) return;
        settled = true;
        child.unref();
        resolve({
          stdout: new Uint8Array(),
          stderr: ""
        });
      });
    });
  }

  const timeoutMs = request.timeoutMs ?? 60_000;
  const maxBufferBytes = request.maxBufferBytes ?? 20 * 1024 * 1024;
  const successExitCodes = checkedSuccessExitCodes(request.successExitCodes);

  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(executable, [...request.args], {
      windowsHide,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearNodeTimeout(timer);
      callback();
    };

    const timer = setNodeTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`External process timed out after ${timeoutMs}ms.`)));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      try {
        stdoutBytes = appendChunk(stdout, chunk, stdoutBytes, maxBufferBytes);
      } catch (error) {
        child.kill();
        finish(() => reject(toError(error)));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      try {
        stderrBytes = appendChunk(stderr, chunk, stderrBytes, maxBufferBytes);
      } catch (error) {
        child.kill();
        finish(() => reject(toError(error)));
      }
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code, signal) => {
      finish(() => {
        const stderrText = Buffer.concat(stderr).toString("utf8").trim();
        if (signal) {
          reject(new Error(`External process was terminated by signal ${signal}.`));
          return;
        }
        if (code === null || !successExitCodes.has(code)) {
          reject(new Error(stderrText || `External process exited with code ${code ?? "unknown"}.`));
          return;
        }
        const output = Buffer.concat(stdout);
        resolve({
          stdout: new Uint8Array(output.buffer, output.byteOffset, output.byteLength),
          stderr: stderrText
        });
      });
    });
  });
};
