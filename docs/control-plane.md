# Hosted control plane

RepoOps has a hosted runtime boundary under `src/control-plane/` for the future GitHub App control plane. It is separate from the existing GitHub Actions entry point in `src/index.mjs`.

The hosted runtime currently provides process lifecycle, health/readiness, PostgreSQL persistence for the durable webhook inbox, and a dedicated GitHub App identity/installation-token boundary. It still contains no production webhook endpoint, worker execution, or repository mutations.

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

GitHub App identity
    ↓
RS256 App JWT
    ↓
installation-token manager/cache
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
installation-scoped GitHub token
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

Database credentials and GitHub App credentials are deliberately **not** added to this ordinary runtime config object.

## GitHub App authentication configuration

GitHub App identity uses a separate secret-bearing boundary:

```text
REPOOPS_GITHUB_APP_CLIENT_ID
REPOOPS_GITHUB_APP_PRIVATE_KEY
REPOOPS_GITHUB_API_BASE_URL   # optional, defaults to https://api.github.com
```

The private key must be RSA. It is parsed into a Node `KeyObject`; the raw PEM text is not part of public runtime configuration and must never be logged or persisted.

The App JWT layer uses RS256, a 60-second issued-at skew, and a short expiration within GitHub's maximum. JWT generation is deterministic under an injected clock for tests.

Installation tokens are minted through the GitHub App installation-token endpoint. The manager:

- treats tokens as opaque strings;
- supports reduced repository and permission scopes;
- caches by exact normalized installation/scope;
- refreshes before expiration instead of returning a nearly expired credential;
- shares one in-flight mint per scope;
- does not cache failed requests;
- invalidates all credentials for an installation on demand;
- prevents a mint already in flight from repopulating the cache after invalidation.

Tokens/JWTs remain process-local credentials and are not stored in PostgreSQL.

See [GitHub App authentication](github-app-auth.md).

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

- The hosted runtime does not broaden any GitHub workflow or App permission by merely possessing App credentials.
- Health endpoints do not expose environment variables, dependency errors, secrets, tokens, database URLs, private keys, or raw webhook payloads.
- Runtime/database/App configuration errors do not echo supplied secret values.
- Repository policy stays outside HTTP, database, and credential adapter code.
- App authentication produces installation credentials; it does not decide whether a repository mutation is authorized by RepoOps policy.
- Webhook receipt, durable acceptance, credential acquisition, mutation execution, retry, and reconciliation remain separate concerns.
- PostgreSQL persistence implements the existing core state contract rather than defining a second state machine.
- The GitHub Actions path continues to operate independently until an explicit migration milestone changes that behavior.

## Not implemented yet

- registration/configuration of the real RepoOps GitHub App in GitHub
- production webhook HTTP ingress
- durable queue/workers
- retry/redelivery/reconciliation workers
- repository mutations from the hosted runtime
- installation lifecycle persistence/onboarding
- installation UI or dashboard
- production PostgreSQL provisioning/backups

Those are follow-up control-plane milestones and should consume these process, persistence, and authentication boundaries rather than expanding the HTTP server, database adapter, or credential manager into a monolithic application.
