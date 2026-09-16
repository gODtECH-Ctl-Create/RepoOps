import test from "node:test";
import assert from "node:assert/strict";

import {
  getIssueMetadata,
  isAvailableGoodFirstIssue,
  normalizeContributors,
  selectAvailableGoodFirstIssues
} from "../site/data.mjs";

function issue(overrides = {}) {
  return {
    number: 1,
    title: "Starter task",
    state: "open",
    assignee: null,
    assignees: [],
    updated_at: "2026-09-16T00:00:00Z",
    labels: [
      { name: "good first issue" },
      { name: "status: ready" },
      { name: "difficulty: starter" },
      { name: "area: docs" },
      { name: "priority: p2" }
    ],
    ...overrides
  };
}

test("available Good First Issue requires open, ready, unassigned issue state", () => {
  assert.equal(isAvailableGoodFirstIssue(issue()), true);
  assert.equal(isAvailableGoodFirstIssue(issue({ state: "closed" })), false);
  assert.equal(isAvailableGoodFirstIssue(issue({ assignee: { login: "alice" } })), false);
  assert.equal(isAvailableGoodFirstIssue(issue({ assignees: [{ login: "alice" }] })), false);
  assert.equal(isAvailableGoodFirstIssue(issue({ pull_request: { url: "https://example.test/pr" } })), false);
});

test("blocked and in-progress work is never advertised as available", () => {
  assert.equal(
    isAvailableGoodFirstIssue(
      issue({ labels: [{ name: "good first issue" }, { name: "status: ready" }, { name: "status: blocked" }] })
    ),
    false
  );

  assert.equal(
    isAvailableGoodFirstIssue(
      issue({ labels: [{ name: "good first issue" }, { name: "status: ready" }, { name: "status: in-progress" }] })
    ),
    false
  );
});

test("selection is deterministic and prefers most recently updated available work", () => {
  const result = selectAvailableGoodFirstIssues(
    [
      issue({ number: 3, updated_at: "2026-09-13T00:00:00Z" }),
      issue({ number: 2, updated_at: "2026-09-15T00:00:00Z" }),
      issue({ number: 1, updated_at: "2026-09-14T00:00:00Z" }),
      issue({ number: 4, state: "closed", updated_at: "2026-09-16T00:00:00Z" })
    ],
    2
  );

  assert.deepEqual(result.map((item) => item.number), [2, 1]);
});

test("issue metadata exposes only supported display dimensions", () => {
  assert.deepEqual(getIssueMetadata(issue()), {
    difficulty: "difficulty: starter",
    area: "area: docs",
    priority: "priority: p2"
  });
});

test("contributors exclude bots, sort by login, and preserve public activity count", () => {
  const contributors = normalizeContributors([
    {
      login: "zoe",
      html_url: "https://github.com/zoe",
      avatar_url: "https://example.test/zoe.png",
      contributions: 2,
      type: "User"
    },
    {
      login: "alpha-bot",
      html_url: "https://github.com/apps/alpha-bot",
      avatar_url: "https://example.test/bot.png",
      contributions: 99,
      type: "Bot"
    },
    {
      login: "Alice",
      html_url: "https://github.com/Alice",
      avatar_url: "https://example.test/alice.png",
      contributions: 4,
      type: "User"
    }
  ]);

  assert.deepEqual(contributors, [
    {
      login: "Alice",
      profileUrl: "https://github.com/Alice",
      avatarUrl: "https://example.test/alice.png",
      contributions: 4
    },
    {
      login: "zoe",
      profileUrl: "https://github.com/zoe",
      avatarUrl: "https://example.test/zoe.png",
      contributions: 2
    }
  ]);
});
