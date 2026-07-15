# Manual test notes

## Version 0.39.1 acceptance — 2026-07-11

- Test environment: Obsidian 1.12.7 and the dedicated local test Vault.
- Installed candidate: version 0.39.1, using only `main.js`, `manifest.json`,
  and `styles.css`.
- Runtime candidate source: commit `5445ecc`. The subsequent release-record
  edits change documentation only, not plugin source or build configuration.
- Maintainer result: no problems found in the test-Vault manual checks; release
  approval received.
- Explicit maintainer confirmation: the settings default sort and the temporary
  sort in the current 2-hop view remain independent.

Codex-assisted UI checks also confirmed:

- toolbar search, settings button, and temporary sort controls render and work;
- body-only search terms filter the existing candidate set;
- frontmatter-only links participate in 2-hop discovery and search;
- valid Canvas file nodes and Canvas backlinks are handled;
- invalid Canvas `nodes` data produces an empty result without disabling the
  plugin;
- the separate-pane setting was restored after testing.

Automated release checks confirmed:

- clean lockfile installation with no unreviewed install scripts;
- build and strict null checking complete successfully;
- ESLint completes with zero warnings and zero errors;
- dependency audit reports zero known vulnerabilities;
- pull-request Validate and CodeQL checks pass.

## Version 0.40.0 acceptance — 2026-07-12

- Test environment: the dedicated local test Vault.
- Maintainer result: no problems found in the manual checks; release approval
  received.
- Focus: startup/tab-switch load reduction while retaining the existing ranking
  and display behavior.
- Automated coverage verifies the startup grace-period gate, rapid-event
  coalescing, recent-result and graph reuse, invalidation, Canvas scan avoidance
  when hidden, and cancellation of superseded work.
- A deterministic 3,000-note synthetic benchmark verifies that eight tab
  switches build the shared graph once rather than eight times. Wall-clock
  speed varies by machine and is recorded for information only.

## Version 0.41.0 acceptance — 2026-07-12

- Test environment: Obsidian 1.12.7 and the dedicated local test Vault.
- Installed behavior candidate: only `main.js`, `manifest.json`, and
  `styles.css` were used; post-copy checksums matched at deployment, before the
  release version metadata was finalized.
- Maintainer result: no problems found in the manual checks; publication was
  requested after confirming the final ownership boundary.
- Live Preview and Reading view both completed the upper-right control's
  note-top → inline-results → note-top round trip, including the corresponding
  accessible destination-label changes.
- Assisted checks also covered same-leaf cleanup in a non-Markdown view,
  Markdown/non-Markdown split behavior, and return to one control in the final
  active Markdown leaf.
- The removed left-side Home feature is absent from this plugin's settings and
  runtime UI. The upper-right inline navigation control remains here and is not
  shown in the separate pane.

Automated release checks confirmed:

- clean installation from the lockfile and a successful production build;
- all eight automated tests pass, including scroll-navigation state, manual-load
  preservation during temporary sorting, and performance/coordination coverage;
- ESLint and whitespace validation complete with no errors;
- the dependency audit reports zero known vulnerabilities;
- the deterministic 3,000-note benchmark builds the cached graph once across
  eight switches (7.41× in this run; elapsed time remains informational).

## Version 0.41.1 acceptance — 2026-07-13

- Test environment: Obsidian 1.12.7 and the dedicated local test Vault.
- The installed candidate used only `main.js`, `manifest.json`, and
  `styles.css`; source and destination checksums matched after deployment.
- Before the fix, assisted UI testing reproduced an upper-right return that
  remained around `padding line 14` instead of reaching the first heading.
- After the fix, Live Preview, Reading view, and Source mode each completed
  three inline-results → note-top round trips, with the first heading visible
  after every return.
- A manual scroll during a pending return remained in control after the final
  correction window, and the test ended with one action, Live Preview active,
  the plugin enabled, and the note at the top.
- The Markdown-host candidate also passed first-open checks from PalmWiki Home
  cards, tables, recent notes, candidates, and body search, as well as
  Obsidian's File Explorer and Search. It passed mode changes, Back/Forward,
  rapid target switching, all-mode cleanup with separate-pane display, and
  plugin disable/re-enable checks without stale cards or duplicate actions.
- The maintainer approved proceeding to release after the test-Vault checks.

Automated release checks include deterministic readiness, cancellation,
interrupted smooth-scroll, and manual-takeover coverage. Pop-out windows and a
macOS reduced-motion configuration were not separately reproduced for this
patch and remain non-blocking focused follow-up checks.

## Version 0.42.0 acceptance — 2026-07-15

- The maintainer reviewed the completed responsive toolbar, mobile card layout,
  search behavior, temporary-sort indication, and coordinated page-card boundary,
  reported no apparent problems, and requested the GitHub release.
- Layout iterations used the dedicated local test Vault and the maintainer's
  PalmWiki environment on mobile/tablet-sized views. The optional Cosense-style
  CSS is maintained and deployed separately from this plugin release.
- The candidate keeps search, settings, and sorting on one row, exposes 44 px
  narrow-layout controls, uses two card columns, preserves the results region
  during filtering, and keeps light/dark sort menus readable.
- The inline region contract was reviewed across Reading and editor hosts. The
  plugin adds and removes its host marker together with the inline container;
  external CSS remains optional and is not imported by the plugin.
- Automated tests cover search disclosure and clearing, sort menu completeness,
  temporary-sort indication, result-height reservation, stale sort-menu context,
  and same-container inline restoration after closing a separate pane.
- The remaining visual risk is theme- and platform-specific rendering outside
  the combinations reviewed by the maintainer. Rollback remains restoration of
  the previous `main.js`, `manifest.json`, and `styles.css` followed by reload.

## Residual platform-specific risks

Mobile long-press behavior and responsiveness in a substantially larger Vault
were not separately reproduced in this release session. They remain focused
follow-up checks rather than known regressions. The release can be rolled back
by restoring the backed-up `main.js`, `manifest.json`, and `styles.css` and
reloading the plugin.
