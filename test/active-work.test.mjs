import test from "node:test";
import assert from "node:assert/strict";

import { decideActiveWorkLimit } from "../src/core/active-work.mjs";
import { listManagedActiveAssignments } from "../src/github/active-work.mjs";

const policy = { maxActiveAssignments: 2, limitMaintainers: false };

test("active-work policy allows below-limit contributors and blocks at the limit", () => {
  assert.deepEqual(decideActiveWorkLimit({ policy, activeIssueNumbers: [8] }), {
    allowed: true,
    reason: "below-limit",
    activeIssueNumbers: [8]
  });

  const blocked = decideActiveWorkLimit({ policy, activeIssueNumbers: [9, 3] });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "limit-reached");
  assert.deepEqual(blocked.activeIssueNumbers, [3, 9]);
  assert.match(blocked.message, /#3, #9/);
  assert.match(blocked.message, /configured limit is 2/);
});

test("zero disables the limit and maintainers are exempt unless explicitly limited", () => {
  assert.equal(decideActiveWorkLimit({ policy: { maxActiveAssignments: 0, limitMaintainers: true }, activeIssueNumbers: [1, 2, 3] }).reason, "disabled");
  assert.equal(decideActiveWorkLimit({ policy, authorAssociation: "OWNER", activeIssueNumbers: [1, 2, 3] }).reason, "maintainer-exempt");
  assert.equal(decideActiveWorkLimit({ policy: { maxActiveAssignments: 1, limitMaintainers: true }, authorAssociation: "OWNER", activeIssueNumbers: [1] }).allowed, false);
});

test("collector counts only open RepoOps-managed issue assignments and excludes PR/manual ownership", async () => {
  const botId = 41898282;
  const issues = new Map([
    [7, { id: 70, number: 7, state: "open", assignees: [{ login: "alice" }], labels: [{ name: "status: in-progress" }] }],
    [9, { id: 90, number: 9, state: "open", assignees: [{ login: "alice" }], labels: [{ name: "status: in-progress" }] }]
  ]);
  const calls = [];
  const client = {
    repository: "owner/repo",
    botId,
    getIssue: async (number) => structuredClone(issues.get(number)),
    paginate: async (path) => {
      calls.push(path);
      if (path.includes("issues?state=open")) {
        return [{ number: 7 }, { number: 8, pull_request: { url: "https://example.test/pr/8" } }, { number: 9 }];
      }
      if (path.endsWith("/issues/7/timeline")) {
        return [{ id: 701, event: "assigned", created_at: "2026-09-16T08:00:00Z", assignee: { login: "alice" }, actor: { id: botId, type: "Bot" } }];
      }
      if (path.endsWith("/issues/9/timeline")) {
        return [{ id: 901, event: "assigned", created_at: "2026-09-16T08:00:00Z", assignee: { login: "alice" }, actor: { id: 55, type: "User" } }];
      }
      throw new Error(`Unexpected path ${path}`);
    }
  };
  const config = { labels: { inProgress: "status: in-progress", ready: "status: ready" } };

  assert.deepEqual(await listManagedActiveAssignments(client, "alice", config), [7]);
  assert.equal(calls[0].includes("assignee=alice"), true);
  assert.equal(calls.some((path) => path.includes("/issues/8/timeline")), false);
});
