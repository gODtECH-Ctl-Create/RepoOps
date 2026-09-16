# Completed contribution history

RepoOps builds completed-contribution history as a **pure projection**, not as a new database.

The projection combines two trustworthy inputs:

1. validated version-1 operational events from `src/core/events.mjs`; and
2. authoritative GitHub closing references from linked-PR discovery.

It never guesses an issue/PR relationship from free-form text.

## Completed record

A resolved contribution record contains only the operational identity needed by later views:

- repository ID and `owner/repo`
- issue ID and number
- contributor numeric GitHub account ID
- linked pull-request repository and number
- merge/completion timestamp
- operational event IDs used as evidence

The record intentionally excludes email, issue bodies, PR bodies, contributor scoring, rankings, and other unnecessary personal data.

Records use a deterministic `roc1_...` identity based on repository, issue, and pull request. Exact event replays are deduplicated under the operational event model's existing replay rules. Conflicting event identities remain errors rather than being silently collapsed.

## Required evidence

A completed record requires all of the following:

- an authoritative `github-closing-reference` relationship for the issue
- a linked pull request whose authoritative state is `merged`
- exactly one matching `github.pull_request.merged` operational event
- exactly one active assignee/contributor at merge time based on assignment/claim lifecycle events

If the merge relationship exists but evidence is incomplete or ambiguous, RepoOps keeps an **unresolved completion** instead of guessing.

Current unresolved reasons:

- `missing-merge-event`
- `ambiguous-merge-event`
- `missing-assignee`
- `ambiguous-assignee`

An unlinked merged PR does not create contribution history.

## Reopen / replay behavior

A merged issue/PR pair produces one deterministic contribution record. Later issue close observations, including a reopen/reclose cycle, do not create duplicate contribution records.

Unknown operational event schema versions/types remain explicit validation failures according to `docs/events.md`; this projection does not silently treat future events as understood.

## First-contribution classification

`priorContributionStatus(projection, contributorId, cutoff)` returns one of:

- `first` — no earlier completed record exists for that contributor and no earlier unresolved completion makes the answer ambiguous
- `returning` — at least one earlier completed record exists for that contributor
- `unknown` — an earlier unresolved completion means RepoOps cannot safely claim this is the contributor's first completion

The cutoff is exclusive: the contribution currently being completed does not count as a prior contribution.

This conservative three-state result is the contract consumed by #35. If the result is `unknown`, post-merge messaging must use the normal thank-you rather than a first-contribution welcome.

## Scope

This is an in-process read model. It does **not**:

- add persistent storage
- backfill all GitHub history from before RepoOps events existed
- create contributor leaderboards or reputation scores
- emit the operational events themselves (#20 owns emission/audit logging)
- post contributor messages (#35 owns post-merge follow-up)

Run `npm run check` for projection, replay, ambiguity, and first-contribution regression tests.
