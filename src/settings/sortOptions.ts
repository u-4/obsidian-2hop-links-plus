export const SORT_ORDER_OPTIONS = {
  random: "Random",
  filenameAsc: "File name (A to Z)",
  filenameDesc: "File name (Z to A)",
  modifiedDesc: "Modified time (new to old)",
  modifiedAsc: "Modified time (old to new)",
  createdDesc: "Created time (new to old)",
  createdAsc: "Created time (old to new)",
  relatedScoreDesc: "Related score",
  relatedCosenseLike: "Related, Cosense-like",
  pageRankDesc: "Page rank",
  mostLinkedDesc: "Most linked",
} as const;

export type SortOrder = keyof typeof SORT_ORDER_OPTIONS;

export function isSortOrder(value: unknown): value is SortOrder {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SORT_ORDER_OPTIONS, value)
  );
}
