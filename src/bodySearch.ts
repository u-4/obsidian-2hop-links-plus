import { App, TFile } from "obsidian";
import { FileEntity } from "./model/FileEntity";
import { PropertiesLinks } from "./model/PropertiesLinks";
import { TwohopLink } from "./model/TwohopLink";
import { removeBlockReference } from "./utils";
import { getBodySearchPersistence } from "./bodySearchStore";

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

/** Body texts kept on this device between Obsidian sessions. */
export interface StoredBodyText {
  mtime: number;
  size: number;
  text: string;
}

export interface BodySearchPersistence {
  /** Stored texts by path; missing or unreadable ones are left out. */
  getMany(paths: string[]): Promise<Map<string, StoredBodyText>>;
  /** Stores a text; failures are ignored. */
  put(path: string, entry: StoredBodyText): void;
  /** The stored texts were used again (keeps them from being pruned). */
  touch(paths: string[]): void;
  close(): void;
}

export async function populateBodySearchTexts(
  app: App,
  entities: FileEntity[],
  persistence: BodySearchPersistence | null = getBodySearchPersistence(app)
): Promise<void> {
  const files = new Map<string, TFile>();
  const fileOfEntity = new Map<FileEntity, TFile>();
  for (const entity of entities) {
    const file = resolveEntityFile(app, entity);
    if (!file || !file.extension?.match(/^(md|markdown)$/)) {
      entity.searchText = "";
      continue;
    }
    files.set(file.path, file);
    fileOfEntity.set(entity, file);
  }

  const bodyTextByPath = new Map<string, string>();
  const misses: TFile[] = [];
  for (const file of files.values()) {
    const text = memoryBodySearchText(file);
    if (text === undefined) {
      misses.push(file);
    } else {
      bodyTextByPath.set(file.path, text);
    }
  }

  let unread = misses;
  if (persistence && misses.length > 0) {
    let stored = new Map<string, StoredBodyText>();
    try {
      stored = await persistence.getMany(misses.map((file) => file.path));
    } catch {
      // Fall back to reading the notes.
    }
    unread = [];
    const used: string[] = [];
    for (const file of misses) {
      const entry = stored.get(file.path);
      if (
        entry &&
        entry.mtime === file.stat.mtime &&
        entry.size === file.stat.size &&
        typeof entry.text === "string"
      ) {
        rememberBodySearchText(file, entry.text);
        bodyTextByPath.set(file.path, entry.text);
        used.push(file.path);
      } else {
        unread.push(file);
      }
    }
    if (used.length > 0) persistence.touch(used);
  }

  for (const file of unread) {
    bodyTextByPath.set(
      file.path,
      await readBodySearchText(app, file, persistence)
    );
  }

  for (const [entity, file] of fileOfEntity) {
    entity.searchText = bodyTextByPath.get(file.path) ?? "";
  }
}

/** Forgets the in-memory texts (the stored ones stay). */
export function clearBodySearchMemoryCache(): void {
  bodySearchTextCache.clear();
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

/** The remembered text for this version of the note, or undefined. */
function memoryBodySearchText(file: TFile): string | undefined {
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
  return undefined;
}

function rememberBodySearchText(file: TFile, text: string): void {
  bodySearchTextCache.set(file.path, {
    mtime: file.stat.mtime,
    size: file.stat.size,
    text,
  });
  pruneBodySearchCache();
}

async function readBodySearchText(
  app: App,
  file: TFile,
  persistence: BodySearchPersistence | null
): Promise<string> {
  try {
    const content = await app.vault.cachedRead(file);
    const text = content
      .replace(/^(.*\n)?---[\s\S]*?---\n?/m, " ")
      .slice(0, MAX_BODY_SEARCH_CHARS);
    rememberBodySearchText(file, text);
    persistence?.put(file.path, {
      mtime: file.stat.mtime,
      size: file.stat.size,
      text,
    });
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
