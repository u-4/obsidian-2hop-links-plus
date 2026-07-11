import { App, CachedMetadata, normalizePath, TFile } from "obsidian";
import { FileEntity } from "./model/FileEntity";
import {
  filePathToLinkText,
  removeBlockReference,
  shouldExcludePath,
} from "./utils";
import { TwohopLink } from "./model/TwohopLink";
import {
  getSortFunction,
  getSortFunctionForFile,
  getSortedFiles,
  getTagHierarchySortFunction,
  getTwoHopSortFunction,
} from "./sort";
import { PropertiesLinks } from "./model/PropertiesLinks";
import {
  calculateRelatedScores,
  chooseIntermediateForScore,
  GraphIndex,
  isRankingSortOrder,
  prepareGraphOrderForPath,
  RelatedCandidateScore,
} from "./ranking";
import type { TwohopPluginSettings } from "./settings/TwohopSettingTab";
import { getFrontmatterLinks } from "./obsidianCompat";
import type { SortOrder } from "./settings/sortOptions";
import { GraphIndexCache, GraphIndexCacheStats } from "./graphIndexCache";
import {
  CalculationCancelledError,
  isCalculationCancelled,
  MAX_RESULT_CACHE_ENTRIES,
  RESULT_CACHE_TTL_MS,
  throwIfCalculationCancelled,
} from "./performance";

type CanvasFileNode = {
  type: "file";
  file: string;
};

interface CanvasLinkIndex {
  outByCanvas: Map<string, string[]>;
  inByTarget: Map<string, string[]>;
}

export interface GatheredLinks {
  forwardLinks: FileEntity[];
  newLinks: FileEntity[];
  backwardLinks: FileEntity[];
  twoHopLinks: TwohopLink[];
  tagLinksList: PropertiesLinks[];
  frontmatterKeyLinksList: PropertiesLinks[];
}

export interface LinksPerformanceStats extends GraphIndexCacheStats {
  resultComputations: number;
  resultCacheHits: number;
  joinedComputations: number;
  gatherCancellations: number;
  canvasIndexBuilds: number;
  canvasIndexHits: number;
  lastGatherMs: number;
}

interface CachedGatherResult {
  createdAt: number;
  result: GatheredLinks;
}

interface PendingGather {
  key: string;
  controller: AbortController;
  promise: Promise<GatheredLinks>;
}

interface CachedCanvasIndex {
  revision: number;
  index: CanvasLinkIndex;
}

interface PendingCanvasIndex {
  revision: number;
  controller: AbortController;
  promise: Promise<CanvasLinkIndex>;
}

function isCanvasFileNode(value: unknown): value is CanvasFileNode {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const node = value as { type?: unknown; file?: unknown };
  return node.type === "file" && typeof node.file === "string";
}

function parseCanvasFileNodes(canvasContent: string): CanvasFileNode[] {
  let canvasData: unknown;
  try {
    canvasData = JSON.parse(canvasContent);
  } catch (error) {
    console.error("Invalid JSON in canvas:", error);
    return [];
  }

  const nodes = (canvasData as { nodes?: unknown })?.nodes;
  if (nodes == null) {
    return [];
  }
  if (!Array.isArray(nodes)) {
    console.error("Invalid structure in canvas: nodes is not an array");
    return [];
  }
  return nodes.filter(isCanvasFileNode);
}

export class Links {
  app: App;
  settings: TwohopPluginSettings;
  private readonly graphIndexCache: GraphIndexCache;
  private metadataRevision = 0;
  private canvasRevision = 0;
  private resultCache = new Map<string, CachedGatherResult>();
  private pendingGather: PendingGather | null = null;
  private cachedCanvasIndex: CachedCanvasIndex | null = null;
  private pendingCanvasIndex: PendingCanvasIndex | null = null;
  private resultComputations = 0;
  private resultCacheHits = 0;
  private joinedComputations = 0;
  private gatherCancellations = 0;
  private canvasIndexBuilds = 0;
  private canvasIndexHits = 0;
  private lastGatherMs = 0;

  constructor(app: App, settings: TwohopPluginSettings) {
    this.app = app;
    this.settings = settings;
    this.graphIndexCache = new GraphIndexCache(app);
  }

  invalidateMetadataCaches(): void {
    this.metadataRevision++;
    this.graphIndexCache.invalidate();
    this.resultCache.clear();
    this.cancelActiveGather();
  }

  invalidateCanvasCaches(): void {
    this.canvasRevision++;
    this.cachedCanvasIndex = null;
    this.pendingCanvasIndex?.controller.abort();
    this.pendingCanvasIndex = null;
    this.resultCache.clear();
    this.cancelActiveGather();
  }

  cancelPendingCalculations(): void {
    this.cancelActiveGather();
    this.graphIndexCache.cancel();
    this.pendingCanvasIndex?.controller.abort();
    this.pendingCanvasIndex = null;
  }

  cancelActiveGather(): void {
    this.pendingGather?.controller.abort();
    this.pendingGather = null;
  }

  getPerformanceStats(): LinksPerformanceStats {
    return {
      ...this.graphIndexCache.getStats(),
      resultComputations: this.resultComputations,
      resultCacheHits: this.resultCacheHits,
      joinedComputations: this.joinedComputations,
      gatherCancellations: this.gatherCancellations,
      canvasIndexBuilds: this.canvasIndexBuilds,
      canvasIndexHits: this.canvasIndexHits,
      lastGatherMs: this.lastGatherMs,
    };
  }

  resetPerformanceStats(): void {
    this.graphIndexCache.resetStats();
    this.resultComputations = 0;
    this.resultCacheHits = 0;
    this.joinedComputations = 0;
    this.gatherCancellations = 0;
    this.canvasIndexBuilds = 0;
    this.canvasIndexHits = 0;
    this.lastGatherMs = 0;
  }

