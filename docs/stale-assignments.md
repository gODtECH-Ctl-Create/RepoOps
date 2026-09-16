# Stale-assignment reminders

The Stale assignment reminders workflow runs daily at 09:17 UTC and can be
started manually. It **only reminds**. It never releases, expires, reassigns or
closes contributor work, even if `assignments.autoRelease` is true or expiry has
passed. `/keep` is still future work (#7); reminders request an update or /unclaim.
Free-form updates do not reset the timer in this first version.

## Evidence and decisions

Collection lives in `src/github/stale-scanner.mjs`; pure decisions and UTC time
arithmetic live in `src/core/stale-assignment.mjs`. Mutation execution reuses
#24's authenticated comment receipts. The scanner:

1. Paginates open issues with the configured in-progress label and excludes PRs.
2. Reads current issue state and its paginated assignment timeline.
3. Requires exactly one assignee and that assignee's latest active assignment
   event to have been authored by the configured RepoOps bot. Manual assignments
   with an in-progress label are not assumed to belong to RepoOps. Missing history
   fails visibly; the issue's `updated_at` is never used as assignment age.
4. Reads explicit linked PRs. Any open PR (including draft) suppresses reminders.
   A linked PR merged during the current assignment also suppresses reminders.
   Older merged PRs do not suppress reminders for a new assignment. Closed,
   unmerged PRs do not demonstrate ongoing implementation.
5. Computes a window from elapsed UTC time divided by `reminderAfterDays`.
   Exactly the threshold is stale. With a 3-day policy, windows start on days 3,
   6, 9, etc. Only the current window is considered; missed windows are not replayed.
6. Uses repository ID, issue ID, assignment event ID, policy interval and window
   for reminder identity. It checks the receipt, then recollects current state
   before writing. A complete receipt suppresses all repeat runs in that window.

A policy interval change defines a new set of windows. Reassignment creates a new
assignment epoch. Receipt loss, external read/write races and inaccessible PR
relationships have the limits documented in [idempotency](idempotency.md) and
[linked PRs](linked-pull-requests.md). Multiple-assignee issues are conservatively
skipped. Contradictory ready/in-progress state is an error, not assumed stale work.
A current linked merged PR on an open issue requires maintainer follow-up; this
scanner does not close the issue or keep nagging its contributor.

## Safe manual operation

Actions → Stale assignment reminders → Run workflow:

- Leave **dry_run** enabled to collect current evidence and print decisions only.
- Optionally supply **issue_number** to restrict the scan.
- Disable dry_run to post appropriate reminders using the real current UTC time.
- Select **live_validation** to test a newly created disposable issue instead of
  scanning existing issues. The test assigns the invoking human actor, verifies
  a fresh result, advances its injected clock to the threshold, posts one real
  reminder, repeats the scan, verifies ownership is unchanged, and closes/cleans
  that issue in a finally block. The synthetic clock never applies to existing
  issues. Human actors must be assignable in the repository.

The disposable live test also runs after a main-branch push changing scanner
files. It needs only contents read, issues write and pull-requests read. It does
not create branches or PRs. If cleanup fails, the run fails and logs the issue
number for manual cleanup; canceled jobs cannot guarantee finally execution.
Open/merged linked PR suppression is deterministic-test coverage, complemented
by the separate live Linked PR integration workflow.

Local read-only collection:

```bash
REPOOPS_DRY_RUN=true REPOOPS_ISSUE_NUMBER=123 node scripts/scan-stale-assignments.mjs
```

Supply `GITHUB_TOKEN` and `GITHUB_REPOSITORY` securely in the environment.
`REPOOPS_NOW` accepts an explicit UTC timestamp for dry runs only; write-mode
clock overrides are rejected. No contributor text is interpolated into shell code.

## Serialization and failures

Command and scanner jobs share a repository mutation concurrency group, with
`cancel-in-progress: false` and `queue: max`. Moving command concurrency to job
scope prevents ignored comments from occupying this group. A scan serializes
with commands; trade-off: a long scan delays commands. GitHub's queue is bounded
(100 pending jobs) and dispatch order is not guaranteed; #28 tracks remaining
delivery/overflow work. No external worker should mutate concurrently without
joining an equivalent serialization mechanism.

API/GraphQL errors stop the scan and fail the job. Earlier successful reminders
remain safely receipted and are skipped on retry; failure never becomes an empty
successful evidence set. Rate-limit-aware retries remain #25. Scheduled Actions
may be delayed; test decisions using a captured UTC clock rather than assuming
exact schedule delivery. Inspect failed runs and pending receipts before retrying.
