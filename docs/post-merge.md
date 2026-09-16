# Post-merge contributor follow-up

RepoOps can acknowledge a completed contribution after an authoritative linked pull request is merged and the linked issue is closed.

## Completion evidence

RepoOps does not infer completion from free-form issue or pull-request text. It uses GitHub closing relationships and the completed-contribution projection documented in `docs/contributions.md`.

The first-contribution classification is deliberately conservative:

- `first` — authoritative history shows no earlier completed contribution for the contributor.
- `returning` — authoritative history contains an earlier completed contribution.
- `unknown` — history is incomplete or ambiguous, so RepoOps uses the ordinary thank-you and does not claim this is the contributor's first contribution.

## Message behavior

A completed contribution is acknowledged on two surfaces:

- **Merged pull request** — a short contributor-facing acknowledgment appears where the contributor just finished working. First contributions receive a distinct welcome; returning or unknown contributors receive a normal thank-you. The PR message points back to the completed issue.
- **Linked issue** — the detailed completion record contains the issue/PR relationship, configured contributor resources, and any deterministic next-work suggestions.

This keeps the PR conversation immediately useful to the contributor without duplicating the longer resource and next-work content.

Post-merge messages reuse the existing `contributorGuidance` policy. Two optional HTTPS fields are specifically useful after completion:

```yaml
contributorGuidance:
  contributorHubUrl: "https://example.com/contribute"
  roadmapUrl: "https://example.com/roadmap"
```

Both fields default to empty strings and are display-only links. RepoOps itself points them at the public Contributor Hub and repository roadmap.

The issue follow-up and PR acknowledgment each have their own stable bot-authored marker. Repeated issue-close and merged-PR deliveries therefore converge without duplicate comments on either surface. If one write succeeds and the other fails, a later delivery repairs only the missing surface.

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

Run `npm run check` for message, selection, history, event-routing, two-surface recovery, and duplicate-suppression regression tests.
