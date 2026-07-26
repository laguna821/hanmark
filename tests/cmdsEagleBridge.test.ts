import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bridgeActiveNoteImagesThroughCmdsEagle,
  buildCmdsEagleStagingMarkdown,
  CMDS_EAGLE_CAPABILITIES_EVENT,
  CMDS_EAGLE_CONVERT_COMMAND,
  CMDS_EAGLE_UPLOAD_IMAGE_EVENT,
  type CmdsEagleBridgeDependencies,
  type CmdsEagleCapabilitiesRequestV1,
  type CmdsEagleUploadImageRequestV1
} from "../src/io/cmdsEagleBridge";

test("command staging markdown includes each local source only once", () => {
  const markdown = buildCmdsEagleStagingMarkdown([
    image("HanMark-Imported-Images/one.png"),
    image("HanMark-Imported-Images/one.png"),
    image("HanMark-Imported-Images/two.bmp", "bmp")
  ]);

  assert.equal(
    markdown,
    [
      "![HanMark imported image 1](HanMark-Imported-Images/one.png)",
      "![HanMark imported image 2](HanMark-Imported-Images/two.bmp)"
    ].join("\n")
  );
});

function image(localSource: string, suffix = "png") {
  return {
    localSource,
    fileName: `imported.${suffix}`,
    mimeType: `image/${suffix}`,
    bytes: new Uint8Array([1, 2, 3])
  };
}

function capabilitiesRequest(
  request: unknown
): CmdsEagleCapabilitiesRequestV1 {
  assert.equal(typeof request, "object");
  assert.ok(request);
  assert.equal("version" in request, true);
  assert.equal("respond" in request, true);
  return request as CmdsEagleCapabilitiesRequestV1;
}

function uploadRequest(request: unknown): CmdsEagleUploadImageRequestV1 {
  assert.equal(typeof request, "object");
  assert.ok(request);
  assert.equal("version" in request, true);
  assert.equal("image" in request, true);
  assert.equal("respond" in request, true);
  return request as CmdsEagleUploadImageRequestV1;
}

function fakeDependencies(
  overrides: Partial<CmdsEagleBridgeDependencies> = {}
): CmdsEagleBridgeDependencies {
  let markdown = "![figure](attachments/imported.png)";
  const timers = new Set<ReturnType<typeof setTimeout>>();
  return {
    triggerWorkspaceEvent: () => undefined,
    executeCommandById: () => false,
    readActiveNote: async () => markdown,
    writeActiveNote: async (next) => {
      markdown = next;
    },
    scheduleTimeout: (callback, milliseconds) => {
      const handle = setTimeout(() => {
        timers.delete(handle);
        callback();
      }, milliseconds);
      timers.add(handle);
      return handle;
    },
    cancelTimeout: (handle) => {
      const timer = handle as ReturnType<typeof setTimeout>;
      clearTimeout(timer);
      timers.delete(timer);
    },
    ...overrides
  };
}

test("public workspace-event bridge is preferred and rewrites the active note", async () => {
  let markdown = "before\n![figure](attachments/imported.png)\nafter";
  const events: string[] = [];
  let commandCalls = 0;
  const dependencies = fakeDependencies({
    triggerWorkspaceEvent: (eventName, request) => {
      events.push(eventName);
      if (eventName === CMDS_EAGLE_CAPABILITIES_EVENT) {
        capabilitiesRequest(request).respond({
          version: 1,
          canUploadImage: true
        });
      } else if (eventName === CMDS_EAGLE_UPLOAD_IMAGE_EVENT) {
        const upload = uploadRequest(request);
        assert.deepEqual(
          [...upload.image.bytes],
          [1, 2, 3]
        );
        upload.respond({
          version: 1,
          ok: true,
          publicUrl: "https://cdn.example/imported.png"
        });
      }
    },
    executeCommandById: () => {
      commandCalls += 1;
      return true;
    },
    readActiveNote: async () => markdown,
    writeActiveNote: async (next) => {
      markdown = next;
    }
  });

  const result = await bridgeActiveNoteImagesThroughCmdsEagle(
    dependencies,
    [image("attachments/imported.png")],
    { capabilityTimeoutMs: 10, uploadTimeoutMs: 10 }
  );

  assert.equal(result.status, "success");
  assert.equal(result.via, "workspace-event");
  assert.equal(result.eventResponderFound, true);
  assert.equal(result.eventUploadAttempted, true);
  assert.equal(result.commandDispatched, false);
  assert.equal(commandCalls, 0);
  assert.deepEqual(events, [
    CMDS_EAGLE_CAPABILITIES_EVENT,
    CMDS_EAGLE_UPLOAD_IMAGE_EVENT
  ]);
  assert.equal(
    markdown,
    "before\n![figure](https://cdn.example/imported.png)\nafter"
  );
  assert.deepEqual(result.replacements, [{
    localSource: "attachments/imported.png",
    remoteUrl: "https://cdn.example/imported.png"
  }]);
});

