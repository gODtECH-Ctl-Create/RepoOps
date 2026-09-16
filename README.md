# RepoOps

**RepoOps is an open-source IssueOps and repository-operations automation toolkit for GitHub maintainers.**

It turns repository events and lightweight commands into repeatable maintenance workflows: issue assignment, contributor follow-up, PR queues, stale-work handling, repository health reporting, and eventually release operations.

## Why RepoOps?

Growing repositories create operational work that maintainers repeatedly do by hand:

- assign contributors to issues
- reply with contribution instructions
- track abandoned assignments
- identify PRs waiting for review
- label and triage incoming work
- keep contributor queues current
- surface repository health problems

RepoOps treats that work as automation.

## v0.1 — Issue Claiming

The first feature is a real IssueOps command:

```text
/claim
```

When a contributor posts `/claim` on an unassigned issue, RepoOps:

1. validates that the comment is on an issue, not a pull request
2. checks that the issue is still unassigned
3. assigns the commenter
4. ensures the `status: in-progress` label exists
5. applies the label
6. posts a confirmation comment

If an issue is already assigned, RepoOps leaves ownership unchanged and explains why.

## Architecture

```text
GitHub event
    ↓
GitHub Actions workflow
    ↓
RepoOps event handler
    ↓
Pure command/rules layer
    ↓
GitHub REST API client
    ↓
Issue / PR / repository mutation
```

The code intentionally separates event parsing, decision logic, and GitHub API calls so future features can be tested without making live API requests.

## Local checks

```bash
npm test
npm run check
```

The runtime currently has no third-party dependencies.

## Roadmap

- **v0.1** — `/claim` issue assignment
- **v0.2** — `/unclaim`, assignment timeout and contributor follow-up
- **v0.3** — maintainer/contributor queue
- **v0.4** — PR review queue and stale PR detection
- **v0.5** — repository health reports
- **v0.6** — configurable policy/rules engine
- **v0.7** — reusable GitHub Action
- **v0.8** — GitHub App and multi-repository control plane

## Design principles

- least-privilege GitHub permissions
- deterministic, testable decision logic
- no silent destructive actions
- clear audit trail through GitHub comments and workflow logs
- configuration before hard-coded repository assumptions
- useful to real repositories, not just demonstration environments

## License

MIT
