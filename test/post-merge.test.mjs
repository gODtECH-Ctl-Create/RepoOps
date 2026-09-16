import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPostMergeMessage,
  buildPullRequestPostMergeMessage,
  postMergeMarker,
  postMergePullRequestMarker,
  selectNextWork
} from "../src/core/post-merge.mjs";

function issue(number, labels = ["status: ready"], overrides = {}) {
  return {
    number,
    title: `Issue ${number}`,
    state: "open",
    assignee: null,
    assignees: [],
    labels: labels.map((name) => ({ name })),
    ...overrides
  };
}

test("next-work selection includes only genuinely available work in deterministic policy order", () => {
  const selected = selectNextWork([
    issue(9, ["status: ready", "priority: p2"]),
    issue(4, ["status: ready", "priority: p1"]),
    issue(3, ["status: ready", "priority: p1"]),
    issue(5, ["status: ready", "status: blocked", "priority: p0"]),
    issue(6, ["status: ready", "dependency: blocked"]),
    issue(7, ["status: ready"], { assignee: { login: "taken" } }),
    issue(8, ["status: ready", "status: in-progress"]),
    issue(10, ["enhancement"]),
    issue(11, ["status: ready"], { pull_request: { url: "https://example.test/pr" } }),
    issue(2, ["status: ready", "priority: p0"])
  ], {
    readyLabel: "status: ready",
    inProgressLabel: "status: in-progress",
    completedIssueNumber: 2,
    limit: 3
  });

  assert.deepEqual(selected, [
    { number: 3, title: "Issue 3" },
    { number: 4, title: "Issue 4" },
    { number: 9, title: "Issue 9" }
  ]);
});

test("first contribution message is distinct, actionable and does not pressure another claim", () => {
  const message = buildPostMergeMessage({
    contributor: "alice",
    issueNumber: 23,
    pullRequestNumber: 70,
    contributionStatus: "first",
    suggestions: [{ number: 8, title: "Improve diagnostics" }],
    guidance: {
      contributingUrl: "https://example.com/contributing",
      developmentUrl: "https://example.com/development",
      architectureUrl: "https://example.com/architecture",
      roadmapUrl: "https://example.com/roadmap",
      contributorHubUrl: "https://example.com/contribute"
    }
  });

  assert.match(message, /first merged contribution/i);
  assert.match(message, /#23 through PR #70/);
  assert.match(message, /Contributor guide/);
  assert.match(message, /Contributor Hub/);
  assert.match(message, /#8 — Improve diagnostics/);
  assert.match(message, /`\/claim`/);
  assert.match(message, /do not need to pick up another issue immediately/i);
});

test("returning and unknown history use normal thanks rather than false first-contributor recognition", () => {
  for (const contributionStatus of ["returning", "unknown"]) {
    const message = buildPostMergeMessage({
      contributor: "alice",
      issueNumber: 23,
      pullRequestNumber: 70,
      contributionStatus,
      suggestions: [],
      guidance: { contributorHubUrl: "https://example.com/contribute" }
    });
    assert.match(message, /contribution has been merged/);
    assert.doesNotMatch(message, /first merged contribution/i);
    assert.match(message, /Contributor Hub/);
  }
});

test("merged PR acknowledgment gives first contributors a concise welcome and points back to the issue", () => {
  const message = buildPullRequestPostMergeMessage({
    contributor: "alice",
    issueNumber: 23,
    contributionStatus: "first"
  });

  assert.match(message, /first contribution has been merged/i);
  assert.match(message, /completing #23 through this pull request/i);
  assert.match(message, /contributor community/i);
  assert.match(message, /recorded on #23/i);
  assert.doesNotMatch(message, /Available work you can look at next/);
});

test("returning and unknown contributors receive normal PR acknowledgment", () => {
  for (const contributionStatus of ["returning", "unknown"]) {
    const message = buildPullRequestPostMergeMessage({
      contributor: "alice",
      issueNumber: 23,
      contributionStatus
    });
    assert.match(message, /contribution has been merged/i);
    assert.doesNotMatch(message, /first contribution/i);
    assert.match(message, /recorded on #23/i);
  }
});

test("post-merge markers are stable and independent for issue and pull request surfaces", () => {
  assert.equal(postMergeMarker(100, 22), "<!-- repoops:post-merge:v1:100:22 -->");
  assert.equal(postMergePullRequestMarker(100, 22), "<!-- repoops:post-merge-pr:v1:100:22 -->");
});
