# Project context

## Current state

- This is a public community-fork candidate based on `2hop-links-plus` 0.37.0.
- The Git history is rooted in the upstream `0.37.0` tag; local improvements are
  maintained on `main`.
- Version `0.38.0` is released. Version `0.39.0` adds toolbar sort controls.
- The repository is intended for source development, review, and reproducible releases.

## Confirmed behavior

The maintainer has confirmed that switching ordinary or pinned note tabs updates
the 2-hop view and that Hover Preview / Hover Editor popups do not change its
active-note target.

## Remaining manual coverage

Before publishing `0.39.0`, rerun the manual Obsidian checklist. In particular,
verify same-basename disambiguation, body-search ON/OFF cache behavior, all
line-jump variants, and missing-frontmatter handling. Follow
`docs/reviews/04_MANUAL_TEST_NOTES.md` and
`test-vault/README_TEST_VAULT.md`.

## Deployment and rollback

- Do not store personal Vault content or paths in this repository.
- Back up the installed plugin directory before replacing release files.
- Deploy only `main.js`, `manifest.json`, and `styles.css` unless a release says otherwise.
- Restore the backed-up three files and reload Obsidian to roll back.

See `AGENTS.md` for operating rules, `docs/MAINTENANCE.md` for build and deploy
steps, and `docs/IMPLEMENTATION_HISTORY.md` for the feature history.
