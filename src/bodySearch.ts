import { App, TFile } from "obsidian";
import { FileEntity } from "./model/FileEntity";
import { PropertiesLinks } from "./model/PropertiesLinks";
import { TwohopLink } from "./model/TwohopLink";
import { removeBlockReference } from "./utils";

export const BODY_SEARCH_DEBOUNCE_MS = 200;
export const MAX_BODY_SEARCH_BYTES = 2 * 1000 * 1000;
export const MAX_BODY_SEARCH_CHARS = 500000;
export const MAX_BODY_SEARCH_CACHE_ENTRIES = 300;
export const MAX_BODY_SEARCH_CACHE_CHARS = 20_000_000;

interface BodySearchCacheEntry {
  mtime: number;
  size: number;
  text: string;
}

const bodySearchTextCache = new Map<string, BodySearchCacheEntry>();

interface VisibleCardSearchEntityParams {
  showLinks: boolean;
  showTwohopLinks: boolean;
  showNewLinks: boolean;
  showTagsLinks: boolean;
  links: FileEntity[];
  newLinks: FileEntity[];
  twoHopLinks: TwohopLink[];
  tagLinksList: PropertiesLinks[];
}

export function collectVisibleCardSearchEntities({
  showLinks,
  showTwohopLinks,
  showNewLinks,
  showTagsLinks,
  links,
  newLinks,
  twoHopLinks,
  tagLinksList,
}: VisibleCardSearchEntityParams): FileEntity[] {
  const entities: FileEntity[] = [];

  if (showLinks) {
    entities.push(...links);
  }
  if (showNewLinks) {
    entities.push(...newLinks);
  }
  if (showTwohopLinks) {
    for (const twoHopLink of twoHopLinks) {
      entities.push(...twoHopLink.fileEntities);
    }
  }
  if (showTagsLinks) {
    for (const propertiesLinks of tagLinksList) {
      entities.push(...propertiesLinks.fileEntities);
    }
  }

  return entities;
}

export async function populateBodySearchTexts(
  app: App,
  entities: FileEntity[]
): Promise<void> {
  const bodyTextByPath = new Map<string, string>();

  for (const entity of entities) {
    const file = resolveEntityFile(app, entity);
    if (!file || !file.extension?.match(/^(md|markdown)$/)) {
      entity.searchText = "";
      continue;
    }

    if (!bodyTextByPath.has(file.path)) {
      bodyTextByPath.set(file.path, await readBodySearchText(app, file));
    }

    entity.searchText = bodyTextByPath.get(file.path);
  }
}

function resolveEntityFile(app: App, entity: FileEntity): TFile | null {
  if (entity.targetPath) {
    const abstractFile = app.vault.getAbstractFileByPath(entity.targetPath);
    if (abstractFile instanceof TFile) return abstractFile;
  }

  return app.metadataCache.getFirstLinkpathDest(
    removeBlockReference(entity.linkText),
    entity.sourcePath
  );
}

async function readBodySearchText(app: App, file: TFile): Promise<string> {
  if (file.stat.size > MAX_BODY_SEARCH_BYTES) {
    return "";
  }

  const cached = bodySearchTextCache.get(file.path);
  if (
    cached &&
    cached.mtime === file.stat.mtime &&
    cached.size === file.stat.size
  ) {
    bodySearchTextCache.delete(file.path);
    bodySearchTextCache.set(file.path, cached);
    return cached.text;
  }
  if (cached) {
    bodySearchTextCache.delete(file.path);
  }

  try {
    const content = await app.vault.cachedRead(file);
    const text = content
      .replace(/^(.*\n)?---[\s\S]*?---\n?/m, " ")
      .slice(0, MAX_BODY_SEARCH_CHARS);
    bodySearchTextCache.set(file.path, {
      mtime: file.stat.mtime,
      size: file.stat.size,
      text,
    });
    pruneBodySearchCache();
    return text;
  } catch (error) {
    console.debug("Could not read body search text", file.path, error);
    bodySearchTextCache.delete(file.path);
    return "";
  }
}

function pruneBodySearchCache(): void {
  let cachedChars = 0;
  for (const entry of bodySearchTextCache.values()) {
    cachedChars += entry.text.length;
  }

  while (
    bodySearchTextCache.size > MAX_BODY_SEARCH_CACHE_ENTRIES ||
    cachedChars > MAX_BODY_SEARCH_CACHE_CHARS
  ) {
    const oldestEntry = bodySearchTextCache.entries().next().value;
    if (!oldestEntry) break;

    const [oldestPath, entry] = oldestEntry;
    bodySearchTextCache.delete(oldestPath);
    cachedChars -= entry.text.length;
  }
}
