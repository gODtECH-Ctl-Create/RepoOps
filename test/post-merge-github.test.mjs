import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG } from "../src/core/config.mjs";
import { postMergeFollowUpForIssue } from "../src/github/post-merge.mjs";

function linkedResponse() {
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

test("post-merge follow-up is duplicate-safe and suppresses suggestions at active-work limit", async () => {
  const botId = 41898282;
  const comments = [];
  const issues = new Map([
    [23, { id: 230, number: 23, state: "closed", assignees: [], labels: [] }],
    [44, { id: 440, number: 44, state: "open", assignees: [{ login: "alice" }], labels: [{ name: "status: in-progress" }] }]
  ]);
  const client = {
    repository: "owner/repo",
    botId,
    getIssue: async (number) => structuredClone(issues.get(number)),
    listComments: async () => structuredClone(comments),
    isOwnComment: (comment) => comment.user?.id === botId && comment.user?.type === "Bot",
    addComment: async (_number, body) => {
      comments.push({ id: comments.length + 1, body, user: { id: botId, type: "Bot" } });
      return structuredClone(comments.at(-1));
    },
    request: async (path) => {
      if (path === "/repos/owner/repo") return { id: 10, full_name: "owner/repo" };
      if (path === "/graphql") return linkedResponse();
      if (path === "/repos/owner/repo/pulls/70") {
        return { id: 700, number: 70, merged: true, merged_at: "2026-09-16T09:00:00Z", user: { id: 5, login: "alice" } };
      }
      if (path === "/repos/owner/repo/collaborators/alice/permission") {
        const error = new Error("not a collaborator");
        error.status = 404;
        throw error;
      }
      throw new Error(`Unexpected request ${path}`);
    },
    paginate: async (path) => {
      if (path.includes("issues?state=closed")) return [{ number: 23 }];
      if (path === "/repos/owner/repo/issues/23/timeline") return [{
        id: 2301,
        event: "assigned",
        created_at: "2026-09-16T08:00:00Z",
        actor: { id: botId, type: "Bot" },
        assignee: { id: 5, login: "alice" }
      }];
      if (path === "/repos/owner/repo/issues/70/timeline") return [{
        id: 7001,
        event: "merged",
        created_at: "2026-09-16T09:00:00Z",
        actor: { id: 1, type: "User" }
      }];
      if (path.includes("issues?state=open&assignee=alice")) return [{ number: 44 }];
      if (path === "/repos/owner/repo/issues/44/timeline") return [{
        id: 4401,
        event: "assigned",
        created_at: "2026-09-16T08:30:00Z",
        actor: { id: botId, type: "Bot" },
        assignee: { id: 5, login: "alice" }
      }];
      if (path.includes("issues?state=open&labels=")) throw new Error("ready-work discovery must be skipped at the active-work limit");
      throw new Error(`Unexpected pagination ${path}`);
    }
  };

  const config = structuredClone(DEFAULT_CONFIG);
  config.labels = { inProgress: "status: in-progress", ready: "status: ready" };
  config.contributorLimits = { maxActiveAssignments: 1, limitMaintainers: false };
  config.contributorGuidance = {
    ...config.contributorGuidance,
    contributorHubUrl: "https://example.com/contribute"
  };

  const first = await postMergeFollowUpForIssue({ client, config, issueNumber: 23, pullRequestNumber: 70 });
  assert.equal(first.type, "followed-up");
  assert.equal(first.contributor, "alice");
  assert.equal(first.contributionStatus, "first");
  assert.deepEqual(first.suggestions, []);
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /first merged contribution/i);
  assert.doesNotMatch(comments[0].body, /Available work you can look at next/);

  const repeated = await postMergeFollowUpForIssue({ client, config, issueNumber: 23, pullRequestNumber: 70 });
  assert.deepEqual(repeated, {
    type: "skip",
    reason: "already-followed-up",
    issueNumber: 23,
    pullRequestNumber: 70
  });
  assert.equal(comments.length, 1);
});
