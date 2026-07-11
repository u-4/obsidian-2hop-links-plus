import { FileEntity } from "./FileEntity";

export class TwohopLink {
  public link: FileEntity;
  public fileEntities: FileEntity[];
  public relatedScore?: number;
  public pageRank?: number;
  public inDegree?: number;
  public activeLinkOrder?: number;

  constructor(
    link: FileEntity,
    fileEntities: FileEntity[],
    scores?: {
      relatedScore?: number;
      pageRank?: number;
      inDegree?: number;
      activeLinkOrder?: number;
    }
  ) {
    this.link = link;
    this.fileEntities = fileEntities;
    this.relatedScore = scores?.relatedScore;
    this.pageRank = scores?.pageRank;
    this.inDegree = scores?.inDegree;
    this.activeLinkOrder = scores?.activeLinkOrder;
  }
}
