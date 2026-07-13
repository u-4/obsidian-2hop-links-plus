# Acceptance tests

## 1. Build and static checks

From the plugin repository root:

```bash
npm ci
npm run build
npm test
npm run eslint
git diff --check
npm audit
npm run benchmark
```

Expected result:

- `npm run build` completes without TypeScript errors.
- `npm test` completes with all synthetic-Vault coordination and cache tests passing.
- Existing settings and UI still render.
- `npm run eslint` completes with zero warnings and zero errors.
- `npm audit` reports zero known vulnerabilities.

## 2. Manual test vault setup

Use the included `test-vault/` folder as an Obsidian vault.

Recommended manual setup:

1. Build the plugin.
2. Copy the generated plugin files into:

```text
test-vault/.obsidian/plugins/2hop-links-plus/
```

Usually this means:

```text
main.js
manifest.json
styles.css
```

3. Open `test-vault/` in Obsidian.
4. Enable community plugins and enable `2Hop Links Plus`.
5. Open `Active.md`.

## 3. Toolbar controls

Open `Active.md` or another note with 2-hop results.

Expected result:

- The toolbar order is search box, compact gear button, then sort-order dropdown.
- With enough width, the gear button and sort dropdown align to the right edge,
  while the search box fills the available space before them.
- The search box stops growing at 727 px, approximately five default card widths.
- The gear button opens the 2Hop Links Plus settings tab.
- The dropdown contains every Default sort order option from the settings tab.
- Changing the toolbar dropdown immediately rebuilds and reorders the cards.
- Changing the toolbar dropdown does not change the Default sort order in settings.
- Opening another note resets the toolbar dropdown to the configured default.
- Restarting Obsidian uses the configured default; the temporary toolbar choice is not saved.
- In a narrow main or separate pane, the toolbar wraps without horizontal
  overflow and all three controls remain usable.
- In a separate pane, changing the temporary sort order keeps that pane open;
  its toolbar, current search query, and cards remain visible while the cards
  reorder in place.
- With `Auto-load 2hop links` disabled, manually show the cards and then change
  the temporary sort order. The cards remain visible while they reorder; opening
  a different note resets the manual-load state as before.

## 4. Sort mode visibility

Open plugin settings.

Expected result:

The setting is labeled `Default sort order`, explains that it is used when a
2-hop view is opened, and includes these entries:

```text
Related score
Related, Cosense-like
Page rank
Most linked
```

Existing entries remain available:

```text
Random
File name (A to Z)
File name (Z to A)
Modified time (new to old)
Modified time (old to new)
Created time (new to old)
Created time (old to new)
```

## 5. Related score sorting

Set the toolbar sort order to `Related score`. Open `Active.md`.

The active file has outgoing links to `RareA`, `RareB`, `RareC`, `CommonHub`, and `DirectTarget`.

Expected qualitative order:

- Cards that share multiple rare links with `Active.md` rank above cards that share only `CommonHub`.
- `MultiSharedCandidate.md` should appear above `HubOnlyCandidate.md`.
- Candidates sharing only `CommonHub` should not dominate merely because `CommonHub` has many backlinks.

Exact order can vary with implementation details, but the following should hold:

```text
rank(MultiSharedCandidate) > rank(HubOnlyCandidate)
rank(PageRankHigh) >= rank(PageRankLow) when related scores are otherwise similar
```

## 6. Related, Cosense-like sorting

Set the toolbar sort order to `Related, Cosense-like`. Open `Active.md`.

Expected result:

- 2-hop sections follow the outgoing link order in `Active.md`:

```text
RareA
RareB
RareC
CommonHub
DirectTarget
```

- If a candidate shares several intermediates, it is assigned to the first matching intermediate in that active-page order.

## 7. Page rank sorting

Set the toolbar sort order to `Page rank`. Open `Active.md`.

Expected result:

- `PageRankHigh.md` should rank above `PageRankLow.md` within comparable 2-hop sections because multiple `PR_Backlink_*.md` files link to `PageRankHigh.md`.
- The plugin should not use Google-style iterative PageRank unless it is explicitly combined with or documented as separate from the Cosense-like PageRank approximation.

## 8. Most linked sorting

