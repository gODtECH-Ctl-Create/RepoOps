# Contributing to RepoOps

Thanks for helping build RepoOps. The project automates repository operations, so small changes can affect assignments, labels, pull requests, permissions, and contributor workflows. Contributions should therefore be focused, testable, and easy to audit.

## Before you start

1. Check existing issues and pull requests to avoid duplicate work.
2. Prefer an existing issue for non-trivial changes.
3. Comment `/claim` on an available issue before starting work.
4. Keep one issue per pull request unless a maintainer explicitly approves broader scope.

## Development setup

Requirements:
- Node.js 20 or newer
- Git

Clone the repository and run:

```bash
npm install
npm run check
```

RepoOps currently has no third-party runtime dependencies.

## Branch naming

Use a short branch tied to the work:

```text
feat/123-unclaim-command
fix/145-claim-race
 docs/88-architecture-guide
```

Recommended prefixes: `feat/`, `fix/`, `docs/`, `test/`, `refactor/`, `chore/`.

## Making changes

- Put command decision logic in `src/core` when possible.
- Keep GitHub API mutations isolated in `src/github`.
- Do not execute user-controlled issue or comment text as shell code.
- Preserve least-privilege workflow permissions.
- Add or update tests for behavior changes.
- Keep automation idempotent where practical: rerunning an event should not cause harmful duplicate actions.

## Testing

Before opening a pull request, run:

```bash
npm run check
```

For event-driven changes, include a deterministic fixture or unit test. Do not rely only on live GitHub testing.

## Pull requests

A good pull request should include:
- the problem being solved
- the linked issue
- a concise description of the behavior change
- test evidence
- any permission, workflow, or security impact

Keep pull requests small enough to review safely.

## Security-sensitive areas

Changes involving these areas require extra review:
- `.github/workflows/`
- GitHub token permissions
- authentication or GitHub App code
- command authorization
- code that mutates repository state
- release automation

Do not weaken security controls merely to make a workflow pass.

## Contributor ownership

Claiming an issue does not permanently reserve it. RepoOps now sends configured stale-work reminders when no linked implementation PR demonstrates activity; it does not automatically release your assignment. Share progress or use `/unclaim` if you are no longer working on an issue. `/keep` is planned in #7.

## Review expectations

Maintainers may ask for changes when a contribution:
- duplicates existing work
- expands beyond the agreed issue scope
- adds unnecessary dependencies
- changes repository permissions without justification
- lacks tests for operational behavior
- introduces destructive automation without safeguards

Constructive review is part of the contribution process.