  private createGatherKey(activeFile: TFile | null): string {
    const settingsKey = JSON.stringify({
      sortOrder: this.settings.sortOrder,
      excludePaths: Array.from(new Set(this.settings.excludePaths)).sort(),
      excludeTags: Array.from(new Set(this.settings.excludeTags)).sort(),
      frontmatterKeys: Array.from(
        new Set(this.settings.frontmatterKeys)
      ).sort(),
      enableDuplicateRemoval: this.settings.enableDuplicateRemoval,
      createFilesForMultiLinked: this.settings.createFilesForMultiLinked,
      showBackwardConnectedLinks: this.settings.showBackwardConnectedLinks,
      showTagsLinks: this.settings.showTagsLinks,
      showPropertiesLinks: this.settings.showPropertiesLinks,
    });
    const fileKey = activeFile
      ? `${activeFile.path}:${activeFile.stat.mtime}:${activeFile.stat.size}`
      : "__all_files__";
    return `${this.metadataRevision}:${this.canvasRevision}:${fileKey}:${settingsKey}`;
  }

  private getCachedGatherResult(key: string): GatheredLinks | null {
    const cached = this.resultCache.get(key);
    if (!cached) {
      return null;
    }
    if (Date.now() - cached.createdAt > RESULT_CACHE_TTL_MS) {
      this.resultCache.delete(key);
      return null;
    }

    this.resultCache.delete(key);
    this.resultCache.set(key, cached);
    return cached.result;
  }

  private cacheGatherResult(key: string, result: GatheredLinks): void {
    this.resultCache.set(key, { createdAt: Date.now(), result });
    while (this.resultCache.size > MAX_RESULT_CACHE_ENTRIES) {
      const oldestKey = this.resultCache.keys().next().value;
      if (typeof oldestKey !== "string") break;
      this.resultCache.delete(oldestKey);
    }
  }

  private async getCanvasLinkIndex(): Promise<CanvasLinkIndex> {
    if (this.cachedCanvasIndex?.revision === this.canvasRevision) {
      this.canvasIndexHits++;
      return this.cachedCanvasIndex.index;
    }
    if (this.pendingCanvasIndex?.revision === this.canvasRevision) {
      this.canvasIndexHits++;
      return this.pendingCanvasIndex.promise;
    }

    this.pendingCanvasIndex?.controller.abort();
    const revision = this.canvasRevision;
    const controller = new AbortController();
    this.canvasIndexBuilds++;

    const promise = (async (): Promise<CanvasLinkIndex> => {
      const outByCanvas = new Map<string, string[]>();
      const inByTargetSets = new Map<string, Set<string>>();
      const canvasFiles = this.app.vault
        .getFiles()
        .filter((file) => file.extension === "canvas");

      for (const canvasFile of canvasFiles) {
        throwIfCalculationCancelled(controller.signal);
        const content = await this.app.vault.read(canvasFile);
        throwIfCalculationCancelled(controller.signal);
        const targets = Array.from(
          new Set(parseCanvasFileNodes(content).map((node) => node.file))
        );
        outByCanvas.set(canvasFile.path, targets);

        for (const target of targets) {
          const canvasPaths = inByTargetSets.get(target) ?? new Set<string>();
          canvasPaths.add(canvasFile.path);
          inByTargetSets.set(target, canvasPaths);
        }
      }

      if (revision !== this.canvasRevision) {
        throw new CalculationCancelledError();
      }

      const inByTarget = new Map<string, string[]>();
      for (const [target, canvasPaths] of inByTargetSets) {
        inByTarget.set(target, Array.from(canvasPaths));
      }
      return { outByCanvas, inByTarget };
    })()
      .then((index) => {
        if (controller.signal.aborted || revision !== this.canvasRevision) {
          throw new CalculationCancelledError();
        }
        this.cachedCanvasIndex = { revision, index };
        return index;
      })
      .finally(() => {
        if (this.pendingCanvasIndex?.promise === promise) {
          this.pendingCanvasIndex = null;
        }
      });

    this.pendingCanvasIndex = { revision, controller, promise };
    return promise;
  }

  private applyRankingFields(
    entity: FileEntity,
    targetPath: string | null | undefined,
    graphIndex?: GraphIndex,
    relatedScores?: Map<string, RelatedCandidateScore>,
    activePath?: string,
    orderPath?: string
  ): FileEntity {
    if (targetPath) {
      entity.targetPath = targetPath;
    }

    if (!targetPath || !graphIndex) {
      return entity;
    }

    const score = relatedScores?.get(targetPath);
    entity.relatedScore = score?.relatedScore ?? entity.relatedScore;
    entity.pageRank =
      score?.pageRank ?? graphIndex.pageRank.get(targetPath) ?? entity.pageRank;
    entity.inDegree =
      score?.inDegree ?? graphIndex.inDegree.get(targetPath) ?? entity.inDegree;
    entity.sharedLinks = score?.sharedLinks ?? entity.sharedLinks;

    if (activePath) {
      const orderIndex = graphIndex.orderIndex.get(activePath);
      const pathForOrder = orderPath ?? targetPath;
      entity.activeLinkOrder = orderIndex?.get(pathForOrder);
    }

    return entity;
  }

  private getSectionScores(
    fileEntities: FileEntity[],
    activeLinkOrder?: number
  ) {
    const topRelatedScores = fileEntities
      .map((entity) => entity.relatedScore ?? 0)
      .sort((a, b) => b - a)
      .slice(0, 5);
    const relatedScore = topRelatedScores.reduce(
      (sum, value) => sum + value,
      0
    );
    const pageRank = Math.max(
      0,
      ...fileEntities.map((entity) => entity.pageRank ?? 0)
    );
    const inDegree = Math.max(
      0,
      ...fileEntities.map((entity) => entity.inDegree ?? 0)
    );

    return {
      relatedScore,
      pageRank,
      inDegree,
      activeLinkOrder,
    };
  }

