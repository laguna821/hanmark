import { delimiter as nativePathDelimiter } from "node:path";
import {
  assertUserInitiatedAction,
  runUserProcess,
  type UserInitiatedAction,
  type UserProcessRunner
} from "./userProcess";

export interface PandocDocxArgsInput {
  inputPath: string;
  outputPath: string;
  referenceDocPath: string;
  luaFilterPath: string;
  resourcePaths?: readonly string[];
  resourcePathDelimiter?: string;
}

export interface PandocDocxRequest extends PandocDocxArgsInput {
  pandocPath: string;
}

function nonEmptyPath(value: string, label: string): string {
  const path = value.trim();
  if (!path || path.includes("\u0000")) throw new Error(`${label} path is invalid.`);
  return path;
}

export function createPandocDocxArgs(input: PandocDocxArgsInput): string[] {
  const args = [
    nonEmptyPath(input.inputPath, "Markdown input"),
    "--from",
    "gfm+footnotes+pipe_tables+task_lists",
    "--to",
    "docx",
    "--standalone",
    "--reference-doc",
    nonEmptyPath(input.referenceDocPath, "Reference DOCX"),
    "--lua-filter",
    nonEmptyPath(input.luaFilterPath, "DOCX style filter"),
    "-o",
    nonEmptyPath(input.outputPath, "DOCX output")
  ];
  const resourcePaths = (input.resourcePaths ?? []).map((path) => path.trim()).filter(Boolean);
  if (resourcePaths.length) {
    args.push(
      "--resource-path",
      resourcePaths.join(input.resourcePathDelimiter ?? nativePathDelimiter)
    );
  }
  return args;
}

/**
 * Advanced DOCX conversion only. Kordoc HWPX and HTML never enter this class.
 */
export class PandocDocxService {
  constructor(private readonly processRunner: UserProcessRunner = runUserProcess) {}

  async convertUserInitiated(
    request: PandocDocxRequest,
    action: UserInitiatedAction
  ): Promise<void> {
    assertUserInitiatedAction(action);
    await this.processRunner(
      {
        executable: nonEmptyPath(request.pandocPath, "Pandoc executable"),
        args: createPandocDocxArgs(request),
        timeoutMs: 120_000,
        maxBufferBytes: 20 * 1024 * 1024
      },
      action
    );
  }

  async readDefaultReferenceDocUserInitiated(
    pandocPath: string,
    action: UserInitiatedAction
  ): Promise<Uint8Array> {
    assertUserInitiatedAction(action);
    const result = await this.processRunner(
      {
        executable: nonEmptyPath(pandocPath, "Pandoc executable"),
        args: ["--print-default-data-file", "reference.docx"],
        timeoutMs: 30_000,
        maxBufferBytes: 25 * 1024 * 1024
      },
      action
    );
    if (!result.stdout.byteLength) {
      throw new Error("Pandoc did not return its default reference.docx.");
    }
    return result.stdout;
  }

  async readVersionUserInitiated(
    pandocPath: string,
    action: UserInitiatedAction
  ): Promise<string> {
    assertUserInitiatedAction(action);
    const result = await this.processRunner(
      {
        executable: nonEmptyPath(pandocPath, "Pandoc executable"),
        args: ["--version"],
        timeoutMs: 10_000,
        maxBufferBytes: 1024 * 1024
      },
      action
    );
    return new TextDecoder().decode(result.stdout).trim();
  }
}
