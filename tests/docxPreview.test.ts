import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isUserInitiatedFastPreviewTrigger,
  renderDocxPackage,
  UserInitiatedDocxPackagePreview,
  type DocxPackageRenderer,
  type FastDocxPreviewTrigger
} from "../src/ui/docxPackagePreview";

const BACKGROUND_TRIGGERS: readonly FastDocxPreviewTrigger[] = [
  "view-open",
  "document-change",
  "active-document-change",
  "template-change"
];

test("DOCX lifecycle events never invoke the external DOCX builder", async () => {
  let builds = 0;
  let renders = 0;
  const runtime = new UserInitiatedDocxPackagePreview(
    async () => {
      builds += 1;
      return { bytes: new Uint8Array([1, 2, 3]) };
    },
    async () => {
      renders += 1;
    }
  );

  for (const trigger of BACKGROUND_TRIGGERS) {
    assert.equal(isUserInitiatedFastPreviewTrigger(trigger), false);
    assert.equal(await runtime.handle(trigger), false);
  }
  assert.equal(builds, 0);
  assert.equal(renders, 0);
});

test("toolbar refresh and mode selection render a generated DOCX package", async () => {
  const source = { markdown: "# 실제 DOCX" };
  const action = { source: "toolbar" };
  const container = {} as HTMLElement;
  const builtBytes = new Uint8Array([80, 75, 3, 4]);
  const calls: Array<{ source: typeof source; action: typeof action }> = [];
  const rendered: Array<{ bytes: Uint8Array; container: HTMLElement }> = [];
  const runtime = new UserInitiatedDocxPackagePreview(
    async (receivedSource: typeof source, receivedAction: typeof action) => {
      calls.push({ source: receivedSource, action: receivedAction });
      return { bytes: builtBytes };
    },
    async (bytes, receivedContainer) => {
      rendered.push({ bytes, container: receivedContainer });
    }
  );

  for (const trigger of ["toolbar-refresh", "mode-selection"] as const) {
    assert.equal(isUserInitiatedFastPreviewTrigger(trigger), true);
    assert.equal(
      await runtime.handle(trigger, { source, action, container }),
      true
    );
  }
  assert.equal(calls.length, 2);
  assert.equal(rendered.length, 2);
  assert.strictEqual(rendered[0]?.bytes, builtBytes);
  assert.strictEqual(rendered[0]?.container, container);
});

test("DOCX package renderer preserves the 2.4.2 page rendering contract", async () => {
  const bytes = new Uint8Array([80, 75, 3, 4]);
  const container = {} as HTMLElement;
  let invocation:
    | {
        data: Uint8Array;
        body: HTMLElement;
        styles: HTMLElement | undefined;
        options: {
          breakPages: boolean;
          inWrapper: boolean;
          renderAltChunks: boolean;
        };
      }
    | undefined;
  const renderer: DocxPackageRenderer = async (
    data,
    body,
    styles,
    options
  ) => {
    invocation = { data, body, styles, options };
  };

  await renderDocxPackage(bytes, container, renderer);

  assert.strictEqual(invocation?.data, bytes);
  assert.strictEqual(invocation?.body, container);
  assert.equal(invocation?.styles, undefined);
  assert.deepEqual(invocation?.options, {
    breakPages: true,
    inWrapper: true,
    renderAltChunks: false
  });
});
