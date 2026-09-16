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

RepoOps v0.2 has a working IssueOps foundation.

Implemented commands:

```text
/claim
/unclaim
```

Current foundation includes:

- GitHub Actions event handling
- slash-command dispatcher
- validated `.repoops.yml`
- configurable in-progress label
- safe assignment release
- automatic claim-state cleanup when an issue closes
- deterministic tests and event fixtures
- local event simulation

Read the [command guide](docs/commands.md) and [configuration guide](docs/configuration.md) for current behavior.

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
4. review the [issue taxonomy](docs/issue-taxonomy.md)
5. check existing issues before proposing new work
6. comment `/claim` on an available issue before starting substantial work

Security-sensitive changes receive additional review. See [SECURITY.md](SECURITY.md).

All participants are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Local checks

Requirements: Node.js 20+ and Git.

```bash
npm install
npm run check
npm run simulate -- test/fixtures/claim-event.json
```

The runtime currently has no third-party dependencies.

## Roadmap

RepoOps is being developed in stages from IssueOps automation to PR operations, triage, operational event history, reusable distribution, a GitHub App control plane, and multi-repository analytics.

Read the detailed [product roadmap](docs/roadmap.md).

Release/versioning expectations are documented in [docs/releases.md](docs/releases.md), and user-visible changes are tracked in [CHANGELOG.md](CHANGELOG.md).

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

## Assignment safety and reminders

Claims transition ready → in-progress; unclaim restores ready when work is open
and available, and close clears active states. Repeated deliveries use authenticated
operation receipts. Scheduled reminders consider bot-authored assignment age and
explicit implementation PR links; they never automatically release work.

See [assignment configuration](docs/configuration.md), [retry recovery](docs/idempotency.md),
and [scanner operation and live validation](docs/stale-assignments.md).
