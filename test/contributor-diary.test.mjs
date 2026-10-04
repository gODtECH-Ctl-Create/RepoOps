import test from "node:test";
import assert from "node:assert/strict";

import { parseRepoOpsConfig } from "../src/core/config.mjs";
import { buildContributorDiary, contributorDiaryMarker } from "../src/core/contributor-diary.mjs";
import { refreshContributorDiary } from "../src/github/contributor-diary.mjs";

function fakeClient(body = contributorDiaryMarker()) {
  const client = {
    repository: "owner/repo",
    issue: {
      id: 100,
      number: 102,
      state: "open",
      body,
      pull_request: null,
      assignees: [],
      labels: []
    },
    calls: [],
    async getIssue() { return structuredClone(this.issue); },
    async updateIssue(number, payload) {
      assert.equal(number, 102);
      this.issue.body = payload.body;
      this.calls.push(payload.body);
    }
  };
  return client;
}

test("diary configuration defaults off and validates an enabled target", () => {
  assert.deepEqual(parseRepoOpsConfig("commands:\n  claim: true").contributorDiary, { enabled: false, issueNumber: 0 });
  assert.deepEqual(parseRepoOpsConfig("contributorDiary:\n  enabled: true\n  issueNumber: 102").contributorDiary, { enabled: true, issueNumber: 102 });
  assert.throws(() => parseRepoOpsConfig("contributorDiary:\n  enabled: true"));
  assert.throws(() => parseRepoOpsConfig("contributorDiary:\n  issueNumber: 1.5"));
  assert.throws(() => parseRepoOpsConfig("contributorDiary:\n  issueNumber: \"102\""));
});

test("diary renderer is deterministic and ordered", () => {
  const body = buildContributorDiary({
    repository: "owner/repo",
    active: [
      { number: 20, title: "Second | task", contributors: ["zoe", "alice"] },
      { number: 3, title: "First task", contributors: ["bob"] }
    ],
    completed: [
      { issueNumber: 8, issueTitle: "Done", pullRequestNumber: 11, contributor: "alice", completedAt: "2026-10-01T10:00:00Z" }
    ]
  });

  assert.ok(body.startsWith(contributorDiaryMarker()));
  assert.ok(body.indexOf("[#3]") < body.indexOf("[#20]"));
  assert.match(body, /Second \\| task/);
  assert.match(body, /operational view, not a leaderboard/);
  assert.match(body, /not a leaderboard/i);
  assert.match(body, /does not score contributor quality/i);
});

test("diary refresh updates once and becomes idempotent", async () => {
  const client = fakeClient();
  const snapshot = { active: [{ number: 7, title: "Active work", contributors: ["alice"] }], completed: [] };

  const first = await refreshContributorDiary({
    client,
    config: { contributorDiary: { enabled: true, issueNumber: 102 } },
    snapshotProvider: async () => snapshot
  });
  const second = await refreshContributorDiary({
    client,
    config: { contributorDiary: { enabled: true, issueNumber: 102 } },
    snapshotProvider: async () => snapshot
  });

  assert.equal(first.type, "updated");
  assert.equal(second.type, "unchanged");
  assert.equal(client.calls.length, 1);
});

test("diary refuses to overwrite an unrelated issue", async () => {
  const client = fakeClient("# unrelated");
  await assert.rejects(
    refreshContributorDiary({
      client,
      config: { contributorDiary: { enabled: true, issueNumber: 102 } },
      snapshotProvider: async () => ({ active: [], completed: [] })
    }),
    /missing the RepoOps diary marker/i
  );
});

test("closed diary issue is not mutated", async () => {
  const client = fakeClient();
  client.issue.state = "closed";

  const result = await refreshContributorDiary({
    client,
    config: { contributorDiary: { enabled: true, issueNumber: 102 } },
    snapshotProvider: async () => ({ active: [], completed: [] })
  });

  assert.equal(result.type, "skip");
  assert.equal(client.calls.length, 0);
});
