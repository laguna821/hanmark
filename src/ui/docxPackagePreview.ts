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
  | "explicit-open"
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

/** Returns a page-fit zoom in stable 5% steps without reflowing DOCX pages. */
export function calculateDocxPreviewFitPercent(
  availableWidth: number,
  pageWidth: number
): number {
  if (
    !Number.isFinite(availableWidth) ||
    !Number.isFinite(pageWidth) ||
    availableWidth <= 0 ||
    pageWidth <= 0
  ) {
    return 100;
  }
  const stepped = Math.floor(((availableWidth / pageWidth) * 100) / 5) * 5;
  return Math.min(100, Math.max(40, stepped));
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
): trigger is "explicit-open" | "toolbar-refresh" | "mode-selection" {
  return (
    trigger === "explicit-open" ||
    trigger === "toolbar-refresh" ||
    trigger === "mode-selection"
  );
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
  private explicitOpenHandled = false;

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

  canHandle(trigger: FastDocxPreviewTrigger): boolean {
    return (
      isUserInitiatedFastPreviewTrigger(trigger) &&
      (trigger !== "explicit-open" || !this.explicitOpenHandled)
    );
  }

  async handle(
    trigger: FastDocxPreviewTrigger,
    request?: FastDocxPreviewRequest<TSource, TAction>
  ): Promise<boolean> {
    if (!this.canHandle(trigger)) return false;
    if (!request) {
      throw new Error("A user-initiated DOCX preview request is required.");
    }
    if (trigger === "explicit-open") {
      if (this.explicitOpenHandled) return false;
      this.explicitOpenHandled = true;
    }
    const prepared = await this.build(request.source, request.action);
    await this.render(prepared.bytes, request.container);
    return true;
  }
}
