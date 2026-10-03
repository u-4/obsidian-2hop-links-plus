// The same choices as Cosense's related-page sort menu.
export const SORT_ORDER_OPTIONS = {
  related: "Related",
  modifiedDesc: "Modified",
  createdDesc: "Created",
  mostLinkedDesc: "Most linked",
  titleAsc: "Title",
} as const;

export type SortOrder = keyof typeof SORT_ORDER_OPTIONS;

export const DEFAULT_SORT_ORDER: SortOrder = "related";

export function isSortOrder(value: unknown): value is SortOrder {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SORT_ORDER_OPTIONS, value)
  );
}

/** Maps sort orders saved by 0.43.0 and earlier to the current choices. */
export function migrateSortOrder(value: unknown): SortOrder {
  if (isSortOrder(value)) {
    return value;
  }
  if (value === "filenameAsc") {
    return "titleAsc";
  }
  return DEFAULT_SORT_ORDER;
}
