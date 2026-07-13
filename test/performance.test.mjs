import assert from "node:assert/strict";
import test from "node:test";
import {
  DebouncedTask,
  StartupRefreshGate,
} from "../src/performance.ts";
import {
  ALL_MARKDOWN_HOST_SELECTOR,
  BoundedAnimationFrameRetry,
  getAllMarkdownHostElements,
  getCurrentMarkdownHostElements,
  getMarkdownHostSelector,
  shouldContinueMarkdownHostRetry,
} from "../src/markdownHostReadiness.ts";
import { GraphIndexCache } from "../src/graphIndexCache.ts";
import { prepareGraphOrderForPath } from "../src/ranking.ts";
import { Links } from "../src/links.ts";
import {
  getScrollDestination,
  getScrollDestinationLabel,
  MarkdownScrollNavigator,
} from "../src/scrollNavigation.ts";
import { getNextLoadedState } from "../src/ui/twohopLinksLoadState.ts";
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

class FakeAnimationFrames {
  constructor() {
    this.nextId = 1;
    this.tasks = new Map();
  }

  requestAnimationFrame(handler) {
    const id = this.nextId++;
    this.tasks.set(id, handler);
    return id;
  }

  cancelAnimationFrame(handle) {
    this.tasks.delete(handle);
  }

  runNext() {
    const next = this.tasks.entries().next();
    if (next.done) return false;
    const [id, handler] = next.value;
    this.tasks.delete(id);
    handler(16);
    return true;
  }
}

function createScrollNavigatorFixture() {
  const timer = new FakeTimer();
  const listeners = new Map();
  const scrollCalls = [];
  const viewportBounds = { top: 100, bottom: 700, height: 600 };
  const resultsBounds = { top: 110, bottom: 910, height: 800 };
  const ownerWindow = {
    setTimeout: (handler, delayMs) => timer.setTimeout(handler, delayMs),
    clearTimeout: (handle) => timer.clearTimeout(handle),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false }),
  };
  const ownerDocument = { defaultView: ownerWindow };
  const scrollHost = {
    scrollTop: 1800,
    scrollTo(options) {
      scrollCalls.push({ ...options });
      this.scrollTop = options.behavior === "smooth" ? 300 : options.top;
    },
    getBoundingClientRect: () => viewportBounds,
  };
  const target = {
    isConnected: true,
    ownerDocument,
    getClientRects: () => [{}],
    getBoundingClientRect: () => resultsBounds,
    scrollIntoView: () => {},
    closest(selector) {
      return selector.includes(".markdown-preview-view") ? scrollHost : null;
    },
  };
  const actionElement = {
    isConnected: true,
    classList: { add: () => {} },
    dataset: {},
    attributes: new Map(),
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    remove() {
      this.isConnected = false;
    },
  };
  const containerEl = {
    isConnected: true,
    ownerDocument,
    querySelectorAll: (selector) =>
      selector === ".markdown-preview-view > .twohop-links-container"
        ? [target]
        : [],
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name) => listeners.delete(name),
    getBoundingClientRect: () => viewportBounds,
  };
  let activate = () => {};
  let mode = "preview";
  const view = {
    file: { path: "LongScrollActive.md" },
    containerEl,
    currentMode: {
      getScroll: () => scrollHost.scrollTop,
      applyScroll: (top) => {
        scrollHost.scrollTop = top;
      },
    },
    getMode: () => mode,
    addAction: (_icon, _label, callback) => {
      activate = callback;
      return actionElement;
    },
  };

  return {
    actionElement,
    activate: () => activate(),
    dispatch: (name) => listeners.get(name)?.({ type: name }),
    scrollCalls,
    scrollHost,
    setFilePath: (path) => {
      view.file = { path };
    },
    setMode: (nextMode) => {
      mode = nextMode;
    },
    timer,
    view,
  };
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

test("Markdown host readiness retries until the host appears", () => {
  const frames = new FakeAnimationFrames();
  const retry = new BoundedAnimationFrameRetry();
  let ready = false;
  let rendered = 0;

  assert.equal(
    retry.schedule({
      frameApi: frames,
      maxFrames: 4,
      shouldContinue: () => true,
      isReady: () => ready,
      onReady: () => rendered++,
    }),
    true
  );
  assert.equal(retry.isPending(), true);

  frames.runNext();
  assert.equal(rendered, 0);
  assert.equal(retry.isPending(), true);

  ready = true;
  frames.runNext();
  assert.equal(rendered, 1);
  assert.equal(retry.isPending(), false);
  assert.equal(frames.tasks.size, 0);
});

