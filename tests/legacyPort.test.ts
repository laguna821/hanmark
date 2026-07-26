import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import type { DocumentStyleProfile } from "../src/io/documentStyle";
import {
  buildReferenceDocx,
  createDefaultWordTemplate,
  createPandocDocxArgs,
  createUserInitiatedAction,
  normalizeHanmarkSettings,
  PandocDocxService,
  parseWordTemplateJson,
  preprocessMarkdownForHtml,
  renderStandaloneHtml,
  WordPdfPreviewService,
  WordTemplateStore,
  type ProcessRequest,
  type UserInitiatedAction,
  type WordTemplateDirectoryListing,
  type WordTemplateStorage
} from "../src/legacy-port";

class MemoryTemplateStorage implements WordTemplateStorage {
  readonly directories = new Set<string>();
  readonly files = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    return this.directories.has(path) || this.files.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.directories.add(path);
  }

  async list(path: string): Promise<WordTemplateDirectoryListing> {
    const prefix = `${path}/`;
    return {
      files: [...this.files.keys()].filter((file) => {
        if (!file.startsWith(prefix)) return false;
        return !file.slice(prefix.length).includes("/");
      }),
      folders: [...this.directories].filter((folder) => {
        if (!folder.startsWith(prefix)) return false;
        return !folder.slice(prefix.length).includes("/");
      })
    };
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`Missing test file: ${path}`);
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

test("typed settings retain Kordoc-owned data and retire Python-era keys", () => {
  const settings = normalizeHanmarkSettings(
    {
      pythonPath: "python",
      defaultTemplatePath: "old.hwpx",
      pandocPath: " C:\\Pandoc\\pandoc.exe ",
      hanmarkTemplateLibrary: {
        schemaVersion: 1,
        activeId: "builtin:kordoc-default",
        customTemplates: {}
      },
      hanmarkDocumentStyle: { name: "migration source" },
      futureKordocSetting: { enabled: true }
    },
    "windows"
  );

  assert.equal(settings.pandocPath, "C:\\Pandoc\\pandoc.exe");
  assert.equal(settings.fontDirectoryPath, "C:\\Windows\\Fonts");
  assert.equal(settings.pythonPath, undefined);
  assert.equal(settings.defaultTemplatePath, undefined);
  assert.deepEqual(settings.futureKordocSetting, { enabled: true });
  assert.equal(settings.hanmarkTemplateLibrary?.schemaVersion, 1);
  assert.deepEqual(settings.hanmarkDocumentStyle, { name: "migration source" });
});

