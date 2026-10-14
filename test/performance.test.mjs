import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TFile } from "obsidian";
import { DebouncedTask, StartupRefreshGate } from "../src/performance.ts";
import {
  ALL_MARKDOWN_HOST_SELECTOR,
  BoundedAnimationFrameRetry,
  getAllMarkdownHostElements,
  getCurrentMarkdownHostElements,
  getMarkdownHostSelector,
  shouldContinueMarkdownHostRetry,
} from "../src/markdownHostReadiness.ts";
import {
  getLinkSignature,
  LinkSignatureTracker,
} from "../src/linkSignature.ts";
import { buildRelatedPages, LARGE_GROUP_SIZE } from "../src/cosenseRelated.ts";
import { LinkIndex } from "../src/linkIndex.ts";
import { excerpt, findWebImage, PreviewStore } from "../src/cardPreview.ts";
import {
  CardThumbnails,
  MOBILE_MAX_ORIGINAL_BYTES,
  setCardThumbnails,
} from "../src/cardThumbnail.ts";
import {
  cardsBelowPreview,
  hoverOpenDelay,
  placePopover,
} from "../src/relatedPopover.tsx";
import { migrateSortOrder } from "../src/settings/sortOptions.ts";
import { chooseInlineRestoreLeaf } from "../src/inlineRestoreLeaf.ts";
import { Links } from "../src/links.ts";
import {
  getScrollDestination,
  getScrollDestinationLabel,
  inlineButtonState,
  MarkdownScrollNavigator,
  paneButtonState,
} from "../src/scrollNavigation.ts";
import { getNextLoadedState } from "../src/ui/twohopLinksLoadState.ts";
import LinkView from "../src/ui/LinkView.tsx";
import { SeparatePaneView } from "../src/ui/SeparatePaneView.tsx";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getNextSearchDisclosureState,
  getSortMenuEntries,
  hasTemporarySortOverride,
  isSortMenuContextCurrent,
  reserveResultsHeight,
} from "../src/ui/toolbarModel.ts";
import {
  createLinkedApp,
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
    closest: (selector) => (selector === ".markdown-embed-content" ? {} : null),
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
    getScrollDestination(0, { top: 100, bottom: 900, height: 800 }, viewport),
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

  assert.equal(fixture.actionElement.dataset.twohopScrollDestination, "top");
  fixture.activate();
  assert.equal(fixture.scrollHost.scrollTop, 300);
  assert.deepEqual(fixture.scrollCalls, [{ top: 0, behavior: "smooth" }]);

  fixture.timer.runAll();
  assert.equal(fixture.scrollHost.scrollTop, 0);
  assert.deepEqual(fixture.scrollCalls, [
    { top: 0, behavior: "smooth" },
    { top: 0, behavior: "auto" },
  ]);
  assert.equal(fixture.actionElement.dataset.twohopScrollDestination, "links");
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

test("collapsing compact search clears its hidden query state", () => {
  const opened = getNextSearchDisclosureState(
    { isExpanded: false, searchInput: "" },
    "toggle"
  );
  assert.deepEqual(opened, { isExpanded: true, searchInput: "" });

  const closed = getNextSearchDisclosureState(
    { isExpanded: true, searchInput: "RareA" },
    "toggle"
  );
  assert.deepEqual(closed, { isExpanded: false, searchInput: "" });

  const escaped = getNextSearchDisclosureState(
    { isExpanded: true, searchInput: "RareB" },
    "close"
  );
  assert.deepEqual(escaped, { isExpanded: false, searchInput: "" });
});

test("compact search overrides the native focused form surface", () => {
  const styles = readFileSync("styles.css", "utf8");
  const inputRule = styles.match(
    /\.twohop-links-search-control\s*>\s*input\[type="search"\]\.twohop-links-search-input\s*\{([^}]*)\}/
  );

  assert.ok(
    inputRule,
    "the search input must use the scoped high-specificity rule"
  );
  assert.match(inputRule[1], /background:\s*transparent\s*;/);
  assert.match(inputRule[1], /border:\s*0\s*;/);
  assert.match(inputRule[1], /border-radius:\s*0\s*;/);
  assert.match(inputRule[1], /box-shadow:\s*none\s*;/);
  assert.match(
    styles,
    /\.twohop-links-search-control:focus-within\s*\{[^}]*outline:\s*2px solid var\(--interactive-accent\)\s*;/
  );
});

test("sort menu exposes every order and marks only the temporary current value", () => {
  const entries = getSortMenuEntries("modifiedDesc");

  assert.deepEqual(
    entries.map((entry) => entry.label),
    ["Related", "Modified", "Created", "Most linked", "Title"]
  );
  assert.deepEqual(
    entries.filter((entry) => entry.isCurrent).map((entry) => entry.value),
    ["modifiedDesc"]
  );
});

test("temporary sort indicator appears only when the current order differs from the default", () => {
  assert.equal(
    hasTemporarySortOverride("related", "related"),
    false
  );
  assert.equal(
    hasTemporarySortOverride("titleAsc", "related"),
    true
  );
  assert.equal(hasTemporarySortOverride("related", "titleAsc"), true);
});

test("search result height is captured once from a valid rendered card region", () => {
  assert.equal(reserveResultsHeight(null, 180.2), 181);
  assert.equal(reserveResultsHeight(181, 420), 181);
  assert.equal(reserveResultsHeight(null, 0), null);
  assert.equal(reserveResultsHeight(null, Number.NaN), null);
});

test("an old sort menu cannot reorder a newly active note", () => {
  assert.equal(
    isSortMenuContextCurrent("Active.md", "Active.md", "Active.md"),
    true
  );
  assert.equal(
    isSortMenuContextCurrent("Active.md", "Other.md", "Other.md"),
    false
  );
  assert.equal(
    isSortMenuContextCurrent("Active.md", "Active.md", "Other.md"),
    false
  );
  assert.equal(isSortMenuContextCurrent("Active.md", "Active.md", null), false);
});

