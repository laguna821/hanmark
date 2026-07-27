import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("document imports prefer the CMDS Eagle bridge and retain a safe local fallback", async () => {
  const [pipeline, images, settings] = await Promise.all([
    readFile("src/io/kordocImport.ts", "utf8"),
    readFile("src/io/importImages.ts", "utf8"),
    readFile("src/legacy-port/settings.ts", "utf8")
  ]);

  assert.match(pipeline, /bridgeActiveNoteImagesThroughCmdsEagle/u);
  assert.match(pipeline, /createCmdsStagingNote\(app, images\)/u);
  assert.match(pipeline, /allowCommandFallback:\s*targetIsActive/u);
  assert.match(
    pipeline,
    /getActiveFile\(\)\?\.path !== stagingNote\.path\) return false/u
  );
  assert.match(
    pipeline,
    /applyVerifiedCloudReplacements\([\s\S]*?note,[\s\S]*?bridge\.replacements/u
  );
  assert.match(pipeline, /bridge\.status === "unavailable"/u);
  assert.match(pipeline, /deleteCmdsStagingNote\(app, stagingNote\)/u);
  assert.match(pipeline, /waitForCommandStagingToSettle/u);
  assert.match(
    pipeline,
    /bridge\.status === "success"[\s\S]*?cleanupVerifiedCloudImages\(/u
  );
  assert.match(
    pipeline,
    /directR2Fallback[\s\S]*?cleanupVerifiedCloudImages\(/u
  );
  assert.match(pipeline, /candidate\.ownedStagingFile/u);
  assert.match(pipeline, /bytesMatch\(candidate\.data/u);
  assert.match(pipeline, /hasOtherResolvedReference/u);
  assert.match(
    pipeline,
    /const systemTrash = \(app\.vault as unknown as LegacyVaultTrash\)\.trash\.bind\(app\.vault\);[\s\S]*?await systemTrash\(abstract, true\)/u
  );
  assert.match(
    pipeline,
    /let stagingNoteRemoved = false;[\s\S]*?stagingNoteRemoved = await deleteCmdsStagingNote\(app, stagingNote\)[\s\S]*?directR2Fallback\([\s\S]*?stagingNoteRemoved/u
  );
  assert.match(pipeline, /staging 노트를 보존했습니다/u);
  assert.match(pipeline, /if \(bridge\.eventUploadAttempted\)/u);
  assert.match(pipeline, /uploadImageToR2/u);
  assert.match(
    pipeline,
    /sessionR2Keys\.set\(settings\.workerUrl, apiKey\)/u
  );
  assert.match(
    pipeline,
    /error\.status === 401 \|\| error\.status === 403/u
  );
  assert.match(
    pipeline,
    /requestSessionR2Key\(app, settings\.workerUrl, true\)/u
  );
  assert.match(
    pipeline,
    /중복 업로드를 막기 위해 직접 R2 폴백은 실행하지 않았습니다/u
  );
  assert.match(images, /HanMark-Imported-Images/u);
  assert.match(images, /ownedStagingFile: true/u);
  assert.match(images, /options\.localFolder/u);
  assert.match(
    images,
    /if \(result\.replacements === 0\) \{[\s\S]*?본문 참조를 찾지 못해 이미지를 저장하지 않았습니다[\s\S]*?continue;/u
  );
  assert.match(images, /!\[\]\(\$\{attachmentPath\}\)/u);
  assert.match(images, /!\[\[\$\{attachmentPath\}\]\]/u);
  assert.match(settings, /"vault" \| "cmds-eagle-r2" \| "ask"/u);
  assert.match(settings, /importedImageFolder/u);
});

test("partial or late CMDS results preserve staging files instead of cleaning them", async () => {
  const pipeline = await readFile("src/io/kordocImport.ts", "utf8");

  assert.match(
    pipeline,
    /if \(bridge\.commandDispatched\)[\s\S]*?staging 노트를 보존했습니다/u
  );
  assert.match(
    pipeline,
    /if \(bridge\.eventUploadAttempted\)[\s\S]*?staging 노트를 보존했습니다/u
  );
  assert.match(
    pipeline,
    /if \(!commandSettled\)[\s\S]*?로컬 이미지를 보존했습니다/u
  );
});

test("CMDS Eagle integration never reads another plugin's private settings or stores its API key", async () => {
  const sources = (
    await Promise.all([
      readFile("src/io/kordocImport.ts", "utf8"),
      readFile("src/io/cmdsEagleBridge.ts", "utf8"),
      readFile("src/legacy-port/settings.ts", "utf8"),
      readFile("src/ui/HanmarkSettingTab.ts", "utf8")
    ])
  ).join("\n");

  assert.doesNotMatch(sources, /app\.plugins/u);
  assert.doesNotMatch(sources, /\.obsidian\/plugins\/cmds-eagle/u);
  assert.doesNotMatch(sources, /cmds-eagle\/data\.json/u);
  assert.doesNotMatch(sources, /cmdsEagleApiKey\s*:/u);
  assert.match(sources, /설정 파일에 저장하지 않습니다/u);
});
