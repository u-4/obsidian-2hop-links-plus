import React, { createRef } from "react";
import { FileEntity } from "../model/FileEntity";
import LinkView from "./LinkView";
import { TwohopLink } from "../model/TwohopLink";
import { App, setIcon } from "obsidian";
import { OpenPaneTarget } from "../types";

interface TwohopLinksViewProps {
  twoHopLinks: TwohopLink[];
  onClick: (fileEntity: FileEntity, newLeaf?: OpenPaneTarget) => Promise<void>;
  getPreview: (fileEntity: FileEntity) => Promise<string>;
  getTitle: (fileEntity: FileEntity) => Promise<string>;
  app: App;
  displayedSectionCount: number;
  initialDisplayedEntitiesCount: number;
  resetCounter: number;
}

interface LinkComponentProps {
  link: TwohopLink;
  onClick: (fileEntity: FileEntity, newLeaf?: OpenPaneTarget) => Promise<void>;
  getPreview: (fileEntity: FileEntity) => Promise<string>;
  getTitle: (fileEntity: FileEntity) => Promise<string>;
  app: App;
  initialDisplayedEntitiesCount: number;
  resetCounter: number;
}

interface LinkComponentState {
  displayedEntitiesCount: number;
  title: string;
}

class LinkComponent extends React.Component<
  LinkComponentProps,
  LinkComponentState
> {
  loadMoreRef = createRef<HTMLDivElement>();
  private titleGeneration = 0;

  constructor(props: LinkComponentProps) {
    super(props);
    this.state = {
      displayedEntitiesCount: props.initialDisplayedEntitiesCount,
      title: "",
    };
  }

  async componentDidMount() {
    if (this.loadMoreRef.current) {
      setIcon(this.loadMoreRef.current, "more-horizontal");
    }

    await this.updateTitle();
  }

  async componentDidUpdate(prevProps: LinkComponentProps) {
    if (this.props.resetCounter !== prevProps.resetCounter) {
      this.setState({
        displayedEntitiesCount: this.props.initialDisplayedEntitiesCount,
      });
    }

    if (this.sectionKey(this.props.link) !== this.sectionKey(prevProps.link)) {
      this.setState({
        displayedEntitiesCount: this.props.initialDisplayedEntitiesCount,
      });
      await this.updateTitle();
    }

    if (this.loadMoreRef.current) {
      setIcon(this.loadMoreRef.current, "more-horizontal");
    }
  }

  private sectionKey(link: TwohopLink): string {
    return link.link.targetPath ?? link.link.linkText;
  }

  private async updateTitle(): Promise<void> {
    const expectedKey = this.sectionKey(this.props.link);
    const generation = ++this.titleGeneration;
    const title = await this.props.getTitle(this.props.link.link);

    if (
      generation === this.titleGeneration &&
      expectedKey === this.sectionKey(this.props.link)
    ) {
      this.setState({ title });
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
      <div
        className={"twohop-links-section " + "twohop-links-resolved"}
        key={this.props.link.link.linkText}
      >
        <div
          className="twohop-links-twohop-header twohop-links-section-header twohop-links-box"
          onClick={async () => this.props.onClick(this.props.link.link)}
          onMouseDown={async (event) =>
            event.button == 0 && this.props.onClick(this.props.link.link)
          }
        >
          {this.state.title}
        </div>
        {this.props.link.fileEntities
          .slice(0, this.state.displayedEntitiesCount)
          .map((it) => (
            <LinkView
              fileEntity={it}
              key={this.sectionKey(this.props.link) + it.key()}
              onClick={this.props.onClick}
              getPreview={this.props.getPreview}
              getTitle={this.props.getTitle}
              app={this.props.app}
            />
          ))}
        {this.props.link.fileEntities.length >
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

// eslint-disable-next-line @typescript-eslint/naming-convention
const MemoizedLinkComponent = React.memo(LinkComponent);

class TwohopLinksView extends React.Component<TwohopLinksViewProps> {
  private sectionKey(link: TwohopLink): string {
    return link.link.targetPath ?? link.link.linkText;
  }

  render(): JSX.Element {
    return (
      <div>
        {this.props.twoHopLinks
          .slice(0, this.props.displayedSectionCount)
          .map((link) => (
            <MemoizedLinkComponent
              key={this.sectionKey(link)}
              link={link}
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

export default React.memo(TwohopLinksView);
