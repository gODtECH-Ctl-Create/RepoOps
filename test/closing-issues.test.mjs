import test from "node:test";
import assert from "node:assert/strict";

import { findClosingIssuesForPullRequest } from "../src/github/closing-issues.mjs";

test("closing issues are collected authoritatively with pagination and deterministic order", async () => {
  const calls = [];
  const client = {
    repository: "owner/repo",
    request: async (_path, options) => {
      const body = JSON.parse(options.body);
      calls.push(body.variables.cursor);
      if (body.variables.cursor === null) {
        return { data: { repository: { pullRequest: { closingIssuesReferences: {
          nodes: [
            { number: 9, repository: { nameWithOwner: "owner/repo" } },
            { number: 2, repository: { nameWithOwner: "other/repo" } }
          ],
          pageInfo: { hasNextPage: true, endCursor: "next" }
        } } } } };
      }
      return { data: { repository: { pullRequest: { closingIssuesReferences: {
        nodes: [{ number: 3, repository: { nameWithOwner: "owner/repo" } }],
        pageInfo: { hasNextPage: false, endCursor: null }
      } } } } };
    }
  };

  assert.deepEqual(await findClosingIssuesForPullRequest(client, 70), [
    { number: 2, repository: "other/repo" },
    { number: 3, repository: "owner/repo" },
    { number: 9, repository: "owner/repo" }
  ]);
  assert.deepEqual(calls, [null, "next"]);
});

test("malformed or repeated pagination state fails visibly", async () => {
  const client = {
    repository: "owner/repo",
    request: async () => ({ data: { repository: { pullRequest: { closingIssuesReferences: {
      nodes: [], pageInfo: { hasNextPage: true, endCursor: "same" }
    } } } } })
  };
  await assert.rejects(() => findClosingIssuesForPullRequest(client, 1), /pagination cursor/);
});
