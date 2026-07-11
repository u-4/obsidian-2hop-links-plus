import { TFile } from "obsidian";
import { PropertiesLinks } from "./model/PropertiesLinks";

export function getSortFunction(sortOrder: string) {
  switch (sortOrder) {
    case "random":
      return () => Math.random() - 0.5;
    case "filenameAsc":
      return (a: any, b: any) =>
        a.entity && b.entity
          ? a.entity.linkText.localeCompare(b.entity.linkText)
          : Math.random() - 0.5;
    case "filenameDesc":
      return (a: any, b: any) =>
        a.entity && b.entity
          ? b.entity.linkText.localeCompare(a.entity.linkText)
          : Math.random() - 0.5;
    case "modifiedDesc":
      return (a: any, b: any) =>
        a.stat && b.stat && a.stat.mtime && b.stat.mtime
          ? b.stat.mtime - a.stat.mtime
          : Math.random() - 0.5;
    case "modifiedAsc":
      return (a: any, b: any) =>
        a.stat && b.stat && a.stat.mtime && b.stat.mtime
          ? a.stat.mtime - b.stat.mtime
          : Math.random() - 0.5;
    case "createdDesc":
      return (a: any, b: any) =>
        a.stat && b.stat && a.stat.ctime && b.stat.ctime
          ? b.stat.ctime - a.stat.ctime
          : Math.random() - 0.5;
    case "createdAsc":
      return (a: any, b: any) =>
        a.stat && b.stat && a.stat.ctime && b.stat.ctime
          ? a.stat.ctime - b.stat.ctime
          : Math.random() - 0.5;
    case "relatedScoreDesc":
      return (a: any, b: any) =>
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
      return (a: any, b: any) =>
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
      return (a: any, b: any) =>
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
      return (a: any, b: any) =>
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
}

export function getTwoHopSortFunction(sortOrder: string) {
  switch (sortOrder) {
    case "random":
      return () => Math.random() - 0.5;
    case "filenameAsc":
      return (a: any, b: any) =>
        a.twoHopLinkEntity && b.twoHopLinkEntity
          ? a.twoHopLinkEntity.link.linkText.localeCompare(
              b.twoHopLinkEntity.link.linkText
            )
          : Math.random() - 0.5;
    case "filenameDesc":
      return (a: any, b: any) =>
        a.twoHopLinkEntity && b.twoHopLinkEntity
          ? b.twoHopLinkEntity.link.linkText.localeCompare(
              a.twoHopLinkEntity.link.linkText
            )
          : Math.random() - 0.5;
    case "modifiedDesc":
      return (a: any, b: any) => b.stat.mtime - a.stat.mtime;
    case "modifiedAsc":
      return (a: any, b: any) => a.stat.mtime - b.stat.mtime;
    case "createdDesc":
      return (a: any, b: any) => b.stat.ctime - a.stat.ctime;
    case "createdAsc":
      return (a: any, b: any) => a.stat.ctime - b.stat.ctime;
    case "relatedScoreDesc":
      return (a: any, b: any) =>
        compareNumberDesc(
          getTwoHopNumber(a, "relatedScore"),
          getTwoHopNumber(b, "relatedScore")
        ) ||
        compareStatDesc(a, b, "mtime") ||
        compareTwoHopTitleAsc(a, b);
    case "relatedCosenseLike":
      return (a: any, b: any) =>
        compareNumberAsc(
          getTwoHopNumber(a, "activeLinkOrder", Number.MAX_SAFE_INTEGER),
          getTwoHopNumber(b, "activeLinkOrder", Number.MAX_SAFE_INTEGER)
        ) || compareTwoHopTitleAsc(a, b);
    case "pageRankDesc":
      return (a: any, b: any) =>
        compareNumberDesc(
          getTwoHopNumber(a, "pageRank"),
          getTwoHopNumber(b, "pageRank")
        ) ||
        compareStatDesc(a, b, "mtime") ||
        compareTwoHopTitleAsc(a, b);
    case "mostLinkedDesc":
      return (a: any, b: any) =>
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
}

export function getSortFunctionForFile(sortOrder: string) {
  switch (sortOrder) {
    case "random":
      return () => Math.random() - 0.5;
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

export function getTagHierarchySortFunction(sortOrder: string) {
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
  sortFunction: ((a: any, b: any) => number) | undefined,
  a: string,
  b: string
): number {
  return sortFunction
    ? sortFunction({ entity: { linkText: a } }, { entity: { linkText: b } })
    : a.localeCompare(b);
}

function getEntityNumber(
  item: any,
  key: "relatedScore" | "pageRank" | "inDegree" | "activeLinkOrder",
  fallback = 0
): number {
  const value = item?.entity?.[key] ?? item?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getTwoHopNumber(
  item: any,
  key: "relatedScore" | "pageRank" | "inDegree" | "activeLinkOrder",
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

function compareStatDesc(a: any, b: any, key: "mtime" | "ctime"): number {
  return (b?.stat?.[key] ?? 0) - (a?.stat?.[key] ?? 0);
}

function compareEntityTitleAsc(a: any, b: any): number {
  const aText = a?.entity?.linkText ?? a?.linkText ?? "";
  const bText = b?.entity?.linkText ?? b?.linkText ?? "";
  return aText.localeCompare(bText);
}

function compareTwoHopTitleAsc(a: any, b: any): number {
  const aText = a?.twoHopLinkEntity?.link?.linkText ?? "";
  const bText = b?.twoHopLinkEntity?.link?.linkText ?? "";
  return aText.localeCompare(bText);
}