test("inline restore is limited to closing the active 2Hop pane in the same container", () => {
  const mainRoot = { id: "main-root" };
  const popoutRoot = { id: "popout-root" };
  const markdownLeaf = { type: "markdown", id: "note", root: mainRoot };
  const popoutMarkdownLeaf = {
    type: "markdown",
    id: "popout-note",
    root: popoutRoot,
  };
  const sidePaneLeaf = { type: "twohop", id: "side", root: mainRoot };
  const customLeaf = { type: "palmwiki-home", id: "home", root: mainRoot };
  const emptyLeaf = { type: "empty", id: "empty", root: mainRoot };
  const isMarkdownLeaf = (leaf) => leaf.type === "markdown";
  const getContainer = (leaf) => leaf.root;

  assert.equal(
    chooseInlineRestoreLeaf({
      didCloseActiveSeparatePane: true,
      activeLeafAfterClose: null,
      closedSeparatePaneLeaf: sidePaneLeaf,
      recentLeaf: markdownLeaf,
      expectedContainer: mainRoot,
      isMarkdownLeaf,
      getContainer,
    }),
    markdownLeaf
  );
  assert.equal(
    chooseInlineRestoreLeaf({
      didCloseActiveSeparatePane: false,
      activeLeafAfterClose: customLeaf,
      closedSeparatePaneLeaf: null,
      recentLeaf: markdownLeaf,
      expectedContainer: mainRoot,
      isMarkdownLeaf,
      getContainer,
    }),
    null,
    "ordinary settings updates must preserve custom active views"
  );
  assert.equal(
    chooseInlineRestoreLeaf({
      didCloseActiveSeparatePane: true,
      activeLeafAfterClose: customLeaf,
      closedSeparatePaneLeaf: sidePaneLeaf,
      recentLeaf: markdownLeaf,
      expectedContainer: mainRoot,
      isMarkdownLeaf,
      getContainer,
    }),
    null,
    "a view selected by Obsidian while closing must not be replaced"
  );
  assert.equal(
    chooseInlineRestoreLeaf({
      didCloseActiveSeparatePane: true,
      activeLeafAfterClose: null,
      closedSeparatePaneLeaf: sidePaneLeaf,
      recentLeaf: popoutMarkdownLeaf,
      expectedContainer: mainRoot,
      isMarkdownLeaf,
      getContainer,
    }),
    null,
    "a Markdown leaf from another popout must not be selected"
  );
  assert.equal(
    chooseInlineRestoreLeaf({
      didCloseActiveSeparatePane: true,
      activeLeafAfterClose: null,
      closedSeparatePaneLeaf: sidePaneLeaf,
      recentLeaf: emptyLeaf,
      expectedContainer: mainRoot,
      isMarkdownLeaf,
      getContainer,
    }),
    null,
    "non-Markdown leaves are not restore targets"
  );
});

test("gather results and the link index are reused across tab switches", async () => {
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
  assert.equal(counters.vaultRead, 0, "ranking must not read note bodies");
  assert.equal(counters.cachedRead, 0);
  assert.equal(counters.adapterStat, 0, "existing TFile.stat must be reused");

  links.markLinksDirty(files[3].path);
  links.invalidateMetadataCaches();
  await links.gatherTwoHopLinks(files[0]);
  const afterPatch = links.getPerformanceStats();
  assert.equal(afterPatch.builds, 1, "one changed note must not rebuild the index");
  assert.equal(afterPatch.patches, 1);

  links.markAllLinksDirty();
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
    nodes: [
      { type: "file", file: "notes/note-00000.md" },
      { type: "file", file: "notes/note-00001.md" },
    ],
  });
  const { app, files, counters, resolveCanvasRead } = createSyntheticApp({
    fileCount: 50,
    linksPerFile: 4,
    canvasContent,
  });
  const links = new Links(app, createSettings({ sortOrder: "titleAsc" }));

  const stale = links.gatherTwoHopLinks(files[0]);
  const latest = links.gatherTwoHopLinks(files[1]);
  resolveCanvasRead();

  await assert.rejects(stale, (error) => error?.name === "AbortError");
  const result = await latest;
  const stats = links.getPerformanceStats();
  assert.equal(stats.resultComputations, 2);
  assert.equal(stats.gatherCancellations, 1);
  assert.ok(stats.canvasIndexHits >= 1);
  assert.equal(stats.canvasIndexBuilds, 1);
  assert.equal(counters.vaultRead, 1);
  assert.ok(
    result.links.some((entity) => entity.targetPath === "boards/test.canvas"),
    "a Canvas that contains the note is listed in Links"
  );
});

test("a gather gives the main thread back and stops at a checkpoint when cancelled", async () => {
  const { app, files } = createSyntheticApp({ fileCount: 400, linksPerFile: 8 });
  // Yield at every checkpoint so the test does not depend on the clock.
  const cooperation = { yieldEvery: 40, maxSliceMs: 0 };
  const links = new Links(app, createSettings(), cooperation);
  let timerRan = false;
  setTimeout(() => {
    timerRan = true;
  }, 0);
  const result = await links.gatherTwoHopLinks(files[0]);
  assert.ok(timerRan, "a timer queued before the gather runs before it finishes");
  assert.ok(result.links.length > 0);

  const reference = await new Links(app, createSettings()).gatherTwoHopLinks(files[0]);
  assert.deepEqual(
    result.twoHopLinks.map((group) => group.fileEntities.map((e) => e.targetPath)),
    reference.twoHopLinks.map((group) => group.fileEntities.map((e) => e.targetPath)),
    "yielding does not change the result"
  );

  const fresh = new Links(app, createSettings(), cooperation);
  const pending = fresh.gatherTwoHopLinks(files[1]);
  setTimeout(() => fresh.cancelActiveGather(), 0);
  await assert.rejects(pending, (error) => error?.name === "AbortError");
  assert.equal(fresh.getPerformanceStats().gatherCancellations, 1);
  // The unfinished index build is carried on by the next gather.
  await fresh.gatherTwoHopLinks(files[1]);
  assert.equal(fresh.getPerformanceStats().builds, 1);
});

