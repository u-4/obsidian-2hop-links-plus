import assert from "node:assert/strict";
import test from "node:test";
import {
  DebouncedTask,
  StartupRefreshGate,
} from "../src/performance.ts";
import { GraphIndexCache } from "../src/graphIndexCache.ts";
import { prepareGraphOrderForPath } from "../src/ranking.ts";
import { Links } from "../src/links.ts";
import {
  createSettings,
  createSyntheticApp,
} from "./support/synthetic-vault.mjs";

class FakeTimer {
  constructor() {
    this.nextId = 1;
    this.tasks = new Map();
  }

  setTimeout(handler, delayMs) {
    const id = this.nextId++;
    this.tasks.set(id, { handler, delayMs });
    return id;
  }

  clearTimeout(handle) {
    this.tasks.delete(handle);
  }

  runAll() {
    const tasks = Array.from(this.tasks.values()).sort(
      (a, b) => a.delayMs - b.delayMs
    );
    this.tasks.clear();
    for (const task of tasks) task.handler();
  }
}

test("tab event bursts run only the latest scheduled refresh", async () => {
  const timer = new FakeTimer();
  const executed = [];
  const coordinator = new DebouncedTask({ timerApi: timer });

  coordinator.schedule(200, () => executed.push("A"));
  coordinator.schedule(200, () => executed.push("B"));
  coordinator.schedule(200, () => executed.push("C"));

  assert.equal(timer.tasks.size, 1);
  timer.runAll();
  await Promise.resolve();
  assert.deepEqual(executed, ["C"]);
});

test("startup refresh cannot be pulled forward by later short delays", () => {
  let now = 0;
  const gate = new StartupRefreshGate(1500, () => now);

  assert.equal(gate.getDelay(200), null);
  gate.markLayoutReady();
  assert.equal(gate.getDelay(200), 1500);

  now = 400;
  assert.equal(gate.getDelay(200), 1100);
  now = 1400;
  assert.equal(gate.getDelay(500), 500);

  now = 1900;
  gate.markRefreshStarted();
  assert.equal(gate.getDelay(200), 200);
});

test("GraphIndex is reused and active document order is built on demand", async () => {
  const { app, files, counters } = createSyntheticApp({
    fileCount: 1200,
    linksPerFile: 8,
  });
  const cache = new GraphIndexCache(app);

  const graph = await cache.get([], false);
  assert.equal(graph.paths.length, 1200);
  const firstOutgoing = graph.out.get(files[0].path);
  assert.ok(firstOutgoing && firstOutgoing.size > 0);
  for (const targetPath of firstOutgoing) {
    assert.ok(graph.in.get(targetPath)?.has(files[0].path));
  }
  assert.equal(graph.pageRank.size, 0, "Cosense-like must skip unused PageRank");
  assert.equal(counters.getFileCache, 0, "cold graph must not inspect every note order");

  prepareGraphOrderForPath(app, graph, files[0].path);
  prepareGraphOrderForPath(app, graph, files[1].path);
  assert.equal(counters.getFileCache, 2);

  const reused = await cache.get([], false);
  assert.equal(reused, graph);
  assert.deepEqual(cache.getStats(), {
    builds: 1,
    hits: 1,
    joinedBuilds: 0,
    cancellations: 0,
    lastBuildMs: cache.getStats().lastBuildMs,
  });

  const fullGraph = await cache.get([], true);
  assert.equal(fullGraph.pageRank.size, 1200);
  assert.equal(cache.getStats().builds, 2);
  assert.equal(await cache.get([], false), fullGraph);
});

test("gather results and graph topology are reused across tab switches", async () => {
  const { app, files, counters } = createSyntheticApp({
    fileCount: 600,
    linksPerFile: 7,
  });
  const links = new Links(app, createSettings());

  const first = await links.gatherTwoHopLinks(files[0]);
  await links.gatherTwoHopLinks(files[1]);
  const firstAgain = await links.gatherTwoHopLinks(files[0]);
  const stats = links.getPerformanceStats();

  assert.equal(firstAgain, first);
  assert.equal(stats.builds, 1);
  assert.equal(stats.resultComputations, 2);
  assert.equal(stats.resultCacheHits, 1);
  assert.ok(stats.hits >= 1);
  assert.equal(counters.vaultRead, 0, "Markdown ranking must not read note bodies");
  assert.equal(counters.cachedRead, 0);
  assert.equal(counters.adapterStat, 0, "existing TFile.stat must be reused");
  assert.ok(
    counters.getFileCache < 20,
    `metadata order lookups must track active notes, got ${counters.getFileCache}`
  );

  links.invalidateMetadataCaches();
  await links.gatherTwoHopLinks(files[0]);
  assert.equal(links.getPerformanceStats().builds, 2);
});

test("hidden Canvas backlinks do not scan Canvas files", async () => {
  const { app, files, counters } = createSyntheticApp({
    fileCount: 100,
    linksPerFile: 5,
    canvasContent: JSON.stringify({
      nodes: [{ type: "file", file: "notes/note-00000.md" }],
    }),
  });
  const links = new Links(
    app,
    createSettings({ showBackwardConnectedLinks: false })
  );

  await links.gatherTwoHopLinks(files[0]);
  assert.equal(counters.vaultRead, 0);
  assert.equal(links.getPerformanceStats().canvasIndexBuilds, 0);
});

test("a newer tab cancels the superseded gather after shared I/O settles", async () => {
  const canvasContent = JSON.stringify({
    nodes: [{ type: "file", file: "notes/note-00000.md" }],
  });
  const { app, files, counters, resolveCanvasRead } = createSyntheticApp({
    fileCount: 50,
    linksPerFile: 4,
    canvasContent,
  });
  const links = new Links(app, createSettings({ sortOrder: "filenameAsc" }));

  const stale = links.gatherTwoHopLinks(files[0]);
  const latest = links.gatherTwoHopLinks(files[1]);
  resolveCanvasRead();

  await assert.rejects(stale, (error) => error?.name === "AbortError");
  await latest;
  const stats = links.getPerformanceStats();
  assert.equal(stats.resultComputations, 2);
  assert.equal(stats.gatherCancellations, 1);
  assert.ok(stats.canvasIndexHits >= 1);
  assert.equal(stats.canvasIndexBuilds, 1);
  assert.equal(counters.vaultRead, 1);
});
