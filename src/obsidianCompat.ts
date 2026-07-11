import {
  CachedMetadata,
  LinkCache,
  OpenViewState,
  TFile,
  Workspace,
  WorkspaceLeaf,
} from "obsidian";
import type { OpenPaneTarget } from "./types";

/**
 * Obsidian exposes frontmatter links at runtime, but older public type
 * definitions do not include the field on CachedMetadata.
 */
type CachedMetadataWithFrontmatterLinks = CachedMetadata & {
  frontmatterLinks?: LinkCache[];
};

export function getFrontmatterLinks(
  cache: CachedMetadata | null | undefined
): LinkCache[] {
  return (
    (cache as CachedMetadataWithFrontmatterLinks | null | undefined)
      ?.frontmatterLinks ?? []
  );
}

export type RuntimeWorkspaceLeaf = WorkspaceLeaf & {
  containerEl?: HTMLElement;
  hoverPopover?: unknown;
  isHoverPopover?: boolean;
};

export type RuntimeWorkspaceView = WorkspaceLeaf["view"] & {
  containerEl?: HTMLElement;
  hoverPopover?: unknown;
  file?: TFile | null;
};

export function getRuntimeLeafParts(leaf: WorkspaceLeaf): {
  leaf: RuntimeWorkspaceLeaf;
  view: RuntimeWorkspaceView;
} {
  return {
    leaf: leaf as RuntimeWorkspaceLeaf,
    view: leaf.view as RuntimeWorkspaceView,
  };
}

export function getRuntimeLeafFile(leaf: WorkspaceLeaf): TFile | null {
  const file = getRuntimeLeafParts(leaf).view.file;
  return file instanceof TFile ? file : null;
}

type RuntimeWorkspace = {
  openLinkText(
    linkText: string,
    sourcePath: string,
    target?: OpenPaneTarget,
    openViewState?: OpenViewState
  ): Promise<void>;
  unregisterHoverLinkSource?: (sourceId: string) => void;
};

function getRuntimeWorkspace(workspace: Workspace): RuntimeWorkspace {
  return workspace as unknown as RuntimeWorkspace;
}

export function openLinkTextCompat(
  workspace: Workspace,
  linkText: string,
  sourcePath: string,
  target?: OpenPaneTarget,
  openViewState?: OpenViewState
): Promise<void> {
  return getRuntimeWorkspace(workspace).openLinkText(
    linkText,
    sourcePath,
    target,
    openViewState
  );
}

export function unregisterHoverLinkSourceCompat(
  workspace: Workspace,
  sourceId: string
): void {
  getRuntimeWorkspace(workspace).unregisterHoverLinkSource?.(sourceId);
}
