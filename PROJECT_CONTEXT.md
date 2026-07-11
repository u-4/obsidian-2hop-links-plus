# Project context

## Current state

- This is a public community fork based on `2hop-links-plus` 0.37.0.
- The Git history is rooted in the upstream `0.37.0` tag; local improvements are
  maintained on `main`.
- Version `0.39.1` is the current release. It retains the `0.39.0` toolbar sort
  controls and adds type-safety, public-API, and development-tool maintenance.
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

## Deployment and rollback

- Do not store personal Vault content or paths in this repository.
- Back up the installed plugin directory before replacing release files.
- Deploy only `main.js`, `manifest.json`, and `styles.css` unless a release says otherwise.
- Restore the backed-up three files and reload Obsidian to roll back.

See `AGENTS.md` for operating rules, `docs/MAINTENANCE.md` for build and deploy
steps, and `docs/IMPLEMENTATION_HISTORY.md` for the feature history.
