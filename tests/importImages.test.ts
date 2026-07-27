import assert from "node:assert/strict";
import { test } from "node:test";
import type { App } from "obsidian";
import type { ExtractedImage } from "kordoc";
import {
  CLOUD_STAGING_FOLDER,
  persistImportedImages
} from "../src/io/importImages";

interface MockFile {
  path: string;
}

interface MockVaultState {
  readonly binaryCreates: Array<{ path: string; data: ArrayBuffer }>;
  readonly folderCreates: string[];
  readonly attachmentRequests: Array<{ name: string; notePath: string }>;
}

function createMockApp(): { app: App; state: MockVaultState } {
  const files = new Map<string, MockFile>();
  const folders = new Set<string>();
  const state: MockVaultState = {
    binaryCreates: [],
    folderCreates: [],
    attachmentRequests: []
  };
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath(path: string): MockFile | undefined {
        return files.get(path) ?? (folders.has(path) ? { path } : undefined);
      },
      async createFolder(path: string): Promise<void> {
        folders.add(path);
        state.folderCreates.push(path);
      },
      async createBinary(path: string, data: ArrayBuffer): Promise<MockFile> {
        const file = { path };
        files.set(path, file);
        state.binaryCreates.push({ path, data });
        return file;
      }
    },
    fileManager: {
      async getAvailablePathForAttachment(
        name: string,
        notePath: string
      ): Promise<string> {
        state.attachmentRequests.push({ name, notePath });
        return `Default attachments/${name}`;
      }
    }
  };
  return { app: app as unknown as App, state };
}

function image(
  filename: string,
  data = new Uint8Array([1, 2, 3])
): ExtractedImage {
  return { filename, mimeType: "image/png", data };
}

test("persistImportedImages uses the configured Vault-relative image folder", async () => {
  const { app, state } = createMockApp();

  const result = await persistImportedImages(
    app,
    "Imported/Research source.md",
    "Before\n![figure](plot.png)\nAfter",
    [image("plot.png")],
    { destination: "vault", localFolder: "Attachments\\HanMark" }
  );

  assert.deepEqual(state.folderCreates, ["Attachments", "Attachments/HanMark"]);
  assert.deepEqual(
    state.binaryCreates.map(({ path }) => path),
    ["Attachments/HanMark/Research source-plot.png"]
  );
  assert.equal(state.attachmentRequests.length, 0);
  assert.equal(
    result.markdown,
    "Before\n![[Attachments/HanMark/Research source-plot.png]]\nAfter"
  );
  assert.equal(result.saved, 1);
  assert.deepEqual(result.cloudCandidates, []);
});

test("persistImportedImages never creates an orphan for an unreferenced extracted image", async () => {
  const { app, state } = createMockApp();

  const result = await persistImportedImages(
    app,
    "Imported/source.md",
    "This document has no extracted image reference.",
    [image("orphan.png")],
    { destination: "cmds-eagle-r2" }
  );

  assert.equal(result.markdown, "This document has no extracted image reference.");
  assert.equal(result.saved, 0);
  assert.equal(state.binaryCreates.length, 0);
  assert.equal(state.folderCreates.length, 0);
  assert.deepEqual(result.cloudCandidates, []);
  assert.equal(result.warnings.length, 1);
});

test("persistImportedImages creates owned cloud staging candidates only after a referenced binary save", async () => {
  const { app, state } = createMockApp();
  const bytes = new Uint8Array([10, 20, 30, 40]);

  const result = await persistImportedImages(
    app,
    "Imported/source.md",
    "![remote candidate](scan.bmp)",
    [image("scan.bmp", bytes)],
    { destination: "cmds-eagle-r2", localFolder: "Ignored/for/cloud" }
  );

  assert.equal(result.saved, 1);
  assert.equal(state.folderCreates.length, 1);
  assert.equal(state.folderCreates[0], CLOUD_STAGING_FOLDER);
  assert.equal(state.binaryCreates.length, 1);
  const [candidate] = result.cloudCandidates;
  assert.ok(candidate);
  assert.equal(candidate.ownedStagingFile, true);
  assert.equal(candidate.markdownUrl, state.binaryCreates[0].path);
  assert.equal(candidate.vaultPath, state.binaryCreates[0].path);
  assert.match(candidate.vaultPath, new RegExp(`^${CLOUD_STAGING_FOLDER}/hanmark-[a-z0-9]+-1\\.bmp$`, "u"));
  assert.equal(candidate.filename, "scan.bmp");
  assert.equal(candidate.mimeType, "image/png");
  assert.deepEqual([...candidate.data], [...bytes]);
  assert.notEqual(candidate.data, bytes);
  assert.equal(result.markdown, `![](${candidate.vaultPath})`);
});
