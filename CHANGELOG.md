# Changelog

All notable user-visible changes to RepoOps will be documented in this file.

The format follows Keep a Changelog-style categories and the project intends to use semantic versioning for public releases.

## Unreleased

### Added

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
- CI workflow
