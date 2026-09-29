# Hosted control plane

RepoOps has a hosted runtime boundary under `src/control-plane/` for the future GitHub App control plane. It is separate from the existing GitHub Actions entry point in `src/index.mjs`.

The hosted runtime currently provides process lifecycle, health/readiness, and a PostgreSQL persistence boundary for the durable webhook inbox. It still contains no GitHub App authentication, production webhook endpoint, worker execution, or repository mutations.

## Current hosted foundations

```text
process start
    ↓
validate runtime configuration
    ↓
HTTP service
    ↓
/healthz   /readyz

PostgreSQL adapter
    ↓
versioned migrations
    ↓
durable webhook inbox records + authenticated payload bytes
```

Future GitHub App work extends these boundaries behind dedicated adapters:

```text
GitHub webhook
    ↓
HTTP ingress
    ↓
verified webhook envelope
    ↓
PostgreSQL durable inbox
    ↓
workers / reconciliation
    ↓
existing RepoOps core + GitHub adapters
```

GitHub remains the source of truth for issues, pull requests, reviews, branches, and CI state.

## Start locally

```bash
npm install
npm run start:control-plane
```

Defaults bind only to the local interface:

- host: `127.0.0.1`
- port: `3000`
- environment: `development`

A container or hosted environment should set an explicit bind host and port, for example:

```bash
REPOOPS_ENV=production \
REPOOPS_HOST=0.0.0.0 \
REPOOPS_PORT=8080 \
npm run start:control-plane
```

## Runtime configuration

| Variable | Default | Rules |
| --- | --- | --- |
| `REPOOPS_ENV` | `NODE_ENV` or `development` | `development`, `test`, or `production` |
| `REPOOPS_HOST` | `127.0.0.1` | non-empty host/address, no URL/path syntax |
| `REPOOPS_PORT` | `PORT` or `3000` | integer `1..65535`; RepoOps-specific value wins over `PORT` |
| `REPOOPS_SHUTDOWN_TIMEOUT_MS` | `10000` | integer `100..60000` |
| `REPOOPS_REQUEST_TIMEOUT_MS` | `15000` | integer `1000..120000` |

Invalid configuration fails before the listener opens. Validation errors identify the field but do not echo the supplied value.

Database credentials are deliberately **not** added to this ordinary runtime config object.

## PostgreSQL configuration

PostgreSQL uses a separate secret-bearing configuration boundary:

```bash
REPOOPS_DATABASE_URL=postgresql://user:password@localhost:5432/repoops
```

`DATABASE_URL` is accepted as a fallback, while `REPOOPS_DATABASE_URL` takes precedence.

The value must be a `postgres://` or `postgresql://` URL with a host and database name. Validation errors identify only the `databaseUrl` field; they never echo the supplied connection string.

Do not log, serialize, return from health endpoints, or copy the database URL into the general control-plane runtime configuration.

## Database migrations

Apply versioned migrations explicitly:

```bash
REPOOPS_DATABASE_URL=postgresql://user:password@localhost:5432/repoops \
npm run db:migrate
```

Migration files live under `db/migrations/` and use numeric prefixes such as:

```text
001_webhook_inbox.sql
```

The migration runner:

- records applied versions and SHA-256 checksums in `repoops_schema_migrations`;
- takes a PostgreSQL advisory transaction lock so concurrent startup/deploy jobs cannot independently apply migration history;
- refuses to accept an already-applied migration whose name or checksum changed;
- applies each outstanding migration transactionally;
- can be run repeatedly when no migration is pending.

Applied migration files are immutable history. Add a new migration rather than editing a migration already used by an environment.

## Webhook inbox persistence

`src/control-plane/postgres/webhook-inbox-store.mjs` implements the storage contract from `src/core/webhook-inbox.mjs`.

The adapter persists:

- stable RepoOps delivery identity and unique GitHub delivery GUID;
- installation/repository/event/action metadata;
- inbox state, attempt count, reason, version and timestamps;
- retry and worker-lease fields;
- payload SHA-256 and byte length;
- exact authenticated webhook payload bytes required to resume accepted work.

Important guarantees:

- record + payload insert is one PostgreSQL statement and therefore atomic;
- duplicate delivery acceptance uses database uniqueness and does not replace existing payload bytes;
- conflicting reuse of an inbox/delivery identity fails closed;
- compare-and-swap updates require the persisted record version and immutable delivery facts to match;
- stale workers receive a conflict rather than overwriting a newer record;
- recovery queries are indexed and deterministically ordered;
- processing reads verify stored payload byte length and SHA-256 before returning bytes to callers.

Raw webhook payloads are operational input, not normal diagnostics. They must not be emitted in application logs, errors, public dashboards, GitHub comments, or contributor projections.

Terminal payload bytes may be removed later according to the retention policy; normalized long-lived audit/event data should not depend on keeping raw webhook bodies indefinitely.

## PostgreSQL readiness

`createPostgresReadinessCheck(pool)` provides a minimal `SELECT 1` readiness function that can be injected into the existing `/readyz` dependency checks.

The current executable control-plane entry point does **not** automatically require PostgreSQL yet because no hosted webhook/worker route consumes it. The webhook-ingress composition milestone should make PostgreSQL readiness mandatory at the same time it makes durable acceptance part of request handling.

## Health endpoints

### `GET /healthz`

Liveness only. A healthy process returns:

```json
{"status":"ok"}
```

Liveness can remain healthy during graceful shutdown while readiness has already been removed.

### `GET /readyz`

Readiness for new work. A ready process returns HTTP `200`:

```json
{"status":"ready"}
```

A failed dependency check or a runtime entering shutdown returns HTTP `503`:

```json
{"status":"not-ready"}
```

Readiness checks are injected functions. PostgreSQL, queue, or other required dependency checks can participate without putting those implementations directly into the HTTP layer. A readiness-check error is not returned to the caller.

`POST` or other non-GET methods on health endpoints return `405`. Unknown routes return a small JSON `404` response.

## Shutdown lifecycle

`SIGTERM` and `SIGINT` request one graceful shutdown.

The lifecycle is:

```text
signal
  ↓
mark not ready
  ↓
stop accepting new connections
  ↓
allow current HTTP work to drain
  ↓
force-close remaining connections after bounded timeout
  ↓
process can exit
```

The shutdown request is idempotent. Repeated signals do not start independent close sequences.

Future workers must join this lifecycle before they are introduced: stop leasing new work first, then finish or checkpoint in-flight work safely before process exit.

## Security and reliability boundaries

- The hosted runtime does not broaden any GitHub workflow or App permission.
- Health endpoints do not expose environment variables, dependency errors, secrets, tokens, database URLs, or raw webhook payloads.
- Runtime/database configuration errors do not echo supplied secret values.
- Repository policy stays outside HTTP and database adapter code.
- Webhook receipt, durable acceptance, mutation execution, retry, and reconciliation remain separate concerns.
- PostgreSQL persistence implements the existing core state contract rather than defining a second state machine.
- The GitHub Actions path continues to operate independently until an explicit migration milestone changes that behavior.

## Not implemented yet

- GitHub App JWT and installation-token lifecycle
- production webhook HTTP ingress
- durable queue/workers
- retry/redelivery/reconciliation workers
- repository mutations from the hosted runtime
- installation UI or dashboard
- production PostgreSQL provisioning/backups

Those are follow-up control-plane milestones and should consume these process and persistence boundaries rather than expanding the HTTP server or database adapter into a monolithic application.
