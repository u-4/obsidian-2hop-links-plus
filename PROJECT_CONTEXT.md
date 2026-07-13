# Project context

## Current state

- This is a public community fork based on `2hop-links-plus` 0.37.0.
- The Git history is rooted in the upstream `0.37.0` tag; local improvements are
  maintained on `main`.
- Version `0.41.0` is the current release. It retains the 0.40 performance work
  while adding inline long-note navigation, a responsive toolbar, and stable
  in-place temporary sorting in a separate pane.
- The repository is intended for source development, review, and reproducible releases.

## Unreleased Markdown host readiness fix

- Inline rendering now waits for the active Markdown view's real injection host
  when Obsidian is still replacing a custom `ItemView` with `MarkdownView`.
- The wait is bounded, uses the target element's `ownerDocument.defaultView`,
  and is cancelled when the active leaf or file changes, inline display is
  disabled, separate-pane mode is selected, or the plugin unloads.
- Readiness follows only the currently selected Markdown mode, while injection
  and cleanup still cover both source and preview hosts. This prevents an old
  hidden host from completing the wait and prevents hidden stale content from
  reappearing after a mode switch.
- The plugin does not emit duplicate `file-open` or `active-leaf-change` events.
  This keeps the fix independent of PalmWiki Home and applicable to any custom
  view that opens a Markdown note through Obsidian's public APIs.
- Assisted checks in Obsidian 1.12.7 covered Live Preview, Reading view, Source
  mode, switching to a different note without hidden stale cards, all-mode
  cleanup while separate-pane display was enabled, a five-second mode switch
  after plugin disable, and clean restoration after re-enabling the plugin.
  Split and pop-out checks remain for a later compatibility pass.

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

## Version 0.41.0 acceptance record

- On 2026-07-12, the maintainer requested publication after reporting no
  problems in the dedicated test-Vault checks for this interface update.
- Assisted UI checks in Obsidian 1.12.7 confirmed the upper-right control's
  round trip in both Live Preview and Reading view, cleanup in non-Markdown
  views, and correct behavior across split leaves.
- Settings no longer contain the removed left-side Home control; this plugin
  now owns only the upper-right inline scroll control.
- The behavior candidate was installed from only `main.js`, `manifest.json`,
  and `styles.css`, with matching checksums at deployment; release version
  metadata was finalized afterward.
- A clean lockfile install, production build, eight automated tests, ESLint,
  whitespace validation, dependency audit, and the synthetic benchmark all
  completed successfully before publication.

## Deployment and rollback

- Do not store personal Vault content or paths in this repository.
- Back up the installed plugin directory before replacing release files.
- Deploy only `main.js`, `manifest.json`, and `styles.css` unless a release says otherwise.
- Restore the backed-up three files and reload Obsidian to roll back.

See `AGENTS.md` for operating rules, `docs/MAINTENANCE.md` for build and deploy
steps, and `docs/IMPLEMENTATION_HISTORY.md` for the feature history.
