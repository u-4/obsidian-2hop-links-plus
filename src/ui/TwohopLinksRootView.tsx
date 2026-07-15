import { TwohopLink } from "../model/TwohopLink";
import React, { createRef } from "react";
import { FileEntity } from "../model/FileEntity";
import TwohopLinksView from "./TwohopLinksView";
import ConnectedLinksView from "./ConnectedLinksView";
import NewLinksView from "./NewLinksView";
import { PropertiesLinks } from "../model/PropertiesLinks";
import { App, Menu, setIcon } from "obsidian";
import PropertiesLinksListView from "./TagLinksListView";
import { OpenPaneTarget } from "../types";
import {
  BODY_SEARCH_DEBOUNCE_MS,
  collectVisibleCardSearchEntities,
  populateBodySearchTexts,
} from "../bodySearch";
import {
  filterFileEntities,
  filterPropertiesLinks,
  filterTwoHopLinks,
} from "../search";
import { SORT_ORDER_OPTIONS } from "../settings/sortOptions";
import type { SortOrder } from "../settings/sortOptions";
import { getNextLoadedState } from "./twohopLinksLoadState";
import {
  getNextSearchDisclosureState,
  getSortMenuEntries,
  hasTemporarySortOverride,
  isSortMenuContextCurrent,
  reserveResultsHeight,
} from "./toolbarModel";

interface TwohopLinksRootViewProps {
  forwardConnectedLinks: FileEntity[];
  newLinks: FileEntity[];
  backwardConnectedLinks: FileEntity[];
  twoHopLinks: TwohopLink[];
  tagLinksList: PropertiesLinks[];
  frontmatterKeyLinksList: PropertiesLinks[];
  onClick: (fileEntity: FileEntity, newLeaf?: OpenPaneTarget) => Promise<void>;
  getPreview: (fileEntity: FileEntity) => Promise<string>;
  getTitle: (fileEntity: FileEntity) => Promise<string>;
  app: App;
  showForwardConnectedLinks: boolean;
  showBackwardConnectedLinks: boolean;
  showTwohopLinks: boolean;
  showNewLinks: boolean;
  showTagsLinks: boolean;
  showPropertiesLinks: boolean;
  autoLoadTwoHopLinks: boolean;
  includeBodyInCardSearch: boolean;
  sourcePath: string;
  sortOrder: SortOrder;
  defaultSortOrder: SortOrder;
  onSortOrderChange: (sortOrder: string) => Promise<void>;
  initialBoxCount: number;
  initialSectionCount: number;
}

type Category =
  | "forwardConnectedLinks"
  | "backwardConnectedLinks"
  | "twoHopLinks"
  | "newLinks"
  | "tagLinksList"
  | "frontmatterKeyLinksList";

interface TwohopLinksRootViewState {
  displayedBoxCount: Record<Category, number>;
  displayedSectionCount: Record<Category, number>;
  prevProps: TwohopLinksRootViewProps | null;
  isLoaded: boolean;
  searchInput: string;
  searchQuery: string;
  includeBodyInSearchResults: boolean;
  isPreparingBodySearch: boolean;
  isSearchExpanded: boolean;
  isSortMenuOpen: boolean;
  reservedResultsHeight: number | null;
  resetCounter: number;
}

export default class TwohopLinksRootView extends React.Component<
  TwohopLinksRootViewProps,
  TwohopLinksRootViewState
