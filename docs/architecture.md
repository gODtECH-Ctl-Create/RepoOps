# RepoOps Architecture

RepoOps is an event-driven repository operations toolkit. Repository automation currently runs inside GitHub Actions and uses GitHub as its source of truth. A separate hosted control-plane process boundary and PostgreSQL persistence adapter now exist for future GitHub App work, but the hosted runtime does not yet process production GitHub webhooks or mutate repositories.

## Current request flow

```text
GitHub event
    ↓
GitHub Actions workflow
    ↓
src/index.mjs
    ↓
command / policy decision
    ↓
src/core/*
    ↓
GitHub API adapter
    ↓
src/github/*
    ↓
repository mutation
```

## Hosted control-plane foundations

```text
src/control-plane/index.mjs
    ↓
runtime configuration + HTTP lifecycle
    ↓
/healthz + /readyz

src/control-plane/postgres/*
    ↓
PostgreSQL pool + migrations
    ↓
durable webhook inbox adapter
```

The hosted process still has no production webhook route, GitHub App authentication, queue/worker execution, or repository mutation authority.

See [Hosted control plane](control-plane.md), [webhook inbox processing](webhook-inbox.md), and [GitHub App reliability architecture](github-app-reliability.md).

## Directory responsibilities

### `.github/workflows/`
Owns event triggers, job permissions, concurrency, runtime setup, and invocation of RepoOps handlers.

Workflow files should stay thin. Business logic belongs in source files so it can be tested without running GitHub Actions.

### `src/core/`
Contains deterministic repository-operation decisions and reliability state models.

Core logic should avoid direct network/database calls. Where possible, it should accept plain data and return a decision, action plan, or validated next state.

`src/core/webhook-inbox.mjs` remains authoritative for webhook inbox state and transition validation. Persistence adapters may enforce compatible database constraints, but they must not invent a second transition model.

### `src/github/`
Contains GitHub REST API interactions and repository mutations.

This boundary lets tests exercise policy without requiring live API calls and gives us one place to add retries, rate-limit handling, observability, and future GitHub App authentication.

### `src/control-plane/`
Contains the hosted process/runtime boundary for the future GitHub App.

It owns runtime configuration, HTTP lifecycle, liveness/readiness, graceful process shutdown, and hosted infrastructure adapters. Keep repository policy in `src/core`; GitHub API behavior belongs in `src/github`.

### `src/control-plane/postgres/`
Contains PostgreSQL-specific hosted infrastructure:

- secret-bearing database configuration;
- pool/readiness helpers;
- migration runner;
- durable webhook inbox adapter.

This layer translates validated core records into atomic PostgreSQL operations. It must not contain GitHub policy, command parsing, or repository mutation rules.

### `db/migrations/`
Contains immutable, versioned SQL migration history for hosted persistence.

Applied migrations are checksum tracked. Schema evolution uses new numbered migration files rather than editing history.

### `src/index.mjs`
Current GitHub Actions entry point. It parses GitHub-provided event context, calls core decision logic, then invokes GitHub API operations.

The control plane must not silently become a second independent mutation engine while GitHub Actions is still handling the same repository operations. Runtime migration requires an explicit cutover design.

### `test/`
Contains deterministic unit tests and real integration tests where infrastructure semantics cannot be proven with mocks alone.

PostgreSQL concurrency, migration, uniqueness, CAS, constraints, and recovery-query behavior are integration-tested against PostgreSQL in CI.

## Design rules

1. **GitHub remains the source of truth initially.** RepoOps should not duplicate issue and PR state unless it needs operational history or derived state.
2. **Decision logic should be testable without GitHub.** Core behavior should not depend on live API calls.
3. **Persistence implements core contracts.** Databases must not become a second business-rule/state-transition layer.
4. **Mutations must be auditable.** RepoOps should leave understandable comments, labels, logs, or events when it changes repository state.
5. **Least privilege is mandatory.** Each workflow/App permission should request only what its job requires.
6. **Avoid destructive surprises.** Closing, deleting, unassigning, merging, or otherwise destructive actions need explicit policy and safeguards.
7. **Operations should tolerate retries.** GitHub Actions, webhooks, workers, and database operations can be retried; idempotency and CAS matter.
8. **Configuration should replace repository-specific assumptions.** Future behavior should be controlled through validated RepoOps configuration.
9. **One mutation authority per operation.** During migration, GitHub Actions and the hosted control plane must not independently execute the same logical repository operation.
10. **Secret-bearing config stays isolated.** Database URLs, GitHub private keys, webhook secrets, and tokens must not enter normal diagnostics/public config objects.

