import { App, MarkdownView, Modal, Notice, TFile, normalizePath } from "obsidian";
import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import JSZip from "jszip";
import { patchHwpx, patchHwp, markdownToHwpx } from "kordoc";
import { type HwpSourceContract, readSourceContract, extractEditableBody } from "./frontmatter";
import { sha256Bytes } from "./hash";
import { HwpSaveReportModal } from "./HwpSaveReportModal";

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function toBuffer(out: any): Buffer {
  if (Buffer.isBuffer(out)) return out;
  if (out instanceof Uint8Array) return Buffer.from(out);
  if (out instanceof ArrayBuffer) return Buffer.from(new Uint8Array(out));
  return Buffer.from(out?.buffer ?? out);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Resolve the bundled blank.hwpx (the 한글-openable envelope template) next to main.js. */
function resolveBlankHwpx(plugin: any): string {
  try {
    const dir = plugin?.getPluginDir?.();
    if (dir) return nodePath.join(dir, "blank.hwpx");
  } catch {
    /* ignore */
  }
  return "";
}

/**
 * kordoc.markdownToHwpx emits a MINIMAL .hwpx that 한글 HANGS on — it is missing the
 * envelope files 한글 strictly requires (version.xml, settings.xml, META-INF/manifest.xml,
 * container.rdf, Preview/PrvImage.png). Repair: inject kordoc's content
 * (Contents/header.xml + Contents/section0.xml) into blank.hwpx's complete, known-openable
 * envelope. mimetype stays FIRST + STORED; all zip paths normalized to forward slashes
 * (blank.hwpx ships with backslash paths). Falls back to raw kordoc output if anything fails.
 */
async function markdownToHwpxRepaired(body: string, blankPath: string): Promise<Buffer> {
  const genBuf = toBuffer(await markdownToHwpx(body));
  if (!blankPath) return genBuf;
  let blankData: Buffer;
  try {
    blankData = await fs.readFile(blankPath);
  } catch {
    return genBuf;
  }
  try {
    const gen = await JSZip.loadAsync(genBuf);
    const headerXml = await gen.file("Contents/header.xml")?.async("uint8array");
    const sectionXml = await gen.file("Contents/section0.xml")?.async("uint8array");
    if (!headerXml || !sectionXml) return genBuf;

    const blank = await JSZip.loadAsync(blankData);
    const norm = (k: string) => k.replace(/\\/g, "/");
    const out = new JSZip();
    const mimeKey = Object.keys(blank.files).find((k) => norm(k) === "mimetype");
    if (mimeKey) {
      out.file("mimetype", await blank.files[mimeKey].async("uint8array"), { compression: "STORE" });
    }
    for (const p of Object.keys(blank.files)) {
      const f = blank.files[p] as any;
      const np = norm(p);
      if (np === "mimetype" || f.dir) continue;
      let data: Uint8Array;
      if (np === "Contents/header.xml") data = headerXml;
      else if (np === "Contents/section0.xml") data = sectionXml;
      else data = await f.async("uint8array");
      out.file(np, data);
    }
    return (await out.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })) as Buffer;
  } catch (e) {
    console.warn("[hwp-writer] hwpx envelope repair failed; using raw kordoc output:", e);
    return genBuf;
  }
}

function confirm(app: App, title: string, message: string, yesText: string, noText: string): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const m = new Modal(app);
    m.titleEl.setText(title);
    message.split("\n").forEach((line) => m.contentEl.createEl("p", { text: line }));
    const row = m.contentEl.createDiv();
    row.setCssStyles({ marginTop: "12px" });
    const yes = row.createEl("button", { text: yesText });
    yes.classList.add("mod-cta");
    yes.onclick = () => {
      finish(true);
      m.close();
    };
    const no = row.createEl("button", { text: noText });
    no.setCssStyles({ marginLeft: "8px" });
    no.onclick = () => {
      finish(false);
      m.close();
    };
    m.onClose = () => finish(false);
    m.open();
  });
}

async function readActiveBody(app: App): Promise<{ file: TFile; body: string } | null> {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  const file = view?.file;
  if (!file) {
    new Notice("마크다운 노트를 열고 저장하세요.");
    return null;
  }
  const body = extractEditableBody(await app.vault.read(file));
  if (!body.trim()) {
    new Notice("저장할 내용이 없습니다.");
    return null;
  }
  return { file, body };
}

