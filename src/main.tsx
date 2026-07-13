import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  parseFrontMatterTags,
} from "obsidian";
import React from "react";
import ReactDOM from "react-dom";
import { FileEntity } from "./model/FileEntity";
import { TwohopLink } from "./model/TwohopLink";
import TwohopLinksRootView from "./ui/TwohopLinksRootView";
import { PropertiesLinks } from "./model/PropertiesLinks";
import { removeBlockReference } from "./utils";
import {
  TwohopPluginSettings,
  TwohopSettingTab,
} from "./settings/TwohopSettingTab";
import { SeparatePaneView } from "./ui/SeparatePaneView";
import { readPreview } from "./preview";
import { getTitle } from "./getTitle";
import { loadSettings, saveSettings } from "./settings/index";
import { Links } from "./links";
import type { GatheredLinks } from "./links";
import { OpenPaneTarget } from "./types";
import { isSortOrder } from "./settings/sortOptions";
import type { SortOrder } from "./settings/sortOptions";
import {
  getRuntimeLeafParts,
  openLinkTextCompat,
  unregisterHoverLinkSourceCompat,
} from "./obsidianCompat";
import {
  DebouncedTask,
  DEFAULT_REFRESH_DEBOUNCE_MS,
  isCalculationCancelled,
  METADATA_REFRESH_DEBOUNCE_MS,
  StartupRefreshGate,
} from "./performance";
import { MarkdownScrollNavigator } from "./scrollNavigation";
import {
  BoundedAnimationFrameRetry,
  getAllMarkdownHostElements,
  getCurrentMarkdownHostElements,
  shouldContinueMarkdownHostRetry,
} from "./markdownHostReadiness";

const CONTAINER_CLASS = "twohop-links-container";
// Covers roughly one to two seconds on common 60-120 Hz displays.
const MARKDOWN_HOST_RETRY_FRAMES = 120;
export const HOVER_LINK_ID = "2hop-links";

export default class TwohopLinksPlugin extends Plugin {
  settings: TwohopPluginSettings;
  showLinksInMarkdown: boolean;
  links: Links;

  private previousLinks: string[] = [];
  private previousTags: string[] = [];
  private renderGeneration = 0;
  private temporarySortOrder: SortOrder | null = null;
  private temporarySortOrderPath: string | null = null;
  private lastRenderedFilePath: string | null = null;
  private refreshTask: DebouncedTask;
  private scrollNavigator: MarkdownScrollNavigator;
  private readonly markdownHostRetry = new BoundedAnimationFrameRetry();
  private readonly startupRefreshGate = new StartupRefreshGate();
  private isUnloaded = false;

  async onload(): Promise<void> {
    console.debug("------ loading obsidian-twohop-links plugin");
    this.isUnloaded = false;

    this.settings = await loadSettings(this);
    this.showLinksInMarkdown = true;
    this.links = new Links(this.app, this.settings);
    this.scrollNavigator = new MarkdownScrollNavigator(async (view) => {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (
        activeView === view &&
        !this.settings.showTwoHopLinksInSeparatePane
      ) {
        await this.renderTwohopLinks(true);
      }
    });
    this.refreshTask = new DebouncedTask({
      onSupersede: () => this.links.cancelActiveGather(),
      onError: (error) => console.error("Error refreshing 2-hop links", error),
    });

    this.initPlugin();
  }

