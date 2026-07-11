# Acceptance tests

## 1. Build and static checks

From the plugin repository root:

```bash
npm install
npm run build
```

If feasible:

```bash
npm run eslint
```

Expected result:

- `npm run build` completes without TypeScript errors.
- Existing settings and UI still render.
- No dependency upgrades are required.

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
5. Open `P.md`.

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

Set Sort Order to `Related score`. Open `P.md`.

The active file has outgoing links to `RareA`, `RareB`, `CommonHub`, `RareC`, and `DirectTarget`.

Expected qualitative order:

- Cards that share multiple rare links with `P.md` rank above cards that share only `CommonHub`.
- `X_shared_AB.md` and `X_shared_ABC.md` should appear above `X_common_only.md`.
- Candidates sharing only `CommonHub` should not dominate merely because `CommonHub` has many backlinks.

Exact order can vary with implementation details, but the following should hold:

```text
rank(X_shared_AB or X_shared_ABC) > rank(X_common_only)
rank(X_pageRank_high) >= rank(X_pageRank_low) when related scores are otherwise similar
```

## 6. Related, Cosense-like sorting

Set Sort Order to `Related, Cosense-like`. Open `P.md`.

Expected result:

- 2-hop sections follow the outgoing link order in `P.md`:

```text
RareA
RareB
CommonHub
RareC
DirectTarget
```

- If a candidate shares several intermediates, it is assigned to the first matching intermediate in that active-page order.

## 7. Page rank sorting

Set Sort Order to `Page rank`. Open `P.md`.

Expected result:

- `X_pageRank_high.md` should rank above `X_pageRank_low.md` within comparable 2-hop sections because multiple `PR_Backlink_*.md` files link to `X_pageRank_high.md`.
- The plugin should not use Google-style iterative PageRank unless it is explicitly combined with or documented as separate from the Cosense-like PageRank approximation.

## 8. Most linked sorting

Set Sort Order to `Most linked`. Open `P.md`.

Expected result:

- Cards with more inbound links in the test vault rank above otherwise similar cards.
- This mode is simpler than `Page rank`: it should mainly track unique backlink count/in-degree.

## 9. Card search/filter

Open `P.md` and use the search box above the cards.

Test queries:

```text
shared_ab
rareb
commonhub
pagerank_high
cosense-test-card
```

Expected result:

- `shared_ab` shows `X_shared_AB.md` and hides unrelated cards.
- `rareb` matches cards or sections connected to `RareB`.
- `commonhub` matches the `CommonHub` section and/or cards whose outgoing links include `CommonHub`.
- `pagerank_high` shows `X_pageRank_high.md`.
- `cosense-test-card` matches notes with that test tag/frontmatter metadata if metadata is indexed.
- Empty query restores the full list.
- Changing the query resets displayed box/section counts so newly filtered results are visible.

## 10. Jump to link line: 2-hop cards

Open `P.md`. In a 2-hop section, click a card.

Specific examples:

- In the `RareA` section, click `X_shared_AB.md`.
- Expected: Obsidian opens `X_shared_AB.md` and moves to the line containing `[[RareA]]`.

- In the `RareB` section, click `X_shared_BA_reversed.md`.
- Expected: Obsidian opens `X_shared_BA_reversed.md` and moves to the line containing `[[RareB]]`.

If the line does not visibly scroll but the file opens correctly, inspect whether `eState: { line }` is being honored. If not, implement or fix the post-open `MarkdownView.editor.setCursor()` + `scrollIntoView()` fallback.

## 11. Jump to link line: Back Links cards

Open `P.md`. In the Back Links section, click `BacklinkToP.md`.

Expected result:

- Obsidian opens `BacklinkToP.md`.
- The cursor/scroll position moves to the line containing `[[P]]`.

## 12. Context menu and middle click

For a 2-hop card such as `X_shared_AB.md`:

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

## 13. Regression checks

- Forward Links still open normally.
- New Links still ask whether to create a file.
- Tags Links and Properties Links still render and sort using existing modes.
- Duplicate removal still suppresses duplicate cards when enabled.
- Separate pane mode still renders the same card list.
- Mobile/touch long-press context menu still works as before.

## 14. Large vault sanity check

On a larger real vault:

- Opening a note should not freeze Obsidian for several seconds.
- Typing in the search box should feel immediate because it filters precomputed card arrays rather than rebuilding the graph.
- If performance is poor, cache `GraphIndex` and invalidate on `metadataCache.on("resolved")` or `metadataCache.on("changed")`.