test("HTML replacement preserves legacy structures and neutralizes active URLs", () => {
  const profile = {
    schemaVersion: 3,
    name: "HTML test",
    roles: {
      body: {
        character: { fontFamily: "함초롬바탕", fontSizePt: 11 },
        paragraph: { alignment: "JUSTIFY", lineSpacingPercent: 170 }
      },
      h1: {
        character: { fontFamily: "맑은 고딕", fontSizePt: 19, bold: true }
      }
    }
  } satisfies DocumentStyleProfile;
  const markdown = [
    "# 제목",
    "",
    "| 열 1 | 열 2 |",
    "| --- | --- |",
    "| 값 | ![그림](https://example.com/a.png) |",
    "",
    "- [x] 완료",
    "[위험](javascript:alert(1))",
    "```html",
    "<script>alert(1)</script>",
    "```"
  ].join("\n");
  const blocks = preprocessMarkdownForHtml(markdown);
  const html = renderStandaloneHtml(markdown, {
    title: "<내 문서>",
    documentStyle: profile,
    theme: "classic"
  });

  assert.ok(blocks.some((block) => block.type === "table"));
  assert.ok(blocks.some((block) => block.type === "list" && block.html.includes("☑")));
  assert.match(html, /<title>&lt;내 문서&gt;<\/title>/);
  assert.match(html, /font-family:"맑은 고딕"/);
  assert.match(html, /line-height:1\.70/);
  assert.doesNotMatch(html, /src="https:\/\/example\.com\/a\.png"/);
  assert.match(html, /href="#"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("multi-template store uses Vault-relative storage and validates JSON", async () => {
  const storage = new MemoryTemplateStorage();
  let activeId = "default";
  let nextId = 0;
  const store = new WordTemplateStore({
    storage,
    rootPath: ".obsidian/plugins/hanmark",
    getActiveTemplateId: () => activeId,
    setActiveTemplateId: (id) => {
      activeId = id;
    },
    createId: () => `custom-${++nextId}`
  });

  const original = await store.ensureDefaultTemplate(createDefaultWordTemplate());
  const first = await store.duplicateTemplate(original.id, "학회 양식");
  const second = await store.duplicateTemplate(original.id, "보고서 양식");
  await store.setActiveTemplate(second.id);

  assert.equal((await store.listTemplates()).length, 3);
  assert.equal((await store.readActiveTemplate()).name, "보고서 양식");
  assert.notEqual(first.id, second.id);
  assert.match(store.getPreviewCacheKey(second, "# 문서", "fast-docx"), /-fast-docx-v3$/);
  assert.throws(
    () => parseWordTemplateJson('{"version":1,"id":"../escape"}'),
    /schema/
  );
  assert.ok([...storage.files.keys()].every((path) => path.startsWith(".obsidian/plugins/hanmark/")));
});

test("Word template names stay distinguishable and malformed inactive files are isolated", async () => {
  const storage = new MemoryTemplateStorage();
  let activeId = "default";
  let nextId = 0;
  const store = new WordTemplateStore({
    storage,
    rootPath: ".obsidian/plugins/hanmark",
    getActiveTemplateId: () => activeId,
    setActiveTemplateId: (id) => {
      activeId = id;
    },
    createId: () => `custom-${++nextId}`
  });
  const original = await store.ensureDefaultTemplate(createDefaultWordTemplate());
  const first = await store.duplicateTemplate(original.id, "학회 양식");
  const second = await store.duplicateTemplate(original.id, "학회 양식");
  storage.files.set(
    ".obsidian/plugins/hanmark/word-templates/broken.json",
    "{not-json"
  );

  assert.equal(first.name, "학회 양식");
  assert.equal(second.name, "학회 양식 (2)");
  assert.deepEqual(
    (await store.listTemplates()).map((template) => template.name),
    [original.name, first.name, second.name]
  );
  assert.equal(await store.readTemplate("broken"), null);
});

test("a damaged default Word template is backed up and rebuilt", async () => {
  const storage = new MemoryTemplateStorage();
  const store = new WordTemplateStore({
    storage,
    rootPath: ".obsidian/plugins/hanmark",
    getActiveTemplateId: () => "default",
    setActiveTemplateId: () => undefined,
    createId: () => "unused"
  });
  await store.ensureDirectories();
  const defaultPath = store.getTemplatePath("default");
  storage.files.set(defaultPath, "{damaged");

  const recovered = await store.ensureDefaultTemplate(
    createDefaultWordTemplate()
  );

  assert.equal(recovered.id, "default");
  assert.equal((await store.readTemplate("default"))?.id, "default");
  assert.ok(
    [...storage.files.keys()].some(
      (path) =>
        path.startsWith(`${defaultPath}.invalid-`) && path.endsWith(".bak")
    )
  );
});

test("Pandoc service preserves arguments and runs only with a UI token", async () => {
  let captured: ProcessRequest | null = null;
  const runner = async (
    request: ProcessRequest,
    _action: UserInitiatedAction
  ): Promise<{ stdout: Uint8Array; stderr: string }> => {
    captured = request;
    return { stdout: new TextEncoder().encode("pandoc 3.7"), stderr: "" };
  };
  const service = new PandocDocxService(runner);
  const action = createUserInitiatedAction("modal");
  await service.convertUserInitiated(
    {
      pandocPath: "pandoc",
      inputPath: "cache/input.md",
      outputPath: "cache/output.docx",
      referenceDocPath: "cache/reference.docx",
      luaFilterPath: "word-assets/docx_style_map.lua",
      resourcePaths: ["note-folder", "vault-root"],
      resourcePathDelimiter: ";"
    },
    action
  );

  assert.equal(captured?.executable, "pandoc");
  assert.deepEqual(
    captured?.args,
    createPandocDocxArgs({
      inputPath: "cache/input.md",
      outputPath: "cache/output.docx",
      referenceDocPath: "cache/reference.docx",
      luaFilterPath: "word-assets/docx_style_map.lua",
      resourcePaths: ["note-folder", "vault-root"],
      resourcePathDelimiter: ";"
    })
  );
  assert.equal(await service.readVersionUserInitiated("pandoc", action), "pandoc 3.7");
});

test("Word PDF preview is Windows-only, serialized, and verifies output", async () => {
  const invocations: string[][] = [];
  const runner = async (
    request: ProcessRequest,
    _action: UserInitiatedAction
  ): Promise<{ stdout: Uint8Array; stderr: string }> => {
    invocations.push([...request.args]);
    return { stdout: new Uint8Array(), stderr: "" };
  };
  const service = new WordPdfPreviewService(runner);
  const action = createUserInitiatedAction("toolbar");

  await assert.rejects(
    service.convertUserInitiated(
      {
        platform: "macos",
        scriptPath: "Convert-WordToPdf.ps1",
        inputDocxPath: "input.docx",
        outputPdfPath: "output.pdf",
        outputExists: async () => true
      },
      action
    ),
    /Windows/
  );
  await service.convertUserInitiated(
    {
      platform: "windows",
      scriptPath: "Convert-WordToPdf.ps1",
      inputDocxPath: "input.docx",
      outputPdfPath: "output.pdf",
      outputExists: async () => true
    },
    action
  );
  assert.equal(invocations.length, 1);
  assert.ok(invocations[0].includes("-NoProfile"));
});

test("reference DOCX builder applies fonts, paragraph styles, and page size in memory", async () => {
  const base = new JSZip();
  const namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  base.file(
    "word/styles.xml",
    `<w:styles xmlns:w="${namespace}"><w:style w:type="paragraph" w:styleId="Normal"/></w:styles>`
  );
  base.file(
    "word/document.xml",
    `<w:document xmlns:w="${namespace}"><w:body><w:sectPr/></w:body></w:document>`
  );
  base.file("word/settings.xml", `<w:settings xmlns:w="${namespace}"/>`);
  base.file("word/fontTable.xml", `<w:fonts xmlns:w="${namespace}"/>`);
  const template = createDefaultWordTemplate();
  template.styles.Normal.font!.family = "함초롬바탕";
  template.styles.Normal.font!.eastAsiaFamily = "함초롬바탕";
  template.page.marginLeftPt = 54;
  const output = await buildReferenceDocx(
    await base.generateAsync({ type: "uint8array" }),
    template
  );
  const patched = await JSZip.loadAsync(output);
  const styles = await patched.file("word/styles.xml")?.async("string");
  const document = await patched.file("word/document.xml")?.async("string");
  const fonts = await patched.file("word/fontTable.xml")?.async("string");

  assert.match(styles ?? "", /w:eastAsia="함초롬바탕"/);
  assert.match(styles ?? "", /w:styleId="Heading1"/);
  assert.match(document ?? "", /w:left="1080"/);
  assert.match(fonts ?? "", /w:name="함초롬바탕"/);
});
