# Release Policy

RepoOps uses semantic versioning once public releases begin.

## Versioning

- PATCH — bug fixes, documentation fixes, internal refactors that do not change supported behavior
- MINOR — backward-compatible commands, configuration keys, automation capabilities, GitHub integrations or developer tooling
- MAJOR — breaking command behavior, incompatible configuration changes, removed supported behavior, or migration-requiring architectural changes

During the `0.x` phase the project is still stabilizing. Breaking changes may occur between minor versions, but they must be documented and should include a migration note when they affect users.

## Release requirements

A release should not be cut unless:

- CI passes on `MASTER`
- relevant tests cover the changed behavior
- public behavior is documented
- configuration changes are documented
- workflow permission changes are reviewed explicitly
- security-sensitive changes receive maintainer review
- breaking behavior includes migration guidance
- the changelog is updated

## Changelog

`CHANGELOG.md` records user-visible changes under these categories when applicable:

- Added
- Changed
- Fixed
- Security
- Deprecated
- Removed

Routine documentation wording and internal-only maintenance do not require changelog entries unless they materially affect users or contributors.

## Configuration compatibility

`.repoops.yml` is a public interface.

Rules:

- new optional keys should have safe defaults
- unknown keys should remain validation errors so misspellings do not silently change policy
- removing or renaming a key requires migration guidance
- unsafe behavior should never be enabled merely because a configuration field is absent

## Command compatibility

Slash commands are also public interfaces.

Changes to command semantics must consider existing repository automation and contributor expectations. Prefer adding a new explicit command or configuration option over silently changing a command's meaning.

## GitHub permissions

Workflow and GitHub App permissions are release-sensitive behavior.

Any PR that adds or broadens write permissions must explain:

- why the permission is required
- which code path uses it
- what repository state it can mutate
- why a narrower permission is insufficient

## Release ownership

Only maintainers should create official RepoOps releases and version tags.

Contributors may propose changelog and release-note changes through pull requests.
