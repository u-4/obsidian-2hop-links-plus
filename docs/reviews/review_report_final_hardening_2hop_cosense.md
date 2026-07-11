# Review report: final hardening bundle for obsidian-2hop-links-plus Cosense-style changes

## Reviewed material

- Bundle: `review_bundle_final_hardening.zip`
- Source: `source/full-source.zip`
- Patch: `source/patch-from-followup2.diff`
- Logs: `logs/npm-run-build.log`, `logs/npm-run-eslint.log`, `logs/git-diff-check.log`
- Key files reviewed:
  - `src/search.ts`
  - `src/bodySearch.ts`
  - `src/links.ts`
  - `src/ui/TwohopLinksRootView.tsx`
  - `src/ui/TwohopLinksView.tsx`
  - `src/ui/TagLinksListView.tsx`
  - `src/ui/LinkView.tsx`
  - `src/main.tsx`
  - `src/getTitle.ts`
  - `src/preview.ts`
  - `src/ranking.ts`
  - `src/sort.ts`

## Summary verdict

The final hardening patch addresses the blocking issues raised in the previous review. In static review, I did not find a remaining P1 blocker.

This version is reasonable to test in a personal Obsidian vault after copying it into a local plugin folder. For distribution or for use in a large production vault, I would still run the manual Obsidian UI checklist because the bundle explicitly says manual UI testing was not performed.

## Build and lint status

The bundle logs report:

- `npm run build`: success, exit code 0
- `npm run eslint`: success exit code, warnings only
- `git diff --check`: success

I did not treat local build output in this review as authoritative because the uploaded source bundle does not include `node_modules`, and this environment does not have the project dependencies installed from the bundle.

## Previous final-hardening items

### 1. `sourcePath` removed from card search text

Status: addressed.

`src/search.ts` no longer includes `entity.sourcePath` in `buildFileEntitySearchText()`. This fixes the specific issue where searching the active note name could match every card merely because many `FileEntity.sourcePath` values point to the active note.

A small nuance remains: Back Links cards still include `linkTextToReveal`, which is often the active file path. That means searching the active page name may still match Back Links cards. This is acceptable because those cards genuinely link to the active page; it is no longer a global false positive across all cards.

### 2. Frontmatter metadata guard

Status: addressed.

`getLinksListOfFilesWithFrontmatterKeys()` now accepts `CachedMetadata | null | undefined` and returns an empty list when the active file has no metadata or no frontmatter. This removes the previous indexing/startup-time null-risk.

### 3. Tag duplicate checks for same-basename files

Status: addressed.

Tag section duplicate checks now use `FileEntity.key()`, which prefers `targetPath`. This should prevent distinct files such as `folderA/Foo.md` and `folderB/Foo.md` from collapsing solely because they share the same basename.

### 4. Body search no longer double-applies metadata-only search when body is unnecessary

Status: addressed.

`TwohopLinksRootView.scheduleSearch()` now applies one metadata-only search and returns when the query is empty or body search is disabled. The two-phase metadata-first/body-second flow only runs when body search is enabled and the query is non-empty.

### 5. Body-search status indicator

Status: addressed.

A small `Searching body...` status is shown while candidate body text is being populated.

### 6. `LinkView` prop reuse guard

Status: addressed.

`LinkView` now aborts previous preview/title requests and reloads title/preview when the `fileEntity` identity changes. It also checks the current file entity key before applying async results, which reduces stale preview/title writes.

## Remaining observations

### P1 blockers

None found in static review.

### P2: Manual Obsidian UI testing is still required before broad use

The bundle’s own `04_MANUAL_TEST_NOTES.md` states that manual UI testing was not performed. Before putting this into daily use, test at least the included `test-vault/` scenarios in Obsidian.

Minimum manual checklist:

1. Search the active note name and confirm it does not match all cards merely because the active note is the source path.
2. Turn body search ON and confirm a body-only token matches the relevant candidate card.
3. Turn body search OFF and confirm the same body-only token no longer matches, even after it had previously been cached.
4. Confirm 2-hop card click opens the candidate page at the line containing the intermediate link.
5. Confirm Back Links card click opens the backlink source at the line containing the active-page link.
6. Confirm same-basename files can both appear where appropriate, especially in tag cards.
7. Confirm Hover Preview and dragged wikilinks resolve same-basename files by path rather than basename.
8. Confirm `Related score`, `Related, Cosense-like`, `Page rank`, and `Most linked` sorting behave plausibly in the test vault.

### P2/P3: Body search cache is unbounded

`bodySearchTextCache` is keyed by file path and invalidated by `mtime`/`size`, which is good. However, it has no maximum entry count or memory cap. In a very large vault, repeated body searches could keep many large strings in memory.

This is not a blocker for personal testing, but for distribution I would consider a small LRU policy, for example a 200–500 file cap or an approximate total-character cap.

### P3: Candidate preview image resolution still uses `sourcePath` in one place

In `src/preview.ts`, image links found inside the candidate note are resolved with `fileEntity.sourcePath`. For many 2-hop cards, `sourcePath` is the active note rather than the candidate note. Since `targetPath` now exists, embedded images in a candidate note should ideally be resolved relative to the candidate file path.

Suggested direction:

- Resolve the candidate note file first.
- Use `file.path` as the source path when resolving embedded images inside that candidate note.

This is mainly relevant when candidate notes contain relative image links and the active note is in a different folder.

### P3: `LinkView` may briefly show stale title/preview during async reload

The async guard prevents stale results from being applied, which is the important part. While a reused component is loading a new entity, the previous title/preview may remain visible until the new request completes. Given the current keys, this is likely rare, but clearing `preview` and `title` at the start of `loadPreviewAndTitle()` would make the behavior cleaner.

### P3: Properties section keys still use index

`PropertiesLinksListView` still keys section components by `index`. This is less risky than the previous 2-hop section-title issue because the section header is rendered directly from props and `resetCounter` resets displayed counts. Still, a stable key such as `${tagLink.key}:${tagLink.property}` would be more robust and more consistent with the 2-hop section fix.

## Recommendation

This build can be treated as a release candidate for personal testing.

I would not send it back to Codex for another mandatory repair pass. If the goal is eventual distribution or use in a large vault, an optional polish pass should address:

1. LRU or size-capped body search cache.
2. Candidate-local image resolution in `readPreview()`.
3. Clearing `LinkView` title/preview at the start of async reload.
4. Stable keys for property/tag sections.

