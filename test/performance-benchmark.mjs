import { performance } from "node:perf_hooks";
import { Links } from "../src/links.ts";
import { createSettings, createSyntheticApp } from "./support/synthetic-vault.mjs";

async function runBenchmark() {
  const fileCount = Number(process.env.BENCHMARK_NOTES ?? 7500);
  const linksPerFile = Number(process.env.BENCHMARK_LINKS ?? 10);
  const switches = Number(process.env.BENCHMARK_SWITCHES ?? 20);
  const { app, files } = createSyntheticApp({ fileCount, linksPerFile });
  const links = new Links(app, createSettings());

  const firstStartedAt = performance.now();
  await links.gatherTwoHopLinks(files[0]);
  const firstMs = performance.now() - firstStartedAt;

  const switchStartedAt = performance.now();
  for (let index = 1; index <= switches; index++) {
    await links.gatherTwoHopLinks(files[index % files.length]);
  }
  const switchMs = (performance.now() - switchStartedAt) / switches;

  links.markLinksDirty(files[5].path);
  links.invalidateMetadataCaches();
  const patchStartedAt = performance.now();
  await links.gatherTwoHopLinks(files[0]);
  const afterLinkChangeMs = performance.now() - patchStartedAt;

  const stats = links.getPerformanceStats();
  console.log(
    JSON.stringify(
      {
        fileCount,
        linksPerFile,
        firstGatherIncludingIndexMs: Number(firstMs.toFixed(1)),
        indexBuildMs: stats.lastBuildMs,
        averageNoteSwitchMs: Number(switchMs.toFixed(2)),
        afterOneLinkChangeMs: Number(afterLinkChangeMs.toFixed(2)),
        indexBuilds: stats.builds,
        patchedNotes: stats.patches,
      },
      null,
      2
    )
  );
  if (stats.builds !== 1) {
    throw new Error(`Expected one index build, got ${stats.builds}`);
  }
}

runBenchmark().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