test("current CMDS Eagle command is used when no event responder exists", async () => {
  let markdown = [
    "![first](hanmark-import/image-1.png)",
    "text",
    "![second](hanmark-import/image-2.bmp)"
  ].join("\n");
  let commandId = "";
  const dependencies = fakeDependencies({
    executeCommandById: (id) => {
      commandId = id;
      queueMicrotask(() => {
        markdown = markdown
          .replace(
            "hanmark-import/image-1.png",
            "https://r2.example/image-1.png"
          )
          .replace(
            "hanmark-import/image-2.bmp",
            "https://r2.example/image-2.bmp"
          );
      });
      return true;
    },
    readActiveNote: async () => markdown
  });

  const result = await bridgeActiveNoteImagesThroughCmdsEagle(
    dependencies,
    [
      image("hanmark-import/image-1.png"),
      image("hanmark-import/image-2.bmp", "bmp")
    ],
    {
      capabilityTimeoutMs: 1,
      commandTimeoutMs: 100,
      pollIntervalMs: 1
    }
  );

  assert.equal(commandId, CMDS_EAGLE_CONVERT_COMMAND);
  assert.equal(result.status, "success");
  assert.equal(result.via, "command");
  assert.equal(result.eventResponderFound, false);
  assert.equal(result.commandDispatched, true);
  assert.deepEqual(result.unresolvedSources, []);
  assert.deepEqual(result.replacements, [
    {
      localSource: "hanmark-import/image-1.png",
      remoteUrl: "https://r2.example/image-1.png"
    },
    {
      localSource: "hanmark-import/image-2.bmp",
      remoteUrl: "https://r2.example/image-2.bmp"
    }
  ]);
});

test("command success is not trusted until every requested URL is remote", async () => {
  let markdown = [
    "![first](hanmark-import/image-1.png)",
    "![second](hanmark-import/image-2.png)"
  ].join("\n");
  const dependencies = fakeDependencies({
    executeCommandById: () => {
      markdown = markdown.replace(
        "hanmark-import/image-1.png",
        "https://r2.example/image-1.png"
      );
      return true;
    },
    readActiveNote: async () => markdown
  });

  const result = await bridgeActiveNoteImagesThroughCmdsEagle(
    dependencies,
    [
      image("hanmark-import/image-1.png"),
      image("hanmark-import/image-2.png")
    ],
    {
      capabilityTimeoutMs: 1,
      commandTimeoutMs: 0,
      pollIntervalMs: 1
    }
  );

  assert.equal(result.status, "partial");
  assert.equal(result.via, "command");
  assert.deepEqual(result.replacements, [{
    localSource: "hanmark-import/image-1.png",
    remoteUrl: "https://r2.example/image-1.png"
  }]);
  assert.deepEqual(result.unresolvedSources, [
    "hanmark-import/image-2.png"
  ]);
  assert.ok(result.issues.includes("command-timeout"));
});

