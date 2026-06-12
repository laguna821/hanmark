import { createHash } from "node:crypto";

/** SHA-256 hex digest of raw bytes (used for the frontmatter source-hash contract). */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
