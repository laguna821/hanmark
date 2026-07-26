import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildOutputRevealRequest,
  normalizeTrustedVaultPath,
  revealVaultOutputUserInitiated,
  trustSavedVaultOutput
} from "../src/io/outputReveal";
import {
  createUserInitiatedAction,
  type ProcessRequest,
  type UserInitiatedAction
} from "../src/legacy-port/userProcess";

test("trusted Vault paths remain relative and reject escapes", () => {
  assert.equal(
    normalizeTrustedVaultPath("Notes\\exports\\paper.hwpx"),
    "Notes/exports/paper.hwpx"
  );
  assert.equal(
    normalizeTrustedVaultPath("한글 문서/.archive/paper (1).hwpx"),
    "한글 문서/.archive/paper (1).hwpx"
  );

  for (const unsafe of [
    "",
    " ",
    "/vault/paper.hwpx",
    "C:\\vault\\paper.hwpx",
    "C:vault\\paper.hwpx",
    "\\\\server\\share\\paper.hwpx",
    "../paper.hwpx",
    "notes/../../paper.hwpx",
    "notes/./paper.hwpx",
    "notes/\u0000paper.hwpx"
  ]) {
    assert.throws(() => normalizeTrustedVaultPath(unsafe), /Vault path|Vault-relative/);
  }
});

test("only fresh saved Vault outcomes receive a reveal token", () => {
  assert.equal(
    trustSavedVaultOutput({ status: "cancelled", vaultPath: "paper.hwpx" }),
    null
  );
  assert.equal(trustSavedVaultOutput({ status: "saved" }), null);
  assert.equal(
    trustSavedVaultOutput({ status: "delegated", vaultPath: "paper.pdf" }),
    null
  );

  const trusted = trustSavedVaultOutput({
    status: "saved",
    vaultPath: "Exports\\paper.docx"
  });
  assert.deepEqual(trusted, {
    method: "vault",
    vaultPath: "Exports/paper.docx"
  });
  assert.equal(Object.isFrozen(trusted), true);
});

test("reveal requests use fixed executables and argument arrays", () => {
  assert.deepEqual(
    buildOutputRevealRequest("windows", "C:\\Vault\\Exports\\paper.hwpx"),
    {
      executable: "explorer.exe",
      args: ["/select,", "C:\\Vault\\Exports\\paper.hwpx"],
      timeoutMs: 10_000,
      maxBufferBytes: 64 * 1024
    }
  );
  assert.deepEqual(
    buildOutputRevealRequest("macos", "/Users/name/Vault/Exports/paper.hwpx"),
    {
      executable: "/usr/bin/open",
      args: ["-R", "/Users/name/Vault/Exports/paper.hwpx"],
      timeoutMs: 10_000,
      maxBufferBytes: 64 * 1024
    }
  );
  assert.deepEqual(
    buildOutputRevealRequest("linux", "/home/name/Vault/Exports/paper.hwpx"),
    {
      executable: "xdg-open",
      args: ["/home/name/Vault/Exports"],
      timeoutMs: 10_000,
      maxBufferBytes: 64 * 1024
    }
  );
  assert.equal(
    buildOutputRevealRequest("linux", "/paper.hwpx").args[0],
    "/"
  );
});

test("resolved reveal paths must be absolute for their platform", () => {
  assert.throws(
    () => buildOutputRevealRequest("windows", "Vault\\paper.hwpx"),
    /absolute/
  );
  assert.throws(
    () => buildOutputRevealRequest("windows", "\\\\?\\C:\\Vault\\paper.hwpx"),
    /absolute/
  );
  assert.throws(
    () => buildOutputRevealRequest("macos", "Vault/paper.hwpx"),
    /absolute/
  );
  assert.throws(
    () => buildOutputRevealRequest("linux", "/home/name/../paper.hwpx"),
    /absolute/
  );
});

test("reveal execution requires both opaque output and UI action tokens", async () => {
  const requests: ProcessRequest[] = [];
  const runner = async (
    request: ProcessRequest,
    _action: UserInitiatedAction
  ): Promise<{ stdout: Uint8Array; stderr: string }> => {
    requests.push(request);
    return { stdout: new Uint8Array(), stderr: "" };
  };
  const trusted = trustSavedVaultOutput({
    status: "saved",
    vaultPath: "Exports/paper.hwpx"
  });
  assert.ok(trusted);

  await revealVaultOutputUserInitiated(
    {
      output: trusted,
      platform: "windows",
      resolveVaultPath: (path) => `C:\\Vault\\${path.replace(/\//g, "\\")}`,
      processRunner: runner
    },
    createUserInitiatedAction("modal")
  );
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].args, [
    "/select,",
    "C:\\Vault\\Exports\\paper.hwpx"
  ]);

  await assert.rejects(
    revealVaultOutputUserInitiated(
      {
        output: trusted,
        platform: "windows",
        resolveVaultPath: () => "relative\\paper.hwpx",
        processRunner: runner
      },
      createUserInitiatedAction("modal")
    ),
    /absolute/
  );
  assert.equal(requests.length, 1);

  await assert.rejects(
    revealVaultOutputUserInitiated(
      {
        output: trusted,
        platform: "windows",
        resolveVaultPath: () => "C:\\Vault\\paper.hwpx",
        processRunner: runner
      },
      {
        source: "modal",
        createdAt: Date.now()
      } as UserInitiatedAction
    ),
    /explicit user action/
  );

  await assert.rejects(
    revealVaultOutputUserInitiated(
      {
        output: {
          method: "vault",
          vaultPath: "Exports/paper.hwpx"
        },
        platform: "windows",
        resolveVaultPath: () => "C:\\Vault\\paper.hwpx",
        processRunner: runner
      },
      createUserInitiatedAction("modal")
    ),
    /newly saved/
  );
  assert.equal(requests.length, 1);
});
