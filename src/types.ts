export type OpenPaneTarget = "tab" | "split" | "window" | boolean;

import type { FileEntity } from "./model/FileEntity";
import type { CardPreview } from "./cardPreview";

export type GetCardPreview = (
  fileEntity: FileEntity,
  isNeeded: () => boolean
) => Promise<CardPreview | null>;
