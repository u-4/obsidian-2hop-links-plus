# Change Summary

## Body Search Cache

File: `src/bodySearch.ts`

- Added `MAX_BODY_SEARCH_CACHE_ENTRIES = 300`.
- Added `MAX_BODY_SEARCH_CACHE_CHARS = 20_000_000`.
- Refreshes a cache entry's insertion order when the cached body text is reused.
- Deletes stale cache entries when `mtime` or `size` no longer matches.
- Prunes oldest entries after inserting new body text until both cache caps are
  satisfied.
- Preserves the existing behavior that body files are read only through the
  existing body-search path.

## Candidate-Relative Preview Images

File: `src/preview.ts`

- Embedded image links found inside a candidate note are now resolved relative to
  the resolved candidate file path (`file.path`).
- The candidate file itself is still resolved using the existing
  `targetPath`-first behavior.

## LinkView Reload State

File: `src/ui/LinkView.tsx`

- Clears `preview` and `title` at the beginning of `loadPreviewAndTitle()`.
- Keeps the existing abort-controller and file-entity-key guard before applying
  asynchronous preview/title results.

## Stable Tag/Property Section Keys

File: `src/ui/TagLinksListView.tsx`

- Replaced `key={index}` for tag/property sections.
- New section key is derived from `tagLink.key`, `tagLink.property`, and the
  section's file entity keys.
- This avoids React component reuse based only on array position when sections
  are filtered or reordered.

## Generated Artifacts

The bundle includes the rebuilt plugin artifacts:

- `artifacts/main.js`
- `artifacts/manifest.json`
- `artifacts/styles.css`

The source patch intentionally excludes generated `main.js` so that the review
diff remains readable.
