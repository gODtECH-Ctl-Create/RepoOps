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

test("ready → claim → in-progress → unclaim → ready including repeated commands", async () => {
  const client = fakeClient(); client.issue.labels = [{ name: "status: ready" }];
  await handleIssueComment(event(), client, DEFAULT_CONFIG);
  assert.deepEqual(client.issue.labels, [{ name: "status: in-progress" }]);
  await handleIssueComment(event(2), client, DEFAULT_CONFIG);
  assert.equal(client.calls.filter((c) => c === "assign").length, 1);
  assert.equal(client.calls.filter((c) => c === "add-label").length, 1);
  await handleIssueComment(event(3, "/unclaim"), client, DEFAULT_CONFIG);
  assert.deepEqual(client.issue.labels, [{ name: "status: ready" }]);
  await handleIssueComment(event(4, "/unclaim"), client, DEFAULT_CONFIG);
  assert.deepEqual(client.issue.labels, [{ name: "status: ready" }]);
});
test("contradictory labels repaired and missing labels tolerated", async () => {
  const client = fakeClient(); client.issue.assignees = [{ login: "alice" }];
  client.issue.labels = [{ name: "status: ready" }, { name: "status: in-progress" }];
  await handleIssueComment(event(), client, DEFAULT_CONFIG);
  assert.deepEqual(client.issue.labels, [{ name: "status: in-progress" }]);
  client.issue.state = "closed"; client.issue.labels.push({ name: "status: ready" });
  await handleIssueLifecycle({ action: "closed", issue: { number: 2 } }, client, DEFAULT_CONFIG);
  assert.deepEqual(client.issue.labels, []);
  await handleIssueLifecycle({ action: "closed", issue: { number: 2 } }, client, DEFAULT_CONFIG);
});
test("unclaim does not restore readiness with another assignee or blocked work", async () => {
  const client = fakeClient(); client.issue.assignees = [{ login: "alice" }, { login: "bob" }];
  await handleIssueComment(event(1, "/unclaim"), client, DEFAULT_CONFIG);
  assert.deepEqual(client.issue.assignees, [{ login: "bob" }]);
  assert.deepEqual(client.issue.labels, [{ name: "status: in-progress" }]);
  const blocked = fakeClient(); blocked.issue.assignees = [{ login: "alice" }]; blocked.issue.labels = [{ name: "status: blocked" }, { name: "status: in-progress" }];
  await handleIssueComment(event(1, "/unclaim"), blocked, DEFAULT_CONFIG);
  assert.deepEqual(blocked.issue.labels, [{ name: "status: blocked" }]);
  await handleIssueComment(event(2), blocked, DEFAULT_CONFIG);
  assert.deepEqual(blocked.issue.assignees, []);
});

test("successful claim includes configured onboarding once and denied claims do not", async () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.contributorGuidance = {
    enabled: true,
    requirements: "Node.js 20+ and Git",
    setupCommand: "npm install",
    checkCommand: "npm run check",
    contributingUrl: "https://example.com/CONTRIBUTING.md",
    developmentUrl: "https://example.com/development",
    architectureUrl: "https://example.com/architecture"
  };

  const client = fakeClient();
  client.issue.labels = [{ name: "status: ready" }];
  await handleIssueComment(event(1), client, config);
  assert.equal(client.comments.length, 1);
  assert.match(client.comments[0].body, /Welcome, @alice/);
  assert.match(client.comments[0].body, /npm install/);
  assert.match(client.comments[0].body, /npm run check/);
  assert.match(client.comments[0].body, /Contributor guide/);

  await handleIssueComment(event(1), client, config);
  assert.equal(client.comments.length, 1);

  await handleIssueComment(event(2), client, config);
  assert.equal(client.comments.length, 2);
  assert.doesNotMatch(client.comments[1].body, /Welcome, @alice/);

  const blocked = fakeClient();
  blocked.issue.labels = [{ name: "status: blocked" }];
  await handleIssueComment(event(3), blocked, config);
  assert.equal(blocked.comments.length, 1);
  assert.doesNotMatch(blocked.comments[0].body, /Welcome, @alice/);
});

test("claim respects RepoOps-managed active-work limits while maintainers remain exempt", async () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.contributorLimits = { maxActiveAssignments: 1, limitMaintainers: false };

  function limitedClient() {
    const client = fakeClient();
    client.repository = "owner/repo";
    client.botId = 41898282;
    client.issue.labels = [{ name: "status: ready" }];
    const active = { id: 70, number: 7, state: "open", assignees: [{ login: "alice" }], labels: [{ name: "status: in-progress" }] };
    client.getIssue = async (number) => structuredClone(number === 7 ? active : client.issue);
    client.paginate = async (path) => {
      if (path.includes("issues?state=open")) return [{ number: 7 }];
      if (path.endsWith("/issues/7/timeline")) return [{ id: 701, event: "assigned", created_at: "2026-09-16T08:00:00Z", assignee: { login: "alice" }, actor: { id: 41898282, type: "Bot" } }];
      throw new Error(`Unexpected path ${path}`);
    };
    return client;
  }

  const contributor = limitedClient();
  const contributorEvent = event(40);
  contributorEvent.comment.author_association = "NONE";
  await handleIssueComment(contributorEvent, contributor, config);
  assert.equal(contributor.calls.includes("assign"), false);
  assert.match(contributor.comments[0].body, /#7/);
  assert.match(contributor.comments[0].body, /use \/unclaim/);

  const maintainer = limitedClient();
  const maintainerEvent = event(41);
  maintainerEvent.comment.author_association = "OWNER";
  maintainer.paginate = async () => { throw new Error("maintainer exemption should not scan active work"); };
  await handleIssueComment(maintainerEvent, maintainer, config);
  assert.equal(maintainer.calls.includes("assign"), true);
});
