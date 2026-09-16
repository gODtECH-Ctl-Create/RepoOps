# RepoOps

**RepoOps is an open-source IssueOps and repository-operations automation toolkit for GitHub maintainers.**

It turns repository events and explicit commands into repeatable maintenance workflows: issue assignment, contributor follow-up, PR queues, stale-work handling, repository health reporting, and eventually multi-repository operations.

## Why RepoOps?

Growing repositories create operational work that maintainers repeatedly do by hand:

- assign contributors to issues
- reply with contribution instructions
- track abandoned assignments
- identify PRs waiting for review
- label and triage incoming work
- keep contributor queues current
- surface repository health problems

RepoOps treats that work as automation while keeping humans in control of consequential decisions.

## Current status

RepoOps v0.1 is working end to end in this repository.

Implemented:

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
Pure command / policy layer
    ↓
GitHub API adapter
    ↓
Issue / PR / repository mutation
```

The code separates event parsing, decision logic, and GitHub API calls so behavior can be tested without live API requests.

Read the full [architecture guide](docs/architecture.md).

## Contributing

RepoOps is being built as a real open-source product and welcomes focused contributions.

Before contributing:

1. read [CONTRIBUTING.md](CONTRIBUTING.md)
2. review the [development guide](docs/development.md)
3. understand the [command model](docs/commands.md)
4. check existing issues before proposing new work
5. comment `/claim` on an available issue before starting substantial work

Security-sensitive changes receive additional review. See [SECURITY.md](SECURITY.md).

All participants are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Local checks

Requirements: Node.js 20+ and Git.

```bash
npm install
npm run check
```

The runtime currently has no third-party dependencies.

## Roadmap

- **v0.1** — `/claim` issue assignment
- **v0.2** — command dispatcher, `/unclaim`, assignment lifecycle, contributor follow-up
- **v0.3** — maintainer/contributor work queue
- **v0.4** — PR review queue and stale PR detection
- **v0.5** — repository health and operational event history
- **v0.6** — configurable policy/rules engine
- **v0.7** — reusable GitHub Action
- **v0.8** — GitHub App and multi-repository control plane

The roadmap is intentionally broad. Public roadmap issues should represent real maintainer pain, not artificial contribution tasks.

## Design principles

- solve repetitive or hard-to-see maintainer work
- use GitHub's built-in capabilities instead of recreating them without reason
- least-privilege GitHub permissions
- deterministic, testable decision logic
- no silent destructive actions
- clear audit trail for repository mutations
- safe retries and idempotent behavior where practical
- configuration before repository-specific hard-coding
- treat contributor-controlled content as untrusted input
- useful to real repositories, not just demonstration environments

## License

MIT