  initPlugin(): void {
    this.addSettingTab(new TwohopSettingTab(this.app, this));
    this.registerView(
      "TwoHopLinksView",
      (leaf: WorkspaceLeaf) => new SeparatePaneView(leaf, this, this.links)
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", () => {
        this.links.invalidateMetadataCaches();
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("deleted", () => {
        this.links.invalidateMetadataCaches();
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        this.links.invalidateMetadataCaches();
        this.scheduleRefresh(true, METADATA_REFRESH_DEBOUNCE_MS);
      })
    );
    this.registerEvent(
      this.app.workspace.on(
        "active-leaf-change",
        this.refreshTwohopLinks.bind(this)
      )
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.scrollNavigator.cancelPending();
        this.scrollNavigator.prune();
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", async () => {
        await this.refreshTwohopLinks(this.app.workspace.activeLeaf);
      })
    );
    this.app.workspace.trigger("parse-style-settings");
    this.app.workspace.onLayoutReady(() => {
      if (this.isUnloaded) {
        return;
      }
      this.startupRefreshGate.markLayoutReady();
      this.registerVaultInvalidationEvents();
      this.scheduleRefresh(true, this.getRefreshDebounceMs());
    });

    this.addCommand({
      id: "show-performance-statistics",
      name: "Show performance statistics",
      callback: () => this.showPerformanceStatistics(),
    });
    this.addCommand({
      id: "reset-performance-statistics",
      name: "Reset performance statistics",
      callback: () => {
        this.links.resetPerformanceStats();
        new Notice("2Hop Links performance statistics reset");
      },
    });
  }

  onunload(): void {
    this.isUnloaded = true;
    this.markdownHostRetry.cancel();
    this.refreshTask.cancel();
    this.links.cancelPendingCalculations();
    this.disableLinksInMarkdown();
    console.log("unloading plugin");
  }

  getRefreshDebounceMs(): number {
    const configured = this.settings.refreshDebounceMs;
    return Number.isFinite(configured)
      ? Math.min(2000, Math.max(0, configured))
      : DEFAULT_REFRESH_DEBOUNCE_MS;
  }

  isWorkspaceLayoutReady(): boolean {
    return this.startupRefreshGate.isLayoutReady();
  }

  whenWorkspaceLayoutReady(callback: () => void): void {
    if (this.isWorkspaceLayoutReady()) {
      callback();
      return;
    }

    this.app.workspace.onLayoutReady(() => {
      if (!this.isUnloaded) {
        callback();
      }
    });
  }

  getEffectiveRefreshDelayMs(requestedDelayMs: number): number | null {
    return this.startupRefreshGate.getDelay(requestedDelayMs);
  }

  markRefreshStarted(): void {
    this.startupRefreshGate.markRefreshStarted();
  }

  private registerVaultInvalidationEvents(): void {
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "canvas") {
          this.links.invalidateCanvasCaches();
          this.scheduleRefresh(true, METADATA_REFRESH_DEBOUNCE_MS);
        } else {
          this.links.invalidateMetadataCaches();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "canvas") {
          this.links.invalidateCanvasCaches();
          this.scheduleRefresh(true, METADATA_REFRESH_DEBOUNCE_MS);
        } else {
          this.links.invalidateMetadataCaches();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file) => {
        this.links.invalidateMetadataCaches();
        this.links.invalidateCanvasCaches();
        if (file instanceof TFile && file.extension === "canvas") {
          this.scheduleRefresh(true, METADATA_REFRESH_DEBOUNCE_MS);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "canvas") {
          this.links.invalidateCanvasCaches();
          this.scheduleRefresh(true, METADATA_REFRESH_DEBOUNCE_MS);
        }
      })
    );
  }

  private scheduleRefresh(isForceUpdate: boolean, delayMs: number): void {
    if (this.isUnloaded || !this.showLinksInMarkdown) {
      return;
    }
    const effectiveDelayMs = this.getEffectiveRefreshDelayMs(delayMs);
    if (effectiveDelayMs === null) {
      return;
    }
    this.refreshTask.schedule(effectiveDelayMs, async () => {
      this.markRefreshStarted();
      await this.renderTwohopLinks(isForceUpdate);
    });
  }

  private showPerformanceStatistics(): void {
    const stats = this.links.getPerformanceStats();
    const message =
      `Graph builds ${stats.builds}, graph hits ${stats.hits}, ` +
      `result calculations ${stats.resultComputations}, result hits ${stats.resultCacheHits}, ` +
      `joined ${stats.joinedComputations}, cancelled ${
        stats.gatherCancellations + stats.cancellations
      }, last graph ${stats.lastBuildMs} ms, last result ${stats.lastGatherMs} ms`;
    console.info("2Hop Links performance statistics", stats);
    new Notice(message, 10000);
  }

  private shouldIgnoreActiveLeaf(leaf: WorkspaceLeaf | null): boolean {
    if (!leaf) {
      return false;
    }

    const runtime = getRuntimeLeafParts(leaf);
    const containerEl = runtime.view.containerEl ?? runtime.leaf.containerEl;
    const parentEl = containerEl?.parentElement;
    const viewType =
      typeof leaf.view.getViewType === "function"
        ? leaf.view.getViewType()
        : "";

    if (viewType === "hover-editor" || viewType === "markdown-hover") {
      return true;
    }

    if (
      runtime.leaf.hoverPopover ||
      runtime.leaf.isHoverPopover ||
      runtime.view.hoverPopover
    ) {
      return true;
    }

    if (containerEl?.closest?.(".hover-popover, .popover, .hover-editor")) {
      return true;
    }

    if (parentEl?.closest?.(".hover-popover, .popover, .hover-editor")) {
      return true;
    }

    return false;
  }

  async refreshTwohopLinks(leaf?: WorkspaceLeaf | null): Promise<void> {
    if (this.shouldIgnoreActiveLeaf(leaf ?? null)) {
      return;
    }

    this.scrollNavigator.cancelPending();
    if (this.showLinksInMarkdown) {
      this.scheduleRefresh(true, this.getRefreshDebounceMs());
    }
  }

  private getFileByPath(path: string): TFile | null {
    const abstractFile = this.app.vault.getAbstractFileByPath(path);
    return abstractFile instanceof TFile ? abstractFile : null;
  }

  private resolveFilePath(linkText: string, sourcePath: string): string | null {
    const normalizedLinkText = removeBlockReference(linkText);
    const resolvedFile = this.app.metadataCache.getFirstLinkpathDest(
      normalizedLinkText,
      sourcePath
    );
    if (resolvedFile) return resolvedFile.path;

    return this.getFileByPath(normalizedLinkText)?.path ?? null;
  }

  private findLineOfLinkInFile(
    file: TFile,
    linkTextToReveal: string,
    targetPathToReveal?: string
  ): number | undefined {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return undefined;

    const linkToRevealPath =
      targetPathToReveal != null
        ? removeBlockReference(targetPathToReveal)
        : this.resolveFilePath(linkTextToReveal, file.path);
    const normalizedLinkTextToReveal = removeBlockReference(linkTextToReveal);
    const references = [
      ...(cache.links ?? []),
      ...(cache.embeds ?? []),
    ]
      .slice()
      .sort(
        (a, b) =>
          (a.position?.start?.offset ?? Number.MAX_SAFE_INTEGER) -
          (b.position?.start?.offset ?? Number.MAX_SAFE_INTEGER)
      );

    for (const reference of references) {
      const referenceLinkText = removeBlockReference(reference.link);
      const referencePath = this.resolveFilePath(reference.link, file.path);
      const line = reference.position?.start?.line;

      if (line == null) {
        continue;
      }

      if (linkToRevealPath && referencePath === linkToRevealPath) {
        return line;
      }

      if (
        referenceLinkText === normalizedLinkTextToReveal ||
        referenceLinkText === removeBlockReference(linkToRevealPath ?? "")
      ) {
        return line;
      }
    }

    return undefined;
  }

  private async openFile(
    fileEntity: FileEntity,
    newLeaf?: OpenPaneTarget
  ): Promise<void> {
    const linkText = removeBlockReference(
      fileEntity.targetPath ?? fileEntity.linkText
    );

    console.debug(
      `Open file: linkText='${linkText}', sourcePath='${fileEntity.sourcePath}'`
    );
    const file =
      fileEntity.targetPath != null
        ? this.getFileByPath(fileEntity.targetPath)
        : this.app.metadataCache.getFirstLinkpathDest(
            linkText,
            fileEntity.sourcePath
          );
    if (file == null) {
      if (!confirm(`Create new file: ${linkText}?`)) {
        console.log("Canceled!!");
        return;
      }
    }

    const line =
      file && fileEntity.linkTextToReveal
        ? this.findLineOfLinkInFile(
            file,
            fileEntity.linkTextToReveal,
            fileEntity.targetPathToReveal
          )
        : undefined;

    await openLinkTextCompat(
      this.app.workspace,
      fileEntity.targetPath ?? fileEntity.linkText,
      fileEntity.sourcePath,
      newLeaf,
      line != null ? { eState: { line } } : undefined
    );

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (file && line != null && activeView?.file?.path === file.path) {
      activeView.editor?.setCursor({ line, ch: 0 });
      activeView.editor?.scrollIntoView(
        { from: { line, ch: 0 }, to: { line, ch: 0 } },
        true
      );
    }
  }

  async updateTwoHopLinksView(): Promise<void> {
    this.refreshTask.cancel();
    this.links.cancelActiveGather();
    if (this.isTwoHopLinksViewOpen()) {
      this.app.workspace.detachLeavesOfType("TwoHopLinksView");
    }
    if (this.settings.showTwoHopLinksInSeparatePane) {
      await this.openTwoHopLinksView();
      this.disableLinksInMarkdown();
      this.removePaddingBottom();
    } else {
      this.enableLinksInMarkdown();
    }
  }

  prepareLinksForFile(file: TFile | null): SortOrder {
    const filePath = file?.path ?? null;
    if (this.lastRenderedFilePath !== filePath) {
      this.temporarySortOrder = null;
      this.temporarySortOrderPath = null;
      this.lastRenderedFilePath = filePath;
    }

    const effectiveSortOrder =
      this.temporarySortOrderPath === filePath && this.temporarySortOrder
        ? this.temporarySortOrder
        : this.settings.sortOrder;
    this.links.settings = {
      ...this.settings,
      sortOrder: effectiveSortOrder,
    };
    return effectiveSortOrder;
  }

  async setTemporarySortOrder(sortOrder: string): Promise<void> {
    if (!isSortOrder(sortOrder)) {
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    this.temporarySortOrder =
      sortOrder === this.settings.sortOrder ? null : sortOrder;
    this.temporarySortOrderPath = this.temporarySortOrder
      ? activeFile?.path ?? null
      : null;
    this.prepareLinksForFile(activeFile);

    if (this.settings.showTwoHopLinksInSeparatePane) {
      const separatePaneLeaf = this.app.workspace
        .getLeavesOfType("TwoHopLinksView")
        .find((leaf) => leaf.view instanceof SeparatePaneView);
      if (separatePaneLeaf?.view instanceof SeparatePaneView) {
        await separatePaneLeaf.view.updateOrForceUpdate(true);
        return;
      }
    }

    await this.updateTwoHopLinksView();
  }

  async setDefaultSortOrder(sortOrder: string): Promise<void> {
    if (!isSortOrder(sortOrder) || this.settings.sortOrder === sortOrder) {
      return;
    }

    this.settings.sortOrder = sortOrder;
    this.temporarySortOrder = null;
    this.temporarySortOrderPath = null;
    this.prepareLinksForFile(this.app.workspace.getActiveFile());
    await saveSettings(this);
    await this.updateTwoHopLinksView();
  }

  isTwoHopLinksViewOpen(): boolean {
    return this.app.workspace.getLeavesOfType("TwoHopLinksView").length > 0;
  }

  async openTwoHopLinksView(): Promise<void> {
    const leaf = this.settings.panePositionIsRight
      ? this.app.workspace.getRightLeaf(false)
      : this.app.workspace.getLeftLeaf(false);
    if (!leaf) return;

    await leaf.setViewState({ type: "TwoHopLinksView" });
    await this.app.workspace.revealLeaf(leaf);
  }

  private getContainerHostElements(markdownView: MarkdownView): HTMLElement[] {
    return getAllMarkdownHostElements(markdownView.containerEl);
  }

  private isMarkdownHostReady(markdownView: MarkdownView): boolean {
    return (
      markdownView.containerEl.isConnected &&
      getCurrentMarkdownHostElements(
        markdownView.containerEl,
        markdownView.getMode()
      ).length > 0
    );
  }

  private scheduleMarkdownHostRetry(
    leaf: WorkspaceLeaf,
    activeFile: TFile
  ): void {
    const ownerWindow = leaf.view.containerEl.ownerDocument.defaultView;
    if (!ownerWindow) {
      return;
    }

    this.markdownHostRetry.schedule({
      frameApi: ownerWindow,
      maxFrames: MARKDOWN_HOST_RETRY_FRAMES,
      shouldContinue: () => {
        return shouldContinueMarkdownHostRetry({
          isUnloaded: this.isUnloaded,
          showLinksInMarkdown: this.showLinksInMarkdown,
          showInSeparatePane: this.settings.showTwoHopLinksInSeparatePane,
          isActiveLeaf: this.app.workspace.activeLeaf === leaf,
          leafViewType: leaf.getViewState().type,
          activeFilePath: this.app.workspace.getActiveFile()?.path ?? null,
          expectedFilePath: activeFile.path,
        });
      },
      isReady: () => {
        const currentView =
          this.app.workspace.getActiveViewOfType(MarkdownView);
        return Boolean(
          currentView &&
          currentView.file?.path === activeFile.path &&
          this.isMarkdownHostReady(currentView)
        );
      },
      onReady: () => this.scheduleRefresh(true, 0),
    });
  }

  private findDirectContainer(host: HTMLElement): HTMLElement | null {
    return (
      Array.from(host.children).find((child) =>
        child.classList.contains(CONTAINER_CLASS)
      ) as HTMLElement | undefined
    ) ?? null;
  }

  private getContainerElements(markdownView: MarkdownView): HTMLElement[] {
    return this.getContainerHostElements(markdownView).map(
      (host) =>
        this.findDirectContainer(host) ??
        host.createDiv({ cls: CONTAINER_CLASS })
    );
  }

  private getExistingContainerElements(
    markdownView: MarkdownView
  ): HTMLElement[] {
    return this.getContainerHostElements(markdownView)
      .map((host) => this.findDirectContainer(host))
      .filter((container): container is HTMLElement => container !== null);
  }

  private getActiveFileLinks(file: TFile | null): string[] {
    if (!file) {
      return [];
    }

    const cache = this.app.metadataCache.getFileCache(file);
    return cache && cache.links ? cache.links.map((link) => link.link) : [];
  }

  private getActiveFileTags(file: TFile | null): string[] {
    if (!file) {
      return [];
    }

    const cache = this.app.metadataCache.getFileCache(file);

    let tags = cache && cache.tags ? cache.tags.map((tag) => tag.tag) : [];

    if (cache && cache.frontmatter && cache.frontmatter.tags) {
      const frontMatterTags = parseFrontMatterTags(cache.frontmatter);
      if (frontMatterTags) {
        tags = tags.concat(frontMatterTags);
      }
    }

    return tags;
  }

  async renderTwohopLinks(isForceUpdate: boolean): Promise<void> {
    const activeLeaf = this.app.workspace.activeLeaf;
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeLeaf || !activeFile || activeFile.extension !== "md") {
      this.markdownHostRetry.cancel();
      this.scrollNavigator.prune();
      return;
    }
    if (this.settings.showTwoHopLinksInSeparatePane) {
      this.markdownHostRetry.cancel();
      this.scrollNavigator.removeAll();
      return;
    }
    if (!markdownView && activeLeaf.getViewState().type !== "markdown") {
      this.markdownHostRetry.cancel();
      this.scrollNavigator.prune();
      return;
    }
    if (
      !markdownView ||
      markdownView.file?.path !== activeFile.path ||
      !this.isMarkdownHostReady(markdownView)
    ) {
      this.scheduleMarkdownHostRetry(activeLeaf, activeFile);
      return;
    }
    this.markdownHostRetry.cancel();
    this.addPaddingBottom();
    this.prepareLinksForFile(activeFile);
    const generation = ++this.renderGeneration;

    const currentLinks = this.getActiveFileLinks(activeFile);
    const currentTags = this.getActiveFileTags(activeFile);

    if (
      isForceUpdate ||
      this.previousLinks.sort().join(",") !== currentLinks.sort().join(",") ||
      this.previousTags.sort().join(",") !== currentTags.sort().join(",")
    ) {
      let gatheredLinks: GatheredLinks;
      try {
        gatheredLinks = await this.links.gatherTwoHopLinks(activeFile);
      } catch (error) {
        if (isCalculationCancelled(error)) {
          return;
        }
        throw error;
      }
      const {
        forwardLinks,
        newLinks,
        backwardLinks,
        twoHopLinks,
        tagLinksList,
        frontmatterKeyLinksList,
      } = gatheredLinks;

      const currentActiveFile = this.app.workspace.getActiveFile();
      const currentActiveView =
        this.app.workspace.getActiveViewOfType(MarkdownView);
      if (
        generation !== this.renderGeneration ||
        currentActiveView !== markdownView ||
        currentActiveFile?.path !== activeFile.path
      ) {
        return;
      }

      if (!this.isMarkdownHostReady(markdownView)) {
        this.scheduleMarkdownHostRetry(activeLeaf, activeFile);
        return;
      }
      this.markdownHostRetry.cancel();
      const containers = this.getContainerElements(markdownView);

      for (const container of containers) {
        await this.injectTwohopLinks(
          forwardLinks,
          newLinks,
          backwardLinks,
          twoHopLinks,
          tagLinksList,
          frontmatterKeyLinksList,
          container,
          activeFile
        );
      }

      this.previousLinks = currentLinks;
      this.previousTags = currentTags;
    }

    this.scrollNavigator.ensure(markdownView);
  }

  async injectTwohopLinks(
    forwardConnectedLinks: FileEntity[],
    newLinks: FileEntity[],
    backwardConnectedLinks: FileEntity[],
    twoHopLinks: TwohopLink[],
    tagLinksList: PropertiesLinks[],
    frontmatterKeyLinksList: PropertiesLinks[],
    container: Element,
    sourceFile: TFile
  ): Promise<void> {
    const showForwardConnectedLinks = this.settings.showForwardConnectedLinks;
    const showBackwardConnectedLinks = this.settings.showBackwardConnectedLinks;
    const showTwohopLinks = this.settings.showTwohopLinks;
    const showNewLinks = this.settings.showNewLinks;
    const showTagsLinks = this.settings.showTagsLinks;
    const showPropertiesLinks = this.settings.showPropertiesLinks;
    ReactDOM.render(
      <TwohopLinksRootView
        forwardConnectedLinks={forwardConnectedLinks}
        newLinks={newLinks}
        backwardConnectedLinks={backwardConnectedLinks}
        twoHopLinks={twoHopLinks}
        tagLinksList={tagLinksList}
        frontmatterKeyLinksList={frontmatterKeyLinksList}
        onClick={this.openFile.bind(this)}
        getPreview={readPreview.bind(this)}
        getTitle={getTitle.bind(this)}
        app={this.app}
        showForwardConnectedLinks={showForwardConnectedLinks}
        showBackwardConnectedLinks={showBackwardConnectedLinks}
        showTwohopLinks={showTwohopLinks}
        showNewLinks={showNewLinks}
        showTagsLinks={showTagsLinks}
        showPropertiesLinks={showPropertiesLinks}
        autoLoadTwoHopLinks={this.settings.autoLoadTwoHopLinks}
        includeBodyInCardSearch={this.settings.includeBodyInCardSearch}
        sourcePath={sourceFile.path}
        sortOrder={this.prepareLinksForFile(sourceFile)}
        onSortOrderChange={this.setTemporarySortOrder.bind(this)}
        initialBoxCount={this.settings.initialBoxCount}
        initialSectionCount={this.settings.initialSectionCount}
      />,
      container
    );
  }

  enableLinksInMarkdown(): void {
    this.showLinksInMarkdown = true;
    this.scheduleRefresh(true, 0);
  }

  disableLinksInMarkdown(): void {
    this.showLinksInMarkdown = false;
    this.markdownHostRetry.cancel();
    this.refreshTask.cancel();
    this.links.cancelActiveGather();
    this.removeTwohopLinks();
    this.removePaddingBottom();
    unregisterHoverLinkSourceCompat(this.app.workspace, HOVER_LINK_ID);
  }

  removeTwohopLinks(): void {
    this.scrollNavigator.removeAll();
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof MarkdownView)) return;

      for (const container of this.getExistingContainerElements(leaf.view)) {
        ReactDOM.unmountComponentAtNode(container);
        container.remove();
      }
    });
  }

  addPaddingBottom(): void {
    if (!document.getElementById("twohop-custom-padding")) {
      const styleEl = document.createElement("style");
      styleEl.id = "twohop-custom-padding";
      styleEl.innerText = `
      .markdown-preview-section,
      .cm-content {
        padding-bottom: 20px !important;
      }
    `;
      document.head.appendChild(styleEl);
    }
  }

  removePaddingBottom(): void {
    const existingStyleEl = document.getElementById("twohop-custom-padding");
    if (existingStyleEl) {
      existingStyleEl.remove();
    }
  }
}
