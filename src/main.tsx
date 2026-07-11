import {
  MarkdownView,
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
import { OpenPaneTarget } from "./types";
import { isSortOrder } from "./settings/sortOptions";
import type { SortOrder } from "./settings/sortOptions";
import {
  getRuntimeLeafParts,
  openLinkTextCompat,
  unregisterHoverLinkSourceCompat,
} from "./obsidianCompat";

const CONTAINER_CLASS = "twohop-links-container";
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

  async onload(): Promise<void> {
    console.debug("------ loading obsidian-twohop-links plugin");

    this.settings = await loadSettings(this);
    this.showLinksInMarkdown = true;
    this.links = new Links(this.app, this.settings);

    this.initPlugin();
  }

  async initPlugin(): Promise<void> {
    this.addSettingTab(new TwohopSettingTab(this.app, this));
    this.registerView(
      "TwoHopLinksView",
      (leaf: WorkspaceLeaf) => new SeparatePaneView(leaf, this, this.links)
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", async (file: TFile) => {
        if (file === this.app.workspace.getActiveFile()) {
          await this.renderTwohopLinks(false);
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on(
        "active-leaf-change",
        this.refreshTwohopLinks.bind(this)
      )
    );
    this.registerEvent(
      this.app.workspace.on("file-open", async () => {
        await this.refreshTwohopLinks(this.app.workspace.activeLeaf);
      })
    );
    this.app.workspace.trigger("parse-style-settings");

    await this.renderTwohopLinks(true);
  }

  onunload(): void {
    this.disableLinksInMarkdown();
    console.log("unloading plugin");
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

    if (this.showLinksInMarkdown) {
      await this.renderTwohopLinks(true);
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
    if (this.isTwoHopLinksViewOpen()) {
      this.app.workspace.detachLeavesOfType("TwoHopLinksView");
    }
    if (this.settings.showTwoHopLinksInSeparatePane) {
      this.openTwoHopLinksView();
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

    leaf.setViewState({ type: "TwoHopLinksView" });
    this.app.workspace.revealLeaf(leaf);
  }

  private getContainerElements(markdownView: MarkdownView): Element[] {
    const elements = markdownView.containerEl.querySelectorAll(
      ".markdown-source-view .CodeMirror-lines, .markdown-preview-view, .markdown-source-view .cm-sizer"
    );

    const containers: Element[] = [];
    for (let i = 0; i < elements.length; i++) {
      const el = elements.item(i);
      const container =
        el.querySelector("." + CONTAINER_CLASS) ||
        el.createDiv({ cls: CONTAINER_CLASS });
      containers.push(container);
    }

    return containers;
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
    if (this.settings.showTwoHopLinksInSeparatePane) {
      return;
    }
    this.addPaddingBottom();
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFile = markdownView?.file;
    if (!activeFile) {
      return;
    }
    this.prepareLinksForFile(activeFile);
    const generation = ++this.renderGeneration;

    const currentLinks = this.getActiveFileLinks(activeFile);
    const currentTags = this.getActiveFileTags(activeFile);

    if (
      isForceUpdate ||
      this.previousLinks.sort().join(",") !== currentLinks.sort().join(",") ||
      this.previousTags.sort().join(",") !== currentTags.sort().join(",")
    ) {
      const {
        forwardLinks,
        newLinks,
        backwardLinks,
        twoHopLinks,
        tagLinksList,
        frontmatterKeyLinksList,
      } = await this.links.gatherTwoHopLinks(activeFile);

      const currentActiveFile = this.app.workspace.getActiveFile();
      if (
        generation !== this.renderGeneration ||
        currentActiveFile?.path !== activeFile.path
      ) {
        return;
      }

      for (const container of this.getContainerElements(markdownView)) {
        await this.injectTwohopLinks(
          forwardLinks,
          newLinks,
          backwardLinks,
          twoHopLinks,
          tagLinksList,
          frontmatterKeyLinksList,
          container
        );
      }

      this.previousLinks = currentLinks;
      this.previousTags = currentTags;
    }
  }

  async injectTwohopLinks(
    forwardConnectedLinks: FileEntity[],
    newLinks: FileEntity[],
    backwardConnectedLinks: FileEntity[],
    twoHopLinks: TwohopLink[],
    tagLinksList: PropertiesLinks[],
    frontmatterKeyLinksList: PropertiesLinks[],
    container: Element
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
        sortOrder={this.prepareLinksForFile(this.app.workspace.getActiveFile())}
        onSortOrderChange={this.setTemporarySortOrder.bind(this)}
        initialBoxCount={this.settings.initialBoxCount}
        initialSectionCount={this.settings.initialSectionCount}
      />,
      container
    );
  }

  enableLinksInMarkdown(): void {
    this.showLinksInMarkdown = true;
    this.renderTwohopLinks(true).then(() =>
      console.debug("Rendered two hop links")
    );
  }

  disableLinksInMarkdown(): void {
    this.showLinksInMarkdown = false;
    this.removeTwohopLinks();
    const container = this.app.workspace.containerEl.querySelector(
      ".twohop-links-container"
    );
    if (container) {
      ReactDOM.unmountComponentAtNode(container);
      container.remove();
    }
    unregisterHoverLinkSourceCompat(this.app.workspace, HOVER_LINK_ID);
  }

  removeTwohopLinks(): void {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (markdownView !== null) {
      for (const element of this.getContainerElements(markdownView)) {
        const container = element.querySelector("." + CONTAINER_CLASS);
        if (container) {
          container.remove();
        }
      }

      if (markdownView.previewMode !== null) {
        const previewElements = Array.from(
          markdownView.previewMode.containerEl.querySelectorAll(
            "." + CONTAINER_CLASS
          )
        );
        for (const element of previewElements) {
          element.remove();
        }
      }
    }
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
