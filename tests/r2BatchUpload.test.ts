import assert from "node:assert/strict";
import { test } from "node:test";
import {
  uploadBatchWithSingleAuthenticationRefresh
} from "../src/io/r2BatchUpload";

class AuthFailure extends Error {}

test("authentication failure prompts once and retries the same item", async () => {
  const attempts: string[] = [];
  const cached: string[] = [];
  let cleared = 0;
  let replacementRequests = 0;
  const result = await uploadBatchWithSingleAuthenticationRefresh(
    ["first", "second"],
    {
      requestInitialKey: async () => "wrong",
      requestReplacementKey: async () => {
        replacementRequests += 1;
        return "correct";
      },
      upload: async (item, key) => {
        attempts.push(`${item}:${key}`);
        if (key === "wrong") throw new AuthFailure();
        return `https://cdn.example/${item}.png`;
      },
      isAuthenticationFailure: (error) => error instanceof AuthFailure,
      cacheAuthenticatedKey: (key) => cached.push(key),
      clearRejectedKey: () => {
        cleared += 1;
      }
    }
  );

  assert.deepEqual(attempts, [
    "first:wrong",
    "first:correct",
    "second:correct"
  ]);
  assert.equal(replacementRequests, 1);
  assert.equal(cleared, 1);
  assert.deepEqual(cached, ["correct", "correct"]);
  assert.equal(result.authenticationRefreshes, 1);
  assert.equal(result.stoppedAfterAuthenticationFailure, false);
  assert.deepEqual(
    result.successes.map(({ item }) => item),
    ["first", "second"]
  );
});

test("a rejected replacement key stops the batch without a prompt loop", async () => {
  const attempts: string[] = [];
  let replacementRequests = 0;
  const result = await uploadBatchWithSingleAuthenticationRefresh(
    ["first", "second", "third"],
    {
      requestInitialKey: async () => "wrong-1",
      requestReplacementKey: async () => {
        replacementRequests += 1;
        return "wrong-2";
      },
      upload: async (item, key) => {
        attempts.push(`${item}:${key}`);
        throw new AuthFailure();
      },
      isAuthenticationFailure: (error) => error instanceof AuthFailure,
      cacheAuthenticatedKey: () => assert.fail("rejected keys are never cached"),
      clearRejectedKey: () => undefined
    }
  );

  assert.deepEqual(attempts, ["first:wrong-1", "first:wrong-2"]);
  assert.equal(replacementRequests, 1);
  assert.equal(result.authenticationRefreshes, 1);
  assert.equal(result.stoppedAfterAuthenticationFailure, true);
  assert.deepEqual(result.failures, [{
    item: "first",
    kind: "authentication"
  }]);
});

test("non-authentication failures do not stop independent candidates", async () => {
  const result = await uploadBatchWithSingleAuthenticationRefresh(
    ["bad", "good"],
    {
      requestInitialKey: async () => "valid",
      requestReplacementKey: async () =>
        assert.fail("non-authentication errors must not ask for another key"),
      upload: async (item) => {
        if (item === "bad") throw new Error("network");
        return "https://cdn.example/good.png";
      },
      isAuthenticationFailure: (error) => error instanceof AuthFailure,
      cacheAuthenticatedKey: () => undefined,
      clearRejectedKey: () => undefined
    }
  );

  assert.deepEqual(result.failures, [{ item: "bad", kind: "upload" }]);
  assert.deepEqual(result.successes, [{
    item: "good",
    remoteUrl: "https://cdn.example/good.png"
  }]);
});
