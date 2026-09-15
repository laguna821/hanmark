/** The only boundary allowed to access the desktop host's PDF byte API. */
export interface PdfOutputAdapter {
  render(view: Window): Promise<Uint8Array>;
}

export interface PreparedPdf {
  format: "pdf";
  status: "ready";
  fileName: string;
  bytes: Uint8Array;
}

interface PdfRemote {
  getCurrentWebContents(): {
    printToPDF(options: Record<string, unknown>): Promise<unknown>;
  };
}

function loadHostPdfBridge(): unknown {
  // A fixed CommonJS host external avoids runtime dynamic imports in the bundle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Lazy access to this one host capability is isolated to the PDF output adapter.
  const remote: unknown = require("@electron/remote");
  return remote;
}

export function createDesktopPdfOutputAdapter(
  loadRemote: () => unknown = loadHostPdfBridge
): PdfOutputAdapter {
  return {
    async render(view) {
      // Plugins execute in the main renderer. Render there even when the source
      // editor is in a pop-out; never print whichever window happens to focus.
      if (typeof window !== "undefined" && view !== window) {
        throw new Error("PDF 출력 문서와 호스트 창이 일치하지 않습니다.");
      }
      let remote: unknown;
      try {
        remote = await loadRemote();
      } catch {
        throw new Error("이 Obsidian 환경은 직접 PDF 저장을 지원하지 않습니다. 프린터로 인쇄를 선택하세요.");
      }
      if (!remote || typeof remote !== "object" ||
          !("getCurrentWebContents" in remote) ||
          typeof remote.getCurrentWebContents !== "function") {
        throw new Error("PDF 출력 기능에 접근하지 못했습니다. 프린터로 인쇄를 선택하세요.");
      }
      const contents = (remote as PdfRemote).getCurrentWebContents();
      if (!contents || typeof contents.printToPDF !== "function") {
        throw new Error("이 Obsidian 환경은 직접 PDF 저장을 지원하지 않습니다.");
      }
      const result = await contents.printToPDF({
        pageSize: "A4", printBackground: true, preferCSSPageSize: true,
        scale: 1, displayHeaderFooter: false
      });
      if (!ArrayBuffer.isView(result)) throw new Error("PDF 데이터를 받지 못했습니다.");
      const bytes = new Uint8Array(result.buffer, result.byteOffset, result.byteLength).slice();
      if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") {
        throw new Error("생성된 데이터가 PDF 형식이 아닙니다.");
      }
      return bytes;
    }
  };
}
