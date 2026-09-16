import test from "node:test";
import assert from "node:assert/strict";
import { createOperationalEvent, EventConflictError } from "../src/core/events.mjs";
import { projectCompletedContributions, priorContributionStatus } from "../src/core/contributions.mjs";

const repository = { id: 10, fullName: "owner/repo" };

function githubEvent({ type, timestamp, resource, eventId, actorId = 99, assigneeId }) {
  const sourceByType = {
    "github.issue.assigned": ["issues", "assigned"],
    "github.issue.unassigned": ["issues", "unassigned"],
    "github.issue.closed": ["issues", "closed"],
    "github.pull_request.merged": ["pull_request", "closed"]
  };
  const [eventName, action] = sourceByType[type];
  return createOperationalEvent({
    schemaVersion: 1,
    type,
    timestamp,
    repository,
    actor: { kind: "user", id: actorId },
    resource,
    source: { kind: "github", eventName, action, eventId },
    metadata: assigneeId ? { assigneeId } : {}
  });
}

function issueResource(id, number) {
  return { type: "issue", id, number };
}

function prResource(id, number) {
  return { type: "pull_request", id, number };
}

function linkedIssue({ issueId = 200, issueNumber = 20, prNumber = 30, mergedAt = "2026-09-16T10:00:00Z" } = {}) {
  return {
    relationship: "github-closing-reference",
    repository,
    issue: { id: issueId, number: issueNumber },
    pullRequests: [{
      id: `node-${prNumber}`,
      number: prNumber,
      repository: repository.fullName,
      url: `https://github.com/${repository.fullName}/pull/${prNumber}`,
      state: "merged",
      isDraft: false,
      mergedAt
    }]
  };
}

function completedFixture({ contributorId = 42, issueId = 200, issueNumber = 20, prId = 300, prNumber = 30, mergedAt = "2026-09-16T10:00:00Z", eventOffset = 0 } = {}) {
  return {
    events: [
      githubEvent({
        type: "github.issue.assigned",
        timestamp: "2026-09-16T09:00:00Z",
        resource: issueResource(issueId, issueNumber),
        eventId: 1000 + eventOffset,
        assigneeId: contributorId
      }),
      githubEvent({
        type: "github.pull_request.merged",
        timestamp: mergedAt,
        resource: prResource(prId, prNumber),
        eventId: 1001 + eventOffset
      })
    ],
    linked: linkedIssue({ issueId, issueNumber, prNumber, mergedAt })
  };
}

test("projects a deterministic completed issue → contributor → PR record", () => {
  const fixture = completedFixture();
  const result = projectCompletedContributions(fixture.events, [fixture.linked]);
  assert.equal(result.completed.length, 1);
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.completed[0].contributorId, 42);
  assert.deepEqual(result.completed[0].issue, { id: 200, number: 20 });
  assert.deepEqual(result.completed[0].pullRequest, { repository: "owner/repo", number: 30 });
  assert.equal(result.completed[0].completedAt, "2026-09-16T10:00:00.000Z");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.completed[0]));
});

test("exact replay does not duplicate completed contribution history", () => {
  const fixture = completedFixture();
  const result = projectCompletedContributions([...fixture.events, ...fixture.events], [fixture.linked]);
  assert.equal(result.completed.length, 1);
});

test("conflicting event replay fails instead of being silently collapsed", () => {
  const first = githubEvent({ type: "github.issue.assigned", timestamp: "2026-09-16T09:00:00Z", resource: issueResource(200, 20), eventId: 77, assigneeId: 42 });
  const conflict = githubEvent({ type: "github.issue.assigned", timestamp: "2026-09-16T09:05:00Z", resource: issueResource(200, 20), eventId: 77, assigneeId: 42 });
  assert.throws(() => projectCompletedContributions([first, conflict], []), EventConflictError);
});

