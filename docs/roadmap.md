# RepoOps Roadmap

RepoOps is being built as an open-source repository operations layer for GitHub maintainers. The roadmap prioritizes operational pain that maintainers repeatedly handle by hand: triage, assignment lifecycle, review queues, follow-up, policy enforcement, auditability, and multi-repository visibility.

The roadmap is intentionally staged. Later stages depend on the operational model proven by earlier stages.

## Stage 0 — Contributor-ready foundation

Status: in progress

Goals:

- stable command dispatcher
- validated `.repoops.yml`
- deterministic event fixtures and local simulation
- contribution, security, architecture, and development documentation
- issue and pull-request templates
- release and roadmap conventions
- first maintainer-quality public backlog

Exit criteria:

- contributors can understand the architecture without maintainer hand-holding
- contributors can test changes without mutating live GitHub resources
- security-sensitive code paths are clearly documented
- work is broken into independently reviewable issues

## Stage 1 — Assignment lifecycle and maintainer attention

Goal: stop claimed issues from disappearing into a backlog.

Implemented foundations:

- idempotent event operations and explicit ambiguous-retry recovery
- coherent ready/in-progress assignment transitions
- configurable reminder windows and non-destructive expiry policy
- explicit linked-PR detection
- scheduled stale-assignment reminders (no automatic release)

Remaining capabilities:

- `/keep` command
- `/blocked` command and blocked reason
- assignment expiry and safe release (separate future approval/policy)
- contributor active-work limits
- maintainer attention queue
- lifecycle event audit entries

Success signals:

- maintainers can see which claimed issues require intervention
- stale assignments are followed up automatically
- contributors can explicitly keep or release work
- RepoOps never silently reassigns active work

## Stage 2 — Pull-request operations

Goal: explain why pull requests are not progressing and who needs to act next.

Planned capabilities:

- PR state classifier: waiting for author, maintainer, CI, reviewer, or dependency
- review-age tracking
- stale PR detection
- linked issue validation
- requested-changes follow-up
- CI status summarization
- review queue generation
- maintainer digest
- configurable review SLAs

Success signals:

- maintainers can answer "what needs review?" without scanning every PR
- contributors can see why a PR is blocked
- inactive PRs are surfaced without destructive automatic closure by default

## Stage 3 — Issue intake and triage

Goal: reduce low-signal issue processing.

Planned capabilities:

- incomplete-report detection
- required-information follow-up
- label suggestions and policy-driven labels
- duplicate candidates
- issue readiness classification
- security-sensitive issue routing
- maintainer decision queue
- triage summaries

AI-assisted triage, when introduced, should remain advisory unless repository policy explicitly opts into automation.

## Stage 4 — Event history and repository health

Goal: provide a normalized operational history instead of repeatedly reconstructing state from GitHub APIs.

Planned capabilities:

- append-only RepoOps event model
- issue and PR lifecycle timelines
- automation audit trail
- response-time metrics
- assignment completion metrics
- review latency metrics
- abandoned-work metrics
- repository health reports

GitHub remains the source of truth for GitHub resources. RepoOps stores operational state and derived events needed for automation, audit, and analytics.

## Stage 5 — Reusable distribution

Goal: make RepoOps useful outside its own repository.

Planned capabilities:

- reusable GitHub Action
- documented installation workflow
- versioned configuration schema
- compatibility guarantees
- migration tooling
- example repositories
- policy presets

## Stage 6 — GitHub App control plane

Goal: support organizations and multiple repositories safely.

Planned capabilities:

- GitHub App authentication
- webhook ingestion
- installation-scoped permissions
- persistent event store
- job queue and workers
- retry/idempotency controls
- rate-limit management
- multi-repository policy management
- organization-level maintainer queue

## Stage 7 — Dashboard and analytics

Goal: give maintainers a single operational view across repositories.

Planned capabilities:

- maintainer attention dashboard
- issue lifecycle views
- PR lifecycle views
- contributor work context
- automation audit history
- repository health trends
- cross-repository search and filtering

## Product boundaries

RepoOps should not rebuild capabilities GitHub already provides effectively, such as source hosting, CI engines, merge queues, CODEOWNERS, branch protection, dependency scanning, or package update bots.

RepoOps should coordinate those systems and surface the work that still requires human attention.
