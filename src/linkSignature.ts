import type { CachedMetadata } from "obsidian";

export interface LinkSignatureOptions {
  frontmatterKeys: string[];
  frontmatterPropertyKeyAsTitle: string;
}

/**
 * Summarizes everything in a note's metadata that the related-links view
 * depends on: links, embeds and frontmatter links in document order, tags, and
 * the frontmatter values used for properties sections and card titles.
 * Typing ordinary text leaves the signature unchanged.
 */
export function getLinkSignature(
  cache: CachedMetadata | null | undefined,
  options: LinkSignatureOptions
): string {
  if (!cache) {
    return "";
  }

  const references = [
    ...(cache.links ?? []),
    ...(cache.embeds ?? []),
  ]
    .slice()
    .sort(
      (a, b) =>
        (a.position?.start?.offset ?? 0) - (b.position?.start?.offset ?? 0)
    )
    .map((reference) => reference.link);
  const frontmatterLinks = (cache.frontmatterLinks ?? []).map(
    (link) => `${link.key}=${link.link}`
  );
  const tags = (cache.tags ?? []).map((tag) => tag.tag);
  const frontmatter = cache.frontmatter ?? {};
  const keys = [...options.frontmatterKeys];
  if (options.frontmatterPropertyKeyAsTitle) {
    keys.push(options.frontmatterPropertyKeyAsTitle);
  }
  keys.push("tags", "tag", "aliases", "alias");
  const frontmatterValues = keys.map(
    (key) => `${key}=${JSON.stringify(frontmatter[key] ?? null)}`
  );

  return [
    references.join("\u0001"),
    frontmatterLinks.join("\u0001"),
    tags.join("\u0001"),
    frontmatterValues.join("\u0001"),
  ].join("\u0002");
}

/**
 * Remembers the last signature seen for each note so metadata updates that do
 * not change links can be ignored.
 */
export class LinkSignatureTracker {
  private readonly signatures = new Map<string, string>();

  constructor(private readonly getOptions: () => LinkSignatureOptions) {}

  /** Records the note's signature and returns true when it changed. */
  update(path: string, cache: CachedMetadata | null | undefined): boolean {
    const next = getLinkSignature(cache, this.getOptions());
    const previous = this.signatures.get(path);
    this.signatures.set(path, next);
    return previous !== next;
  }

  /** Records the note's signature without reporting a change. */
  remember(path: string, cache: CachedMetadata | null | undefined): void {
    this.signatures.set(path, getLinkSignature(cache, this.getOptions()));
  }

  /** Records the note's signature only when none is known yet. */
  rememberIfUnknown(
    path: string,
    cache: CachedMetadata | null | undefined
  ): void {
    if (!this.signatures.has(path)) {
      this.remember(path, cache);
    }
  }

  delete(path: string): void {
    this.signatures.delete(path);
  }

  clear(): void {
    this.signatures.clear();
  }
}
