# Issue Taxonomy

RepoOps uses issue metadata to keep a growing contributor backlog understandable and reviewable.

Each implementation issue should communicate three things:

1. the product area it belongs to
2. the expected contributor difficulty
3. the current workflow state

## Area labels

Recommended area labels:

- `area: issueops` — issue commands and assignment lifecycle
- `area: pull-requests` — PR state, review queues, merge readiness, CI context
- `area: triage` — issue intake, classification, duplicates, missing information
- `area: policy` — `.repoops.yml`, rules, validation, permissions and configuration
- `area: github-api` — REST/GraphQL integration, pagination and rate limits
- `area: automation` — GitHub Actions, schedules, workflow orchestration
- `area: events` — event model, audit trail and lifecycle history
- `area: security` — command authorization, permissions, abuse resistance
- `area: developer-experience` — CLI, simulator, fixtures and local workflows
- `area: observability` — logs, metrics and health reporting
- `area: docs` — documentation and examples
- `area: platform` — GitHub App, webhooks, persistence, workers and multi-repo support

## Difficulty labels

- `difficulty: starter` — narrowly scoped; architecture is already established; usually one small module/test/doc change
- `difficulty: intermediate` — requires understanding more than one module or GitHub API behavior
- `difficulty: advanced` — security, concurrency, persistence, auth, rate limits, distributed workflows, or architecture changes

Difficulty describes the work, not the contributor.

## Workflow labels

- `status: ready` — scoped and available for contribution
- `status: in-progress` — currently claimed
- `status: blocked` — cannot progress until a dependency or decision is resolved
- `status: needs-design` — requires maintainer design before implementation
- `status: needs-review` — implementation exists and is awaiting review

RepoOps currently creates `status: in-progress` automatically when `/claim` succeeds.

## Common GitHub labels

Use GitHub's standard labels where appropriate:

- `good first issue` — genuinely small and safe first contribution
- `help wanted` — maintainers welcome community implementation
- `bug` — existing behavior is incorrect
- `enhancement` — new or expanded capability
- `documentation` — primarily documentation work

## Issue quality standard

A public engineering issue should include:

- problem statement
- why the problem matters to maintainers
- intended behavior
- scope and non-goals
- likely files or architectural area
- acceptance criteria
- test expectations
- security/permission considerations when relevant
- dependencies or blockers

Avoid issues that only say "add X" or exist solely to manufacture beginner work.

## Claiming work

An issue marked ready may be claimed with:

```text
/claim
```

The contributor should work on one focused issue at a time unless a maintainer explicitly approves parallel work.

When work cannot continue, use `/unclaim` until richer lifecycle commands such as `/blocked` and `/keep` are available.

## Backlog design

The backlog should intentionally contain a mix of:

- small improvements that teach the existing architecture
- independent feature slices
- test and reliability work
- documentation and examples
- deeper platform/security work

The project should never create fake TODOs purely to increase issue count.
