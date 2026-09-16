# RepoOps website

The public RepoOps landing page lives in `site/` and is deployed through GitHub Pages.

## Goals

The first site version is intentionally static and low-maintenance. GitHub remains the source of truth for issues, pull requests, contributor activity, and contribution proposals.

The site provides:

- product positioning and architecture overview
- live Good First Issue cards
- public contributor activity cards
- direct paths to ready work, problem reports, and upgrade proposals
- links to contributor, security, roadmap, and architecture documentation

## Local preview

The site uses browser ES modules, so preview it through a local HTTP server rather than opening `index.html` with a `file://` URL.

For example, if Python is installed:

```bash
python -m http.server 4173 --directory site
```

Then open `http://localhost:4173`.

No install or build step is required for the site itself.

## Live data

The browser makes at most two public GitHub API requests on page load:

1. a search for open, unassigned issues carrying both `good first issue` and `status: ready`
2. the public repository contributors endpoint

There is no polling loop.

The client applies an additional defensive filter before rendering starter work. Closed, assigned, blocked, in-progress, and pull-request results are rejected even if the upstream query unexpectedly contains them.

If public GitHub API access is rate-limited or unavailable, the site falls back to normal GitHub links so contributors can still browse work.

## Security model

The Pages site is public and read-only.

Do not add any of the following to browser code or committed site assets:

- personal access tokens
- GitHub App private keys
- OAuth client secrets
- repository secrets
- credentials for another service

All repository mutations continue on GitHub. The site never assigns issues, posts comments, opens pull requests, approves work, or merges changes.

GitHub-sourced issue titles, usernames, and labels are inserted into the DOM with `textContent`/element properties instead of being treated as trusted HTML.

## GitHub Pages deployment

`.github/workflows/pages.yml` publishes `site/` after relevant changes reach `main`, and it can also be dispatched manually.

The workflow uses GitHub's Pages artifact/deployment actions and grants deployment permissions only to the deploy job.

For a new repository, an owner may need to enable GitHub Actions as the Pages publishing source once:

1. Open **Settings** → **Pages**.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Run **Deploy RepoOps Pages** or merge a change under `site/`.
4. Verify the `github-pages` environment reports a successful deployment URL.

The expected project-site URL is normally:

```text
https://godtech-ctl-create.github.io/RepoOps/
```

Do not add that URL to the README until the deployment actually exists.

## Validation

Site data selection is covered by Node tests in `test/site-data.test.mjs`.

Run the normal repository check before merging:

```bash
npm run check
```