  private hasKnownEntity(set: Set<string>, path: string): boolean {
    const linkText = filePathToLinkText(path);
    return (
      set.has(removeBlockReference(path)) ||
      set.has(removeBlockReference(linkText))
    );
  }

  private collectTargetPaths(
    forwardLinks: FileEntity[],
    newLinks: FileEntity[],
    backwardLinks: FileEntity[],
    twoHopLinks: TwohopLink[],
    tagLinksList: PropertiesLinks[],
    frontmatterKeyLinksList: PropertiesLinks[]
  ): string[] {
    const paths = new Set<string>();
    const addEntity = (entity: FileEntity) => {
      if (entity.targetPath) paths.add(entity.targetPath);
      if (entity.targetPathToReveal) paths.add(entity.targetPathToReveal);
    };

    [...forwardLinks, ...newLinks, ...backwardLinks].forEach(addEntity);

    for (const twoHopLink of twoHopLinks) {
      addEntity(twoHopLink.link);
      twoHopLink.fileEntities.forEach(addEntity);
    }

    for (const propertiesLinks of [
      ...tagLinksList,
      ...frontmatterKeyLinksList,
    ]) {
      propertiesLinks.fileEntities.forEach(addEntity);
    }

    return Array.from(paths);
  }

  private applyRankingFieldsToCollections(
    activePath: string,
    graphIndex: GraphIndex,
    relatedScores: Map<string, RelatedCandidateScore>,
    forwardLinks: FileEntity[],
    newLinks: FileEntity[],
    backwardLinks: FileEntity[],
    twoHopLinks: TwohopLink[],
    tagLinksList: PropertiesLinks[],
    frontmatterKeyLinksList: PropertiesLinks[]
  ): void {
    const apply = (entity: FileEntity) => {
      this.applyRankingFields(
        entity,
        entity.targetPath,
        graphIndex,
        relatedScores,
        activePath,
        entity.targetPathToReveal ?? entity.targetPath
      );
    };

    [...forwardLinks, ...newLinks, ...backwardLinks].forEach(apply);

    for (const twoHopLink of twoHopLinks) {
      apply(twoHopLink.link);
      twoHopLink.fileEntities.forEach(apply);
    }

    for (const propertiesLinks of [
      ...tagLinksList,
      ...frontmatterKeyLinksList,
    ]) {
      propertiesLinks.fileEntities.forEach(apply);
    }
  }

  private async sortFileEntityCollections(
    forwardLinks: FileEntity[],
    backwardLinks: FileEntity[],
    tagLinksList: PropertiesLinks[],
    frontmatterKeyLinksList: PropertiesLinks[]
  ): Promise<void> {
    const sortEntityPath = (entity: FileEntity) =>
      entity.targetPath ?? entity.sourcePath;

    forwardLinks.splice(
      0,
      forwardLinks.length,
      ...(await this.getSortedFileEntities(
        forwardLinks,
        sortEntityPath,
        this.settings.sortOrder
      ))
    );
    backwardLinks.splice(
      0,
      backwardLinks.length,
      ...(await this.getSortedFileEntities(
        backwardLinks,
        sortEntityPath,
        this.settings.sortOrder
      ))
    );

    for (const propertiesLinks of [
      ...tagLinksList,
      ...frontmatterKeyLinksList,
    ]) {
      propertiesLinks.fileEntities = await this.getSortedFileEntities(
        propertiesLinks.fileEntities,
        sortEntityPath,
        this.settings.sortOrder
      );
    }
  }

  async gatherTwoHopLinks(activeFile: TFile | null): Promise<GatheredLinks> {
    const key = this.createGatherKey(activeFile);
    const shouldCacheResult = this.settings.sortOrder !== "random";
    const cached = shouldCacheResult
      ? this.getCachedGatherResult(key)
      : null;
    if (cached) {
      if (this.pendingGather?.key !== key) {
        this.cancelActiveGather();
      }
      this.resultCacheHits++;
      return cached;
    }

    if (this.pendingGather?.key === key) {
      this.joinedComputations++;
      return this.pendingGather.promise;
    }

    this.cancelActiveGather();
    const controller = new AbortController();
    const startedAt = Date.now();
    this.resultComputations++;

    const promise = this.calculateTwoHopLinks(activeFile, controller.signal)
      .then((result) => {
        throwIfCalculationCancelled(controller.signal);
        this.lastGatherMs = Math.max(0, Date.now() - startedAt);
        if (shouldCacheResult) {
          this.cacheGatherResult(key, result);
        }
        return result;
      })
      .catch((error: unknown) => {
        if (isCalculationCancelled(error)) {
          this.gatherCancellations++;
        }
        throw error;
      })
      .finally(() => {
        if (this.pendingGather?.promise === promise) {
          this.pendingGather = null;
        }
      });

    this.pendingGather = { key, controller, promise };
    return promise;
  }

