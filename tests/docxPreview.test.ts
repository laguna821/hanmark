import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  calculateDocxPreviewFitPercent,
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

test("explicit open upgrades once while manual refresh remains repeatable", async () => {
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

  assert.equal(isUserInitiatedFastPreviewTrigger("explicit-open"), true);
  assert.equal(
    await runtime.handle("explicit-open", { source, action, container }),
    true
  );
  assert.equal(
    await runtime.handle("explicit-open", { source, action, container }),
    false
  );
  for (const trigger of ["toolbar-refresh", "mode-selection"] as const) {
    assert.equal(isUserInitiatedFastPreviewTrigger(trigger), true);
    assert.equal(
      await runtime.handle(trigger, { source, action, container }),
      true
    );
  }
  assert.equal(calls.length, 3);
  assert.equal(rendered.length, 3);
  assert.strictEqual(rendered[0]?.bytes, builtBytes);
  assert.strictEqual(rendered[0]?.container, container);
});

test("DOCX page fit is clamped to 40-100% in 5% steps", () => {
  assert.equal(calculateDocxPreviewFitPercent(1_000, 800), 100);
  assert.equal(calculateDocxPreviewFitPercent(799, 800), 95);
  assert.equal(calculateDocxPreviewFitPercent(641, 800), 80);
  assert.equal(calculateDocxPreviewFitPercent(319, 800), 40);
  assert.equal(calculateDocxPreviewFitPercent(0, 800), 100);
  assert.equal(calculateDocxPreviewFitPercent(800, Number.NaN), 100);
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

test("explicit UI open is wired after view creation and responsive fit is CSS-scoped", async () => {
  const [main, view, css] = await Promise.all([
    readFile("src/main.ts", "utf8"),
    readFile("src/ui/DocxPreviewView.ts", "utf8"),
    readFile("styles.css", "utf8")
  ]);

  assert.match(
    main,
    /await leaf\.setViewState\([\s\S]*?leaf\.view\.showUserInitiatedPreview\(\)/u
  );
  assert.match(
    main,
    /existing\[0\]\.view\.showUserInitiatedPreview\(\)/u
  );
  const onOpenBlock = view.slice(
    view.indexOf("async onOpen()"),
    view.indexOf("async showUserInitiatedPreview()")
  );
  assert.doesNotMatch(onOpenBlock, /explicit-open/u);
  assert.match(view, /role:\s*"status"[\s\S]*?"data-state":\s*"semantic"/u);
  assert.match(view, /new ResizeObserver\(\(\) => this\.updatePreviewFit\(\)\)/u);
  for (let fit = 40; fit <= 100; fit += 5) {
    assert.match(css, new RegExp(`data-fit="${fit}"`, "u"));
  }
  assert.match(
    css,
    /\.docx-preview-docx \.docx-wrapper,[\s\S]*?\.hanmark-docx-preview-paper[\s\S]*?zoom:/u
  );
});
