import type { App, CachedMetadata, TFile } from "obsidian";
import { getFrontmatterLinks } from "./obsidianCompat";
import { removeBlockReference } from "./utils";

/**
 * Identifies a link target. Existing notes are keyed by path ("p:"), links to
 * notes that do not exist yet by their lower-cased link text ("u:"), so pages
 * that share the same missing link still group together.
 */
export type LinkKey = string;

export function fileLinkKey(path: string): LinkKey {
  return `p:${path}`;
}

export function unresolvedLinkKey(linkText: string): LinkKey {
  return `u:${normalizeUnresolvedLinkText(linkText)}`;
}

export function pathOfLinkKey(key: LinkKey): string | null {
  return key.startsWith("p:") ? key.slice(2) : null;
}

function normalizeUnresolvedLinkText(linkText: string): string {
  return removeBlockReference(linkText)
    .trim()
    .replace(/\.md$/i, "")
    .toLowerCase();
}

// Embeds of files Obsidian can attach. Other names with a period, such as
// "GPT-3.5" or "llama.cpp", are links to notes.
const ATTACHMENT_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "svg",
  "heic",
  "pdf",
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "flac",
  "webm",
  "3gp",
  "mp4",
  "mov",
  "mkv",
  "ogv",
  "canvas",
  "base",
]);

function isNoteLinkText(linkText: string): boolean {
  const name = removeBlockReference(linkText).split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return (
    dot < 0 || !ATTACHMENT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
  );
}

function isNotePath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

