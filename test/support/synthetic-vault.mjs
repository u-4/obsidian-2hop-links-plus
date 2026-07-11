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
    showPropertiesLinks: false,
    showImage: false,
    excludePaths: [],
    initialBoxCount: 10,
    initialSectionCount: 20,
    enableDuplicateRemoval: true,
    sortOrder: "relatedCosenseLike",
    showTwoHopLinksInSeparatePane: false,
    excludeTags: [],
    panePositionIsRight: false,
    createFilesForMultiLinked: false,
    showFullPathInLinkCards: false,
    includeBodyInCardSearch: false,
    refreshDebounceMs: 200,
    frontmatterPropertyKeyAsTitle: "",
    frontmatterKeys: [],
    ...overrides,
  };
}
