import test from "node:test";
import assert from "node:assert/strict";
import {
  bytesAsArrayBuffer,
  createFileGateway,
  filenameFromDisplayPath,
  isValidSourceCacheId,
  readSelectedExternalFiles,
  safeSuggestedName,
  sourceBytesMatchContract,
  sourceCacheId,
  splitFilename
} from "../src/io/fileGateway";
import { sha256Bytes } from "../src/io/hash";
import { readSourceContract } from "../src/io/frontmatter";

class MemoryAdapter {
  readonly files = new Map<string, ArrayBuffer>();
  readonly folders = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, data.slice(0));
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const data = this.files.get(path);
    if (!data) throw new Error(`Missing test file: ${path}`);
    return data.slice(0);
  }
}

function testGateway(adapter: MemoryAdapter, pluginId = "hanmark") {
  const app = {
    vault: {
      configDir: ".obsidian",
      adapter,
      getAbstractFileByPath: (path: string) =>
        adapter.files.has(path) ? { path } : null,
      createBinary: (path: string, data: ArrayBuffer) =>
        adapter.writeBinary(path, data)
    }
  };
  return createFileGateway(app as never, { manifest: { id: pluginId } });
}

test("bytesAsArrayBuffer copies only the selected Uint8Array view", () => {
  const backing = new Uint8Array([9, 1, 2, 3, 8]);
  const result = new Uint8Array(bytesAsArrayBuffer(backing.subarray(1, 4)));
  assert.deepEqual([...result], [1, 2, 3]);
  backing[2] = 99;
  assert.deepEqual([...result], [1, 2, 3]);
});

test("source cache IDs are SHA keyed and reject traversal", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const expected = `sha256-${sha256Bytes(bytes)}.bin`;
  assert.equal(sourceCacheId(bytes), expected);
  assert.equal(isValidSourceCacheId(expected), true);
  assert.equal(isValidSourceCacheId("../source.bin"), false);
  assert.equal(isValidSourceCacheId("sha256-not-a-digest.bin"), false);
});

test("source contract validation checks both hash and byte length", () => {
  const bytes = new TextEncoder().encode("original document");
  const hash = `sha256:${sha256Bytes(bytes)}`;
  assert.equal(sourceBytesMatchContract(bytes, hash, bytes.byteLength), true);
  assert.equal(sourceBytesMatchContract(bytes, hash, bytes.byteLength + 1), false);
  assert.equal(
    sourceBytesMatchContract(new TextEncoder().encode("changed document"), hash, 0),
    false
  );
});

test("source cache uses the plugin-private adapter path and never rewrites an existing entry", async () => {
  const adapter = new MemoryAdapter();
  const gateway = testGateway(adapter, "hanmark-test");
  const bytes = new Uint8Array([10, 20, 30]);
  const cacheId = await gateway.cacheSource(bytes, {
    hash: sha256Bytes(bytes),
    byteLength: bytes.byteLength,
    sourceName: "원본.hwpx"
  });
  const path = `.obsidian/plugins/hanmark-test/cache/source-cache/${cacheId}`;
  assert.equal(adapter.files.has(path), true);

  adapter.files.set(path, new Uint8Array([7, 7, 7]).buffer);
  await gateway.cacheSource(bytes, { hash: sha256Bytes(bytes) });
  assert.deepEqual([...new Uint8Array(adapter.files.get(path)!)], [7, 7, 7]);
  assert.deepEqual(
    [...(await gateway.readCachedSource(cacheId))!],
    [7, 7, 7]
  );
  assert.equal(await gateway.readCachedSource("../escape.bin"), null);
});

test("source cache rejects inconsistent metadata", async () => {
  const gateway = testGateway(new MemoryAdapter());
  await assert.rejects(
    gateway.cacheSource(new Uint8Array([1, 2]), { byteLength: 3 }),
    /byte length/
  );
  await assert.rejects(
    gateway.cacheSource(new Uint8Array([1, 2]), { hash: "f".repeat(64) }),
    /hash/
  );
});

test("cross-platform display names produce safe, separate output names", () => {
  assert.equal(
    filenameFromDisplayPath("C:\\Documents\\한국언론학회 템플릿.hwpx"),
    "한국언론학회 템플릿.hwpx"
  );
  assert.deepEqual(splitFilename("/Users/me/paper.hwp"), {
    stem: "paper",
    extension: ".hwp"
  });
  assert.equal(safeSuggestedName("paper:수정.hwpx"), "paper_수정.hwpx");
});

