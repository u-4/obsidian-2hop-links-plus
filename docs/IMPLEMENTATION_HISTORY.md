# Local implementation history

## Baseline

- Upstream source: `L7Cy/obsidian-2hop-links-plus` tag `0.37.0`, released on 2023-10-16.
- The local improvement history is based directly on that upstream tag.

## Local improvements

- Added WebP image preview support.
- Added `Related score`, `Related, Cosense-like`, `Page rank`, and `Most linked` sort modes.
- Added metadata-cache-based relatedness and PageRank-like scoring.
- Added card filtering by title, path, aliases, tags, outgoing links, intermediate links, and candidate body text.
- Added bounded body-text caching and stale-entry invalidation.
- Added jumps to the relevant link line for 2-hop and Back Links cards.
- Added basename-only link labels by default, with a full-path setting.
- Corrected relative embedded-image resolution in card previews.
- Prevented hover previews and Hover Editor popups from changing the active 2-hop target.
- Corrected switching between ordinary and pinned main-note tabs.
- Stabilized section keys and cleared stale async previews while reloading.
- Replaced the large settings text button with a compact gear icon and added a
  temporary sort-order dropdown beside the card search box. The settings tab
  separately controls the default sort order used when a view is opened.

## 0.39.1 maintenance

- Removed all 114 legacy ESLint warnings by adding explicit types and isolating
  compatibility with Obsidian runtime APIs.
- Added runtime validation for saved sort values and Canvas file nodes.
- Updated the Obsidian development API, esbuild, and ESLint toolchain.
- Removed duplicate and unused development dependencies; `npm audit` now
  reports zero known vulnerabilities.

## 0.40.0 performance and startup coordination

- Waits for the Obsidian workspace layout and a 1.5-second startup grace period
  before the first 2-hop calculation. Later tab or metadata events cannot pull
  that first calculation forward.
- Coalesces rapid `active-leaf-change` and `file-open` events, with a configurable
  tab-switch delay that defaults to 200 ms.
- Reuses the graph index and recent per-note results, and builds active-note link
  order only when needed. `Related, Cosense-like` skips unused PageRank work.
- Cancels superseded gather work cooperatively and shares in-flight graph and
  Canvas-index construction instead of starting duplicates.
- Waits for Obsidian's `resolved` metadata event before rebuilding graph-backed
  results after Markdown changes.
- Caches the Canvas reverse-link index and avoids scanning Canvas files when
  Canvas backlinks are hidden and the active file is Markdown.
- Adds deterministic synthetic-Vault tests, a 3,000-note benchmark, and command
  palette diagnostics for cache builds, hits, and cancellations.

## 0.41.0 interface navigation

- Expands the card-search field into available toolbar space up to approximately
  five default card widths, while keeping settings and temporary sorting aligned
  to the right.
- Adds a double-chevron action to inline Markdown views for moving between the
  note top and the 2-hop links area in Live Preview and Reading view.
- Cancels long-note alignment retries when wheel, touch, pointer, or keyboard
  input shows that the user has taken over scrolling.
- Refreshes temporary sort changes inside an open separate pane instead of
  destroying and recreating the pane, preserving its search state and
  preventing a blank-view race.
- Preserves a manually loaded card view across temporary sorting when automatic
  loading is disabled, while still resetting it on a different note.
- Styles the scroll action as a circular, raised elevator-style control with
  hover and pressed feedback.

## 0.41.1 Markdown host readiness

- Defers inline injection when the active Markdown view or its Live Preview /
  Reading view host has not been attached yet, instead of recording an empty
  render as complete.
- Uses a bounded animation-frame retry owned by the active leaf's window, and
  cancels stale retries when the active leaf leaves Markdown, the file changes,
  inline display is disabled, separate-pane mode is enabled, or the plugin
  unloads. Readiness follows the current Markdown source/preview mode so an old
  hidden host cannot complete the retry.
- Keeps injection and removal on the all-mode host selector used by 0.41.0, so
  both visible and hidden source/preview hosts receive the current result and
  are cleared together during mode changes or unload.
- Keeps normal Obsidian navigation events single-shot; no PalmWiki-specific
  imports, DOM classes, settings, or runtime dependency were added.
- Adds deterministic tests for host appearance, superseding navigation,
  cancellation, and retry exhaustion.

## 0.41.1 scroll-to-top reliability

- Keeps the upper-right action's smooth return animation, then checks the same
  Markdown pane at finite delays and applies an immediate final correction only
  when the note remains more than eight pixels from the top.
- Scopes correction to the same file and mode, and reuses the existing
  wheel/touch/pointer/keyboard cancellation so manual scrolling always wins.
- Adds direct fake-scroll-host tests for an interrupted smooth return and user
  cancellation.

## Review and testing

- The implementation went through multiple external review and hardening rounds.
- Selected reports are stored in `docs/reviews/`.
- Manual acceptance material is stored in `test-vault/`.
- The final pinned-tab and hover behavior was confirmed in a maintainer Vault.

## Repository migration

- On 2026-07-11 the maintained source was moved into this standalone repository.
- Before publication, the local snapshot baseline was replaced by the matching
  upstream `0.37.0` history without changing its file contents.