Set the toolbar sort order to `Most linked`. Open `Active.md`.

Expected result:

- Cards with more inbound links in the test vault rank above otherwise similar cards.
- This mode is simpler than `Page rank`: it should mainly track unique backlink count/in-degree.

## 9. Card search/filter

Open `Active.md` and use the search box above the cards.

Test queries:

```text
BODY_ONLY_NEEDLE_ALPHA
LONG_BODY_TOKEN_BETA
review-body-search
PageRankHigh
cosense-test-card
```

Expected result:

- `BODY_ONLY_NEEDLE_ALPHA` shows `BodyOnlyCandidate.md` but not `NonCandidateBodyHit.md`.
- `LONG_BODY_TOKEN_BETA` shows `BodyLongCandidate.md`.
- `review-body-search` matches `AliasTagCandidate.md` through its frontmatter tag.
- `PageRankHigh` shows `PageRankHigh.md`.
- `cosense-test-card` matches `FrontmatterLinkCandidate.md` through its frontmatter tag.
- Empty query restores the full list.
- Changing the query resets displayed box/section counts so newly filtered results are visible.

## 10. Jump to link line: 2-hop cards

Open `Active.md`. In a 2-hop section, click a card.

Specific examples:

- In the `RareA` section, click `MultiSharedCandidate.md`.
- Expected: Obsidian opens `MultiSharedCandidate.md` and moves to the line containing `[[RareA]]`.

- In the `RareC` section, click `JumpCandidate.md`.
- Expected: Obsidian opens `JumpCandidate.md` and moves to the line containing `[[RareC]]`.

If the line does not visibly scroll but the file opens correctly, inspect whether `eState: { line }` is being honored. If not, implement or fix the post-open `MarkdownView.editor.setCursor()` + `scrollIntoView()` fallback.

## 11. Jump to link line: Back Links cards

Open `Active.md`. In the Back Links section, click `BacklinkToActive.md`.

Expected result:

- Obsidian opens `BacklinkToActive.md`.
- The cursor/scroll position moves to the line containing `[[Active]]`.

## 12. Context menu and middle click

For a 2-hop card such as `MultiSharedCandidate.md`:

- normal click;
- middle click;
- context menu > Open link;
- context menu > Open in new tab;
- context menu > Open to the right;
- context menu > Open in new window.

Expected result:

- All open the intended page.
- All preserve jump-to-line behavior where Obsidian permits it.
- No null dereference occurs when the target file does not exist.

## 13. Frontmatter and Canvas compatibility

Frontmatter checks:

These checks require Obsidian 1.4.0 or newer. On the declared minimum version,
Obsidian 1.3.5, frontmatter-only link discovery is not expected.

- Open `Active.md` and confirm `FrontmatterLinkCandidate.md` appears in the
  `RareA` 2-hop section even though its `[[RareA]]` link is in frontmatter.
- Search for `cosense-test-card` and confirm that card remains visible.
- Click the card and confirm the target note opens. Obsidian's public
  frontmatter-link metadata has no line position, so no specific line jump is
  expected for a link that exists only in frontmatter.

Canvas checks require `Show 2hop links in separate pane`:

- Open `CanvasActive.canvas`; `RareA.md`, `RareB.md`, and `DirectTarget.md`
  are treated as outgoing links and related cards render without an exception.
- Open `Active.md`; `CanvasBacklink.canvas` appears in Back Links.
- Open `InvalidCanvasNodes.canvas`; the plugin remains enabled and shows no
  Canvas-derived results rather than throwing an exception. This fixture covers
  a non-array `nodes` value; individual malformed nodes are skipped defensively
  but are not separately covered by the fixture.

When these fixtures are copied into a subfolder of an existing vault, update
each Canvas node's `file` value to the vault-relative path (for example,
`2hop-links-plus-test/RareA.md`). The bundled short paths are correct when
`test-vault/` itself is opened as the vault root.

## 14. Regression checks

- Forward Links still open normally.
- New Links still ask whether to create a file.
- Tags Links and Properties Links still render and sort using existing modes.
- Duplicate removal still suppresses duplicate cards when enabled.
- Separate pane mode still renders the same card list.
- Mobile/touch long-press context menu still works as before.