function externalFile(
  name: string,
  size: number,
  onRead: () => Promise<ArrayBuffer>,
  relativePath = ""
): File {
  return {
    name,
    size,
    webkitRelativePath: relativePath,
    arrayBuffer: onRead
  } as unknown as File;
}

test("external selection filters extensions and enforces limits before reading bytes", async () => {
  let fontReads = 0;
  let textReads = 0;
  const selected = await readSelectedExternalFiles([
    externalFile("font.ttf", 3, async () => {
      fontReads += 1;
      return new Uint8Array([1, 2, 3]).buffer;
    }, "Fonts/font.ttf"),
    externalFile("ignore.txt", 4, async () => {
      textReads += 1;
      return new Uint8Array([4, 5, 6, 7]).buffer;
    }, "Fonts/ignore.txt")
  ], {
    extensions: ["ttf"],
    maxFiles: 1,
    maxFileBytes: 8,
    maxTotalBytes: 8
  });

  assert.equal(fontReads, 1);
  assert.equal(textReads, 0);
  assert.equal(selected[0].displayPath, "Fonts/font.ttf");

  let oversizedReads = 0;
  await assert.rejects(
    readSelectedExternalFiles([
      externalFile("oversized.otf", 9, async () => {
        oversizedReads += 1;
        return new Uint8Array(9).buffer;
      })
    ], {
      extensions: ["otf"],
      maxFileBytes: 8
    }),
    /per-file limit/
  );
  assert.equal(oversizedReads, 0);
});

test("external file snapshots are read sequentially and never expose absolute paths", async () => {
  let activeReads = 0;
  let peakReads = 0;
  const read = (byte: number) => async (): Promise<ArrayBuffer> => {
    activeReads += 1;
    peakReads = Math.max(peakReads, activeReads);
    await new Promise((resolve) => setTimeout(resolve, 5));
    activeReads -= 1;
    return new Uint8Array([byte]).buffer;
  };
  const selected = await readSelectedExternalFiles([
    externalFile("one.ttf", 1, read(1), "C:/Private/one.ttf"),
    externalFile("two.otf", 1, read(2), "/Private/two.otf")
  ], {
    extensions: ["ttf", "otf"],
    maxFiles: 2,
    maxTotalBytes: 2
  });

  assert.equal(peakReads, 1);
  assert.deepEqual(selected.map((file) => file.displayPath), ["one.ttf", "two.otf"]);
  assert.deepEqual(selected.map((file) => file.relativePath), [undefined, undefined]);
});

test("Vault sibling saves keep the legacy beside-note workflow without overwriting", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set(
    "notes/paper.docx",
    new Uint8Array([9]).buffer
  );
  const gateway = testGateway(adapter);
  const saved = await gateway.saveVaultSibling(
    new Uint8Array([1, 2, 3]),
    "paper.docx",
    "notes/paper.md"
  );

  assert.equal(saved.method, "vault");
  assert.equal(saved.displayPath, "notes/paper (1).docx");
  assert.deepEqual(
    [...new Uint8Array(adapter.files.get("notes/paper (1).docx")!)],
    [1, 2, 3]
  );
  assert.deepEqual(
    [...new Uint8Array(adapter.files.get("notes/paper.docx")!)],
    [9]
  );
});

test("frontmatter accepts the optional source cache while preserving legacy contracts", () => {
  const baseFrontmatter = {
    "hwp-source": "paper.hwpx",
    "hwp-source-format": "hwpx",
    "hwp-source-hash": "sha256:abc",
    "hwp-source-bytes": 42,
    "hwp-imported-at": "2026-07-26T00:00:00.000Z",
    "hwp-kordoc": "4.2.5"
  };
  const appFor = (frontmatter: Record<string, unknown>) => ({
    metadataCache: {
      getFileCache: () => ({ frontmatter })
    }
  });
  const legacy = readSourceContract(appFor(baseFrontmatter) as never, {} as never);
  assert.equal(legacy?.["hwp-source-cache"], undefined);

  const current = readSourceContract(
    appFor({
      ...baseFrontmatter,
      "hwp-source-cache": `sha256-${"a".repeat(64)}.bin`
    }) as never,
    {} as never
  );
  assert.equal(current?.["hwp-source-cache"], `sha256-${"a".repeat(64)}.bin`);
});
