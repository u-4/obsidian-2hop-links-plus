import { Stat, TFile } from "obsidian";
import { FileEntity } from "./model/FileEntity";
import { PropertiesLinks } from "./model/PropertiesLinks";
import { TwohopLink } from "./model/TwohopLink";
import type { SortOrder } from "./settings/sortOptions";

type RankingKey = "relatedScore" | "pageRank" | "inDegree" | "activeLinkOrder";

type SortStat = Pick<Stat, "mtime" | "ctime">;
type SortEntity = Pick<FileEntity, "linkText"> &
  Partial<Pick<FileEntity, RankingKey>>;

type EntitySortItem = Partial<Record<RankingKey, number>> & {
  entity?: SortEntity;
  linkText?: string;
  stat?: SortStat | null;
};

type TwoHopSortItem = Partial<Record<RankingKey, number>> & {
  twoHopLinkEntity?: TwohopLink;
  stat?: SortStat | null;
};

type EntitySortComparator = (a: EntitySortItem, b: EntitySortItem) => number;
type TwoHopSortComparator = (a: TwoHopSortItem, b: TwoHopSortItem) => number;
type FileSortValue = (file: TFile) => string | number;

export function getSortFunction(sortOrder: SortOrder): EntitySortComparator {
  switch (sortOrder) {
    case "random":
      return (a, b) =>
        compareNumberAsc(
          stableShuffleValue(getEntityText(a)),
          stableShuffleValue(getEntityText(b))
        ) || compareEntityTitleAsc(a, b);
    case "filenameAsc":
      return (a, b) =>
        a.entity && b.entity
          ? a.entity.linkText.localeCompare(b.entity.linkText)
          : 0;
    case "filenameDesc":
      return (a, b) =>
        a.entity && b.entity
          ? b.entity.linkText.localeCompare(a.entity.linkText)
          : 0;
    case "modifiedDesc":
      return (a, b) =>
        a.stat && b.stat && a.stat.mtime && b.stat.mtime
          ? b.stat.mtime - a.stat.mtime
          : 0;
    case "modifiedAsc":
      return (a, b) =>
        a.stat && b.stat && a.stat.mtime && b.stat.mtime
          ? a.stat.mtime - b.stat.mtime
          : 0;
    case "createdDesc":
      return (a, b) =>
        a.stat && b.stat && a.stat.ctime && b.stat.ctime
          ? b.stat.ctime - a.stat.ctime
          : 0;
    case "createdAsc":
      return (a, b) =>
        a.stat && b.stat && a.stat.ctime && b.stat.ctime
          ? a.stat.ctime - b.stat.ctime
          : 0;
    case "relatedScoreDesc":
      return (a, b) =>
        compareNumberDesc(
          getEntityNumber(a, "relatedScore"),
          getEntityNumber(b, "relatedScore")
        ) ||
        compareNumberDesc(
          getEntityNumber(a, "pageRank"),
          getEntityNumber(b, "pageRank")
        ) ||
        compareStatDesc(a, b, "mtime") ||
        compareEntityTitleAsc(a, b);
    case "relatedCosenseLike":
      return (a, b) =>
        compareNumberAsc(
          getEntityNumber(a, "activeLinkOrder", Number.MAX_SAFE_INTEGER),
          getEntityNumber(b, "activeLinkOrder", Number.MAX_SAFE_INTEGER)
        ) ||
        compareNumberDesc(
          getEntityNumber(a, "relatedScore"),
          getEntityNumber(b, "relatedScore")
        ) ||
        compareStatDesc(a, b, "mtime") ||
        compareEntityTitleAsc(a, b);
    case "pageRankDesc":
      return (a, b) =>
        compareNumberDesc(
          getEntityNumber(a, "pageRank"),
          getEntityNumber(b, "pageRank")
        ) ||
        compareNumberDesc(
          getEntityNumber(a, "relatedScore"),
          getEntityNumber(b, "relatedScore")
        ) ||
        compareStatDesc(a, b, "mtime") ||
        compareEntityTitleAsc(a, b);
    case "mostLinkedDesc":
      return (a, b) =>
        compareNumberDesc(
          getEntityNumber(a, "inDegree"),
          getEntityNumber(b, "inDegree")
        ) ||
        compareNumberDesc(
          getEntityNumber(a, "pageRank"),
          getEntityNumber(b, "pageRank")
        ) ||
        compareStatDesc(a, b, "mtime") ||
        compareEntityTitleAsc(a, b);
  }
  throw new Error(`Unsupported sort order: ${sortOrder}`);
}

