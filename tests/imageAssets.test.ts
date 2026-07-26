import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { parse, validateHwpx } from "kordoc";
import { collectImageReferences, ImageResolutionError } from "../src/io/imageAssets";
import { generateValidatedHwpx, renderQuickHwpxPreview } from "../src/io/kordocEngine";

const PNG_1X1 = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==", "base64")
);

describe("fast HWPX image embedding", () => {
  it("downloads each unique source once and embeds repeated placements into BinData and preview SVG", async () => {
    const source = "https://images.example/one.png";
    let loads = 0;
    const markdown = `# 이미지 문서\n\n![첫 이미지](${source})\n\n![반복 이미지](${source})\n`;
    const options = {
      images: {
        loader: async (requested: string) => {
          assert.equal(requested, source);
          loads++;
          return { data: PNG_1X1, contentType: "image/png" };
        }
      }
    };

    const generated = await generateValidatedHwpx(markdown, options);
    assert.equal(loads, 1);
    assert.equal(generated.imageCount, 1);
    assert.equal(generated.embeddedImageCount, 1);
    assert.equal(generated.embeddedImageOccurrences, 2);
    assert.deepEqual(generated.imageFailures, []);
    assert.equal((await validateHwpx(generated.data)).ok, true);

    const archive = await JSZip.loadAsync(generated.data);
    const binary = archive.file("BinData/hanmark_image_001.png");
    assert.ok(binary);
    assert.deepEqual(await binary.async("uint8array"), PNG_1X1);
    const manifest = await archive.file("Contents/content.hpf")!.async("string");
    const section = await archive.file("Contents/section0.xml")!.async("string");
    assert.match(manifest, /id="hanmark_image_001"/);
    assert.match(manifest, /href="BinData\/hanmark_image_001\.png"/);
    assert.equal(section.match(/<hp:pic\b/g)?.length, 2);
    assert.equal(section.match(/binaryItemIDRef="hanmark_image_001"/g)?.length, 2);
    assert.match(section, /<hp:orgSz\b[^>]*width="75"[^>]*height="75"/);

    const parsed = await parse(generated.data);
    assert.equal(parsed.success, true);
    const preview = await renderQuickHwpxPreview(markdown, options);
    assert.equal(preview.render.stats.images, 2);
    assert.match(preview.render.svg, /data:image\/png;base64,/);
  });

  it("never silently keeps a Kordoc placeholder when image loading fails", async () => {
    const markdown = "# 실패\n\n![사라지면 안 됨](https://images.example/missing.png)\n";
    const loader = async () => {
      throw new Error("HTTP 404");
    };

    await assert.rejects(
      () => generateValidatedHwpx(markdown, { images: { loader } }),
      (error: unknown) => {
        assert.ok(error instanceof ImageResolutionError);
        assert.match(error.message, /HTTP 404/);
        return true;
      }
    );

    const continued = await generateValidatedHwpx(markdown, { images: { loader, allowFailures: true } });
    assert.equal(continued.embeddedImageCount, 0);
    assert.equal(continued.imageFailures.length, 1);
    assert.match(continued.adaptedMarkdown, /\[이미지 누락: 사라지면 안 됨\]/);
    const archive = await JSZip.loadAsync(continued.data);
    const binaryFiles = Object.values(archive.files).filter((entry) => !entry.dir && entry.name.startsWith("BinData/"));
    assert.equal(binaryFiles.length, 0);
    const section = await archive.file("Contents/section0.xml")!.async("string");
    assert.doesNotMatch(section, /<hp:pic\b/);
  });

  it("rejects partial placement instead of silently losing one repeated occurrence", async () => {
    const source = "https://images.example/repeated.png";
    const markdown = `![독립 이미지](${source})\n\n문장 안의 ![인라인 이미지](${source}) 뒤쪽\n`;
    await assert.rejects(
      () => generateValidatedHwpx(markdown, { images: { loader: async () => ({ data: PNG_1X1 }) } }),
      (error: unknown) => {
        assert.ok(error instanceof ImageResolutionError);
        assert.equal(error.failures[0]?.stage, "place");
        return true;
      }
    );
  });

  it("normalizes an HTML image to a Kordoc image object before embedding", async () => {
    const generated = await generateValidatedHwpx('<img src="https://images.example/html.png" alt="HTML 그림">\n', {
      images: { loader: async () => ({ data: PNG_1X1 }) }
    });
    assert.equal(generated.embeddedImageCount, 1);
    assert.equal(generated.embeddedImageOccurrences, 1);
    assert.match(generated.adaptedMarkdown, /!\[HTML 그림\]\(hanmark_image_001\.png\)/);
  });

  it("finds Markdown and HTML images outside fenced code and deduplicates sources", () => {
    const complex =
      "01.%20핵심연구(기본연구A)%20신규과제%20연구계획서%20작성%20서식(대표업적%20포함)-image_001.bmp";
    const references = collectImageReferences(`![첫째](a.png)\n<img src="b.jpg" alt="둘째">\n![반복](a.png)\n![공백](<attachments/my photo.png>)\n![가져온 한글 이미지](${complex})\n\n\`\`\`md\n![코드](ignored.png)\n\`\`\``);
    assert.deepEqual(references, [
      { source: "a.png", alt: "첫째", occurrences: 2 },
      { source: "b.jpg", alt: "둘째", occurrences: 1 },
      { source: "attachments/my photo.png", alt: "공백", occurrences: 1 },
      { source: complex, alt: "가져온 한글 이미지", occurrences: 1 }
    ]);
  });
});
