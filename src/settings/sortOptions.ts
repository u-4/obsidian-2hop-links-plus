export const SORT_ORDER_OPTIONS: Record<string, string> = {
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
};

export function isSortOrder(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(SORT_ORDER_OPTIONS, value);
}
