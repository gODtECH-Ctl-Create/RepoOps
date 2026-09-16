import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/core/config.mjs";
import { decideStaleAssignment, managedAssignment, utcMillis } from "../src/core/stale-assignment.mjs";
import { scanIssue, scanRepository } from "../src/github/stale-scanner.mjs";
import { fakeClient } from "./helpers.mjs";
const assignedAt = "2026-09-01T00:00:00Z";
const timelineEvent = { id: 100, event: "assigned", created_at: assignedAt, assignee: { login: "alice" }, actor: { id: 41898282, type: "Bot" } };
const input = () => ({ repositoryId: 10, issue: { id: 20, number: 2, state: "open", assignees: [{ login: "alice" }], labels: [{ name: "status: in-progress" }] }, assignment: { eventId: 100, login: "alice", assignedAt }, linked: { open: [], merged: [] }, config: DEFAULT_CONFIG, now: "2026-09-04T00:00:00Z" });
function scannerClient() {
  const c = fakeClient(); c.issue = input().issue; c.botId = 41898282; c.repository = "o/r";
  c.timeline = [timelineEvent]; c.linked = [];
  c.paginate = async (path) => path.includes("/timeline") ? c.timeline : [c.issue];
  c.request = async (path) => path === "/graphql" ? { data: { repository: { issue: { closedByPullRequestsReferences: { nodes: c.linked, pageInfo: { hasNextPage: false, endCursor: null } } } } } } : { id: 10 };
  return c;
}
const run = (client, extras = {}) => scanIssue({ client, repositoryId: 10, issueNumber: 2, config: DEFAULT_CONFIG, now: input().now, dryRun: false, ...extras });

