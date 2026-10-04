import { App, TFile } from "obsidian";
import { FileEntity } from "./model/FileEntity";
import { TwohopLink } from "./model/TwohopLink";
import { PropertiesLinks } from "./model/PropertiesLinks";
import {
  filePathToLinkText,
  removeBlockReference,
  shouldExcludePath,
} from "./utils";
import type { TwohopPluginSettings } from "./settings/TwohopSettingTab";
import {
  buildRelatedPages,
  compareRelatedPages,
  Headword,
  PageInfo,
  RelatedPage,
} from "./cosenseRelated";
import {
  fileLinkKey,
  LinkIndex,
  LinkIndexStats,
  unresolvedLinkKey,
} from "./linkIndex";
import {
  CalculationCancelledError,
  isCalculationCancelled,
  MAX_RESULT_CACHE_ENTRIES,
  RESULT_CACHE_TTL_MS,
  throwIfCalculationCancelled,
} from "./performance";

export interface GatheredLinks {
  /** Pages the note links to, then pages linking to it (Cosense "Links"). */
  links: FileEntity[];
  newLinks: FileEntity[];
  twoHopLinks: TwohopLink[];
  tagLinksList: PropertiesLinks[];
}

export interface LinksPerformanceStats extends LinkIndexStats {
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

type CanvasFileNode = {
  type: "file";
  file: string;
};

interface CanvasLinkIndex {
  outByCanvas: Map<string, string[]>;
  inByTarget: Map<string, string[]>;
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
  private readonly linkIndex: LinkIndex;
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
    this.linkIndex = new LinkIndex(app);
  }

  /** Obsidian re-resolved this note's links. */
  markLinksDirty(path: string): void {
    this.linkIndex.markDirty(path);
  }

  /** Notes were created, deleted or renamed. */
  markAllLinksDirty(): void {
    this.linkIndex.markAllDirty();
  }

  /**
   * Drops results built from older metadata. A change unrelated to the shown
   * note keeps the gather in progress, whose result stays valid for display.
   */
  invalidateMetadataCaches(cancelActiveGather = true): void {
    this.metadataRevision++;
    this.resultCache.clear();
    if (cancelActiveGather) {
      this.cancelActiveGather();
    }
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
    this.pendingCanvasIndex?.controller.abort();
    this.pendingCanvasIndex = null;
  }

  cancelActiveGather(): void {
    this.pendingGather?.controller.abort();
    this.pendingGather = null;
  }

  getPerformanceStats(): LinksPerformanceStats {
    return {
      ...this.linkIndex.getStats(),
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
    this.linkIndex.resetStats();
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
      enableDuplicateRemoval: this.settings.enableDuplicateRemoval,
      showBackwardConnectedLinks: this.settings.showBackwardConnectedLinks,
      showTagsLinks: this.settings.showTagsLinks,
    });
    // Metadata changes that affect links bump metadataRevision, so text-only
    // edits of the active note keep its cached result.
    const fileKey = activeFile ? activeFile.path : "";
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

