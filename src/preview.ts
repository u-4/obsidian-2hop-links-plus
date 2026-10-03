import { TFile } from "obsidian";
import { FileEntity } from "./model/FileEntity";
import { removeBlockReference } from "./utils";
import type { CardPreview } from "./cardPreview";
import type TwohopLinksPlugin from "./main";

const IMAGE_FILE_PATTERN = /\.(png|bmp|jpg|jpeg|webp|gif)$/i;

/**
 * The excerpt and image for a card. Note bodies are read through the shared
 * PreviewStore, only while the card still needs them.
 */
export async function readPreview(
  this: TwohopLinksPlugin,
  fileEntity: FileEntity,
  isNeeded: () => boolean
): Promise<CardPreview | null> {
  const linkText = removeBlockReference(fileEntity.linkText);
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
  if (!file) {
    return null;
  }
  if (IMAGE_FILE_PATTERN.test(file.path)) {
    return {
      text: "",
      imageUrl: this.settings.showImage
        ? this.app.vault.getResourcePath(file)
        : null,
    };
  }
  if (file.extension !== "md") {
    return { text: "", imageUrl: null };
  }
  const preview = await this.previewStore.read(file, isNeeded);
  if (!preview || this.settings.showImage) {
    return preview;
  }
  return { ...preview, imageUrl: null };
}
