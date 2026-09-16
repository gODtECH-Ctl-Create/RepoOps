import test from "node:test";
import assert from "node:assert/strict";
import { handleIssueComment } from "../src/index.mjs";
import { DEFAULT_CONFIG } from "../src/core/config.mjs";
import { fakeClient, event } from "./helpers.mjs";

function config() {
  const value = structuredClone(DEFAULT_CONFIG);
  value.contributorGuidance.problemUrl = "https://example.com/problems/new";
  value.contributorGuidance.upgradeUrl = "https://example.com/upgrades/new";
  return value;
}

function ordinary(id = 1, body = "I would like to help with this") {
  const value = event(id, body);
  value.comment.user.type = "User";
  return value;
}

test("first human non-command comment on ready work gets one claim/proposal nudge", async () => {
  const client = fakeClient();
  client.issue.labels = [{ name: "status: ready" }];
  await handleIssueComment(ordinary(), client, config());
  assert.equal(client.comments.length, 1);
  assert.match(client.comments[0].body, /`\/claim`/);
  assert.match(client.comments[0].body, /ordinary comment does not reserve the issue/i);
  assert.match(client.comments[0].body, /Propose a problem/);
  assert.match(client.comments[0].body, /Propose an upgrade/);
  assert.deepEqual(client.issue.assignees, []);
  assert.deepEqual(client.calls, ["comment"]);

  await handleIssueComment(ordinary(2, "Any update?"), client, config());
  assert.equal(client.comments.length, 1);
});

test("different humans can each receive one nudge on the same ready issue", async () => {
  const client = fakeClient();
  client.issue.labels = [{ name: "status: ready" }];
  await handleIssueComment(ordinary(1), client, config());
  const bob = ordinary(2, "Can I help?");
  bob.comment.user = { id: 4, login: "bob", type: "User" };
  await handleIssueComment(bob, client, config());
  assert.equal(client.comments.length, 2);
});

test("does not nudge unavailable, closed, pull-request or bot comments", async () => {
  const assigned = fakeClient();
  assigned.issue.labels = [{ name: "status: ready" }];
  assigned.issue.assignees = [{ login: "bob" }];
  await handleIssueComment(ordinary(), assigned, config());
  assert.equal(assigned.comments.length, 0);

  const blocked = fakeClient();
  blocked.issue.labels = [{ name: "status: ready" }, { name: "status: blocked" }];
  await handleIssueComment(ordinary(), blocked, config());
  assert.equal(blocked.comments.length, 0);

  const notReady = fakeClient();
  await handleIssueComment(ordinary(), notReady, config());
  assert.equal(notReady.comments.length, 0);

  const closed = fakeClient();
  closed.issue.state = "closed";
  closed.issue.labels = [{ name: "status: ready" }];
  await handleIssueComment(ordinary(), closed, config());
  assert.equal(closed.comments.length, 0);

  const pr = fakeClient();
  pr.issue.labels = [{ name: "status: ready" }];
  const prEvent = ordinary();
  prEvent.issue.pull_request = {};
  await handleIssueComment(prEvent, pr, config());
  assert.equal(pr.comments.length, 0);

  const bot = fakeClient();
  bot.issue.labels = [{ name: "status: ready" }];
  const botEvent = ordinary();
  botEvent.comment.user.type = "Bot";
  await handleIssueComment(botEvent, bot, config());
  assert.equal(bot.comments.length, 0);
});

test("recognized slash commands keep their existing command path", async () => {
  const client = fakeClient();
  client.issue.labels = [{ name: "status: ready" }];
  const claim = ordinary(1, "/claim");
  await handleIssueComment(claim, client, config());
  assert.equal(client.issue.assignees[0].login, "alice");
  assert.equal(client.comments.length, 1);
  assert.match(client.comments[0].body, /claimed this issue/);
  assert.doesNotMatch(client.comments[0].body, /ordinary comment does not reserve/);
});
