import { performance } from "node:perf_hooks";
import { buildGraphIndex, prepareGraphOrderForPath } from "../src/ranking.ts";
import { GraphIndexCache } from "../src/graphIndexCache.ts";
import { createSyntheticApp } from "./support/synthetic-vault.mjs";

async function runBenchmark() {
  const fileCount = Number(process.env.BENCHMARK_NOTES ?? 3000);
  const linksPerFile = Number(process.env.BENCHMARK_LINKS ?? 10);
  const switches = Number(process.env.BENCHMARK_SWITCHES ?? 8);
  const { app, files, counters } = createSyntheticApp({
    fileCount,
    linksPerFile,
  });

  const uncachedStartedAt = performance.now();
  for (let index = 0; index < switches; index++) {
    const graph = await buildGraphIndex(app, {
      excludePaths: [],
      includePageRank: false,
    });
    prepareGraphOrderForPath(app, graph, files[index % files.length].path);
  }
  const uncachedMs = performance.now() - uncachedStartedAt;

  counters.getFileCache = 0;
  counters.resolveLink = 0;
  const cache = new GraphIndexCache(app);
  const cachedStartedAt = performance.now();
  for (let index = 0; index < switches; index++) {
    const graph = await cache.get([], false);
    prepareGraphOrderForPath(app, graph, files[index % files.length].path);
  }
  const cachedMs = performance.now() - cachedStartedAt;

  const result = {
    fileCount,
    linksPerFile,
    switches,
    uncachedBuilds: switches,
    cachedBuilds: cache.getStats().builds,
    uncachedMs: Number(uncachedMs.toFixed(1)),
    cachedMs: Number(cachedMs.toFixed(1)),
    speedup: Number((uncachedMs / Math.max(cachedMs, 0.1)).toFixed(2)),
    activeOrderMetadataReads: counters.getFileCache,
  };

  if (result.cachedBuilds !== 1) {
    throw new Error(
      `Expected one cached graph build, got ${result.cachedBuilds}`
    );
  }
  if (result.activeOrderMetadataReads !== switches) {
    throw new Error(
      `Expected ${switches} active-note metadata reads, got ${result.activeOrderMetadataReads}`
    );
  }

  console.log(JSON.stringify(result, null, 2));
}

runBenchmark().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
