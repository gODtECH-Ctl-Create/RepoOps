# Idempotency and recovery

Command operation keys hash a versioned tuple of GitHub repository ID, issue ID,
event kind/action and comment ID. They never use comment text as identity. Edited
comments are not new commands; only `issue_comment.created` is handled. Context
IDs must be positive safe integers. Simulator fixtures exercise pure decisions;
real handler fixtures must include GitHub IDs.

A single bot-authored issue comment is both the operation journal and eventual
confirmation. RepoOps paginates comments and accepts receipts only from its
configured bot's numeric identity and Bot account type. The GitHub.com Actions
adapter defaults to github-actions[bot] (41898282); future App adapters must supply
their own trusted bot ID, never derive it from event text. Repository workflows
that can post as this bot share the trust boundary.

Before mutations, the journal records the plan. Each step reads fresh GitHub
state, skips an already-applied mutation, checkpoints that a mutation is about
to run, applies it once, verifies the result, then checkpoints completion. The
same comment becomes the final confirmation only after every step completes.
Completed receipts suppress replay even if a later command changed the issue.
Already-owned claims can reconcile a missing in-progress label.

Retries resume completed steps and inspect a started step. If GitHub confirms its
intended result, execution continues. If a started step's result is absent or
conflicting, RepoOps raises `AmbiguousOperationError` without another mutation.
An API failure is never evidence of success. Receipts with malformed content or
multiple matches fail visibly. Close cleanup independently reconciles fresh
closed-issue state, so it skips removed assignees/labels and ignores reopened issues.

## Operator recovery

Inspect the failed workflow, receipt and issue timeline. A pending receipt is not
success. Do not delete receipts to force a retry: that discards delivery evidence.
A retry can resolve a lost successful response once authoritative state is visible.
If state is still ambiguous, reconcile the issue manually and inspect the plan
before retrying; do not blindly replay old destructive operations.

## Limits

This is recoverable, serialized execution, not transactional exactly-once delivery.
Command and scanner jobs share a repository-wide Actions concurrency group with
`cancel-in-progress: false` and `queue: max`. The queue is bounded and is not a
durable event store; #28 tracks overflow and delivery reconciliation.
Independent webhook workers must supply serialization before using this helper.
Concurrent external/manual edits cannot be locked by these APIs; ownership/state
checks detect observed conflicts but cannot eliminate the read/write race.

GitHub has no conditional comment-create/idempotency-key API. A lost POST response
ends the run; a subsequent run searches for its receipt before posting. If GitHub
has not made the prior comment visible, duplicates remain possible. Deleted or
edited receipts lose evidence; preserve them. Existing pre-upgrade comments are
not receipts and historical workflow reruns are not retroactively deduplicated.
No automatic HTTP retries are performed. A database/queue and stronger operational
event history remain future platform work.