  async gatherTwoHopLinks(activeFile: TFile | null): Promise<GatheredLinks> {
    const key = this.createGatherKey(activeFile);
    const cached = this.getCachedGatherResult(key);
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
        this.cacheGatherResult(key, result);
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
    if (!activeFile) {
      return { links: [], newLinks: [], twoHopLinks: [], tagLinksList: [] };
    }

    const isCanvas = activeFile.extension === "canvas";
    const canvasIndex =
      isCanvas || this.settings.showBackwardConnectedLinks
        ? await this.getCanvasLinkIndex()
        : undefined;
    throwIfCalculationCancelled(signal);

    const headwords = isCanvas
      ? this.getCanvasHeadwords(activeFile, canvasIndex)
      : this.getHeadwords(activeFile);
    const linkFrom = new Set<string>();
    if (this.settings.showBackwardConnectedLinks) {
      for (const path of this.linkIndex.sourcesOf(fileLinkKey(activeFile.path))) {
        linkFrom.add(path);
      }
      for (const path of canvasIndex?.inByTarget.get(activeFile.path) ?? []) {
        linkFrom.add(path);
      }
    }

    const result = buildRelatedPages({
      activePath: activeFile.path,
      headwords,
      linkTo: headwords
        .map((headword) => headword.path)
        .filter((path): path is string => path !== null),
      linkFrom,
      sourcesOf: (key) => this.linkIndex.sourcesOf(key),
      orderedKeysOf: (path) => {
        const file = this.getFile(path);
        return file && file.extension === "md"
          ? this.linkIndex.orderedKeysOf(file)
          : [];
      },
      infoOf: (path) => this.getPageInfo(path),
      isExcluded: (path) => shouldExcludePath(path, this.settings.excludePaths),
      sortOrder: this.settings.sortOrder,
    });
    throwIfCalculationCancelled(signal);

    const links = this.toLinkEntities(activeFile, headwords, result.links);

    const twoHopLinks = result.groups.map((group) => {
      const { headword } = group;
      const header = headword.path
        ? new FileEntity(activeFile.path, headword.path, undefined, headword.path)
        : new FileEntity(activeFile.path, headword.linkText);
      return new TwohopLink(
        header,
        group.pages.map(
          (page) =>
            new FileEntity(
              activeFile.path,
              filePathToLinkText(page.path),
              headword.path ?? headword.linkText,
              page.path,
              headword.path ?? undefined
            )
        )
      );
    });

    const newLinks = result.newLinks.map(
      (headword) => new FileEntity(activeFile.path, headword.linkText)
    );

    const shownPaths = new Set<string>(result.links.map((page) => page.path));
    for (const group of result.groups) {
      for (const page of group.pages) shownPaths.add(page.path);
    }
    const tagLinksList = this.settings.showTagsLinks
      ? this.getTagLinks(activeFile, shownPaths)
      : [];

    throwIfCalculationCancelled(signal);
    return { links, newLinks, twoHopLinks, tagLinksList };
  }

  /**
   * The Links of a hovered note for its popup, without the note that is open.
   * Uses the link index and any Canvas index already built; it never starts or
   * cancels a gather, so the open note's view is not disturbed.
   */
  getHoverLinks(file: TFile, excludePath: string, limit = 10): FileEntity[] {
    const headwords = this.getHeadwords(file);
    const linkFrom = new Set<string>(
      this.linkIndex.sourcesOf(fileLinkKey(file.path))
    );
    for (const path of this.cachedCanvasIndex?.index.inByTarget.get(file.path) ??
      []) {
      linkFrom.add(path);
    }
    const result = buildRelatedPages({
      activePath: file.path,
      headwords,
      linkTo: headwords
        .map((headword) => headword.path)
        .filter((path): path is string => path !== null),
      linkFrom,
      sourcesOf: () => [],
      orderedKeysOf: (path) => {
        const target = this.getFile(path);
        return target && target.extension === "md"
          ? this.linkIndex.orderedKeysOf(target)
          : [];
      },
      infoOf: (path) => this.getPageInfo(path),
      isExcluded: (path) =>
        path === excludePath ||
        shouldExcludePath(path, this.settings.excludePaths),
      sortOrder: this.settings.sortOrder,
    });
    return this.toLinkEntities(file, headwords, result.links.slice(0, limit));
  }

  private toLinkEntities(
    activeFile: TFile,
    headwords: Headword[],
    pages: RelatedPage[]
  ): FileEntity[] {
    const linkTextByPath = new Map<string, string>();
    for (const headword of headwords) {
      if (headword.path && !linkTextByPath.has(headword.path)) {
        linkTextByPath.set(headword.path, headword.linkText);
      }
    }
    return pages.map((page) =>
      page.linkTo
        ? new FileEntity(
            page.path,
            linkTextByPath.get(page.path) ?? filePathToLinkText(page.path),
            undefined,
            page.path
          )
        : // Opening a page that links here jumps to the line with that link.
          new FileEntity(
            page.path,
            filePathToLinkText(page.path),
            activeFile.path,
            page.path
          )
    );
  }

