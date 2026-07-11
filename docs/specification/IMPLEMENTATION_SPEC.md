# Implementation specification

## 1. Current plugin structure

Relevant existing files:

```text
src/links.ts
  Links.gatherTwoHopLinks()
  Links.getForwardLinks()
  Links.getBackLinks()
  Links.getTwohopLinks()
  Links.aggregate2hopLinks()
  Links.getSortedFileEntities()

src/sort.ts
  getSortFunction()
  getTwoHopSortFunction()
  getSortFunctionForFile()

src/ui/TwohopLinksRootView.tsx
  Root component for the card area.

src/ui/TwohopLinksView.tsx
  Renders 2-hop sections and cards.

src/ui/LinkView.tsx
  Renders a card and handles click/context menu/hover.
```

Existing sort modes are:

```text
random
filenameAsc
filenameDesc
modifiedDesc
modifiedAsc
createdDesc
createdAsc
```

Add new modes without removing these.

## 2. New sort modes

Add these setting values:

```ts
relatedScoreDesc
relatedCosenseLike
pageRankDesc
mostLinkedDesc
```

Suggested labels:

```text
Related score
Related, Cosense-like
Page rank
Most linked
```

Recommended default: keep the existing default `random` for backward compatibility. The user can switch to `Related score` in settings. If this is a private fork and backward compatibility is not a concern, `relatedScoreDesc` is a reasonable default.

## 3. Data model changes

### 3.1 FileEntity

Current `FileEntity` only has `sourcePath` and `linkText`. Extend it so the plugin can distinguish display/open target from relation evidence.

Recommended shape:

```ts
export class FileEntity {
  public sourcePath: string;
  public linkText: string;
  public targetPath?: string;
  public linkTextToReveal?: string;
  public targetPathToReveal?: string;
  public relatedScore?: number;
  public pageRank?: number;
  public inDegree?: number;
  public sharedLinks?: string[];

  constructor(args: {
    sourcePath: string;
    linkText: string;
    targetPath?: string;
    linkTextToReveal?: string;
    targetPathToReveal?: string;
    relatedScore?: number;
    pageRank?: number;
    inDegree?: number;
    sharedLinks?: string[];
  }) { ... }
}
```

However, this is a larger refactor. If you need a smaller patch, keep the current constructor compatible:

```ts
constructor(
  sourcePath: string,
  linkText: string,
  linkTextToReveal?: string,
  targetPath?: string,
  targetPathToReveal?: string
)
```

Maintain existing call sites. Do not break `new FileEntity(sourcePath, linkText)`.

### 3.2 TwohopLink

Extend `TwohopLink` to hold section-level scores.

```ts
export class TwohopLink {
  public link: FileEntity;          // the intermediate link / section header
  public fileEntities: FileEntity[]; // candidate cards
  public relatedScore?: number;
  public pageRank?: number;
  public inDegree?: number;

  constructor(
    link: FileEntity,
    fileEntities: FileEntity[],
    scores?: { relatedScore?: number; pageRank?: number; inDegree?: number }
  ) { ... }
}
```

## 4. Ranking module

Create `src/ranking.ts`.

### 4.1 Types

```ts
export type SortOrder =
  | "random"
  | "filenameAsc"
  | "filenameDesc"
  | "modifiedDesc"
  | "modifiedAsc"
  | "createdDesc"
  | "createdAsc"
  | "relatedScoreDesc"
  | "relatedCosenseLike"
  | "pageRankDesc"
  | "mostLinkedDesc";

export interface GraphIndex {
  paths: string[];
  out: Map<string, Set<string>>;
  in: Map<string, Set<string>>;
  outOrder: Map<string, string[]>;
  orderIndex: Map<string, Map<string, number>>;
  inDegree: Map<string, number>;
  outDegree: Map<string, number>;
  pageRank: Map<string, number>;
}

export interface RelatedCandidateScore {
  path: string;
  sharedLinks: string[];
  bestIntermediate: string | null;
  sharedCount: number;
  sharedIdf: number;
  orderAffinity: number;
  directLinkBonus: number;
  relatedScore: number;
  pageRank: number;
  inDegree: number;
}
```

### 4.2 Build graph index

Use resolved links for graph structure. Obsidian's `resolvedLinks` maps source file paths to destination file paths and link counts. Also use `getFileCache(file).links` and `getFileCache(file).embeds` to preserve document order.