const signatureOptions = { frontmatterPropertyKeyAsTitle: "" };

function metadataWithLinks(links, extra = {}) {
  return {
    links: links.map((link, index) => ({
      link,
      position: { start: { offset: index * 10, line: index } },
    })),
    ...extra,
  };
}

test("typing text without touching links keeps the link signature", () => {
  const tracker = new LinkSignatureTracker(() => signatureOptions);
  assert.equal(tracker.update("A.md", metadataWithLinks(["B", "C"])), true);
  assert.equal(tracker.update("A.md", metadataWithLinks(["B", "C"])), false);
  assert.equal(
    tracker.update(
      "A.md",
      metadataWithLinks(["B", "C"], { sections: [{ type: "paragraph" }] })
    ),
    false
  );
  assert.equal(tracker.update("A.md", metadataWithLinks(["B", "C", "D"])), true);
  assert.equal(tracker.update("A.md", metadataWithLinks(["C", "B", "D"])), true);
  tracker.remember("B.md", metadataWithLinks(["A"]));
  assert.equal(tracker.update("B.md", metadataWithLinks(["A"])), false);
});

test("tags and title frontmatter are part of the link signature", () => {
  const base = metadataWithLinks(["B"]);
  const withTag = {
    ...base,
    tags: [{ tag: "#topic", position: { start: { offset: 50 } } }],
  };
  assert.notEqual(
    getLinkSignature(base, signatureOptions),
    getLinkSignature(withTag, signatureOptions)
  );
  const titleOptions = { frontmatterPropertyKeyAsTitle: "title" };
  assert.notEqual(
    getLinkSignature({ ...base, frontmatter: { title: "One" } }, titleOptions),
    getLinkSignature({ ...base, frontmatter: { title: "Two" } }, titleOptions)
  );
  assert.equal(
    getLinkSignature({ ...base, frontmatter: { status: "a" } }, signatureOptions),
    getLinkSignature({ ...base, frontmatter: { status: "b" } }, signatureOptions)
  );
});

test("an unrelated metadata change does not cancel the gather in progress", async () => {
  const { app, files } = createSyntheticApp({ fileCount: 300, linksPerFile: 6 });
  const links = new Links(app, createSettings());
  const pending = links.gatherTwoHopLinks(files[0]);
  links.invalidateMetadataCaches(false);
  const result = await pending;
  assert.ok(result.links.length > 0);
  assert.equal(links.getPerformanceStats().gatherCancellations, 0);
  await links.gatherTwoHopLinks(files[0]);
  assert.equal(links.getPerformanceStats().resultComputations, 2);
});

function cosenseVault() {
  return createLinkedApp({
    A: {
      links: ["B", "C", "Missing", "Lonely", "GPT-3.5", "photo.png"],
      tags: ["topic/sub"],
    },
    B: { links: [], mtime: 1_700_000_000_000 },
    C: { links: ["A"], mtime: 1_700_000_000_000 },
    D: { links: ["C", "B"], mtime: 1_700_000_900_000 },
    E: { links: ["C"], mtime: 1_700_000_100_000 },
    F: { links: ["A", "B"], mtime: 1_700_000_000_000 },
    G: { links: ["Missing"], mtime: 1_700_000_000_000 },
    H: { links: ["B"], mtime: 1_700_000_000_000 },
    T: { links: [], tags: ["topic"], mtime: 1_700_000_000_000 },
  });
}

const titlesOf = (entities) =>
  entities.map((entity) =>
    (entity.targetPath ?? entity.linkText).replace(/\.md$/, "")
  );

test("Links lists linked notes first, then notes linking back", async () => {
  const { app, files } = cosenseVault();
  const links = new Links(app, createSettings({ showTagsLinks: true }));
  const result = await links.gatherTwoHopLinks(files.get("A.md"));

  // C links both ways, B is only linked to, F only links back.
  assert.deepEqual(titlesOf(result.links), ["C", "B", "F"]);
  const backlink = result.links.find((entity) => entity.targetPath === "F.md");
  assert.equal(backlink.linkTextToReveal, "A.md", "opens F at its link to A");
});

test("2-hop groups follow the note's link order and show each note once", async () => {
  const { app, files } = cosenseVault();
  const links = new Links(app, createSettings({ showTagsLinks: true }));
  const result = await links.gatherTwoHopLinks(files.get("A.md"));
  const groups = result.twoHopLinks.map((group) => ({
    headword: group.link.targetPath ?? group.link.linkText,
    pages: titlesOf(group.fileEntities),
  }));

  // D shares both B and C but appears only under B, the earlier link. H ranks
  // above D because its shared link (B) comes earlier in A. F and C are in
  // Links and therefore not repeated.
  assert.deepEqual(groups, [
    { headword: "B.md", pages: ["H", "D"] },
    { headword: "C.md", pages: ["E"] },
    { headword: "Missing", pages: ["G"] },
  ]);
  const card = result.twoHopLinks[0].fileEntities[0];
  assert.equal(card.linkTextToReveal, "B.md", "opens H at its link to B");
  assert.deepEqual(
    titlesOf(result.newLinks),
    ["Lonely", "GPT-3.5"],
    "names with a period are notes; attachments are not links"
  );
});

