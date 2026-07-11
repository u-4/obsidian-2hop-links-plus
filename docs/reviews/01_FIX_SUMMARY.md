# Final Hardening Fix Summary

## Search Text

`src/search.ts` no longer includes `entity.sourcePath` in `buildFileEntitySearchText()`.

`sourcePath` remains available as link-resolution context, but it is not searchable. This avoids the active page name or folder matching every related card.

## Frontmatter Metadata Guard

`getLinksListOfFilesWithFrontmatterKeys()` now accepts `CachedMetadata | null | undefined` and returns an empty list when active metadata or frontmatter is unavailable.

## Tag Candidate Duplicate Handling

Tag-card duplicate checks now compare `FileEntity.key()`, which prefers `targetPath`. Distinct files such as `folderA/Foo.md` and `folderB/Foo.md` are no longer collapsed only because they share a basename.

## Body Search Render Flow

`TwohopLinksRootView.scheduleSearch()` now applies search once and returns when body search is disabled or the query is empty. Two-phase updates remain only for body-enabled non-empty queries.

While body text is being populated, the toolbar shows a small `Searching body...` status.

## LinkView Reuse Guard

`LinkView` now reloads preview and title when a reused component receives a different file entity. It aborts previous async requests and only applies results when the current entity still matches.
