# Contributor Diary

The Contributor Diary is an optional RepoOps-maintained GitHub Issue that gives contributors and maintainers a simple operational view.

It shows:
- Issues currently marked in progress and their assignees.
- Up to 12 recent completed RepoOps-managed contributions.
- A neutral contributor snapshot based on those records.

The diary is not a leaderboard. It does not measure quality, speed, reputation, or productivity.

## Configuration

Add this to the repository policy:

contributorDiary:
  enabled: true
  issueNumber: 102

The target Issue must contain the marker:

<!-- repoops:contributor-diary:v1 -->

Do not mark the diary Issue as status: ready. It is an operational projection, not contributor work.

## Refresh

RepoOps refreshes the diary after assignment or unassignment, relevant Issue lifecycle changes, merged Pull Requests, a daily scheduled run, and a manual workflow dispatch.

Repeated refreshes of an unchanged snapshot do not update the Issue.

## Source of truth

The diary is a projection. GitHub Issues and Pull Requests remain authoritative.

The first version reads the existing in-process contribution-history projection. The durable cross-run and cross-repository ledger remains the purpose of Issue #87.

## Safety

RepoOps validates the configured Issue number and requires the diary marker before it can update the Issue. It writes contributor login names only; no email, token, secret, or scoring data is stored.