/**
 * 저장 (default) — the RELIABLE path: always GENERATE a fresh .hwpx from the full
 * edited content (repaired envelope → opens in 한글; kordoc default report style, the
 * original document's exact formatting is not preserved). The original file is never touched.
 *
 * Format-preserving in-place patch is the hard 한글-layout problem (kordoc collapses a
 * paragraph's charShape/lineSeg records → multi-line text overlaps in 한글), so it is opt-in
 * via the experimental command `patchSourceExperimental`, not the default.
 */
export async function saveDocument(app: App, plugin?: any): Promise<void> {
  const ctx = await readActiveBody(app);
  if (!ctx) return;
  const blankPath = resolveBlankHwpx(plugin);
  const contract = readSourceContract(app, ctx.file);
  try {
    if (contract) {
      await generateBesideOriginal(app, contract["hwp-source"], ctx.body, blankPath);
    } else {
      await generateIntoVault(app, ctx.file, ctx.body, blankPath);
    }
  } catch (e: any) {
    new Notice(`저장 실패: ${e?.message || String(e)}`);
    console.error("[hwp-writer] save failed:", e);
  }
}

/**
 * 실험: 원본 서식 보존 패치 (.hwp/.hwpx 원본 한정). 받은 공문의 서식을 그대로 두고 텍스트만
 * 바꿔치기하지만, 여러 줄 문단에서 한글 렌더링이 깨질 수 있는 알려진 한계가 있다(그래서 기본 아님).
 */
export async function patchSourceExperimental(app: App, plugin?: any): Promise<void> {
  const ctx = await readActiveBody(app);
  if (!ctx) return;
  const contract = readSourceContract(app, ctx.file);
  const fmt = contract?.["hwp-source-format"];
  if (!contract || (fmt !== "hwpx" && fmt !== "hwp")) {
    new Notice("패치할 원본(.hwp/.hwpx)이 이 노트에 연결돼 있지 않습니다. 일반 저장(생성)을 쓰세요.");
    return;
  }
  const blankPath = resolveBlankHwpx(plugin);
  try {
    await patchInPlace(app, ctx.file, contract, ctx.body, blankPath);
  } catch (e: any) {
    new Notice(`패치 실패: ${e?.message || String(e)}`);
    console.error("[hwp-writer] patch failed:", e);
  }
}

/** Branch A — patch the original 공문서. Safety first: never overwrite in place. */
async function patchInPlace(app: App, file: TFile, contract: HwpSourceContract, body: string, blankPath: string): Promise<void> {
  const srcPath = contract["hwp-source"];

  let orig: Buffer;
  try {
    orig = await fs.readFile(srcPath);
  } catch {
    const go = await confirm(
      app,
      "원본 파일을 찾을 수 없습니다",
      `원본 경로가 존재하지 않습니다:\n${srcPath}\n\n대신 새 hwpx 파일로 저장할까요?`,
      "새 hwpx로 저장",
      "취소"
    );
    if (go) await generateIntoVault(app, file, body, blankPath);
    return;
  }

  // Integrity guard: the original must be byte-identical to import time.
  const expectHash = (contract["hwp-source-hash"] || "").replace(/^sha256:/, "");
  const actualHash = sha256Bytes(orig);
  const sizeMismatch = contract["hwp-source-bytes"] > 0 && orig.byteLength !== contract["hwp-source-bytes"];
  if (expectHash && (actualHash !== expectHash || sizeMismatch)) {
    const go = await confirm(
      app,
      "원본이 변경되었습니다",
      `불러온 뒤 원본 파일이 디스크에서 바뀐 것 같습니다.\n${srcPath}\n\n그대로 패치하면 충돌 위험이 있어 기본적으로 중단합니다.\n대신 새 hwpx 파일로 저장할까요?`,
      "새 hwpx로 저장",
      "취소"
    );
    if (go) await generateBesideOriginal(app, srcPath, body, blankPath);
    return;
  }

  // patch requires a Uint8Array (a Buffer is one, but pass a clean view to be safe).
  const u8 = new Uint8Array(orig.buffer, orig.byteOffset, orig.byteLength);
  const patchFn = contract["hwp-source-format"] === "hwpx" ? patchHwpx : patchHwp;
  const res: any = await patchFn(u8, body, { verify: true });

  if (!res || res.success === false || !res.data) {
    new HwpSaveReportModal(app, {
      title: "패치 적용 실패 — 원본은 그대로 둡니다",
      applied: res?.applied ?? 0,
      skipped: res?.skipped ?? [],
      note:
        res?.error ||
        "패치를 적용할 수 없습니다. 문단/표 구조 변경(추가·삭제·순서변경)이나 배포용·암호화 문서는 패치가 지원되지 않습니다.",
      generateFull: () => generateFullBeside(srcPath, body, blankPath)
    }).open();
    return;
  }

  // SAFE DEFAULT: write a new _수정 file + a _원본백업 copy; never clobber the original.
  const dir = nodePath.dirname(srcPath);
  const ext = nodePath.extname(srcPath);
  const stem = nodePath.basename(srcPath, ext);
  const s = stamp();
  const backupPath = nodePath.join(dir, `${stem}_원본백업_${s}${ext}`);
  const outPath = nodePath.join(dir, `${stem}_수정_${s}${ext}`);
  await fs.copyFile(srcPath, backupPath);
  await fs.writeFile(outPath, Buffer.from(res.data));

  new HwpSaveReportModal(app, {
    title: "저장 완료 — 원본 서식 보존 패치",
    applied: res.applied ?? 0,
    skipped: res.skipped ?? [],
    verification: res.verification,
    outputPath: outPath,
    backupPath,
    note: "원본은 그대로 두고 수정본과 백업본을 새로 만들었습니다. 한글에서 결과를 열어 확인하세요.",
    generateFull: () => generateFullBeside(srcPath, body, blankPath)
  }).open();
}