## Near-term architecture evolution

```text
v0.1
GitHub Actions + issue_comment + /claim

v0.2
command parser / dispatcher
configuration schema
assignment lifecycle

v0.3+
scheduled maintenance
maintainer work queue
event/audit model

hosted control plane
process/runtime → PostgreSQL → GitHub App auth → webhook ingress → queue/workers
    → reconciliation/recovery → organization install flow → dashboard
```

The process/runtime and PostgreSQL foundations now exist. The next hosted milestones are GitHub App identity/installation authentication and production webhook ingress wired to durable acceptance.

The hosted GitHub App must preserve the same deterministic core while moving event receipt, durable delivery state, retry scheduling, and installation authentication into the control-plane runtime. See [GitHub App reliability architecture](github-app-reliability.md).

## Operational event model

`src/core/events.mjs` defines strict version-1 immutable operational facts with stable source-based identities, explicit GitHub/RepoOps origin, allowlisted metadata and replay-conflict validation. The append helper is pure and has no storage. See [the event contract](events.md) for supported types and compatibility.

Recovery receipts are mutable checkpoints, not append-only audit history. Emission remains #20; timeline/completion projections remain #21/#36. Schema support for future event types does not implement their underlying actions.

## Security boundary

Treat issue bodies, comments, branch names, pull request data, webhook payloads, and other contributor-controlled fields as untrusted input.

Never interpolate untrusted GitHub content into shell commands or dynamically execute it.

Raw authenticated webhook payloads stored for recovery are operational data. They must not appear in normal logs, public dashboards, contributor projections, or GitHub comments.

## Idempotent operations

`src/core/idempotency.mjs` orchestrates injected stores and mutation steps without calling GitHub. `src/github/operations.mjs` stores authenticated operation receipts and reconciles fresh issue state. See [idempotency and recovery](idempotency.md) for checkpoint semantics, ambiguous failures, and concurrency limits.

`src/core/workflow-state.mjs` plans deterministic workflow-label transitions. The GitHub mutation layer checks fresh state and only changes absent/present labels when needed. Assignment reminder/expiry settings are policy, not release automation.

`src/github/linked-pull-requests.mjs` collects explicit GitHub closing/manual PR relationships with cursor pagination. Its normalized read-only result is reusable by lifecycle policies and future PR queues. See [relationship rules](linked-pull-requests.md).

## Webhook and API reliability foundations

`src/github/webhook-signature.mjs` verifies GitHub HMAC-SHA256 signatures against the exact raw webhook payload before parsing. `src/github/webhook-ingress.mjs` then normalizes authenticated repository-operation envelopes without treating contributor-controlled payload content as authorization data.

`src/core/webhook-delivery.mjs` defines replay-safe GitHub webhook delivery registration. The GitHub delivery GUID supplies delivery identity; payload text does not.

`src/core/webhook-inbox.mjs` defines the versioned processing record, retry/reconciliation states, worker leases, recovery classification, and persistence contract for accepted webhook work.

`src/control-plane/postgres/webhook-inbox-store.mjs` implements that contract with PostgreSQL uniqueness, atomic record+payload insertion, versioned compare-and-swap, indexed recovery queries, scoped reads, and payload-integrity verification. `db/migrations/001_webhook_inbox.sql` adds compatible database constraints and indexes. See [webhook inbox processing](webhook-inbox.md).

`src/github/client.mjs` exposes bounded structured GitHub API failure metadata, while `src/github/retry.mjs` classifies retryable reads, rate limits, permanent failures, and ambiguous mutation outcomes. Mutation failures that may already have reached GitHub require reconciliation before another write.

The future App still needs GitHub App authentication/installation tokens, a production webhook endpoint, queue/workers, retry scheduling, failed-delivery recovery, reconciliation workers, and operator/dead-letter tooling. See [GitHub App reliability architecture](github-app-reliability.md) for the complete reliability contract.

## Scheduled reminders

Collection → pure stale decision → fresh verification → authenticated reminder receipt. The scheduled scanner and commands serialize through the same repository mutation queue. See [stale reminders](stale-assignments.md) for timeline evidence, window identity, non-destructive semantics and safe live validation.