test("other sort orders reorder within sections but keep group order", async () => {
  const { app, files } = cosenseVault();
  const links = new Links(app, createSettings({ sortOrder: "modifiedDesc" }));
  const result = await links.gatherTwoHopLinks(files.get("A.md"));
  assert.deepEqual(titlesOf(result.twoHopLinks[0].fileEntities), ["D", "H"]);
  assert.deepEqual(
    result.twoHopLinks.map((group) => group.link.targetPath ?? group.link.linkText),
    ["B.md", "C.md", "Missing"]
  );
});

test("the Tags section lists notes sharing a tag that are not shown elsewhere", async () => {
  const { app, files } = cosenseVault();
  const links = new Links(app, createSettings({ showTagsLinks: true }));
  const result = await links.gatherTwoHopLinks(files.get("A.md"));
  assert.deepEqual(
    result.tagLinksList.map((list) => [list.property, titlesOf(list.fileEntities)]),
    [["topic", ["T"]]]
  );
});

test("groups larger than the limit move to the end, smallest first", () => {
  const sources = new Map([
    ["p:Hub.md", Array.from({ length: LARGE_GROUP_SIZE + 5 }, (_, i) => `n${i}.md`)],
    ["p:Big.md", Array.from({ length: LARGE_GROUP_SIZE + 1 }, (_, i) => `m${i}.md`)],
    ["p:Small.md", ["s1.md", "s2.md"]],
  ]);
  const result = buildRelatedPages({
    activePath: "A.md",
    headwords: ["Hub", "Big", "Small"].map((name) => ({
      key: `p:${name}.md`,
      linkText: name,
      path: `${name}.md`,
    })),
    linkTo: ["Hub.md", "Big.md", "Small.md"],
    linkFrom: [],
    sourcesOf: (key) => sources.get(key) ?? [],
    orderedKeysOf: () => [],
    infoOf: (path) => ({ title: path, mtime: 0, ctime: 0, linked: 0 }),
    isExcluded: () => false,
    sortOrder: "related",
  });
  assert.deepEqual(
    result.groups.map((group) => group.headword.linkText),
    ["Small", "Big", "Hub"]
  );
});

test("the link index updates only the note that changed", () => {
  const { app, files, notes, rebuild } = cosenseVault();
  const index = new LinkIndex(app);
  assert.deepEqual(
    Array.from(index.sourcesOf("p:C.md")).sort(),
    ["A.md", "D.md", "E.md"]
  );
  assert.equal(index.linkedCount("B.md"), 4);

  notes.E.links = ["B"];
  rebuild();
  index.markDirty("E.md");
  assert.deepEqual(Array.from(index.sourcesOf("p:C.md")).sort(), ["A.md", "D.md"]);
  assert.ok(index.sourcesOf("p:B.md").has("E.md"));
  assert.ok(index.sourcesOf("u:missing").has("G.md"));
  assert.deepEqual(index.orderedKeysOf(files.get("D.md")), ["p:C.md", "p:B.md"]);
  assert.equal(index.getStats().builds, 1);
  assert.equal(index.getStats().patches, 1);
});

function addNote(vault, name, note) {
  vault.notes[name] = note;
  vault.files.set(`${name}.md`, new TFile(`${name}.md`));
  vault.rebuild();
}

function removeNote(vault, name) {
  delete vault.notes[name];
  vault.files.delete(`${name}.md`);
  vault.rebuild();
}

test("creating, deleting and renaming notes updates the link index without a rebuild", () => {
  const vault = cosenseVault();
  const index = new LinkIndex(vault.app);
  assert.ok(index.sourcesOf("u:missing").has("G.md"));

  // Notes whose links name the new note are reread even before Obsidian
  // reports them re-resolved.
  addNote(vault, "Missing", { links: ["B"] });
  index.noteCreated("Missing.md");
  assert.deepEqual(Array.from(index.sourcesOf("p:Missing.md")).sort(), ["A.md", "G.md"]);
  assert.equal(index.sourcesOf("u:missing").size, 0);
  assert.ok(index.sourcesOf("p:B.md").has("Missing.md"));

  removeNote(vault, "C");
  index.noteDeleted("C.md");
  assert.equal(index.sourcesOf("p:C.md").size, 0);
  assert.deepEqual(Array.from(index.sourcesOf("u:c")).sort(), ["A.md", "D.md", "E.md"]);
  assert.ok(!index.sourcesOf("p:A.md").has("C.md"), "the deleted note's links are gone");

  vault.notes.H2 = vault.notes.H;
  removeNote(vault, "H");
  addNote(vault, "H2", vault.notes.H2);
  index.noteRenamed("H.md", "H2.md");
  assert.ok(index.sourcesOf("p:B.md").has("H2.md"));
  assert.ok(!index.sourcesOf("p:B.md").has("H.md"));
  assert.equal(index.getStats().builds, 1);
});

test("a note's first change counts only when its links or tags differ from the index", () => {
  const { app, files } = cosenseVault();
  const index = new LinkIndex(app);
  index.ensureFresh();
  const cacheOfD = app.metadataCache.getFileCache(files.get("D.md"));
  assert.equal(index.differsFrom("D.md", cacheOfD), false);
  assert.equal(index.differsFrom("D.md", metadataWithLinks(["C", "B", "E"])), true);
  assert.equal(index.differsFrom("D.md", { ...cacheOfD, tags: [{ tag: "#new" }] }), true);

  const tracker = new LinkSignatureTracker(() => signatureOptions);
  const unchanged = () => index.differsFrom("D.md", cacheOfD);
  assert.equal(tracker.update("D.md", cacheOfD, unchanged), false);
  assert.equal(tracker.update("D.md", metadataWithLinks(["C"]), unchanged), true);
  tracker.markNew("New.md");
  assert.equal(tracker.update("New.md", metadataWithLinks([]), () => false), true);
});

