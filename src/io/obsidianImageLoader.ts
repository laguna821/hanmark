import { App, TFile, normalizePath, requestUrl } from "obsidian";
import type { ImageLoader, LoadedImage } from "./imageAssets";

const MAX_CACHE_BYTES = 96 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const cache = new Map<string, LoadedImage>();
const inflight = new Map<string, Promise<LoadedImage>>();
let cacheBytes = 0;

function byteLength(value: LoadedImage): number {
  return value.data instanceof Uint8Array ? value.data.byteLength : value.data.byteLength;
}

function cacheGet(key: string): LoadedImage | undefined {
  const value = cache.get(key);
  if (!value) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function cacheSet(key: string, value: LoadedImage): void {
  const bytes = byteLength(value);
  if (bytes > MAX_CACHE_BYTES) return;
  const previous = cache.get(key);
  if (previous) cacheBytes -= byteLength(previous);
  cache.delete(key);
  cache.set(key, value);
  cacheBytes += bytes;
  while (cacheBytes > MAX_CACHE_BYTES && cache.size > 1) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    const removed = cache.get(oldest);
    cache.delete(oldest);
    if (removed) cacheBytes -= byteLength(removed);
  }
}

async function cachedLoad(key: string, load: () => Promise<LoadedImage>): Promise<LoadedImage> {
  const cached = cacheGet(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending !== undefined) return pending;
  const promise = load()
    .then((value) => {
      cacheSet(key, value);
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

function header(headers: Record<string, string>, name: string): string | undefined {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found?.[1];
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new Error(`이미지 요청 시간이 ${Math.round(ms / 1000)}초를 넘었습니다.`)), ms);
      })
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

function decodeDataUri(source: string): LoadedImage {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(source);
  if (!match) throw new Error("잘못된 data URI 이미지입니다.");
  const bytes = match[2]
    ? Uint8Array.from(Buffer.from(match[3], "base64"))
    : Uint8Array.from(Buffer.from(decodeURIComponent(match[3]), "utf8"));
  return { data: bytes, contentType: match[1] || undefined };
}

function cleanLocalSource(source: string): string {
  let value = source.trim().replace(/^<|>$/g, "");
  try {
    value = decodeURI(value);
  } catch {
    /* keep the literal path */
  }
  return normalizePath(value.replace(/^\.\//, ""));
}

/** Obsidian-aware binary loader for remote URLs, data URIs, and Vault attachments. */
export function createObsidianImageLoader(app: App, sourceFile: TFile): ImageLoader {
  return async (source: string): Promise<LoadedImage> => {
    if (/^data:/i.test(source)) return cachedLoad(`data:${source}`, async () => decodeDataUri(source));
    if (/^https?:\/\//i.test(source)) {
      return cachedLoad(`remote:${source}`, async () => {
        const response = await withTimeout(requestUrl({ url: source, method: "GET", throw: false }), REQUEST_TIMEOUT_MS);
        if (response.status < 200 || response.status >= 300) throw new Error(`원격 이미지 요청 실패: HTTP ${response.status}`);
        return {
          data: new Uint8Array(response.arrayBuffer),
          contentType: header(response.headers, "content-type")
        };
      });
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(source)) throw new Error("HTTP·HTTPS·data 이외의 이미지 URL은 지원하지 않습니다.");

    const path = cleanLocalSource(source);
    const file = app.metadataCache.getFirstLinkpathDest(path, sourceFile.path) ?? app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Vault 이미지 파일을 찾을 수 없습니다: ${path}`);
    const key = `vault:${file.path}:${file.stat.mtime}:${file.stat.size}`;
    return cachedLoad(key, async () => ({ data: await app.vault.readBinary(file) }));
  };
}

export function clearImageMemoryCache(): void {
  cache.clear();
  inflight.clear();
  cacheBytes = 0;
}
