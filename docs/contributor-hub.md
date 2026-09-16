# Contributor hub

RepoOps publishes a read-only contributor hub at:

```text
https://godtech-ctl-create.github.io/RepoOps/contribute.html
```

The hub makes the public GitHub backlog easier to navigate without replacing GitHub as the source of truth.

## What it does

Contributors can:

- find genuinely available `status: ready` work
- find unassigned `good first issue` work
- filter by difficulty, area, and priority
- view work currently in progress without being told it is available
- open the equivalent GitHub issue search at any time
- open the structured problem-proposal form
- open the feature/upgrade proposal form
- follow the choose → claim → build → PR → review → merge contribution path

## Availability rules

The hub only presents an issue as ready to claim when it is:

- an open issue, not a pull request
- unassigned
- labeled `status: ready`
- not labeled `status: blocked`
- not labeled `status: in-progress`

The browser applies these checks again even though the UI filters already request appropriate work.

Views such as **In progress** and **All open issues** are intentionally observational. Their cards say `View issue` rather than presenting the work as claimable.

## Public GitHub data

The hub reads the repository's public issue endpoint with a maximum of three 100-item pages per page load. It does not poll continuously.

If public API access fails or is rate-limited, the hub keeps working as navigation by generating an equivalent GitHub issue-search URL from the selected filters.

No GitHub token, PAT, OAuth secret, or GitHub App private key is shipped to the browser.

## Mutations stay on GitHub

The contributor hub does not:

- assign issues
- post `/claim`
- create issue comments
- open pull requests
- approve reviews
- merge changes

Every issue card deep-links to GitHub. Contributors claim ready work by commenting:

```text
/claim
```

on the authoritative issue.

## Problem and upgrade proposals

`Propose a problem` opens `.github/ISSUE_TEMPLATE/problem.yml`, which is for concrete maintainer/repository-operation pain points before solution design.

`Propose an upgrade` opens `.github/ISSUE_TEMPLATE/feature.yml`, which is for proposed capabilities and improvements.

Neither proposal form automatically marks the resulting issue `status: ready` or `good first issue`. Maintainers triage proposals first.

## Future integration

Issue #33 will eventually provide a richer contributor/maintainer operations board. The first contributor hub does not depend on that future dashboard; it uses current GitHub state directly and can consume normalized RepoOps operational data later.
