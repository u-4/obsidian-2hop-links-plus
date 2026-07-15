import React, { createRef } from "react";
import { FileEntity } from "../model/FileEntity";
import LinkView from "./LinkView";
import { PropertiesLinks } from "../model/PropertiesLinks";
import { App, setIcon } from "obsidian";
import { OpenPaneTarget } from "../types";

interface PropertiesLinksListViewProps {
  propertiesLinksList: PropertiesLinks[];
  onClick: (fileEntity: FileEntity, newLeaf?: OpenPaneTarget) => Promise<void>;
  getPreview: (fileEntity: FileEntity) => Promise<string>;
  getTitle: (fileEntity: FileEntity) => Promise<string>;
  app: App;
  displayedSectionCount: number;
  initialDisplayedEntitiesCount: number;
  resetCounter: number;
}

interface LinkComponentProps {
  tagLink: PropertiesLinks;
  onClick: (fileEntity: FileEntity, newLeaf?: OpenPaneTarget) => Promise<void>;
  getPreview: (fileEntity: FileEntity) => Promise<string>;
  getTitle: (fileEntity: FileEntity) => Promise<string>;
  app: App;
  initialDisplayedEntitiesCount: number;
  resetCounter: number;
}

interface LinkComponentState {
  displayedEntitiesCount: number;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const LinkComponent = React.memo(
  class extends React.Component<LinkComponentProps, LinkComponentState> {
    loadMoreRef = createRef<HTMLDivElement>();

    constructor(props: LinkComponentProps) {
      super(props);
      this.state = {
        displayedEntitiesCount: props.initialDisplayedEntitiesCount,
      };
    }

    componentDidMount() {
      if (this.loadMoreRef.current) {
        setIcon(this.loadMoreRef.current, "more-horizontal");
      }
    }

    componentDidUpdate(prevProps: LinkComponentProps) {
      if (this.props.resetCounter !== prevProps.resetCounter) {
        this.setState({
          displayedEntitiesCount: this.props.initialDisplayedEntitiesCount,
        });
      }

      if (this.loadMoreRef.current) {
        setIcon(this.loadMoreRef.current, "more-horizontal");
      }
    }

    loadMoreEntities = () => {
      this.setState((prevState) => ({
        displayedEntitiesCount:
          prevState.displayedEntitiesCount +
          this.props.initialDisplayedEntitiesCount,
      }));
    };

    render(): JSX.Element {
      return (
        <div className="twohop-links-section" key={this.props.tagLink.property}>
          <div
            className={`${
              this.props.tagLink.key
                ? `twohop-links-${this.props.tagLink.key}-header`
                : ""
            } twohop-links-properties-header twohop-links-section-header twohop-links-box`}
          >
            {this.props.tagLink.key
              ? `${this.props.tagLink.key}: ${this.props.tagLink.property}`
              : this.props.tagLink.property}
          </div>
          {this.props.tagLink.fileEntities
            .slice(0, this.state.displayedEntitiesCount)
            .map((it, index) => (
              <LinkView
                fileEntity={it}
                key={this.props.tagLink.property + it.key() + index}
                onClick={this.props.onClick}
                getPreview={this.props.getPreview}
                getTitle={this.props.getTitle}
                app={this.props.app}
              />
            ))}
          {this.props.tagLink.fileEntities.length >
            this.state.displayedEntitiesCount && (
            <div
              ref={this.loadMoreRef}
              onClick={this.loadMoreEntities}
              className="load-more-button twohop-links-box twohop-links-load-more"
            ></div>
          )}
        </div>
      );
    }
  }
);

// eslint-disable-next-line @typescript-eslint/naming-convention
const PropertiesLinksListView = React.memo(
  class extends React.Component<PropertiesLinksListViewProps> {
    private sectionKey(tagLink: PropertiesLinks): string {
      const fileEntityKeys = tagLink.fileEntities
        .map((fileEntity) => fileEntity.key())
        .join("|");
      return `${tagLink.key ?? ""}:${tagLink.property}:${fileEntityKeys}`;
    }

    render(): JSX.Element {
      return (
        <div>
          {this.props.propertiesLinksList
            .slice(0, this.props.displayedSectionCount)
            .map((tagLink) => (
              <LinkComponent
                key={this.sectionKey(tagLink)}
                tagLink={tagLink}
                onClick={this.props.onClick}
                getPreview={this.props.getPreview}
                getTitle={this.props.getTitle}
                app={this.props.app}
                initialDisplayedEntitiesCount={
                  this.props.initialDisplayedEntitiesCount
                }
                resetCounter={this.props.resetCounter}
              />
            ))}
        </div>
      );
    }
  }
);

export default PropertiesLinksListView;