  /** The note's links in note order, one per target, without itself. */
  private getHeadwords(activeFile: TFile): Headword[] {
    const cache = this.app.metadataCache.getFileCache(activeFile);
    if (!cache) {
      return [];
    }
    const references = [...(cache.links ?? []), ...(cache.embeds ?? [])]
      .slice()
      .sort(
        (a, b) =>
          (a.position?.start?.offset ?? 0) - (b.position?.start?.offset ?? 0)
      );
    const headwords: Headword[] = [];
    const seen = new Set<string>();
    for (const link of [
      ...(cache.frontmatterLinks ?? []).map((reference) => reference.link),
      ...references.map((reference) => reference.link),
    ]) {
      const key = this.linkIndex.resolveLinkKey(link, activeFile.path);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const path = key.startsWith("p:") ? key.slice(2) : null;
      if (path === activeFile.path) continue;
      if (path && shouldExcludePath(path, this.settings.excludePaths)) continue;
      headwords.push({ key, linkText: removeBlockReference(link), path });
    }
    return headwords;
  }

  private getCanvasHeadwords(
    activeFile: TFile,
    canvasIndex: CanvasLinkIndex | undefined
  ): Headword[] {
    const headwords: Headword[] = [];
    for (const path of canvasIndex?.outByCanvas.get(activeFile.path) ?? []) {
      const exists = this.getFile(path) !== null;
      if (exists && shouldExcludePath(path, this.settings.excludePaths)) {
        continue;
      }
      headwords.push({
        key: exists ? fileLinkKey(path) : unresolvedLinkKey(path),
        linkText: exists ? filePathToLinkText(path) : path,
        path: exists ? path : null,
      });
    }
    return headwords;
  }

  private getFile(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file && "stat" in file ? (file as TFile) : null;
  }

  private getPageInfo(path: string): PageInfo {
    const file = this.getFile(path);
    return {
      title: file?.basename ?? filePathToLinkText(path),
      mtime: file?.stat?.mtime ?? 0,
      ctime: file?.stat?.ctime ?? 0,
      linked: this.linkIndex.linkedCount(path),
    };
  }

  private getTagLinks(
    activeFile: TFile,
    shownPaths: Set<string>
  ): PropertiesLinks[] {
    const activeTags = this.linkIndex
      .tagsOf(activeFile.path)
      .filter((tag) => !isExcludedTag(tag, this.settings.excludeTags));
    if (activeTags.length === 0) {
      return [];
    }
    const compare = compareRelatedPages(
      this.settings.sortOrder === "related" ? "modifiedDesc" : this.settings.sortOrder
    );
    const lists: PropertiesLinks[] = [];
    for (const tag of activeTags) {
      const pages: RelatedPage[] = [];
      for (const path of this.linkIndex.pathsWithTag(tag)) {
        if (path === activeFile.path) continue;
        if (shouldExcludePath(path, this.settings.excludePaths)) continue;
        if (this.settings.enableDuplicateRemoval && shownPaths.has(path)) {
          continue;
        }
        pages.push({
          path,
          ...this.getPageInfo(path),
          linkTo: false,
          linkFrom: false,
          score: 0,
        });
      }
      if (pages.length === 0) continue;
      pages.sort(compare);
      lists.push(
        new PropertiesLinks(
          tag,
          "tags",
          pages.map(
            (page) =>
              new FileEntity(
                activeFile.path,
                filePathToLinkText(page.path),
                undefined,
                page.path
              )
          )
        )
      );
    }
    return lists.sort((a, b) => compareTagHierarchy(a.property, b.property));
  }
}

function isExcludedTag(tag: string, excludeTags: string[]): boolean {
  return excludeTags.some((excludeTag) =>
    excludeTag.endsWith("/")
      ? tag === excludeTag.slice(0, -1) || tag.startsWith(excludeTag)
      : tag === excludeTag
  );
}

/** Orders tags so that a more specific tag comes before its parent. */
function compareTagHierarchy(a: string, b: string): number {
  const aParts = a.split("/");
  const bParts = b.split("/");
  for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
    if (aParts[i] !== bParts[i]) {
      return aParts[i].localeCompare(bParts[i]);
    }
  }
  return bParts.length - aParts.length;
}
