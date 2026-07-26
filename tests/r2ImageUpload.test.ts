import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  R2_MAX_IMAGE_BYTES,
  R2UploadError,
  uploadImageToR2,
  type RequestUrlCompatibleRequest
} from "../src/io/r2ImageUpload";

function part(body: Uint8Array, boundary: string): string {
  return Buffer.from(body).toString("utf8").replace(/\u0001\u0002\u0003\u0004/u, "<IMAGE>");
}

describe("CMDS Eagle-compatible R2 direct fallback", () => {
  it("builds a deterministic multipart request and returns the public object URL", async () => {
    const requests: RequestUrlCompatibleRequest[] = [];
    const upload = {
      data: Uint8Array.from([1, 2, 3, 4]),
      filename: "한글 화면 (1).png",
      contentType: "image/png"
    };
    const requester = async (request: RequestUrlCompatibleRequest) => {
      requests.push(request);
      return {
        status: 201,
        text: JSON.stringify({
          key: "imports/한글 화면 (1).png",
          filename: upload.filename
        })
      };
    };

    const config = {
      workerUrl: "https://worker.example/api/",
      publicUrl: "https://cdn.example/public/",
      apiKey: "secret-for-test"
    };
    const first = await uploadImageToR2(requester, config, upload);
    const second = await uploadImageToR2(requester, config, upload);

    assert.deepEqual(first, {
      key: "imports/한글 화면 (1).png",
      filename: "한글 화면 (1).png",
      publicUrl:
        "https://cdn.example/public/imports/%ED%95%9C%EA%B8%80%20%ED%99%94%EB%A9%B4%20(1).png",
      byteLength: 4
    });
    assert.deepEqual(second, first);
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.url, "https://worker.example/api/upload");
    assert.equal(requests[0]?.method, "POST");
    assert.equal(requests[0]?.throw, false);
    assert.deepEqual(requests[0]?.headers, {
      Authorization: "Bearer secret-for-test"
    });

    const contentType = requests[0]?.contentType ?? "";
    const boundary = /^multipart\/form-data; boundary=(.+)$/u.exec(contentType)?.[1];
    assert.ok(boundary);
    assert.equal(requests[1]?.contentType, contentType);
    assert.deepEqual(
      Buffer.from(requests[1]?.body ?? new ArrayBuffer(0)),
      Buffer.from(requests[0]?.body ?? new ArrayBuffer(0))
    );

    const multipart = part(
      new Uint8Array(requests[0]?.body ?? new ArrayBuffer(0)),
      boundary
    );
    assert.match(
      multipart,
      new RegExp(
        `^--${boundary}\\r\\n` +
          'Content-Disposition: form-data; name="file"; filename="한글 화면 \\(1\\)\\.png"\\r\\n' +
          "Content-Type: image/png\\r\\n\\r\\n<IMAGE>\\r\\n",
        "u"
      )
    );
    assert.match(
      multipart,
      /Content-Disposition: form-data; name="filename"\r\n\r\n한글 화면 \(1\)\.png\r\n/u
    );
    assert.match(
      multipart,
      /Content-Disposition: form-data; name="content_type"\r\n\r\nimage\/png\r\n/u
    );
    assert.match(multipart, new RegExp(`--${boundary}--\\r\\n$`, "u"));
  });

  it("rejects unsafe configuration, content, and oversized input before requesting", async () => {
    let calls = 0;
    const requester = async (_request: RequestUrlCompatibleRequest) => {
      calls++;
      return { status: 200, text: '{"key":"ok.png"}' };
    };
    const base = {
      workerUrl: "https://worker.example",
      publicUrl: "https://cdn.example",
      apiKey: "secret"
    };
    const image = {
      data: Uint8Array.from([1]),
      filename: "safe.png",
      contentType: "image/png"
    };

    const cases = [
      {
        config: { ...base, workerUrl: "http://worker.example" },
        image,
        code: "invalid-worker-url"
      },
      {
        config: { ...base, publicUrl: "https://user:pass@cdn.example" },
        image,
        code: "invalid-public-url"
      },
      {
        config: { ...base, apiKey: "bad\nsecret" },
        image,
        code: "invalid-api-key"
      },
      {
        config: base,
        image: { ...image, filename: "../unsafe.png" },
        code: "invalid-filename"
      },
      {
        config: base,
        image: { ...image, contentType: "image/svg+xml" },
        code: "unsupported-content-type"
      },
      {
        config: base,
        image: { ...image, data: new Uint8Array() },
        code: "empty-file"
      },
      {
        config: base,
        image: { ...image, data: new Uint8Array(R2_MAX_IMAGE_BYTES + 1) },
        code: "file-too-large"
      }
    ] as const;

    for (const current of cases) {
      await assert.rejects(
        uploadImageToR2(requester, current.config, current.image),
        (error: unknown) => {
          assert.ok(error instanceof R2UploadError);
          assert.equal(error.code, current.code);
          return true;
        }
      );
    }
    assert.equal(calls, 0);
  });

  it("returns structured HTTP, network, and response errors without exposing the API key", async () => {
    const config = {
      workerUrl: "https://worker.example",
      publicUrl: "https://cdn.example",
      apiKey: "TOP-SECRET-API-KEY"
    };
    const image = {
      data: Uint8Array.from([1, 2, 3]),
      filename: "image.bmp",
      contentType: "image/bmp"
    };

    await assert.rejects(
      uploadImageToR2(async () => ({ status: 503, text: config.apiKey }), config, image),
      (error: unknown) => {
        assert.ok(error instanceof R2UploadError);
        assert.equal(error.code, "http-error");
        assert.equal(error.status, 503);
        assert.equal(error.retryable, true);
        assert.doesNotMatch(error.message, new RegExp(config.apiKey, "u"));
        return true;
      }
    );

    await assert.rejects(
      uploadImageToR2(
        async () => {
          throw new Error(`request failed: Authorization Bearer ${config.apiKey}`);
        },
        config,
        image
      ),
      (error: unknown) => {
        assert.ok(error instanceof R2UploadError);
        assert.equal(error.code, "network-error");
        assert.equal(error.retryable, true);
        assert.doesNotMatch(error.message, new RegExp(config.apiKey, "u"));
        assert.equal("cause" in error, false);
        return true;
      }
    );

    for (const response of [
      { status: 200, text: "not json" },
      { status: 200, text: "{}" },
      { status: 200, text: '{"key":"../escape.png"}' },
      { status: 200, text: '{"key":"https://evil.example/image.png"}' },
      { status: 200, text: '{"key":"safe.png","filename":"../unsafe.png"}' }
    ]) {
      await assert.rejects(
        uploadImageToR2(async () => response, config, image),
        (error: unknown) => {
          assert.ok(error instanceof R2UploadError);
          assert.equal(error.code, "invalid-response");
          assert.doesNotMatch(error.message, new RegExp(config.apiKey, "u"));
          return true;
        }
      );
    }
  });
});