export function expandTags(cache: CachedMetadata | null | undefined): string[] {
  const tags: string[] = [];
  const addTag = (tag: string) => {
    const parts = tag.replace(/^#/, "").split("/");
    for (let i = 0; i < parts.length; i++) {
      tags.push(parts.slice(0, i + 1).join("/"));
    }
  };
  for (const tag of cache?.tags ?? []) {
    addTag(tag.tag);
  }
  const frontmatterTags = cache?.frontmatter?.tags;
  if (Array.isArray(frontmatterTags)) {
    for (const tag of frontmatterTags) {
      if (typeof tag === "string") addTag(tag);
    }
  } else if (typeof frontmatterTags === "string") {
    frontmatterTags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .forEach(addTag);
  }
  return Array.from(new Set(tags));
}

export interface LinkIndexStats {
  builds: number;
  patches: number;
  lastBuildMs: number;
}

/**
 * Who links where, for every note in the vault, built from Obsidian's resolved
 * and unresolved link tables. After the first build only notes that Obsidian
 * re-resolved are updated. Note bodies are never read.
 */
export class LinkIndex {
  private readonly outKeys = new Map<string, Set<LinkKey>>();
  private readonly sources = new Map<LinkKey, Set<string>>();
  private readonly tagsByPath = new Map<string, string[]>();
  private readonly pathsByTag = new Map<string, Set<string>>();
  private readonly orderedKeys = new Map<string, LinkKey[]>();
  private readonly dirtyPaths = new Set<string>();
  private needsRebuild = true;
  private readonly stats: LinkIndexStats = {
    builds: 0,
    patches: 0,
    lastBuildMs: 0,
  };

  constructor(private readonly app: App) {}

  /** The note's links were re-resolved; update it before the next query. */
  markDirty(path: string): void {
    this.dirtyPaths.add(path);
    this.orderedKeys.delete(path);
  }

  /** Notes were created, deleted or renamed; other notes' links may change. */
  markAllDirty(): void {
    this.needsRebuild = true;
    this.dirtyPaths.clear();
    this.orderedKeys.clear();
  }

  getStats(): LinkIndexStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats.builds = 0;
    this.stats.patches = 0;
    this.stats.lastBuildMs = 0;
  }

  ensureFresh(): void {
    if (this.needsRebuild) {
      this.rebuild();
      return;
    }
    if (this.dirtyPaths.size === 0) {
      return;
    }
    for (const path of this.dirtyPaths) {
      this.updatePath(path);
      this.stats.patches++;
    }
    this.dirtyPaths.clear();
  }

  /** Paths of notes that link to the target. */
  sourcesOf(key: LinkKey): ReadonlySet<string> {
    this.ensureFresh();
    return this.sources.get(key) ?? EMPTY_SET;
  }

  /** Number of notes that link to the note at this path. */
  linkedCount(path: string): number {
    return this.sourcesOf(fileLinkKey(path)).size;
  }

  outKeysOf(path: string): ReadonlySet<LinkKey> {
    this.ensureFresh();
    return this.outKeys.get(path) ?? EMPTY_SET;
  }

  tagsOf(path: string): readonly string[] {
    this.ensureFresh();
    return this.tagsByPath.get(path) ?? EMPTY_ARRAY;
  }

  pathsWithTag(tag: string): ReadonlySet<string> {
    this.ensureFresh();
    return this.pathsByTag.get(tag) ?? EMPTY_SET;
  }

  /** The note's link targets in the order they appear in the note. */
  orderedKeysOf(file: TFile): LinkKey[] {
    this.ensureFresh();
    const cached = this.orderedKeys.get(file.path);
    if (cached) {
      return cached;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const keys = cache ? this.resolveReferences(cache, file.path) : [];
    this.orderedKeys.set(file.path, keys);
    return keys;
  }

  /** Resolves a note's links, embeds and frontmatter links in note order. */
  resolveReferences(cache: CachedMetadata, sourcePath: string): LinkKey[] {
    const references = [...(cache.links ?? []), ...(cache.embeds ?? [])]
      .slice()
      .sort(
        (a, b) =>
          (a.position?.start?.offset ?? 0) - (b.position?.start?.offset ?? 0)
      )
      .map((reference) => reference.link);
    const keys: LinkKey[] = [];
    const seen = new Set<LinkKey>();
    for (const link of [
      ...getFrontmatterLinks(cache).map((reference) => reference.link),
      ...references,
    ]) {
      const key = this.resolveLinkKey(link, sourcePath);
      if (key && !seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
    return keys;
  }

  /** The key for a link written in sourcePath, or null for non-note files. */
  resolveLinkKey(link: string, sourcePath: string): LinkKey | null {
    const linkText = removeBlockReference(link);
    if (!linkText) {
      return null;
    }
    const target = this.app.metadataCache.getFirstLinkpathDest(
      linkText,
      sourcePath
    );
    if (target) {
      return isNotePath(target.path) ? fileLinkKey(target.path) : null;
    }
    return isNoteLinkText(linkText) ? unresolvedLinkKey(linkText) : null;
  }

  private rebuild(): void {
    const startedAt = Date.now();
    this.outKeys.clear();
    this.sources.clear();
    this.tagsByPath.clear();
    this.pathsByTag.clear();
    this.orderedKeys.clear();
    this.dirtyPaths.clear();
    this.needsRebuild = false;

    const { resolvedLinks, unresolvedLinks } = this.app.metadataCache;
    const paths = new Set<string>([
      ...Object.keys(resolvedLinks ?? {}),
      ...Object.keys(unresolvedLinks ?? {}),
    ]);
    for (const path of paths) {
      this.setOutKeys(path, this.readOutKeys(path));
    }
    for (const file of this.app.vault.getMarkdownFiles()) {
      this.setTags(
        file.path,
        expandTags(this.app.metadataCache.getFileCache(file))
      );
    }
    this.stats.builds++;
    this.stats.lastBuildMs = Math.max(0, Date.now() - startedAt);
  }

  private updatePath(path: string): void {
    this.setOutKeys(path, this.readOutKeys(path));
    const file = this.app.vault.getAbstractFileByPath(path);
    const cache =
      file && "extension" in file
        ? this.app.metadataCache.getFileCache(file as TFile)
        : null;
    this.setTags(path, expandTags(cache));
  }

  private readOutKeys(path: string): Set<LinkKey> {
    const keys = new Set<LinkKey>();
    const { resolvedLinks, unresolvedLinks } = this.app.metadataCache;
    for (const target of Object.keys(resolvedLinks?.[path] ?? {})) {
      if (isNotePath(target)) keys.add(fileLinkKey(target));
    }
    for (const linkText of Object.keys(unresolvedLinks?.[path] ?? {})) {
      if (isNoteLinkText(linkText)) keys.add(unresolvedLinkKey(linkText));
    }
    keys.delete(fileLinkKey(path));
    return keys;
  }

  private setOutKeys(path: string, next: Set<LinkKey>): void {
    const previous = this.outKeys.get(path);
    for (const key of previous ?? []) {
      if (!next.has(key)) {
        const set = this.sources.get(key);
        set?.delete(path);
        if (set && set.size === 0) this.sources.delete(key);
      }
    }
    for (const key of next) {
      if (!previous?.has(key)) {
        let set = this.sources.get(key);
        if (!set) {
          set = new Set();
          this.sources.set(key, set);
        }
        set.add(path);
      }
    }
    if (next.size > 0) {
      this.outKeys.set(path, next);
    } else {
      this.outKeys.delete(path);
    }
  }

  private setTags(path: string, next: string[]): void {
    for (const tag of this.tagsByPath.get(path) ?? []) {
      const set = this.pathsByTag.get(tag);
      set?.delete(path);
      if (set && set.size === 0) this.pathsByTag.delete(tag);
    }
    if (next.length === 0) {
      this.tagsByPath.delete(path);
      return;
    }
    this.tagsByPath.set(path, next);
    for (const tag of next) {
      let set = this.pathsByTag.get(tag);
      if (!set) {
        set = new Set();
        this.pathsByTag.set(tag, set);
      }
      set.add(path);
    }
  }
}

const EMPTY_SET: ReadonlySet<never> = new Set();
const EMPTY_ARRAY: readonly never[] = [];
