import test from "node:test";
import assert from "node:assert/strict";
import { findLinkedPullRequests } from "../src/github/linked-pull-requests.mjs";
const pr = (number, state = "OPEN") => ({ id: `PR_${number}`, number, url: `https://github.com/o/r/pull/${number}`, state, isDraft: false, mergedAt: state === "MERGED" ? "2026-09-01T00:00:00Z" : null, repository: { nameWithOwner: "o/r" } });
const page = (nodes = [], hasNextPage = false, endCursor = null) => ({ data: { repository: { issue: { closedByPullRequestsReferences: { nodes, pageInfo: { hasNextPage, endCursor } } } } } });
const client = (responses) => ({ repository: "o/r", request: async (_path, options) => { assert.match(JSON.parse(options.body).query, /includeClosedPrs: true/); return responses.shift(); } });
test("no linked PR", async () => { assert.deepEqual((await findLinkedPullRequests(client([page()]), 1)).pullRequests, []); });
test("open, merged, closed and multiple linked PRs have explicit results", async () => {
  const r = await findLinkedPullRequests(client([page([pr(3, "MERGED"), pr(2), pr(4, "CLOSED")])]), 1);
  assert.deepEqual(r.pullRequests.map((p) => p.number), [2, 3, 4]);
  assert.equal(r.open.length, 1); assert.equal(r.merged.length, 1); assert.equal(r.closed.length, 1);
});
test("unrelated issue-number mention is not collected", async () => {
  const c = client([page()]); let calls = 0; const request = c.request;
  c.request = async (path, options) => { calls++; assert.equal(path, "/graphql"); assert.doesNotMatch(JSON.parse(options.body).query, /body|search|timeline/); return request(path, options); };
  c.unrelatedPR = { body: "see #1; related to #1" };
  assert.equal((await findLinkedPullRequests(c, 1)).pullRequests.length, 0); assert.equal(calls, 1);
});
test("cursor pagination and duplicate boundary entries", async () => {
  const c = client([page([pr(1)], true, "next"), page([pr(1), pr(2)])]);
  assert.equal((await findLinkedPullRequests(c, 1)).open.length, 2);
});
test("malformed responses and repeated cursors fail", async () => {
  for (const response of [{}, page([null]), page([{ ...pr(1), state: "unknown" }]), page([{ ...pr(1), mergedAt: "bad" }]), page([], true, null)]) await assert.rejects(findLinkedPullRequests(client([response]), 1));
  await assert.rejects(findLinkedPullRequests(client([page([], true, "x"), page([], true, "x")]), 1), /cursor/);
});
test("GraphQL partial errors and HTTP failures never mean no PR", async () => {
  await assert.rejects(findLinkedPullRequests(client([{ ...page(), errors: [{ message: "forbidden" }] }]), 1), /failed/);
  await assert.rejects(findLinkedPullRequests({ repository: "o/r", request: async () => { throw new Error("503"); } }, 1), /503/);
});
test("changed PR state across pagination fails for recollection", async () => {
  await assert.rejects(findLinkedPullRequests(client([page([pr(1)], true, "x"), page([pr(1, "MERGED")])]), 1), /changed/);
});