test("changes to unrelated notes keep cached results; related ones drop them", async () => {
  const vault = createLinkedApp({
    A: { links: ["B", "C", "Lonely"] },
    B: { links: [] },
    C: { links: [] },
    D: { links: ["B"] },
    X: { links: ["Y"] },
    Y: { links: [] },
  });
  const { app, files, notes, rebuild } = vault;
  const links = new Links(app, createSettings());
  const edit = (name, nextLinks) => {
    const path = `${name}.md`;
    notes[name].links = nextLinks;
    rebuild();
    const change = links.describeChange(path, app.metadataCache.getFileCache(files.get(path)));
    links.markLinksDirty(path);
    links.invalidateMetadataCaches(false, change);
  };
  const first = await links.gatherTwoHopLinks(files.get("A.md"));
  await links.gatherTwoHopLinks(files.get("B.md"));

  edit("X", ["Y", "Z"]);
  assert.equal(await links.gatherTwoHopLinks(files.get("A.md")), first,
    "a note A does not show and that links nowhere near A keeps A's result");
  edit("X", ["C"]);
  const second = await links.gatherTwoHopLinks(files.get("A.md"));
  assert.notEqual(second, first);
  assert.ok(second.twoHopLinks.some((group) =>
    group.fileEntities.some((entity) => entity.targetPath === "X.md")));

  addNote(vault, "Lonely", { links: [] });
  links.invalidateMetadataCaches(false, links.noteCreated("Lonely.md"));
  const third = await links.gatherTwoHopLinks(files.get("A.md"));
  assert.notEqual(third, second, "a new note named like a shown missing link drops it");
  assert.ok(!third.newLinks.some((entity) => entity.linkText === "Lonely"));

  removeNote(vault, "D");
  links.invalidateMetadataCaches(false, links.noteDeleted("D.md"));
  const fourth = await links.gatherTwoHopLinks(files.get("A.md"));
  assert.notEqual(fourth, third);
  assert.ok(!fourth.twoHopLinks.some((group) =>
    group.fileEntities.some((entity) => entity.targetPath === "D.md")));
  assert.equal(links.getPerformanceStats().builds, 1);
});

test("a result is not cached when a change it depends on arrives during the gather", async () => {
  const vault = cosenseVault();
  const { app, files } = vault;
  const links = new Links(app, createSettings(), { yieldEvery: 1, maxSliceMs: 0 });
  const pending = links.gatherTwoHopLinks(files.get("A.md"));
  links.invalidateMetadataCaches(false, links.describeChange("E.md", metadataWithLinks(["C"])));
  await pending;
  await links.gatherTwoHopLinks(files.get("A.md"));
  assert.equal(links.getPerformanceStats().resultComputations, 2);

  const other = new Links(app, createSettings(), { yieldEvery: 1, maxSliceMs: 0 });
  const unrelated = other.gatherTwoHopLinks(files.get("A.md"));
  other.invalidateMetadataCaches(false, other.describeChange("Z.md", metadataWithLinks(["Q"])));
  await unrelated;
  await other.gatherTwoHopLinks(files.get("A.md"));
  assert.equal(other.getPerformanceStats().resultComputations, 1);
  assert.equal(other.getPerformanceStats().resultCacheHits, 1);
});

test("saved sort orders from earlier versions map to the new choices", () => {
  assert.equal(migrateSortOrder("random"), "related");
  assert.equal(migrateSortOrder("relatedScoreDesc"), "related");
  assert.equal(migrateSortOrder("pageRankDesc"), "related");
  assert.equal(migrateSortOrder("filenameAsc"), "titleAsc");
  assert.equal(migrateSortOrder("modifiedDesc"), "modifiedDesc");
  assert.equal(migrateSortOrder("mostLinkedDesc"), "mostLinkedDesc");
  assert.equal(migrateSortOrder(undefined), "related");
});

test("card excerpts drop frontmatter, code, embeds and Markdown syntax", () => {
  const body = [
    "---",
    "tags: [a]",
    "---",
    "# Heading",
    "- item with [[Target|shown name]] and [[Plain]]",
    "![[photo.png]]",
    "```js",
    "const hidden = 1;",
    "```",
    "**bold** and [web](https://example.com)",
  ].join("\n");
  assert.equal(
    excerpt(body),
    "Heading item with shown name and Plain bold and web"
  );
  assert.equal(excerpt("---\nno end"), "");
  assert.ok(excerpt("x".repeat(1000)).length <= 280);
});

test("web images and YouTube embeds give a card image", () => {
  assert.equal(
    findWebImage("![](https://www.youtube.com/watch?v=abcdefGHIJ1)"),
    "https://img.youtube.com/vi/abcdefGHIJ1/mqdefault.jpg"
  );
  assert.equal(
    findWebImage('<iframe src="https://www.youtube.com/embed/abcdefGHIJ1"></iframe>'),
    "https://img.youtube.com/vi/abcdefGHIJ1/mqdefault.jpg"
  );
  assert.equal(
    findWebImage("![](https://example.com/a.png)"),
    "https://example.com/a.png"
  );
  assert.equal(findWebImage("![](https://example.com/page)"), null);
  assert.equal(findWebImage("no images"), null);
});

