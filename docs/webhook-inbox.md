# Webhook inbox processing contract

RepoOps' hosted GitHub App must durably accept authenticated webhook deliveries before asynchronous repository work begins. `src/core/webhook-inbox.mjs` defines the storage-agnostic state contract; `src/control-plane/postgres/webhook-inbox-store.mjs` provides the PostgreSQL adapter for that contract.

The PostgreSQL adapter persists accepted work, but no production webhook route or worker consumes it yet.

## Reliability boundary

The intended hosted flow is:

```text
raw GitHub webhook
  -> verify X-Hub-Signature-256
  -> normalize authenticated delivery envelope
  -> atomically persist inbox record + authenticated payload
  -> acknowledge webhook receipt
  -> queue/claim durable work
  -> process against fresh GitHub state
  -> verify/checkpoint mutations
  -> terminal state or durable retry/reconciliation state
```

A webhook must not be acknowledged as durably accepted until the inbox insert succeeds. Queue publication alone is not the durable source of truth.

## Record schema

Version 1 records contain:

- `schemaVersion` — currently `1`.
- `id` — stable RepoOps delivery identity derived from the GitHub delivery GUID.
- `delivery` — validated GitHub delivery metadata: delivery GUID, event, action, installation ID, repository ID and receipt time.
- `payload.sha256` — SHA-256 of the exact authenticated payload bytes.
- `payload.byteLength` — authenticated payload byte length.
- `state` — explicit processing state.
- `processingMode` — `normal` or `reconcile` only while leased for processing.
- `attemptCount` — incremented when a worker successfully claims work.
- `reason` — bounded machine-readable diagnostic category for retry/reconciliation/terminal failure states.
- `nextAttemptAt` — persisted retry schedule for `RETRY_WAIT`.
- `lease` — worker ID plus acquisition/expiry timestamps while `PROCESSING`.
- `createdAt` / `updatedAt` — monotonic UTC timestamps.
- `version` — monotonically increasing record version used by compare-and-swap persistence.

The core record intentionally does **not** contain the raw webhook payload. PostgreSQL stores the authenticated bytes alongside the record so accepted work can resume after process failure, and processing-facing reads verify those bytes against `payload.sha256` and `payload.byteLength`.

## States

```text
RECEIVED
  -> QUEUED
  -> PROCESSING
      -> COMPLETED
      -> NO_OP
      -> RETRY_WAIT
      -> RECONCILE_REQUIRED
      -> FAILED_PERMANENT
      -> DEAD_LETTER

RETRY_WAIT
  -> QUEUED          (only when nextAttemptAt is due)

RECONCILE_REQUIRED
  -> PROCESSING      (claimed in reconcile mode)

PROCESSING with expired lease
  -> RECONCILE_REQUIRED
```

`COMPLETED`, `NO_OP`, `FAILED_PERMANENT`, and `DEAD_LETTER` are terminal. They must not silently become active work again.

## Retry versus reconciliation

`RETRY_WAIT` means the previous operation is known to be safe to retry later. The retry time is persisted in `nextAttemptAt`; workers do not hold a process open or sleep while waiting.

`RECONCILE_REQUIRED` means the outcome may be ambiguous. Before another consequential GitHub mutation, the worker must inspect authoritative GitHub state and determine whether the intended change already exists.

An expired processing lease is treated as ambiguous and is recovered into `RECONCILE_REQUIRED`, because the previous worker may have reached GitHub before crashing.

## Worker leases

A worker may claim only `QUEUED` or `RECONCILE_REQUIRED` records.

Claiming:

- sets state to `PROCESSING`;
- records `processingMode` (`normal` or `reconcile`);
- increments `attemptCount`;
- creates a bounded worker lease;
- increments the record version.

The PostgreSQL adapter uses compare-and-swap on the record version so two workers cannot both successfully advance the same persisted version.

A worker must not finalize a record after its lease has expired. Expired work belongs to the recovery path and requires reconciliation.

## Store interface

`assertWebhookInboxStore()` documents the required adapter surface:

- `find(id)` — read one inbox record.
- `insertIfAbsent(record, payload)` — atomically create the record and authenticated payload only if the delivery identity does not already exist.
- `compareAndSwap(id, expectedVersion, nextRecord)` — update only when the persisted version still equals `expectedVersion`.
- `listRetryDue(now, limit)` — return `RETRY_WAIT` records whose schedule is due.
- `listReconcileRequired(limit)` — return records explicitly requiring reconciliation.
- `listAbandonedProcessing(now, limit)` — return `PROCESSING` records with expired leases.
- `listDeadLetter(limit)` — operator-visible terminal failures.

