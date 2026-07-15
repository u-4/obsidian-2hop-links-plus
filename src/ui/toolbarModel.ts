import { SORT_ORDER_OPTIONS } from "../settings/sortOptions";
import type { SortOrder } from "../settings/sortOptions";

export interface SearchDisclosureState {
  isExpanded: boolean;
  searchInput: string;
}

export type SearchDisclosureAction = "toggle" | "close";

export interface SortMenuEntry {
  value: SortOrder;
  label: string;
  isCurrent: boolean;
}

/**
 * Closing the compact search control also clears its filter. This prevents an
 * invisible query from continuing to hide cards after the input is collapsed.
 */
export function getNextSearchDisclosureState(
  state: SearchDisclosureState,
  action: SearchDisclosureAction
): SearchDisclosureState {
  if (action === "toggle" && !state.isExpanded) {
    return { ...state, isExpanded: true };
  }

  return {
    isExpanded: false,
    searchInput: "",
  };
}

export function getSortMenuEntries(
  currentSortOrder: SortOrder
): SortMenuEntry[] {
  return (Object.keys(SORT_ORDER_OPTIONS) as SortOrder[]).map((value) => ({
    value,
    label: SORT_ORDER_OPTIONS[value],
    isCurrent: value === currentSortOrder,
  }));
}

export function hasTemporarySortOverride(
  currentSortOrder: SortOrder,
  defaultSortOrder: SortOrder
): boolean {
  return currentSortOrder !== defaultSortOrder;
}

export function reserveResultsHeight(
  currentHeight: number | null,
  measuredHeight: number
): number | null {
  if (currentHeight !== null) {
    return currentHeight;
  }

  if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) {
    return null;
  }

  return Math.ceil(measuredHeight);
}

export function isSortMenuContextCurrent(
  expectedSourcePath: string,
  renderedSourcePath: string,
  activeFilePath: string | null
): boolean {
  return (
    renderedSourcePath === expectedSourcePath &&
    activeFilePath === expectedSourcePath
  );
}
