# GitHub App Reliability Architecture

RepoOps' future GitHub App must make infrastructure failures produce **delay and reconciliation**, not confusing or duplicated changes in GitHub.

This document defines the reliability contract for webhook ingestion, asynchronous processing, GitHub API failures, retries, partial outages, and recovery. It builds on the current idempotent operation model rather than replacing it.

## Core invariant

> When RepoOps is uncertain whether GitHub state changed, RepoOps must inspect authoritative GitHub state before attempting another consequential write.

GitHub remains the source of truth for issues, pull requests, reviews, labels, assignments, branches, checks, and merge state.

A webhook is evidence that an event occurred. It is not a guarantee that the payload still represents current repository state by the time RepoOps processes it.

## Target request path

```text
GitHub
  |
  | webhook delivery
  v
Webhook gateway
  |-- verify signature
  |-- validate installation/repository envelope
  |-- normalize delivery identity
  |-- register delivery in durable inbox
  |
  +---- duplicate/conflict ---> no duplicate work
  |
  v
Durable inbox
  |
  v
Queue
  |
  v
Repository worker
  |-- re-read current GitHub state
  |-- evaluate RepoOps policy
  |-- compute desired state / minimal mutation plan
  |-- execute with operation receipts
  |-- verify each consequential mutation
  |
  v
Confirmed GitHub state
  |
  v
User-visible acknowledgement / audit event
```

The webhook HTTP request must not contain the full repository mutation workflow. In the hosted control plane, webhook receipt and mutation processing are separate reliability boundaries.

## 1. Webhook delivery identity

GitHub webhook deliveries are at-least-once signals from RepoOps' perspective. Duplicate processing must be expected.

`src/core/webhook-delivery.mjs` provides the first delivery-registration primitive:

- normalize the GitHub delivery GUID;
- derive one stable internal identity from that GUID;
- validate trusted installation/repository/event envelope metadata;
- atomically register the first delivery through an injected durable store;
- return `duplicate` for safe redelivery;
- fail closed if the same delivery identity appears with conflicting trusted metadata.

Raw issue/comment/PR content does not participate in delivery identity.

### Store requirement

A hosted inbox store must enforce uniqueness for the delivery identity. A read-before-create check alone is not enough because multiple webhook handlers may race.

Only a delivery that is durably registered as newly accepted should be enqueued as new work.

## 2. Delivery deduplication is not operation idempotency

These are separate guarantees.

### Delivery deduplication

Question: **Have we already accepted this exact GitHub delivery?**

Prevents one webhook redelivery from independently entering the queue multiple times.

### Operation idempotency

Question: **Has this logical RepoOps operation already applied some or all of its intended GitHub mutations?**

`src/core/idempotency.mjs` and `src/github/operations.mjs` already maintain mutation receipts/checkpoints for current IssueOps behavior.

A future App worker must retain both layers. Delivery deduplication does not protect against:

- different GitHub deliveries representing the same logical state transition;
- worker retry after a crash;
- a response being lost after GitHub applied a write;
- reconciliation work created independently of the original webhook.

## 3. Desired-state processing

Workers should reason from intent and current state, not blindly replay imperative commands from stale events.

Preferred flow:

```text
accepted event
  -> identify intent/resource
  -> fetch current authoritative GitHub state
  -> validate current policy/preconditions
  -> compute desired state
  -> compute minimal required mutations
  -> execute/checkpoint/verify
```

Example: a delayed `/claim` event does not prove the issue is still claimable. If another actor has already been assigned, RepoOps must not overwrite that current state merely because the earlier webhook payload showed the issue as unassigned.

## 4. Mutation checkpoints and ambiguous outcomes

GitHub does not provide a transaction spanning assignments, labels, comments, reviews, and other repository resources.

Multi-step operations therefore use resumable checkpoints.

For each consequential step:

1. inspect current state;
2. determine whether the step is already applied;
3. checkpoint before attempting a write when required by the operation model;
4. apply the minimal write;
5. inspect GitHub again to confirm the result;
6. persist completion of that step;
7. continue to the next step.

If a request may have reached GitHub but its response was lost, the next attempt must **reconcile**, not blindly replay the write.

This includes network failures, timeouts, or transient server responses after a mutation attempt where the final GitHub state is uncertain.

## 5. User-visible messages come after confirmation

A success comment is evidence shown to contributors and maintainers. It must describe confirmed state.

Bad ordering:

```text
post "claimed successfully"
then try to assign user
```

Required ordering:

```text
assign user
verify assignment
apply/verify labels
then acknowledge successful claim
```

Repeated events or retries must not create duplicate acknowledgement spam.

## 6. GitHub API failure classification

`src/github/client.mjs` exposes structured, bounded GitHub failure metadata without logging authorization material.

`src/github/retry.mjs` returns scheduling/reconciliation guidance. It does not sleep or retry requests itself.

### Retryable read failures

Examples:

- transport/network failure;
- request timeout before a confirmed read result;
- GitHub 5xx response;
- primary or secondary rate limit.

These may produce delayed retry guidance with bounded backoff.

### Ambiguous mutation failures

For a write attempt, network/timeout/5xx-style failures may mean the write succeeded but the response was not received.

Result: `reconcile`.

The worker must re-read GitHub and determine whether the desired mutation already exists before attempting another write.

### Permanent failures

Examples:

- invalid or expired authentication;
- required permission removed;
- resource no longer accessible;
- request validation failure;
- invalid RepoOps configuration/policy.

