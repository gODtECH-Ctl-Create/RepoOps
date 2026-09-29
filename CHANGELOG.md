# Changelog

All notable user-visible changes to RepoOps will be documented in this file.

The format follows a Keep a Changelog-style categories and the project intends to use semantic versioning for public releases.

## Unreleased

### Added

- Reusable composite GitHub Action for consuming the current RepoOps IssueOps runtime without copying RepoOps source into consumer repositories, with repository-local `.repoops.yml` policy support and least-privilege token guidance.

- Versioned release workflow that creates GitHub Releases and moves stable major-channel tags such as `v0` for compatible releases.

- GitHub App identity/authentication foundation with RS256 App JWT generation, isolated private-key configuration, installation-token minting, deterministic scope-aware caching, refresh-window handling, concurrent single-flight acquisition, safe invalidation, and sanitized GitHub failure metadata.

- PostgreSQL persistence for the hosted durable webhook inbox, including versioned/checksummed migrations, atomic delivery+payload acceptance, compare-and-swap state updates, indexed recovery queries, payload-integrity verification, scoped repository reads, and real PostgreSQL CI integration tests.

- Hosted control-plane process skeleton with validated runtime configuration, dependency-injectable health/readiness checks, bounded graceful shutdown, and a separate entry point that leaves current GitHub Actions repository operations unchanged.

- Independent post-merge acknowledgment on the merged pull request, with first-contributor recognition and duplicate-safe recovery when the detailed issue follow-up already exists.

- Idempotent post-merge contributor follow-up with conservative first-contribution recognition, contributor resources, and deterministic next-work suggestions that respect readiness and active-work limits.

- Configurable contributor active-work limits for RepoOps-managed issue assignments, with paginated discovery, maintainer exemption, and explicit at-limit guidance.

- Deterministic completed-contribution history projection from operational events and authoritative linked-PR relationships, including conservative first/returning/unknown contributor classification.

- One-time contributor guidance on ordinary comments for explicitly ready issues, directing contributors to `/claim` and configured problem/upgrade proposal routes without inferring ownership from natural language.

- Configurable contributor onboarding on successful `/claim`, including repository-owned requirements, setup/check commands, and contributor/development/architecture links without executing configured text.

- Version-1 operational event contract with immutable records, typed metadata, source-based identities, and explicit replay conflicts.

- Scheduled, non-destructive stale-assignment reminders using assignment timeline evidence and linked PRs, with per-window receipts and disposable live validation.

- Paginated explicit linked-PR detection, normalized open/merged/closed results, and read-only live inspection.

- Validated assignment reminder/expiry policy with non-destructive defaults.

- Trusted operation keys, authenticated progress receipts, fresh-state mutation checks, and explicit ambiguous-retry errors.

- `/claim` issue assignment command
- `/unclaim` assignment release command
- automatic cleanup of RepoOps-managed assignment state when an issue closes
- validated `.repoops.yml` repository configuration
- slash-command dispatcher
- deterministic GitHub event fixtures and local simulator
- contributor, architecture, development, security, and command documentation

### Changed

- CI now installs the pinned `pg` client and validates hosted persistence against a PostgreSQL 16 service in addition to deterministic unit tests.

- Commands and scanner share a bounded repository mutation queue to prevent overlapping writes.

- Claim/unclaim now transition ready/in-progress coherently; close clears both active labels.

- IssueOps event handling now routes commands through a reusable command boundary rather than hard-coding `/claim` in the entrypoint.

## 0.1.0

Initial RepoOps proof of concept:

- GitHub Actions IssueOps workflow
- `/claim` automation
- GitHub REST API client
- automated issue assignment and `status: in-progress` label
- deterministic core tests