export function getTwoHopSortFunction(
  sortOrder: SortOrder
): TwoHopSortComparator {
  switch (sortOrder) {
    case "random":
      return (a, b) =>
        compareNumberAsc(
          stableShuffleValue(getTwoHopText(a)),
          stableShuffleValue(getTwoHopText(b))
        ) || compareTwoHopTitleAsc(a, b);
    case "filenameAsc":
      return (a, b) =>
        a.twoHopLinkEntity && b.twoHopLinkEntity
          ? a.twoHopLinkEntity.link.linkText.localeCompare(
              b.twoHopLinkEntity.link.linkText
            )
          : 0;
    case "filenameDesc":
      return (a, b) =>
        a.twoHopLinkEntity && b.twoHopLinkEntity
          ? b.twoHopLinkEntity.link.linkText.localeCompare(
              a.twoHopLinkEntity.link.linkText
            )
          : 0;
    case "modifiedDesc":
      return (a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0);
    case "modifiedAsc":
      return (a, b) => (a.stat?.mtime ?? 0) - (b.stat?.mtime ?? 0);
    case "createdDesc":
      return (a, b) => (b.stat?.ctime ?? 0) - (a.stat?.ctime ?? 0);
    case "createdAsc":
      return (a, b) => (a.stat?.ctime ?? 0) - (b.stat?.ctime ?? 0);
    case "relatedScoreDesc":
      return (a, b) =>
        compareNumberDesc(
          getTwoHopNumber(a, "relatedScore"),
          getTwoHopNumber(b, "relatedScore")
        ) ||
        compareStatDesc(a, b, "mtime") ||
        compareTwoHopTitleAsc(a, b);
    case "relatedCosenseLike":
      return (a, b) =>
        compareNumberAsc(
          getTwoHopNumber(a, "activeLinkOrder", Number.MAX_SAFE_INTEGER),
          getTwoHopNumber(b, "activeLinkOrder", Number.MAX_SAFE_INTEGER)
        ) || compareTwoHopTitleAsc(a, b);
    case "pageRankDesc":
      return (a, b) =>
        compareNumberDesc(
          getTwoHopNumber(a, "pageRank"),
          getTwoHopNumber(b, "pageRank")
        ) ||
        compareStatDesc(a, b, "mtime") ||
        compareTwoHopTitleAsc(a, b);
    case "mostLinkedDesc":
      return (a, b) =>
        compareNumberDesc(
          getTwoHopNumber(a, "inDegree"),
          getTwoHopNumber(b, "inDegree")
        ) ||
        compareNumberDesc(
          getTwoHopNumber(a, "pageRank"),
          getTwoHopNumber(b, "pageRank")
        ) ||
        compareStatDesc(a, b, "mtime") ||
        compareTwoHopTitleAsc(a, b);
  }
  throw new Error(`Unsupported sort order: ${sortOrder}`);
}

export function getSortFunctionForFile(sortOrder: SortOrder): FileSortValue {
  switch (sortOrder) {
    case "random":
      return (file: TFile) => stableShuffleValue(file.path);
    case "filenameAsc":
      return (file: TFile) => file.basename;
    case "filenameDesc":
      return (file: TFile) => -file.basename;
    case "modifiedDesc":
      return (file: TFile) => -file.stat.mtime;
    case "modifiedAsc":
      return (file: TFile) => file.stat.mtime;
    case "createdDesc":
      return (file: TFile) => -file.stat.ctime;
    case "createdAsc":
      return (file: TFile) => file.stat.ctime;
    case "relatedScoreDesc":
    case "relatedCosenseLike":
    case "pageRankDesc":
    case "mostLinkedDesc":
      return (file: TFile) => -file.stat.mtime;
  }
  throw new Error(`Unsupported sort order: ${sortOrder}`);
}