The PostgreSQL implementation additionally exposes:

- `readWithPayload(id)` — return a record plus verified authenticated payload bytes;
- `listForRepository({ installationId, repositoryId, limit })` — scoped history for future installation/repository operations.

## PostgreSQL implementation

Migration `db/migrations/001_webhook_inbox.sql` creates `repoops_webhook_inbox` with:

- primary key `id`;
- unique GitHub delivery GUID;
- installation/repository/event/action identity;
- state, attempt and version fields;
- retry and lease timestamps;
- payload digest/length and payload bytes;
- database constraints mirroring important processing/retry/reason shape invariants.

Indexes support:

- retry-due scans by state and `next_attempt_at`;
- abandoned-processing scans by lease expiry;
- reconciliation/dead-letter scans by state and update time;
- installation/repository scoped history.

Insert-if-absent uses PostgreSQL uniqueness and `ON CONFLICT DO NOTHING`; read-before-write is not used as the concurrency guarantee. A duplicate with the same acceptance facts returns the persisted record. Conflicting metadata or payload integrity under the same identity fails closed and never replaces the stored payload.

Compare-and-swap updates only mutable processing fields. Its `WHERE` clause requires:

- inbox ID;
- expected version;
- immutable delivery identity;
- installation/repository/event/action values;
- payload digest/length;
- receipt/creation timestamps.

If another worker already advanced the version, callers receive the current persisted record as a conflict rather than overwriting it.

## Migrations

Run migrations with:

```bash
REPOOPS_DATABASE_URL=postgresql://user:password@localhost:5432/repoops \
npm run db:migrate
```

`src/control-plane/postgres/migrations.mjs`:

- tracks applied version/name/checksum in `repoops_schema_migrations`;
- serializes migration application with a PostgreSQL advisory transaction lock;
- validates filename/version ordering;
- refuses edited migration history when the stored checksum differs;
- applies outstanding migrations transactionally.

Migration files that have reached an environment are immutable. Add a new numbered migration for schema evolution.

## Payload retention and privacy

Webhook payloads can contain issue bodies, comments, usernames and private-repository content. They are operational input, not diagnostic metadata.

The hosted adapter must:

- persist only the payload needed to resume accepted work;
- never copy webhook secrets, authorization headers, installation tokens or private keys into the inbox;
- never log raw payloads as normal retry/dead-letter diagnostics;
- verify stored payload bytes against the record digest before processing;
- use bounded retention for terminal payloads;
- prevent private-repository payloads from appearing in public dashboards, GitHub issues or contributor projections.

The schema permits payload bytes to be removed only after a record reaches a terminal state. The retention cleanup job itself is a later operational milestone.

Long-lived audit/event history should store normalized operational facts, not indefinite copies of raw webhook bodies.

## Recovery queries

`classifyWebhookInboxRecovery()` exposes four deterministic recovery classes:

- `retry-due`;
- `reconciliation-required`;
- `abandoned-processing`;
- `dead-letter`.

The PostgreSQL store makes each class queryable using bounded, deterministic ordering without scanning the full inbox table.

## Integration testing

CI starts PostgreSQL 16 and supplies `REPOOPS_TEST_DATABASE_URL`. The integration suite exercises:

- repeatable migrations and migration history;
- duplicate delivery convergence and conflict handling;
- compare-and-swap success and stale-worker conflicts;
- retry/reconciliation/abandoned/dead-letter recovery queries;
- payload tamper detection;
- installation/repository scoped reads;
- database constraints independent of application validation.

For local integration testing, set an explicit disposable test database URL and run:

```bash
REPOOPS_TEST_DATABASE_URL=postgresql://repoops:repoops@localhost:5432/repoops_test \
npm run test:postgres
```

Tests can truncate the inbox table. Never point the integration suite at a production or shared environment.

## Relationship to other reliability layers

The inbox does not replace:

- webhook authentication (`src/github/webhook-signature.mjs`);
- verified ingress normalization (`src/github/webhook-ingress.mjs`);
- delivery deduplication (`src/core/webhook-delivery.mjs`);
- GitHub operation receipts (`src/core/idempotency.mjs`);
- GitHub API retry classification (`src/github/retry.mjs`).

These are separate layers. Delivery deduplication prevents accepting the same GitHub delivery as new work twice; inbox state makes accepted work recoverable; operation receipts prevent repeated GitHub mutations when work itself is retried.
