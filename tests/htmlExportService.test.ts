import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HTML_EXPORT_IMAGE_LIMITS,
  prepareSelfContainedHtmlMarkdown
} from "../src/io/htmlExportService";
import { collectImageReferences, type ImageLoader } from "../src/io/imageAssets";
import { renderStandaloneHtml } from "../src/legacy-port/htmlExport";

const PNG_1X1 = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==", "base64")
);
const GIF_1X1 = Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));
const BMP_1X1 = (() => {
  const bytes = new Uint8Array(26);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  const view = new DataView(bytes.buffer);
  view.setInt32(18, 1, true);
  view.setInt32(22, 1, true);
  return bytes;
})();
const JPEG_1X1 = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9
]);

describe("self-contained HTML image preparation", () => {
  it("keeps the established image limits for HTML exports", () => {
    assert.deepEqual(HTML_EXPORT_IMAGE_LIMITS, {
      maxImages: 100,
      maxImageBytes: 20 * 1024 * 1024,
      maxTotalBytes: 200 * 1024 * 1024,
      concurrency: 4
    });
  });

  it("embeds remote and local raster images, deduplicates loads, and labels failures", async () => {
    const remote = "https://images.example/remote.png";
    const local = "attachments/local.png";
    const missing = "https://images.example/missing.png";
    const loads = new Map<string, number>();
    const loader: ImageLoader = async (source) => {
      loads.set(source, (loads.get(source) ?? 0) + 1);
      if (source === missing) throw new Error("HTTP 404");
      return { data: PNG_1X1, contentType: "image/png" };
    };
    const progress: string[] = [];
    const markdown = [
      `![원격 그림](${remote})`,
      `![원격 그림 반복](${remote})`,
      `<img src="${local}" alt="로컬 그림" onerror="alert(1)">`,
      `![사라진 그림](${missing})`
    ].join("\n\n");

    const result = await prepareSelfContainedHtmlMarkdown(markdown, {
      loader,
      onProgress: ({ source, status }) => progress.push(`${source}:${status}`)
    });

    assert.equal(loads.get(remote), 1);
    assert.equal(loads.get(local), 1);
    assert.equal(loads.get(missing), 1);
    assert.equal(result.references.length, 3);
    assert.equal(result.embeddedCount, 2);
    assert.equal(result.embeddedOccurrences, 3);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0]?.message ?? "", /HTTP 404/);
    assert.equal(progress.length, 3);
    assert.match(result.markdown, /!\[원격 그림\]\(data:image\/png;base64,/);
    assert.match(result.markdown, /!\[로컬 그림\]\(data:image\/png;base64,/);
    assert.match(result.markdown, /\[이미지 누락: 사라진 그림\]/);
    assert.doesNotMatch(result.markdown, /https:\/\/images\.example/);
    assert.doesNotMatch(result.markdown, /attachments\/local\.png/);
    assert.doesNotMatch(result.markdown, /onerror=/i);
    assert.ok(
      collectImageReferences(result.markdown).every((reference) =>
        reference.source.startsWith("data:image/png;base64,")
      )
    );
  });

  it("canonicalizes every supported raster type as an explicit base64 data URI", async () => {
    const fixtures = new Map<string, Uint8Array>([
      ["one.png", PNG_1X1],
      ["two.jpg", JPEG_1X1],
      ["three.gif", GIF_1X1],
      ["four.bmp", BMP_1X1]
    ]);
    const result = await prepareSelfContainedHtmlMarkdown(
      [...fixtures.keys()].map((source) => `![${source}](${source})`).join("\n"),
      {
        loader: async (source) => ({ data: fixtures.get(source) ?? new Uint8Array() })
      }
    );

    assert.equal(result.embeddedCount, 4);
    assert.deepEqual(result.failures, []);
    assert.match(result.markdown, /data:image\/png;base64,/);
    assert.match(result.markdown, /data:image\/jpeg;base64,/);
    assert.match(result.markdown, /data:image\/gif;base64,/);
    assert.match(result.markdown, /data:image\/bmp;base64,/);
    assert.ok(
      collectImageReferences(result.markdown).every((reference) =>
        /^data:image\/(?:png|jpeg|gif|bmp);base64,/i.test(reference.source)
      )
    );
  });

  it("prepares and renders an imported BMP image end to end", async () => {
    const result = await prepareSelfContainedHtmlMarkdown(
      "![Imported scan.bmp](imported-scan.bmp)",
      {
        loader: async () => ({ data: BMP_1X1, contentType: "image/bmp" })
      }
    );
    const html = renderStandaloneHtml(result.markdown, {
      title: "Imported document"
    });
    const encoded = Buffer.from(BMP_1X1).toString("base64");

    assert.match(
      html,
      new RegExp(
        `<img src="data:image/bmp;base64,${encoded}" alt="Imported scan\\.bmp" loading="lazy">`
      )
    );
    assert.equal((html.match(new RegExp(encoded, "g")) ?? []).length, 1);
    assert.doesNotMatch(html, /!\[Imported scan\.bmp\]/u);
  });

  it("rejects SVG and never preserves its source as an active image", async () => {
    const source = "https://images.example/vector.svg";
    const svg = Uint8Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "utf8"));
    const result = await prepareSelfContainedHtmlMarkdown(`![벡터 그림](${source})`, {
      loader: async () => ({ data: svg, contentType: "image/svg+xml" })
    });

    assert.equal(result.embeddedCount, 0);
    assert.equal(result.embeddedOccurrences, 0);
    assert.equal(result.failures.length, 1);
    assert.match(result.markdown, /\[이미지 누락: 벡터 그림\]/);
    assert.doesNotMatch(result.markdown, /vector\.svg/);
    assert.deepEqual(collectImageReferences(result.markdown), []);
  });

  it("leaves image-looking examples inside fenced code untouched and inactive", async () => {
    let loads = 0;
    const markdown = "```md\n![예시](https://images.example/not-active.png)\n```";
    const result = await prepareSelfContainedHtmlMarkdown(markdown, {
      loader: async () => {
        loads++;
        return { data: PNG_1X1 };
      }
    });

    assert.equal(loads, 0);
    assert.equal(result.embeddedCount, 0);
    assert.equal(result.failures.length, 0);
    assert.equal(result.markdown, markdown);
    assert.deepEqual(collectImageReferences(result.markdown), []);
  });

  it("embeds Obsidian raster embeds while preserving non-image note embeds", async () => {
    const loads: string[] = [];
    const markdown = [
      "![[attachments/screenshot one.png]]",
      "![[attachments/screenshot two.jpeg|설명 그림]]",
      "![[Meeting note|회의 노트]]",
      "```md",
      "![[attachments/code-example.png]]",
      "```"
    ].join("\n");
    const result = await prepareSelfContainedHtmlMarkdown(markdown, {
      loader: async (source) => {
        loads.push(source);
        return { data: PNG_1X1 };
      }
    });

    assert.deepEqual(loads.sort(), [
      "attachments/screenshot one.png",
      "attachments/screenshot two.jpeg"
    ]);
    assert.equal(result.embeddedCount, 2);
    assert.match(result.markdown, /!\[screenshot one\.png\]\(data:image\/png;base64,/);
    assert.match(result.markdown, /!\[설명 그림\]\(data:image\/png;base64,/);
    assert.match(result.markdown, /!\[\[Meeting note\|회의 노트\]\]/);
    assert.match(result.markdown, /!\[\[attachments\/code-example\.png\]\]/);
  });
});