  private async calculateTwoHopLinks(
    activeFile: TFile | null,
    signal: AbortSignal
  ): Promise<GatheredLinks> {
    let forwardLinks: FileEntity[] = [];
    let newLinks: FileEntity[] = [];
    let backwardLinks: FileEntity[] = [];
    let twoHopLinks: TwohopLink[] = [];
    let tagLinksList: PropertiesLinks[] = [];
    let frontmatterKeyLinksList: PropertiesLinks[] = [];

    if (activeFile) {
      const useRanking =
        activeFile.extension !== "canvas" &&
        isRankingSortOrder(this.settings.sortOrder);
      const graphIndex = useRanking
        ? await this.graphIndexCache.get(
            this.settings.excludePaths,
            this.settings.sortOrder !== "relatedCosenseLike"
          )
        : undefined;
      throwIfCalculationCancelled(signal);
      if (graphIndex) {
        prepareGraphOrderForPath(this.app, graphIndex, activeFile.path);
      }
      const canvasIndex =
        activeFile.extension === "canvas" ||
        this.settings.showBackwardConnectedLinks
          ? await this.getCanvasLinkIndex()
          : undefined;
      throwIfCalculationCancelled(signal);
      const activeFileCache: CachedMetadata | null =
        this.app.metadataCache.getFileCache(activeFile);
      ({ resolved: forwardLinks, new: newLinks } = await this.getForwardLinks(
        activeFile,
        activeFileCache,
        graphIndex,
        undefined,
        canvasIndex
      ));
      throwIfCalculationCancelled(signal);
      const seenLinkSet = new Set<string>(forwardLinks.map((it) => it.key()));
      backwardLinks = await this.getBackLinks(
        activeFile,
        seenLinkSet,
        graphIndex,
        undefined,
        canvasIndex,
        this.settings.showBackwardConnectedLinks
      );
      throwIfCalculationCancelled(signal);
      backwardLinks.forEach((link) => seenLinkSet.add(link.key()));
      const twoHopLinkSet = new Set<string>();
      twoHopLinks = await this.getTwohopLinks(
        activeFile,
        this.app.metadataCache.resolvedLinks,
        seenLinkSet,
        twoHopLinkSet,
        graphIndex,
        undefined,
        canvasIndex
      );
      throwIfCalculationCancelled(signal);

      if (this.settings.showTagsLinks) {
        tagLinksList = await this.getLinksListOfFilesWithTags(
          activeFile,
          activeFileCache,
          seenLinkSet,
          twoHopLinkSet
        );
        throwIfCalculationCancelled(signal);
      }

      if (this.settings.showPropertiesLinks) {
        frontmatterKeyLinksList =
          await this.getLinksListOfFilesWithFrontmatterKeys(
            activeFile,
            activeFileCache,
            seenLinkSet,
            twoHopLinkSet
          );
        throwIfCalculationCancelled(signal);
      }

      if (graphIndex) {
        const relatedScores = calculateRelatedScores(
          activeFile.path,
          this.collectTargetPaths(
            forwardLinks,
            newLinks,
            backwardLinks,
            twoHopLinks,
            tagLinksList,
            frontmatterKeyLinksList
          ),
          graphIndex
        );
        this.applyRankingFieldsToCollections(
          activeFile.path,
          graphIndex,
          relatedScores,
          forwardLinks,
          newLinks,
          backwardLinks,
          twoHopLinks,
          tagLinksList,
          frontmatterKeyLinksList
        );
        await this.sortFileEntityCollections(
          forwardLinks,
          backwardLinks,
          tagLinksList,
          frontmatterKeyLinksList
        );
        throwIfCalculationCancelled(signal);
      }
    } else {
      const allMarkdownFiles = this.app.vault
        .getMarkdownFiles()
        .filter(
          (file: { path: string }) =>
            !shouldExcludePath(file.path, this.settings.excludePaths)
        );

      const sortedFiles = await getSortedFiles(
        allMarkdownFiles,
        getSortFunctionForFile(this.settings.sortOrder)
      );

      forwardLinks = sortedFiles.map((file) => new FileEntity("", file.path));
    }

    throwIfCalculationCancelled(signal);
    return {
      forwardLinks,
      newLinks,
      backwardLinks,
      twoHopLinks,
      tagLinksList,
      frontmatterKeyLinksList,
    };
  }

  async getForwardLinks(
    activeFile: TFile,
    activeFileCache: CachedMetadata | null,
    graphIndex?: GraphIndex,
    relatedScores?: Map<string, RelatedCandidateScore>,
    canvasIndex?: CanvasLinkIndex
  ): Promise<{ resolved: FileEntity[]; new: FileEntity[] }> {
    const resolvedLinks: FileEntity[] = [];
    const newLinks: FileEntity[] = [];

    if (
      activeFileCache != null &&
      (activeFileCache.links != null ||
        activeFileCache.embeds != null ||
        getFrontmatterLinks(activeFileCache).length > 0)
    ) {
      const seen = new Set<string>();
      const linkEntities = [
        ...(activeFileCache.links || []),
        ...(activeFileCache.embeds || []),
        ...getFrontmatterLinks(activeFileCache),
      ];

      for (const it of linkEntities) {
        const key = removeBlockReference(it.link);
        if (!seen.has(key)) {
          seen.add(key);
          const targetFile = this.app.metadataCache.getFirstLinkpathDest(
            key,
            activeFile.path
          );

          if (
            targetFile &&
            shouldExcludePath(targetFile.path, this.settings.excludePaths)
          ) {
            continue;
          }

          if (targetFile) {
            resolvedLinks.push(
              this.applyRankingFields(
                new FileEntity(
                  targetFile.path,
                  key,
                  undefined,
                  targetFile.path
                ),
                targetFile.path,
                graphIndex,
                relatedScores,
                activeFile.path,
                targetFile.path
              )
            );
          } else {
            const backlinksCount = await this.getBacklinksCount(
              key,
              activeFile.path
            );
            if (
              1 <= backlinksCount &&
              this.settings.createFilesForMultiLinked
            ) {
              await this.app.vault.create(
                normalizePath(`${activeFile.parent?.path ?? ""}/${key}.md`),
                ""
              );
              resolvedLinks.push(new FileEntity(activeFile.path, key));
            } else {
              newLinks.push(new FileEntity(activeFile.path, key));
            }
          }
        }
      }
    } else if (activeFile.extension === "canvas") {
      const indexedTargets = canvasIndex?.outByCanvas.get(activeFile.path);
      const canvasTargets =
        indexedTargets ??
        parseCanvasFileNodes(await this.app.vault.read(activeFile)).map(
          (node) => node.file
        );

      const seen = new Set<string>();
      for (const key of canvasTargets) {
        if (!seen.has(key)) {
          seen.add(key);
          const targetFile = this.app.vault.getAbstractFileByPath(key);
          if (
            targetFile &&
            !shouldExcludePath(targetFile.path, this.settings.excludePaths)
          ) {
            resolvedLinks.push(
              this.applyRankingFields(
                new FileEntity(
                  targetFile.path,
                  key,
                  undefined,
                  targetFile.path
                ),
                targetFile.path,
                graphIndex,
                relatedScores,
                activeFile.path,
                targetFile.path
              )
            );
          } else {
            newLinks.push(new FileEntity(activeFile.path, key));
          }
        }
      }
    }

    const sortedResolvedLinks = await this.getSortedFileEntities(
      resolvedLinks,
      (entity) => entity.sourcePath,
      this.settings.sortOrder
    );
    return {
      resolved: sortedResolvedLinks,
      new: newLinks,
    };
  }