test("a newer Markdown host retry supersedes the previous view", () => {
  const frames = new FakeAnimationFrames();
  const retry = new BoundedAnimationFrameRetry();
  const rendered = [];
  const options = {
    frameApi: frames,
    maxFrames: 3,
    shouldContinue: () => true,
    isReady: () => true,
  };

  retry.schedule({ ...options, onReady: () => rendered.push("old") });
  retry.schedule({ ...options, onReady: () => rendered.push("new") });

  assert.equal(frames.tasks.size, 1);
  frames.runNext();
  assert.deepEqual(rendered, ["new"]);
});

test("Markdown host readiness stops when the view changes or unload cancels it", () => {
  const frames = new FakeAnimationFrames();
  const retry = new BoundedAnimationFrameRetry();
  let current = true;
  let rendered = 0;

  retry.schedule({
    frameApi: frames,
    maxFrames: 3,
    shouldContinue: () => current,
    isReady: () => true,
    onReady: () => rendered++,
  });
  current = false;
  frames.runNext();
  assert.equal(rendered, 0);
  assert.equal(retry.isPending(), false);

  current = true;
  retry.schedule({
    frameApi: frames,
    maxFrames: 3,
    shouldContinue: () => current,
    isReady: () => true,
    onReady: () => rendered++,
  });
  retry.cancel();
  assert.equal(frames.tasks.size, 0);
  assert.equal(retry.isPending(), false);
  assert.equal(rendered, 0);
});

test("Markdown host readiness has a bounded retry count", () => {
  const frames = new FakeAnimationFrames();
  const retry = new BoundedAnimationFrameRetry();
  let probes = 0;

  retry.schedule({
    frameApi: frames,
    maxFrames: 2,
    shouldContinue: () => true,
    isReady: () => {
      probes++;
      return false;
    },
    onReady: () => assert.fail("host never became ready"),
  });

  frames.runNext();
  frames.runNext();
  assert.equal(probes, 2);
  assert.equal(retry.isPending(), false);
  assert.equal(frames.tasks.size, 0);
});

test("Markdown host readiness rejects invalid retry bounds", () => {
  const frames = new FakeAnimationFrames();
  const retry = new BoundedAnimationFrameRetry();
  const base = {
    frameApi: frames,
    shouldContinue: () => true,
    isReady: () => true,
    onReady: () => assert.fail("invalid bounds must not schedule"),
  };

  assert.equal(retry.schedule({ ...base, maxFrames: 0 }), false);
  assert.equal(retry.schedule({ ...base, maxFrames: -1 }), false);
  assert.equal(retry.schedule({ ...base, maxFrames: Number.NaN }), false);
  assert.equal(
    retry.schedule({ ...base, maxFrames: Number.POSITIVE_INFINITY }),
    false
  );
  assert.equal(frames.tasks.size, 0);
});

test("Markdown host retries stop whenever their navigation context is stale", () => {
  const base = {
    isUnloaded: false,
    showLinksInMarkdown: true,
    showInSeparatePane: false,
    isActiveLeaf: true,
    leafViewType: "markdown",
    activeFilePath: "Active.md",
    expectedFilePath: "Active.md",
  };

  assert.equal(shouldContinueMarkdownHostRetry(base), true);
  const staleContexts = [
    { isUnloaded: true },
    { showLinksInMarkdown: false },
    { showInSeparatePane: true },
    { isActiveLeaf: false },
    { leafViewType: "palmwiki-home-view" },
    { leafViewType: "empty" },
    { activeFilePath: "Other.md" },
    { activeFilePath: null },
  ];

  for (const changes of staleContexts) {
    assert.equal(
      shouldContinueMarkdownHostRetry({ ...base, ...changes }),
      false
    );
  }
});

test("Markdown readiness follows the current mode while injection and cleanup cover all modes", () => {
  assert.equal(
    ALL_MARKDOWN_HOST_SELECTOR,
    ".markdown-source-view .CodeMirror-lines, .markdown-preview-view, .markdown-source-view .cm-sizer"
  );
  assert.equal(getMarkdownHostSelector("preview"), ".markdown-preview-view");
  assert.equal(
    getMarkdownHostSelector("source"),
    ".markdown-source-view .CodeMirror-lines, .markdown-source-view .cm-sizer"
  );

  const sourceHost = { name: "source", closest: () => null };
  const previewHost = { name: "preview", closest: () => null };
  const embeddedHost = {
    name: "embedded",
    closest: (selector) =>
      selector === ".markdown-embed-content" ? {} : null,
  };
  const resultsBySelector = new Map([
    [ALL_MARKDOWN_HOST_SELECTOR, [sourceHost, embeddedHost]],
    [getMarkdownHostSelector("source"), [sourceHost, embeddedHost]],
    [getMarkdownHostSelector("preview"), []],
  ]);
  const root = {
    querySelectorAll(selector) {
      return resultsBySelector.get(selector) ?? [];
    },
  };

  assert.deepEqual(getCurrentMarkdownHostElements(root, "preview"), []);
  resultsBySelector.set(getMarkdownHostSelector("preview"), [previewHost]);
  resultsBySelector.set(ALL_MARKDOWN_HOST_SELECTOR, [
    sourceHost,
    previewHost,
    embeddedHost,
  ]);

  assert.deepEqual(getCurrentMarkdownHostElements(root, "preview"), [
    previewHost,
  ]);
  assert.deepEqual(getCurrentMarkdownHostElements(root, "source"), [
    sourceHost,
  ]);
  assert.deepEqual(getAllMarkdownHostElements(root), [sourceHost, previewHost]);
});

