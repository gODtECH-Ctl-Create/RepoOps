# GitHub App authentication

RepoOps' hosted control plane has a dedicated GitHub App identity boundary under `src/control-plane/github-app/`.

This layer authenticates the service as the GitHub App and obtains short-lived installation access tokens. It does **not** receive production webhooks or authorize the hosted runtime to mutate repositories by itself.

## Secret configuration

The App identity is supplied through a secret-bearing configuration boundary:

```text
REPOOPS_GITHUB_APP_CLIENT_ID
REPOOPS_GITHUB_APP_PRIVATE_KEY
REPOOPS_GITHUB_API_BASE_URL   # optional; defaults to https://api.github.com
```

The client ID is treated as an opaque bounded identifier. The private key must be an RSA private key and is parsed to a Node `KeyObject` immediately. The raw PEM text is not part of normal runtime configuration and must never be logged, serialized, persisted to PostgreSQL, returned by health endpoints, or copied into GitHub comments.

The optional API base URL supports GitHub Enterprise-compatible API roots and local HTTP test endpoints. Production remote API roots must use HTTPS.

## App JWTs

`src/control-plane/github-app/jwt.mjs` creates GitHub App JWTs directly with Node cryptography.

The JWT contract is:

- algorithm: `RS256`;
- `iss`: configured GitHub App client ID;
- `iat`: current time minus 60 seconds to tolerate clock drift;
- `exp`: a short lifetime that remains within GitHub's 10-minute maximum;
- fixed-clock injection for deterministic tests.

JWTs are generated when needed to mint installation access tokens. They are credentials and must not be logged or persisted.

## Installation access tokens

`src/control-plane/github-app/installation-token.mjs` requests installation tokens from:

```text
POST /app/installations/{installation_id}/access_tokens
```

Requests use:

- `Authorization: Bearer <app-jwt>`;
- `Accept: application/vnd.github+json`;
- the current pinned GitHub REST API version;
- a stable RepoOps user agent.

Installation tokens are treated as opaque non-empty strings. RepoOps does not depend on legacy token length or format.

A request may reduce the token scope using explicit repository IDs and permission levels. Scope normalization is deterministic so equivalent scopes share a cache key while different repository/permission scopes never share credentials.

## Cache and refresh semantics

Installation tokens live only in the process-local credential cache for this milestone.

The manager:

- caches a token until it enters a bounded refresh window before `expires_at`;
- never returns a cached token once it is inside that refresh window;
- shares one in-flight mint for concurrent requests for the same installation and scope;
- keeps different scopes in different cache entries;
- does not cache failed mint attempts;
- validates returned expiration before caching;
- never persists App JWTs or installation tokens to PostgreSQL.

The default refresh window is five minutes.

## Installation invalidation

`invalidateInstallation(installationId)` clears cached credentials and advances an in-memory generation for that installation.

Generation checking is important during suspension/uninstall races: if a token mint was already in flight when the installation was invalidated, that stale mint is rejected when it returns and cannot repopulate the cache. A new request after invalidation uses the new generation.

Future installation lifecycle webhooks should call this invalidation path for suspension, removal, or other events that make existing installation credentials unsafe to reuse.

## Failure handling

Token-mint HTTP failures use the existing structured `GitHubApiError` / `GitHubNetworkError` metadata so the later runtime reliability layer can classify authorization, rate limit, transient, and network failures.

The token client deliberately does not include GitHub response bodies in normal token-mint errors. Safe metadata may include status, request ID, `Retry-After`, and rate-limit headers. Retry scheduling belongs to the caller; the token manager does not sleep or blindly retry requests internally.

Malformed token responses fail closed.

## Current boundary

After this milestone the hosted control plane can prove App identity and obtain installation-scoped credentials, but GitHub Actions remains the only repository-mutation runtime.

Still separate future milestones:

- registering/configuring the real RepoOps GitHub App in GitHub;
- production webhook HTTP ingress;
- installation lifecycle persistence/onboarding;
- queue/workers and reconciliation;
- hosted repository mutations and explicit Actions-to-App cutover.