  async getBacklinksCount(file: string, excludeFile?: string): Promise<number> {
    const unresolvedLinks: Record<string, Record<string, number>> = this.app
      .metadataCache.unresolvedLinks;
    let backlinkCount = 0;

    for (const src of Object.keys(unresolvedLinks)) {
      if (excludeFile && src === excludeFile) {
        continue;
      }
      for (let dest of Object.keys(unresolvedLinks[src])) {
        dest = removeBlockReference(dest);
        if (dest === file) {
          backlinkCount++;
        }
      }
    }
    return backlinkCount;
  }

  async getBackLinks(
    activeFile: TFile,
    forwardLinkSet: Set<string>,
    graphIndex?: GraphIndex,
    relatedScores?: Map<string, RelatedCandidateScore>,
    canvasIndex?: CanvasLinkIndex,
    includeCanvasBacklinks = true
  ): Promise<FileEntity[]> {
    const name = activeFile.path;
    const backLinkEntities: FileEntity[] = [];
    const addMarkdownBacklink = (src: string): void => {
      if (shouldExcludePath(src, this.settings.excludePaths)) {
        return;
      }
      if (
        this.settings.enableDuplicateRemoval &&
        this.hasKnownEntity(forwardLinkSet, src)
      ) {
        return;
      }
      const linkText = filePathToLinkText(src);
      backLinkEntities.push(
        this.applyRankingFields(
          new FileEntity(src, linkText, activeFile.path, src),
          src,
          graphIndex,
          relatedScores,
          activeFile.path,
          src
        )
      );
    };

    if (graphIndex) {
      for (const src of graphIndex.in.get(name) ?? []) {
        addMarkdownBacklink(src);
      }
    } else {
      const resolvedLinks: Record<string, Record<string, number>> = this.app
        .metadataCache.resolvedLinks;
      for (const src of Object.keys(resolvedLinks)) {
        if (Object.prototype.hasOwnProperty.call(resolvedLinks[src], name)) {
          addMarkdownBacklink(src);
        }
      }
    }

    if (includeCanvasBacklinks) {
      const resolvedCanvasIndex =
        canvasIndex ?? (await this.getCanvasLinkIndex());
      for (const canvasPath of resolvedCanvasIndex.inByTarget.get(name) ?? []) {
        const linkText = filePathToLinkText(canvasPath);
        if (!this.hasKnownEntity(forwardLinkSet, canvasPath)) {
          backLinkEntities.push(
            this.applyRankingFields(
              new FileEntity(
                canvasPath,
                linkText,
                activeFile.path,
                canvasPath
              ),
              canvasPath,
              graphIndex,
              relatedScores,
              activeFile.path,
              canvasPath
            )
          );
        }
      }
    }

    return await this.getSortedFileEntities(
      backLinkEntities,
      (entity) => entity.sourcePath,
      this.settings.sortOrder
    );
  }

