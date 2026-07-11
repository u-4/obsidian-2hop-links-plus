# Project context

## Current state

- This is a public community fork based on `2hop-links-plus` 0.37.0.
- The Git history is rooted in the upstream `0.37.0` tag; local improvements are
  maintained on `main`.
- Version `0.40.0` is the current release candidate. It retains the existing
  ranking and toolbar behavior while adding startup coordination, graph/result
  reuse, cooperative cancellation, performance diagnostics, and automated
  synthetic-Vault tests.
- The repository is intended for source development, review, and reproducible releases.

## Confirmed behavior

The maintainer has confirmed that switching ordinary or pinned note tabs updates
the 2-hop view and that Hover Preview / Hover Editor popups do not change its
active-note target.

## Version 0.39.1 acceptance record

- On 2026-07-11, the maintainer reported no problems in the test-Vault manual
  checks and approved proceeding with the release.
- The maintainer specifically confirmed that the settings default sort and the
  temporary per-view sort remain independent.
- Assisted UI checks covered body search, frontmatter links, valid and invalid
  Canvas data, Canvas backlinks, and the toolbar controls.
- Local build, lint, dependency audit, and pull-request Validate/CodeQL checks
  completed successfully. See `docs/reviews/04_MANUAL_TEST_NOTES.md` for the
  detailed record and residual platform-specific risks.

## Version 0.40.0 acceptance record

- On 2026-07-12, the maintainer reported no problems in the dedicated test-Vault
  manual checks and approved proceeding with the release.
- The performance release keeps ranking behavior while reducing repeated work
  during startup and rapid tab switching.
- Automated checks cover startup-delay gating, event coalescing, A → B → A
  result reuse, graph reuse and invalidation, Canvas scan avoidance when hidden,
  and cancellation of a superseded gather.

## Deployment and rollback

- Do not store personal Vault content or paths in this repository.
- Back up the installed plugin directory before replacing release files.
- Deploy only `main.js`, `manifest.json`, and `styles.css` unless a release says otherwise.
- Restore the backed-up three files and reload Obsidian to roll back.

See `AGENTS.md` for operating rules, `docs/MAINTENANCE.md` for build and deploy
steps, and `docs/IMPLEMENTATION_HISTORY.md` for the feature history.
