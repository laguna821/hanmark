import assert from "node:assert/strict";
import { test } from "node:test";
import type { DocumentStyleProfile } from "../src/io/documentStyle";
import {
  renderStandaloneHtml,
  renderStandaloneHtmlBytes
} from "../src/legacy-port/htmlExport";

const CSP =
  "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
const ONE_PIXEL_GIF =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

test("Achmage Editorial is deterministic, responsive, printable, and carries attribution", () => {
  const markdown = [
    "# **첫 제목**",
    "",
    "본문입니다.",
    "",
    "## 왼쪽 막대 제목",
    "",
    "> 중요한 인용문",
    "",
    "| 이름 | 값 |",
    "| --- | --- |",
    "| A | B |",
    "",
    `![내장 그림](${ONE_PIXEL_GIF})`,
    "",
    "# 뒤쪽 제목"
  ].join("\n");
  const html = renderStandaloneHtml(markdown, { title: "파일 이름" });

  assert.match(html, /<title>첫 제목<\/title>/);
  assert.match(html, /<h1><strong>첫 제목<\/strong><\/h1>/);
  assert.doesNotMatch(
    html,
    /<h1 class="hanmark-heading"><strong>첫 제목<\/strong><\/h1>/
  );
  assert.match(html, /<h1 class="hanmark-heading">뒤쪽 제목<\/h1>/);
  assert.match(
    html,
    /<!-- Achmage Editorial theme adapted from Kami under the MIT License\. -->/
  );
  assert.ok(
    ["#FFFFFF", "#F4F8FB", "#002E6E", "#0066B3", "#00B5AD"].every(
      (color) => html.includes(color)
    )
  );
  assert.match(
    html,
    /font-family: Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif/
  );
  assert.match(html, /\.hanmark-heading::before/);
  assert.match(html, /\.hanmark-callout/);
  assert.match(html, /th \{ background: var\(--hanmark-navy\)/);
  assert.match(html, /tbody tr:nth-child\(even\)/);
  assert.match(html, /@media \(max-width: 760px\)/);
  assert.match(html, /box-shadow: none/);
  assert.match(html, /@page \{ size: A4/);
  assert.match(html, /orphans: 3; widows: 3/);
  assert.match(html, /break-inside: avoid/);
  assert.match(html, new RegExp(`content="${CSP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(html, /src="data:image\/gif;base64,/);
  assert.doesNotMatch(html, /<script(?:\s|>)/i);

  assert.deepEqual(
    renderStandaloneHtmlBytes(markdown, { title: "파일 이름" }),
    new TextEncoder().encode(html)
  );
  assert.equal(
    renderStandaloneHtml(markdown, { title: "파일 이름" }),
    html
  );
});

test("HTML renderer allows only explicit web and mail links and validated raster data images", () => {
  const markdown = [
    "# 안전성",
    "[HTTPS](https://example.com/path?q=1)",
    "[HTTP](http://example.com)",
    "[메일](mailto:test@example.com)",
    "[상대](./private.html)",
    "[파일](file:///etc/passwd)",
    "[FTP](ftp://example.com/file)",
    "[스크립트](javascript:alert(1))",
    `![GIF](${ONE_PIXEL_GIF})`,
    "![원격](https://example.com/tracker.png)",
    "![가짜 PNG](data:image/png;base64,AAAA)",
    "![SVG](data:image/svg+xml;base64,PHN2Zz4=)",
    "<iframe src=\"https://example.com\" onload=\"alert(1)\"></iframe>",
    "<script>alert(1)</script>"
  ].join("\n");
  const html = renderStandaloneHtml(markdown, { title: "안전성" });

  assert.match(html, /href="https:\/\/example\.com\/path\?q=1"/);
  assert.match(html, /href="http:\/\/example\.com"/);
  assert.match(html, /href="mailto:test@example\.com"/);
  assert.equal((html.match(/href="#"/g) ?? []).length, 4);
  assert.match(html, /src="data:image\/gif;base64,/);
  assert.doesNotMatch(html, /src="https:\/\/example\.com\/tracker\.png"/);
  assert.doesNotMatch(html, /src="data:image\/png;base64,AAAA"/);
  assert.doesNotMatch(html, /src="data:image\/svg\+xml/);
  assert.doesNotMatch(html, /<iframe(?:\s|>)/i);
  assert.doesNotMatch(html, /<script(?:\s|>)/i);
  assert.match(html, /&lt;iframe src="https:\/\/example\.com"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("masthead title keeps literal hash and equals characters", () => {
  const html = renderStandaloneHtml(
    "# C#과 A=B — **강조**",
    { title: "파일 이름" }
  );

  assert.match(html, /<title>C#과 A=B — 강조<\/title>/);
  assert.match(html, /<h1>C#과 A=B — <strong>강조<\/strong><\/h1>/);
});

test("Editorial callouts remove Obsidian markers while preserving safe visible text", () => {
  const markdown = [
    "# 콜아웃",
    "> [!note] **참고 제목**",
    "> [!WARNING]- 접힌 경고",
    "> 일반 인용문"
  ].join("\n");
  const html = renderStandaloneHtml(markdown, { title: "콜아웃" });

  assert.equal((html.match(/class="hanmark-callout"/g) ?? []).length, 3);
  assert.match(html, /<aside class="hanmark-callout"><strong>참고 제목<\/strong><\/aside>/);
  assert.match(html, /<aside class="hanmark-callout">접힌 경고<\/aside>/);
  assert.match(html, /<aside class="hanmark-callout">일반 인용문<\/aside>/);
  assert.doesNotMatch(html, /\[!(?:note|warning)\]/i);
});

test("Classic theme retains page and document-style rendering", () => {
  const profile = {
    schemaVersion: 3,
    name: "Classic test",
    roles: {
      body: {
        character: { fontFamily: "함초롬바탕", fontSizePt: 11 },
        paragraph: { alignment: "JUSTIFY", lineSpacingPercent: 170 }
      }
    }
  } satisfies DocumentStyleProfile;
  const html = renderStandaloneHtml(
    `# 제목\n\n본문\n\n![원격](https://example.com/a.png)\n\n![내장](${ONE_PIXEL_GIF})`,
    {
      title: "Classic",
      documentStyle: profile,
      page: { widthPt: 612 },
      theme: "classic"
    }
  );

  assert.match(html, /width: 612pt/);
  assert.match(html, /font-family:"함초롬바탕"/);
  assert.match(html, /line-height:1\.70/);
  assert.doesNotMatch(html, /Achmage Editorial theme adapted/);
  assert.doesNotMatch(html, /src="https:\/\/example\.com\/a\.png"/);
  assert.match(html, /src="data:image\/gif;base64,/);
  assert.match(html, new RegExp(`content="${CSP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
});