/** Generate a fresh .hwpx from the FULL edited body, saved beside the original. Returns the path. */
async function generateFullBeside(originalPath: string, body: string, blankPath: string): Promise<string> {
  const data = await markdownToHwpxRepaired(body, blankPath);
  const dir = nodePath.dirname(originalPath);
  const stem = nodePath.basename(originalPath, nodePath.extname(originalPath));
  let outPath = nodePath.join(dir, `${stem}_전체내용_${stamp()}.hwpx`);
  let n = 1;
  while (await pathExists(outPath)) outPath = nodePath.join(dir, `${stem}_전체내용_${stamp()}_${n++}.hwpx`);
  await fs.writeFile(outPath, data);
  return outPath;
}

/** 저장(생성) — fresh .hwpx beside the original, stable name so re-saves overwrite the
 *  derived file (the original .hwp/.hwpx is never touched — `_변환` keeps them distinct). */
async function generateBesideOriginal(app: App, originalPath: string, body: string, blankPath: string): Promise<void> {
  const data = await markdownToHwpxRepaired(body, blankPath);
  const dir = nodePath.dirname(originalPath);
  const stem = nodePath.basename(originalPath, nodePath.extname(originalPath));
  const outPath = nodePath.join(dir, `${stem}_변환.hwpx`);
  await fs.writeFile(outPath, data);
  new HwpSaveReportModal(app, {
    title: "저장 완료 — 한글 파일 생성",
    outputPath: outPath,
    note:
      "노트 전체 내용을 새 .hwpx로 만들었습니다 (원본 파일은 그대로). kordoc 기본 보고서 서식이며 한글에서 바로 열립니다. " +
      "내 템플릿 서식이 필요하면 ‘내보내기’, 원본 서식을 그대로 유지하려면 명령 팔레트의 ‘원본 서식 보존 패치(실험)’."
  }).open();
}

/** Branch C — new hwpx inside the vault (kordoc default style). */
async function generateIntoVault(app: App, file: TFile, body: string, blankPath: string): Promise<void> {
  const data = await markdownToHwpxRepaired(body, blankPath);
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const folder = file.parent?.path && file.parent.path !== "/" ? file.parent.path + "/" : "";
  let rel = normalizePath(`${folder}${file.basename}.hwpx`);
  let i = 1;
  while (app.vault.getAbstractFileByPath(rel)) rel = normalizePath(`${folder}${file.basename} (${i++}).hwpx`);
  await app.vault.createBinary(rel, arrayBuffer);
  new Notice(`저장 완료: ${rel} (kordoc 기본 보고서체)`);
}
