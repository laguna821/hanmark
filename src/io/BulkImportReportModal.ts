import { App, Modal } from "obsidian";
import type { ImportResult } from "./kordocImport";

export interface BulkReportArgs {
  results: ImportResult[];
  /** Optional display-only location of the first created note. */
  revealPath?: string;
}

/** Hybrid report shown after a multi-file import when there were failures or warnings. */
export class BulkImportReportModal extends Modal {
  constructor(app: App, private readonly args: BulkReportArgs) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const ok = this.args.results.filter((r) => r.ok);
    const failed = this.args.results.filter((r) => !r.ok);
    const warned = ok.filter((r) => (r.warnings ?? 0) > 0);

    contentEl.createEl("h2", { text: "불러오기 결과" });
    contentEl.createEl("p", {
      text: `✅ 성공 ${ok.length} · ⚠️ 경고 ${warned.length} · ❌ 실패 ${failed.length}  (총 ${this.args.results.length}개)`
    });
    const imageCount = ok.reduce((sum, result) => sum + (result.images ?? 0), 0);
    if (imageCount) contentEl.createEl("p", { text: `🖼️ 첨부 폴더에 저장한 이미지: ${imageCount}개` });

    if (failed.length) {
      contentEl.createEl("p", { text: "❌ 실패한 파일:" });
      const ul = contentEl.createEl("ul");
      for (const f of failed.slice(0, 50)) {
        ul.createEl("li", { text: `${f.file} — ${f.error}` });
      }
      if (failed.length > 50) ul.createEl("li", { text: `… 외 ${failed.length - 50}건` });
    }

    if (warned.length) {
      contentEl.createEl("p", { text: "⚠️ 경고 (변환은 완료됨):" });
      const ul = contentEl.createEl("ul");
      for (const w of warned.slice(0, 50)) {
        ul.createEl("li", { text: `${w.rel} (경고 ${w.warnings}건)` });
      }
      if (warned.length > 50) ul.createEl("li", { text: `… 외 ${warned.length - 50}건` });
    }

    const row = contentEl.createDiv();
    row.setCssStyles({ marginTop: "14px" });
    if (this.args.revealPath) row.createEl("small", { text: this.args.revealPath });
    const close = row.createEl("button", { text: "닫기" });
    close.setCssStyles({ marginLeft: "8px" });
    close.onclick = () => this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
