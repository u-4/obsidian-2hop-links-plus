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

- The toolbar order is a full-width compact search surface, gear button, then sort
  icon, and the three controls remain on one line at every pane width. Before
  expansion, the search surface shows only its left-aligned search icon.
- The search surface has a slightly rounded rectangular outline rather than a
  circle or pill, and fills all space up to the gear button. Activating its icon
  expands the input inside the same unchanged outline and focuses it.
  Activating the icon again, or pressing Escape in the input, closes the input and
  clears the filter so no hidden query remains active.
- Search expansion and query changes do not move the gear or sort controls.
- The gear button opens the 2Hop Links Plus settings tab.
- Activating the sort icon opens an Obsidian menu containing every Default sort
  order option, and exactly one check mark identifies the current temporary order.
- Changing the toolbar menu immediately rebuilds and reorders the cards.
- Changing the toolbar menu does not change the Default sort order in settings.
- The sort icon has no status dot while it matches the configured default. Choosing
  a different temporary order adds a small accent-colored dot at its upper-right;
  choosing the default again or opening another note removes the dot.
- Opening another note resets the temporary sort menu to the configured default.
- Restarting Obsidian uses the configured default; the temporary toolbar choice is not saved.
- In a narrow main or separate pane, the collapsed controls stay on one line
  without horizontal overflow, and each icon remains usable.
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
2-hop view is opened, and offers the same choices as Cosense's related-page
sort menu:

```text
Related
Modified
Created
Most linked
Title
```

Settings saved by 0.43.0 or earlier with another order (for example `Random`
or `Related score`) load as `Related`; `File name (A to Z)` loads as `Title`.

## 5. Links section

Set the sort order to `Related`. Open `Active.md`.

Expected result:

- One `Links` section lists the notes `Active.md` links to, followed by notes
  that link to `Active.md` (for example `BacklinkToActive.md`). There is no
  separate Back Links section.
