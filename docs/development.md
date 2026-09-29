# Development Guide

## Requirements

- Node.js 20+
- Git
- PostgreSQL 16+ when working on hosted persistence/integration tests

## Setup

```bash
git clone https://github.com/gODtECH-Ctl-Create/RepoOps.git
cd RepoOps
npm install
npm run check
```

## Project scripts

```bash
npm test
npm run check
npm run start:control-plane
npm run db:migrate
npm run test:postgres
```

`npm run check` is the minimum verification expected before opening a pull request.

## Hosted control plane

The hosted GitHub App runtime is separate from the existing GitHub Actions entry point.

Supply `REPOOPS_DATABASE_URL` and `REPOOPS_WEBHOOK_SECRET` securely, run `npm run db:migrate`, then start the hosted receiver with:

```bash
npm run start:control-plane
```

By default it listens on `127.0.0.1:3000`. For a container-style local run:

```bash
REPOOPS_ENV=development \
REPOOPS_HOST=0.0.0.0 \
REPOOPS_PORT=3000 \
npm run start:control-plane
```

The service exposes `GET /healthz`, `GET /readyz`, and `POST /webhooks/github`. Startup requires the inbox schema. Do not place repository policy or GitHub mutations directly in HTTP handlers. PostgreSQL persistence and GitHub App authentication live behind dedicated adapters; webhook and future worker layers should use the same boundary pattern while preserving the deterministic core.

See [Hosted control plane](control-plane.md) for configuration, health, shutdown, PostgreSQL, authentication, and architecture boundaries.

## GitHub App authentication development

The App identity boundary is under `src/control-plane/github-app/`.

Secret inputs are:

```text
REPOOPS_GITHUB_APP_CLIENT_ID
REPOOPS_GITHUB_APP_PRIVATE_KEY
REPOOPS_GITHUB_API_BASE_URL   # optional
```

Do not commit real private keys or installation tokens. Unit tests generate ephemeral RSA keypairs and use controlled HTTP responses; they do not require live GitHub credentials.

When changing authentication behavior:

- keep JWT generation deterministic through an injected/fixed clock in tests;
- verify RS256 signatures with the generated public key rather than only decoding claims;
- treat installation tokens as opaque strings;
- cover cache reuse and refresh-window behavior;
- cover concurrent token acquisition so one scope produces one in-flight mint;
- ensure different repository/permission scopes cannot share credentials;
- cover installation invalidation, including invalidation while a mint is already in flight;
- keep raw GitHub token-response bodies and secret material out of normal error messages;
- do not add retry sleeps inside the token client; use the shared reliability layer for retry/backoff decisions.

See [GitHub App authentication](github-app-auth.md) for the complete contract.

## PostgreSQL development

Database credentials use a dedicated secret-bearing environment variable:

```bash
REPOOPS_DATABASE_URL=postgresql://repoops:repoops@localhost:5432/repoops
```

Apply migrations:

```bash
REPOOPS_DATABASE_URL=postgresql://repoops:repoops@localhost:5432/repoops \
npm run db:migrate
```

Run the real PostgreSQL integration suite against a **disposable test database**:

```bash
REPOOPS_TEST_DATABASE_URL=postgresql://repoops:repoops@localhost:5432/repoops_test \
npm run test:postgres
```

The integration suite truncates `repoops_webhook_inbox`. Never use a production or shared database for `REPOOPS_TEST_DATABASE_URL`.

CI provides PostgreSQL 16 and runs the integration tests as part of `npm run check`.

### Migration rules

- migration files live under `db/migrations/`;
- use a monotonically increasing numeric prefix such as `002_add_event_store.sql`;
- never edit a migration after it has been applied to an environment;
- the migration runner records a SHA-256 checksum and will reject changed migration history;
- schema changes that affect the core inbox model must preserve `src/core/webhook-inbox.mjs` as the authoritative state contract;
- add integration coverage for constraints, indexes, migration behavior, and concurrency semantics introduced by the migration.

## Working on an issue

1. Find an available issue.
2. Comment `/claim`.
3. Wait for RepoOps to confirm the claim before starting implementation.
4. Create a branch from the latest `MASTER`.
5. Implement the smallest complete change.
6. Add or update tests.
7. Run `npm run check`.
8. Open a pull request and link the issue.

Example:

```bash
git checkout MASTER
git pull
git checkout -b feat/123-unclaim-command
```

## Testing event-driven behavior

Prefer pure tests over live GitHub experiments.

For command logic, construct event-like input and assert the returned decision. Live repository testing should be used only as final integration proof after deterministic tests pass.

For persistence logic, pure mapping/validation tests are not enough: concurrency, uniqueness, compare-and-swap, migrations, constraints, and recovery queries require a real PostgreSQL integration test.

## Adding a command

Command work follows the existing dispatcher and these boundaries:

- parse the command explicitly
- place business rules in `src/core`
- keep GitHub mutations in `src/github`
- make unsupported or unauthorized cases fail safely
- add deterministic tests
- document any new workflow permissions

## Workflow changes

When editing `.github/workflows/`:

- justify new write permissions
- keep permissions job- or workflow-scoped
- avoid executing contributor-controlled text
- use concurrency where simultaneous operations could race
- ensure retrying a workflow does not create harmful duplicate state
- use test-only credentials for CI services and never repository production secrets

## Dependency policy

RepoOps keeps runtime dependencies intentionally small. `pg` is the first hosted-runtime dependency because Node.js does not provide a PostgreSQL wire client and the control plane requires real durable storage.

GitHub App JWT signing intentionally uses Node's built-in cryptography instead of adding an authentication/JWT dependency.

Add another dependency only when it materially reduces complexity or risk and cannot reasonably be handled by Node.js, PostgreSQL, or the GitHub API directly.

Pull requests adding dependencies should explain why the dependency is needed and pin the direct dependency version deliberately.

## Commit guidance

Use concise conventional-style prefixes where practical:

```text
feat: add unclaim command
fix: prevent duplicate assignment comment
test: cover concurrent claim decisions
docs: document command lifecycle
chore: update contributor templates
```

## Definition of done

A contribution is normally complete when:
- behavior matches the linked issue
- tests cover the changed behavior
- `npm run check` passes
- documentation is updated when user-visible behavior changes
- workflow/security impact is explained
- no unrelated changes are included

## Scanner validation

Use the Stale assignment reminders workflow in dry-run mode for existing issues,
or live_validation for a disposable issue and real reminder/retry checks. See
[the validation procedure](stale-assignments.md). Pure tests use fixed UTC clocks.

## Operational event contracts

Use `src/core/events.mjs` for validated event records. Tests should supply fixed
UTC occurrence timestamps and trusted source identities, cover replay conflicts,
and reject raw payload/secret metadata. See [schema version 1](events.md).

HTTP tests exercise real loopback sockets with controlled persistence. The PostgreSQL integration suite additionally checks HTTP acceptance, server restart, later/concurrent redelivery, conflicting payloads, ambiguous responses, and database rejection. Without `REPOOPS_TEST_DATABASE_URL`, database tests are explicitly skipped; a local pass alone is not integration evidence.
