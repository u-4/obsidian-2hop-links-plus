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

## Review and testing

- The implementation went through multiple external review and hardening rounds.
- Selected reports are stored in `docs/reviews/`.
- Manual acceptance material is stored in `test-vault/`.
- The final pinned-tab and hover behavior was confirmed in a maintainer Vault.

## Repository migration

- On 2026-07-11 the maintained source was moved into this standalone repository.
- Before publication, the local snapshot baseline was replaced by the matching
  upstream `0.37.0` history without changing its file contents.
