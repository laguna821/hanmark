import { MarkdownView } from "obsidian";
import { importDocument } from "./io/kordocImport";
import { saveDocument, patchSourceExperimental } from "./io/kordocSave";
import { unpackBundledAssets } from "./io/assetUnpack";

// The pristine, untouched 1.7.2 plugin (pandoc/pypandoc-hwpx export pipeline + the
// light/dark auto-color toolbar) is the stable core. esbuild bundles it in; we extend
// it and add ONLY the kordoc gateway (import + 3-branch save + toolbar re-wire).
const legacyModule: any = require("../legacy-main.cjs");
const LegacyPlugin: any = legacyModule?.default ?? legacyModule;

const LABEL_IMPORT = "불러오기"; // 불러오기
const LABEL_SAVE = "저장"; // 저장

export default class HwpWriterV2Plugin extends LegacyPlugin {
  async onload(): Promise<void> {
    // Community installs ship only main.js/manifest/styles, so the legacy export & preview
    // features would be missing their data files. Write the base64-embedded assets into the
    // plugin folder before the legacy core loads and starts reading them.
    await unpackBundledAssets(this);
    await super.onload(); // run the full 1.7.2 plugin (toolbar, skin, export…)

    this.addCommand({
      id: "import-hwp-document",
      name: "한글 문서 불러오기 (HWP/HWPX/PDF/DOCX/XLSX → Markdown)",
      callback: () => importDocument(this.app, this)
    });
    this.addCommand({
      id: "save-hwp-roundtrip",
      name: "한글로 저장 (새 hwpx 생성)",
      callback: () => saveDocument(this.app, this)
    });
    this.addCommand({
      id: "patch-hwp-experimental",
      name: "원본 서식 보존 패치 (실험 — .hwp/.hwpx 원본)",
      callback: () => patchSourceExperimental(this.app, this)
    });

    this.patchToolbarForGateway();
  }

  /**
   * Re-wire the legacy 불러오기 icon button (which calls switcher:open) to the kordoc
   * gateway, and hide the 저장 icon — save-to-hwpx is not ready for general release yet
   * (the command/source stay for a future re-enable). They are icon-only, so we match by
   * aria-label. cloneNode+replaceWith drops the original addEventListener handler before
   * we install ours, and the wrapped renderMainToolbar keeps the re-wire/hide applied
   * across toolbar re-renders (note switches). The 내보내기 buttons are left untouched.
   */
  private patchToolbarForGateway(): void {
    const self = this;

    const rewire = (root: ParentNode): void => {
      root.querySelectorAll("button").forEach((btn) => {
        const label = btn.getAttribute("aria-label");
        if (label !== LABEL_IMPORT && label !== LABEL_SAVE) return;
        if ((btn as any).__hwpGatewayWired) return;

        // 저장(새 hwpx 생성)은 복잡 문서에서 아직 불안정 → 배포본 툴바에선 아이콘만 숨긴다.
        // save-hwp-roundtrip 명령과 소스는 유지(추후 재개). 내보내기 버튼은 건드리지 않음.
        if (label === LABEL_SAVE) {
          (btn as any).__hwpGatewayWired = true;
          (btn as HTMLElement).style.display = "none";
          return;
        }

        const replacement = btn.cloneNode(true) as HTMLButtonElement;
        (replacement as any).__hwpGatewayWired = true;
        replacement.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        replacement.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          void importDocument(self.app, self);
        });
        btn.replaceWith(replacement);
      });
    };

    const manager: any = (this as any).toolbarManager;
    if (manager?.renderMainToolbar) {
      const original = manager.renderMainToolbar.bind(manager);
      manager.renderMainToolbar = (el: HTMLElement) => {
        original(el);
        rewire(el);
      };
      try {
        manager.removeToolbar?.();
        const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
        if (activeLeaf && manager.visible) manager.injectToolbar?.(activeLeaf);
      } catch (e) {
        console.warn("[hwp-writer] toolbar re-inject failed:", e);
      }
    }

    // Re-wire any toolbar already present in the DOM (covers the current view now).
    document.querySelectorAll(".hwp-toolbar-main").forEach((el) => rewire(el));
  }
}
