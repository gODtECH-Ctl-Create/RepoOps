import test from "node:test";
import assert from "node:assert/strict";
import { AmbiguousOperationError } from "../src/core/idempotency.mjs";
import { GitHubApiError, GitHubClient, GitHubNetworkError } from "../src/github/client.mjs";
import { boundedBackoffMs, classifyGitHubFailure } from "../src/github/retry.mjs";

function apiError(status, overrides = {}) {
  return new GitHubApiError({
    status,
    responseMessage: "",
    requestId: null,
    retryAfterSeconds: null,
    rateLimitRemaining: null,
    rateLimitReset: null,
    ...overrides
  });
}

test("bounded exponential backoff grows deterministically and caps", () => {
  assert.equal(boundedBackoffMs(1), 1_000);
  assert.equal(boundedBackoffMs(2), 2_000);
  assert.equal(boundedBackoffMs(3), 4_000);
  assert.equal(boundedBackoffMs(99), 300_000);
  assert.equal(boundedBackoffMs(4, { baseDelayMs: 250, maxDelayMs: 1_000 }), 1_000);
});

test("Retry-After takes precedence for rate-limit scheduling", () => {
  const error = apiError(403, {
    responseMessage: "You have exceeded a secondary rate limit.",
    retryAfterSeconds: 7,
    rateLimitRemaining: 42
  });
  assert.deepEqual(classifyGitHubFailure(error, { nowMs: 0 }), {
    action: "retry",
    reason: "rate-limit",
    retryAfterMs: 7_000
  });
});

test("primary limit exhaustion honors the reset epoch", () => {
  const error = apiError(403, { rateLimitRemaining: 0, rateLimitReset: 1_010 });
  assert.deepEqual(classifyGitHubFailure(error, { nowMs: 1_000_000 }), {
    action: "retry",
    reason: "rate-limit",
    retryAfterMs: 10_000
  });
});

test("429 without explicit headers uses bounded backoff", () => {
  assert.deepEqual(classifyGitHubFailure(apiError(429), { attempt: 3 }), {
    action: "retry",
    reason: "rate-limit",
    retryAfterMs: 4_000
  });
});

test("transient read failures retry but write failures reconcile first", () => {
  const network = new GitHubNetworkError(Object.assign(new Error("reset"), { code: "ECONNRESET" }));
  assert.deepEqual(classifyGitHubFailure(network, { attempt: 2 }), {
    action: "retry",
    reason: "network",
    retryAfterMs: 2_000
  });
  assert.deepEqual(classifyGitHubFailure(network, { mutation: true }), {
    action: "reconcile",
    reason: "network-after-mutation-attempt",
    retryAfterMs: null
  });

  assert.deepEqual(classifyGitHubFailure(apiError(503), { attempt: 2 }), {
    action: "retry",
    reason: "github-transient",
    retryAfterMs: 2_000
  });
  assert.deepEqual(classifyGitHubFailure(apiError(503), { mutation: true }), {
    action: "reconcile",
    reason: "transient-response-after-mutation-attempt",
    retryAfterMs: null
  });
});

test("explicit ambiguous operation always requires reconciliation", () => {
  assert.deepEqual(classifyGitHubFailure(new AmbiguousOperationError("lost response")), {
    action: "reconcile",
    reason: "ambiguous-mutation",
    retryAfterMs: null
  });
});

test("auth, missing-resource and validation failures fail closed", () => {
  assert.equal(classifyGitHubFailure(apiError(401)).reason, "authorization");
  assert.equal(classifyGitHubFailure(apiError(403)).reason, "authorization");
  assert.equal(classifyGitHubFailure(apiError(404)).reason, "resource-unavailable");
  assert.equal(classifyGitHubFailure(apiError(422)).reason, "validation");
  assert.equal(classifyGitHubFailure(apiError(409)).reason, "github-permanent");
  assert.equal(classifyGitHubFailure(new Error("unexpected")).reason, "unknown-error");
});

test("GitHub client exposes only safe retry and rate-limit response metadata", async () => {
  const headers = new Map([
    ["retry-after", "12"],
    ["x-ratelimit-remaining", "0"],
    ["x-ratelimit-reset", "1800000000"],
    ["x-github-request-id", "REQ_123"]
  ]);
  const client = new GitHubClient({
    token: "super-secret-token",
    repository: "owner/repo",
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
      text: async () => JSON.stringify({ message: "API rate limit exceeded" })
    })
  });

  await assert.rejects(client.request("/test"), (error) => {
    assert.ok(error instanceof GitHubApiError);
    assert.equal(error.status, 403);
    assert.equal(error.responseMessage, "API rate limit exceeded");
    assert.equal(error.retryAfterSeconds, 12);
    assert.equal(error.rateLimitRemaining, 0);
    assert.equal(error.rateLimitReset, 1_800_000_000);
    assert.equal(error.requestId, "REQ_123");
    assert.doesNotMatch(error.message, /super-secret-token/);
    return true;
  });
});

test("GitHub client converts transport failures into structured network errors", async () => {
  const transport = Object.assign(new Error("socket closed"), { code: "ECONNRESET" });
  const client = new GitHubClient({
    token: "test",
    repository: "owner/repo",
    fetchImpl: async () => { throw transport; }
  });

  await assert.rejects(client.request("/test"), (error) => {
    assert.ok(error instanceof GitHubNetworkError);
    assert.equal(error.code, "ECONNRESET");
    assert.equal(error.cause, transport);
    return true;
  });
});
