import { removeBlockReference } from "../utils";

export class FileEntity {
  public sourcePath: string;
  public linkText: string;
  public targetPath?: string;
  public targetPathToReveal?: string;
  public relatedScore?: number;
  public pageRank?: number;
  public inDegree?: number;
  public sharedLinks?: string[];
  public activeLinkOrder?: number;
  public searchText?: string;
  /**
   * Link that should be revealed in the file opened by this entity.
   *
   * Example: in a 2-hop section `[[A]]`, a card for page `B` should open
   * `B` and jump to the line where `B` links to `[[A]]`. In that case
   * `linkText` is `B` and `linkTextToReveal` is `A`.
   */
  public linkTextToReveal?: string;

  constructor(
    sourcePath: string,
    linkText: string,
    linkTextToReveal?: string,
    targetPath?: string,
    targetPathToReveal?: string
  ) {
    if (linkText == null) {
      throw new Error("linkText should not be null");
    }
    this.sourcePath = sourcePath;
    this.linkText = linkText;
    this.linkTextToReveal = linkTextToReveal;
    this.targetPath = targetPath;
    this.targetPathToReveal = targetPathToReveal;
  }

  // Key to de-duplication.
  key(): string {
    return removeBlockReference(this.targetPath ?? this.linkText);
  }
}
