import { App, TFile } from "obsidian";
import { removeBlockReference, shouldExcludePath } from "./utils";

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

export type RankingSortOrder =
  | "relatedScoreDesc"
  | "relatedCosenseLike"
  | "pageRankDesc"
  | "mostLinkedDesc";

export interface GraphIndex {
  paths: string[];
  filesByPath: Map<string, TFile>;
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

interface RankingSettings {
  excludePaths: string[];
}

interface LinkReference {
  link: string;
  position?: {
    start?: {
      offset?: number;
    };
  };
}

const MISSING_OFFSET = 9007199254740991;

export function isRankingSortOrder(
  sortOrder: string
): sortOrder is RankingSortOrder {
  return (
    sortOrder === "relatedScoreDesc" ||
    sortOrder === "relatedCosenseLike" ||
    sortOrder === "pageRankDesc" ||
    sortOrder === "mostLinkedDesc"
  );
}

export function buildGraphIndex(
  app: App,
  settings: RankingSettings
): GraphIndex {
  const markdownFiles = app.vault
    .getMarkdownFiles()
    .filter((file) => !shouldExcludePath(file.path, settings.excludePaths));
  const filesByPath = new Map<string, TFile>();
  const pathSet = new Set<string>();
  const out = new Map<string, Set<string>>();
  const inn = new Map<string, Set<string>>();
  const outOrder = new Map<string, string[]>();
  const orderIndex = new Map<string, Map<string, number>>();

  for (const file of markdownFiles) {
    filesByPath.set(file.path, file);
    pathSet.add(file.path);
    out.set(file.path, new Set<string>());
    inn.set(file.path, new Set<string>());
  }

  const resolvedLinks: Record<string, Record<string, number>> =
    app.metadataCache.resolvedLinks;
  for (const source of Object.keys(resolvedLinks)) {
    if (!pathSet.has(source)) continue;

    for (const dest of Object.keys(resolvedLinks[source])) {
      if (!pathSet.has(dest)) continue;
      if (shouldExcludePath(dest, settings.excludePaths)) continue;

      out.get(source)?.add(dest);
      inn.get(dest)?.add(source);
    }
  }

  for (const file of markdownFiles) {
    const orderedPaths = getOutgoingPathsInDocumentOrder(app, file, pathSet);
    const seen = new Set<string>(orderedPaths);

    for (const path of out.get(file.path) ?? []) {
      if (!seen.has(path)) {
        orderedPaths.push(path);
        seen.add(path);
      }
    }

    outOrder.set(file.path, orderedPaths);
    orderIndex.set(file.path, buildOrderIndex(orderedPaths));
  }

  const paths = Array.from(pathSet);
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  for (const path of paths) {
    inDegree.set(path, inn.get(path)?.size ?? 0);
    outDegree.set(path, out.get(path)?.size ?? 0);
  }

  const pageRank = calculateCosensePageRankLikeScores(
    paths,
    filesByPath,
    inn,
    inDegree,
    outDegree
  );

  return {
    paths,
    filesByPath,
    out,
    in: inn,
    outOrder,
    orderIndex,
    inDegree,
    outDegree,
    pageRank,
  };
}

export function calculateRelatedScores(
  activePath: string,
  candidatePaths: string[],
  graph: GraphIndex
): Map<string, RelatedCandidateScore> {
  const activeOut = graph.out.get(activePath) ?? new Set<string>();
  const activeOrder = graph.outOrder.get(activePath) ?? Array.from(activeOut);
  const activeOrderIndex =
    graph.orderIndex.get(activePath) ?? buildOrderIndex(activeOrder);
  const uniqueCandidates = Array.from(new Set(candidatePaths)).filter(
    (path) => path !== activePath && graph.filesByPath.has(path)
  );

  const rawSharedIdf = new Map<string, number>();
  const rawSharedCount = new Map<string, number>();
  const rawOrderAffinity = new Map<string, number>();
  const directLinkBonus = new Map<string, number>();
  const sharedLinksByPath = new Map<string, string[]>();
  const bestIntermediateByPath = new Map<string, string | null>();

  for (const candidatePath of uniqueCandidates) {
    const candidateOut = graph.out.get(candidatePath) ?? new Set<string>();
    const sharedLinks = activeOrder.filter((path) => candidateOut.has(path));
    const seenShared = new Set<string>(sharedLinks);

    for (const path of activeOut) {
      if (candidateOut.has(path) && !seenShared.has(path)) {
        sharedLinks.push(path);
        seenShared.add(path);
      }
    }

    let sharedIdf = 0;
    let orderAffinity = 0;
    let bestIntermediate: string | null = null;
    let bestIntermediateWeight = -Infinity;

    for (const sharedPath of sharedLinks) {
      const idf = getIdf(sharedPath, graph);
      const activeIndex = activeOrderIndex.get(sharedPath) ?? activeOrder.length;
      const weighted = idf / (1 + activeIndex);
      sharedIdf += idf;
      orderAffinity += weighted;

      if (weighted > bestIntermediateWeight) {
        bestIntermediateWeight = weighted;
        bestIntermediate = sharedPath;
      }
    }

    rawSharedIdf.set(candidatePath, sharedIdf);
    rawSharedCount.set(candidatePath, Math.log1p(sharedLinks.length));
    rawOrderAffinity.set(candidatePath, orderAffinity);
    directLinkBonus.set(
      candidatePath,
      activeOut.has(candidatePath)
        ? 1
        : candidateOut.has(activePath)
        ? 0.8
        : 0
    );
    sharedLinksByPath.set(candidatePath, sharedLinks);
    bestIntermediateByPath.set(candidatePath, bestIntermediate);
  }

  const normalizedSharedIdf = normalizeByP95(rawSharedIdf);
  const normalizedSharedCount = normalizeByP95(rawSharedCount);
  const normalizedOrderAffinity = normalizeByP95(rawOrderAffinity);
  const scores = new Map<string, RelatedCandidateScore>();

  for (const candidatePath of uniqueCandidates) {
    const relatedScore =
      0.55 * (normalizedSharedIdf.get(candidatePath) ?? 0) +
      0.2 * (normalizedSharedCount.get(candidatePath) ?? 0) +
      0.15 * (normalizedOrderAffinity.get(candidatePath) ?? 0) +
      0.1 * (directLinkBonus.get(candidatePath) ?? 0);

    scores.set(candidatePath, {
      path: candidatePath,
      sharedLinks: sharedLinksByPath.get(candidatePath) ?? [],
      bestIntermediate: bestIntermediateByPath.get(candidatePath) ?? null,
      sharedCount: sharedLinksByPath.get(candidatePath)?.length ?? 0,
      sharedIdf: rawSharedIdf.get(candidatePath) ?? 0,
      orderAffinity: rawOrderAffinity.get(candidatePath) ?? 0,
      directLinkBonus: directLinkBonus.get(candidatePath) ?? 0,
      relatedScore,
      pageRank: graph.pageRank.get(candidatePath) ?? 0,
      inDegree: graph.inDegree.get(candidatePath) ?? 0,
    });
  }

  return scores;
}

export function chooseIntermediateForScore(
  score: RelatedCandidateScore,
  sortOrder: string
): string | null {
  if (sortOrder === "relatedCosenseLike") {
    return score.sharedLinks[0] ?? null;
  }

  return score.bestIntermediate;
}

function getOutgoingPathsInDocumentOrder(
  app: App,
  file: TFile,
  pathSet: Set<string>
): string[] {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return [];

  const bodyReferences: LinkReference[] = [
    ...((cache.links ?? []) as LinkReference[]),
    ...((cache.embeds ?? []) as LinkReference[]),
  ].sort((a, b) => getReferenceOffset(a) - getReferenceOffset(b));
  const frontmatterReferences = ((((cache as any).frontmatterLinks ??
    []) as LinkReference[])
    .slice()
    .sort((a, b) => getReferenceOffset(a) - getReferenceOffset(b)));
  const references = bodyReferences.concat(frontmatterReferences);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const reference of references) {
    const link = removeBlockReference(reference.link);
    const resolved = app.metadataCache.getFirstLinkpathDest(link, file.path);
    if (!resolved || !pathSet.has(resolved.path)) continue;
    if (seen.has(resolved.path)) continue;

    seen.add(resolved.path);
    result.push(resolved.path);
  }

