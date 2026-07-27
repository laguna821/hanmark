import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const EXPECTED = [
  {
    weight: "400",
    sha256: "fad853f7f47c6c8b103171e7193fa095708cdcd70850a71d93aa5379e8a61d63"
  },
  {
    weight: "600",
    sha256: "c863f76a7de5c1ddc1ed8b2fa794964530774592c4f31407a84e2a2ae93f17f0"
  }
] as const;

test("generated Editorial PDF fonts are the pinned unchanged Pretendard files", async () => {
  const [css, packageManifest] = await Promise.all([
    readFile("styles.css", "utf8"),
    readFile("package.json", "utf8").then((value) => JSON.parse(value))
  ]);

  assert.equal(
    packageManifest.devDependencies["@fontsource/pretendard"],
    "5.3.0"
  );
  assert.match(css, /Pretendard 5\.3\.0, Copyright \(c\) 2021 Kil Hyung-Jin/u);
  assert.match(css, /SIL Open Font License 1\.1/u);

  const rules = [
    ...css.matchAll(
      /font-family: "HanMark Pretendard";[\s\S]*?font-weight: (400|600);[\s\S]*?src: url\("data:font\/woff2;base64,([A-Za-z0-9+/=]+)"\)/gu
    )
  ];
  assert.equal(rules.length, 2);
  for (const expected of EXPECTED) {
    const match = rules.find((candidate) => candidate[1] === expected.weight);
    assert.ok(match, `missing Pretendard ${expected.weight}`);
    const digest = createHash("sha256")
      .update(Buffer.from(match[2], "base64"))
      .digest("hex");
    assert.equal(digest, expected.sha256);
  }
});
