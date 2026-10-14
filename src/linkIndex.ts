import type { App, CachedMetadata, TFile } from "obsidian";
import { getFrontmatterLinks } from "./obsidianCompat";
import { removeBlockReference } from "./utils";
import {
  CooperativeTask,
  runSteps,
  runStepsCooperatively,
  Steps,
} from "./performance";

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

/** The lower-cased note name a link or path ends in, as links match it. */
export function noteNameOf(pathOrLinkText: string): string {
  return (pathOrLinkText.split("/").pop() ?? "")
    .replace(/\.md$/i, "")
    .toLowerCase();
}

function noteNameOfKey(key: LinkKey): string {
  return noteNameOf(key.slice(2));
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
 * re-resolved, or that were created, deleted or renamed (and the notes whose
 * links name them), are updated. Note bodies are never read.
 */
export class LinkIndex {
  private readonly outKeys = new Map<string, Set<LinkKey>>();
  private readonly sources = new Map<LinkKey, Set<string>>();
  private readonly tagsByPath = new Map<string, string[]>();
  private readonly pathsByTag = new Map<string, Set<string>>();
  private readonly orderedKeys = new Map<string, LinkKey[]>();
  private readonly dirtyPaths = new Set<string>();
  /** Names of notes created, deleted or renamed since the last update. */
  private readonly changedNames = new Set<string>();
  private needsRebuild = true;
  /** A rebuild in progress; whoever needs the index next carries it on. */
  private build: Steps<void> | null = null;
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

  /**
   * A note was created. It is read before the next query, and so is every
   * note whose link names it: such links may now resolve to it.
   */
  noteCreated(path: string): void {
    this.markDirty(path);
    this.changedNames.add(noteNameOf(path));
  }

  /**
   * A note was deleted. Its entries are dropped before the next query, and
   * notes linking to it or to its name are read again.
   */
  noteDeleted(path: string): void {
    this.markDirty(path);
    this.changedNames.add(noteNameOf(path));
  }

  noteRenamed(oldPath: string, newPath: string): void {
    this.noteDeleted(oldPath);
    this.noteCreated(newPath);
  }

  /** Everything may have changed (a folder was renamed); rebuild it all. */
  markAllDirty(): void {
    this.needsRebuild = true;
    this.dirtyPaths.clear();
    this.changedNames.clear();
    this.orderedKeys.clear();
  }

  /** Link targets the index holds for the note now, without updating it. */
  peekOutKeys(path: string): ReadonlySet<LinkKey> {
    return this.outKeys.get(path) ?? EMPTY_SET;
  }

  /** Tags the index holds for the note now, without updating it. */
  peekTags(path: string): readonly string[] {
    return this.tagsByPath.get(path) ?? EMPTY_ARRAY;
  }

  /**
   * Whether this metadata gives the note other links or tags than the index
   * holds. Used for a note's first change in a session, when there is no
   * earlier signature to compare with. Unsure cases count as different.
   */
  differsFrom(path: string, cache: CachedMetadata | null | undefined): boolean {
    if (this.needsRebuild || this.build || this.dirtyPaths.has(path)) {
      return true;
    }
    const keys = new Set(cache ? this.resolveReferences(cache, path) : []);
    keys.delete(fileLinkKey(path));
    if (!sameMembers(keys, this.peekOutKeys(path))) return true;
    return !sameMembers(new Set(expandTags(cache)), new Set(this.peekTags(path)));
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
    runSteps(this.freshen());
  }

  /**
   * Same as ensureFresh, but a full build gives the main thread back between
   * slices and stops at a checkpoint when the task is cancelled. A build left
   * unfinished is carried on by the next caller.
   */
  ensureFreshAsync(task: CooperativeTask): Promise<void> {
    return runStepsCooperatively(this.freshen(), task);
  }

  private *freshen(): Steps<void> {
    for (;;) {
      if (this.needsRebuild) {
        this.needsRebuild = false;
        this.build = this.rebuildSteps();
      }
      const build = this.build;
      if (!build) break;
      const step = build.next();
      if (step.done) {
        if (this.build === build) this.build = null;
        continue;
      }
      yield step.value;
    }
    if (this.changedNames.size > 0) {
      // Links written as that name may now resolve differently.
      for (const [key, paths] of this.sources) {
        if (!this.changedNames.has(noteNameOfKey(key))) continue;
        for (const path of paths) this.markDirty(path);
      }
      this.changedNames.clear();
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

  private *rebuildSteps(): Steps<void> {
    const startedAt = Date.now();
    this.outKeys.clear();
    this.sources.clear();
    this.tagsByPath.clear();
    this.pathsByTag.clear();
    this.orderedKeys.clear();
    this.dirtyPaths.clear();
    this.changedNames.clear();

    const { resolvedLinks, unresolvedLinks } = this.app.metadataCache;
    const paths = new Set<string>([
      ...Object.keys(resolvedLinks ?? {}),
      ...Object.keys(unresolvedLinks ?? {}),
    ]);
    for (const path of paths) {
      const keys = this.readOutKeys(path);
      this.setOutKeys(path, keys);
      yield 1 + keys.size;
    }
    for (const file of this.app.vault.getMarkdownFiles()) {
      this.setTags(
        file.path,
        expandTags(this.app.metadataCache.getFileCache(file))
      );
      yield 1;
    }
    this.stats.builds++;
    this.stats.lastBuildMs = Math.max(0, Date.now() - startedAt);
  }

  private updatePath(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !("extension" in file)) {
      // Deleted or renamed away: nothing may still show it.
      this.setOutKeys(path, new Set());
      this.setTags(path, []);
      this.orderedKeys.delete(path);
      return;
    }
    this.setOutKeys(path, this.readOutKeys(path));
    this.setTags(
      path,
      expandTags(this.app.metadataCache.getFileCache(file as TFile))
    );
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

function sameMembers<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

const EMPTY_SET: ReadonlySet<never> = new Set();
const EMPTY_ARRAY: readonly never[] = [];