  return result;
}

function calculateCosensePageRankLikeScores(
  paths: string[],
  filesByPath: Map<string, TFile>,
  inn: Map<string, Set<string>>,
  inDegree: Map<string, number>,
  outDegree: Map<string, number>
): Map<string, number> {
  const backlinkValues = new Map<string, number>();
  const backlinkAuthorityValues = new Map<string, number>();
  const outlinkValues = new Map<string, number>();
  const editValues = new Map<string, number>();
  const now = Date.now();

  for (const path of paths) {
    backlinkValues.set(path, Math.log1p(inDegree.get(path) ?? 0));
    outlinkValues.set(path, Math.log1p(outDegree.get(path) ?? 0));

    let backlinkAuthority = 0;
    for (const sourcePath of inn.get(path) ?? []) {
      backlinkAuthority += Math.log1p(inDegree.get(sourcePath) ?? 0);
    }
    backlinkAuthorityValues.set(path, backlinkAuthority);

    const file = filesByPath.get(path);
    const days = file
      ? Math.max(0, (now - file.stat.mtime) / (1000 * 60 * 60 * 24))
      : 365;
    editValues.set(path, Math.exp(-days / 90));
  }

  const normalizedBacklinks = normalizeByP95(backlinkValues);
  const normalizedAuthority = normalizeByP95(backlinkAuthorityValues);
  const normalizedOutlinks = normalizeByP95(outlinkValues);
  const normalizedEdit = normalizeByP95(editValues);
  const scores = new Map<string, number>();

  for (const path of paths) {
    scores.set(
      path,
      0.4 * (normalizedBacklinks.get(path) ?? 0) +
        0.25 * (normalizedAuthority.get(path) ?? 0) +
        0.15 * (normalizedOutlinks.get(path) ?? 0) +
        0.2 * (normalizedEdit.get(path) ?? 0)
    );
  }

  return scores;
}

function normalizeByP95(values: Map<string, number>): Map<string, number> {
  const sorted = Array.from(values.values())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const p95 = sorted.length
    ? sorted[Math.floor((sorted.length - 1) * 0.95)]
    : 0;
  const denom = p95 > 0 ? p95 : 1;
  const result = new Map<string, number>();

  for (const [key, value] of values) {
    result.set(key, Math.min(value / denom, 1));
  }

  return result;
}

function getIdf(path: string, graph: GraphIndex): number {
  const inDegree = graph.inDegree.get(path) ?? 0;
  return Math.log((graph.paths.length + 1) / (inDegree + 1)) + 1;
}

function buildOrderIndex(paths: string[]): Map<string, number> {
  const index = new Map<string, number>();

  paths.forEach((path, i) => index.set(path, i));

  return index;
}

function getReferenceOffset(reference: LinkReference): number {
  return reference.position?.start?.offset ?? MISSING_OFFSET;
}
