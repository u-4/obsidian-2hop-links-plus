import { App, TFile } from "obsidian";
import { FileEntity } from "./model/FileEntity";
import { PropertiesLinks } from "./model/PropertiesLinks";
import { TwohopLink } from "./model/TwohopLink";
import { filePathToLinkText, removeBlockReference } from "./utils";

export function normalizeSearchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function filterFileEntities(
  app: App,
  fileEntities: FileEntity[],
  query: string,
  includeBody = true
): FileEntity[] {
  const tokens = normalizeSearchTokens(query);
  if (tokens.length === 0) return fileEntities;

  return fileEntities.filter((entity) =>
    matchesTokens(buildCardSearchText(app, entity, includeBody), tokens)
  );
}

export function filterTwoHopLinks(
  app: App,
  twoHopLinks: TwohopLink[],
  query: string,
  includeBody = true
): TwohopLink[] {
  const tokens = normalizeSearchTokens(query);
  if (tokens.length === 0) return twoHopLinks;

  return twoHopLinks
    .map((link) => {
      const sectionMatches = matchesTokens(
        buildSectionSearchText(app, link.link),
        tokens
      );

      if (sectionMatches) return link;

      const fileEntities = link.fileEntities.filter((entity) =>
        matchesTokens(buildCardSearchText(app, entity, includeBody), tokens)
      );

      return new TwohopLink(link.link, fileEntities, {
        relatedScore: link.relatedScore,
        pageRank: link.pageRank,
        inDegree: link.inDegree,
        activeLinkOrder: link.activeLinkOrder,
      });
    })
    .filter((link) => link.fileEntities.length > 0);
}

export function filterPropertiesLinks(
  app: App,
  propertiesLinksList: PropertiesLinks[],
  query: string,
  includeBody = true
): PropertiesLinks[] {
  const tokens = normalizeSearchTokens(query);
  if (tokens.length === 0) return propertiesLinksList;

  return propertiesLinksList
    .map((propertiesLinks) => {
      const sectionText = `${propertiesLinks.key} ${propertiesLinks.property}`;
      if (matchesTokens(sectionText, tokens)) return propertiesLinks;

      const fileEntities = propertiesLinks.fileEntities.filter((entity) =>
        matchesTokens(buildCardSearchText(app, entity, includeBody), tokens)
      );

      return new PropertiesLinks(
        propertiesLinks.property,
        propertiesLinks.key,
        fileEntities
      );
    })
    .filter((propertiesLinks) => propertiesLinks.fileEntities.length > 0);
}

export function buildCardSearchText(
  app: App,
  entity: FileEntity,
  includeBody = true
): string {
  return buildFileEntitySearchText(app, entity, includeBody, true);
}

export function buildSectionSearchText(app: App, entity: FileEntity): string {
  return buildFileEntitySearchText(app, entity, false, false);
}

export function buildFileEntitySearchText(
  app: App,
  entity: FileEntity,
  includeBody = true,
  includeOutgoingLinks = true
): string {
  const file = resolveEntityFile(app, entity);
  const parts = [
    entity.linkText,
    entity.targetPath,
    entity.linkTextToReveal,
    entity.targetPathToReveal,
    includeBody ? entity.searchText : "",
    ...(entity.sharedLinks ?? []),
  ];

  if (file) {
    parts.push(file.path, file.basename);
    const cache = app.metadataCache.getFileCache(file);

    if (cache) {
      parts.push(...collectFrontmatterAliases(cache.frontmatter));
      parts.push(...collectFrontmatterTags(cache.frontmatter));
      parts.push(...(cache.tags ?? []).map((tag) => tag.tag));

      if (includeOutgoingLinks) {
        const references = [
          ...(cache.links ?? []),
          ...(cache.embeds ?? []),
          ...(((cache as any).frontmatterLinks as any[]) ?? []),
        ];

        for (const reference of references) {
          const link = removeBlockReference(reference.link);
          parts.push(link);
          const resolved = app.metadataCache.getFirstLinkpathDest(
            link,
            file.path
          );
          if (resolved) {
            parts.push(
              resolved.path,
              resolved.basename,
              filePathToLinkText(resolved.path)
            );
          }
        }
      }
    }
  }

  return parts
    .filter((part) => typeof part === "string")
    .join(" ")
    .toLowerCase();
}

function matchesTokens(text: string, tokens: string[]): boolean {
  const normalizedText = text.toLowerCase();
  return tokens.every((token) => normalizedText.includes(token));
}

function resolveEntityFile(app: App, entity: FileEntity): TFile | null {
  if (entity.targetPath) {
    const abstractFile = app.vault.getAbstractFileByPath(entity.targetPath);
    if (abstractFile instanceof TFile) return abstractFile;
  }

  const linkText = removeBlockReference(entity.linkText);
  return app.metadataCache.getFirstLinkpathDest(linkText, entity.sourcePath);
}

function collectFrontmatterAliases(frontmatter: any): string[] {
  if (!frontmatter) return [];
  return collectStringValues(frontmatter.aliases).concat(
    collectStringValues(frontmatter.alias)
  );
}

function collectFrontmatterTags(frontmatter: any): string[] {
  if (!frontmatter) return [];
  return collectStringValues(frontmatter.tags).map((tag) =>
    tag.replace(/^#/, "")
  );
}

function collectStringValues(value: any): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return [];
}
