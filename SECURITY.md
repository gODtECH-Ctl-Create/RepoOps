# Security Policy

RepoOps automates repository state and may operate with GitHub write permissions. Security reports should be handled carefully.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could enable unauthorized repository changes, token exposure, command abuse, privilege escalation, workflow injection, database disclosure, webhook-payload disclosure, or other security impact.

Instead, use GitHub's private vulnerability reporting for this repository when available. Include:
- affected component or workflow
- impact
- reproduction steps
- required permissions or preconditions
- any suggested mitigation

If private reporting is unavailable, contact the repository owner privately before publishing technical details.

## Scope

Security-sensitive areas include:
- GitHub Actions workflows and permissions
- `GITHUB_TOKEN` usage
- GitHub App private keys, JWTs, authentication, and installation tokens
- command parsing and authorization
- webhook validation
- repository mutation logic
- hosted PostgreSQL credentials and persistence
- authenticated webhook payload storage/retention
- dependency and release automation
- event logging that may contain sensitive metadata

## Security principles

RepoOps aims to follow these rules:
- least privilege by default
- no execution of untrusted issue/comment text as code
- explicit authorization for destructive commands
- auditable repository mutations
- deterministic tests for policy decisions
- safe retries and idempotent operations where possible
- no secrets committed to the repository
- secret-bearing configuration stays out of normal diagnostics/public config
- raw private-repository webhook payloads are operational data, not logs or public analytics

## GitHub App credential security

GitHub App identity and installation credentials live behind `src/control-plane/github-app/`.

Rules:

- `REPOOPS_GITHUB_APP_PRIVATE_KEY` and installation access tokens are secrets and must never be logged, serialized, persisted to PostgreSQL, emitted by health endpoints, or copied into GitHub comments;
- the App private key is parsed into a Node `KeyObject` and ordinary callers should not retain the raw PEM text;
- App JWTs are short-lived RS256 credentials and must be treated like secrets even though they expire quickly;
- installation access tokens are opaque values; do not depend on token prefix, shape, or length for authorization decisions;
- installation tokens are cached only in process memory and are refreshed before their expiration safety window;
- different repository/permission scopes must never share a cached credential;
- suspension/uninstall handling must call the installation invalidation path before future hosted mutations are enabled;
- invalidation uses a generation check so an already in-flight token mint cannot repopulate the cache after an installation becomes invalid;
- token-mint failures expose only bounded status/request/rate-limit metadata; GitHub response bodies are not included in normal authentication errors;
- retry/backoff policy belongs to the runtime reliability layer rather than the credential client itself.

The hosted runtime still does not mutate repositories after the authentication milestone. Enabling hosted mutations requires an explicit worker/cutover milestone with installation-scoped permission review.

See `docs/github-app-auth.md` for the authentication and cache contract.

## GitHub App webhook verification

A future hosted RepoOps GitHub App must authenticate every webhook before the delivery can consume application work.

`src/github/webhook-signature.mjs` verifies GitHub's `X-Hub-Signature-256` HMAC-SHA256 signature against the exact raw request body using constant-time comparison.

The required ingress order is:

```text
receive raw request
  -> verify X-Hub-Signature-256
  -> reject unauthenticated/malformed request
  -> parse authenticated envelope/payload
  -> persist delivery + payload in the durable inbox
  -> acknowledge durable acceptance
  -> queue accepted work
```

Do not parse and re-serialize JSON before signature verification. Do not add a production path that bypasses webhook verification. The webhook secret must be supplied securely by the hosted runtime and must never be committed, logged, included in errors, or written into GitHub comments.

Delivery GUID validation/deduplication is a separate reliability control; it does not authenticate the sender.

See `docs/github-app-reliability.md` for the broader webhook, retry, reconciliation, and outage model.

## Hosted PostgreSQL security

The durable webhook inbox can contain issue/comment text and private-repository content. Treat the database and its authenticated payload bytes as sensitive hosted application data.

Rules:

- database credentials are supplied through the dedicated PostgreSQL configuration boundary (`REPOOPS_DATABASE_URL` or supported deployment secret injection);
- database URLs/passwords must never be printed, returned from health endpoints, copied into general runtime config objects, or included in GitHub comments;
- adapter errors expose only bounded operation names and safe SQLSTATE values, not raw query/connection error messages;
- raw authenticated webhook bytes are never normal retry/dead-letter log fields;
- processing reads verify payload digest and length before returning bytes;
- private-repository payloads must remain scoped to their installation/repository and must not enter public dashboards or contribution views;
- terminal raw payload retention must be bounded; long-lived audit/event history should use normalized facts instead;
- production PostgreSQL should use encrypted transport/storage and least-privilege database credentials appropriate to the deployment environment;
- integration tests must use disposable test databases and test-only credentials.

SQL migrations are checksum tracked. Do not edit migration history after it has been applied; use a new migration so schema review remains auditable.

## Supported versions

Until RepoOps reaches a stable release, security fixes are applied to the latest code on `MASTER`. A version support matrix will be added when versioned releases begin.
