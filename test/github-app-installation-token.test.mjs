import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import { GitHubApiError } from "../src/github/client.mjs";
import {
  GITHUB_APP_API_VERSION,
  GitHubInstallationTokenError,
  createInstallationTokenManager,
  normalizeInstallationTokenScope
} from "../src/control-plane/github-app/installation-token.mjs";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

function jsonResponse(payload, { status = 201, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers
    }
  });
}

function tokenResponse(token, expiresAt) {
  return jsonResponse({ token, expires_at: expiresAt });
}

function createManager({ fetchImpl, clock, refreshWindowMs = 5 * 60_000 } = {}) {
  return createInstallationTokenManager({
    clientId: "Iv1.repoops-client",
    privateKey,
    apiBaseUrl: "https://api.github.test",
    fetchImpl,
    clock,
    refreshWindowMs
  });
}

test("installation token scope is canonical and rejects unsafe scope shapes", () => {
  const scope = normalizeInstallationTokenScope({
    installationId: 42,
    repositoryIds: [9, 3, 7],
    permissions: { issues: "write", contents: "read" }
  });

  assert.deepEqual(scope, {
    installationId: 42,
    repositoryIds: [3, 7, 9],
    permissions: { contents: "read", issues: "write" }
  });
  assert.equal(Object.isFrozen(scope), true);
  assert.equal(Object.isFrozen(scope.repositoryIds), true);
  assert.equal(Object.isFrozen(scope.permissions), true);

  for (const input of [
    {},
    { installationId: 0 },
    { installationId: 1, repositoryIds: [] },
    { installationId: 1, repositoryIds: [2, 2] },
    { installationId: 1, permissions: {} },
    { installationId: 1, permissions: { Issues: "write" } },
    { installationId: 1, permissions: { issues: "admin" } }
  ]) {
    assert.throws(() => normalizeInstallationTokenScope(input), GitHubInstallationTokenError);
  }
});

test("installation token mint uses App JWT auth, current GitHub headers, and reduced scope body", async () => {
  const now = Date.parse("2026-09-29T07:00:00Z");
  let request;
  const manager = createManager({
    clock: () => now,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return tokenResponse(
        "ghs_stateless_token_shape_that_must_be_treated_as_opaque_and_not_fixed_length_1234567890",
        "2026-09-29T08:00:00Z"
      );
    }
  });

  const result = await manager.getToken({
    installationId: 99,
    repositoryIds: [30, 10],
    permissions: { issues: "write", contents: "read" }
  });

  assert.equal(request.url, "https://api.github.test/app/installations/99/access_tokens");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Accept, "application/vnd.github+json");
  assert.equal(request.options.headers["X-GitHub-Api-Version"], GITHUB_APP_API_VERSION);
  assert.equal(request.options.headers["User-Agent"], "RepoOps-GitHub-App");
  assert.match(request.options.headers.Authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/);
  assert.deepEqual(JSON.parse(request.options.body), {
    repository_ids: [10, 30],
    permissions: { contents: "read", issues: "write" }
  });
  assert.equal(result.token.startsWith("ghs_"), true);
  assert.equal(result.expiresAt, "2026-09-29T08:00:00.000Z");
  assert.deepEqual(result.repositoryIds, [10, 30]);
});

test("installation token cache reuses a token until the refresh safety window", async () => {
  let now = Date.parse("2026-09-29T07:00:00Z");
  let calls = 0;
  const manager = createManager({
    clock: () => now,
    refreshWindowMs: 5 * 60_000,
    fetchImpl: async () => {
      calls += 1;
      return tokenResponse(`token-${calls}`, new Date(now + 60 * 60_000).toISOString());
    }
  });

  const first = await manager.getToken({ installationId: 7 });
  now += 54 * 60_000;
  const reused = await manager.getToken({ installationId: 7 });
  assert.equal(reused, first);
  assert.equal(calls, 1);

  now += 2 * 60_000;
  const refreshed = await manager.getToken({ installationId: 7 });
  assert.equal(refreshed.token, "token-2");
  assert.equal(calls, 2);
});

test("concurrent cache misses for one scope share exactly one token mint", async () => {
  const now = Date.parse("2026-09-29T07:00:00Z");
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });

  const manager = createManager({
    clock: () => now,
    fetchImpl: async () => {
      calls += 1;
      await gate;
      return tokenResponse("shared-token", "2026-09-29T08:00:00Z");
    }
  });

  const firstPromise = manager.getToken({ installationId: 8, repositoryIds: [100] });
  const secondPromise = manager.getToken({ installationId: 8, repositoryIds: [100] });
  assert.equal(calls, 1);
  release();

  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(first, second);
  assert.equal(first.token, "shared-token");
  assert.equal(calls, 1);
});

