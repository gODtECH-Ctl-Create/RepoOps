# Reusable GitHub Action

RepoOps can be consumed from another repository without copying the RepoOps runtime into that repository.

## Installation

Add a small workflow to the consumer repository:

```yaml
name: RepoOps

on:
  issue_comment:
    types: [created]
  issues:
    types: [closed]
  pull_request_target:
    types: [closed]

permissions:
  contents: read
  issues: write
  pull-requests: write

jobs:
  repoops:
    runs-on: ubuntu-latest
    steps:
      - uses: gODtECH-Ctl-Create/RepoOps@v0
```

RepoOps reads `.repoops.yml` from the consumer repository's workspace. The workflow above deliberately does not check out contributor-controlled pull-request code.

For a repository that already has a checkout step, the RepoOps action still uses its own runtime from `GITHUB_ACTION_PATH` and reads repository policy from the current workspace.

## Configuration

Keep repository-specific policy in `.repoops.yml`:

```yaml
commands:
  claim: true
  unclaim: true

labels:
  ready: "status: ready"
  inProgress: "status: in-progress"

assignments:
  reminderAfterDays: 3
  expireAfterDays: 7
  autoRelease: false
```

See [configuration.md](configuration.md) for the full schema.

## Permissions

The current IssueOps runtime needs:

- `contents: read`
- `issues: write`
- `pull-requests: write`

The `GITHUB_TOKEN` must be available to the action. By default the Action uses `${{ github.token }}`, so no separate secret is required.

Only grant the permissions required by the workflow. RepoOps does not request repository-level permissions from `action.yml` because permissions belong to the caller workflow.

## Versioning

The Action supports normal Git references:

```yaml
# Stable major channel. Receives compatible v0 releases when RepoOps publishes them.
- uses: gODtECH-Ctl-Create/RepoOps@v0

# Exact release. Never changes until you edit the workflow.
- uses: gODtECH-Ctl-Create/RepoOps@v0.3.0
```

The `v0` channel is intentionally a moving compatibility tag. A stable RepoOps release updates the corresponding major channel automatically through the release workflow.

For sensitive or tightly controlled repositories, pin to an exact release or commit SHA instead of a moving major tag.

Prereleases never move the stable major channel.

## Updates

Consumer repositories using `@v0` do not need to copy RepoOps source code when a compatible `v0` release is published. The workflow resolves the current `v0` tag at run time.

Consumer repositories using an exact release tag such as `@v0.3.0` remain on that release.

## Local policy versus central runtime

```
Consumer repository
├── .repoops.yml
└── .github/workflows/repoops.yml

RepoOps repository
└── action.yml + src/
```

The consumer owns the policy. RepoOps owns the implementation.

## Pull request events from forks

The current IssueOps design uses `pull_request_target` only for the merged-pull-request follow-up path. This is intentional because it lets the base repository's workflow run with the base repository token.

Do not add an untrusted `actions/checkout` of contributor-controlled pull-request code before the RepoOps action in a `pull_request_target` workflow.

## Release process

Maintainers can run **Actions → Release RepoOps** and provide a release version such as `0.3.0`.

The workflow:

1. validates the Semantic Versioning value;
2. creates a GitHub Release and tag;
3. generates release notes;
4. moves the matching major channel, such as `v0`, for stable releases.

The major channel is mutable by design. Exact release tags remain immutable consumer references.

## Current scope

The reusable Action exposes the current repository-local IssueOps runtime. The hosted GitHub App remains a separate project and will eventually provide organization-wide multi-repository control without requiring a workflow in every repository.
