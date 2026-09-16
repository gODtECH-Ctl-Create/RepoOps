import assert from "node:assert/strict";
import { loadRepoOpsConfig } from "../src/core/config.mjs";
import { DAY_MS } from "../src/core/stale-assignment.mjs";
import { GitHubClient } from "../src/github/client.mjs";
import { scanIssue, collectStaleAssignment } from "../src/github/stale-scanner.mjs";

// Real API smoke test, restricted to an issue created by this invocation.
const client = new GitHubClient({ token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY });
const config = await loadRepoOpsConfig();
const login = process.env.GITHUB_ACTOR;
if (!login || !/^[A-Za-z0-9-]+$/.test(login)) throw new Error("Live validation requires a human GitHub actor");
const repository = await client.request(`/repos/${client.repository}`);
await client.ensureLabel(config.labels.inProgress);
const issue = await client.request(`/repos/${client.repository}/issues`, { method: "POST", body: JSON.stringify({ title: "RepoOps disposable scanner validation", body: "Automatically created maintainer smoke test. This issue is closed and cleaned in a finally block; it is not contributor work.", labels: [config.labels.inProgress] }) });
console.log(`Validation issue: #${issue.number}`);
try {
  await client.assignIssue(issue.number, login);
  const collected = await collectStaleAssignment(client, issue.number, config);
  assert.ok(collected.assignment, "Expected a bot-managed assignment timeline event");
  const base = { client, repositoryId: repository.id, issueNumber: issue.number, config, dryRun: false };
  const fresh = await scanIssue({ ...base, now: new Date().toISOString() });
  assert.equal(fresh.reason, "fresh");
  const staleNow = new Date(Date.parse(collected.assignment.assignedAt) + config.assignments.reminderAfterDays * DAY_MS).toISOString();
  const stale = await scanIssue({ ...base, now: staleNow });
  assert.equal(stale.type, "reminded");
  const repeated = await scanIssue({ ...base, now: staleNow });
  assert.equal(repeated.reason, "already-reminded");
  const comments = await client.listComments(issue.number);
  assert.equal(comments.filter((c) => client.isOwnComment(c) && c.body.includes(`repoops:v1:${stale.key}`)).length, 1);
  const current = await client.getIssue(issue.number);
  assert.ok(current.assignees.some((a) => a.login === login), "Scanner must not remove assignment");
  console.log(JSON.stringify({ fresh, stale, repeated, reminderComments: 1, assignmentPreserved: true }, null, 2));
} finally {
  await client.removeAssignees(issue.number, [login]);
  await client.request(`/repos/${client.repository}/issues/${issue.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed", labels: [] }) });
  console.log(`Closed and cleaned validation issue #${issue.number}`);
}