- A note that both links and is linked comes first.
- Among linked notes, a note with more connections to `Active.md` (links in
  both directions, or more of `Active.md`'s links in common) comes first; ties
  go to the most recently modified note.

## 6. 2-hop groups

Open `Active.md`.

Expected result:

- 2-hop groups follow the order of the links in `Active.md`. Groups with more
  than 100 notes move to the end, smallest first:

```text
RareA
RareB
RareC
CommonHub
DirectTarget
```

- A note that shares several of `Active.md`'s links appears once, under the
  first of those links. `MultiSharedCandidate.md` appears under `RareA` only.
- Notes already in `Links` are not repeated in 2-hop groups.
- With `Related`, a note whose first shared link comes earlier in `Active.md`
  ranks higher within a group.
- A link to a missing note forms a group when another note has the same
  missing link; otherwise it appears in `New Links`.

## 7. Other sort orders

Switch the toolbar sort menu to `Modified`, `Created`, `Most linked`, and
`Title`.

Expected result:

- Cards inside `Links`, each 2-hop group, and Tags reorder by the chosen value.
- The order of the 2-hop groups stays the same.
- `Most linked` ranks notes by the number of notes linking to them, so
  `PageRankHigh.md` ranks above `PageRankLow.md`.

## 8. Editing stability

Open `Active.md` and type ordinary text, without touching any link.

Expected result:

- The cards do not reorder or reload, and expanded `Load more` sections stay
  expanded.
- Adding or removing a link updates the cards once.

## 8a. Cards

Open a note with many related cards and scroll through them.

Expected result:

- Cards keep a fixed height with a two-line title, an image when the note
  embeds one (or links a YouTube video), and a short excerpt.
- Excerpts appear as cards come near the screen; cards far below stay
  title-only until scrolled to.
- Turning off `Show Image in the 2hop Links` hides the images.

## 8b. Card popups (Mac)

Hold Cmd and point at a card.

Expected result:

- A popup opens off a corner of the card (bottom-right first), overlapping it
  by about 20 px, so the cards to the right and below can still be pointed at.
  Up to 10 related cards sit without a background above the preview, or below
  it when the popup opens upward near the bottom of the window.
- Holding Cmd over a card or link inside the popup opens the next popup; a
  link's popup opens below the link, or above it near the bottom.
- Clicking inside the preview opens the note in Hover Editor; Escape closes
  all popups. Without Cmd, pointing at a card does nothing.
- Moving the pointer off a link or card inside a popup, while staying inside
  the popup, keeps it open.
- After a link or card inside a popup opened the next popup, moving back onto
  the first popup away from that link or card closes the next popup in about
  0.25 s; passing over the first popup on the way to the next one does not.
- The preview scrolls to and highlights the line that links back to where the
  pointer came from: for a 2-hop card the line with the group's link, for a
  link inside a popup the line linking to that popup's note, and for a link
  to a heading (`[[Note#Heading]]`) that heading. Only that line is
  highlighted, also inside bulleted lists.

## 8c. Body links and the title (Mac)

Expected result:

- Holding Cmd over a link in the note body opens the light popup below the
  link (above it near the bottom of the window), in Reading view, Live Preview
  and Source mode. Hover Editor does not open at the same time; clicking in the
  popup opens Hover Editor.
- Pointing at the note title shows the notes linking to it as cards above the
  title. The row stays while the pointer is on it or a popup from it is open,
  and goes away about 2.5 seconds later.

## 8d. Popup title and options

Expected result:

- The popup's note name stays at the top on one line while the preview
  scrolls.
- With `Light preview trigger` set to `Hover only`, resting the pointer on a
  card or note link opens the popup after about 0.3 s; scrolling content
  under a still pointer, holding a mouse button, or typing just before does
  not. Cmd/Ctrl still opens at once. With the default, plain hover opens
  nothing.
- `Related cards in the light preview` puts the cards above the preview,
  below it, or (Auto) on the side away from the pointer.

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

## 11. Jump to link line: cards for notes linking back

Open `Active.md`. In the Links section, click `BacklinkToActive.md`.

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
- Open `Active.md`; `CanvasBacklink.canvas` appears in Links.
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
- Tags Links still render and sort using the selected order.
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
- With `Include back links in Links` disabled on a Markdown note, Canvas files are not read
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

## 19. Responsive toolbar, card readability, and content-card boundary

Use `Active.md` with enough results to fill several rows. Test both light and dark
themes, first with the default theme and then with the coordinated
`cosense-scrapbox-style.css` snippet enabled.

Expected result:

- At iPhone-sized or otherwise narrow pane widths, the full-width compact search
  surface, settings, and sort controls remain on one line with no horizontal page
  scroll.
- Each compact control has a 44 px touch target in the narrow layout. Search
  expansion, clearing by activating the search icon again, Escape, settings, and
  every sort menu item remain operable.
- Narrow layouts display two cards per row. Titles and previews are readable,
  long Japanese titles wrap inside their cards, and images do not expand the grid.
- The light theme uses a light control surface with dark text and icons. Card
  preview text remains distinguishable from its white card rather than appearing
  as very pale gray.
- Expanding or focusing the search input does not add a second inset form-field
  surface. The whole search control remains light in the light theme and uses one
  continuous theme-appropriate dark surface in the dark theme; only the outer
  accent focus indicator changes.
- The sort menu opens only after activating its icon, stays inside the visible
  window, marks the current temporary order, and closes after a selection. Its
  surface is light with dark text in the light theme and dark with light text in
  the dark theme, including checked, hovered, and selected rows.
- Start with several displayed rows, then search for many matches, one match, and
  no matches without clearing the input. The toolbar stays at the same viewport
  position and the results region never shrinks below the height that was rendered
  immediately before the search began. Clearing the query restores natural height.
- With the coordinated Cosense snippet enabled, only the Markdown page content is
  presented as the note card. `.twohop-links-container` and Obsidian's in-document
  `.embedded-backlinks` remain on the surrounding canvas surface.
- The content-card boundary remains correct in Live Preview, Source mode, and
  Reading view, with inline 2-hop enabled or disabled and with standard backlinks
  expanded or collapsed. No one-pixel white outline remains around the left,
  right, or bottom edge of the 2-hop canvas region.
- The plugin remains usable without the optional Cosense snippet; it does not
  directly depend on any `--cosense-*` custom property.
- Inline results expose the stable integration contract
  `.twohop-links-container--inline.is-document-related-region`,
  `data-twohop-placement="document-footer"`, and a `data-twohop-host` value of
  `reading`, `editor`, or `legacy`. Editor hosts also expose
  `data-twohop-engine="cm6"`. The host class
  `.has-twohop-document-related-region` is removed when inline results are
  disabled or the plugin unloads.
- Keyboard focus is visible. Screen-reader names identify Search, Settings, and
  the current temporary sort order even though the controls use icons.
