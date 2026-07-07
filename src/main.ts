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
  // ── settings 객체 identity 고정 + 템플릿 스타일 재추출 상태 ──
  // 레거시 word 서브클래스의 save/loadSettings는 매번 this.settings를 새 객체로 교체하는데,
  // pandocBridge·fontCatalog는 생성 시점 settings를 참조로 캡처하고 갱신하지 않는다. 그 결과
  // 세션 중 템플릿을 바꿔도 낡은 settings를 읽어 반영되지 않는다. 최초 settings 객체를 canonical로
  // 고정하고, 교체될 때마다 값을 복사한 뒤 identity를 되돌려 모든 참조자를 자동 동기화한다.
  private _canonicalSettings: any = null;
  private _templateRefreshTimer: number | null = null;
  private _lastRefreshedTemplatePath: string | null = null; // null = 최초 refresh 이전
  private _refreshChain: Promise<void> = Promise.resolve();

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
   * 레거시가 loadSettings에서 새 settings 객체를 대입한 뒤, canonical 객체로 값을 되돌려
   * identity를 유지한다. 최초 로드에서는 그 객체 자체를 canonical로 pin한다.
   * (super 호출 이전 객체는 모듈 공유 기본값이므로 절대 그쪽에 Object.assign하지 않는다.)
   */
  async loadSettings(): Promise<void> {
    await super.loadSettings();
    const fresh = (this as any).settings;
    if (this._canonicalSettings && this._canonicalSettings !== fresh) {
      Object.assign(this._canonicalSettings, fresh);
      (this as any).settings = this._canonicalSettings;
    } else {
      this._canonicalSettings = fresh;
    }
  }

  /**
   * 레거시가 saveSettings에서 this.settings를 새 객체로 교체하면, 값을 canonical에 복사하고
   * identity를 복원한다. 디스크에는 super가 이미 정규화된 객체를 저장했으므로 data.json 내용은
   * 바뀌지 않는다. ss()는 스프레드 병합이라 키를 제거하지 않아 Object.assign이 안전하다.
   */
  async saveSettings(): Promise<void> {
    if (!this._canonicalSettings) this._canonicalSettings = (this as any).settings;
    await super.saveSettings();
    const after = (this as any).settings;
    const canon = this._canonicalSettings;
    if (canon && after && after !== canon) {
      Object.assign(canon, after);
      (this as any).settings = canon;
    }
    // 보험용 재동기화 (identity 복원이 정상이면 no-op).
    const bridge = (this as any).pandocBridge;
    if (bridge && bridge.settings !== (this as any).settings) {
      bridge.settings = (this as any).settings;
    }
    this.scheduleTemplateRefreshIfNeeded();
  }

  /**
   * 설정 탭 텍스트 필드로 defaultTemplatePath를 바꾸면 레거시는 saveSettings만 호출하고
   * refreshTemplateStyles는 부르지 않아 프리뷰/추출 스타일이 낡은 채로 남는다. 경로가 실제로
   * 변했을 때만 디바운스로 재추출을 예약한다 (재추출은 python 프로세스를 spawn하므로).
   */
  private scheduleTemplateRefreshIfNeeded(): void {
    const s = (this as any).settings;
    if (!s || !(this as any).pandocBridge) return; // 초기화 전엔 initializePlugin이 직접 refresh함
    if (this._lastRefreshedTemplatePath === null) return; // 아직 최초 refresh 이전
    const path = s.defaultTemplatePath ?? "";
    if (path === this._lastRefreshedTemplatePath) return; // 변화 없음 (재진입 가드 겸함)
    if (this._templateRefreshTimer !== null) window.clearTimeout(this._templateRefreshTimer);
    this._templateRefreshTimer = window.setTimeout(() => {
      this._templateRefreshTimer = null;
      const cur = ((this as any).settings?.defaultTemplatePath) ?? "";
      if (cur !== this._lastRefreshedTemplatePath) void (this as any).refreshTemplateStyles();
    }, 800);
  }

  /**
   * 레거시의 모든 refreshTemplateStyles 호출(select-template 명령, 설정 탭 버튼)이 이 래퍼를
   * 경유한다. baseline 경로를 기록해 디바운스 예약을 무효화하고(중복 refresh 방지), 동시 실행을
   * 직렬화해 python 프로세스가 겹쳐 spawn되는 것을 막는다.
   */
  async refreshTemplateStyles(): Promise<void> {
    if (this._templateRefreshTimer !== null) {
      window.clearTimeout(this._templateRefreshTimer);
      this._templateRefreshTimer = null;
    }
    this._lastRefreshedTemplatePath = ((this as any).settings?.defaultTemplatePath) ?? "";
    const run = this._refreshChain.then(() => super.refreshTemplateStyles());
    this._refreshChain = run.catch(() => {});
    return run;
  }

  async onunload(): Promise<void> {
    if (this._templateRefreshTimer !== null) {
      window.clearTimeout(this._templateRefreshTimer);
      this._templateRefreshTimer = null;
    }
    await super.onunload();
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
          (btn as HTMLElement).setCssStyles({ display: "none" });
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