Pseudo-code:

```ts
export function buildGraphIndex(app: App, settings: TwohopPluginSettings): GraphIndex {
  const markdownFiles = app.vault.getMarkdownFiles()
    .filter(file => !shouldExcludePath(file.path, settings.excludePaths));

  const pathSet = new Set(markdownFiles.map(file => file.path));
  const out = new Map<string, Set<string>>();
  const inn = new Map<string, Set<string>>();
  const outOrder = new Map<string, string[]>();

  for (const file of markdownFiles) {
    out.set(file.path, new Set());
    inn.set(file.path, inn.get(file.path) ?? new Set());
  }

  for (const [source, dests] of Object.entries(app.metadataCache.resolvedLinks)) {
    if (!pathSet.has(source)) continue;
    for (const dest of Object.keys(dests)) {
      if (!pathSet.has(dest)) continue;
      if (shouldExcludePath(dest, settings.excludePaths)) continue;
      out.get(source)?.add(dest);
      if (!inn.has(dest)) inn.set(dest, new Set());
      inn.get(dest)?.add(source);
    }
  }

  for (const file of markdownFiles) {
    outOrder.set(file.path, getOutgoingPathsInDocumentOrder(app, file));
  }

  // ensure order contains all resolved outgoing paths even when cache order is unavailable
  ...

  const inDegree = new Map([...paths].map(path => [path, inn.get(path)?.size ?? 0]));
  const outDegree = new Map([...paths].map(path => [path, out.get(path)?.size ?? 0]));
  const pageRank = calculateCosensePageRankLikeScores(app, paths, inn, out, inDegree, outDegree);

  return { paths, out, in: inn, outOrder, orderIndex, inDegree, outDegree, pageRank };
}
```

### 4.3 Outgoing links in document order

For Cosense-like related ordering, the active note's outgoing link order matters. Prefer `CachedMetadata.links` and `CachedMetadata.embeds`, sorted by `position.start.offset` if available.

```ts
function getOutgoingPathsInDocumentOrder(app: App, file: TFile): string[] {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return [];

  const refs = [
    ...(cache.links ?? []),
    ...(cache.embeds ?? []),
  ].sort((a, b) => a.position.start.offset - b.position.start.offset);

  const seen = new Set<string>();
  const result: string[] = [];

  for (const ref of refs) {
    const resolved = app.metadataCache.getFirstLinkpathDest(
      removeBlockReference(ref.link),
      file.path
    );
    if (!resolved) continue;
    if (seen.has(resolved.path)) continue;
    seen.add(resolved.path);
    result.push(resolved.path);
  }

  return result;
}
```

`frontmatterLinks` may be appended after normal body links, but do not rely on them for line jumps unless you implement a text-search fallback.

### 4.4 PageRank-like score

Cosense's public release note describes its PageRank as a weighted score based on four features:

```text
backlink count
backlinking pages' backlink count
link count
edit frequency
```

Implement a Cosense-like approximation, not Google PageRank.

```ts
pageRank(p)
= 0.40 * N(log1p(inDegree(p)))
+ 0.25 * N(sum_{s in In(p)} log1p(inDegree(s)))
+ 0.15 * N(log1p(outDegree(p)))
+ 0.20 * N(editScore(p))
```

Initial `editScore`:

```ts
const days = (Date.now() - file.stat.mtime) / (1000 * 60 * 60 * 24);
const editScore = Math.exp(-days / 90);
```

Normalization:

```ts
N(x) = min(x / percentile95(allX), 1.0)
```

Handle zero/empty values safely:

```ts
function normalizeByP95(values: Map<string, number>): Map<string, number> {
  const sorted = [...values.values()].filter(Number.isFinite).sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.95)] : 0;
  const denom = p95 > 0 ? p95 : 1;
  return new Map([...values].map(([k, v]) => [k, Math.min(v / denom, 1)]));
}
```

### 4.5 Related score

Relatedness is dynamic: it depends on the active note `P` and candidate `C`.

Definitions:

