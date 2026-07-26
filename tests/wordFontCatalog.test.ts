import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  FilePickOptions,
  FileGateway,
  SavedFileResult,
  SelectedExternalFile
} from "../src/io/fileGateway";
import {
  FONT_PICK_LIMITS,
  filterWordFontEntries,
  readOpenTypeFamily,
  WordFontCatalog,
  type WordFontCatalogEntry
} from "../src/legacy-port/wordFontCatalog";
import {
  normalizeHanmarkSettings,
  type HanmarkSettings
} from "../src/legacy-port/settings";

function utf16Be(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    bytes[index * 2] = code >> 8;
    bytes[index * 2 + 1] = code & 0xff;
  }
  return bytes;
}

function testFont(family: string): Uint8Array {
  const encoded = utf16Be(family);
  const nameTableOffset = 28;
  const nameTableLength = 18 + encoded.byteLength;
  const bytes = new Uint8Array(nameTableOffset + nameTableLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000, false);
  view.setUint16(4, 1, false);
  bytes.set(new TextEncoder().encode("name"), 12);
  view.setUint32(20, nameTableOffset, false);
  view.setUint32(24, nameTableLength, false);
  view.setUint16(nameTableOffset, 0, false);
  view.setUint16(nameTableOffset + 2, 1, false);
  view.setUint16(nameTableOffset + 4, 18, false);
  const record = nameTableOffset + 6;
  view.setUint16(record, 3, false);
  view.setUint16(record + 2, 1, false);
  view.setUint16(record + 4, 0x0412, false);
  view.setUint16(record + 6, 16, false);
  view.setUint16(record + 8, encoded.byteLength, false);
  view.setUint16(record + 10, 0, false);
  bytes.set(encoded, nameTableOffset + 18);
  return bytes;
}

function saved(fileName: string): SavedFileResult {
  return { cancelled: false, fileName };
}

class MemoryFileGateway implements FileGateway {
  selected: SelectedExternalFile[] = [];
  readonly cache = new Map<string, Uint8Array>();
  pickOptions: FilePickOptions | null = null;
  failCacheReads = false;

  async pickFiles(options: FilePickOptions): Promise<SelectedExternalFile[]> {
    this.pickOptions = options;
    return this.selected;
  }

  async saveFile(
    _data: Uint8Array | ArrayBuffer,
    suggestedName: string
  ): Promise<SavedFileResult> {
    return saved(suggestedName);
  }

  async saveVaultSibling(
    _data: Uint8Array | ArrayBuffer,
    suggestedName: string,
    _sourcePath: string
  ): Promise<SavedFileResult> {
    return saved(suggestedName);
  }

  async cacheSource(data: Uint8Array): Promise<string> {
    const id = `sha256-${String(this.cache.size + 1).padStart(64, "0")}.bin`;
    this.cache.set(id, data);
    return id;
  }

  async readCachedSource(cacheId: string): Promise<Uint8Array | null> {
    if (this.failCacheReads) throw new Error("cache unavailable");
    return this.cache.get(cacheId) ?? null;
  }
}

test("OpenType parser prefers the typographic Korean family name", () => {
  assert.equal(
    readOpenTypeFamily(testFont("함초롬바탕"), "fallback-bold.ttf"),
    "함초롬바탕"
  );
  assert.equal(
    readOpenTypeFamily(new Uint8Array([1, 2, 3]), "My_Font-Bold.ttf"),
    "My Font"
  );
});

test("Word font search includes family, source, and source file labels", () => {
  const entries: WordFontCatalogEntry[] = [
    {
      family: "함초롬바탕",
      displayName: "함초롬바탕",
      previewFamily: "함초롬바탕",
      source: "installed",
      weight: 400,
      style: "normal"
    },
    {
      family: "Research Serif",
      displayName: "Research Serif",
      previewFamily: "Research Serif",
      source: "custom-file",
      sourceLabel: "lab-font.otf",
      weight: 400,
      style: "normal"
    }
  ];

  assert.deepEqual(
    filterWordFontEntries(entries, "함초롬").map((entry) => entry.family),
    ["함초롬바탕"]
  );
  assert.deepEqual(
    filterWordFontEntries(entries, "lab-font").map((entry) => entry.family),
    ["Research Serif"]
  );
});