test("the preview store reads each note once, two at a time, and skips unneeded cards", async () => {
  const files = ["a", "b", "c", "d"].map(
    (name) => new TFile(`${name}.md`, { size: 10 })
  );
  let active = 0;
  let maxActive = 0;
  let reads = 0;
  const app = {
    vault: {
      getAbstractFileByPath: (path) => files.find((f) => f.path === path) ?? null,
      cachedRead: async (file) => {
        reads++;
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return `body of ${file.basename}`;
      },
      getResourcePath: (file) => `app://${file.path}`,
    },
    metadataCache: {
      getFileCache: () => null,
      getFirstLinkpathDest: () => null,
    },
  };
  const store = new PreviewStore(app);
  const needed = () => true;
  const results = await Promise.all([
    store.read(files[0], needed),
    store.read(files[0], needed),
    store.read(files[1], needed),
    store.read(files[2], needed),
    store.read(files[3], () => false),
  ]);
  assert.equal(results[0].text, "body of a");
  assert.equal(results[1], results[0]);
  assert.equal(results[4], null, "a card that left the screen is not read");
  assert.equal(reads, 3);
  assert.ok(maxActive <= 2);
  assert.equal((await store.read(files[0], needed)).text, "body of a");
  assert.equal(reads, 3, "a remembered preview is not read again");
  files[0].stat.mtime += 1;
  await store.read(files[0], needed);
  assert.equal(reads, 4, "an edited note is read again");
  store.dispose();
});

// Exercise the component's observer, async reads and rendered markup without
// a browser. This does not measure layout or browser image-memory release.
async function createLinkViewFixture(t, getPreview, withObserver = true) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { matchMedia: () => ({ matches: true }) },
  });
  t.after(() => {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      delete globalThis.window;
    }
  });

  let notify;
  let disconnected = false;
  const ownerWindow = {};
  if (withObserver) {
    ownerWindow.IntersectionObserver = class {
      constructor(callback) { notify = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    };
  }
  const card = new LinkView({
    fileEntity: { targetPath: "Card.md", linkText: "Card", sourcePath: "Note.md" },
    getTitle: async () => "Card title",
    getPreview,
    onClick: async () => {},
    app: {},
  });
  card.cardRef.current = { ownerDocument: { defaultView: ownerWindow } };
  card.setState = (change) => {
    const previous = card.state;
    card.state = {
      ...card.state,
      ...(typeof change === "function" ? change(card.state, card.props) : change),
    };
    card.componentDidUpdate(card.props, previous);
  };
  let unmounted = false;
  const unmount = () => {
    if (unmounted) return;
    unmounted = true;
    card.componentWillUnmount();
  };
  t.after(unmount);
  card.componentDidMount();
  await flushCardRead();
  return {
    near: (isIntersecting) => notify([{ isIntersecting }]),
    markup: () => renderToStaticMarkup(card.render()),
    disconnected: () => disconnected,
    unmount,
  };
}

function flushCardRead() {
  return new Promise((resolve) => setImmediate(resolve));
}

const cardPreviewFixture = {
  text: "A short excerpt",
  imageUrl: "app://fixture/card.png",
};

test("card images leave the viewport without losing their frame or cached preview", async (t) => {
  let reads = 0;
  const card = await createLinkViewFixture(t, async () => {
    reads++;
    return cardPreviewFixture;
  });
  assert.doesNotMatch(card.markup(), /<img\b/);
  assert.equal(reads, 0, "offscreen cards do not start a preview read");
  card.near(true);
  await flushCardRead();
  const visible = card.markup();
  assert.match(visible, /<img\b/);
  card.near(false);
  const offscreen = card.markup();
  assert.doesNotMatch(offscreen, /<img\b/);
  assert.equal(offscreen, visible.replace(/<img\b[^>]*>/, ""),
    "only the image leaves; the media frame, title and excerpt stay");
  card.near(true);
  await flushCardRead();
  assert.equal(card.markup(), visible, "the same image URL and text return");
  assert.equal(reads, 1, "returning to a loaded card does not reread its note");
});

test("a preview finishing offscreen keeps its text and frame without adding an image", async (t) => {
  let finish;
  const card = await createLinkViewFixture(t, () => new Promise((resolve) => { finish = resolve; }));
  card.near(true);
  card.near(false);
  finish(cardPreviewFixture);
  await flushCardRead();
  const offscreen = card.markup();
  assert.doesNotMatch(offscreen, /<img\b/);
  assert.match(offscreen, /twohop-links-box-media/);
  assert.match(offscreen, /A short excerpt/);
  card.near(true);
  assert.match(card.markup(), /<img\b[^>]*src="app:\/\/fixture\/card.png"/);
});

test("cards keep the existing image fallback when viewport observation is unavailable", async (t) => {
  const card = await createLinkViewFixture(t, async () => cardPreviewFixture, false);
  assert.match(card.markup(), /<img\b/);
});

test("a preview finishing after unmount does not restore the card image", async (t) => {
  let finish;
  const card = await createLinkViewFixture(t, () => new Promise((resolve) => { finish = resolve; }));
  card.near(true);
  card.unmount();
  const atUnmount = card.markup();
  finish(cardPreviewFixture);
  await flushCardRead();
  assert.equal(card.markup(), atUnmount);
  assert.equal(card.disconnected(), true);
});

test("the side pane listens for link clicks once, however often it updates", async () => {
  const note = new TFile("Note.md");
  const target = new TFile("Target.md");
  const opened = [];
  const listeners = [];
  const containerEl = {
    addClass() {},
    addEventListener: (type, callback) => listeners.push({ type, callback }),
    contains: () => true,
  };
  const app = {
    workspace: {
      getLeaf: () => ({ openFile: async (file) => opened.push(file.path) }),
      getActiveFile: () => note,
      on: () => ({}),
      activeLeaf: null,
    },
    metadataCache: { on: () => ({}), getFileCache: () => null },
    vault: {
      on: () => ({}),
      getAbstractFileByPath: (path) => (path === target.path ? target : null),
    },
  };
  const plugin = {
    whenWorkspaceLayoutReady() {},
    prepareLinksForFile: () => "related",
    injectTwohopLinks() {},
  };
  const links = {
    cancelActiveGather() {},
    gatherTwoHopLinks: async () => ({ links: [], newLinks: [], twoHopLinks: [], tagLinksList: [] }),
  };
  const view = new SeparatePaneView({ app, containerEl }, plugin, links);
  await view.onOpen();
  await view.updateOrForceUpdate(true);
  await view.updateOrForceUpdate(true);
  await view.updateOrForceUpdate(true);
  const clicks = listeners.filter((listener) => listener.type === "click");
  assert.equal(clicks.length, 1);

  let prevented = false;
  const anchor = { getAttribute: () => "Target.md" };
  clicks[0].callback({
    target: { closest: () => anchor },
    preventDefault: () => {
      prevented = true;
    },
  });
  await flushCardRead();
  assert.equal(prevented, true);
  assert.deepEqual(opened, ["Target.md"]);
});

