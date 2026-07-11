# Cosense research notes and implementation rationale

## What is known from public information

Cosense/Scrapbox related page cards are based on links between pages. In Cosense, a page's related page list shows pages reachable through the current page's links, including 2-hop links. Public help describes this as pages that share common links or hashtags, with one more hop through the linked page.

Cosense also has a related-page-list search feature called 2 hop search.

For PageRank, Cosense's public 2024 release note states that PageRank is calculated by weighting four features:

```text
被リンク数
被リンクページの被リンク数
リンク数
編集頻度
```

English interpretation:

```text
backlink count
backlinking pages' backlink count
link count
edit frequency
```

Therefore, implement a Cosense-like composite score rather than classic iterative Google PageRank.

## What is inferred, not confirmed

The exact Cosense weights, normalization, duplicate handling, and section assignment rules are not public.

The related sort appears to be influenced by:

```text
current page's outgoing link order
shared links between current page and candidate page
possibly direct links/backlinks
possibly page-level importance
```

Because the exact algorithm is uncertain, this plugin should offer two related modes:

```text
Related, Cosense-like
  Use current page outgoing link order as the dominant section-order signal.

Related score
  Use a more useful Obsidian-specific score based on shared rare links, shared link count, active-link order, and direct links.
```

## Recommended design distinction

Do not merge PageRank and relatedness too aggressively.

```text
Related score = how close candidate C is to the currently active page P.
Page rank = how important candidate C is globally within the vault.
```

This distinction lets users choose between contextual navigation and global importance.

## Recommended related score

```text
relatedScore(P, C)
= 0.55 * normalized sharedIdf(P, C)
+ 0.20 * normalized log(1 + sharedCount(P, C))
+ 0.15 * normalized orderAffinity(P, C)
+ 0.10 * directLinkBonus(P, C)
```

Where:

```text
shared(P, C) = Out(P) ∩ Out(C)
sharedCount(P, C) = |shared(P, C)|
idf(m) = log((N + 1) / (inDegree(m) + 1)) + 1
sharedIdf(P, C) = sum idf(m) for m in shared(P, C)
orderAffinity(P, C) = sum idf(m) / (1 + indexInActivePage(m))
directLinkBonus(P, C) = 1 if P -> C, 0.8 if C -> P, 1 if both, else 0
```

Rationale:

- Rare shared links usually indicate stronger semantic relation than common hub links.
- Shared link count still matters.
- Active page link order is included because Cosense-like behavior appears to use the current page's link order.
- Direct links/backlinks are useful relation evidence.

## Recommended PageRank-like score

```text
pageRank(p)
= 0.40 * N(log1p(inDegree(p)))
+ 0.25 * N(sum_{s in In(p)} log1p(inDegree(s)))
+ 0.15 * N(log1p(outDegree(p)))
+ 0.20 * N(editScore(p))
```

Initial edit score:

```text
editScore(p) = exp(-daysSinceModified(p) / 90)
```

This uses last modified time as an approximation for edit frequency. A closer future version could record actual edit counts over 30/90/365 days.

## Tags and unresolved links

Cosense treats hashtags as links. Obsidian tags are often operational labels such as `#todo`, `#meeting`, or `#draft`; treating all tags as normal links can distort ranking. Therefore:

```text
includeTagsAsLinksForRanking = false by default
```

Unresolved links can be useful for Cosense-like behavior. However, resolved links are simpler and safer for the initial implementation. If unresolved links are included, represent them as virtual nodes and avoid trying to open them as files unless the user explicitly clicks a New Link.

## Cosense API caution

Do not depend on Cosense internal APIs for this plugin. This task should run entirely inside Obsidian using the local vault and Obsidian's metadata cache.

## Source URLs

- Cosense related page list: https://scrapbox.io/help-jp/%E9%96%A2%E9%80%A3%E3%83%9A%E3%83%BC%E3%82%B8%E3%83%AA%E3%82%B9%E3%83%88
- Cosense 2 hop search: https://scrapbox.io/help-jp/2_hop_search
- Cosense 2023 release notes, 2 hop search entries: https://scrapbox.io/help-jp/%E3%83%AA%E3%83%AA%E3%83%BC%E3%82%B9%E3%83%8E%E3%83%BC%E3%83%882023
- Cosense 2024 release notes, PageRank components: https://scrapbox.io/help-jp/%E3%83%AA%E3%83%AA%E3%83%BC%E3%82%B9%E3%83%8E%E3%83%BC%E3%83%882024
- Obsidian API type definitions: https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts
