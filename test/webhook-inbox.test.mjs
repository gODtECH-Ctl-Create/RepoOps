import test from "node:test";
import assert from "node:assert/strict";

import { createWebhookDelivery } from "../src/core/webhook-delivery.mjs";
import {
  WEBHOOK_INBOX_RECOVERY,
  WEBHOOK_INBOX_STATES,
  WebhookInboxTransitionError,
  WebhookInboxValidationError,
  assertWebhookInboxStore,
  claimWebhookInboxRecord,
  classifyWebhookInboxRecovery,
  createWebhookInboxRecord,
  finishWebhookInboxRecord,
  isWebhookInboxTerminal,
  queueWebhookInboxRecord,
  recoverAbandonedWebhookInboxRecord,
  validateWebhookInboxRecord
} from "../src/core/webhook-inbox.mjs";

function delivery(overrides = {}) {
  return createWebhookDelivery({
    deliveryId: "12345678-1234-4abc-8def-1234567890ab",
    eventName: "issue_comment",
    action: "created",
    installationId: 101,
    repositoryId: 202,
    receivedAt: "2026-09-29T02:15:00Z",
    ...overrides
  });
}

function receivedRecord(body = '{"action":"created"}') {
  return createWebhookInboxRecord({ delivery: delivery(), authenticatedPayload: body });
}

function queuedRecord() {
  return queueWebhookInboxRecord(receivedRecord(), { now: "2026-09-29T02:15:01Z" });
}

function processingRecord(overrides = {}) {
  return claimWebhookInboxRecord(queuedRecord(), {
    workerId: "worker-1",
    now: "2026-09-29T02:15:02Z",
    leaseMs: 30_000,
    ...overrides
  });
}

test("creates an immutable received record with payload integrity metadata only", () => {
  const body = '{"action":"created","comment":{"body":"/claim"}}';
  const record = receivedRecord(body);

  assert.equal(record.state, WEBHOOK_INBOX_STATES.RECEIVED);
  assert.equal(record.id, record.delivery.id);
  assert.equal(record.payload.byteLength, Buffer.byteLength(body));
  assert.match(record.payload.sha256, /^[a-f0-9]{64}$/);
  assert.equal(record.attemptCount, 0);
  assert.equal(record.version, 0);
  assert.equal(record.createdAt, "2026-09-29T02:15:00.000Z");
  assert.equal(Object.hasOwn(record, "authenticatedPayload"), false);
  assert.equal(Object.hasOwn(record, "rawBody"), false);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.payload), true);
});

test("normal lifecycle queues, leases, processes and completes deterministically", () => {
  const received = receivedRecord();
  const queued = queueWebhookInboxRecord(received, { now: "2026-09-29T02:15:01Z" });
  const processing = claimWebhookInboxRecord(queued, {
    workerId: "worker-1",
    now: "2026-09-29T02:15:02Z",
    leaseMs: 30_000
  });
  const completed = finishWebhookInboxRecord(processing, {
    outcome: WEBHOOK_INBOX_STATES.COMPLETED,
    now: "2026-09-29T02:15:03Z"
  });

  assert.equal(queued.state, WEBHOOK_INBOX_STATES.QUEUED);
  assert.equal(queued.version, 1);
  assert.equal(processing.state, WEBHOOK_INBOX_STATES.PROCESSING);
  assert.equal(processing.processingMode, "normal");
  assert.equal(processing.attemptCount, 1);
  assert.deepEqual(processing.lease, {
    workerId: "worker-1",
    acquiredAt: "2026-09-29T02:15:02.000Z",
    expiresAt: "2026-09-29T02:15:32.000Z"
  });
  assert.equal(completed.state, WEBHOOK_INBOX_STATES.COMPLETED);
  assert.equal(completed.lease, null);
  assert.equal(completed.processingMode, null);
  assert.equal(completed.version, 3);
  assert.equal(isWebhookInboxTerminal(completed), true);
});

test("retry wait records future scheduling instead of sleeping and only requeues when due", () => {
  const retry = finishWebhookInboxRecord(processingRecord(), {
    outcome: WEBHOOK_INBOX_STATES.RETRY_WAIT,
    now: "2026-09-29T02:15:03Z",
    reason: "github-rate-limit",
    nextAttemptAt: "2026-09-29T02:20:00Z"
  });

  assert.equal(retry.state, WEBHOOK_INBOX_STATES.RETRY_WAIT);
  assert.equal(retry.reason, "github-rate-limit");
  assert.equal(retry.nextAttemptAt, "2026-09-29T02:20:00.000Z");
  assert.equal(classifyWebhookInboxRecovery(retry, { now: "2026-09-29T02:19:59Z" }), null);
  assert.equal(classifyWebhookInboxRecovery(retry, { now: "2026-09-29T02:20:00Z" }), WEBHOOK_INBOX_RECOVERY.RETRY_DUE);

  assert.throws(
    () => queueWebhookInboxRecord(retry, { now: "2026-09-29T02:19:59Z" }),
    WebhookInboxTransitionError
  );
  const queued = queueWebhookInboxRecord(retry, { now: "2026-09-29T02:20:00Z" });
  const secondAttempt = claimWebhookInboxRecord(queued, {
    workerId: "worker-2",
    now: "2026-09-29T02:20:01Z"
  });
  assert.equal(secondAttempt.attemptCount, 2);
});