```text
Out(P) = unique outgoing resolved links from active page P
Out(C) = unique outgoing resolved links from candidate C
shared(P, C) = Out(P) ∩ Out(C)
N = number of markdown files in graph
idf(m) = log((N + 1) / (inDegree(m) + 1)) + 1
sharedIdf(P, C) = sum idf(m) for m in shared(P, C)
sharedCount(P, C) = |shared(P, C)|
orderAffinity(P, C) = sum idf(m) / (1 + indexInActivePage(m))
directLinkBonus(P, C) = 1 if P -> C, 0.8 if C -> P, 1 if both, else 0
```

Score:

```ts
relatedScore(P, C)
= 0.55 * N(sharedIdf(P, C))
+ 0.20 * N(log1p(sharedCount(P, C)))
+ 0.15 * N(orderAffinity(P, C))
+ 0.10 * directLinkBonus(P, C)
```

Normalize `sharedIdf`, `sharedCount`, and `orderAffinity` over the candidates for the active page.

### 4.6 Best intermediate / section assignment

Current UI groups 2-hop cards under an intermediate link section.

For each candidate C:

```ts
sharedLinks = shared(P, C)
```

When the sort order is `relatedCosenseLike`, assign C to the first shared link that appears in the active page's link order.

When the sort order is `relatedScoreDesc`, `pageRankDesc`, or `mostLinkedDesc`, assign C to the best intermediate:

```ts
bestIntermediate = argmax_m in sharedLinks of idf(m) / (1 + indexInActivePage(m))
```

This avoids a candidate being hidden under a weak section when it shares several links.

If `enableDuplicateRemoval` is true, show each candidate at most once in 2-hop sections.

### 4.7 Sort behavior

Card-level sort:

```text
relatedScoreDesc:
  relatedScore desc, pageRank desc, mtime desc, title asc

relatedCosenseLike:
  active page link order first, then existing order, then title asc

pageRankDesc:
  pageRank desc, relatedScore desc, mtime desc, title asc

mostLinkedDesc:
  inDegree desc, pageRank desc, mtime desc, title asc
```

Section-level sort:

```text
relatedScoreDesc:
  sum of top 5 card relatedScore values desc
  or max relatedScore desc if simpler

relatedCosenseLike:
  active page outgoing link order asc

pageRankDesc:
  max card pageRank desc

mostLinkedDesc:
  max card inDegree desc
```

Fallback tie-breakers:

```text
mtime desc
basename/title asc
```

## 5. Search/filter module

Create `src/search.ts`.

### 5.1 User behavior

Add a search input above the card area. It should filter the displayed cards and sections.

- Empty query: show all results.
- Non-empty query: split by whitespace; all tokens must match somewhere.
- Matching should be case-insensitive.
- Search should not rebuild the graph on each keystroke.
- Debounce is optional; if implemented, 100-200 ms is sufficient.

### 5.2 Search target text

For each card, include:

```text
fileEntity.linkText
fileEntity.sourcePath
fileEntity.targetPath, if present
fileEntity.linkTextToReveal, if present
file basename/path
frontmatter aliases
frontmatter tags
inline tags
outgoing resolved link basenames/link texts from metadata cache
```

Do not read entire note text in the first implementation. That can be a future option.

### 5.3 Filtering sections

For 2-hop sections:

- If the section header/intermediate link matches the query, keep the section and all cards under it.
- Otherwise, filter the section's cards.
- Drop sections with zero visible cards.

For connected/back/new/tag/property sections:

- Filter cards by card search text.
- For tag/property section headers, if the header matches, keep all cards in that section.

### 5.4 UI state

In `TwohopLinksRootViewState`, add:

```ts
searchQuery: string;
```

On query change:

- update `searchQuery`;
- reset `displayedBoxCount` and `displayedSectionCount` to initial values so filtered results are not unexpectedly hidden by previous pagination state.

Suggested input placement:

```tsx
<div className="twohop-links-toolbar">
  <button className="settings-button">Open Settings</button>
  <input
    className="twohop-links-search-input"
    type="search"
    value={this.state.searchQuery}
    placeholder="Search related cards"
    onChange={(e) => this.handleSearchChange(e.currentTarget.value)}
  />
</div>
```

Add lightweight CSS in `styles.css`.

## 6. Jump to matching link line

A relative patch is already provided:

```text
patches/2hop-links-plus-jump-to-link-line.relative.patch
```

Integrate the behavior, then improve it if needed.

### 6.1 Required behavior

- 2-hop card:
  - open candidate page;
  - jump to the line where the candidate links to the intermediate/section page.
