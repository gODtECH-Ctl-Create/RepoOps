# Post-merge contributor follow-up

RepoOps can acknowledge a completed contribution after an authoritative linked pull request is merged and the linked issue is closed.

## Completion evidence

RepoOps does not infer completion from free-form issue or pull-request text. It uses GitHub closing relationships and the completed-contribution projection documented in `docs/contributions.md`.

The first-contribution classification is deliberately conservative:

- `first` — authoritative history shows no earlier completed contribution for the contributor.
- `returning` — authoritative history contains an earlier completed contribution.
- `unknown` — history is incomplete or ambiguous, so RepoOps uses the ordinary thank-you and does not claim this is the contributor's first contribution.

## Message behavior

A first completed contribution receives a distinct welcome with the completed issue/PR and configured contributor resources. Returning or unknown contributors receive a shorter completion acknowledgement.

Each issue/merged-PR pair has a stable bot-authored marker. Repeated issue-close and merged-PR deliveries therefore converge on one follow-up comment rather than producing duplicates.

## Next-work suggestions

Suggestions are optional and deterministic. RepoOps considers only open issues that:

- have the configured `status: ready` label;
- have no assignee;
- are not pull requests;
- are not `status: blocked`, `status: in-progress`, or `dependency: blocked`; and
- are not the issue that was just completed.

Eligible issues are ordered by explicit priority metadata (`p0`, `p1`, `p2`, `p3`) and then issue number. RepoOps does not rank contributors or personalize work using contributor identity.

When `contributorLimits.maxActiveAssignments` is enabled, no individual next-work suggestions are shown to a contributor who is already at the active-work limit. Maintainer exemption follows the same repository policy used by `/claim`.

RepoOps never automatically assigns suggested work. Contributors still opt in by opening an available issue and commenting `/claim`.

## GitHub event handling

Both issue-close and merged pull-request events can trigger the same follow-up logic. The `pull_request_target` path executes the repository's base-branch RepoOps code only; contributor branch code is not executed by the post-merge workflow.

Run `npm run check` for message, selection, history, event-routing, and duplicate-suppression regression tests.
