import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import React from "react";
import ReactDOM from "react-dom";
import { FileEntity } from "./model/FileEntity";
import TwohopLinksRootView from "./ui/TwohopLinksRootView";
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
import { getRuntimeLeafParts, openLinkTextCompat } from "./obsidianCompat";
import {
  DebouncedTask,
  DEFAULT_REFRESH_DEBOUNCE_MS,
  isCalculationCancelled,
  METADATA_REFRESH_DEBOUNCE_MS,
  StartupRefreshGate,
} from "./performance";
import { MarkdownScrollNavigator, PaneToggle } from "./scrollNavigation";
import {
  BoundedAnimationFrameRetry,
  getAllMarkdownHostElements,
  getCurrentMarkdownHostElements,
  shouldContinueMarkdownHostRetry,
} from "./markdownHostReadiness";
import { chooseInlineRestoreLeaf } from "./inlineRestoreLeaf";
import { LinkSignatureTracker } from "./linkSignature";
import { PreviewStore } from "./cardPreview";
import { HOVER_EDIT_SOURCE, RelatedPopover } from "./relatedPopover";
import { setCardHoverHandler } from "./cardHover";
import { BodyLinkHover } from "./linkHover";
import { TitleStrip } from "./titleStrip";
import type { CachedMetadata } from "obsidian";

const CONTAINER_CLASS = "twohop-links-container";
const INLINE_CONTAINER_CLASS = "twohop-links-container--inline";
const RELATED_REGION_CLASS = "is-document-related-region";
const HOST_RELATED_REGION_CLASS = "has-twohop-document-related-region";
// Covers roughly one to two seconds on common 60-120 Hz displays.
const MARKDOWN_HOST_RETRY_FRAMES = 120;
const MODE_SWITCH_CHECK_DELAY_MS = 50;

// Obsidian's sidebars; collapse() and collapsed are not in the published typings.
type CollapsibleSplit = { collapsed: boolean; collapse(): void };

export default class TwohopLinksPlugin extends Plugin {
  settings: TwohopPluginSettings;
  showLinksInMarkdown: boolean;
  links: Links;
  previewStore: PreviewStore;
  popover: RelatedPopover;
  titleStrip: TitleStrip;

