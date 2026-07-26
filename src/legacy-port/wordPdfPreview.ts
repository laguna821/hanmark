import {
  assertUserInitiatedAction,
  runUserProcess,
  type UserInitiatedAction,
  type UserProcessRunner
} from "./userProcess";

export interface WordPdfPreviewRequest {
  platform: "windows" | "macos" | "linux";
  scriptPath: string;
  inputDocxPath: string;
  outputPdfPath: string;
  outputExists(): Promise<boolean>;
}

function validPath(value: string, label: string): string {
  const path = value.trim();
  if (!path || path.includes("\u0000")) throw new Error(`${label} path is invalid.`);
  return path;
}

/**
 * Optional exact preview using the local Windows Word installation.
 *
 * Conversion is serialized because Microsoft Word automation is not reliably
 * re-entrant. A failed conversion does not poison later queue entries.
 */
export class WordPdfPreviewService {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly processRunner: UserProcessRunner = runUserProcess) {}

  canUseExactPreview(platform: WordPdfPreviewRequest["platform"]): boolean {
    return platform === "windows";
  }

  async convertUserInitiated(
    request: WordPdfPreviewRequest,
    action: UserInitiatedAction
  ): Promise<void> {
    assertUserInitiatedAction(action);
    if (!this.canUseExactPreview(request.platform)) {
      throw new Error("Word exact preview is only available on Windows.");
    }

    const conversion = this.queue
      .catch(() => undefined)
      .then(async () => {
        await this.processRunner(
          {
            executable: "powershell.exe",
            args: [
              "-NoProfile",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              validPath(request.scriptPath, "Word PDF script"),
              "-InputPath",
              validPath(request.inputDocxPath, "DOCX input"),
              "-OutputPath",
              validPath(request.outputPdfPath, "PDF output")
            ],
            timeoutMs: 120_000,
            maxBufferBytes: 10 * 1024 * 1024
          },
          action
        );
        if (!(await request.outputExists())) {
          throw new Error("Word PDF conversion did not produce an output file.");
        }
      });
    this.queue = conversion;
    return conversion;
  }
}