function createThumbnailFixture({ isMobile = false, make } = {}) {
  const images = new Map(
    [
      new TFile("img/photo.jpg", { size: 1_500_000 }),
      new TFile("img/small.png", { size: 4_000 }),
      new TFile("img/other.jpg", { size: 900_000 }),
      new TFile("img/anim.gif", { size: 800_000 }),
    ].map((file) => [file.path, file])
  );
  const reads = [];
  const created = [];
  const revoked = [];
  const app = {
    vault: {
      getAbstractFileByPath: (path) => images.get(path) ?? null,
      readBinary: async (file) => {
        reads.push(file.path);
        return new ArrayBuffer(8);
      },
    },
  };
  const thumbnails = new CardThumbnails(app, {
    isMobile,
    pixelRatio: () => 3,
    makeThumbnail:
      make ??
      (async (_data, type, width, height) => {
        if (type === "image/png") return "original";
        return { type, width, height };
      }),
    createObjectUrl: (blob) => {
      const url = `blob:${created.length}`;
      created.push({ url, blob });
      return url;
    },
    revokeObjectUrl: (url) => revoked.push(url),
  });
  return { thumbnails, images, reads, created, revoked };
}

test("card thumbnails are made once, at card size, and freed when unused", async () => {
  const { thumbnails, reads, created, revoked } = createThumbnailFixture();
  const first = thumbnails.acquire("img/photo.jpg", "app://photo.jpg");
  const second = thumbnails.acquire("img/photo.jpg", "app://photo.jpg");
  assert.equal(first.url, undefined, "not ready before it is made");
  assert.equal(await first.ready, "blob:0");
  assert.equal(await second.ready, "blob:0");
  assert.deepEqual(reads, ["img/photo.jpg"], "the image is read and decoded once");
  // A 320 x 120 CSS box at most, at a pixel ratio capped at 2.
  assert.deepEqual(created[0].blob, { type: "image/jpeg", width: 640, height: 240 });
  assert.equal(thumbnails.acquire("img/photo.jpg", "app://photo.jpg").url, "blob:0",
    "a made thumbnail is available at once");

  const small = thumbnails.acquire("img/small.png", "app://small.png");
  assert.equal(await small.ready, "app://small.png", "a small image is shown as it is");
  const gif = thumbnails.acquire("img/anim.gif", "app://anim.gif");
  assert.equal(await gif.ready, "app://anim.gif", "GIFs keep the original (and animation)");

  first.release();
  second.release();
  thumbnails.dispose();
  assert.deepEqual(revoked, ["blob:0"], "unloading revokes the blob URLs");
  assert.equal(thumbnails.size, 0);
});

test("only thumbnails no card uses are dropped, and their URLs revoked", async () => {
  const { thumbnails, images, revoked } = createThumbnailFixture();
  const leases = [];
  for (let index = 0; index < 160; index++) {
    const path = `img/many-${index}.jpg`;
    images.set(path, new TFile(path, { size: 10_000 }));
    leases.push(thumbnails.acquire(path, `app://${path}`));
  }
  await Promise.all(leases.map((lease) => lease.ready));
  assert.equal(thumbnails.size, 160, "thumbnails in use stay");
  assert.equal(revoked.length, 0);
  for (const lease of leases.slice(0, 20)) lease.release();
  assert.equal(thumbnails.size, 150);
  assert.deepEqual(revoked, Array.from({ length: 10 }, (_, i) => `blob:${i}`));
  thumbnails.dispose();
});

test("without a thumbnail, cards fall back to the original, on mobile only when small", async () => {
  const failing = async () => {
    throw new Error("unsupported");
  };
  const desktop = createThumbnailFixture({ make: failing });
  assert.equal(
    await desktop.thumbnails.acquire("img/photo.jpg", "app://photo.jpg").ready,
    "app://photo.jpg"
  );
  const mobile = createThumbnailFixture({ isMobile: true, make: async () => null });
  assert.ok(1_500_000 > MOBILE_MAX_ORIGINAL_BYTES);
  assert.equal(
    await mobile.thumbnails.acquire("img/photo.jpg", "app://photo.jpg").ready,
    null,
    "a large original is not loaded on a phone"
  );
  mobile.images.set("img/tiny.jpg", new TFile("img/tiny.jpg", { size: 100_000 }));
  assert.equal(
    await mobile.thumbnails.acquire("img/tiny.jpg", "app://tiny.jpg").ready,
    "app://tiny.jpg"
  );
});

test("cards show the thumbnail of a local image and let it go offscreen", async (t) => {
  const fixture = createThumbnailFixture();
  setCardThumbnails(fixture.thumbnails);
  t.after(() => setCardThumbnails(null));
  const card = await createLinkViewFixture(t, async () => ({
    text: "Photo note",
    imageUrl: "app://photo.jpg",
    imagePath: "img/photo.jpg",
  }));
  card.near(true);
  await flushCardRead();
  await flushCardRead();
  assert.match(card.markup(), /<img\b[^>]*src="blob:0"/);
  card.near(false);
  assert.doesNotMatch(card.markup(), /<img\b/);
  assert.match(card.markup(), /twohop-links-box-media/);
  card.near(true);
  assert.match(card.markup(), /<img\b[^>]*src="blob:0"/, "the kept thumbnail returns at once");
  assert.deepEqual(fixture.reads, ["img/photo.jpg"]);
  card.unmount();
  fixture.thumbnails.dispose();
});

