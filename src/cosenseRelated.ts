import type { SortOrder } from "./settings/sortOptions";

/**
 * Related-page ordering modelled on Cosense's related page list.
 *
 * - Links: pages the note links to and pages that link to the note.
 * - Groups ("2-hop"): one group per link in the note, in the order the links
 *   are written. A group lists other pages that share that link. Each page is
 *   shown once, under the first group it matches. Groups larger than
 *   LARGE_GROUP_SIZE move to the end, smallest first.
 * - New links: links to missing notes that no other page shares.
 *
 * The Related order ranks a page by its strongest relation to the note: the
 * note links to it, then it links to the note, then it shares one of the
 * note's links (earlier links in the note rank higher). Each relation adds a
 * small bonus, and ties go to the most recently modified page.
 */

export const LARGE_GROUP_SIZE = 100;
const RELATION_STEP = 100;

export interface Headword {
  /** LinkKey of the link target. */
  key: string;
  /** The link as written in the note, without subpath. */
  linkText: string;
  /** Path of the existing note, or null for a missing note. */
  path: string | null;
}

export interface PageInfo {
  title: string;
  mtime: number;
  ctime: number;
  linked: number;
}

export interface RelatedPage extends PageInfo {
  path: string;
  linkTo: boolean;
  linkFrom: boolean;
  score: number;
}

export interface RelatedGroup {
  headword: Headword;
  pages: RelatedPage[];
  /** All pages sharing the link, including those shown elsewhere. */
  size: number;
}

export interface RelatedResult {
  links: RelatedPage[];
  groups: RelatedGroup[];
  newLinks: Headword[];
}

export interface RelatedInput {
  activePath: string;
  headwords: Headword[];
  linkTo: Iterable<string>;
  linkFrom: Iterable<string>;
  sourcesOf: (key: string) => Iterable<string>;
  /** Link keys of a page in its own note order (used by the Related order). */
  orderedKeysOf: (path: string) => readonly string[];
  infoOf: (path: string) => PageInfo;
  isExcluded: (path: string) => boolean;
  sortOrder: SortOrder;
}

export function compareRelatedPages(
  sortOrder: SortOrder
): (a: RelatedPage, b: RelatedPage) => number {
  const byTitle = (a: RelatedPage, b: RelatedPage) =>
    a.title.localeCompare(b.title) || a.path.localeCompare(b.path);
  switch (sortOrder) {
    case "related":
      return (a, b) => b.score - a.score || b.mtime - a.mtime || byTitle(a, b);
    case "modifiedDesc":
      return (a, b) => b.mtime - a.mtime || byTitle(a, b);
    case "createdDesc":
      return (a, b) => b.ctime - a.ctime || byTitle(a, b);
    case "mostLinkedDesc":
      return (a, b) => b.linked - a.linked || byTitle(a, b);
    case "titleAsc":
      return byTitle;
  }
}

export function buildRelatedPages(input: RelatedInput): RelatedResult {
  const { activePath, headwords } = input;
  const isCandidate = (path: string) =>
    path !== activePath && !input.isExcluded(path);

  const linkTo = new Set(Array.from(input.linkTo).filter(isCandidate));
  const linkFrom = new Set(Array.from(input.linkFrom).filter(isCandidate));
  const oneHop = new Set([...linkTo, ...linkFrom]);

  const headwordRank = new Map<string, number>();
  headwords.forEach((headword, index) => {
    if (!headwordRank.has(headword.key)) headwordRank.set(headword.key, index);
  });
  const rankCount = 2 + headwords.length;

  const pages = new Map<string, RelatedPage>();
  const pageOf = (path: string): RelatedPage => {
    let page = pages.get(path);
    if (!page) {
      const isLinkTo = linkTo.has(path);
      const isLinkFrom = linkFrom.has(path);
      page = {
        path,
        ...input.infoOf(path),
        linkTo: isLinkTo,
        linkFrom: isLinkFrom,
        score:
          input.sortOrder === "related"
            ? relatedScore(path, isLinkTo, isLinkFrom)
            : 0,
      };
      pages.set(path, page);
    }
    return page;
  };

  function relatedScore(
    path: string,
    isLinkTo: boolean,
    isLinkFrom: boolean
  ): number {
    let firstRank: number | null = null;
    let relations = 0;
    if (isLinkTo) {
      firstRank ??= 0;
      relations++;
    }
    if (isLinkFrom) {
      firstRank ??= 1;
      relations++;
    }
    const counted = new Set<string>();
    for (const key of input.orderedKeysOf(path)) {
      const rank = headwordRank.get(key);
      if (rank === undefined || counted.has(key)) continue;
      counted.add(key);
      firstRank ??= 2 + rank;
      relations++;
    }
    return firstRank === null
      ? 0
      : (rankCount - firstRank) * RELATION_STEP + relations;
  }

  const compare = compareRelatedPages(input.sortOrder);
  const links = Array.from(oneHop, pageOf).sort(compare);

  const assigned = new Set<string>();
  const groups: RelatedGroup[] = [];
  const groupedKeys = new Set<string>();
  for (const headword of headwords) {
    if (groupedKeys.has(headword.key) || headword.path === activePath) continue;
    groupedKeys.add(headword.key);
    let size = 0;
    const groupPages: RelatedPage[] = [];
    for (const path of input.sourcesOf(headword.key)) {
      if (!isCandidate(path)) continue;
      size++;
      if (oneHop.has(path) || assigned.has(path)) continue;
      assigned.add(path);
      groupPages.push(pageOf(path));
    }
    if (groupPages.length > 0) {
      groups.push({ headword, pages: groupPages.sort(compare), size });
    }
  }

  const regular = groups.filter((group) => group.size <= LARGE_GROUP_SIZE);
  const large = groups
    .filter((group) => group.size > LARGE_GROUP_SIZE)
    .sort((a, b) => a.size - b.size);

  const shownGroupKeys = new Set(groups.map((group) => group.headword.key));
  const seenNewLinks = new Set<string>();
  const newLinks = headwords.filter((headword) => {
    if (headword.path !== null || shownGroupKeys.has(headword.key)) {
      return false;
    }
    if (seenNewLinks.has(headword.key)) return false;
    seenNewLinks.add(headword.key);
    return true;
  });

  return { links, groups: [...regular, ...large], newLinks };
}
