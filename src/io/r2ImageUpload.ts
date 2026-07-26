export const R2_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_API_KEY_LENGTH = 4_096;
const MAX_FILENAME_BYTES = 255;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_KEY_BYTES = 2_048;

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/x-ms-bmp"
]);

export interface RequestUrlCompatibleRequest {
  url: string;
  method: string;
  contentType: string;
  body: ArrayBuffer;
  headers: Record<string, string>;
  throw: boolean;
}

export interface RequestUrlCompatibleResponse {
  status: number;
  text: string;
}

/**
 * This deliberately matches the public subset of Obsidian's `requestUrl`.
 * Keeping it injected makes the uploader testable and prevents a Node/Electron
 * networking fallback from being introduced accidentally.
 */
export type RequestUrlCompatible = (
  request: RequestUrlCompatibleRequest
) => PromiseLike<RequestUrlCompatibleResponse>;

export interface R2UploadConfig {
  workerUrl: string;
  publicUrl: string;
  apiKey: string;
}

export interface R2ImageUpload {
  data: Uint8Array | ArrayBuffer;
  filename: string;
  contentType: string;
}

export interface R2UploadResult {
  key: string;
  filename: string;
  publicUrl: string;
  byteLength: number;
}

export type R2UploadErrorCode =
  | "invalid-worker-url"
  | "invalid-public-url"
  | "invalid-api-key"
  | "invalid-filename"
  | "unsupported-content-type"
  | "empty-file"
  | "file-too-large"
  | "network-error"
  | "http-error"
  | "response-too-large"
  | "invalid-response";

export class R2UploadError extends Error {
  constructor(
    public readonly code: R2UploadErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "R2UploadError";
  }
}

interface ValidatedUpload {
  workerEndpoint: string;
  publicBase: URL;
  apiKey: string;
  filename: string;
  contentType: string;
  data: Uint8Array;
}

interface ParsedWorkerResponse {
  key: string;
  filename: string;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function validateHttpsUrl(
  raw: string,
  code: "invalid-worker-url" | "invalid-public-url",
  label: string
): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new R2UploadError(code, `${label}은(는) 올바른 HTTPS URL이어야 합니다.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new R2UploadError(code, `${label}은(는) 쿼리·인증정보가 없는 HTTPS URL이어야 합니다.`);
  }
  return parsed;
}

function workerUploadEndpoint(workerUrl: string): string {
  const parsed = validateHttpsUrl(workerUrl, "invalid-worker-url", "Worker URL");
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}/upload`;
  return parsed.href;
}

function publicBaseUrl(publicUrl: string): URL {
  const parsed = validateHttpsUrl(publicUrl, "invalid-public-url", "Public URL");
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}/`;
  return parsed;
}

function validateApiKey(apiKey: string): string {
  if (
    apiKey.length === 0 ||
    apiKey.length > MAX_API_KEY_LENGTH ||
    hasAsciiControl(apiKey)
  ) {
    throw new R2UploadError("invalid-api-key", "Cloudflare R2 API 키가 없거나 올바르지 않습니다.");
  }
  return apiKey;
}

function validateFilename(filename: string): string {
  const value = filename.normalize("NFC").trim();
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    utf8Length(value) > MAX_FILENAME_BYTES ||
    value.includes("/") ||
    value.includes("\\") ||
    hasAsciiControl(value)
  ) {
    throw new R2UploadError("invalid-filename", "업로드 파일 이름이 없거나 안전하지 않습니다.");
  }
  return value;
}

function validateContentType(contentType: string): string {
  const value = contentType.trim().toLowerCase();
  if (!SUPPORTED_IMAGE_TYPES.has(value)) {
    throw new R2UploadError(
      "unsupported-content-type",
      "R2 직접 업로드는 PNG, JPEG, GIF, BMP 이미지만 지원합니다."
    );
  }
  return value;
}

function validateData(data: Uint8Array | ArrayBuffer): Uint8Array {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength === 0) {
    throw new R2UploadError("empty-file", "빈 이미지는 업로드할 수 없습니다.");
  }
  if (bytes.byteLength > R2_MAX_IMAGE_BYTES) {
    throw new R2UploadError(
      "file-too-large",
      `이미지는 ${Math.round(R2_MAX_IMAGE_BYTES / 1024 / 1024)}MB 이하여야 합니다.`
    );
  }
  return bytes;
}

function validateUpload(config: R2UploadConfig, image: R2ImageUpload): ValidatedUpload {
  return {
    workerEndpoint: workerUploadEndpoint(config.workerUrl),
    publicBase: publicBaseUrl(config.publicUrl),
    apiKey: validateApiKey(config.apiKey),
    filename: validateFilename(image.filename),
    contentType: validateContentType(image.contentType),
    data: validateData(image.data)
  };
}

function updateHash(hash: number, bytes: Uint8Array): number {
  let value = hash;
  for (let index = 0; index < bytes.byteLength; index++) {
    value ^= bytes[index] ?? 0;
    value = Math.imul(value, 16_777_619);
  }
  return value >>> 0;
}

function containsSequence(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) return false;
  const lastStart = haystack.byteLength - needle.byteLength;
  for (let start = 0; start <= lastStart; start++) {
    if (haystack[start] !== needle[0]) continue;
    let matched = true;
    for (let offset = 1; offset < needle.byteLength; offset++) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function multipartBoundary(filename: string, contentType: string, data: Uint8Array): string {
  const encoder = new TextEncoder();
  let hash = updateHash(2_166_136_261, encoder.encode(`${filename}\u0000${contentType}\u0000`));
  hash = updateHash(hash, data);
  const base = `----HanMarkR2-${hash.toString(16).padStart(8, "0")}-${data.byteLength.toString(16)}`;
  let boundary = base;
  let suffix = 0;
  while (containsSequence(data, encoder.encode(boundary))) {
    suffix++;
    boundary = `${base}-${suffix}`;
  }
  return boundary;
}

function quotedFilename(filename: string): string {
  return filename.replace(/%/gu, "%25").replace(/"/gu, "%22");
}

function concatenate(chunks: Uint8Array[]): ArrayBuffer {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

function multipartBody(upload: ValidatedUpload, boundary: string): ArrayBuffer {
  const encoder = new TextEncoder();
  const text = (value: string): Uint8Array => encoder.encode(value);
  return concatenate([
    text(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${quotedFilename(upload.filename)}"\r\n` +
        `Content-Type: ${upload.contentType}\r\n\r\n`
    ),
    upload.data,
    text(
      `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="filename"\r\n\r\n` +
        `${upload.filename}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="content_type"\r\n\r\n` +
        `${upload.contentType}\r\n` +
        `--${boundary}--\r\n`
    )
  ]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function validResponseFilename(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string") {
    throw new R2UploadError("invalid-response", "R2 Worker가 올바른 파일 이름을 반환하지 않았습니다.");
  }
  try {
    return validateFilename(value);
  } catch {
    throw new R2UploadError("invalid-response", "R2 Worker가 올바른 파일 이름을 반환하지 않았습니다.");
  }
}

function validateObjectKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new R2UploadError("invalid-response", "R2 Worker 응답에 객체 키가 없습니다.");
  }
  const key = value.normalize("NFC").trim();
  if (
    key.length === 0 ||
    utf8Length(key) > MAX_KEY_BYTES ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.includes("?") ||
    key.includes("#") ||
    hasAsciiControl(key)
  ) {
    throw new R2UploadError("invalid-response", "R2 Worker가 안전하지 않은 객체 키를 반환했습니다.");
  }
  for (const segment of key.split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new R2UploadError("invalid-response", "R2 Worker가 잘못 인코딩된 객체 키를 반환했습니다.");
    }
    if (decoded.length === 0 || decoded === "." || decoded === "..") {
      throw new R2UploadError("invalid-response", "R2 Worker가 안전하지 않은 객체 키를 반환했습니다.");
    }
  }
  return key;
}

function parseWorkerResponse(text: string, fallbackFilename: string): ParsedWorkerResponse {
  if (utf8Length(text) > MAX_RESPONSE_BYTES) {
    throw new R2UploadError("response-too-large", "R2 Worker 응답이 허용 크기를 초과했습니다.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new R2UploadError("invalid-response", "R2 Worker가 올바른 JSON 응답을 반환하지 않았습니다.");
  }
  const record = asRecord(value);
  if (!record) {
    throw new R2UploadError("invalid-response", "R2 Worker 응답 형식이 올바르지 않습니다.");
  }
  return {
    key: validateObjectKey(record.key),
    filename: validResponseFilename(record.filename, fallbackFilename)
  };
}

function publicUrlForKey(base: URL, key: string): string {
  const url = new URL(key, base);
  if (
    url.protocol !== "https:" ||
    url.origin !== base.origin ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    !url.pathname.startsWith(base.pathname)
  ) {
    throw new R2UploadError("invalid-response", "R2 객체의 공개 URL을 안전하게 만들 수 없습니다.");
  }
  return url.href;
}

function httpError(status: number): R2UploadError {
  const retryable = status === 408 || status === 429 || status >= 500;
  return new R2UploadError(
    "http-error",
    `R2 Worker 업로드에 실패했습니다 (HTTP ${status}).`,
    status,
    retryable
  );
}

/** Uploads one validated image through a CMDS Eagle-compatible R2 Worker. */
export async function uploadImageToR2(
  requester: RequestUrlCompatible,
  config: R2UploadConfig,
  image: R2ImageUpload
): Promise<R2UploadResult> {
  const upload = validateUpload(config, image);
  const boundary = multipartBoundary(upload.filename, upload.contentType, upload.data);
  let response: RequestUrlCompatibleResponse;
  try {
    response = await requester({
      url: upload.workerEndpoint,
      method: "POST",
      contentType: `multipart/form-data; boundary=${boundary}`,
      body: multipartBody(upload, boundary),
      headers: {
        Authorization: `Bearer ${upload.apiKey}`
      },
      throw: false
    });
  } catch {
    // Do not preserve or interpolate the network error: a transport can include
    // request headers, including the Bearer secret, in its own error message.
    throw new R2UploadError(
      "network-error",
      "R2 Worker에 연결하지 못했습니다.",
      undefined,
      true
    );
  }

  if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
    throw httpError(response.status);
  }
  if (typeof response.text !== "string") {
    throw new R2UploadError("invalid-response", "R2 Worker 응답 본문이 올바르지 않습니다.");
  }
  const parsed = parseWorkerResponse(response.text, upload.filename);
  return {
    key: parsed.key,
    filename: parsed.filename,
    publicUrl: publicUrlForKey(upload.publicBase, parsed.key),
    byteLength: upload.data.byteLength
  };
}
