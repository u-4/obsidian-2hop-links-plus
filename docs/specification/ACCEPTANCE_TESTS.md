# Acceptance tests

## 1. Build and static checks

From the plugin repository root:

```bash
npm ci
npm run build
npm run eslint
git diff --check
npm audit
```

Expected result:

- `npm run build` completes without TypeScript errors.
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
- The gear button opens the 2Hop Links Plus settings tab.
- The dropdown contains every Default sort order option from the settings tab.
- Changing the toolbar dropdown immediately rebuilds and reorders the cards.
- Changing the toolbar dropdown does not change the Default sort order in settings.
- Opening another note resets the toolbar dropdown to the configured default.
- Restarting Obsidian uses the configured default; the temporary toolbar choice is not saved.
- The toolbar wraps without horizontal overflow in a narrow separate pane.

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

- Open `Active.md` and confirm `FrontmatterLinkCandidate.md` appears in the
  `RareA` 2-hop section even though its `[[RareA]]` link is in frontmatter.
- Search for `cosense-test-card` and confirm that card remains visible.
- Click the card and confirm the frontmatter link location is opened.

Canvas checks require `Show 2hop links in separate pane`:

- Open `CanvasActive.canvas`; `RareA.md`, `RareB.md`, and `DirectTarget.md`
  are treated as outgoing links and related cards render without an exception.
- Open `Active.md`; `CanvasBacklink.canvas` appears in Back Links.
- Open `InvalidCanvasNodes.canvas`; the plugin remains enabled and shows no
  Canvas-derived results rather than throwing an exception.

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

- Opening a note should not freeze Obsidian for several seconds.
- Typing in the search box should feel immediate because it filters precomputed card arrays rather than rebuilding the graph.
- If performance is poor, cache `GraphIndex` and invalidate on `metadataCache.on("resolved")` or `metadataCache.on("changed")`.