These fail closed and should not enter an unbounded retry loop.

## 7. Rate limits

Rate limiting must reduce work rate rather than generate noisy failures in repositories.

Scheduling should prefer GitHub-provided signals:

1. `Retry-After` when present;
2. `X-RateLimit-Reset` when primary quota is exhausted;
3. bounded exponential backoff when no stronger signal exists.

Workers must not sleep for long periods while holding request handlers or repository mutation locks. Persist retry timing and release the worker/lease.

Future rate-limit policy should also account for installation-scoped quotas and coordinate multiple repositories sharing one installation.

Related backlog: #25.

## 8. Repository mutation lanes

Consequential writes for one repository should be serialized or otherwise guarded by an equivalent deterministic concurrency strategy.

Read-only collection may run concurrently where safe.

The goal is to avoid races such as:

```text
/claim
/unclaim
issue close
stale-assignment scanner
PR lifecycle event
```

all independently writing incompatible state at the same time.

The current GitHub Actions implementation already serializes mutation workflows. The hosted App must replace that bounded Actions queue with a durable scheduling model that does not silently lose accepted work.

Related backlog: #28.

## 9. Partial GitHub outage

If webhook delivery is healthy but GitHub REST/GraphQL access is degraded:

- keep accepted deliveries durable;
- stop speculative mutations;
- schedule bounded retries or reconciliation as appropriate;
- do not post repeated error comments into contributor threads;
- after recovery, re-read current GitHub state before applying delayed work;
- discard or no-op obsolete work whose preconditions no longer hold.

A GitHub outage should normally appear to users as delayed RepoOps automation, not contradictory repository state.

## 10. RepoOps outage and failed-delivery recovery

If RepoOps' webhook endpoint is unavailable, some GitHub deliveries may never enter the inbox.

The hosted App therefore requires a recovery worker that can:

- inspect failed GitHub App webhook deliveries for installations RepoOps controls;
- request redelivery when supported;
- pass the redelivery through the same delivery-registration path;
- rely on normal delivery deduplication if the original delivery was actually persisted before failure.

Redelivery recovery must never bypass signature/installation validation or operation idempotency.

## 11. Reconciliation workers

Webhooks are not the only recovery mechanism.

Important long-lived operational state should also be repairable through reconciliation scans that compare current GitHub state with RepoOps' operational records.

Reconciliation must not "fight" legitimate maintainer edits.

If GitHub differs from RepoOps-derived state, GitHub is authoritative unless explicit repository policy defines a safe corrective action.

Examples of reconciliation targets:

- pending/ambiguous operation receipts;
- accepted deliveries that never reached a terminal worker state;
- stale retry jobs;
- installation/repository access changes;
- missed lifecycle transitions required for an operational projection.

## 12. Dead-letter handling

After bounded retries, work that cannot progress should enter an operator-visible dead-letter state rather than retry forever.

A dead-letter record should retain safe diagnostic context such as:

- installation ID;
- repository ID;
- delivery/operation identity;
- event/action type;
- attempt count;
- first/last failure timestamps;
- structured reason category;
- GitHub request ID where available.

Do not persist tokens, authorization headers, or unnecessary raw contributor payloads as diagnostic metadata.

Dead-letter state should not automatically generate contributor-facing comment spam.

## 13. Operation states

A hosted worker/control plane can use explicit states similar to:

```text
RECEIVED
  -> QUEUED
  -> PROCESSING
  -> VALIDATING
  -> MUTATING
  -> VERIFYING
  -> COMPLETED
```

Exceptional transitions include:

```text
RETRY_WAIT
RECONCILE_REQUIRED
NO_OP
FAILED_PERMANENT
DEAD_LETTER
```

State names may evolve, but transitions must remain explicit and auditable.

## 14. Safety during installation changes

GitHub App installation access can change independently of queued work.

Before a consequential mutation, workers must ensure the installation still authorizes access to the target repository and that the required permission remains available.

If an App is uninstalled, suspended, or loses repository access:

- stop writes;
- fail or park affected work according to a bounded policy;
- surface the condition to RepoOps operators/organization administrators;
- do not repeatedly comment inside repositories that RepoOps can no longer reliably manage.

## 15. Reliability acceptance criteria for future App features

Any future hosted GitHub App feature that mutates GitHub should answer these questions before merge:

- What is the delivery identity?
- What is the logical operation identity?
- What current GitHub state is authoritative?
- What makes a retry safe?
- Which failures require reconciliation instead of retry?
- What happens after partial multi-step success?
- What happens if GitHub rate-limits the installation?
- What happens during GitHub or RepoOps partial outage?
- How is accepted work recovered if a worker crashes?
- How are terminal failures surfaced without GitHub comment spam?
- When is user-visible success acknowledged?

If these answers are unclear, the mutation path is not ready for production App use.

## Implementation status

Implemented foundations:

- operation receipts/checkpoints and ambiguous mutation protection;
- webhook delivery identity and replay-safe registration (#69);
- structured GitHub API errors and retry/rate-limit classification (#70).

Still required for the hosted control plane:

- persistent inbox implementation;
- queue/worker runtime;
- GitHub App authentication and installation-token lifecycle;
- webhook signature verification endpoint;
- failed-delivery recovery worker;
- persistent retry scheduler;
- reconciliation workers;
- dead-letter/operator tooling;
- installation and multi-repository policy management.

Parent reliability milestone: #67.
