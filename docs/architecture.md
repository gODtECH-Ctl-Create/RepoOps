# RepoOps Architecture

RepoOps is an event-driven repository operations toolkit. The current version runs inside GitHub Actions and uses GitHub as its source of truth.

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

## Directory responsibilities

### `.github/workflows/`
Owns event triggers, job permissions, concurrency, runtime setup, and invocation of RepoOps handlers.

Workflow files should stay thin. Business logic belongs in source files so it can be tested without running GitHub Actions.

### `src/core/`
Contains deterministic repository-operation decisions such as whether an issue can be claimed.

Core logic should avoid direct network calls. Where possible, it should accept plain data and return a decision or action plan.

### `src/github/`
Contains GitHub REST API interactions and repository mutations.

This boundary lets tests exercise policy without requiring live API calls and gives us one place to add retries, rate-limit handling, observability, and future GitHub App authentication.

### `src/index.mjs`
Current event entry point. It parses GitHub-provided event context, calls core decision logic, then invokes GitHub API operations.

As command support grows, this should evolve into a dispatcher rather than a long chain of command-specific conditionals.

### `test/`
Contains deterministic tests for command and policy behavior.

## Design rules

1. **GitHub remains the source of truth initially.** RepoOps should not duplicate issue and PR state unless it needs operational history or derived state.
2. **Decision logic should be testable without GitHub.** Core behavior should not depend on live API calls.
3. **Mutations must be auditable.** RepoOps should leave understandable comments, labels, logs, or events when it changes repository state.
4. **Least privilege is mandatory.** Each workflow should request only permissions required by its job.
5. **Avoid destructive surprises.** Closing, deleting, unassigning, merging, or otherwise destructive actions need explicit policy and safeguards.
6. **Operations should tolerate retries.** GitHub Actions and webhooks can be delivered or retried in ways that make idempotency important.
7. **Configuration should replace repository-specific assumptions.** Future behavior should be controlled through a validated RepoOps configuration file.

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

later
GitHub App → webhooks → API → queue/workers → PostgreSQL → dashboard
```

## Future event model

RepoOps will eventually need an append-only operational event history for actions such as:

```text
command.received
issue.claimed
issue.unclaimed
assignment.reminder_sent
assignment.expired
pull_request.linked
review.requested
policy.denied
```

GitHub remains authoritative for repository objects, while RepoOps events capture operational context: what automation decided, under which policy, and why.

## Security boundary

Treat issue bodies, comments, branch names, pull request data, and other contributor-controlled fields as untrusted input.

Never interpolate untrusted GitHub content into shell commands or dynamically execute it.
## Idempotent operations

`src/core/idempotency.mjs` orchestrates injected stores and mutation steps without
calling GitHub. `src/github/operations.mjs` stores authenticated operation receipts
and reconciles fresh issue state. See [idempotency and recovery](idempotency.md)
for checkpoint semantics, ambiguous failures, and concurrency limits.

`src/core/workflow-state.mjs` plans deterministic workflow-label transitions.
The GitHub mutation layer checks fresh state and only changes absent/present labels
when needed. Assignment reminder/expiry settings are policy, not release automation.
