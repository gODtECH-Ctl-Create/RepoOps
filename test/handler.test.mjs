import test from "node:test";
import assert from "node:assert/strict";
import { handleIssueComment, handleIssueLifecycle } from "../src/index.mjs";
import { DEFAULT_CONFIG } from "../src/core/config.mjs";
import { fakeClient, event } from "./helpers.mjs";

test("handler deduplicates claim, unclaim and old delivery after release", async () => {
  const client = fakeClient();
  await handleIssueComment(event(), client, DEFAULT_CONFIG);
  await handleIssueComment(event(), client, DEFAULT_CONFIG);
  assert.deepEqual(client.calls, ["comment", "assign", "add-label"]);
  await handleIssueComment(event(2, "/unclaim"), client, DEFAULT_CONFIG);
  await handleIssueComment(event(2, "/unclaim"), client, DEFAULT_CONFIG);
  await handleIssueComment(event(), client, DEFAULT_CONFIG);
  assert.equal(client.comments.length, 2);
  assert.deepEqual(client.issue.assignees, []);
  assert.equal(client.calls.filter((c) => c === "unassign").length, 1);
});
test("handler uses fresh issue state and does not claim closed issues", async () => {
  const client = fakeClient(); client.issue.state = "closed";
  await handleIssueComment(event(), client, DEFAULT_CONFIG);
  assert.deepEqual(client.calls, ["comment"]);
});
test("close cleanup is repeatable and ignores stale close after reopen", async () => {
  const client = fakeClient(); client.issue.state = "closed";
  client.issue.assignees = [{ login: "alice" }]; client.issue.labels = [{ name: "status: in-progress" }];
  const closed = { action: "closed", issue: { number: 2 } };
  await handleIssueLifecycle(closed, client, DEFAULT_CONFIG);
  await handleIssueLifecycle(closed, client, DEFAULT_CONFIG);
  assert.deepEqual(client.calls, ["unassign", "remove-label"]);
  client.issue.state = "open"; client.issue.assignees = [{ login: "bob" }];
  await handleIssueLifecycle(closed, client, DEFAULT_CONFIG);
  assert.equal(client.issue.assignees[0].login, "bob");
});
