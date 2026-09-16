import test from "node:test";
import assert from "node:assert/strict";
import { createOperationalEvent, validateOperationalEvent, appendOperationalEvent, EVENT_TYPES, EventConflictError } from "../src/core/events.mjs";
import { operationKey } from "../src/core/idempotency.mjs";

const facts = () => ({
  schemaVersion: 1, type: "issue.claimed", timestamp: "2026-09-16T00:00:00Z",
  repository: { id: 10, fullName: "owner/repo" }, actor: { kind: "user", id: 30 },
  resource: { type: "issue", id: 20, number: 19 },
  source: { kind: "repoops", occurrence: 1, operationKey: operationKey({ repositoryId: 10, issueId: 20, event: "issue_comment", action: "created", sourceId: 40 }) },
  metadata: { assigneeId: 30 }
});
const examples = {
  "issue.claimed": { assigneeId: 30 },
  "issue.unclaimed": { assigneeId: 30 },
  "issue.blocked": { reasonCode: "dependency" },
  "assignment.reminder_sent": { assigneeId: 30, assignmentEventId: 50, window: 1, reminderAfterDays: 3 },
  "assignment.expired": { assigneeId: 30, assignmentEventId: 50, expireAfterDays: 7 },
  "pull_request.state_changed": { from: "waiting-for-ci", to: "waiting-for-review" },
  "operation.failed": { action: "claim", reasonCode: "github-api-error" },
  "operation.ambiguous": { action: "claim", reasonCode: "unknown-mutation-result" },
  "github.issue.assigned": { assigneeId: 30 },
  "github.issue.unassigned": { assigneeId: 30 },
  "github.issue.closed": {},
  "github.pull_request.merged": {}
};
for (const type of EVENT_TYPES) test(`version 1 round trip: ${type}`, () => {
  const input = facts(); input.type = type; input.metadata = examples[type];
  if (type.includes("pull_request")) input.resource.type = "pull_request";
  if (type.startsWith("github.")) input.source = { kind: "github", eventName: type.includes("pull_request") ? "pull_request" : "issues", action: type.endsWith("merged") ? "closed" : type.split(".").at(-1), eventId: 60 };
  const event = createOperationalEvent(input);
  assert.deepEqual(validateOperationalEvent(JSON.parse(JSON.stringify(event))), event);
  assert.equal(event.timestamp, "2026-09-16T00:00:00.000Z");
});
test("stable identity uses operation context, event type and resource IDs", () => {
  const input = facts(); const original = createOperationalEvent(input);
  assert.equal(createOperationalEvent({ ...input, repository: { fullName: "owner/repo", id: 10 }, metadata: { assigneeId: 30 } }).id, original.id);
  assert.equal(createOperationalEvent({ ...input, timestamp: "2026-09-17T00:00:00Z" }).id, original.id);
  for (const patch of [{ type: "issue.unclaimed" }, { repository: { ...input.repository, id: 11 } }, { resource: { ...input.resource, id: 21 } }, { source: { kind: "repoops", occurrence: 1, operationKey: "a".repeat(64) } }]) assert.notEqual(createOperationalEvent({ ...input, ...patch }).id, original.id);
});
test("records are detached and deeply immutable", () => {
  const input = facts(); const event = createOperationalEvent(input);
  input.metadata.assigneeId = 99; assert.equal(event.metadata.assigneeId, 30);
  assert.throws(() => { event.metadata.assigneeId = 99; }, TypeError);
  assert.throws(() => { event.source.kind = "github"; }, TypeError);
});
test("append preserves history and deduplicates equivalent JSON replays", () => {
  const event = createOperationalEvent(facts()); const history = [event];
  const replay = JSON.parse(JSON.stringify(event)); replay.timestamp = "2026-09-16T00:00:00Z";
  assert.equal(appendOperationalEvent(history, replay).length, 1);
  const next = createOperationalEvent({ ...facts(), type: "issue.unclaimed" });
  const appended = appendOperationalEvent(history, next);
  assert.equal(history.length, 1); assert.deepEqual(appended, [event, next]);
  assert.ok(Object.isFrozen(appended));
});
test("conflicting payload or retry timestamp cannot silently overwrite history", () => {
  const event = createOperationalEvent(facts());
  for (const patch of [{ metadata: { assigneeId: 31 } }, { timestamp: "2026-09-17T00:00:00Z" }]) {
    const conflict = createOperationalEvent({ ...facts(), ...patch });
    assert.equal(conflict.id, event.id);
    assert.throws(() => appendOperationalEvent([event], conflict), EventConflictError);
  }
});
test("tampered identity, unknown versions and unknown types fail visibly", () => {
  const event = createOperationalEvent(facts());
  assert.throws(() => validateOperationalEvent({ ...event, id: "forged" }), /field: id/);
  assert.throws(() => createOperationalEvent({ ...facts(), schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => createOperationalEvent({ ...facts(), type: "future.event" }), /type/);
  assert.throws(() => appendOperationalEvent([{ ...event, schemaVersion: 2 }], event), /schemaVersion/);
});
test("schema rejects secret/raw payload fields without echoing their values", () => {
  for (const patch of [{ token: "sensitive-test-value" }, { metadata: { assigneeId: 30, body: "sensitive-test-value" } }, { actor: { kind: "user", id: 30, email: "sensitive-test-value" } }]) {
    assert.throws(() => createOperationalEvent({ ...facts(), ...patch }), (error) => !error.message.includes("sensitive-test-value"));
  }
});
test("timestamps require real UTC calendar dates", () => {
  for (const timestamp of ["2026-02-30T00:00:00Z", "2026-09-16", "2026-09-16T01:00:00+01:00", "invalid", null]) assert.throws(() => createOperationalEvent({ ...facts(), timestamp }), /timestamp/);
});
test("malformed numeric identities and actor types are rejected", () => {
  for (const id of [0, -1, 1.5, "20", NaN, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => createOperationalEvent({ ...facts(), resource: { type: "issue", id, number: 19 } }));
  assert.throws(() => createOperationalEvent({ ...facts(), actor: { kind: "user", id: null } }));
  assert.equal(createOperationalEvent({ ...facts(), actor: { kind: "system", id: null } }).actor.kind, "system");
});
test("source kinds and resource types cannot misrepresent event origin", () => {
  assert.throws(() => createOperationalEvent({ ...facts(), source: { kind: "github", eventName: "issues", action: "assigned", eventId: 50 } }));
  assert.throws(() => createOperationalEvent({ ...facts(), type: "github.issue.assigned" }));
  assert.throws(() => createOperationalEvent({ ...facts(), resource: { type: "pull_request", id: 20, number: 19 } }));
});
test("metadata rejects contradictory or nonsensical facts", () => {
  assert.throws(() => createOperationalEvent({ ...facts(), type: "assignment.reminder_sent", metadata: { assigneeId: 30, assignmentEventId: 50, window: 0, reminderAfterDays: 3 } }));
  assert.throws(() => createOperationalEvent({ ...facts(), type: "issue.blocked", metadata: { reasonCode: "free form reason" } }));
  assert.throws(() => createOperationalEvent({ ...facts(), type: "pull_request.state_changed", resource: { type: "pull_request", id: 20, number: 19 }, metadata: { from: "unknown", to: "unknown" } }));
});
test("non-JSON records and getters are rejected without invoking getters", () => {
  let invoked = false; const input = facts(); Object.defineProperty(input, "metadata", { get() { invoked = true; return {}; }, enumerable: true });
  assert.throws(() => createOperationalEvent(input)); assert.equal(invoked, false);
  for (const input of [null, [], new Date(), {}]) assert.throws(() => createOperationalEvent(input));
});

test("diagnostic attempts are distinct only with explicit producer occurrence IDs", () => {
  const input = { ...facts(), type: "operation.failed", metadata: { action: "claim", reasonCode: "github-api-error" } };
  const first = createOperationalEvent(input);
  const second = createOperationalEvent({ ...input, source: { ...input.source, occurrence: 2 } });
  assert.notEqual(first.id, second.id);
  assert.equal(appendOperationalEvent([first], second).length, 2);
  assert.throws(() => createOperationalEvent({ ...input, source: { ...input.source, occurrence: 0 } }));
});
