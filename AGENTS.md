# AGENTS.md — AI Contributor Contract for RepoOps

RepoOps welcomes human contributors, AI-assisted contributors, and autonomous coding agents operating under human supervision. This file is the repository-wide instruction contract for AI systems working in this codebase.

It complements `CONTRIBUTING.md`, `SECURITY.md`, and the documents under `docs/`; it does not replace them.

## 1. Instruction precedence

When instructions conflict, follow this order:

1. Explicit maintainer instructions on the current issue or pull request.
2. The nearest applicable `AGENTS.md` in the directory tree, if one is introduced later.
3. This root `AGENTS.md`.
4. `CONTRIBUTING.md`, `SECURITY.md`, architecture/release documentation, and issue acceptance criteria.
5. Existing implementation patterns and tests.

A nested `AGENTS.md` may specialize rules for a directory, but it must not silently weaken repository-wide safety, security, least-privilege, idempotency, or human-control requirements.

## 2. Human accountability

AI may assist with research, implementation, tests, documentation, refactors, debugging, and review preparation.

AI must not be treated as the final authority for:

- destructive repository operations;
- permission expansion;
- authentication or secret handling;
- release decisions;
- security-sensitive behavior;
- compatibility guarantees;
- production deployment approval;
- merge approval.

The human contributor or maintainer remains responsible for validating the final diff, test results, permissions, security impact, and issue scope before pushing, requesting review, or merging.

Do not claim that a change is safe, tested, production-ready, or complete unless the relevant evidence exists.

## 3. Required research before coding

Do not start implementation from the issue title alone.

Before changing code:

1. Read the complete issue, including acceptance criteria, dependencies, non-goals, and discussion.
2. Check for overlapping open pull requests or recently merged work.
3. Read the relevant existing implementation and its tests.
4. Read the relevant architecture/configuration documentation.
5. Identify public interfaces affected by the change:
   - slash commands;
   - `.repoops.yml`;
   - GitHub permissions;
   - workflow triggers;
   - event contracts;
   - exported helpers;
   - installation/runtime behavior.
6. Identify failure and retry behavior before implementing a GitHub mutation.
7. Prefer extending an existing abstraction over creating a parallel implementation.

For unfamiliar GitHub behavior, verify against current GitHub documentation rather than relying on memory.

## 4. Scope discipline

RepoOps follows focused, auditable changes.

- Prefer one issue per pull request.
- Implement the issue acceptance criteria and required supporting work; do not silently broaden scope.
- Do not mix unrelated cleanup, renaming, dependency changes, formatting churn, or architectural rewrites into a focused change.
- If you discover a separate problem, document it as follow-up work instead of expanding the current change unless the issue cannot be completed safely without it.
- Preserve backward compatibility unless the issue explicitly authorizes a breaking change.

AI-generated enthusiasm is not a reason to expand scope.

## 5. Repository architecture

### `src/core/`

Contains deterministic repository-operation decisions and domain policy.

Rules:

- Prefer pure functions.
- Do not call GitHub or other networks directly.
- Accept explicit data and return decisions, classifications, or action plans.
- Keep policy independently testable.
- Do not hide repository-specific assumptions in core logic; use validated configuration.

### `src/github/`

Contains GitHub API reads, adapters, and repository mutations.

Rules:

- Keep GitHub transport concerns out of `src/core`.
- Validate GitHub responses before trusting them.
- Preserve enough structured error information for safe retry/reconciliation decisions.
- Do not expose authorization headers, tokens, secrets, or unnecessary raw payloads in logs/errors.
- Mutations must be idempotent or protected by reconciliation/operation receipts.

### `src/index.mjs`

Current GitHub Actions entry point.

Keep event orchestration thin. Do not move significant business policy into the entry point when it belongs in `src/core`.

### `.github/workflows/`

Owns triggers, GitHub permissions, concurrency, runtime setup, and invocation.

Rules:

- Preserve least privilege.
- Any new or broader write permission requires explicit justification.
- Do not solve application behavior by giving workflows broad repository permissions.
- Treat changes to `pull_request_target`, token scopes, secrets, checkout behavior, and shell execution as security-sensitive.

