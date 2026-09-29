# RepoOps Roadmap

RepoOps is being built as an open-source repository operations layer for GitHub maintainers. The roadmap prioritizes operational pain that maintainers repeatedly handle by hand: triage, assignment lifecycle, review queues, follow-up, policy enforcement, auditability, and multi-repository visibility.

The roadmap is intentionally staged. Later stages depend on the operational model proven by earlier stages.

## Stage 0 — Contributor-ready foundation

Status: in progress

Goals:

- stable command dispatcher
- validated `.repoops.yml`
- deterministic event fixtures and local simulation
- contribution, security, architecture, development, and AI-agent guidance
- issue and pull-request templates
- release and roadmap conventions
- first maintainer-quality public backlog

Exit criteria:

- contributors can understand the architecture without maintainer hand-holding
- human and AI-assisted contributors have explicit repository safety/validation guidance
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
- configurable contributor active-work limits with maintainer exemption policy

Remaining capabilities:

- `/keep` command
- `/blocked` command and blocked reason
- assignment expiry and safe release (separate future approval/policy)
- maintainer attention queue
- lifecycle event audit entries

Success signals:

- maintainers can see which claimed issues require intervention
- stale assignments are followed up automatically
- contributors can explicitly keep or release work
- RepoOps never silently reassigns active work

## Stage 2 — Pull-request operations

Goal: explain why pull requests are not progressing and who needs to act next.

Implemented foundations:

- linked pull-request discovery from authoritative GitHub relationships
- deterministic pull-request timing helper for review age, author wait age, and response-latency calculations
- duplicate-safe post-merge contributor acknowledgement/follow-up using authoritative completion evidence

Remaining capabilities:

- PR state classifier: waiting for author, maintainer, CI, reviewer, or dependency
- stale PR detection
- linked issue validation beyond existing relationship discovery
- requested-changes follow-up
- CI status summarization
- review queue generation
- maintainer digest
- configurable review SLAs

The timing helper provides reusable measurements; it does **not** by itself implement PR classification, SLA enforcement, or the maintainer review queue.

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

Implemented foundations:

- versioned immutable RepoOps operational event contract with deterministic identities and replay-conflict validation
- deterministic completed-contribution history projection from validated operational events and authoritative linked-PR evidence
- conservative first/returning/unknown contributor classification for post-merge follow-up

Remaining capabilities:

- persistent append-only event storage and event emission from all mutation paths
- issue and PR lifecycle timelines
- structured automation audit trail
- response-time metrics
- assignment completion metrics
- review latency metrics
- abandoned-work metrics
- repository health reports

The current contribution history is an in-process projection, not a persistent analytics database. GitHub remains the source of truth for GitHub resources; RepoOps stores or derives only the operational state needed for automation, audit, and analytics.

## Stage 5 — Reusable distribution

Goal: make RepoOps useful outside its own repository through a lightweight repository-local distribution path.

Planned capabilities:

- reusable GitHub Action
- documented installation workflow
- versioned configuration schema
- compatibility guarantees
- migration tooling
- example repositories
- policy presets

Reusable Actions remain valuable for self-managed or repository-local adoption, but they are now a parallel distribution track rather than a hard prerequisite for the hosted GitHub App. The hosted control-plane path can progress independently while preserving the same deterministic core and configuration contracts.

## Stage 6 — GitHub App control plane

Goal: support organizations and multiple repositories safely.

Implemented foundations:

- replay-safe GitHub webhook delivery identity/registration through an injected durable-store contract
- structured GitHub API/network failures with bounded retry and rate-limit signals
- mutation-aware failure classification that reconciles ambiguous writes instead of blindly replaying them
- GitHub HMAC-SHA256 webhook signature verification against the exact raw payload
- authenticated webhook envelope normalization for current RepoOps repository-operation events
- versioned durable-inbox processing state, worker leases, retry/reconciliation states, recovery classes, and storage adapter contract
- documented GitHub App reliability contract for deduplication, retries, outages, reconciliation, and dead-letter behavior
- hosted control-plane process boundary with validated runtime configuration, health/readiness, and graceful shutdown

See [GitHub App reliability architecture](github-app-reliability.md), [webhook inbox processing](webhook-inbox.md), and [hosted control plane](control-plane.md).

Still required for the hosted control plane:

- PostgreSQL schema/migrations and persistent inbox adapter
- GitHub App authentication and installation-token lifecycle
- production webhook HTTP endpoint wired to verified ingress and durable acceptance
- durable job queue and workers
- persistent retry scheduler
- failed-delivery redelivery/recovery worker
- reconciliation workers
- dead-letter/operator tooling
- persistent operational event store
- installation-scoped permission/access handling
- organization/repository onboarding and readiness validation
- multi-repository policy management
- organization-level maintainer queue

The foundations above do **not** mean a hosted/installable GitHub App exists yet. GitHub Actions remains the current repository-mutation runtime until an explicit App cutover milestone moves selected operations to hosted workers.

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

The dashboard is intended as an optional cross-repository control/visibility surface. GitHub remains the primary place where contributors and maintainers work with issues, pull requests, reviews, and CI.

## Product boundaries

RepoOps should not rebuild capabilities GitHub already provides effectively, such as source hosting, CI engines, merge queues, CODEOWNERS, branch protection, dependency scanning, or package update bots.

RepoOps should coordinate those systems and surface the work that still requires human attention.