- Back Links card:
  - open backlink source page;
  - jump to the line where it links to the active page.
- Forward Links / New Links:
  - preserve existing open behavior.

### 6.2 How to store the reveal target

For 2-hop card under intermediate `M`:

```ts
new FileEntity(activeFile.path, candidateLinkText, intermediateLinkText)
```

or, with richer model:

```ts
new FileEntity({
  sourcePath: activeFile.path,
  linkText: candidateLinkText,
  targetPath: candidatePath,
  linkTextToReveal: intermediateLinkText,
  targetPathToReveal: intermediatePath,
})
```

For Back Links card from source page `S` to active page `P`:

```ts
new FileEntity(src, linkText, activeFile.path)
```

or richer:

```ts
new FileEntity({
  sourcePath: src,
  linkText,
  targetPath: src,
  linkTextToReveal: activeFile.path,
  targetPathToReveal: activeFile.path,
})
```

### 6.3 Finding the line

Use `app.metadataCache.getFileCache(file)` and scan `cache.links` plus `cache.embeds`. Compare both resolved target paths and normalized link text.

Pseudo-code:

```ts
function findLineOfLinkInFile(file: TFile, linkTextToReveal: string): number | undefined {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return undefined;

  const revealPath = resolveFilePath(linkTextToReveal, file.path);
  const normalizedReveal = removeBlockReference(linkTextToReveal);
  const references = [...(cache.links ?? []), ...(cache.embeds ?? [])];

  for (const reference of references) {
    const referencePath = resolveFilePath(reference.link, file.path);
    if (revealPath && referencePath === revealPath) {
      return reference.position.start.line;
    }

    if (removeBlockReference(reference.link) === normalizedReveal) {
      return reference.position.start.line;
    }
  }

  return undefined;
}
```

### 6.4 Opening and scrolling

Use `openLinkText` with `openViewState`:

```ts
await this.app.workspace.openLinkText(
  fileEntity.linkText,
  fileEntity.sourcePath,
  newLeaf,
  line != null ? { eState: { line } } : undefined
);
```

If this does not consistently move the cursor/scroll in Obsidian, add a post-open fallback:

```ts
const view = this.app.workspace.getActiveViewOfType(MarkdownView);
if (view?.file?.path === file.path && view.editor && line != null) {
  view.editor.setCursor({ line, ch: 0 });
  view.editor.scrollIntoView(
    { from: { line, ch: 0 }, to: { line, ch: 0 } },
    true
  );
}
```

Make sure context menu actions and middle-click also route through the same `onClick(fileEntity, newLeaf)` path so they preserve line jumping.

## 7. Settings additions

In `TwohopPluginSettings`, add optional toggles/settings only if needed:

```ts
relatedScoreWeights?: {
  sharedIdf: number;
  sharedCount: number;
  activeLinkOrder: number;
  directLink: number;
};
pageRankWeights?: {
  backlinks: number;
  backlinkAuthority: number;
  outlinks: number;
  editFrequency: number;
};
includeUnresolvedLinksInRanking?: boolean;
includeTagsAsLinksForRanking?: boolean;
```

For the first implementation, these can be constants in `ranking.ts` to keep the settings panel simple. Add UI controls later only if the behavior needs tuning.

## 8. Performance notes

- Build the graph once per `gatherTwoHopLinks()` call, not per card.
- Do not call `vault.adapter.stat()` repeatedly if `TFile.stat` is already available.
- Avoid `Math.random()` comparator for stable sorts except existing `random` mode.
- For large vaults, cache `GraphIndex` and invalidate on metadata `resolved` or vault `modify` events. This can be a later optimization if the initial implementation is responsive.

## 9. References for API behavior

- Obsidian API repository: https://github.com/obsidianmd/obsidian-api
- Type definitions: https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts
- Cosense related page list: https://scrapbox.io/help-jp/%E9%96%A2%E9%80%A3%E3%83%9A%E3%83%BC%E3%82%B8%E3%83%AA%E3%82%B9%E3%83%88
- Cosense 2 hop search: https://scrapbox.io/help-jp/2_hop_search
- Cosense 2024 release note mentioning PageRank components: https://scrapbox.io/help-jp/%E3%83%AA%E3%83%AA%E3%83%BC%E3%82%B9%E3%83%8E%E3%83%BC%E3%83%882024