test("a card without a possible image drops its empty image frame", async (t) => {
  const fixture = createThumbnailFixture({ isMobile: true, make: async () => null });
  setCardThumbnails(fixture.thumbnails);
  t.after(() => setCardThumbnails(null));
  const card = await createLinkViewFixture(t, async () => ({
    text: "Photo note",
    imageUrl: "app://photo.jpg",
    imagePath: "img/photo.jpg",
  }));
  card.near(true);
  await flushCardRead();
  await flushCardRead();
  assert.doesNotMatch(card.markup(), /twohop-links-box-media/);
  assert.match(card.markup(), /Photo note/);
});

test("a card's popup opens off a free corner and barely covers its neighbours", () => {
  const viewport = { width: 1600, height: 1000 };
  const card = { left: 300, right: 440, top: 100, bottom: 320 };

  const high = placePopover(card, viewport, true);
  assert.deepEqual(
    [high.left, high.top, high.isAbove],
    [420, 300, false],
    "bottom-right corner, overlapping it by 20 px"
  );
  // The card to the right (from x = 448) and the card below (from y = 328)
  // are covered only in their corner.
  assert.ok(high.top >= card.bottom - 20 && high.left >= card.right - 20);

  const low = placePopover(
    { left: 300, right: 440, top: 700, bottom: 920 },
    viewport,
    true
  );
  assert.equal(low.isAbove, true, "near the bottom it opens upward");
  assert.equal(low.top + low.height, 720, "off the top-right corner");
  assert.equal(low.left, 420);

  const rightEdge = placePopover(
    { left: 1300, right: 1440, top: 100, bottom: 320 },
    viewport,
    true
  );
  assert.equal(rightEdge.left + rightEdge.width, 1320, "off the left corner at the right edge");
  assert.equal(rightEdge.isAbove, false);
});

test("a link's popup goes below or above the link, wherever there is room", () => {
  const viewport = { width: 1600, height: 1000 };
  const below = placePopover(
    { left: 500, right: 560, top: 100, bottom: 118 },
    viewport,
    false
  );
  assert.equal(below.top, 122);
  assert.equal(below.height, 600);

  const above = placePopover(
    { left: 500, right: 560, top: 900, bottom: 918 },
    viewport,
    false
  );
  assert.equal(above.top + above.height, 896);
  assert.equal(above.isAbove, true);
  assert.equal(below.isAbove, false);

  const middle = placePopover(
    { left: 500, right: 560, top: 450, bottom: 468 },
    { width: 1600, height: 800 },
    false
  );
  assert.ok(middle.top >= 8 && middle.top + middle.height <= 792);
  assert.ok(middle.height >= 240, "shrinks to the larger free space");
});

test("a hovered note's popup lists its Links without the open note", async () => {
  const { app, files } = cosenseVault();
  const links = new Links(app, createSettings());
  const forD = links.getHoverLinks(files.get("D.md"), "A.md");
  assert.deepEqual(titlesOf(forD), ["B", "C"], "equal ties fall back to the title");
  const forB = links.getHoverLinks(files.get("B.md"), "A.md");
  assert.deepEqual(titlesOf(forB).sort(), ["D", "F", "H"]);
  assert.equal(links.getHoverLinks(files.get("B.md"), "A.md", 2).length, 2);
  assert.equal(links.getPerformanceStats().resultComputations, 0, "no gather started");
});

test("hover-only popups wait for a resting pointer and stay away while typing or dragging", () => {
  const base = { trigger: "hover", isMod: false, buttons: 0, msSinceTyping: 5000 };
  assert.equal(hoverOpenDelay(base), 300);
  assert.equal(hoverOpenDelay({ ...base, buttons: 1 }), null, "dragging or selecting");
  assert.equal(hoverOpenDelay({ ...base, msSinceTyping: 400 }), null, "just typed");
  assert.equal(hoverOpenDelay({ ...base, isMod: true, msSinceTyping: 0 }), 60, "Cmd is quick");
  assert.equal(hoverOpenDelay({ ...base, trigger: "mod" }), null, "default needs Cmd");
  assert.equal(hoverOpenDelay({ ...base, trigger: "mod", isMod: true }), 60);
});

test("related cards sit above, below, or on the side away from the pointer", () => {
  assert.equal(cardsBelowPreview("above", false), false);
  assert.equal(cardsBelowPreview("above", true), false);
  assert.equal(cardsBelowPreview("below", false), true);
  assert.equal(cardsBelowPreview("below", true), true);
  assert.equal(cardsBelowPreview("auto", false), true, "popup below the pointer: cards at its far bottom");
  assert.equal(cardsBelowPreview("auto", true), false, "popup above the pointer: cards at its far top");
});

test("the title-bar button shows where it goes next", () => {
  assert.equal(inlineButtonState("links").icon, "arrow-down-to-line");
  assert.equal(inlineButtonState("links").isLit, false);
  assert.equal(inlineButtonState("top").icon, "arrow-up-to-line");
  assert.equal(inlineButtonState("top").isLit, true, "lit while the 2-hop links are in view");
  assert.equal(paneButtonState({ side: "right", showing: false }).icon, "arrow-right-to-line");
  assert.equal(paneButtonState({ side: "left", showing: false }).icon, "arrow-left-to-line");
  const close = paneButtonState({ side: "left", showing: true });
  assert.deepEqual([close.icon, close.destination, close.isLit], ["x", "pane-close", true]);
});
