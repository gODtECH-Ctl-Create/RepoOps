# RepoOps Commands

RepoOps commands are comments that intentionally request repository operations.

## Implemented

### `/claim`

Claims an available GitHub issue for the commenter.

Expected behavior:
- ignore pull request comments
- ignore unrelated comments
- refuse to replace an existing assignee
- assign the commenter when the issue is available
- ensure `status: in-progress` exists
- apply the status label
- post a confirmation comment

Example:

```text
/claim
```

## Planned

These commands are roadmap items and are not implemented yet.

### `/unclaim`
Release the commenter's assignment and return the issue to available work.

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

RepoOps should prefer explicit command syntax over guessing contributor intent.