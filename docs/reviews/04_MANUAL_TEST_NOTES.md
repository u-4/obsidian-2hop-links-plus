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

## Residual platform-specific risks

Mobile long-press behavior and responsiveness in a substantially larger Vault
were not separately reproduced in this release session. They remain focused
follow-up checks rather than known regressions. The release can be rolled back
by restoring the backed-up `main.js`, `manifest.json`, and `styles.css` and
reloading the plugin.
