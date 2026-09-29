import test from "node:test";
import assert from "node:assert/strict";

import { createWebhookDelivery } from "../src/core/webhook-delivery.mjs";
import {
  WEBHOOK_INBOX_STATES,
  WebhookInboxValidationError,
  claimWebhookInboxRecord,
  createWebhookInboxRecord,
  finishWebhookInboxRecord,
  queueWebhookInboxRecord,
  validateWebhookInboxRecord
} from "../src/core/webhook-inbox.mjs";

function processingRecord({ leaseMs = 5_000 } = {}) {
  const delivery = createWebhookDelivery({
    deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    eventName: "issues",
    action: "closed",
    installationId: 11,
    repositoryId: 22,
    receivedAt: "2026-09-29T02:30:00Z"
  });
  const received = createWebhookInboxRecord({
    delivery,
    authenticatedPayload: '{"action":"closed"}'
  });
  const queued = queueWebhookInboxRecord(received, { now: "2026-09-29T02:30:01Z" });
  return claimWebhookInboxRecord(queued, {
    workerId: "worker-a",
    now: "2026-09-29T02:30:02Z",
    leaseMs
  });
}

test("a worker cannot finalize a record after its lease expired", () => {
  const processing = processingRecord();
  assert.throws(
    () => finishWebhookInboxRecord(processing, {
      outcome: WEBHOOK_INBOX_STATES.COMPLETED,
      now: "2026-09-29T02:30:07Z"
    }),
    (error) => error instanceof WebhookInboxValidationError && /lease\.expired/.test(error.message)
  );
});

test("persisted retry time must remain later than the retry-state update", () => {
  const processing = processingRecord({ leaseMs: 60_000 });
  const retry = finishWebhookInboxRecord(processing, {
    outcome: WEBHOOK_INBOX_STATES.RETRY_WAIT,
    now: "2026-09-29T02:30:03Z",
    reason: "github-5xx",
    nextAttemptAt: "2026-09-29T02:35:00Z"
  });

  assert.throws(
    () => validateWebhookInboxRecord({ ...retry, nextAttemptAt: retry.updatedAt }),
    WebhookInboxValidationError
  );
});

test("persisted processing lease acquisition must match the record update version", () => {
  const processing = processingRecord();
  assert.throws(
    () => validateWebhookInboxRecord({
      ...processing,
      lease: { ...processing.lease, acquiredAt: "2026-09-29T02:30:01Z" }
    }),
    WebhookInboxValidationError
  );
});

test("states that do not diagnose a failure reject stale reason metadata", () => {
  const processing = processingRecord();
  assert.throws(
    () => validateWebhookInboxRecord({ ...processing, reason: "stale-error" }),
    WebhookInboxValidationError
  );

  const completed = finishWebhookInboxRecord(processing, {
    outcome: WEBHOOK_INBOX_STATES.COMPLETED,
    now: "2026-09-29T02:30:03Z"
  });
  assert.throws(
    () => validateWebhookInboxRecord({ ...completed, reason: "should-not-survive" }),
    WebhookInboxValidationError
  );
});