  async getTwohopLinks(
    activeFile: TFile,
    links: Record<string, Record<string, number>>,
    forwardLinkSet: Set<string>,
    twoHopLinkSet: Set<string>,
    graphIndex?: GraphIndex,
    relatedScores?: Map<string, RelatedCandidateScore>,
    canvasIndex?: CanvasLinkIndex
  ): Promise<TwohopLink[]> {
    if (graphIndex && isRankingSortOrder(this.settings.sortOrder)) {
      return this.getRankedTwohopLinks(
        activeFile,
        forwardLinkSet,
        twoHopLinkSet,
        graphIndex
      );
    }

    const twoHopLinks: Record<string, FileEntity[]> = {};
    const twohopLinkList = await this.aggregate2hopLinks(
      activeFile,
      links,
      canvasIndex
    );

    if (twohopLinkList == null) {
      return [];
    }

    const seenLinks = new Set<string>();

    if (twohopLinkList) {
      for (const k of Object.keys(twohopLinkList)) {
        if (twohopLinkList[k].length > 0) {
          twoHopLinks[k] = twohopLinkList[k]
            .filter((it) => !shouldExcludePath(it, this.settings.excludePaths))
            .map((it) => {
              const linkText = filePathToLinkText(it);
              if (
                this.settings.enableDuplicateRemoval &&
                (this.hasKnownEntity(forwardLinkSet, it) || seenLinks.has(it))
              ) {
                return null;
              }
              seenLinks.add(it);
              twoHopLinkSet.add(it);
              return this.applyRankingFields(
                new FileEntity(activeFile.path, linkText, k, it, k),
                it,
                graphIndex,
                relatedScores,
                activeFile.path,
                k
              );
            })
            .filter((it): it is FileEntity => it !== null);
        }
      }
    }

    let linkKeys: string[] = [];
    if (activeFile.extension === "canvas") {
      linkKeys =
        canvasIndex?.outByCanvas.get(activeFile.path) ??
        parseCanvasFileNodes(await this.app.vault.read(activeFile)).map(
          (node) => node.file
        );
    } else if (links[activeFile.path]) {
      linkKeys = Object.keys(links[activeFile.path]);
    }

    const twoHopLinkEntities = (
      await Promise.all(
        linkKeys
          .filter(
            (path) => !shouldExcludePath(path, this.settings.excludePaths)
          )
          .map(async (path) => {
            if (twoHopLinks[path]) {
              const sortedFileEntities = await this.getSortedFileEntities(
                twoHopLinks[path],
                (entity) => {
                  const file = this.app.metadataCache.getFirstLinkpathDest(
                    entity.linkText,
                    entity.sourcePath
                  );
                  return file ? file.path : null;
                },
                this.settings.sortOrder
              );

              return {
                link: this.applyRankingFields(
                  new FileEntity(activeFile.path, path, undefined, path),
                  path,
                  graphIndex,
                  relatedScores,
                  activeFile.path,
                  path
                ),
                fileEntities: sortedFileEntities,
              };
            }
            return null;
          })
      )
    ).filter(
      (
        it
      ): it is {
        link: FileEntity;
        fileEntities: FileEntity[];
      } => it !== null
    );

    const twoHopLinkStatsPromises = twoHopLinkEntities.map(
      async (twoHopLinkEntity) => {
        const stat = await this.app.vault.adapter.stat(
          twoHopLinkEntity.link.linkText
        );
        return { twoHopLinkEntity, stat };
      }
    );

    const twoHopLinkStats = (await Promise.all(twoHopLinkStatsPromises)).filter(
      (it): it is typeof it & { stat: NonNullable<typeof it.stat> } =>
        Boolean(it.stat)
    );

    const twoHopSortFunction = getTwoHopSortFunction(this.settings.sortOrder);
    twoHopLinkStats.sort(twoHopSortFunction);

    return twoHopLinkStats
      .map(
        (it) =>
          new TwohopLink(
            it.twoHopLinkEntity.link,
            it.twoHopLinkEntity.fileEntities
          )
      )
      .filter((it) => it.fileEntities.length > 0);
  }

  async getRankedTwohopLinks(
    activeFile: TFile,
    forwardLinkSet: Set<string>,
    twoHopLinkSet: Set<string>,
    graphIndex: GraphIndex
  ): Promise<TwohopLink[]> {
    const activeOut = graphIndex.out.get(activeFile.path) ?? new Set<string>();
    const candidatePaths: string[] = [];

    for (const intermediatePath of activeOut) {
      if (shouldExcludePath(intermediatePath, this.settings.excludePaths)) {
        continue;
      }

      for (const candidatePath of graphIndex.in.get(intermediatePath) ?? []) {
        if (candidatePath === activeFile.path) continue;
        if (shouldExcludePath(candidatePath, this.settings.excludePaths)) {
          continue;
        }
        candidatePaths.push(candidatePath);
      }
    }

    const uniqueCandidatePaths = Array.from(new Set(candidatePaths));
    const relatedScores = calculateRelatedScores(
      activeFile.path,
      uniqueCandidatePaths,
      graphIndex
    );
    const groupedEntities = new Map<string, FileEntity[]>();
    const seenCandidatePaths = new Set<string>();

    for (const candidatePath of uniqueCandidatePaths) {
      const score = relatedScores.get(candidatePath);
      if (!score || score.sharedLinks.length === 0) continue;

      const linkText = filePathToLinkText(candidatePath);

      if (
        this.settings.enableDuplicateRemoval &&
        (this.hasKnownEntity(forwardLinkSet, candidatePath) ||
          seenCandidatePaths.has(candidatePath))
      ) {
        continue;
      }

      const sectionPaths = this.settings.enableDuplicateRemoval
        ? [chooseIntermediateForScore(score, this.settings.sortOrder)]
        : score.sharedLinks;

      for (const sectionPath of sectionPaths) {
        if (!sectionPath) continue;

        const entity = this.applyRankingFields(
          new FileEntity(
            activeFile.path,
            linkText,
            sectionPath,
            candidatePath,
            sectionPath
          ),
          candidatePath,
          graphIndex,
          relatedScores,
          activeFile.path,
          sectionPath
        );

        const sectionEntities = groupedEntities.get(sectionPath) ?? [];
        sectionEntities.push(entity);
        groupedEntities.set(sectionPath, sectionEntities);
      }

      seenCandidatePaths.add(candidatePath);
      twoHopLinkSet.add(candidatePath);
    }

    const twoHopLinks: TwohopLink[] = [];

    for (const [sectionPath, fileEntities] of groupedEntities) {
      const sortedFileEntities = await this.getSortedFileEntities(
        fileEntities,
        (entity) => entity.targetPath ?? entity.sourcePath,
        this.settings.sortOrder
      );
      const activeLinkOrder =
        graphIndex.orderIndex.get(activeFile.path)?.get(sectionPath) ??
        Number.MAX_SAFE_INTEGER;
      const link = this.applyRankingFields(
        new FileEntity(activeFile.path, sectionPath, undefined, sectionPath),
        sectionPath,
        graphIndex,
        relatedScores,
        activeFile.path,
        sectionPath
      );
      const scores = this.getSectionScores(sortedFileEntities, activeLinkOrder);

      twoHopLinks.push(new TwohopLink(link, sortedFileEntities, scores));
    }

    const twoHopLinkStats = twoHopLinks.map((twoHopLinkEntity) => {
      const file = graphIndex.filesByPath.get(
        twoHopLinkEntity.link.targetPath ?? twoHopLinkEntity.link.linkText
      );
      return { twoHopLinkEntity, stat: file?.stat };
    });
    const twoHopSortFunction = getTwoHopSortFunction(this.settings.sortOrder);
    twoHopLinkStats.sort(twoHopSortFunction);

    return twoHopLinkStats
      .map((it) => it.twoHopLinkEntity)
      .filter((it) => it.fileEntities.length > 0);
  }

