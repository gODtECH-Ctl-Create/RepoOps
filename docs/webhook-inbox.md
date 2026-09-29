# Webhook inbox processing contract

RepoOps' hosted GitHub App must durably accept authenticated webhook deliveries before asynchronous repository work begins. This document defines the storage-agnostic inbox record and the contract a future PostgreSQL adapter must implement.

The current implementation lives in `src/core/webhook-inbox.mjs`. It does **not** deploy a database or queue.

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

The core record intentionally does **not** contain the raw webhook payload. The future storage adapter must atomically persist the authenticated payload under the same inbox identity (or an equivalent durable payload reference) and verify it against `payload.sha256` before processing.

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

The storage adapter must use compare-and-swap on the record version so two workers cannot both successfully claim the same version of a record.

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

An implementation may expose additional methods, but these semantics must remain atomic.

## PostgreSQL persistence requirements

A future PostgreSQL implementation should persist/index at minimum:

- primary key: `id`;
- unique delivery GUID;
- installation ID and repository ID;
- event/action;
- state;
- attempt count;
- record version;
- received/created/updated timestamps;
- retry time;
- lease expiry;
- bounded reason category;
- payload SHA-256 and byte length;
- encrypted or otherwise appropriately protected authenticated payload content/reference.

Recommended indexes include:

- `(state, next_attempt_at)` for retry-due scans;
- `(state, lease_expires_at)` for abandoned-processing recovery;
- `(state, updated_at)` for reconciliation/dead-letter/operator views;
- `(installation_id, repository_id, created_at)` for scoped operations and retention.

Insert-if-absent must use a database uniqueness guarantee. Read-before-write by itself is not sufficient.

## Payload retention and privacy

Webhook payloads can contain issue bodies, comments, usernames and private-repository content. They are operational input, not diagnostic metadata.

The hosted adapter must:

- persist only the payload needed to resume accepted work;
- never copy webhook secrets, authorization headers, installation tokens or private keys into the inbox;
- never log raw payloads as normal retry/dead-letter diagnostics;
- verify stored payload bytes against the record digest before processing;
- define a bounded retention period for terminal payloads;
- prevent private-repository payloads from appearing in public dashboards, GitHub issues or contributor projections.

Long-lived audit/event history should store normalized operational facts, not indefinite copies of raw webhook bodies.

## Recovery queries

`classifyWebhookInboxRecovery()` exposes four deterministic recovery classes:

- `retry-due`;
- `reconciliation-required`;
- `abandoned-processing`;
- `dead-letter`.

The persistent adapter should make each class queryable without scanning the full inbox table.

## Relationship to other reliability layers

The inbox does not replace:

- webhook authentication (`src/github/webhook-signature.mjs`);
- verified ingress normalization (`src/github/webhook-ingress.mjs`);
- delivery deduplication (`src/core/webhook-delivery.mjs`);
- GitHub operation receipts (`src/core/idempotency.mjs`);
- GitHub API retry classification (`src/github/retry.mjs`).

These are separate layers. Delivery deduplication prevents accepting the same GitHub delivery as new work twice; inbox state makes accepted work recoverable; operation receipts prevent repeated GitHub mutations when work itself is retried.
