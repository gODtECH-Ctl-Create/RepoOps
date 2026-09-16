import assert from "node:assert/strict";
import test from "node:test";
import { calculatePullRequestTiming } from "../src/core/pr-timing.mjs";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-01T01:00:00Z";
const t2 = "2026-01-01T03:00:00Z";
const t3 = "2026-01-01T05:00:00Z";
const t4 = "2026-01-01T06:30:00Z";

const events = [
  { state: "waiting-for-review", timestamp: t0 },
  { state: "waiting-for-author", timestamp: t1 },
  { state: "waiting-for-review", timestamp: t2 },
  { state: "waiting-for-author", timestamp: t3 },
  { state: "waiting-for-review", timestamp: t4 }
];

test("calculates maintainer and author waiting ages from fixed UTC timestamps", () => {
  const result = calculatePullRequestTiming({ now: "2026-01-01T07:00:00Z", events });
  assert.equal(result.currentState, "waiting-for-review");
  assert.equal(result.currentStateSince, "2026-01-01T06:30:00.000Z");
  assert.equal(result.reviewAge, 30 * 60 * 1000);
  assert.equal(result.authorWaitAge, null);
  assert.deepEqual(result.responseLatency.maintainer, {
    milliseconds: 2 * 60 * 60 * 1000,
    startedAt: "2026-01-01T03:00:00.000Z",
    endedAt: "2026-01-01T05:00:00.000Z"
  });
  assert.deepEqual(result.responseLatency.author, {
    milliseconds: 90 * 60 * 1000,
    startedAt: "2026-01-01T05:00:00.000Z",
    endedAt: "2026-01-01T06:30:00.000Z"
  });
});

test("normalizes offsets to UTC and is independent of local timezone", () => {
  const result = calculatePullRequestTiming({
    now: "2026-01-01T08:00:00+01:00",
    events: [{ state: "waiting-for-review", timestamp: "2026-01-01T06:00:00Z" }]
  });
  assert.equal(result.reviewAge, 60 * 60 * 1000);
});

test("malformed timestamps fail safely without throwing", () => {
  const result = calculatePullRequestTiming({
    now: "not-a-date",
    events: [{ state: "waiting-for-review", timestamp: "also-not-a-date" }]
  });
  assert.equal(result.invalidNow, true);
  assert.equal(result.reviewAge, null);

  const partiallyMalformed = calculatePullRequestTiming({
    now: "2026-01-01T02:00:00Z",
    events: [{ state: "waiting-for-review", timestamp: "bad" }]
  });
  assert.equal(partiallyMalformed.currentState, "unknown");
  assert.equal(partiallyMalformed.reviewAge, null);
});

test("rejects timezone-less timestamps", () => {
  const result = calculatePullRequestTiming({
    now: "2026-01-01T02:00:00Z",
    events: [{ state: "waiting-for-review", timestamp: "2026-01-01T01:00:00" }]
  });

  assert.equal(result.currentState, "unknown");
  assert.equal(result.reviewAge, null);
});

test("rejects impossible calendar dates", () => {
  const result = calculatePullRequestTiming({
    now: "2026-03-01T02:00:00Z",
    events: [{ state: "waiting-for-review", timestamp: "2026-02-31T01:00:00Z" }]
  });

  assert.equal(result.currentState, "unknown");
  assert.equal(result.reviewAge, null);
});

test("ignores events after the observation time", () => {
  const result = calculatePullRequestTiming({
    now: "2026-01-01T01:30:00Z",
    events: [
      { state: "waiting-for-review", timestamp: t0 },
      { state: "waiting-for-author", timestamp: t1 },
      { state: "waiting-for-review", timestamp: t2 }
    ]
  });
  assert.equal(result.currentState, "waiting-for-author");
  assert.equal(result.authorWaitAge, 30 * 60 * 1000);
});

test("returns null for waiting age while blocked or waiting for CI", () => {
  const result = calculatePullRequestTiming({
    now: t3,
    events: [
      { state: "waiting-for-review", timestamp: t0 },
      { state: "blocked", timestamp: t1 }
    ]
  });
  assert.equal(result.currentState, "blocked");
  assert.equal(result.reviewAge, null);
  assert.equal(result.authorWaitAge, null);
});
