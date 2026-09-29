import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  WEBHOOK_INBOX_STATES,
  claimWebhookInboxRecord,
  createWebhookInboxRecord,
  finishWebhookInboxRecord,
  queueWebhookInboxRecord
} from "../src/core/webhook-inbox.mjs";
import { createWebhookDelivery } from "../src/core/webhook-delivery.mjs";
import { createPostgresPool } from "../src/control-plane/postgres/database.mjs";
import { runPostgresMigrations } from "../src/control-plane/postgres/migrations.mjs";
import {
  PostgresWebhookInboxConflictError,
  PostgresWebhookPayloadIntegrityError,
  createPostgresWebhookInboxStore
} from "../src/control-plane/postgres/webhook-inbox-store.mjs";

const databaseUrl = process.env.REPOOPS_TEST_DATABASE_URL ?? "";
const skip = !databaseUrl;
let pool;
let store;

function guid(number) {
  return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

function delivery(number, overrides = {}) {
  return createWebhookDelivery({
    deliveryId: guid(number),
    eventName: "issue_comment",
    action: "created",
    installationId: 101,
    repositoryId: 202,
    receivedAt: "2026-09-29T06:00:00Z",
    ...overrides
  });
}

function received(number, payload = `payload-${number}`, overrides = {}) {
  return {
    payload,
    record: createWebhookInboxRecord({
      delivery: delivery(number, overrides),
      authenticatedPayload: payload
    })
  };
}

async function insert(number, payload = `payload-${number}`, overrides = {}) {
  const input = received(number, payload, overrides);
  const result = await store.insertIfAbsent(input.record, input.payload);
  assert.equal(result.type, "inserted");
  return { ...input, record: result.record };
}

async function persistTransition(current, next) {
  const result = await store.compareAndSwap(current.id, current.version, next);
  assert.equal(result.type, "updated");
  return result.record;
}

before(async () => {
  if (skip) return;
  pool = createPostgresPool({ env: { REPOOPS_DATABASE_URL: databaseUrl }, max: 4 });
  await runPostgresMigrations({ pool });
  store = createPostgresWebhookInboxStore({ pool });
});

beforeEach(async () => {
  if (skip) return;
  await pool.query("TRUNCATE TABLE repoops_webhook_inbox");
});

after(async () => {
  if (pool) await pool.end();
});

test("PostgreSQL migrations are repeatable and record immutable migration history", { skip }, async () => {
  const result = await runPostgresMigrations({ pool });
  assert.deepEqual(result.applied, []);
  assert.equal(result.currentVersion, 1);

  const history = await pool.query(
    "SELECT version, name, checksum FROM repoops_schema_migrations ORDER BY version"
  );
  assert.equal(history.rows.length, 1);
  assert.equal(Number(history.rows[0].version), 1);
  assert.equal(history.rows[0].name, "webhook_inbox");
  assert.match(history.rows[0].checksum.trim(), /^[a-f0-9]{64}$/);

  const indexes = await pool.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = current_schema()
       AND tablename = 'repoops_webhook_inbox'`
  );
  const names = new Set(indexes.rows.map((row) => row.indexname));
  for (const name of [
    "repoops_webhook_inbox_retry_due_idx",
    "repoops_webhook_inbox_abandoned_idx",
    "repoops_webhook_inbox_recovery_idx",
    "repoops_webhook_inbox_installation_repo_idx"
  ]) assert.equal(names.has(name), true);
});

test("insert-if-absent converges duplicate deliveries without replacing payload", { skip }, async () => {
  const first = received(1, "original-payload");
  const inserted = await store.insertIfAbsent(first.record, first.payload);
  assert.equal(inserted.type, "inserted");

  const duplicate = await store.insertIfAbsent(first.record, first.payload);
  assert.equal(duplicate.type, "existing");
  assert.equal(duplicate.record.id, first.record.id);

  const stored = await store.readWithPayload(first.record.id);
  assert.equal(stored.authenticatedPayload.toString("utf8"), "original-payload");

  const conflicting = received(1, "different-payload");
  await assert.rejects(
    () => store.insertIfAbsent(conflicting.record, conflicting.payload),
    PostgresWebhookInboxConflictError
  );

  const unchanged = await store.readWithPayload(first.record.id);
  assert.equal(unchanged.authenticatedPayload.toString("utf8"), "original-payload");
});

test("compare-and-swap advances exactly one persisted version and rejects stale writers", { skip }, async () => {
  const item = await insert(2, "cas-payload");
  const queued = queueWebhookInboxRecord(item.record, { now: "2026-09-29T06:00:01Z" });

  const first = await store.compareAndSwap(item.record.id, 0, queued);
  assert.equal(first.type, "updated");
  assert.equal(first.record.state, WEBHOOK_INBOX_STATES.QUEUED);
  assert.equal(first.record.version, 1);

  const stale = await store.compareAndSwap(item.record.id, 0, queued);
  assert.equal(stale.type, "conflict");
  assert.equal(stale.record.version, 1);
  assert.equal(stale.record.state, WEBHOOK_INBOX_STATES.QUEUED);

  const processing = claimWebhookInboxRecord(first.record, {
    workerId: "worker-a",
    now: "2026-09-29T06:00:02Z",
    leaseMs: 30_000
  });
  const second = await store.compareAndSwap(item.record.id, 1, processing);
  assert.equal(second.type, "updated");
  assert.equal(second.record.version, 2);
  assert.equal(second.record.lease.workerId, "worker-a");
});

test("recovery queries return only due work in deterministic order", { skip }, async () => {
  let retry = (await insert(10)).record;
  retry = await persistTransition(retry, queueWebhookInboxRecord(retry, { now: "2026-09-29T06:00:01Z" }));
  retry = await persistTransition(retry, claimWebhookInboxRecord(retry, {
    workerId: "retry-worker",
    now: "2026-09-29T06:00:02Z",
    leaseMs: 60_000
  }));
  retry = await persistTransition(retry, finishWebhookInboxRecord(retry, {
    outcome: WEBHOOK_INBOX_STATES.RETRY_WAIT,
    now: "2026-09-29T06:00:03Z",
    reason: "github-rate-limit",
    nextAttemptAt: "2026-09-29T06:10:00Z"
  }));

  let reconcile = (await insert(11)).record;
  reconcile = await persistTransition(reconcile, queueWebhookInboxRecord(reconcile, { now: "2026-09-29T06:00:01Z" }));
  reconcile = await persistTransition(reconcile, claimWebhookInboxRecord(reconcile, {
    workerId: "reconcile-worker",
    now: "2026-09-29T06:00:02Z",
    leaseMs: 60_000
  }));
  reconcile = await persistTransition(reconcile, finishWebhookInboxRecord(reconcile, {
    outcome: WEBHOOK_INBOX_STATES.RECONCILE_REQUIRED,
    now: "2026-09-29T06:00:03Z",
    reason: "mutation-response-lost"
  }));

  let abandoned = (await insert(12)).record;
  abandoned = await persistTransition(abandoned, queueWebhookInboxRecord(abandoned, { now: "2026-09-29T06:00:01Z" }));
  abandoned = await persistTransition(abandoned, claimWebhookInboxRecord(abandoned, {
    workerId: "abandoned-worker",
    now: "2026-09-29T06:00:02Z",
    leaseMs: 5_000
  }));

  let dead = (await insert(13)).record;
  dead = await persistTransition(dead, queueWebhookInboxRecord(dead, { now: "2026-09-29T06:00:01Z" }));
  dead = await persistTransition(dead, claimWebhookInboxRecord(dead, {
    workerId: "dead-worker",
    now: "2026-09-29T06:00:02Z",
    leaseMs: 60_000
  }));
  dead = await persistTransition(dead, finishWebhookInboxRecord(dead, {
    outcome: WEBHOOK_INBOX_STATES.DEAD_LETTER,
    now: "2026-09-29T06:00:03Z",
    reason: "retry-budget-exhausted"
  }));

  assert.deepEqual(await store.listRetryDue("2026-09-29T06:09:59Z", 10), []);
  assert.deepEqual(
    (await store.listRetryDue("2026-09-29T06:10:00Z", 10)).map((record) => record.id),
    [retry.id]
  );
  assert.deepEqual(
    (await store.listReconcileRequired(10)).map((record) => record.id),
    [reconcile.id]
  );
  assert.deepEqual(
    (await store.listAbandonedProcessing("2026-09-29T06:00:07Z", 10)).map((record) => record.id),
    [abandoned.id]
  );
  assert.deepEqual(
    (await store.listDeadLetter(10)).map((record) => record.id),
    [dead.id]
  );
});

test("processing reads detect same-length payload tampering", { skip }, async () => {
  const item = await insert(20, "abc");
  await pool.query(
    "UPDATE repoops_webhook_inbox SET payload_bytes = $2 WHERE id = $1",
    [item.record.id, Buffer.from("abd", "utf8")]
  );

  await assert.rejects(
    () => store.readWithPayload(item.record.id),
    PostgresWebhookPayloadIntegrityError
  );
});

test("repository-scoped reads preserve installation boundaries", { skip }, async () => {
  const first = await insert(30, "one", { installationId: 501, repositoryId: 9001 });
  await insert(31, "two", { installationId: 502, repositoryId: 9001 });
  await insert(32, "three", { installationId: 501, repositoryId: 9002 });

  const scoped = await store.listForRepository({
    installationId: 501,
    repositoryId: 9001,
    limit: 10
  });
  assert.deepEqual(scoped.map((record) => record.id), [first.record.id]);
});

test("database constraints reject invalid processing rows independently of application validation", { skip }, async () => {
  const item = await insert(40);
  await assert.rejects(
    () => pool.query(
      `UPDATE repoops_webhook_inbox
       SET state = 'PROCESSING', processing_mode = 'normal', attempt_count = 1
       WHERE id = $1`,
      [item.record.id]
    ),
    (error) => error?.code === "23514"
  );
});