  async aggregate2hopLinks(
    activeFile: TFile,
    links: Record<string, Record<string, number>>,
    canvasIndex?: CanvasLinkIndex
  ): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};

    let activeFileLinks = new Set<string>();

    if (links && activeFile && activeFile.path && links[activeFile.path]) {
      activeFileLinks = new Set(Object.keys(links[activeFile.path]));
    }

    if (activeFile.extension === "canvas") {
      const targets =
        canvasIndex?.outByCanvas.get(activeFile.path) ??
        parseCanvasFileNodes(await this.app.vault.read(activeFile)).map(
          (node) => node.file
        );
      for (const target of targets) {
        activeFileLinks.add(target);
      }
    }

    if (links) {
      for (const src of Object.keys(links)) {
        if (src == activeFile.path) {
          continue;
        }
        const link = links[src];
        if (link) {
          for (const dest of Object.keys(link)) {
            if (activeFileLinks.has(dest)) {
              if (!result[dest]) {
                result[dest] = [];
              }
              result[dest].push(src);
            }
          }
        }
      }
    }
    return result;
  }

  async getLinksListOfFilesWithTags(
    activeFile: TFile,
    activeFileCache: CachedMetadata | null | undefined,
    forwardLinkSet: Set<string>,
    twoHopLinkSet: Set<string>
  ): Promise<PropertiesLinks[]> {
    const activeFileTags = this.getTagsFromCache(
      activeFileCache,
      this.settings.excludeTags
    );
    if (activeFileTags.length === 0) return [];

    const activeFileTagSet = new Set(activeFileTags);
    const tagMap: Record<string, FileEntity[]> = {};
    const seen: Record<string, boolean> = {};

    const markdownFiles = this.app.vault
      .getMarkdownFiles()
      .filter(
        (markdownFile: TFile) =>
          markdownFile !== activeFile &&
          !shouldExcludePath(markdownFile.path, this.settings.excludePaths)
      );

    for (const markdownFile of markdownFiles) {
      const cachedMetadata = this.app.metadataCache.getFileCache(markdownFile);
      if (!cachedMetadata) continue;

      const fileTags = this.getTagsFromCache(
        cachedMetadata,
        this.settings.excludeTags
      );

      for (const tag of fileTags) {
        if (!activeFileTagSet.has(tag)) continue;

        tagMap[tag] = tagMap[tag] ?? [];

        if (
          this.settings.enableDuplicateRemoval &&
          (seen[markdownFile.path] ||
            this.hasKnownEntity(forwardLinkSet, markdownFile.path) ||
            this.hasKnownEntity(twoHopLinkSet, markdownFile.path))
        )
          continue;

        const linkText = filePathToLinkText(markdownFile.path);
        const newFileEntity = new FileEntity(
          activeFile.path,
          linkText,
          undefined,
          markdownFile.path
        );

        if (
          !tagMap[tag].some(
            (existingEntity) => existingEntity.key() === newFileEntity.key()
          )
        ) {
          tagMap[tag].push(newFileEntity);
        }
      }
    }

    const tagLinksEntities = await this.createPropertiesLinkEntities(
      this.settings,
      tagMap,
      "tags"
    );

    const sortFunction = getTagHierarchySortFunction(this.settings.sortOrder);
    return tagLinksEntities.sort(sortFunction);
  }

  async getLinksListOfFilesWithFrontmatterKeys(
    activeFile: TFile,
    activeFileCache: CachedMetadata | null | undefined,
    forwardLinkSet: Set<string>,
    twoHopLinkSet: Set<string>
  ): Promise<PropertiesLinks[]> {
    if (this.settings.frontmatterKeys.length === 0) return [];

    const activeFileFrontmatter = activeFileCache?.frontmatter;
    if (!activeFileFrontmatter) return [];

    const frontmatterKeyMap: Record<string, Record<string, FileEntity[]>> = {};
    const seen: Record<string, boolean> = {};

    const markdownFiles = this.app.vault
      .getMarkdownFiles()
      .filter(
        (markdownFile: TFile) =>
          markdownFile !== activeFile &&
          !shouldExcludePath(markdownFile.path, this.settings.excludePaths)
      );

    for (const markdownFile of markdownFiles) {
      const cachedMetadata = this.app.metadataCache.getFileCache(markdownFile);
      if (!cachedMetadata) continue;

      const fileFrontmatter = cachedMetadata.frontmatter;
      if (!fileFrontmatter) continue;

      for (const [key, value] of Object.entries(fileFrontmatter)) {
        if (!this.settings.frontmatterKeys.includes(key)) continue;

        const values: string[] = [];
        const activeValues: string[] = [];

        if (typeof value === "string") {
          values.push(value);
        } else if (Array.isArray(value)) {
          values.push(...value);
        } else {
          continue;
        }

        if (activeFileFrontmatter[key]) {
          if (typeof activeFileFrontmatter[key] === "string") {
            activeValues.push(activeFileFrontmatter[key]);
          } else if (Array.isArray(activeFileFrontmatter[key])) {
            activeValues.push(...activeFileFrontmatter[key]);
          } else {
            continue;
          }
        } else {
          continue;
        }

        for (const activeValue of activeValues) {
          const activeValueHierarchy = activeValue.split("/");
          for (let i = activeValueHierarchy.length - 1; i >= 0; i--) {
            const hierarchicalActiveValue = activeValueHierarchy
              .slice(0, i + 1)
              .join("/");

            for (const value of values) {
              if (typeof value !== "string") {
                continue;
              }
              const valueHierarchy = value.split("/");
              const hierarchicalValue = valueHierarchy
                .slice(0, i + 1)
                .join("/");

              if (hierarchicalActiveValue !== hierarchicalValue) continue;

              frontmatterKeyMap[key] = frontmatterKeyMap[key] ?? {};
              frontmatterKeyMap[key][hierarchicalValue] =
                frontmatterKeyMap[key][hierarchicalValue] ?? [];

              if (
                this.settings.enableDuplicateRemoval &&
                (seen[markdownFile.path] ||
                  this.hasKnownEntity(forwardLinkSet, markdownFile.path) ||
                  this.hasKnownEntity(twoHopLinkSet, markdownFile.path))
              ) {
                continue;
              }

              const linkText = filePathToLinkText(markdownFile.path);
              frontmatterKeyMap[key][hierarchicalValue].push(
                new FileEntity(
                  activeFile.path,
                  linkText,
                  undefined,
                  markdownFile.path
                )
              );
              seen[markdownFile.path] = true;
            }
          }
        }
      }
    }

    const frontmatterKeyLinksEntities: PropertiesLinks[] = [];

    for (const [key, valueMap] of Object.entries(frontmatterKeyMap)) {
      const propertiesLinksEntities = await this.createPropertiesLinkEntities(
        this.settings,
        valueMap,
        key
      );

      frontmatterKeyLinksEntities.push(...propertiesLinksEntities);
    }

    const sortFunction = getTagHierarchySortFunction(this.settings.sortOrder);
    return frontmatterKeyLinksEntities.sort(sortFunction);
  }

  async createPropertiesLinkEntities(
    settings: TwohopPluginSettings,
    propertiesMap: Record<string, FileEntity[]>,
    key = ""
  ): Promise<PropertiesLinks[]> {
    const propertiesLinksEntitiesPromises = Object.entries(propertiesMap).map(
      async ([property, entities]) => {
        const sortedEntities = await this.getSortedFileEntities(
          entities,
          (entity) => entity.targetPath ?? entity.sourcePath,
          settings.sortOrder
        );
        if (sortedEntities.length === 0) {
          return null;
        }
        return new PropertiesLinks(property, key, sortedEntities);
      }
    );

    const propertiesLinksEntities = await Promise.all(
      propertiesLinksEntitiesPromises
    );
    return propertiesLinksEntities.filter(
      (it): it is PropertiesLinks => it !== null
    );
  }

  getTagsFromCache(
    cache: CachedMetadata | null | undefined,
    excludeTags: string[]
  ): string[] {
    const tags: string[] = [];
    if (cache) {
      if (cache.tags) {
        cache.tags.forEach((it) => {
          const tagHierarchy = it.tag.replace("#", "").split("/");
          for (let i = 0; i < tagHierarchy.length; i++) {
            tags.push(tagHierarchy.slice(0, i + 1).join("/"));
          }
        });
      }

      if (cache.frontmatter?.tags) {
        if (Array.isArray(cache.frontmatter.tags)) {
          cache.frontmatter.tags.forEach((tag) => {
            if (typeof tag === "string") {
              const tagHierarchy = tag.split("/");
              for (let i = 0; i < tagHierarchy.length; i++) {
                tags.push(tagHierarchy.slice(0, i + 1).join("/"));
              }
            }
          });
        } else if (typeof cache.frontmatter.tags === "string") {
          cache.frontmatter.tags
            .split(",")
            .map((tag) => tag.trim())
            .forEach((tag) => {
              const tagHierarchy = tag.split("/");
              for (let i = 0; i < tagHierarchy.length; i++) {
                tags.push(tagHierarchy.slice(0, i + 1).join("/"));
              }
            });
        }
      }
    }

    return tags.filter((tag) => {
      for (const excludeTag of excludeTags) {
        if (
          excludeTag.endsWith("/") &&
          (tag === excludeTag.slice(0, -1) || tag.startsWith(excludeTag))
        ) {
          return false;
        }
        if (!excludeTag.endsWith("/") && tag === excludeTag) {
          return false;
        }
      }
      return true;
    });
  }

  async getSortedFileEntities(
    entities: FileEntity[],
    sourcePathFn: (entity: FileEntity) => string | null,
    sortOrder: SortOrder
  ): Promise<FileEntity[]> {
    const needsFileStats =
      sortOrder !== "random" &&
      sortOrder !== "filenameAsc" &&
      sortOrder !== "filenameDesc";
    const statsPromises = entities.map(async (entity) => {
      const sourcePath = sourcePathFn(entity);
      const abstractFile = sourcePath
        ? this.app.vault.getAbstractFileByPath(sourcePath)
        : null;
      const stat = !needsFileStats
        ? null
        : abstractFile instanceof TFile
        ? abstractFile.stat
        : sourcePath
        ? await this.app.vault.adapter.stat(sourcePath)
        : null;
      return { entity, stat };
    });

    const stats = await Promise.all(statsPromises);

    const sortFunction = getSortFunction(sortOrder);
    stats.sort(sortFunction);

    return stats.map((it) => it.entity);
  }
}