## 15. Large vault sanity check

On a larger real vault:

- During startup, the first calculation begins only after layout restoration and
  the startup grace period. Later short-delay events must not pull it forward.
- Rapidly switch A → B → C. Only C should render after the configured delay.
- Return to A. The recent result should be reused if metadata and settings have
  not changed.
- Opening a note should not freeze Obsidian for several seconds.
- Typing in the search box should feel immediate because it filters precomputed card arrays rather than rebuilding the graph.
- After editing a Markdown file, graph-backed results refresh after Obsidian's
  link resolution completes.
- Run `Reset performance statistics`, switch several tabs, then run
  `Show performance statistics`. In a stable metadata revision, graph builds
  should remain near one while graph/result hits increase. Cancellation counts
  may increase during rapid switching and are not errors.
- With `Show Back Links` disabled on a Markdown note, Canvas files are not read
  merely to build hidden backlinks.

## 16. Note scroll navigation

Use the bundled `LongScrollActive.md` fixture with
`Show 2hop links in separate pane` disabled.

Expected result:

- One vertical double-chevron action appears at the upper-right of the Markdown
  note view. Its accessible label is `Scroll to 2-hop links` near the note top.
- From the note top or middle, activating the action scrolls the same note pane
  to the beginning of its 2-hop links area.
- In the 2-hop links area, the label changes to `Scroll to note top`; activating
  it returns the same note pane to the top. After at most 1.5 seconds, the first
  note heading is visible and the scroll must not remain at an intermediate
  position.
- The round trip works repeatedly in Live Preview, Reading view, and Source
  mode, and changing view mode does not duplicate the action.
- If wheel, touch, pointer, or keyboard input takes over during the return, the
  plugin cancels its pending correction and does not fight the manual scroll.
- Searching or changing the temporary sort order does not remove or duplicate
  the action.
- With separate-pane display enabled, the action is absent from both the main
  note and the separate 2-hop pane.

## 17. Scroll-control ownership and cleanup

Use a Markdown note with the Obsidian view header visible.

Expected result:

- The scroll action is a clearly visible circular button with a raised surface,
  accent-colored outline, and pressed feedback reminiscent of an elevator
  button.
- 2Hop Links Plus adds no upper-left Home control and exposes no Home-button
  settings.
- Switching a Markdown leaf to the bundled `CanvasActive.canvas` fixture or
  another non-Markdown view removes the disconnected upper-right action from
  that leaf.
- In a Markdown/Canvas split, the Markdown side keeps one upper-right action
  while the Canvas side has no `Scroll to 2-hop links` or `Scroll to note top`
  action.
- Returning to a Markdown note restores exactly one upper-right action.
- With separate-pane display enabled, the action is absent from both the main
  Markdown note and the separate 2-hop pane.

## 18. Opening Markdown from a custom view

Use PalmWiki Home or another navigable custom `ItemView` with inline 2-hop
display enabled.

Expected result:

- Opening a note from a normal card, a full-text search result, a recent/title
  suggestion, and a table row renders 2-hop links in the resulting Markdown
  view without requiring a second tab switch.
- Opening a note from Obsidian's File Explorer while the custom view is active
  also renders 2-hop links.
- Live Preview, Source mode, and Reading view each render into the current view
  rather than a detached predecessor.
- Switching Live Preview -> Reading view -> Live Preview keeps exactly one
  current 2-hop result in each mode and never revives another file's hidden
  result.
- Rapidly opening A, then B before A finishes mounting, never injects A's cards
  into B and leaves no delayed retry for A.
- Closing the leaf, enabling `Show 2hop links in separate pane`, or unloading
  the plugin during the wait leaves no inline container or pending retry.
- Enable `Show 2hop links in separate pane` while Reading view is active and
  then return to Live Preview; repeat in the reverse direction. Inline content
  and the upper-right action remain absent until the setting is disabled, then
  exactly one current result returns.
- After both source and preview modes have been shown, disable the plugin from
  Community Plugins, switch to the other mode, and wait three to five seconds.
  No hidden content or action returns. Re-enable the plugin after the test.
- Navigation history contains one normal open operation; the plugin does not
  trigger duplicate `file-open` or `active-leaf-change` events.
