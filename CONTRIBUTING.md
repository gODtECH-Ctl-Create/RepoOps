# Contributing to RepoOps

Thanks for helping build RepoOps. Contributors may be humans working directly, humans using AI coding assistants, or AI coding agents operating under human supervision. The same engineering, security, testing, review, and scope requirements apply in every case.

RepoOps automates repository operations, so small changes can affect assignments, labels, pull requests, permissions, contributor workflows, retries, and future GitHub App installations. Contributions must therefore be focused, testable, auditable, and safe under failure.

AI-assisted contributors and coding agents must also read the repository-wide [`AGENTS.md`](AGENTS.md). It defines the machine-readable architecture, safety, reliability, validation, and AI-specific contribution contract. Human contributors remain responsible for reviewing and validating AI-generated changes before they are pushed, submitted, or merged.

## Before you start

1. Check existing issues and pull requests to avoid duplicate work.
2. Prefer an existing issue for non-trivial changes.
3. Comment `/claim` on an available issue before starting work.
4. Keep one issue per pull request unless a maintainer explicitly approves broader scope.
5. Read the complete issue, including dependencies, acceptance criteria, and non-goals.
6. Read the existing implementation, relevant tests, and applicable documentation before editing code.
7. If you are using an AI agent, provide it the issue context and ensure it reads `AGENTS.md` rather than asking it to implement from the issue title alone.

Do not start substantial work on blocked or already-claimed issues unless a maintainer coordinates it.

## Development setup

Requirements:
- Node.js 20 or newer
- Git

Clone the repository and run:

```bash
npm install
npm run check
```

The hosted PostgreSQL adapter uses the pinned `pg` dependency. See `docs/development.md` for disposable-database integration tests.

## Branch naming

Use a short branch tied to the work:

```text
feat/123-unclaim-command
fix/145-claim-race
docs/88-architecture-guide
```

Recommended prefixes: `feat/`, `fix/`, `docs/`, `test/`, `refactor/`, `chore/`.

## Human, AI-assisted, and agent contributions

RepoOps accepts AI-assisted development, but AI output is not self-validating.

A coding agent may research the repository, propose an implementation, write tests, update documentation, and prepare a pull request. The human/operator is still responsible for confirming that the final change:

- solves the claimed issue and does not silently broaden scope;
- uses real repository APIs, files, configuration keys, and GitHub behavior rather than invented assumptions;
- preserves architecture boundaries;
- does not expose secrets or credentials;
- does not weaken authorization, least privilege, idempotency, or human-control safeguards;
- has meaningful tests for the behavior changed;
- has actually passed the required validation commands;
- does not include unrelated generated cleanup or refactors;
- is understandable enough for maintainers to review and support.

AI agents must not independently decide to broaden GitHub permissions, enable destructive automation, change release policy, approve a production deployment, or claim that a change is safe or complete without evidence.

If an AI tool cannot inspect the current repository, run the required tests, or verify a GitHub behavior, that limitation must be disclosed rather than guessed around.

## Making changes

- Put command and policy decision logic in `src/core` when possible.
- Keep GitHub API reads and mutations isolated in `src/github`.
- Keep workflow files thin; business logic belongs in source modules.
- Do not execute user-controlled issue, pull-request, branch, configuration, or comment text as shell code.
- Treat contributor-controlled GitHub content as untrusted input.
- Preserve least-privilege workflow and future GitHub App permissions.
- Add or update tests for behavior changes.
- Keep automation idempotent: replaying an event must not produce harmful duplicate actions.
- Re-read authoritative GitHub state before consequential mutations when delayed/retried events can become stale.
- If a mutation may have succeeded but its response was lost, inspect current GitHub state before retrying it.
- Prefer non-destructive behavior when state is ambiguous.
- Do not post a user-visible success acknowledgement before the state change it describes is confirmed.

## GitHub App and reliability changes

Work involving webhooks, queues, retries, rate limits, authentication, installation tokens, or the future GitHub App must account for duplicate delivery and partial failure explicitly.

Relevant changes should define and test, where applicable:

- duplicate/redelivered webhook handling;
- operation idempotency;
- current-state reconciliation;
- partial multi-step success;
- lost mutation responses;
- delayed or out-of-order processing;
- transient GitHub/API outages;
- primary or secondary rate limiting;
- permanent permission/authentication failures;
- app uninstall, suspension, or repository-access removal;
- duplicate-safe user-visible comments or acknowledgements.