test("first/returning status uses only completed work before the cutoff", () => {
  const first = completedFixture({ issueId: 201, issueNumber: 21, prId: 301, prNumber: 31, mergedAt: "2026-09-15T10:00:00Z", eventOffset: 10 });
  const second = completedFixture({ issueId: 202, issueNumber: 22, prId: 302, prNumber: 32, mergedAt: "2026-09-16T10:00:00Z", eventOffset: 20 });
  const projection = projectCompletedContributions([...first.events, ...second.events], [first.linked, second.linked]);
  assert.equal(priorContributionStatus(projection, 42, "2026-09-15T10:00:00Z"), "first");
  assert.equal(priorContributionStatus(projection, 42, "2026-09-16T10:00:00Z"), "returning");
  assert.equal(priorContributionStatus(projection, 77, "2026-09-16T10:00:00Z"), "first");
});

test("earlier unresolved completion makes first-contribution status unknown", () => {
  const unresolvedLink = linkedIssue({ issueId: 210, issueNumber: 40, prNumber: 50, mergedAt: "2026-09-15T10:00:00Z" });
  const merge = githubEvent({ type: "github.pull_request.merged", timestamp: "2026-09-15T10:00:00Z", resource: prResource(500, 50), eventId: 5000 });
  const projection = projectCompletedContributions([merge], [unresolvedLink]);
  assert.equal(projection.unresolved[0].reason, "missing-assignee");
  assert.equal(priorContributionStatus(projection, 42, "2026-09-16T10:00:00Z"), "unknown");
});

test("multiple active assignees remain unresolved rather than guessing a contributor", () => {
  const linked = linkedIssue();
  const events = [
    githubEvent({ type: "github.issue.assigned", timestamp: "2026-09-16T08:00:00Z", resource: issueResource(200, 20), eventId: 6000, assigneeId: 42 }),
    githubEvent({ type: "github.issue.assigned", timestamp: "2026-09-16T08:10:00Z", resource: issueResource(200, 20), eventId: 6001, assigneeId: 43 }),
    githubEvent({ type: "github.pull_request.merged", timestamp: "2026-09-16T10:00:00Z", resource: prResource(300, 30), eventId: 6002 })
  ];
  const result = projectCompletedContributions(events, [linked]);
  assert.equal(result.completed.length, 0);
  assert.equal(result.unresolved[0].reason, "ambiguous-assignee");
});

test("reopened/reclosed observations do not duplicate a merged contribution", () => {
  const fixture = completedFixture();
  const events = [
    ...fixture.events,
    githubEvent({ type: "github.issue.closed", timestamp: "2026-09-16T10:01:00Z", resource: issueResource(200, 20), eventId: 7000 }),
    githubEvent({ type: "github.issue.closed", timestamp: "2026-09-16T11:00:00Z", resource: issueResource(200, 20), eventId: 7001 })
  ];
  const result = projectCompletedContributions(events, [fixture.linked]);
  assert.equal(result.completed.length, 1);
});

test("merged PR event without an authoritative issue relationship does not create history", () => {
  const merge = githubEvent({ type: "github.pull_request.merged", timestamp: "2026-09-16T10:00:00Z", resource: prResource(300, 30), eventId: 8000 });
  const result = projectCompletedContributions([merge], []);
  assert.deepEqual(result.completed, []);
  assert.deepEqual(result.unresolved, []);
});

test("unknown/malformed event and relationship input fails explicitly", () => {
  const fixture = completedFixture();
  const unknown = { ...fixture.events[0], type: "future.contribution.event" };
  assert.throws(() => projectCompletedContributions([unknown], [fixture.linked]));
  assert.throws(() => projectCompletedContributions(fixture.events, [{ ...fixture.linked, relationship: "guessed-from-text" }]));
  assert.throws(() => projectCompletedContributions(fixture.events, [{ ...fixture.linked, pullRequests: [...fixture.linked.pullRequests, fixture.linked.pullRequests[0]] }]));
});
