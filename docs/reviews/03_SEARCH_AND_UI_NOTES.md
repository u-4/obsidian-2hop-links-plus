# Search and UI Notes

## Search Targets

Card search includes candidate-facing fields only:

- link text
- target path
- reveal link text/path
- shared intermediate links
- resolved file path and basename
- aliases and tags
- outgoing links when enabled for card search text
- body text only when body search is enabled and populated

`sourcePath` is intentionally excluded because it often points to the active note, not the candidate card.

## Body Search Status

The search toolbar now shows `Searching body...` while candidate body text is being populated. The message is intentionally small and only visible during the asynchronous body phase.

## LinkView Prop Changes

If React reuses a `LinkView` instance with a different `fileEntity`, the previous preview/title request is aborted and the new entity is loaded. Stale async results are ignored by comparing the current entity key before setting state.