test("ambiguous processing outcome becomes reconciliation work, not ordinary retry", () => {
  const reconcile = finishWebhookInboxRecord(processingRecord(), {
    outcome: WEBHOOK_INBOX_STATES.RECONCILE_REQUIRED,
    now: "2026-09-29T02:15:03Z",
    reason: "mutation-response-lost"
  });

  assert.equal(classifyWebhookInboxRecovery(reconcile, { now: "2026-09-29T02:15:04Z" }), WEBHOOK_INBOX_RECOVERY.RECONCILIATION_REQUIRED);
  const processing = claimWebhookInboxRecord(reconcile, {
    workerId: "reconciler-1",
    now: "2026-09-29T02:15:04Z"
  });
  assert.equal(processing.processingMode, "reconcile");
  assert.equal(processing.attemptCount, 2);
});

test("expired processing lease is classified and recovered into reconciliation", () => {
  const processing = processingRecord({ leaseMs: 5_000 });
  assert.equal(classifyWebhookInboxRecovery(processing, { now: "2026-09-29T02:15:06Z" }), null);
  assert.equal(classifyWebhookInboxRecovery(processing, { now: "2026-09-29T02:15:07Z" }), WEBHOOK_INBOX_RECOVERY.ABANDONED_PROCESSING);

  assert.throws(
    () => recoverAbandonedWebhookInboxRecord(processing, { now: "2026-09-29T02:15:06Z" }),
    WebhookInboxTransitionError
  );
  const recovered = recoverAbandonedWebhookInboxRecord(processing, { now: "2026-09-29T02:15:07Z" });
  assert.equal(recovered.state, WEBHOOK_INBOX_STATES.RECONCILE_REQUIRED);
  assert.equal(recovered.reason, "worker-lease-expired");
  assert.equal(recovered.lease, null);
});

test("terminal outcomes stay terminal and cannot be silently reprocessed", () => {
  for (const outcome of [
    WEBHOOK_INBOX_STATES.NO_OP,
    WEBHOOK_INBOX_STATES.COMPLETED,
    WEBHOOK_INBOX_STATES.FAILED_PERMANENT,
    WEBHOOK_INBOX_STATES.DEAD_LETTER
  ]) {
    const terminal = finishWebhookInboxRecord(processingRecord(), {
      outcome,
      now: "2026-09-29T02:15:03Z",
      reason: [WEBHOOK_INBOX_STATES.FAILED_PERMANENT, WEBHOOK_INBOX_STATES.DEAD_LETTER].includes(outcome)
        ? "terminal-failure"
        : null
    });
    assert.equal(isWebhookInboxTerminal(terminal), true);
    assert.throws(
      () => claimWebhookInboxRecord(terminal, { workerId: "worker-2", now: "2026-09-29T02:15:04Z" }),
      WebhookInboxTransitionError
    );
    assert.throws(
      () => queueWebhookInboxRecord(terminal, { now: "2026-09-29T02:15:04Z" }),
      WebhookInboxTransitionError
    );
  }
});

test("dead-letter records are operator-visible recovery class but not automatically retried", () => {
  const dead = finishWebhookInboxRecord(processingRecord(), {
    outcome: WEBHOOK_INBOX_STATES.DEAD_LETTER,
    now: "2026-09-29T02:15:03Z",
    reason: "retry-budget-exhausted"
  });
  assert.equal(classifyWebhookInboxRecovery(dead, { now: "2026-09-29T02:30:00Z" }), WEBHOOK_INBOX_RECOVERY.DEAD_LETTER);
});

test("validation rejects non-monotonic timestamps and malformed persisted state", () => {
  const queued = queuedRecord();
  assert.throws(
    () => claimWebhookInboxRecord(queued, { workerId: "worker-1", now: "2026-09-29T02:14:59Z" }),
    WebhookInboxValidationError
  );

  assert.throws(
    () => validateWebhookInboxRecord({ ...queued, state: WEBHOOK_INBOX_STATES.PROCESSING, lease: null }),
    WebhookInboxValidationError
  );
  assert.throws(
    () => validateWebhookInboxRecord({ ...queued, payload: { ...queued.payload, sha256: "not-a-hash" } }),
    WebhookInboxValidationError
  );
});

test("retry and failure outcomes require valid scheduling and reason metadata", () => {
  const processing = processingRecord();
  assert.throws(
    () => finishWebhookInboxRecord(processing, {
      outcome: WEBHOOK_INBOX_STATES.RETRY_WAIT,
      now: "2026-09-29T02:15:03Z",
      reason: "github-5xx",
      nextAttemptAt: "2026-09-29T02:15:03Z"
    }),
    WebhookInboxValidationError
  );
  assert.throws(
    () => finishWebhookInboxRecord(processing, {
      outcome: WEBHOOK_INBOX_STATES.RECONCILE_REQUIRED,
      now: "2026-09-29T02:15:03Z"
    }),
    WebhookInboxValidationError
  );
});

test("store contract requires atomic insert, CAS and all recovery query surfaces", () => {
  const completeStore = {
    find() {},
    insertIfAbsent() {},
    compareAndSwap() {},
    listRetryDue() {},
    listReconcileRequired() {},
    listAbandonedProcessing() {},
    listDeadLetter() {}
  };
  assert.equal(assertWebhookInboxStore(completeStore), completeStore);

  for (const missing of Object.keys(completeStore)) {
    const store = { ...completeStore };
    delete store[missing];
    assert.throws(() => assertWebhookInboxStore(store), WebhookInboxValidationError);
  }
});