export async function getSortedFiles(
  files: TFile[],
  sortFunction: (file: TFile) => string | number
): Promise<TFile[]> {
  const fileEntities: { file: TFile; sortValue: string | number }[] = files.map(
    (file) => {
      return { file, sortValue: sortFunction(file) };
    }
  );
  fileEntities.sort((a, b) => {
    const sortValueA = a.sortValue;
    const sortValueB = b.sortValue;
    if (typeof sortValueA === "string" && typeof sortValueB === "string") {
      return sortValueA.localeCompare(sortValueB);
    } else if (
      typeof sortValueA === "number" &&
      typeof sortValueB === "number"
    ) {
      return sortValueA - sortValueB;
    } else {
      return 0;
    }
  });
  return fileEntities.map((entity) => entity.file);
}

export function getTagHierarchySortFunction(
  sortOrder: SortOrder
): (a: PropertiesLinks, b: PropertiesLinks) => number {
  const sortFunction = getSortFunction(sortOrder);
  return (a: PropertiesLinks, b: PropertiesLinks) => {
    const aTagHierarchy = a.property.split("/");
    const bTagHierarchy = b.property.split("/");
    for (
      let i = 0;
      i < Math.min(aTagHierarchy.length, bTagHierarchy.length);
      i++
    ) {
      if (aTagHierarchy[i] !== bTagHierarchy[i]) {
        return comparePropertyText(
          sortFunction,
          aTagHierarchy[i],
          bTagHierarchy[i]
        );
      }
    }
    if (aTagHierarchy.length !== bTagHierarchy.length) {
      return aTagHierarchy.length > bTagHierarchy.length ? -1 : 1;
    }
    return comparePropertyText(sortFunction, a.property, b.property);
  };
}

function comparePropertyText(
  sortFunction: EntitySortComparator | undefined,
  a: string,
  b: string
): number {
  return sortFunction
    ? sortFunction({ entity: { linkText: a } }, { entity: { linkText: b } })
    : a.localeCompare(b);
}

function getEntityNumber(
  item: EntitySortItem,
  key: RankingKey,
  fallback = 0
): number {
  const value = item?.entity?.[key] ?? item?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getTwoHopNumber(
  item: TwoHopSortItem,
  key: RankingKey,
  fallback = 0
): number {
  const value = item?.twoHopLinkEntity?.[key] ?? item?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function compareNumberDesc(a: number, b: number): number {
  return b - a;
}

function compareNumberAsc(a: number, b: number): number {
  return a - b;
}

function compareStatDesc(
  a: { stat?: SortStat | null },
  b: { stat?: SortStat | null },
  key: "mtime" | "ctime"
): number {
  return (b?.stat?.[key] ?? 0) - (a?.stat?.[key] ?? 0);
}

function getEntityText(item: EntitySortItem): string {
  return item?.entity?.linkText ?? item?.linkText ?? "";
}

function getTwoHopText(item: TwoHopSortItem): string {
  return item?.twoHopLinkEntity?.link?.linkText ?? "";
}

function compareEntityTitleAsc(a: EntitySortItem, b: EntitySortItem): number {
  return getEntityText(a).localeCompare(getEntityText(b));
}

function compareTwoHopTitleAsc(a: TwoHopSortItem, b: TwoHopSortItem): number {
  return getTwoHopText(a).localeCompare(getTwoHopText(b));
}

/**
 * A fixed pseudo-random position per name (FNV-1a), so the random order stays
 * the same across refreshes instead of reshuffling.
 */
export function stableShuffleValue(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