test("fresh, threshold and stale decisions use deterministic UTC days", () => {
  assert.equal(decideStaleAssignment({ ...input(), now: "2026-09-03T23:59:59Z" }).reason, "fresh");
  assert.equal(decideStaleAssignment(input()).type, "remind");
  assert.equal(decideStaleAssignment({ ...input(), now: "2026-09-05T00:00:00Z" }).window, 1);
});
test("active linked PR and merged work in current assignment suppress reminders", () => {
  assert.equal(decideStaleAssignment({ ...input(), linked: { open: [{ isDraft: true }], merged: [] } }).reason, "linked-open-pr");
  assert.equal(decideStaleAssignment({ ...input(), linked: { open: [], merged: [{ mergedAt: "2026-09-02T00:00:00Z" }] } }).reason, "linked-merged-pr");
  assert.equal(decideStaleAssignment({ ...input(), linked: { open: [], merged: [{ mergedAt: "2026-08-01T00:00:00Z" }] } }).type, "remind");
});
test("unassigned, unmanaged, PR and non-in-progress issues are excluded", () => {
  const i = input();
  for (const [patch, reason] of [[{ assignees: [] }, "unassigned"], [{ labels: [] }, "not-in-progress"], [{ pull_request: {} }, "pull-request"], [{ state: "closed" }, "closed"], [{ assignees: [{ login: "a" }, { login: "b" }] }, "multiple-assignees"]]) assert.equal(decideStaleAssignment({ ...i, issue: { ...i.issue, ...patch } }).reason, reason);
  assert.equal(decideStaleAssignment({ ...i, assignment: null }).reason, "not-repoops-managed");
});
test("already reminded and next window use stable distinct operation keys", () => {
  const first = decideStaleAssignment(input());
  const again = decideStaleAssignment({ ...input(), alreadyReminded: true });
  assert.equal(again.reason, "already-reminded"); assert.equal(first.key, again.key);
  assert.notEqual(first.key, decideStaleAssignment({ ...input(), now: "2026-09-07T00:00:00Z" }).key);
});
test("invalid policy, dates, future assignments and contradictory labels fail", () => {
  for (const date of ["bad", "2026-02-30T00:00:00Z", "2026-09-01", "2026-09-01T00:00:00+01:00"]) assert.throws(() => utcMillis(date));
  assert.throws(() => decideStaleAssignment({ ...input(), now: "2026-08-01T00:00:00Z" }), /future/);
  assert.throws(() => decideStaleAssignment({ ...input(), config: { ...DEFAULT_CONFIG, assignments: { ...DEFAULT_CONFIG.assignments, reminderAfterDays: -1 } } }), /policy/);
  const i = input(); i.issue.labels.push({ name: "status: ready" }); assert.throws(() => decideStaleAssignment(i), /Contradictory/);
});
test("timeline distinguishes bot assignment, manual ownership and reassignment epochs", () => {
  const i = input().issue;
  assert.equal(managedAssignment(i, [timelineEvent], 41898282).eventId, 100);
  assert.equal(managedAssignment(i, [{ ...timelineEvent, actor: { id: 4, type: "User" } }], 41898282), null);
  assert.throws(() => managedAssignment(i, [], 41898282), /absent/);
  assert.throws(() => managedAssignment(i, [{ ...timelineEvent, created_at: "invalid" }], 41898282));
  const unassigned = { ...timelineEvent, id: 101, event: "unassigned", created_at: "2026-09-02T00:00:00Z" };
  const reassigned = { ...timelineEvent, id: 102, created_at: "2026-09-03T00:00:00Z" };
  assert.equal(managedAssignment(i, [reassigned, timelineEvent, unassigned], 41898282).eventId, 102);
});
test("scanner posts one reminder across repeated schedule delivery and preserves ownership", async () => {
  const c = scannerClient();
  assert.equal((await run(c)).type, "reminded");
  assert.equal((await run(c)).reason, "already-reminded");
  assert.equal(c.comments.length, 1);
  assert.deepEqual(c.issue.assignees, [{ login: "alice" }]);
  assert.deepEqual(c.calls, ["comment"]);
});
test("dry run collects real evidence without comments", async () => {
  const c = scannerClient(); assert.equal((await run(c, { dryRun: true })).type, "remind"); assert.equal(c.comments.length, 0);
});
test("scanner suppresses linked PR and API failure cannot post reminders", async () => {
  const c = scannerClient(); c.linked = [{ id: "PR_1", number: 1, url: "https://github.com/o/r/pull/1", state: "OPEN", isDraft: false, mergedAt: null, repository: { nameWithOwner: "o/r" } }];
  assert.equal((await run(c)).reason, "linked-open-pr"); assert.equal(c.comments.length, 0);
  c.request = async () => { throw new Error("GitHub API failed"); };
  await assert.rejects(run(c), /API failed/); assert.equal(c.comments.length, 0);
});
test("ownership changed before execution prevents reminder", async () => {
  const c = scannerClient(); let reads = 0; const get = c.getIssue;
  c.getIssue = async () => { reads++; if (reads === 2) c.issue.assignees = []; return get(); };
  assert.equal((await run(c)).reason, "state-changed-before-reminder"); assert.equal(c.comments.length, 0);
});
test("repository scan excludes PRs and duplicate pagination entries", async () => {
  const c = scannerClient(); const paginate = c.paginate;
  c.paginate = async (path) => path.includes("timeline") ? paginate(path) : [{ number: 1, pull_request: {} }, c.issue, c.issue];
  const results = await scanRepository({ client: c, config: DEFAULT_CONFIG, now: input().now, dryRun: true });
  assert.equal(results.length, 1); assert.equal(results[0].issueNumber, 2);
});
test("autoRelease true still only reminds even after expiry", async () => {
  const c = scannerClient();
  await run(c, { now: "2026-09-30T00:00:00Z", config: { ...DEFAULT_CONFIG, assignments: { ...DEFAULT_CONFIG.assignments, autoRelease: true } } });
  assert.deepEqual(c.calls, ["comment"]); assert.equal(c.issue.assignees.length, 1);
});

test("lost reminder POST response recovers the existing pending receipt", async () => {
  const c = scannerClient(); const add = c.addComment;
  c.addComment = async (...args) => { await add(...args); throw new Error("lost POST response"); };
  await assert.rejects(run(c), /lost POST/);
  c.addComment = add;
  assert.equal((await run(c)).type, "reminded");
  assert.equal(c.comments.length, 1);
  assert.equal((await run(c)).reason, "already-reminded");
});