test("explicit font file and directory picks cache bytes and retain manual metadata", async () => {
  let settings: HanmarkSettings = normalizeHanmarkSettings({}, "windows");
  const gateway = new MemoryFileGateway();
  const fontBytes = testFont("테스트 명조");
  gateway.selected = [{
    name: "TestMyeongjo-Bold.ttf",
    bytes: fontBytes,
    displayPath: "C:/Users/private/Research Fonts/TestMyeongjo-Bold.ttf",
    relativePath: "Research Fonts/TestMyeongjo-Bold.ttf"
  }];
  const catalog = new WordFontCatalog(() => settings, gateway);

  const imported = await catalog.pickFontDirectory();
  assert.equal(gateway.pickOptions?.directory, true);
  assert.equal(gateway.pickOptions?.maxFiles, FONT_PICK_LIMITS.maxFiles);
  assert.equal(gateway.pickOptions?.maxFileBytes, FONT_PICK_LIMITS.maxFileBytes);
  assert.equal(gateway.pickOptions?.maxTotalBytes, FONT_PICK_LIMITS.maxTotalBytes);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].family, "테스트 명조");
  assert.equal(imported[0].weight, 700);
  assert.equal(imported[0].previewOnly, true);
  assert.match(imported[0].cacheId ?? "", /^sha256-[a-f0-9]{64}\.bin$/);
  assert.equal(imported[0].path, "Research Fonts/TestMyeongjo-Bold.ttf");
  assert.equal(imported[0].path.includes("C:/Users/private"), false);
  assert.deepEqual(settings.customFontDirs, ["Research Fonts"]);

  settings = normalizeHanmarkSettings(settings, "windows");
  assert.equal(settings.customFonts[0].family, "테스트 명조");
  assert.equal(settings.customFonts[0].fileName, "TestMyeongjo-Bold.ttf");
  assert.equal(settings.customFonts[0].cacheId, imported[0].cacheId);
  assert.equal(
    catalog.listFamilies(["직접 입력 글꼴"]).some(
      (entry) => entry.family === "직접 입력 글꼴" && entry.source === "document"
    ),
    true
  );
});

test("preview fonts are loaded once per target document and cache failures stay non-blocking", async () => {
  const settings = normalizeHanmarkSettings({
    customFonts: [{
      family: "Preview Serif",
      path: "PreviewSerif.ttf",
      fileName: "PreviewSerif.ttf",
      cacheId: `sha256-${"1".repeat(64)}.bin`,
      weight: 400,
      style: "normal",
      previewOnly: true
    }]
  }, "windows");
  const gateway = new MemoryFileGateway();
  gateway.cache.set(settings.customFonts[0].cacheId!, testFont("Preview Serif"));
  const catalog = new WordFontCatalog(settings, gateway);

  let firstConstructed = 0;
  let secondConstructed = 0;
  let firstAdded = 0;
  let secondAdded = 0;
  class FirstDocumentFontFace {
    status = "unloaded";
    constructor(
      readonly family: string,
      readonly source: string | ArrayBuffer,
      readonly descriptors?: FontFaceDescriptors
    ) {
      firstConstructed += 1;
    }
    async load(): Promise<this> {
      this.status = "loaded";
      return this;
    }
  }
  class SecondDocumentFontFace extends FirstDocumentFontFace {
    constructor(
      family: string,
      source: string | ArrayBuffer,
      descriptors?: FontFaceDescriptors
    ) {
      super(family, source, descriptors);
      firstConstructed -= 1;
      secondConstructed += 1;
    }
  }
  const firstDocument = {
    fonts: {
      add: () => {
        firstAdded += 1;
      }
    },
    defaultView: {
      FontFace: FirstDocumentFontFace
    }
  } as unknown as Document;
  const secondDocument = {
    fonts: {
      add: () => {
        secondAdded += 1;
      }
    },
    defaultView: {
      FontFace: SecondDocumentFontFace
    }
  } as unknown as Document;

  await catalog.applyPreviewFonts(firstDocument);
  await catalog.applyPreviewFonts(firstDocument);
  await catalog.applyPreviewFonts(secondDocument);
  assert.equal(firstConstructed, 1);
  assert.equal(secondConstructed, 1);
  assert.equal(firstAdded, 1);
  assert.equal(secondAdded, 1);

  gateway.failCacheReads = true;
  const failingDocument = {
    fonts: { add: () => undefined },
    defaultView: { FontFace: FirstDocumentFontFace }
  } as unknown as Document;
  await assert.doesNotReject(catalog.applyPreviewFonts(failingDocument));
});
