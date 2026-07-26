import { renderAsync } from "docx-preview";

export type DocxPackageRenderer = (
  data: Uint8Array,
  bodyContainer: HTMLElement,
  styleContainer: HTMLElement | undefined,
  options: {
    breakPages: boolean;
    inWrapper: boolean;
    renderAltChunks: boolean;
  }
) => Promise<unknown>;

export type FastDocxPreviewTrigger =
  | "view-open"
  | "document-change"
  | "active-document-change"
  | "template-change"
  | "toolbar-refresh"
  | "mode-selection";

export interface FastDocxPackage {
  bytes: Uint8Array;
}

export interface FastDocxPreviewRequest<TSource, TAction> {
  source: TSource;
  action: TAction;
  container: HTMLElement;
}

/**
 * External DOCX generation is deliberately limited to direct UI gestures.
 *
 * Opening a view, typing, changing the active note, or receiving a template
 * refresh only invalidates the previous result. This keeps Pandoc from being
 * started by an Obsidian lifecycle event.
 */
export function isUserInitiatedFastPreviewTrigger(
  trigger: FastDocxPreviewTrigger
): trigger is "toolbar-refresh" | "mode-selection" {
  return trigger === "toolbar-refresh" || trigger === "mode-selection";
}

/**
 * Render the generated DOCX package with the same page-aware renderer used by
 * HanMark 2.4.2. The renderer is injectable so the byte and option contract can
 * be verified without a browser DOM.
 */
export async function renderDocxPackage(
  bytes: Uint8Array,
  container: HTMLElement,
  renderer: DocxPackageRenderer = renderAsync
): Promise<void> {
  await renderer(bytes, container, undefined, {
    breakPages: true,
    inWrapper: true,
    renderAltChunks: false
  });
}

/**
 * Runtime gate between Obsidian lifecycle events and the optional Pandoc path.
 * Tests exercise this class with a counting builder, so a future refactor
 * cannot accidentally make view-open or document-change run an executable.
 */
export class UserInitiatedDocxPackagePreview<TSource, TAction> {
  constructor(
    private readonly build: (
      source: TSource,
      action: TAction
    ) => Promise<FastDocxPackage>,
    private readonly render: (
      bytes: Uint8Array,
      container: HTMLElement
    ) => Promise<void> = renderDocxPackage
  ) {}

  async handle(
    trigger: FastDocxPreviewTrigger,
    request?: FastDocxPreviewRequest<TSource, TAction>
  ): Promise<boolean> {
    if (!isUserInitiatedFastPreviewTrigger(trigger)) return false;
    if (!request) {
      throw new Error("A user-initiated DOCX preview request is required.");
    }
    const prepared = await this.build(request.source, request.action);
    await this.render(prepared.bytes, request.container);
    return true;
  }
}