test("different repository or permission scopes never share cache entries", async () => {
  const now = Date.parse("2026-09-29T07:00:00Z");
  let calls = 0;
  const manager = createManager({
    clock: () => now,
    fetchImpl: async () => {
      calls += 1;
      return tokenResponse(`scope-token-${calls}`, "2026-09-29T08:00:00Z");
    }
  });

  const first = await manager.getToken({ installationId: 9, repositoryIds: [1], permissions: { issues: "read" } });
  const sameCanonicalScope = await manager.getToken({ installationId: 9, repositoryIds: [1], permissions: { issues: "read" } });
  const otherRepo = await manager.getToken({ installationId: 9, repositoryIds: [2], permissions: { issues: "read" } });
  const otherPermission = await manager.getToken({ installationId: 9, repositoryIds: [1], permissions: { issues: "write" } });

  assert.equal(first, sameCanonicalScope);
  assert.notEqual(first.token, otherRepo.token);
  assert.notEqual(first.token, otherPermission.token);
  assert.equal(calls, 3);
});

test("failed token mint exposes safe GitHub metadata and does not poison the cache", async () => {
  const now = Date.parse("2026-09-29T07:00:00Z");
  let calls = 0;
  const manager = createManager({
    clock: () => now,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(
          { message: "secret response body that must not appear" },
          {
            status: 403,
            headers: {
              "retry-after": "12",
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": "1790650000",
              "x-github-request-id": "SAFE-REQUEST-ID"
            }
          }
        );
      }
      return tokenResponse("recovered-token", "2026-09-29T08:00:00Z");
    }
  });

  await assert.rejects(
    () => manager.getToken({ installationId: 10 }),
    (error) => {
      assert.equal(error instanceof GitHubApiError, true);
      assert.equal(error.status, 403);
      assert.equal(error.responseMessage, "");
      assert.equal(error.retryAfterSeconds, 12);
      assert.equal(error.rateLimitRemaining, 0);
      assert.equal(error.requestId, "SAFE-REQUEST-ID");
      assert.equal(error.message.includes("secret response body"), false);
      return true;
    }
  );

  const recovered = await manager.getToken({ installationId: 10 });
  assert.equal(recovered.token, "recovered-token");
  assert.equal(calls, 2);
});

test("malformed or already-expiring GitHub token responses fail closed", async () => {
  const now = Date.parse("2026-09-29T07:00:00Z");
  const responses = [
    jsonResponse({ token: "", expires_at: "2026-09-29T08:00:00Z" }),
    jsonResponse({ token: "token", expires_at: "not-a-date" }),
    tokenResponse("token", "2026-09-29T07:04:59Z")
  ];

  for (const response of responses) {
    const manager = createManager({ clock: () => now, fetchImpl: async () => response });
    await assert.rejects(() => manager.getToken({ installationId: 11 }), GitHubInstallationTokenError);
  }
});

test("installation invalidation clears cached tokens", async () => {
  const now = Date.parse("2026-09-29T07:00:00Z");
  let calls = 0;
  const manager = createManager({
    clock: () => now,
    fetchImpl: async () => {
      calls += 1;
      return tokenResponse(`token-${calls}`, "2026-09-29T08:00:00Z");
    }
  });

  const first = await manager.getToken({ installationId: 12 });
  manager.invalidateInstallation(12);
  const second = await manager.getToken({ installationId: 12 });

  assert.equal(first.token, "token-1");
  assert.equal(second.token, "token-2");
  assert.equal(calls, 2);
});

test("installation invalidation prevents an in-flight mint from repopulating cache", async () => {
  const now = Date.parse("2026-09-29T07:00:00Z");
  let calls = 0;
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  const manager = createManager({
    clock: () => now,
    fetchImpl: async () => {
      calls += 1;
      const call = calls;
      if (call === 1) await firstGate;
      return tokenResponse(`token-${call}`, "2026-09-29T08:00:00Z");
    }
  });

  const stalePromise = manager.getToken({ installationId: 13 });
  manager.invalidateInstallation(13);
  const freshPromise = manager.getToken({ installationId: 13 });
  releaseFirst();

  await assert.rejects(
    () => stalePromise,
    (error) => error instanceof GitHubInstallationTokenError && error.reason === "installation-invalidated"
  );
  const fresh = await freshPromise;
  assert.equal(fresh.token, "token-2");
  assert.equal(calls, 2);

  const cached = await manager.getToken({ installationId: 13 });
  assert.equal(cached, fresh);
  assert.equal(calls, 2);
});