### `test/`

All non-trivial behavior changes require deterministic automated tests.

Do not rely only on live GitHub behavior.

### `docs/`

Public behavior, architecture, configuration, events, compatibility, and release-sensitive changes must stay synchronized with implementation.

## 6. GitHub is the source of truth

RepoOps coordinates GitHub; it does not replace GitHub's authoritative issue, pull request, review, branch, or CI state.

When an event is delayed, duplicated, retried, or replayed:

- never assume the original webhook payload still represents current state;
- re-read authoritative GitHub state before consequential mutations when freshness matters;
- do not fight legitimate manual maintainer changes;
- reconcile derived RepoOps state to GitHub unless explicit policy says otherwise.

## 7. Reliability invariants

RepoOps must behave safely under duplicate events, retries, partial failures, delayed processing, and partial outages.

For event-driven or GitHub App work, distinguish these concerns:

1. **Delivery deduplication** — the same GitHub webhook delivery must not become independent work twice.
2. **Operation idempotency** — replaying a logical operation must not repeat completed mutations.
3. **Current-state reconciliation** — delayed/retried work must be checked against current GitHub state.
4. **Retry policy** — only retry failures that are safe to retry.
5. **Ambiguous outcomes** — if a write may have succeeded but the response was lost, inspect GitHub before replaying the mutation.

When uncertain, prefer delay and reconciliation over speculative mutation.

## 8. Mutation design rules

Before adding or changing a GitHub mutation, answer all of these:

- What is the desired state?
- What is the authoritative current state?
- What preconditions must still be true?
- Can the same request be delivered twice?
- What if GitHub applies the mutation but the response is lost?
- What if another actor changes the resource between read and write?
- What if only half the multi-step operation completes?
- How is completion verified?
- What user-visible acknowledgement is safe to emit, and when?

Prefer this pattern:

```text
intent
  -> read current state
  -> validate policy/preconditions
  -> compute minimal mutation plan
  -> record/check operation receipt
  -> apply one safe step
  -> verify authoritative state
  -> checkpoint
  -> continue
  -> acknowledge only after confirmed state
```

Do not post a success comment before the state change it describes has been confirmed.

## 9. Retry and outage behavior

Do not add unbounded retry loops or long sleeps inside webhook/request handlers.

Expected behavior:

- rate limits and transient outages create delayed work, not duplicate GitHub changes;
- `Retry-After` and rate-limit reset signals should be honored when available;
- transient network/5xx failures may be retried with bounded backoff;
- authentication, permission, malformed-input, and policy errors should fail closed;
- ambiguous mutation outcomes require reconciliation before replay;
- permanent failures should surface to operators without spamming contributors.

The future GitHub App must separate webhook receipt from mutation processing through a durable inbox/queue boundary.

## 10. Untrusted input boundary

Treat all contributor-controlled GitHub data as untrusted, including:

- issue titles/bodies/comments;
- pull request titles/bodies/comments;
- branch names;
- usernames/display names;
- labels not created/validated by RepoOps policy;
- configuration content until validated;
- webhook payload strings;
- external API error bodies.

Never:

- interpolate untrusted text into shell commands;
- dynamically execute contributor input;
- build code paths from unvalidated user-controlled strings;
- write secrets or authorization material into comments/logs/errors;
- treat natural-language contributor text as authorization.

Slash commands and machine-readable state must be explicitly parsed and authorized.

## 11. Human control and destructive operations

RepoOps defaults to non-destructive behavior.

Closing, deleting, auto-unassigning, merging, automatic release, permission expansion, or other consequential actions require:

- explicit product/policy approval;
- clear configuration semantics where applicable;
- authorization checks;
- deterministic tests;
- idempotency/recovery behavior;
- documentation;
- maintainer review.

Do not introduce a destructive default merely because it makes automation easier.

AI-generated changes must never bypass this human-control boundary.

## 12. Configuration rules

`.repoops.yml` is a public interface.

When changing configuration:

- use safe defaults;
- reject unknown or unsafe values rather than guessing;
- preserve strict validation;
- document new keys and behavior;
- add tests for valid and invalid values;
- provide migration guidance for renamed/removed keys;
- do not silently enable more destructive behavior because a key is absent.

## 13. Permissions and authentication

For workflow or GitHub App changes:

- request the narrowest permission that supports the behavior;
- justify every added write permission;
- separate read-only collection from mutation capability where practical;
- never persist installation tokens in source or logs;
- do not broaden permissions to work around a design problem;
- account for app uninstall/suspension and revoked repository access.

## 14. Testing requirements

Before considering a change complete, add/update tests for the behavior that changed.

For deterministic policy logic, cover happy path and invalid/ambiguous inputs.

For event-driven or mutation behavior, consider the applicable cases:

- first delivery;
- duplicate delivery;
- delayed delivery;
- retry after success;
- retry after partial success;
- lost mutation response;
- stale preconditions/current-state drift;
- concurrent or conflicting actor change;
- rate limit;
- transient GitHub failure;
- permanent permission/auth failure;
- malformed API response;
- pagination where relevant;
- idempotent user-visible messaging.

Do not add tests merely for line coverage; test operational guarantees.

## 15. Validation before push or PR

Every contributor or AI-agent operator must review the actual diff and run the repository validation command before pushing a completed change:

```bash
npm run check
```

Also verify, as applicable:

- no unrelated files changed;
- no secrets/tokens/credentials entered the diff;
- generated code is understandable and maintainable;
- tests actually exercise the intended failure/replay cases;
- workflow permissions did not broaden unexpectedly;
- public behavior matches docs;
- `.repoops.yml` compatibility is preserved or migration is documented;
- user-visible comments/messages describe confirmed state;
- no dependency was added without a clear need;
- the change still satisfies the linked issue and non-goals.

If you cannot run a required validation, state that explicitly in the PR; do not imply it passed.

## 16. AI-specific verification checklist

Before an AI-assisted change is submitted, the human/operator should specifically inspect for common agent failure modes:

- fabricated APIs, methods, files, configuration keys, or GitHub behavior;
- changes based on stale assumptions rather than current repository code;
- duplicate abstractions that bypass existing helpers;
- broad refactors not required by the issue;
- swallowed errors or optimistic success paths;
- retries that can duplicate writes;
- missing pagination;
- missing authorization checks;
- accidental permission expansion;
- unsafe parsing/interpolation of untrusted text;
- tests that mock away the behavior they claim to validate;
- documentation that overstates what is implemented;
- comments claiming tests passed when they were not run.

AI output is a draft until verified against the repository and tests.

## 17. Dependencies

RepoOps currently prefers a small dependency surface.

Before adding a dependency:

- confirm the platform/runtime cannot reasonably provide the needed capability;
- explain why the dependency is preferable to a small local implementation;
- review maintenance/security implications;
- avoid adding frameworks for a narrow helper;
- update installation/release documentation when needed.

## 18. Documentation and release-sensitive changes

Update documentation when changing:

- public commands;
- `.repoops.yml`;
- permissions;
- event contracts;
- installation behavior;
- reliability guarantees;
- contributor workflow;
- architecture boundaries.

Update `CHANGELOG.md` when the change is user-visible according to `docs/releases.md`.

When a material architecture/security/contribution rule changes, check whether this `AGENTS.md` also requires an update.

## 19. Completion standard

A task is not complete because code was generated.

It is complete only when:

- the requested scope is implemented;
- architecture boundaries are preserved;
- safety and authorization invariants hold;
- failure/retry behavior is defined;
- tests cover the meaningful behavior;
- `npm run check` passes (or inability to run it is explicitly disclosed);
- public documentation is synchronized when required;
- the final diff contains no unrelated or unexplained changes.

When in doubt, choose the smaller, safer, easier-to-audit change.


## gODtECH Cockpit State Synchronization

This repository participates in the gODtECH Cockpit project graph.

After meaningful work, reconcile `.godtech/project.yml` with evidence. Update state, priority, current focus, next step, blockers, status note and last worked date only when warranted. Never fabricate progress. Preserve RepoOps-specific governance and security rules.
