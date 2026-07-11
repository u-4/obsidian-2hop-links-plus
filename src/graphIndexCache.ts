import type { App } from "obsidian";
import {
  buildGraphIndex,
  GraphIndex,
  RankingSettings,
} from "./ranking";
import {
  CalculationCancelledError,
  GRAPH_CACHE_TTL_MS,
  isCalculationCancelled,
} from "./performance";

export interface GraphIndexCacheStats {
  builds: number;
  hits: number;
  joinedBuilds: number;
  cancellations: number;
  lastBuildMs: number;
}

export type GraphIndexBuilder = (
  app: App,
  settings: RankingSettings,
  signal?: AbortSignal | null
) => Promise<GraphIndex>;

interface CachedGraphIndex {
  excludePathsKey: string;
  includesPageRank: boolean;
  revision: number;
  createdAt: number;
  graph: GraphIndex;
}

interface PendingGraphIndex {
  excludePathsKey: string;
  includesPageRank: boolean;
  revision: number;
  controller: AbortController;
  promise: Promise<GraphIndex>;
}

export class GraphIndexCache {
  private revision = 0;
  private cached: CachedGraphIndex | null = null;
  private pending: PendingGraphIndex | null = null;
  private stats: GraphIndexCacheStats = {
    builds: 0,
    hits: 0,
    joinedBuilds: 0,
    cancellations: 0,
    lastBuildMs: 0,
  };

  constructor(
    private app: App,
    private builder: GraphIndexBuilder = buildGraphIndex,
    private now: () => number = () => Date.now(),
    private ttlMs = GRAPH_CACHE_TTL_MS
  ) {}

  getRevision(): number {
    return this.revision;
  }

  async get(
    excludePaths: string[],
    includePageRank: boolean
  ): Promise<GraphIndex> {
    const excludePathsKey = createExcludePathsKey(excludePaths);
    const now = this.now();

    if (
      this.cached &&
      this.cached.revision === this.revision &&
      this.cached.excludePathsKey === excludePathsKey &&
      (!includePageRank || this.cached.includesPageRank) &&
      now - this.cached.createdAt <= this.ttlMs
    ) {
      this.stats.hits++;
      return this.cached.graph;
    }

    if (
      this.pending &&
      this.pending.revision === this.revision &&
      this.pending.excludePathsKey === excludePathsKey &&
      (!includePageRank || this.pending.includesPageRank)
    ) {
      this.stats.joinedBuilds++;
      return this.pending.promise;
    }

    if (this.pending) {
      this.pending.controller.abort();
      this.pending = null;
    }

    const revision = this.revision;
    const controller = new AbortController();
    const startedAt = this.now();
    this.stats.builds++;

    const promise = this.builder(
      this.app,
      { excludePaths, includePageRank },
      controller.signal
    )
      .then((graph) => {
        if (controller.signal.aborted || revision !== this.revision) {
          throw new CalculationCancelledError();
        }

        this.stats.lastBuildMs = Math.max(0, this.now() - startedAt);
        this.cached = {
          excludePathsKey,
          includesPageRank: includePageRank,
          revision,
          createdAt: this.now(),
          graph,
        };
        return graph;
      })
      .catch((error: unknown) => {
        if (isCalculationCancelled(error)) {
          this.stats.cancellations++;
        }
        throw error;
      })
      .finally(() => {
        if (this.pending?.promise === promise) {
          this.pending = null;
        }
      });

    this.pending = {
      excludePathsKey,
      includesPageRank: includePageRank,
      revision,
      controller,
      promise,
    };
    return promise;
  }

  invalidate(): void {
    this.revision++;
    this.cached = null;
    this.pending?.controller.abort();
    this.pending = null;
  }

  cancel(): void {
    this.pending?.controller.abort();
    this.pending = null;
  }

  getStats(): GraphIndexCacheStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      builds: 0,
      hits: 0,
      joinedBuilds: 0,
      cancellations: 0,
      lastBuildMs: 0,
    };
  }
}

export function createExcludePathsKey(excludePaths: string[]): string {
  return JSON.stringify(Array.from(new Set(excludePaths)).sort());
}
