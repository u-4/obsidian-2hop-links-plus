import { TwohopLink } from "../model/TwohopLink";
import React, { createRef } from "react";
import { FileEntity } from "../model/FileEntity";
import TwohopLinksView from "./TwohopLinksView";
import ConnectedLinksView from "./ConnectedLinksView";
import NewLinksView from "./NewLinksView";
import { PropertiesLinks } from "../model/PropertiesLinks";
import { App, setIcon } from "obsidian";
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

  handleSearchChange = (searchInput: string) => {
    this.setState({ searchInput });
    this.scheduleSearch(searchInput);
  };

  private scheduleSearch(searchInput: string) {
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

  private applyDebouncedSearch(searchQuery: string, includeBody: boolean) {
    this.setState((prevState) => ({
      searchQuery,
      includeBodyInSearchResults: includeBody,
      isPreparingBodySearch: false,
      displayedBoxCount: this.initialDisplayedBoxCount(),
      displayedSectionCount: this.initialDisplayedSectionCount(),
      resetCounter: prevState.resetCounter + 1,
      prevProps: this.props,
    }));
  }

  loadMoreBox = (category: Category) => {
    this.setState((prevState) => ({
      displayedBoxCount: {
        ...prevState.displayedBoxCount,
        [category]:
          prevState.displayedBoxCount[category] + this.props.initialBoxCount,
      },
      prevProps: this.props,
    }));
  };

  loadMoreSections = (category: Category) => {
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

  componentDidMount() {
    for (const ref of Object.values(this.loadMoreRefs)) {
      if (ref.current) {
        setIcon(ref.current, "more-horizontal");
      }
    }
  }

  componentDidUpdate(prevProps: TwohopLinksRootViewProps) {
    if (this.props !== prevProps) {
      this.setState((prevState) => ({
        displayedBoxCount: this.initialDisplayedBoxCount(),
        displayedSectionCount: this.initialDisplayedSectionCount(),
        prevProps: this.props,
        isLoaded: this.props.autoLoadTwoHopLinks,
        resetCounter: prevState.resetCounter + 1,
      }));
      if (this.state.searchInput.trim().length > 0) {
        this.scheduleSearch(this.state.searchInput);
      }
    }
    for (const ref of Object.values(this.loadMoreRefs)) {
      if (ref.current) {
        setIcon(ref.current, "more-horizontal");
      }
    }
  }

  componentWillUnmount() {
    this.isUnmounted = true;
    this.searchGeneration++;
    if (this.searchDebounceTimer != null) {
      window.clearTimeout(this.searchDebounceTimer);
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
        <button
          className="load-more-button"
          onClick={() => this.setState({ isLoaded: true })}
        >
          Show 2hop links
        </button>
      );
    }

    return (
      <div>
        <div className="twohop-links-toolbar">
          <button
            className="settings-button"
            onClick={() => {
              this.props.app.setting.open();
              this.props.app.setting.openTabById("2hop-links-plus");
            }}
          >
            Open Settings
          </button>
          <input
            className="twohop-links-search-input"
            type="search"
            value={this.state.searchInput}
            placeholder="Search related cards"
            onChange={(event) =>
              this.handleSearchChange(event.currentTarget.value)
            }
          />
          {this.state.isPreparingBodySearch && (
            <span className="twohop-links-search-status">
              Searching body...
            </span>
          )}
        </div>
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
            displayedSectionCount={this.state.displayedSectionCount.twoHopLinks}
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
    );
  }
}
