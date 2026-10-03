import { TFile } from "obsidian";

export function createSyntheticApp({
  fileCount = 1000,
  linksPerFile = 8,
  canvasContent,
} = {}) {
  const files = Array.from(
    { length: fileCount },
    (_, index) => new TFile(`notes/note-${String(index).padStart(5, "0")}.md`, {
      mtime: 1_700_000_000_000 + index * 1000,
      ctime: 1_600_000_000_000 + index * 1000,
      size: 100 + index,
    })
  );
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const resolvedLinks = {};
  const caches = new Map();

  for (let sourceIndex = 0; sourceIndex < fileCount; sourceIndex++) {
    const source = files[sourceIndex];
    const outgoing = {};
    const links = [];
    const seen = new Set();

    for (let linkIndex = 0; linkIndex < linksPerFile; linkIndex++) {
      let targetIndex =
        (sourceIndex * 31 + linkIndex * 17 + 1) % Math.max(1, fileCount);
      if (targetIndex === sourceIndex && fileCount > 1) {
        targetIndex = (targetIndex + 1) % fileCount;
      }
      if (seen.has(targetIndex)) continue;
      seen.add(targetIndex);
      const target = files[targetIndex];
      outgoing[target.path] = 1;
      links.push({
        link: target.path.replace(/\.md$/, ""),
        position: { start: { offset: linkIndex * 20, line: linkIndex } },
      });
    }

    resolvedLinks[source.path] = outgoing;
    caches.set(source.path, { links, tags: [], frontmatter: {} });
  }

  let canvasFile = null;
  let resolveCanvasRead = null;
  let canvasReadPromise = null;
  if (canvasContent !== undefined) {
    canvasFile = new TFile("boards/test.canvas", { size: 500 });
    filesByPath.set(canvasFile.path, canvasFile);
    canvasReadPromise = new Promise((resolve) => {
      resolveCanvasRead = resolve;
    });
  }

  const counters = {
    getFileCache: 0,
    resolveLink: 0,
    vaultRead: 0,
    cachedRead: 0,
    adapterStat: 0,
  };

  const app = {
    vault: {
      getMarkdownFiles: () => files,
      getFiles: () => (canvasFile ? files.concat(canvasFile) : files),
      getAbstractFileByPath: (path) => filesByPath.get(path) ?? null,
      read: async () => {
        counters.vaultRead++;
        if (canvasReadPromise) return canvasReadPromise;
        return canvasContent ?? '{"nodes":[]}';
      },
      cachedRead: async () => {
        counters.cachedRead++;
        return "";
      },
      create: async (path) => new TFile(path),
      adapter: {
        stat: async (path) => {
          counters.adapterStat++;
          return filesByPath.get(path)?.stat ?? null;
        },
      },
    },
    metadataCache: {
      resolvedLinks,
      unresolvedLinks: {},
      getFileCache: (file) => {
        counters.getFileCache++;
        return caches.get(file.path) ?? null;
      },
      getFirstLinkpathDest: (linkText) => {
        counters.resolveLink++;
        const normalized = linkText.endsWith(".md")
          ? linkText
          : `${linkText}.md`;
        return filesByPath.get(normalized) ?? null;
      },
    },
  };

  return {
    app,
    files,
    counters,
    resolveCanvasRead: () => resolveCanvasRead?.(canvasContent ?? '{"nodes":[]}'),
  };
}

export function createSettings(overrides = {}) {
  return {
    autoLoadTwoHopLinks: true,
    showForwardConnectedLinks: true,
    showBackwardConnectedLinks: true,
    showTwohopLinks: true,
    showNewLinks: true,
    showTagsLinks: false,
    showImage: false,
    excludePaths: [],
    initialBoxCount: 10,
    initialSectionCount: 20,
    enableDuplicateRemoval: true,
    sortOrder: "related",
    showTwoHopLinksInSeparatePane: false,
    excludeTags: [],
    panePositionIsRight: false,
    showFullPathInLinkCards: false,
    includeBodyInCardSearch: false,
    refreshDebounceMs: 200,
    frontmatterPropertyKeyAsTitle: "",
    ...overrides,
  };
}

/**
 * A small vault described note by note: { "A": { links: ["B", "Missing"],
 * mtime, tags: ["topic"] } }. Links resolve by note name; unknown names stay
 * unresolved, like Obsidian.
 */
export function createLinkedApp(notes) {
  const files = new Map();
  for (const [name, note] of Object.entries(notes)) {
    files.set(
      `${name}.md`,
      new TFile(`${name}.md`, {
        mtime: note.mtime ?? 1_700_000_000_000,
        ctime: note.ctime ?? note.mtime ?? 1_600_000_000_000,
      })
    );
  }
  const resolve = (linkText) => files.get(`${linkText.replace(/#.*$/, "")}.md`) ?? null;
  const resolvedLinks = {};
  const unresolvedLinks = {};
  const caches = new Map();
  const rebuild = () => {
    for (const key of Object.keys(resolvedLinks)) delete resolvedLinks[key];
    for (const key of Object.keys(unresolvedLinks)) delete unresolvedLinks[key];
    for (const [name, note] of Object.entries(notes)) {
      const path = `${name}.md`;
      const links = (note.links ?? []).map((link, index) => ({
        link,
        position: { start: { offset: index * 10, line: index } },
      }));
      caches.set(path, {
        links,
        tags: (note.tags ?? []).map((tag, index) => ({
          tag: `#${tag}`,
          position: { start: { offset: 1000 + index } },
        })),
        frontmatter: {},
      });
      resolvedLinks[path] = {};
      unresolvedLinks[path] = {};
      for (const { link } of links) {
        const target = resolve(link);
        if (target) resolvedLinks[path][target.path] = 1;
        else unresolvedLinks[path][link] = 1;
      }
    }
  };
  rebuild();

  const app = {
    vault: {
      getMarkdownFiles: () => Array.from(files.values()),
      getFiles: () => Array.from(files.values()),
      getAbstractFileByPath: (path) => files.get(path) ?? null,
      read: async () => '{"nodes":[]}',
      cachedRead: async () => "",
    },
    metadataCache: {
      resolvedLinks,
      unresolvedLinks,
      getFileCache: (file) => caches.get(file.path) ?? null,
      getFirstLinkpathDest: (linkText) => resolve(linkText),
    },
  };
  return { app, files, notes, rebuild };
}
