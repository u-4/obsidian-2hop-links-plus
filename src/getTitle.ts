import { FileEntity } from "./model/FileEntity";
import { removeBlockReference } from "./utils";
import { TFile } from "obsidian";
import type TwohopLinksPlugin from "./main";

export async function getTitle(
  this: TwohopLinksPlugin,
  fileEntity: FileEntity
): Promise<string> {
  const linkText = removeBlockReference(fileEntity.linkText);
  const fallbackTitle = getFallbackTitle.call(this, fileEntity, linkText);

  if (!this.settings.frontmatterPropertyKeyAsTitle) return fallbackTitle;
  const abstractFile = fileEntity.targetPath
    ? this.app.vault.getAbstractFileByPath(fileEntity.targetPath)
    : null;
  const file =
    abstractFile instanceof TFile
      ? abstractFile
      : this.app.metadataCache.getFirstLinkpathDest(
          linkText,
          fileEntity.sourcePath
        );

  if (file == null) return fallbackTitle;
  if (!file.extension?.match(/^(md|markdown)$/)) return fallbackTitle;

  const metadata = this.app.metadataCache.getFileCache(file);

  if (!metadata?.frontmatter) return fallbackTitle;

  const title =
    metadata.frontmatter[this.settings.frontmatterPropertyKeyAsTitle];
  if (typeof title === "string") return title;
  if (Array.isArray(title)) {
    const titleText = title
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .join(", ");
    return titleText || fallbackTitle;
  }

  return fallbackTitle;
}

function getFallbackTitle(
  this: TwohopLinksPlugin,
  fileEntity: FileEntity,
  linkText: string
): string {
  if (this.settings.showFullPathInLinkCards) {
    return removeBlockReference(fileEntity.targetPath ?? linkText).replace(
      /\.md$/i,
      ""
    );
  }

  const abstractFile = fileEntity.targetPath
    ? this.app.vault.getAbstractFileByPath(fileEntity.targetPath)
    : null;

  if (abstractFile instanceof TFile) return abstractFile.basename;

  return linkText.replace(/\.md$/i, "").replace(/.*\//, "");
}
