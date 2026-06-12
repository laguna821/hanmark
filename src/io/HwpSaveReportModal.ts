import { App, Modal, Notice } from "obsidian";

export interface PatchSkipLike {
  reason?: string;
  before?: string;
  after?: string;
}

export interface SaveReportArgs {
  title: string;
  applied?: number;
  skipped?: PatchSkipLike[];
  verification?: any;
  outputPath?: string;
  backupPath?: string;
  note?: string;
  /**
   * If provided, renders a "➕ 추가 내용까지 넣어 새 한글 파일로 저장" button.
   * Generates a fresh .hwpx from the FULL edited body (kordoc default style — the
   * original's formatting is not preserved on this path) and returns the saved path.
   */
  generateFull?: () => Promise<string>;
}

/** Surfaces a 저장 result — applied / skipped[].reason / verification — with paths. */
export class HwpSaveReportModal extends Modal {
  constructor(app: App, private readonly args: SaveReportArgs) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.args.title });

    if (this.args.note) contentEl.createEl("p", { text: this.args.note });

    if (typeof this.args.applied === "number") {
      contentEl.createEl("p", { text: `✅ 반영된 변경: ${this.args.applied}건` });
    }

    const skipped = this.args.skipped ?? [];
    if (skipped.length) {
      contentEl.createEl("p", {
        text: `⚠️ 건너뜀: ${skipped.length}건 — 패치가 지원하지 않는 변경입니다 (정상 동작).`
      });
      const ul = contentEl.createEl("ul");
      for (const s of skipped.slice(0, 50)) {
        ul.createEl("li", { text: s.reason || "(사유 없음)" });
      }
      if (skipped.length > 50) ul.createEl("li", { text: `… 외 ${skipped.length - 50}건` });
    }

    if (this.args.verification) {
      const v: any = this.args.verification;
      const stats = v.stats ?? v;
      try {
        contentEl.createEl("p", { text: `🔎 검증: ${JSON.stringify(stats).slice(0, 400)}` });
      } catch {
        /* ignore non-serializable verification payloads */
      }
    }

    if (this.args.outputPath) contentEl.createEl("p", { text: `결과 파일: ${this.args.outputPath}` });
    if (this.args.backupPath) contentEl.createEl("p", { text: `원본 백업: ${this.args.backupPath}` });

    if (this.args.generateFull) {
      const genWrap = contentEl.createDiv();
      genWrap.style.marginTop = "14px";
      genWrap.style.paddingTop = "12px";
      genWrap.style.borderTop = "1px solid var(--background-modifier-border)";
      const hint = genWrap.createEl("p", {
        text: "추가·구조 변경 내용까지 반영하려면 (원본 서식 대신 kordoc 기본 서식으로 새 파일 생성):"
      });
      hint.style.fontSize = "0.9em";
      hint.style.opacity = "0.8";
      const genBtn = genWrap.createEl("button", { text: "➕ 추가 내용까지 넣어 새 한글 파일로 저장" });
      genBtn.classList.add("mod-cta");
      const resultEl = genWrap.createEl("p");
      resultEl.style.fontSize = "0.9em";
      resultEl.style.marginTop = "8px";
      genBtn.onclick = async () => {
        const original = genBtn.textContent || "";
        genBtn.disabled = true;
        genBtn.textContent = "생성 중…";
        try {
          const savedPath = await this.args.generateFull!();
          const name = savedPath.split(/[\\/]/).pop() || savedPath;
          new Notice(`새 한글 파일 생성: ${name}`);
          resultEl.setText(`✅ ${savedPath}`);
          genBtn.textContent = "✓ 생성 완료";
          try {
            (window as any).require("electron").shell.showItemInFolder(savedPath);
          } catch {
            /* ignore — folder reveal is best-effort */
          }
        } catch (e: any) {
          new Notice(`새 파일 생성 실패: ${e?.message || String(e)}`);
          resultEl.setText(`⚠️ ${e?.message || String(e)}`);
          genBtn.disabled = false;
          genBtn.textContent = original;
        }
      };
    }

    const row = contentEl.createDiv();
    row.style.marginTop = "14px";
    if (this.args.outputPath) {
      const open = row.createEl("button", { text: "📂 폴더에서 보기" });
      open.classList.add("mod-cta");
      open.onclick = () => {
        try {
          (window as any).require("electron").shell.showItemInFolder(this.args.outputPath);
        } catch {
          new Notice("폴더를 열 수 없습니다.");
        }
      };
    }
    const close = row.createEl("button", { text: "닫기" });
    close.style.marginLeft = "8px";
    close.onclick = () => this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
