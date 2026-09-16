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

contributorGuidance:
  enabled: true
  requirements: "Node.js 20+ and Git"
  setupCommand: "npm install"
  checkCommand: "npm run check"
  contributingUrl: "https://github.com/example/project/blob/main/CONTRIBUTING.md"
  developmentUrl: "https://github.com/example/project/blob/main/docs/development.md"
  architectureUrl: "https://github.com/example/project/blob/main/docs/architecture.md"
  problemUrl: "https://github.com/example/project/issues/new?template=problem.yml"
  upgradeUrl: "https://github.com/example/project/issues/new?template=feature.yml"
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

### `ready`
Non-empty string. Label used for open work that is available to claim.

Default: `status: ready`.

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

## Contributor guidance

`contributorGuidance` controls contributor-facing guidance around claiming work.

A **new successful** `/claim` can include repository-owned setup/check instructions and documentation links. A first ordinary human comment on an explicitly ready, unassigned, unblocked issue can also receive a one-time reminder that ownership requires the exact `/claim` command, plus optional problem/upgrade proposal routes.

RepoOps intentionally keeps project-specific commands out of the global defaults. If a repository does not configure commands or documentation URLs, contributors still receive generic guidance, but RepoOps does not guess the project's setup or test commands.

Supported keys:

- `enabled` — boolean; defaults to `true`. Set to `false` to disable contributor guidance.
- `requirements` — optional display-only requirements text, for example `Node.js 20+ and Git`.
- `setupCommand` — optional display-only setup command, for example `npm install`.
- `checkCommand` — optional display-only validation command, for example `npm run check`.
- `contributingUrl` — optional absolute HTTPS URL to the contributor guide.
- `developmentUrl` — optional absolute HTTPS URL to development/setup documentation.
- `architectureUrl` — optional absolute HTTPS URL to architecture documentation.
- `problemUrl` — optional absolute HTTPS URL for proposing a broader problem.
- `upgradeUrl` — optional absolute HTTPS URL for proposing a feature or upgrade.

### Ordinary-comment guidance

RepoOps does not infer assignment intent from natural language. On an open issue it will only advertise `/claim` when the issue is explicitly carrying the configured ready label, has no assignee, and has no blocking state.

The guidance is suppressed when:

- the same actor has already received the one-time nudge on that issue
- the issue is assigned, blocked, closed, or not explicitly ready
- the comment belongs to a pull request
- the author is a bot
- the comment is already a recognized slash command

This keeps normal issue discussion usable without turning RepoOps into a reply bot.

Safety rules:

- setup/check values are **display-only**; RepoOps never executes them.
- project-specific commands must be explicitly repository-configured.
- guidance URLs must be absolute `https://` URLs.
- command/display fields reject backticks so repository policy cannot break generated inline-code formatting.
- repeated delivery of the same claim event reuses the existing idempotent receipt instead of posting duplicate onboarding.
- ordinary-comment guidance uses a bot-authored actor marker and the repository mutation queue to suppress duplicate nudges.
- already-owned, blocked, closed, unavailable, or otherwise denied claims do not receive a misleading success/onboarding message.

RepoOps itself configures Node.js 20+, `npm install`, `npm run check`, its contributor/development/architecture guides, and its structured problem/upgrade issue forms.

## Validation behavior

RepoOps deliberately rejects unknown sections and unknown keys. This prevents misspelled policy from being silently ignored.

The current parser also requires:

- two-space indentation for values
- no tabs
- boolean values for command switches and `contributorGuidance.enabled`
- non-empty trimmed workflow label strings
- bounded integer assignment windows
- validated contributor-guidance strings and HTTPS documentation/proposal URLs

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
