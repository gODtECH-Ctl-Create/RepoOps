# RepoOps Commands

RepoOps commands are explicit issue comments that request repository operations.

## Implemented

### `/claim`

Claims an available GitHub issue for the commenter.

Expected behavior:
- ignore pull request comments
- ignore unrelated comments
- refuse to replace an existing assignee
- assign the commenter when the issue is available
- ensure the configured in-progress label exists
- remove ready before adding in-progress; repeated claims reconcile missing state
- post a confirmation comment

Example:

```text
/claim
```

### `/unclaim`

Releases the commenter's own assignment and returns the issue to available work.

Expected behavior:
- only act when the commenter is currently assigned
- never remove another contributor's assignment
- remove in-progress and restore ready only when the issue is open, unassigned, and available
- post a confirmation comment

Example:

```text
/unclaim
```

Both commands can be disabled through `.repoops.yml`.

## Planned

These commands are roadmap items and are not implemented yet.

### `/keep`
Confirm continued ownership after an automated inactivity reminder.

### `/blocked`
Mark work as blocked and optionally record a short reason without releasing ownership.

### `/ready`
Signal that work is ready for maintainer attention where a repository policy uses that state.

## Command design requirements

New commands should:
- have explicit authorization rules
- be deterministic and testable
- fail safely
- not silently perform destructive actions
- create an understandable audit trail
- avoid interpreting arbitrary natural-language comments as commands
- respect repository configuration and least-privilege permissions

RepoOps should prefer explicit command syntax over guessing contributor intent.

Command deliveries use a bot-authored operation receipt that becomes the final
confirmation. Retries of the same comment do not repeat completed operations.
Commands require a currently open issue. See [recovery guidance](idempotency.md)
if a receipt remains pending after a workflow failure.

## Workflow state transitions

Ready and in-progress are mutually exclusive. Claim transitions ready to
in-progress; unclaim restores ready only if no assignees remain and no blocked,
needs-design, needs-review, or dependency-blocked label makes work unavailable.
Claims on such unavailable issues are refused unless already owned. Unclaim with
another assignee remaining retains in-progress. A repeated unclaim on an
unassigned open issue can repair missing workflow state. Other labels are preserved.
Closing an issue removes both ready and in-progress and clears assignments.
