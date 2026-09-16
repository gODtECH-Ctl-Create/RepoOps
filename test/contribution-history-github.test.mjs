import test from "node:test";
import assert from "node:assert/strict";

import { priorContributionStatus } from "../src/core/contributions.mjs";
import { collectContributionProjection } from "../src/github/contribution-history.mjs";

function linkedResponse(issueNumber) {
  if (issueNumber !== 23) throw new Error(`Unexpected linked issue ${issueNumber}`);
  return {
    data: {
      repository: {
        issue: {
          closedByPullRequestsReferences: {
            nodes: [{
              id: "PR_node_70",
              number: 70,
              url: "https://github.com/owner/repo/pull/70",
              state: "MERGED",
              isDraft: false,
              mergedAt: "2026-09-16T09:00:00Z",
              repository: { nameWithOwner: "owner/repo" }
            }],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      }
    }
  };
}

test("GitHub history bridge projects only RepoOps-managed completed work", async () => {
  const botId = 41898282;
  const issues = new Map([
    [23, { id: 230, number: 23, state: "closed", assignees: [], labels: [] }],
    [99, { id: 990, number: 99, state: "closed", assignees: [], labels: [] }]
  ]);
  const client = {
    repository: "owner/repo",
    botId,
    getIssue: async (number) => structuredClone(issues.get(number)),
    request: async (path, options = {}) => {
      if (path === "/repos/owner/repo") return { id: 10, full_name: "owner/repo" };
      if (path === "/graphql") return linkedResponse(JSON.parse(options.body).variables.number);
      if (path === "/repos/owner/repo/pulls/70") {
        return { id: 700, number: 70, merged: true, merged_at: "2026-09-16T09:00:00Z", user: { id: 5, login: "alice" } };
      }
      throw new Error(`Unexpected request ${path}`);
    },
    paginate: async (path) => {
      if (path.includes("issues?state=closed")) return [{ number: 23 }, { number: 99 }];
      if (path === "/repos/owner/repo/issues/23/timeline") return [{
        id: 2301,
        event: "assigned",
        created_at: "2026-09-16T08:00:00Z",
        actor: { id: botId, type: "Bot" },
        assignee: { id: 5, login: "alice" }
      }];
      if (path === "/repos/owner/repo/issues/99/timeline") return [{
        id: 9901,
        event: "assigned",
        created_at: "2026-09-16T07:00:00Z",
        actor: { id: 6, type: "User" },
        assignee: { id: 7, login: "manual-user" }
      }];
      if (path === "/repos/owner/repo/issues/70/timeline") return [{
        id: 7001,
        event: "merged",
        created_at: "2026-09-16T09:00:00Z",
        actor: { id: 1, type: "User" }
      }];
      throw new Error(`Unexpected pagination ${path}`);
    }
  };

  const history = await collectContributionProjection(client);
  assert.equal(history.projection.completed.length, 1);
  assert.equal(history.projection.unresolved.length, 0);
  assert.equal(history.projection.completed[0].issue.number, 23);
  assert.equal(history.projection.completed[0].pullRequest.number, 70);
  assert.equal(history.projection.completed[0].contributorId, 5);
  assert.equal(history.contributorLogins.get(5), "alice");
  assert.equal(priorContributionStatus(history.projection, 5, "2026-09-16T09:00:00Z"), "first");
});