> {
  loadMoreRefs: Record<Category, React.RefObject<HTMLButtonElement>> = {
    forwardConnectedLinks: createRef(),
    newLinks: createRef(),
    backwardConnectedLinks: createRef(),
    twoHopLinks: createRef(),
    tagLinksList: createRef(),
    frontmatterKeyLinksList: createRef(),
  };
  private searchDebounceTimer: number | null = null;
  private searchGeneration = 0;
  private isUnmounted = false;
  private searchButtonRef = createRef<HTMLButtonElement>();
  private searchInputRef = createRef<HTMLInputElement>();
  private settingsButtonRef = createRef<HTMLButtonElement>();
  private sortButtonRef = createRef<HTMLButtonElement>();
  private resultsBodyRef = createRef<HTMLDivElement>();
  private activeSortMenu: Menu | null = null;
  private activeSortMenuScope: HTMLDivElement | null = null;
  private restoreSortFocusOnHide = true;

  constructor(props: TwohopLinksRootViewProps) {
    super(props);
    this.state = {
      displayedBoxCount: {
        forwardConnectedLinks: props.initialBoxCount,
        newLinks: props.initialBoxCount,
        backwardConnectedLinks: props.initialBoxCount,
        twoHopLinks: props.initialBoxCount,
        tagLinksList: props.initialBoxCount,
        frontmatterKeyLinksList: props.initialBoxCount,
      },
      displayedSectionCount: {
        forwardConnectedLinks: props.initialSectionCount,
        newLinks: props.initialSectionCount,
        backwardConnectedLinks: props.initialSectionCount,
        twoHopLinks: props.initialSectionCount,
        tagLinksList: props.initialSectionCount,
        frontmatterKeyLinksList: props.initialSectionCount,
      },
      prevProps: null,
      isLoaded: props.autoLoadTwoHopLinks,
      searchInput: "",
      searchQuery: "",
      includeBodyInSearchResults: props.includeBodyInCardSearch,
      isPreparingBodySearch: false,
      isSearchExpanded: false,
      isSortMenuOpen: false,
      reservedResultsHeight: null,
      resetCounter: 0,
    };
  }

  private initialDisplayedBoxCount(): Record<Category, number> {
    return {
      forwardConnectedLinks: this.props.initialBoxCount,
      newLinks: this.props.initialBoxCount,
      backwardConnectedLinks: this.props.initialBoxCount,
      twoHopLinks: this.props.initialBoxCount,
      tagLinksList: this.props.initialBoxCount,
      frontmatterKeyLinksList: this.props.initialBoxCount,
    };
  }

  private initialDisplayedSectionCount(): Record<Category, number> {
    return {
      forwardConnectedLinks: this.props.initialSectionCount,
      newLinks: this.props.initialSectionCount,
      backwardConnectedLinks: this.props.initialSectionCount,
      twoHopLinks: this.props.initialSectionCount,
      tagLinksList: this.props.initialSectionCount,
      frontmatterKeyLinksList: this.props.initialSectionCount,
    };
  }

  handleSearchChange = (searchInput: string): void => {
    const shouldReserve =
      searchInput.trim().length > 0 &&
      this.state.reservedResultsHeight === null;
    const measuredHeight = shouldReserve
      ? this.resultsBodyRef.current?.getBoundingClientRect().height ?? 0
      : 0;
    this.setState((prevState) => ({
      searchInput,
      reservedResultsHeight: shouldReserve
        ? reserveResultsHeight(prevState.reservedResultsHeight, measuredHeight)
        : prevState.reservedResultsHeight,
    }));
    this.scheduleSearch(searchInput);
  };

  private updateSearchDisclosure(action: "toggle" | "close"): void {
    const nextState = getNextSearchDisclosureState(
      {
        isExpanded: this.state.isSearchExpanded,
        searchInput: this.state.searchInput,
      },
      action
    );
    this.setState(
      {
        isSearchExpanded: nextState.isExpanded,
        searchInput: nextState.searchInput,
      },
      () => {
        if (nextState.isExpanded) {
          this.searchInputRef.current?.focus();
        } else {
          this.searchButtonRef.current?.focus();
        }
      }
    );

    if (!nextState.isExpanded) {
      this.clearSearchFilter();
    }
  }

  private clearSearchFilter(): void {
    if (this.searchDebounceTimer != null) {
      window.clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    this.searchGeneration += 1;
    this.applyDebouncedSearch("", false);
  }

  private hideSortMenu(restoreFocus: boolean): void {
    if (!this.activeSortMenu) {
      this.removeSortMenuScope();
      return;
    }
    this.restoreSortFocusOnHide = restoreFocus;
    this.activeSortMenu.hide();
  }

  private removeSortMenuScope(): void {
    this.activeSortMenuScope?.remove();
    this.activeSortMenuScope = null;
  }

  private showSortMenu(button: HTMLButtonElement): void {
    if (this.activeSortMenu) {
      this.hideSortMenu(true);
      return;
    }

    this.searchInputRef.current?.blur();
    const sourcePath = this.props.sourcePath;
    const menu = new Menu();
    const menuScope = button.ownerDocument.createElement("div");
    menuScope.className = "twohop-links-sort-menu-scope";
    button.ownerDocument.body.append(menuScope);
    menu.setParentElement(menuScope);
    this.activeSortMenuScope = menuScope;
    for (const entry of getSortMenuEntries(this.props.sortOrder)) {
      menu.addItem((item) =>
        item
          .setTitle(entry.label)
          .setChecked(entry.isCurrent)
          .onClick(() => {
            if (
              !isSortMenuContextCurrent(
                sourcePath,
                this.props.sourcePath,
                this.props.app.workspace.getActiveFile()?.path ?? null
              )
            ) {
              return;
            }
            return this.props.onSortOrderChange(entry.value);
          })
      );
    }

    this.activeSortMenu = menu;
    this.restoreSortFocusOnHide = true;
    menu.onHide(() => {
      if (this.activeSortMenu !== menu) return;

      const shouldRestoreFocus = this.restoreSortFocusOnHide;
      this.activeSortMenu = null;
      this.restoreSortFocusOnHide = true;
      this.removeSortMenuScope();
      if (!this.isUnmounted) {
        this.setState({ isSortMenuOpen: false }, () => {
          if (shouldRestoreFocus && button.isConnected) {
            button.focus();
          }
        });
      }
    });

    this.setState({ isSortMenuOpen: true });
    const bounds = button.getBoundingClientRect();
    menu.showAtPosition(
      { x: bounds.left, y: bounds.bottom },
      button.ownerDocument
    );
  }

  private scheduleSearch(searchInput: string): void {
    if (this.searchDebounceTimer != null) {
      window.clearTimeout(this.searchDebounceTimer);
    }

    const generation = ++this.searchGeneration;
    this.searchDebounceTimer = window.setTimeout(async () => {
      const shouldReadBodies =
        this.props.includeBodyInCardSearch && searchInput.trim().length > 0;

      if (this.isUnmounted || generation !== this.searchGeneration) {
        return;
      }

      this.applyDebouncedSearch(searchInput, false);

      if (!shouldReadBodies) {
        return;
      }

      this.setState({ isPreparingBodySearch: true });
      await populateBodySearchTexts(
        this.props.app,
        collectVisibleCardSearchEntities({
          showForwardConnectedLinks: this.props.showForwardConnectedLinks,
          showBackwardConnectedLinks: this.props.showBackwardConnectedLinks,
          showTwohopLinks: this.props.showTwohopLinks,
          showNewLinks: this.props.showNewLinks,
          showTagsLinks: this.props.showTagsLinks,
          showPropertiesLinks: this.props.showPropertiesLinks,
          forwardLinks: this.props.forwardConnectedLinks,
          newLinks: this.props.newLinks,
          backwardLinks: this.props.backwardConnectedLinks,
          twoHopLinks: this.props.twoHopLinks,
          tagLinksList: this.props.tagLinksList,
          frontmatterKeyLinksList: this.props.frontmatterKeyLinksList,
        })
      );

      if (this.isUnmounted || generation !== this.searchGeneration) {
        return;
      }

      this.applyDebouncedSearch(searchInput, true);
    }, BODY_SEARCH_DEBOUNCE_MS);
  }

  private applyDebouncedSearch(
    searchQuery: string,
    includeBody: boolean
  ): void {
    this.setState((prevState) => ({
      searchQuery,
      includeBodyInSearchResults: includeBody,
      isPreparingBodySearch: false,
      displayedBoxCount: this.initialDisplayedBoxCount(),
      displayedSectionCount: this.initialDisplayedSectionCount(),
      resetCounter: prevState.resetCounter + 1,
      prevProps: this.props,
      reservedResultsHeight:
        searchQuery.trim().length === 0
          ? null
          : prevState.reservedResultsHeight,
    }));
  }

  loadMoreBox = (category: Category): void => {
    this.setState((prevState) => ({
      displayedBoxCount: {
        ...prevState.displayedBoxCount,
        [category]:
          prevState.displayedBoxCount[category] + this.props.initialBoxCount,
      },
      prevProps: this.props,
    }));
  };

  loadMoreSections = (category: Category): void => {
    this.setState((prevState) => ({
      displayedSectionCount: {
        ...prevState.displayedSectionCount,
        [category]:
          prevState.displayedSectionCount[category] +
          this.props.initialSectionCount,
      },
      prevProps: this.props,
    }));
  };

  componentDidMount(): void {
    this.updateToolbarIcons();
    for (const ref of Object.values(this.loadMoreRefs)) {
      if (ref.current) {
        setIcon(ref.current, "more-horizontal");
      }
    }
  }

  componentDidUpdate(prevProps: TwohopLinksRootViewProps): void {
    if (prevProps.sourcePath !== this.props.sourcePath) {
      this.hideSortMenu(false);
    }
    if (this.props !== prevProps) {
      this.setState((prevState) => ({
        displayedBoxCount: this.initialDisplayedBoxCount(),
        displayedSectionCount: this.initialDisplayedSectionCount(),
        prevProps: this.props,
        isLoaded: getNextLoadedState(prevState.isLoaded, prevProps, this.props),
        reservedResultsHeight:
          prevProps.sourcePath !== this.props.sourcePath
            ? null
            : prevState.reservedResultsHeight,
        resetCounter: prevState.resetCounter + 1,
      }));
      if (this.state.searchInput.trim().length > 0) {
        this.scheduleSearch(this.state.searchInput);
      }
    }
    this.updateToolbarIcons();
    for (const ref of Object.values(this.loadMoreRefs)) {
      if (ref.current) {
        setIcon(ref.current, "more-horizontal");
      }
    }
  }

  componentWillUnmount(): void {
    this.isUnmounted = true;
    this.hideSortMenu(false);
    this.activeSortMenu = null;
    this.removeSortMenuScope();
    this.searchGeneration++;
    if (this.searchDebounceTimer != null) {
      window.clearTimeout(this.searchDebounceTimer);
    }
  }

  private updateToolbarIcons(): void {
    if (this.searchButtonRef.current) {
      setIcon(this.searchButtonRef.current, "search");
    }
    if (this.settingsButtonRef.current) {
      setIcon(this.settingsButtonRef.current, "settings");
    }
    if (this.sortButtonRef.current) {
      setIcon(this.sortButtonRef.current, "arrow-up-down");
    }
  }

  render(): JSX.Element {
    const {
      showForwardConnectedLinks,
      showBackwardConnectedLinks,
      showTwohopLinks,
      showNewLinks,
      showTagsLinks,
      showPropertiesLinks,
      autoLoadTwoHopLinks,
    } = this.props;
    const { isLoaded } = this.state;
    const includeBody = this.state.includeBodyInSearchResults;
    const currentSortLabel = SORT_ORDER_OPTIONS[this.props.sortOrder];
    const isTemporarySort = hasTemporarySortOverride(
      this.props.sortOrder,
      this.props.defaultSortOrder
    );
    const filteredForwardConnectedLinks = showForwardConnectedLinks
      ? filterFileEntities(
          this.props.app,
          this.props.forwardConnectedLinks,
          this.state.searchQuery,
          includeBody
        )
      : [];
    const filteredBackwardConnectedLinks = showBackwardConnectedLinks
      ? filterFileEntities(
          this.props.app,
          this.props.backwardConnectedLinks,
          this.state.searchQuery,
          includeBody
        )
      : [];
    const filteredNewLinks = showNewLinks
      ? filterFileEntities(
          this.props.app,
          this.props.newLinks,
          this.state.searchQuery,
          includeBody
        )
      : [];
    const filteredTwoHopLinks = showTwohopLinks
      ? filterTwoHopLinks(
          this.props.app,
          this.props.twoHopLinks,
          this.state.searchQuery,
          includeBody
        )
      : [];
    const filteredTagLinksList = showTagsLinks
      ? filterPropertiesLinks(
          this.props.app,
          this.props.tagLinksList,
          this.state.searchQuery,
          includeBody
        )
      : [];
    const filteredFrontmatterKeyLinksList = showPropertiesLinks
      ? filterPropertiesLinks(
          this.props.app,
          this.props.frontmatterKeyLinksList,
          this.state.searchQuery,
          includeBody
        )
      : [];

    if (!autoLoadTwoHopLinks && !isLoaded) {
      return (
        <div className="twohop-links-root twohop-links-results">
          <button
            className="load-more-button twohop-links-load-more"
            onClick={() => this.setState({ isLoaded: true })}
          >
            Show 2hop links
          </button>
        </div>
      );
    }

    return (
      <div className="twohop-links-root twohop-links-results">
        <div className="twohop-links-toolbar">
          <div
            className={`twohop-links-search-control${
              this.state.isSearchExpanded ? " is-expanded" : ""
            }`}
          >
            <button
              ref={this.searchButtonRef}
              type="button"
              className="clickable-icon twohop-links-toolbar-button twohop-links-search-button"
              aria-label={
                this.state.isSearchExpanded
                  ? "Close and clear related-card search"
                  : "Search related cards"
              }
              aria-expanded={this.state.isSearchExpanded}
              title={
                this.state.isSearchExpanded
                  ? "Close and clear search"
                  : "Search related cards"
              }
              onClick={() => this.updateSearchDisclosure("toggle")}
            />
            {this.state.isSearchExpanded && (
              <input
                ref={this.searchInputRef}
                className="twohop-links-search-input"
                type="search"
                value={this.state.searchInput}
                aria-label="Search related cards"
                onChange={(event) =>
                  this.handleSearchChange(event.currentTarget.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    this.updateSearchDisclosure("close");
                  }
                }}
              />
            )}
          </div>
          <button
            ref={this.settingsButtonRef}
            type="button"
            className="clickable-icon twohop-links-toolbar-button twohop-links-settings-button"
            aria-label="Open 2Hop Links Plus settings"
            title="Open settings"
            onClick={() => {
              this.props.app.setting.open();
              this.props.app.setting.openTabById("2hop-links-plus");
            }}
          />
          <button
            ref={this.sortButtonRef}
            type="button"
            className={`clickable-icon twohop-links-toolbar-button twohop-links-sort-button${
              this.state.isSortMenuOpen ? " is-active" : ""
            }${isTemporarySort ? " has-temporary-sort" : ""}`}
            aria-label={`Change temporary sort order. Current: ${currentSortLabel}${
              isTemporarySort ? ". Temporary override active" : ""
            }`}
            aria-haspopup="menu"
            aria-expanded={this.state.isSortMenuOpen}
            title={`Temporary sort order: ${currentSortLabel}${
              isTemporarySort ? " (differs from default)" : ""
            }`}
            onClick={(event) => this.showSortMenu(event.currentTarget)}
          />
        </div>
        {this.state.isPreparingBodySearch && (
          <div
            className="twohop-links-search-status"
            role="status"
            aria-live="polite"
          >
            Searching body...
          </div>
        )}
        <div
          ref={this.resultsBodyRef}
          className="twohop-links-results-body"
          style={
            this.state.reservedResultsHeight === null
              ? undefined
              : { minHeight: `${this.state.reservedResultsHeight}px` }
          }
        >
          {showForwardConnectedLinks && (
            <ConnectedLinksView
              fileEntities={filteredForwardConnectedLinks}
              displayedBoxCount={
                this.state.displayedBoxCount.forwardConnectedLinks
              }
              onClick={this.props.onClick}
              getPreview={this.props.getPreview}
              getTitle={this.props.getTitle}
              onLoadMore={() => this.loadMoreBox("forwardConnectedLinks")}
              title={"Links"}
              className={"twohop-links-forward-links"}
              app={this.props.app}
            />
          )}
          {showBackwardConnectedLinks && (
            <ConnectedLinksView
              fileEntities={filteredBackwardConnectedLinks}
              displayedBoxCount={
                this.state.displayedBoxCount.backwardConnectedLinks
              }
              onClick={this.props.onClick}
              getPreview={this.props.getPreview}
              getTitle={this.props.getTitle}
              onLoadMore={() => this.loadMoreBox("backwardConnectedLinks")}
              title={"Back Links"}
              className={"twohop-links-back-links"}
              app={this.props.app}
            />
          )}
          {showTwohopLinks && (
            <TwohopLinksView
              twoHopLinks={filteredTwoHopLinks}
              onClick={this.props.onClick}
              getPreview={this.props.getPreview}
              getTitle={this.props.getTitle}
              app={this.props.app}
              displayedSectionCount={
                this.state.displayedSectionCount.twoHopLinks
              }
              initialDisplayedEntitiesCount={this.props.initialBoxCount}
              resetCounter={this.state.resetCounter}
            />
          )}
          {this.state.displayedSectionCount.twoHopLinks <
            filteredTwoHopLinks.length && (
            <button
              ref={this.loadMoreRefs.twoHopLinks}
              className="load-more-button"
              onClick={() => this.loadMoreSections("twoHopLinks")}
            >
              Load more
            </button>
          )}
          {showNewLinks && (
            <NewLinksView
              fileEntities={filteredNewLinks}
              displayedBoxCount={this.state.displayedBoxCount.newLinks}
              onClick={this.props.onClick}
              getPreview={this.props.getPreview}
              getTitle={this.props.getTitle}
              onLoadMore={() => this.loadMoreBox("newLinks")}
              app={this.props.app}
            />
          )}
          {showTagsLinks && (
            <PropertiesLinksListView
              propertiesLinksList={filteredTagLinksList}
              onClick={this.props.onClick}
              getPreview={this.props.getPreview}
              getTitle={this.props.getTitle}
              app={this.props.app}
              displayedSectionCount={
                this.state.displayedSectionCount.tagLinksList
              }
              initialDisplayedEntitiesCount={this.props.initialBoxCount}
              resetCounter={this.state.resetCounter}
            />
          )}
          {this.state.displayedSectionCount.tagLinksList <
            filteredTagLinksList.length && (
            <button
              ref={this.loadMoreRefs.tagLinksList}
              className="load-more-button"
              onClick={() => this.loadMoreSections("tagLinksList")}
            >
              Load more
            </button>
          )}
          {showPropertiesLinks && (
            <PropertiesLinksListView
              propertiesLinksList={filteredFrontmatterKeyLinksList}
              onClick={this.props.onClick}
              getPreview={this.props.getPreview}
              getTitle={this.props.getTitle}
              app={this.props.app}
              displayedSectionCount={
                this.state.displayedSectionCount.frontmatterKeyLinksList
              }
              initialDisplayedEntitiesCount={this.props.initialBoxCount}
              resetCounter={this.state.resetCounter}
            />
          )}
          {this.state.displayedSectionCount.frontmatterKeyLinksList <
            filteredFrontmatterKeyLinksList.length && (
            <button
              ref={this.loadMoreRefs.frontmatterKeyLinksList}
              className="load-more-button"
              onClick={() => this.loadMoreSections("frontmatterKeyLinksList")}
            >
              Load more
            </button>
          )}
        </div>
      </div>
    );
  }
}
