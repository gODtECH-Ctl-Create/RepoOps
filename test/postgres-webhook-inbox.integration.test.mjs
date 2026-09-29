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
import {
  PostgresMigrationValidationError,
  runPostgresMigrations
} from "../src/control-plane/postgres/migrations.mjs";
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
  pool = createPostgresPool({ env: { REPOOPS_DATABASE_URL: databaseUrl }, max: 6 });
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

test("migration checksum drift is rejected rather than silently accepting edited history", { skip }, async () => {
  const current = await pool.query(
    "SELECT checksum FROM repoops_schema_migrations WHERE version = 1"
  );
  const original = current.rows[0].checksum.trim();

  await pool.query(
    "UPDATE repoops_schema_migrations SET checksum = $1 WHERE version = 1",
    ["0".repeat(64)]
  );

  try {
    await assert.rejects(
      () => runPostgresMigrations({ pool }),
      PostgresMigrationValidationError
    );
  } finally {
    await pool.query(
      "UPDATE repoops_schema_migrations SET checksum = $1 WHERE version = 1",
      [original]
    );
  }
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

test("concurrent first acceptance produces exactly one insert and one duplicate", { skip }, async () => {
  const item = received(3, "concurrent-payload");
  const results = await Promise.all([
    store.insertIfAbsent(item.record, item.payload),
    store.insertIfAbsent(item.record, item.payload)
  ]);

  assert.deepEqual(results.map((result) => result.type).sort(), ["existing", "inserted"]);
  assert.equal(results[0].record.id, item.record.id);
  assert.equal(results[1].record.id, item.record.id);

  const count = await pool.query(
    "SELECT count(*)::int AS count FROM repoops_webhook_inbox WHERE id = $1",
    [item.record.id]
  );
  assert.equal(count.rows[0].count, 1);
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
});

test("two workers racing the same version cannot both acquire the processing lease", { skip }, async () => {
  const item = await insert(4, "lease-race");
  const queued = await persistTransition(
    item.record,
    queueWebhookInboxRecord(item.record, { now: "2026-09-29T06:00:01Z" })
  );

  const workerA = claimWebhookInboxRecord(queued, {
    workerId: "worker-a",
    now: "2026-09-29T06:00:02Z",
    leaseMs: 30_000
  });
  const workerB = claimWebhookInboxRecord(queued, {
    workerId: "worker-b",
    now: "2026-09-29T06:00:02Z",
    leaseMs: 30_000
  });

  const results = await Promise.all([
    store.compareAndSwap(queued.id, queued.version, workerA),
    store.compareAndSwap(queued.id, queued.version, workerB)
  ]);

  assert.deepEqual(results.map((result) => result.type).sort(), ["conflict", "updated"]);
  const current = await store.find(queued.id);
  assert.equal(current.version, 2);
  assert.equal(current.state, WEBHOOK_INBOX_STATES.PROCESSING);
  assert.equal(["worker-a", "worker-b"].includes(current.lease.workerId), true);
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

test('HTTP acceptance is durable across server restart and later concurrent redelivery', { skip }, async () => {
  const { createHmac } = await import('node:crypto');
  const { createControlPlaneServer } = await import('../src/control-plane/server.mjs');
  const { createWebhookHttpHandler } = await import('../src/control-plane/webhook-http.mjs');
  const secret = 'integration-test-only';
  const payload = Buffer.from(JSON.stringify({ action: 'created', installation: { id: 101 }, repository: { id: 202 }, comment: { body: '/claim café' } }));
  let timestamp = '2026-09-29T06:00:00.000Z';
  const start = async (inbox = store) => {
    const service = createControlPlaneServer({ webhookHandler: createWebhookHttpHandler({ secret, store: inbox, now: () => timestamp }) });
    await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
    return { service, url: `http://127.0.0.1:${service.server.address().port}/webhooks/github` };
  };
  const send = async (url, bytes = payload) => {
    const response = await fetch(url, { method: 'POST', body: bytes, headers: {
      'content-type': 'application/json', 'x-github-event': 'issue_comment', 'x-github-delivery': guid(96),
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(bytes).digest('hex')}`
    } });
    await response.text(); return response.status;
  };
  let running = await start();
  try {
    assert.deepEqual(await Promise.all([send(running.url), send(running.url)]), [202, 202]);
    await running.service.close();
    timestamp = '2026-09-29T07:00:00.000Z';
    running = await start();
    assert.deepEqual(await Promise.all([send(running.url), send(running.url)]), [202, 202]);
    const id = delivery(96).id;
    const persisted = await store.readWithPayload(id);
    assert.deepEqual(persisted.authenticatedPayload, payload);
    assert.equal(persisted.record.createdAt, '2026-09-29T06:00:00.000Z');
    assert.equal(persisted.record.version, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM repoops_webhook_inbox')).rows[0].count, 1);
    assert.equal(await send(running.url, Buffer.from(payload.toString().replace('café', 'changed'))), 409);
    await running.service.close();
    // Commit succeeds but transport loses the response. Redelivery must converge.
    running = await start({ async insertIfAbsent(record, bytes) { await store.insertIfAbsent(record, bytes); throw new Error('lost database response'); } });
    assert.equal(await send(running.url), 503);
    await running.service.close();
    running = await start(); assert.equal(await send(running.url), 202);
    // A real database constraint failure is never acknowledged.
    await pool.query("ALTER TABLE repoops_webhook_inbox ADD CONSTRAINT test_reject_acceptance CHECK (false) NOT VALID");
    try { assert.equal(await send(running.url), 503); }
    finally { await pool.query('ALTER TABLE repoops_webhook_inbox DROP CONSTRAINT test_reject_acceptance'); }
    assert.equal(await send(running.url), 202);
  } finally { await running.service.close(); }
});
