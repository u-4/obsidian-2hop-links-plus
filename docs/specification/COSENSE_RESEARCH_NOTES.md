# Cosense related-page list: research notes

Updated on 2026-10-04 for 0.44.0. Earlier notes guessed a weighted "related
score" and a PageRank-like composite; both were wrong and were removed.

## Sources

- Cosense's browser code, which computes the order on the client:
  `https://scrapbox.io/assets/dedicated-worker.js`, `index.js` and the sort
  menu chunk, read on 2026-10-04. File names change between releases. The
  plugin re-expresses the behaviour in its own code; no Cosense code is copied.
- Help pages: https://scrapbox.io/help-jp/関連ページリスト and
  https://scrapbox.io/help/Related_pages
- Release notes 2018–2024 on https://scrapbox.io/help-jp/ (PageRank sort added
  2024-04-19; PageRank components listed 2024-01-18).
- Community observations: https://scrapbox.io/villagepump/ and
  https://scrapbox.io/scrapboxlab/relatedPageSort

## What the list contains (confirmed)

From top to bottom:

1. **Links**: pages the current page links to and pages that link to it.
2. External links to other projects (not applicable to Obsidian).
3. **One group per link** in the current page ("2-hop"): pages that share that
   link.
4. **New Links**: links to missing pages that no related page shares.

## Groups (confirmed)

- Group headings are the current page's links in the order they are written.
- Every page sharing the link belongs to the group, but a page is shown only
  under the first group it matches, and pages already in Links are not shown
  again.
- Groups with at most 100 pages keep the link order. Larger groups move to the
  end, smallest first.
- A link to a missing page forms a group when another page has the same link.

## Related order (confirmed)

The sort menu offers Related (default), Modified, Created, Last visited, Most
linked, Page rank and Title. Obsidian has no visit counts or published
PageRank, so the plugin offers Related, Modified, Created, Most linked and
Title.

For Related, each page gets a list of relations to the current page, in this
order: the current page links to it; it links to the current page; then each
of the current page's links that it also has, in the order they appear in the
candidate page. The first relation decides the tier: linked-to pages come
first, then pages linking back, then pages sharing a link, where a shared link
written earlier in the current page ranks higher. Within a tier, more
relations rank higher, and ties go to the most recently modified page.

There is no weighting by how rare a link is. Hub pages are kept from
dominating by the one-group-per-page rule and by moving large groups to the
end.

## Updates (confirmed)

The list is recomputed when a saved change alters the page's links, or when
another user's change touches a related page. Typing text alone does not
reorder it. The plugin follows this through its link-signature check.

## Not reproduced

- PageRank: Cosense computes it in a nightly batch from backlinks, backlinks of
  backlinking pages, links and edit frequency; the weights are not public.
- Folding of similar titles (such as dated pages) inside Links.
- Hidden headwords and synonyms, which Cosense configures per project.
