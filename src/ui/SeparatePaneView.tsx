import { TFile, WorkspaceLeaf, ItemView } from "obsidian";
import React from "react";
import ReactDOM from "react-dom";
import TwohopLinksPlugin from "../main";
import { Links } from "../links";

export class SeparatePaneView extends ItemView {
  private plugin: TwohopLinksPlugin;
  private lastActiveLeaf: WorkspaceLeaf | undefined;
  private lastMainFile: TFile | null = null;
  private previousLinks: string[] = [];
  private previousTags: string[] = [];
  private renderGeneration = 0;
  links: Links;

  constructor(leaf: WorkspaceLeaf, plugin: TwohopLinksPlugin, links: Links) {
    super(leaf);
    this.plugin = plugin;
    this.containerEl.addClass("TwoHopLinks");
    this.links = links;
  }

  getViewType(): string {
    return "TwoHopLinksView";
  }

  getDisplayText(): string {
    return "2Hop Links";
  }

  getIcon(): string {
    return "network";
  }

  async onOpen(): Promise<void> {
    try {
      this.lastActiveLeaf = this.app.workspace.getLeaf();
      this.lastMainFile = this.app.workspace.getActiveFile();
      await this.updateOrForceUpdate(true);

      this.registerActiveFileUpdateEvent();

      this.registerEvent(
        this.app.metadataCache.on("changed", async (file: TFile) => {
          if (file === this.lastMainFile) {
            await this.updateOrForceUpdate(false);
          }
        })
      );
    } catch (error) {
      this.handleError("Error updating TwoHopLinksView", error);
    }
  }

  async updateOrForceUpdate(isForceUpdate: boolean): Promise<void> {
    try {
      const activeFile = this.lastMainFile;
      const currentLinks = this.getActiveFileLinks(activeFile);
      const currentTags = this.getActiveFileTags(activeFile);

      if (
        isForceUpdate ||
        this.previousLinks.sort().join(",") !== currentLinks.sort().join(",") ||
        this.previousTags.sort().join(",") !== currentTags.sort().join(",") ||
        activeFile === null
      ) {
        const generation = ++this.renderGeneration;
        const activePath = activeFile?.path ?? null;
        const {
          forwardLinks,
          newLinks,
          backwardLinks,
          twoHopLinks,
          tagLinksList,
          frontmatterKeyLinksList,
        } = await this.links.gatherTwoHopLinks(activeFile);

        if (
          generation !== this.renderGeneration ||
          (this.lastMainFile?.path ?? null) !== activePath
        ) {
          return;
        }

        ReactDOM.unmountComponentAtNode(this.containerEl);
        await this.plugin.injectTwohopLinks(
          forwardLinks,
          newLinks,
          backwardLinks,
          twoHopLinks,
          tagLinksList,
          frontmatterKeyLinksList,
          this.containerEl
        );

        this.addLinkEventListeners();

        this.previousLinks = currentLinks;
        this.previousTags = currentTags;
      }
    } catch (error) {
      this.handleError("Error rendering two hop links", error);
    }
  }

  handleError(message: string, error: any): void {
    console.error(message, error);
    ReactDOM.unmountComponentAtNode(this.containerEl);
    ReactDOM.render(
      <div>Error: Could not render two hop links</div>,
      this.containerEl
    );
  }

  private shouldIgnoreActiveLeaf(leaf: WorkspaceLeaf | null): boolean {
    if (!leaf || leaf.view === this) {
      return true;
    }

    const leafAny = leaf as any;
    const viewAny = leaf.view as any;
    const containerEl = viewAny.containerEl ?? leafAny.containerEl;
    const parentEl = containerEl?.parentElement;
    const viewType =
      typeof leaf.view.getViewType === "function"
        ? leaf.view.getViewType()
        : "";

    if (viewType === "hover-editor" || viewType === "markdown-hover") {
      return true;
    }

    if (
      leafAny.hoverPopover ||
      leafAny.isHoverPopover ||
      viewAny.hoverPopover
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

  private async updateActiveFileFromLeaf(
    leaf: WorkspaceLeaf | null,
    file?: TFile | null
  ): Promise<void> {
    if (this.shouldIgnoreActiveLeaf(leaf)) {
      return;
    }

    const newActiveFile =
      file ?? ((leaf?.view as any)?.file as TFile | null) ?? null;
    if (!newActiveFile) {
      return;
    }

    const newActiveFilePath = newActiveFile.path;
    if ((this.lastMainFile?.path ?? null) !== newActiveFilePath) {
      this.lastActiveLeaf = leaf ?? undefined;
      this.lastMainFile = newActiveFile;
      await this.updateOrForceUpdate(true);
    }
  }

  registerActiveFileUpdateEvent() {
    let lastActiveFilePath: string | null = this.lastMainFile?.path ?? null;

    this.registerEvent(
      this.app.workspace.on(
        "active-leaf-change",
        async (leaf: WorkspaceLeaf) => {
          const previousFilePath = this.lastMainFile?.path ?? null;
          await this.updateActiveFileFromLeaf(leaf);
          if (previousFilePath !== (this.lastMainFile?.path ?? null)) {
            lastActiveFilePath = this.lastMainFile?.path ?? null;
          }
        }
      )
    );

    this.registerEvent(
      this.app.workspace.on("file-open", async (file: TFile | null) => {
        const leaf = this.app.workspace.activeLeaf;
        const activeFile = this.app.workspace.getActiveFile();
        if (
          file &&
          activeFile?.path === file.path &&
          !this.shouldIgnoreActiveLeaf(leaf) &&
          lastActiveFilePath !== file.path
        ) {
          await this.updateActiveFileFromLeaf(leaf, file);
          const newActiveFilePath = this.lastMainFile?.path ?? null;
          if (lastActiveFilePath !== newActiveFilePath) {
            lastActiveFilePath = newActiveFilePath;
          }
        }
      })
    );
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
      if (typeof cache.frontmatter.tags === "string") {
        tags.push(cache.frontmatter.tags);
      } else if (Array.isArray(cache.frontmatter.tags)) {
        tags = tags.concat(cache.frontmatter.tags);
      }
    }

    return tags;
  }

  addLinkEventListeners(): void {
    const links = this.containerEl.querySelectorAll("a");
    links.forEach((link) => {
      link.addEventListener("click", async (event) => {
        event.preventDefault();

        const filePath = link.getAttribute("href");
        if (!filePath) {
          console.error("Link does not have href attribute", link);
          return;
        }

        const fileOrFolder = this.app.vault.getAbstractFileByPath(filePath);
        if (!fileOrFolder || !(fileOrFolder instanceof TFile)) {
          console.error("No file found for path", filePath);
          return;
        }
        const file = fileOrFolder as TFile;

        if (!this.lastActiveLeaf) {
          console.error("No last active leaf");
          return;
        }

        await this.lastActiveLeaf.openFile(file);
      });
    });
  }
}
