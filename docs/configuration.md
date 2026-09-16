# RepoOps Configuration

RepoOps reads repository policy from `.repoops.yml`.

Current supported configuration:

```yaml
commands:
  claim: true
  unclaim: true

labels:
  inProgress: "status: in-progress"
  ready: "status: ready"

assignments:
  reminderAfterDays: 3
  expireAfterDays: 7
  autoRelease: false
```

## `commands`

### `claim`
Boolean. Enables or disables `/claim`.

Default: `true`.

### `unclaim`
Boolean. Enables or disables `/unclaim`.

Default: `true`.

## `labels`

### `inProgress`
Non-empty string. Label applied when an issue is successfully claimed and removed when the assignment is released or the issue closes.

Default: `status: in-progress`.

## Validation behavior

RepoOps deliberately rejects unknown sections and unknown keys. This prevents misspelled policy from being silently ignored.

The current parser also requires:

- two-space indentation for values
- no tabs
- boolean values for command switches
- a non-empty string for `labels.inProgress`

When `.repoops.yml` is absent, RepoOps uses safe defaults.

## Local simulation

Contributors can inspect RepoOps decisions without mutating GitHub resources.

```bash
npm run simulate -- test/fixtures/claim-event.json
npm run simulate -- test/fixtures/closed-event.json
```

The simulator reads the event fixture and local `.repoops.yml`, then prints the decision RepoOps would make.

Simulation is not a substitute for unit tests. Changes to command or lifecycle behavior should include deterministic tests and, where useful, representative fixtures.

## Configuration compatibility

`.repoops.yml` is a public interface. New options should default safely. Renaming or removing existing keys requires migration guidance and should follow the release policy in `docs/releases.md`.

## Assignment lifecycle policy

`reminderAfterDays` defaults to 3 and `expireAfterDays` defaults to 7. Each must
be an unquoted integer from 1 through 36500; expiry must be strictly later than
the reminder threshold. Zero, negative, fractional, quoted numeric, duplicate,
and unknown settings are rejected. Limits keep UTC day arithmetic bounded.

`autoRelease` is a boolean and defaults to false. These settings configure policy;
this version does not implement automatic expiry or release, even when true is
explicitly configured. The scheduled scanner remains reminder-only. See [stale reminders](stale-assignments.md) for window and linked-PR rules.

`labels.ready` defaults to `status: ready`. It and `labels.inProgress` must be
non-empty trimmed strings with distinct names (case-insensitive). Existing
configurations receive these new defaults without requiring migration.