The preferred failure mode is delayed work and reconciliation, not speculative repository mutation.

## Testing

Before opening a pull request, run:

```bash
npm run check
```

For event-driven changes, include deterministic fixtures or unit tests. Do not rely only on live GitHub testing.

Tests should validate operational guarantees, not merely execute lines. For mutation/retry code, include the relevant failure and replay cases rather than only a happy path.

If you or your AI agent cannot run `npm run check`, say so explicitly in the pull request and explain which validation remains outstanding. Do not write or imply that checks passed when they were not run.

## Required validation before push or pull request

Before considering a change ready, the human contributor or AI-agent operator must review the actual diff and verify all applicable items below:

- `npm run check` passes;
- no unrelated files or generated edits are included;
- no secrets, tokens, private keys, credentials, or authorization material appear in the diff or logs;
- new tests genuinely exercise the behavior and important failure/replay cases;
- no GitHub permission was broadened accidentally;
- public behavior matches documentation;
- `.repoops.yml` compatibility is preserved or migration guidance exists;
- user-facing messages describe confirmed repository state;
- GitHub API pagination is handled where required;
- retry logic is bounded and cannot blindly duplicate writes;
- no new dependency was added without a clear need;
- generated code is readable, maintainable, and consistent with surrounding patterns;
- the implementation still matches the issue acceptance criteria and non-goals.

For AI-generated changes, additionally check for common agent mistakes such as fabricated APIs, stale assumptions, duplicated helpers, swallowed errors, optimistic success paths, missing authorization checks, tests that mock away the important behavior, and documentation that claims functionality not actually implemented.

## Pull requests

A good pull request should include:

- the problem being solved;
- the linked issue;
- a concise description of the behavior change;
- test/validation evidence;
- any permission, workflow, authentication, reliability, or security impact;
- any remaining limitation or validation that could not be completed.

Keep pull requests small enough to review safely.

Whether code was written manually or with AI assistance does not change the review standard. Maintainers review the resulting behavior and evidence, not the method used to type the code.

## Security-sensitive areas

Changes involving these areas require extra review:

- `.github/workflows/`;
- GitHub token or GitHub App permissions;
- authentication, installation tokens, or webhook verification;
- command authorization;
- code that mutates repository state;
- retry/reconciliation logic around mutations;
- secrets or credential handling;
- release automation.

Do not weaken security controls merely to make a workflow pass.

AI agents must not bypass these review requirements, even when their generated change appears mechanically correct.

## Destructive and consequential automation

Closing, deleting, unassigning, merging, automatic release, broad permission expansion, or similar consequential actions require explicit policy and maintainer review.

Such changes must include appropriate authorization checks, configuration semantics where applicable, deterministic tests, retry/recovery behavior, and documentation.

RepoOps should not adopt a destructive default simply because it simplifies automation.

## Documentation and public interfaces

Slash commands and `.repoops.yml` are public interfaces. Workflow permissions, event contracts, installation behavior, and documented reliability guarantees are also release-sensitive behavior.

When a change affects public behavior:

- update the relevant documentation;
- update configuration examples and validation tests when necessary;
- update `CHANGELOG.md` when required by `docs/releases.md`;
- consider whether `AGENTS.md` also needs to change when repository-wide architecture, security, validation, or contributor rules have changed.

## Contributor ownership

Claiming an issue does not permanently reserve it. RepoOps sends configured stale-work reminders when no linked implementation PR demonstrates activity; it does not automatically release the assignment today. Share progress or use `/unclaim` if you are no longer working on an issue. `/keep` is planned in #7.

Using an AI agent does not allow one contributor to claim excessive parallel work or bypass contributor limits. The human/operator remains the accountable issue owner.

## Review expectations

Maintainers may ask for changes when a contribution:

- duplicates existing work;
- expands beyond the agreed issue scope;
- adds unnecessary dependencies;
- changes repository permissions without justification;
- lacks tests for operational behavior;
- introduces destructive automation without safeguards;
- relies on unverified AI-generated assumptions;
- hides incomplete validation;
- produces noisy or duplicate GitHub mutations under retry;
- updates documentation to claim behavior that is not implemented.

Constructive review is part of the contribution process for humans and AI-assisted contributors alike.
