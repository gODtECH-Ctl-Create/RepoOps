# Development Guide

## Requirements

- Node.js 20+
- Git

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
```

`npm run check` is the minimum verification expected before opening a pull request.

## Working on an issue

1. Find an available issue.
2. Comment `/claim`.
3. Create a branch from the latest `MASTER`.
4. Implement the smallest complete change.
5. Add or update tests.
6. Run `npm run check`.
7. Open a pull request and link the issue.

Example:

```bash
git checkout MASTER
git pull
git checkout -b feat/123-unclaim-command
```

## Testing event-driven behavior

Prefer pure tests over live GitHub experiments.

For command logic, construct event-like input and assert the returned decision. Live repository testing should be used only as final integration proof after deterministic tests pass.

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

## Dependency policy

RepoOps currently has no third-party runtime dependencies. Add a dependency only when it materially reduces complexity or risk and cannot reasonably be handled by Node.js or the GitHub API directly.

Pull requests adding dependencies should explain why the dependency is needed.

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
