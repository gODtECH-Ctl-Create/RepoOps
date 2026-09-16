# Linked implementation pull requests

`findLinkedPullRequests(client, issueNumber)` uses GitHub GraphQL
`Issue.closedByPullRequestsReferences(includeClosedPrs: true)`. This is GitHub's
explicit closing/manual-link relationship, not a body-text or timeline mention
search. Manually linked PRs are included (GitHub's default); closing keywords
qualify only when GitHub establishes that relationship. Ordinary `see #123` and
`related to #123` mentions are not implementation evidence. Relationships visible
to the token define coverage; inaccessible private cross-repository links cannot
be guaranteed. A removed relationship is no longer reported.

The result contains `relationship: "github-closing-reference"`, `pullRequests`,
and separate `open`, `merged`, `closed` arrays. Each PR includes ID, number,
repository, URL, lower-case state, draft status, and nullable merge timestamp.
Draft open PRs count as implementation activity. Closed-unmerged PRs remain
explicitly distinguishable from merged work. This helper makes no mutation or
stale-assignment policy decision.

Pagination follows cursors until exhausted, deduplicates identical boundary
entries, and rejects repeated/missing cursors, malformed responses, inconsistent
PR state, HTTP errors, and GraphQL partial errors. Failures throw; callers must
not convert them to an empty successful result. Read-only issue and pull-request
access is sufficient; permissions are limited to repositories visible to the token.

## Read-only live inspection

Run `GITHUB_REPOSITORY=owner/repo REPOOPS_ISSUE_NUMBER=123 node
scripts/inspect-linked-prs.mjs` with `GITHUB_TOKEN` supplied securely in the
environment. Or use Actions → Linked PR integration → Run workflow, enter an
issue number, and inspect the job's JSON output. No comments or labels are written.
Internal PR changes to this helper also exercise the live query with read-only
permissions. This supplemental integration job does not replace deterministic
`npm run check` tests; fork PRs do not run that integration job.

Schema reference: https://docs.github.com/en/graphql/reference/issues#issue
