# Hosted control plane

RepoOps has a hosted runtime boundary under `src/control-plane/` for the future GitHub App control plane. It is separate from the existing GitHub Actions entry point in `src/index.mjs`.

The initial runtime deliberately contains no GitHub mutation logic, GitHub App credentials, webhook endpoint, queue, or database adapter. Its purpose is to provide a small process boundary that later hosted components can extend without moving repository policy into HTTP handlers.

## Current flow

```text
process start
    ↓
validate runtime configuration
    ↓
create HTTP service
    ↓
listen
    ↓
/healthz   /readyz
```

Future GitHub App work will extend the hosted side behind dedicated adapters:

```text
GitHub webhook
    ↓
HTTP ingress
    ↓
verified webhook envelope
    ↓
persistent inbox
    ↓
workers / reconciliation
    ↓
existing RepoOps core + GitHub adapters
```

GitHub remains the source of truth for issues, pull requests, reviews, branches, and CI state.

## Start locally

```bash
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

GitHub private keys, installation tokens, webhook secrets, database URLs, and queue credentials are intentionally **not** part of this configuration yet. Each will be introduced only when the runtime component that consumes it exists.

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

Readiness checks are injected functions. This lets future PostgreSQL, queue, or other required dependency checks participate without putting those dependencies directly into the HTTP layer. A readiness-check error is not returned to the caller.

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
- Health endpoints do not expose environment variables, dependency errors, secrets, tokens, or raw webhook payloads.
- Runtime configuration errors do not echo supplied values.
- Repository policy stays outside HTTP transport code.
- Webhook receipt, durable acceptance, mutation execution, retry, and reconciliation remain separate concerns.
- The GitHub Actions path continues to operate independently until an explicit migration milestone changes that behavior.

## Not implemented by this runtime milestone

- PostgreSQL schema/adapter or migrations
- GitHub App JWT and installation-token lifecycle
- webhook HTTP ingress
- durable queue/workers
- retry/redelivery/reconciliation workers
- repository mutations from the hosted runtime
- installation UI or dashboard

Those are follow-up control-plane milestones and should consume this process boundary rather than expanding the health server into a monolithic application.