test("scroll navigation follows the current note position", () => {
  const viewport = { top: 100, bottom: 700, height: 600 };

  assert.equal(
    getScrollDestination(
      0,
      { top: 100, bottom: 900, height: 800 },
      viewport
    ),
    "links"
  );
  assert.equal(
    getScrollDestination(
      450,
      { top: 850, bottom: 1650, height: 800 },
      viewport
    ),
    "links"
  );
  assert.equal(
    getScrollDestination(
      1800,
      { top: 110, bottom: 910, height: 800 },
      viewport
    ),
    "top"
  );
  assert.equal(
    getScrollDestination(
      1800,
      { top: 250, bottom: 650, height: 400 },
      viewport
    ),
    "top"
  );
  assert.equal(
    getScrollDestination(
      2200,
      { top: -500, bottom: 450, height: 950 },
      viewport
    ),
    "top"
  );
  assert.equal(getScrollDestinationLabel("links"), "Scroll to 2-hop links");
  assert.equal(getScrollDestinationLabel("top"), "Scroll to note top");
});

test("scroll navigation settles an interrupted smooth return to note top", () => {
  const fixture = createScrollNavigatorFixture();
  const navigator = new MarkdownScrollNavigator();
  navigator.ensure(fixture.view);

  assert.equal(
    fixture.actionElement.dataset.twohopScrollDestination,
    "top"
  );
  fixture.activate();
  assert.equal(fixture.scrollHost.scrollTop, 300);
  assert.deepEqual(fixture.scrollCalls, [{ top: 0, behavior: "smooth" }]);

  fixture.timer.runAll();
  assert.equal(fixture.scrollHost.scrollTop, 0);
  assert.deepEqual(fixture.scrollCalls, [
    { top: 0, behavior: "smooth" },
    { top: 0, behavior: "auto" },
  ]);
  assert.equal(
    fixture.actionElement.dataset.twohopScrollDestination,
    "links"
  );
});

test("manual scroll intent cancels the pending note-top correction", () => {
  const fixture = createScrollNavigatorFixture();
  const navigator = new MarkdownScrollNavigator();
  navigator.ensure(fixture.view);

  fixture.activate();
  fixture.dispatch("wheel");
  fixture.timer.runAll();

  assert.equal(fixture.scrollHost.scrollTop, 300);
  assert.deepEqual(fixture.scrollCalls, [{ top: 0, behavior: "smooth" }]);
});

test("an old note-top correction cannot revive after leaving and returning", () => {
  const scenarios = [
    {
      leave: (fixture) => fixture.setFilePath("Other.md"),
      return: (fixture) => fixture.setFilePath("LongScrollActive.md"),
    },
    {
      leave: (fixture) => fixture.setMode("source"),
      return: (fixture) => fixture.setMode("preview"),
    },
  ];

  for (const scenario of scenarios) {
    const fixture = createScrollNavigatorFixture();
    const navigator = new MarkdownScrollNavigator();
    navigator.ensure(fixture.view);

    fixture.activate();
    scenario.leave(fixture);
    navigator.cancelPending();
    scenario.return(fixture);
    fixture.timer.runAll();

    assert.equal(fixture.scrollHost.scrollTop, 300);
    assert.deepEqual(fixture.scrollCalls, [{ top: 0, behavior: "smooth" }]);
  }
});

test("temporary sorting preserves a manually loaded view", () => {
  const manualView = {
    sourcePath: "Active.md",
    autoLoadTwoHopLinks: false,
  };

  assert.equal(getNextLoadedState(true, manualView, manualView), true);
  assert.equal(
    getNextLoadedState(true, manualView, {
      ...manualView,
      sourcePath: "Other.md",
    }),
    false
  );
  assert.equal(
    getNextLoadedState(false, manualView, {
      ...manualView,
      autoLoadTwoHopLinks: true,
    }),
    true
  );
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
