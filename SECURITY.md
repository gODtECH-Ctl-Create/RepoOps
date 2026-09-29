# Security Policy

RepoOps automates repository state and may operate with GitHub write permissions. Security reports should be handled carefully.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could enable unauthorized repository changes, token exposure, command abuse, privilege escalation, workflow injection, or other security impact.

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
- GitHub App authentication and installation tokens
- command parsing and authorization
- webhook validation
- repository mutation logic
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

## GitHub App webhook verification

A future hosted RepoOps GitHub App must authenticate every webhook before the delivery can consume application work.

`src/github/webhook-signature.mjs` verifies GitHub's `X-Hub-Signature-256` HMAC-SHA256 signature against the exact raw request body using constant-time comparison.

The required ingress order is:

```text
receive raw request
  -> verify X-Hub-Signature-256
  -> reject unauthenticated/malformed request
  -> parse trusted envelope/payload
  -> register delivery in the durable inbox
  -> enqueue accepted work
```

Do not parse and re-serialize JSON before signature verification. Do not add a production path that bypasses webhook verification. The webhook secret must be supplied securely by the hosted runtime and must never be committed, logged, included in errors, or written into GitHub comments.

Delivery GUID validation/deduplication is a separate reliability control; it does not authenticate the sender.

See `docs/github-app-reliability.md` for the broader webhook, retry, reconciliation, and outage model.

## Supported versions

Until RepoOps reaches a stable release, security fixes are applied to the latest code on `MASTER`. A version support matrix will be added when versioned releases begin.