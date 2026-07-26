# CMDS Eagle image upload bridge v1

HanMark can use CMDS Eagle as the actual uploader without reading another
plugin's settings, API key, or internal plugin object. The preferred contract
uses two Obsidian workspace events.

## Capability discovery

Event: `cmds-eagle:capabilities:v1`

```ts
interface CapabilitiesRequestV1 {
  version: 1;
  respond(response: {
    version: 1;
    canUploadImage: true;
  }): void;
}
```

CMDS Eagle should call `respond` synchronously or shortly after receiving the
event. HanMark treats no response as “bridge unavailable” and continues to its
compatibility path.

## Upload

Event: `cmds-eagle:upload-image:v1`

```ts
interface UploadImageRequestV1 {
  version: 1;
  image: {
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  };
  respond(response:
    | { version: 1; ok: true; publicUrl: string }
    | { version: 1; ok: false; error?: string }
  ): void;
}
```

CMDS Eagle chooses its active provider and credentials, performs the upload,
and returns only an HTTPS public URL. HanMark replaces the exact staged local
image reference only after validating the response.

The responder must call `respond` only after it knows whether the remote side
effect completed. Once HanMark dispatches an upload event, it will not
automatically cascade an unresolved image into another uploader: a timeout or
failed local rewrite could otherwise duplicate an object that was already
created remotely.

## Compatibility with CMDS Eagle 1.7

Until the public events are implemented, HanMark activates the newly imported
note and invokes the registered command:

`cmds-eagle:convert-all-to-cloud`

Staged links use ASCII-only Vault-root paths in ordinary Markdown image syntax,
which fits the current command's parser. HanMark creates a disposable note that
contains each unique source exactly once, invokes CMDS only on that note, and
polls it until the requested sources have become HTTPS URLs. Verified
replacements are then token-patched into a fresh read of the imported Markdown;
CMDS never rewrites the document body. Immediately before dispatch, HanMark
verifies that the disposable note is still active because the CMDS Eagle command
resolves its target at execution time. A completed or undispatched staging note
is removed; a timeout or partial command result is retained so a late CMDS write
cannot touch the imported note and its result remains recoverable. HanMark does
not inspect CMDS Eagle's `data.json` or use `app.plugins`.

If the command cannot be dispatched, HanMark can optionally use the same
Cloudflare Worker upload contract with URLs entered in HanMark settings. The
API key is requested at runtime, retained only for the current Obsidian
session after a successful authenticated upload, and never persisted by
HanMark. A 401 or 403 response clears the in-memory value so a corrected key
can be entered on the next attempt.