test("missing event responder and missing command returns unavailable", async () => {
  const dependencies = fakeDependencies();
  const result = await bridgeActiveNoteImagesThroughCmdsEagle(
    dependencies,
    [image("attachments/imported.png")],
    {
      capabilityTimeoutMs: 1,
      commandTimeoutMs: 0
    }
  );

  assert.equal(result.status, "unavailable");
  assert.equal(result.via, "none");
  assert.equal(result.commandDispatched, false);
  assert.deepEqual(result.unresolvedSources, [
    "attachments/imported.png"
  ]);
  assert.ok(result.issues.includes("command-unavailable"));
});

test("invalid event URLs are rejected without risking a duplicate command upload", async () => {
  let markdown = "![figure](attachments/imported.png)";
  let commandCalls = 0;
  const dependencies = fakeDependencies({
    triggerWorkspaceEvent: (eventName, request) => {
      if (eventName === CMDS_EAGLE_CAPABILITIES_EVENT) {
        capabilitiesRequest(request).respond({
          version: 1,
          capabilities: ["upload-image"]
        });
      } else {
        uploadRequest(request).respond({
          version: 1,
          ok: true,
          url: "javascript:alert(1)"
        });
      }
    },
    executeCommandById: () => {
      commandCalls += 1;
      markdown = markdown.replace(
        "attachments/imported.png",
        "https://safe.example/imported.png"
      );
      return true;
    },
    readActiveNote: async () => markdown
  });

  const result = await bridgeActiveNoteImagesThroughCmdsEagle(
    dependencies,
    [image("attachments/imported.png")],
    {
      capabilityTimeoutMs: 10,
      uploadTimeoutMs: 10,
      commandTimeoutMs: 10,
      pollIntervalMs: 1
    }
  );

  assert.equal(result.status, "partial");
  assert.equal(result.via, "none");
  assert.equal(result.eventResponderFound, true);
  assert.equal(result.eventUploadAttempted, true);
  assert.equal(result.commandDispatched, false);
  assert.equal(commandCalls, 0);
  assert.deepEqual(result.replacements, []);
  assert.ok(result.issues.includes("event-upload-failed"));
});

test("event upload cannot report success when the active note write fails", async () => {
  let commandCalls = 0;
  const dependencies = fakeDependencies({
    triggerWorkspaceEvent: (eventName, request) => {
      if (eventName === CMDS_EAGLE_CAPABILITIES_EVENT) {
        capabilitiesRequest(request).respond({
          version: 1,
          canUploadImage: true
        });
      } else {
        uploadRequest(request).respond({
          version: 1,
          ok: true,
          url: "https://cdn.example/imported.png"
        });
      }
    },
    writeActiveNote: async () => {
      throw new Error("simulated write failure");
    },
    executeCommandById: () => {
      commandCalls += 1;
      return true;
    }
  });

  const result = await bridgeActiveNoteImagesThroughCmdsEagle(
    dependencies,
    [image("attachments/imported.png")],
    {
      allowCommandFallback: true,
      capabilityTimeoutMs: 10,
      uploadTimeoutMs: 10
    }
  );

  assert.equal(result.status, "partial");
  assert.deepEqual(result.replacements, []);
  assert.deepEqual(result.unresolvedSources, [
    "attachments/imported.png"
  ]);
  assert.ok(result.issues.includes("note-write-failed"));
  assert.equal(result.eventUploadAttempted, true);
  assert.equal(result.commandDispatched, false);
  assert.equal(commandCalls, 0);
});

test("AbortSignal stops waiting without dispatching the command", async () => {
  const controller = new AbortController();
  const dependencies = fakeDependencies({
    triggerWorkspaceEvent: (_eventName, _request) => {
      controller.abort();
    },
    executeCommandById: () => {
      assert.fail("command must not be dispatched after cancellation");
    }
  });

  const result = await bridgeActiveNoteImagesThroughCmdsEagle(
    dependencies,
    [image("attachments/imported.png")],
    {
      signal: controller.signal,
      capabilityTimeoutMs: 100
    }
  );

  assert.equal(result.status, "partial");
  assert.equal(result.commandDispatched, false);
  assert.ok(result.issues.includes("cancelled"));
});
