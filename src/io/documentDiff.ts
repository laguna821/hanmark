import { diffBlocks, parse, type BlockDiff, type DiffResult, type IRBlock } from "kordoc";
import { bytesAsArrayBuffer } from "./fileGateway";
import { kordocParseOptions } from "./importOptions";
import { describeImportFailure } from "./messageCatalog";

/**
 * Block alignment for the old–new comparison table (2.7.0 W7).
 *
 * Kordoc's `diffBlocks` pairs any two blocks whose similarity passes a threshold
 * and maximizes the number of pairs, so it cannot tell an identical article from a
 * merely similar one: inserting 제3조 can come out as "제1조 added, 제1조 → 제2조
 * changed, 제2조 → 제3조 changed". HanMark first anchors the blocks that are
 * identical in both documents (longest common subsequence over normalized block
 * keys) and lets Kordoc pair only the blocks between two anchors.
 */

/** Above this block product the documents go to Kordoc unanchored (memory bound). */
const MAX_ANCHOR_CELLS = 16_000_000;

export interface CompareInput {
  name: string;
  bytes: Uint8Array;
}

function normalizeText(text: string | undefined): string {
  return (text ?? "").replace(/\s+/gu, " ").trim();
}

/** Identity of a block's content; whitespace differences do not count. */
export function blockKey(block: IRBlock): string {
  return JSON.stringify([
    block.type,
    block.level ?? 0,
    normalizeText(block.text),
    block.table ? block.table.cells.map((row) => row.map((cell) => normalizeText(cell?.text))) : null,
    (block.children ?? []).map(blockKey)
  ]);
}

/** Index pairs of identical blocks, in order (longest common subsequence). */
function anchorPairs(keysA: readonly string[], keysB: readonly string[]): Array<[number, number]> {
  const width = keysB.length + 1;
  const table = new Uint32Array((keysA.length + 1) * width);
  for (let i = keysA.length - 1; i >= 0; i -= 1) {
    for (let j = keysB.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        keysA[i] === keysB[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < keysA.length && j < keysB.length) {
    if (keysA[i] === keysB[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/** Kordoc's block diff, anchored on identical blocks. */
export function alignedDiff(blocksA: readonly IRBlock[], blocksB: readonly IRBlock[]): DiffResult {
  if (blocksA.length * blocksB.length > MAX_ANCHOR_CELLS) return diffBlocks([...blocksA], [...blocksB]);
  const diffs: BlockDiff[] = [];
  let nextA = 0;
  let nextB = 0;
  const pairGap = (endA: number, endB: number): void => {
    if (nextA < endA || nextB < endB) {
      diffs.push(...diffBlocks(blocksA.slice(nextA, endA), blocksB.slice(nextB, endB)).diffs);
    }
  };
  for (const [i, j] of anchorPairs(blocksA.map(blockKey), blocksB.map(blockKey))) {
    pairGap(i, j);
    diffs.push({ type: "unchanged", before: blocksA[i], after: blocksB[j], similarity: 1 });
    nextA = i + 1;
    nextB = j + 1;
  }
  pairGap(blocksA.length, blocksB.length);
  const stats = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  for (const diff of diffs) stats[diff.type] += 1;
  return { stats, diffs };
}

async function parseForCompare(input: CompareInput): Promise<IRBlock[]> {
  // Offline whitelist: never OCR, file paths, or inline images.
  const result = await parse(bytesAsArrayBuffer(input.bytes.slice()), kordocParseOptions({ images: false }));
  if (!result.success) {
    throw new Error(`${input.name}: ${describeImportFailure(result.code, result.fileType).title}`);
  }
  return result.blocks;
}

/** Compare two documents of any importable format (one after the other, like PDF imports). */
export async function compareDocuments(before: CompareInput, after: CompareInput): Promise<DiffResult> {
  const blocksA = await parseForCompare(before);
  const blocksB = await parseForCompare(after);
  return alignedDiff(blocksA, blocksB);
}