  private readonly linkSignatures = new LinkSignatureTracker(() => ({
    frontmatterPropertyKeyAsTitle: this.settings.frontmatterPropertyKeyAsTitle,
  }));
  private dataRevision = 0;
  private hasPendingMetadataRefresh = false;
  private lastGather: { key: string; result: GatheredLinks } | null = null;
  private displayedPaths = new Set<string>();
  private displayedLinkTexts = new Set<string>();
  readonly openFileEntity = this.openFile.bind(this);
  readonly getCardPreview = readPreview.bind(this);
  readonly getCardTitle = getTitle.bind(this);
  private readonly handleSortOrderChange =
    this.setTemporarySortOrder.bind(this);
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
    this.previewStore = new PreviewStore(this.app);
    this.popover = new RelatedPopover(this);
    // Hover features are for a mouse or trackpad; touch screens emulate
    // mouseover on tap, which would open popups and the title row.
    const canHover = (doc: Document) =>
      doc.defaultView?.matchMedia("(hover: hover) and (pointer: fine)")
        .matches ?? false;
    setCardHoverHandler({
      enter: (cardEl, fileEntity, event) => {
        if (!canHover(cardEl.ownerDocument)) return;
        const file = this.resolveEntityFile(fileEntity);
        if (!file) return;
        const revealPath =
          fileEntity.targetPathToReveal ??
          (fileEntity.linkTextToReveal
            ? this.resolveFilePath(fileEntity.linkTextToReveal, file.path) ??
              undefined
            : undefined);
        this.popover.enter(cardEl, file, event, { revealPath });
      },
      leave: (cardEl) => this.popover.leave(cardEl),
    });
    this.titleStrip = new TitleStrip(this);
    const bodyLinks = new BodyLinkHover(this);
    const watchPointer = (doc: Document) => {
      if (!canHover(doc)) return;
      this.registerDomEvent(doc, "mouseover", bodyLinks.onMouseOver, {
        capture: true,
      });
      this.registerDomEvent(doc, "mouseout", bodyLinks.onMouseOut, {
        capture: true,
      });
      this.registerDomEvent(doc, "mousemove", this.popover.onPointerMove, {
        capture: true,
        passive: true,
      });
      this.registerDomEvent(doc, "keydown", this.popover.onKeyDown, {
        capture: true,
      });
      this.registerDomEvent(doc, "mouseover", this.titleStrip.onMouseOver);
      this.registerDomEvent(doc, "mouseout", this.titleStrip.onMouseOut);
    };
    watchPointer(document);
    this.registerEvent(
      this.app.workspace.on("window-open", (win) => watchPointer(win.doc))
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.titleStrip.hide())
    );
    // Clicking inside a light popup hands the note to the page preview
    // (Hover Editor when installed) for editing.
    this.registerHoverLinkSource(HOVER_EDIT_SOURCE, {
      display: "2Hop Links（軽いプレビューから編集へ）",
      defaultMod: false,
    });
    this.scrollNavigator = new MarkdownScrollNavigator(async (view) => {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView === view && !this.settings.showTwoHopLinksInSeparatePane) {
        await this.renderTwohopLinks(true);
      }
    }, this.paneToggle);
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
    // Recompute only when a note's links, tags or used frontmatter changed,
    // and refresh the view only when that note relates to what is shown.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file, _data, cache) => {
        if (!this.linkSignatures.update(file.path, cache)) {
          return;
        }
        const isRelevant = this.isRelevantMetadataChange(file, cache);
        this.links.invalidateMetadataCaches(isRelevant);
        if (isRelevant) {
          this.markDisplayedDataStale();
        }
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("resolve", (file) => {
        this.links.markLinksDirty(file.path);
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("deleted", (file) => {
        this.linkSignatures.delete(file.path);
        this.links.markAllLinksDirty();
        this.links.invalidateMetadataCaches();
        this.markDisplayedDataStale();
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        if (!this.hasPendingMetadataRefresh) {
          return;
        }
        this.hasPendingMetadataRefresh = false;
        this.scheduleRefresh(false, METADATA_REFRESH_DEBOUNCE_MS);
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
        this.refreshPaneButton();
        // Results are rendered only into the current mode's host, so a mode
        // switch needs a render; it reuses the last gathered result.
        // The new mode's host may not be in place yet when the event fires.
        window.setTimeout(() => {
          if (this.isCurrentModeHostMissingResults()) {
            this.scheduleRefresh(false, 0);
          }
        }, MODE_SWITCH_CHECK_DELAY_MS);
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
      this.refreshPaneButton();
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
    this.previewStore.dispose();
    setCardHoverHandler(null);
    this.paneObserver?.disconnect();
    this.titleStrip.hide();
    this.popover.dispose();
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
    // Markdown creation and deletion arrive through metadataCache events, but
    // a new or removed note can change how other notes' links resolve.
    const onFileChanged = (file: unknown) => {
      if (file instanceof TFile && file.extension === "md") {
        this.links.markAllLinksDirty();
      }
      if (file instanceof TFile && file.extension === "canvas") {
        this.links.invalidateCanvasCaches();
        this.dataRevision++;
        this.scheduleRefresh(false, METADATA_REFRESH_DEBOUNCE_MS);
      }
    };
    this.registerEvent(this.app.vault.on("create", onFileChanged));
    this.registerEvent(this.app.vault.on("delete", onFileChanged));
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "canvas") {
          onFileChanged(file);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (_file, oldPath) => {
        this.linkSignatures.delete(oldPath);
        this.links.markAllLinksDirty();
        this.links.invalidateMetadataCaches();
        this.links.invalidateCanvasCaches();
        this.dataRevision++;
        this.scheduleRefresh(false, METADATA_REFRESH_DEBOUNCE_MS);
      })
    );
  }

  private markDisplayedDataStale(): void {
    this.dataRevision++;
    this.hasPendingMetadataRefresh = true;
  }

  /**
   * A changed note matters when it is the active note, is shown in the view,
   * or now links to the active note or one of the active note's links.
   */
  private isRelevantMetadataChange(
    file: TFile,
    cache: CachedMetadata | null | undefined
  ): boolean {
    const activePath = this.lastRenderedFilePath;
    if (!activePath || file.path === activePath) {
      return true;
    }
    if (
      this.displayedPaths.has(file.path) ||
      this.displayedLinkTexts.has(file.basename)
    ) {
      return true;
    }
    for (const reference of [
      ...(cache?.links ?? []),
      ...(cache?.embeds ?? []),
      ...(cache?.frontmatterLinks ?? []),
    ]) {
      const linkText = removeBlockReference(reference.link);
      if (this.displayedLinkTexts.has(linkText)) {
        return true;
      }
      const target = this.app.metadataCache.getFirstLinkpathDest(
        linkText,
        file.path
      );
      if (
        target &&
        (target.path === activePath || this.displayedPaths.has(target.path))
      ) {
        return true;
      }
    }
    return false;
  }

  private rememberDisplayedResult(
    activeFile: TFile,
    result: GatheredLinks
  ): void {
    const paths = new Set<string>([activeFile.path]);
    const linkTexts = new Set<string>();
    const add = (entity: FileEntity) => {
      if (entity.targetPath) {
        paths.add(entity.targetPath);
      } else {
        const linkText = removeBlockReference(entity.linkText);
        const resolved = this.app.metadataCache.getFirstLinkpathDest(
          linkText,
          entity.sourcePath
        );
        if (resolved) {
          paths.add(resolved.path);
        } else {
          linkTexts.add(linkText);
        }
      }
    };
    result.links.forEach(add);
    result.newLinks.forEach(add);
    for (const twoHopLink of result.twoHopLinks) {
      add(twoHopLink.link);
      twoHopLink.fileEntities.forEach(add);
    }
    for (const propertiesLinks of result.tagLinksList) {
      propertiesLinks.fileEntities.forEach(add);
    }
    this.displayedPaths = paths;
    this.displayedLinkTexts = linkTexts;
    for (const path of paths) {
      const file = this.getFileByPath(path);
      if (file) {
        this.linkSignatures.rememberIfUnknown(
          path,
          this.app.metadataCache.getFileCache(file)
        );
      }
    }
  }

  private isCurrentModeHostMissingResults(): boolean {
    if (
      this.isUnloaded ||
      !this.showLinksInMarkdown ||
      this.settings.showTwoHopLinksInSeparatePane
    ) {
      return false;
    }
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView?.file || !this.isMarkdownHostReady(markdownView)) {
      return false;
    }
    return getCurrentMarkdownHostElements(
      markdownView.containerEl,
      markdownView.getMode()
    ).some((host) => !this.findDirectContainer(host)?.dataset.twohopRenderKey);
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
      `Link index builds ${stats.builds}, updated notes ${stats.patches}, ` +
      `result calculations ${stats.resultComputations}, result hits ${stats.resultCacheHits}, ` +
      `joined ${stats.joinedComputations}, cancelled ${stats.gatherCancellations}, last index build ${stats.lastBuildMs} ms, last result ${stats.lastGatherMs} ms`;
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
      this.scheduleRefresh(false, this.getRefreshDebounceMs());
    }
    this.refreshPaneButton();
  }

  // --- The title-bar button when results live in a side pane ---

  private paneRestore: {
    leaf: WorkspaceLeaf | null;
    collapse: boolean;
  } | null = null;
  private paneObserver: ResizeObserver | null = null;
  private observedPaneEl: HTMLElement | null = null;

  private readonly paneToggle: PaneToggle = {
    isEnabled: () => this.settings.showTwoHopLinksInSeparatePane,
    state: () => {
      const leaf = this.getPaneLeaf();
      const split = leaf ? this.sidebarOf(leaf) : null;
      const side =
        split === this.app.workspace.rightSplit
          ? "right"
          : split === this.app.workspace.leftSplit
          ? "left"
          : this.settings.panePositionIsRight
          ? "right"
          : "left";
      const showing =
        !!leaf &&
        !split?.collapsed &&
        leaf.view.containerEl.offsetParent !== null;
      return { side, showing };
    },
    toggle: () => this.togglePane(),
  };

  /** Shows the button for the open note and keeps its icon current. */
  private refreshPaneButton(): void {
    if (this.isUnloaded || !this.settings.showTwoHopLinksInSeparatePane) {
      this.observePaneLeaf(null);
      return;
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view) this.scrollNavigator.ensure(view);
    this.observePaneLeaf(this.getPaneLeaf());
    this.scrollNavigator.updateAll();
  }

  /**
   * Switching sidebar tabs by hand sends no workspace event, but the hidden
   * pane's size drops to zero, so its size tells when to refresh the icon.
   */
  private observePaneLeaf(leaf: WorkspaceLeaf | null): void {
    const el = leaf?.view.containerEl ?? null;
    if (el === this.observedPaneEl) return;
    this.paneObserver?.disconnect();
    this.paneObserver = null;
    this.observedPaneEl = el;
    if (!el) return;
    const ownerWindow = el.ownerDocument.defaultView;
    if (!ownerWindow || !("ResizeObserver" in ownerWindow)) return;
    this.paneObserver = new ownerWindow.ResizeObserver(() =>
      this.scrollNavigator.updateAll()
    );
    this.paneObserver.observe(el);
  }

  private getPaneLeaf(): WorkspaceLeaf | null {
    return this.app.workspace.getLeavesOfType("TwoHopLinksView")[0] ?? null;
  }

  private sidebarOf(leaf: WorkspaceLeaf): CollapsibleSplit | null {
    const root = leaf.getRoot();
    const { leftSplit, rightSplit } = this.app.workspace;
    return root === rightSplit || root === leftSplit
      ? (root as unknown as CollapsibleSplit)
      : null;
  }

  private paneSiblings(leaf: WorkspaceLeaf): WorkspaceLeaf[] {
    const parent = leaf.parent as unknown as { children?: unknown[] } | null;
    return (parent?.children ?? []).filter(
      (child): child is WorkspaceLeaf =>
        child instanceof WorkspaceLeaf && child !== leaf
    );
  }

  /**
   * Shows the 2-hop pane, remembering which tab (or a collapsed sidebar) it
   * replaced; pressed again, puts that back.
   */
  private async togglePane(): Promise<void> {
    let leaf = this.getPaneLeaf();
    if (!leaf) {
      await this.openTwoHopLinksView();
      leaf = this.getPaneLeaf();
      if (!leaf) return;
    }
    const split = this.sidebarOf(leaf);
    const siblings = this.paneSiblings(leaf);
    if (this.paneToggle.state().showing) {
      const restore = this.paneRestore;
      this.paneRestore = null;
      if (restore?.collapse && split) {
        split.collapse();
        return;
      }
      const back =
        restore?.leaf && siblings.includes(restore.leaf)
          ? restore.leaf
          : siblings[0];
      if (back) {
        await this.app.workspace.revealLeaf(back);
      } else {
        split?.collapse();
      }
      return;
    }
    this.paneRestore = {
      leaf:
        siblings.find(
          (sibling) => sibling.view.containerEl.offsetParent !== null
        ) ?? null,
      collapse: Boolean(split?.collapsed),
    };
    await this.app.workspace.revealLeaf(leaf);
  }

  private resolveEntityFile(fileEntity: FileEntity): TFile | null {
    const file = fileEntity.targetPath
      ? this.getFileByPath(fileEntity.targetPath)
      : this.app.metadataCache.getFirstLinkpathDest(
          removeBlockReference(fileEntity.linkText),
          fileEntity.sourcePath
        );
    return file && file.extension === "md" ? file : null;
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
    const references = [...(cache.links ?? []), ...(cache.embeds ?? [])]
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
    const separatePaneLeaves =
      this.app.workspace.getLeavesOfType("TwoHopLinksView");
    const activeLeafBeforeClose = this.app.workspace.activeLeaf;
    const activeSeparatePaneLeaf =
      separatePaneLeaves.find(
        (leaf) =>
          leaf === activeLeafBeforeClose &&
          leaf.view instanceof SeparatePaneView
      ) ?? null;
    const restoreContainer = activeSeparatePaneLeaf?.getContainer() ?? null;
    const recentLeafInSameContainer = restoreContainer
      ? this.app.workspace.getMostRecentLeaf(restoreContainer)
      : null;

    if (separatePaneLeaves.length > 0) {
      this.app.workspace.detachLeavesOfType("TwoHopLinksView");
    }
    if (this.settings.showTwoHopLinksInSeparatePane) {
      await this.openTwoHopLinksView();
      this.disableLinksInMarkdown();
      this.removePaddingBottom();
      this.refreshPaneButton();
    } else {
      const restoreLeaf = chooseInlineRestoreLeaf({
        didCloseActiveSeparatePane: activeSeparatePaneLeaf !== null,
        activeLeafAfterClose: this.app.workspace.activeLeaf,
        closedSeparatePaneLeaf: activeSeparatePaneLeaf,
        recentLeaf: recentLeafInSameContainer,
        expectedContainer: restoreContainer,
        isMarkdownLeaf: (leaf) => leaf.view instanceof MarkdownView,
        getContainer: (leaf) => leaf.getContainer(),
      });
      this.enableLinksInMarkdown(restoreLeaf);
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
    return getCurrentMarkdownHostElements(
      markdownView.containerEl,
      markdownView.getMode()
    );
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
      onReady: () => this.scheduleRefresh(false, 0),
    });
  }

  private findDirectContainer(host: HTMLElement): HTMLElement | null {
    return (
      (Array.from(host.children).find((child) =>
        child.classList.contains(CONTAINER_CLASS)
      ) as HTMLElement | undefined) ?? null
    );
  }

  private getMarkdownHostKind(
    host: HTMLElement
  ): "reading" | "editor" | "legacy" {
    if (host.matches(".markdown-preview-view")) return "reading";
    if (host.matches(".cm-sizer")) return "editor";
    return "legacy";
  }

  private prepareInlineContainer(host: HTMLElement): HTMLElement {
    const container =
      this.findDirectContainer(host) ??
      host.createDiv({ cls: CONTAINER_CLASS });
    container.classList.add(INLINE_CONTAINER_CLASS, RELATED_REGION_CLASS);
    container.dataset.twohopPlacement = "document-footer";
    const hostKind = this.getMarkdownHostKind(host);
    container.dataset.twohopHost = hostKind;
    if (hostKind === "editor") {
      container.dataset.twohopEngine = "cm6";
    } else {
      delete container.dataset.twohopEngine;
    }
    host.classList.add(HOST_RELATED_REGION_CLASS);
    return container;
  }

  private getContainerElements(markdownView: MarkdownView): HTMLElement[] {
    return this.getContainerHostElements(markdownView).map((host) =>
      this.prepareInlineContainer(host)
    );
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
      this.refreshPaneButton();
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
    if (isForceUpdate) {
      this.dataRevision++;
    }
    const sortOrder = this.prepareLinksForFile(activeFile);
    const renderKey = `${this.dataRevision}\n${sortOrder}\n${activeFile.path}`;
    this.removeOtherModeContainers(markdownView);
    if (
      this.getContainerHostElements(markdownView).every(
        (host) =>
          this.findDirectContainer(host)?.dataset.twohopRenderKey === renderKey
      )
    ) {
      this.scrollNavigator.ensure(markdownView);
      return;
    }
    const generation = ++this.renderGeneration;

    let gatheredLinks: GatheredLinks;
    if (this.lastGather?.key === renderKey) {
      gatheredLinks = this.lastGather.result;
    } else {
      this.linkSignatures.remember(
        activeFile.path,
        this.app.metadataCache.getFileCache(activeFile)
      );
      try {
        gatheredLinks = await this.links.gatherTwoHopLinks(activeFile);
      } catch (error) {
        if (isCalculationCancelled(error)) {
          return;
        }
        throw error;
      }
    }

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
    this.lastGather = { key: renderKey, result: gatheredLinks };
    this.rememberDisplayedResult(activeFile, gatheredLinks);

    if (!this.isMarkdownHostReady(markdownView)) {
      this.scheduleMarkdownHostRetry(activeLeaf, activeFile);
      return;
    }
    this.markdownHostRetry.cancel();
    this.removeOtherModeContainers(markdownView);
    for (const container of this.getContainerElements(markdownView)) {
      this.injectTwohopLinks(gatheredLinks, container, activeFile, sortOrder);
      container.dataset.twohopRenderKey = renderKey;
    }

    this.scrollNavigator.ensure(markdownView);
  }

  /** Unmounts results left in the hosts of the modes that are not shown. */
  private removeOtherModeContainers(markdownView: MarkdownView): void {
    const currentHosts = new Set(this.getContainerHostElements(markdownView));
    for (const host of getAllMarkdownHostElements(markdownView.containerEl)) {
      if (currentHosts.has(host)) continue;
      const container = this.findDirectContainer(host);
      if (container) {
        ReactDOM.unmountComponentAtNode(container);
        container.remove();
      }
      host.classList.remove(HOST_RELATED_REGION_CLASS);
    }
  }

  injectTwohopLinks(
    gatheredLinks: GatheredLinks,
    container: Element,
    sourceFile: TFile,
    sortOrder: SortOrder
  ): void {
    ReactDOM.render(
      <TwohopLinksRootView
        links={gatheredLinks.links}
        newLinks={gatheredLinks.newLinks}
        twoHopLinks={gatheredLinks.twoHopLinks}
        tagLinksList={gatheredLinks.tagLinksList}
        onClick={this.openFileEntity}
        getPreview={this.getCardPreview}
        getTitle={this.getCardTitle}
        app={this.app}
        showLinks={this.settings.showForwardConnectedLinks}
        showTwohopLinks={this.settings.showTwohopLinks}
        showNewLinks={this.settings.showNewLinks}
        showTagsLinks={this.settings.showTagsLinks}
        autoLoadTwoHopLinks={this.settings.autoLoadTwoHopLinks}
        includeBodyInCardSearch={this.settings.includeBodyInCardSearch}
        sourcePath={sourceFile.path}
        sortOrder={sortOrder}
        defaultSortOrder={this.settings.sortOrder}
        onSortOrderChange={this.handleSortOrderChange}
        initialBoxCount={this.settings.initialBoxCount}
        initialSectionCount={this.settings.initialSectionCount}
      />,
      container
    );
  }

  enableLinksInMarkdown(restoreLeaf: WorkspaceLeaf | null = null): void {
    this.showLinksInMarkdown = true;
    if (restoreLeaf) {
      this.app.workspace.setActiveLeaf(restoreLeaf, { focus: false });
    }
    this.scheduleRefresh(true, 0);
  }

  disableLinksInMarkdown(): void {
    this.showLinksInMarkdown = false;
    this.markdownHostRetry.cancel();
    this.refreshTask.cancel();
    this.links.cancelActiveGather();
    this.removeTwohopLinks();
    this.removePaddingBottom();
    this.popover?.close();
  }

  removeTwohopLinks(): void {
    this.scrollNavigator.removeAll();
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof MarkdownView)) return;

      for (const host of getAllMarkdownHostElements(leaf.view.containerEl)) {
        const container = this.findDirectContainer(host);
        if (container) {
          ReactDOM.unmountComponentAtNode(container);
          container.remove();
        }
        host.classList.remove(HOST_RELATED_REGION_CLASS);
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
