import React from "react";
import { FileEntity } from "../model/FileEntity";
import { removeBlockReference } from "../utils";
import { App, Menu } from "obsidian";
import { getCardHoverHandler } from "../cardHover";
import { GetCardPreview, OpenPaneTarget } from "../types";
import type { CardPreview } from "../cardPreview";

interface LinkViewProps {
  fileEntity: FileEntity;
  onClick: (fileEntity: FileEntity, newLeaf?: OpenPaneTarget) => Promise<void>;
  getPreview: GetCardPreview;
  getTitle: (fileEntity: FileEntity, signal: AbortSignal) => Promise<string>;
  app: App;
}

// Start reading a card's excerpt a little before it scrolls into view.
const PREVIEW_ROOT_MARGIN = "200px";

interface LinkViewState {
  preview: CardPreview | null;
  isImageBroken: boolean;
  title: string | null;
  mouseDown: boolean;
  dragging: boolean;
  touchStart: number;
}

export default class LinkView extends React.Component<
  LinkViewProps,
  LinkViewState
> {
  private abortController: AbortController | null = null;
  private readonly cardRef = React.createRef<HTMLDivElement>();
  private observer: IntersectionObserver | null = null;
  private isNearViewport = false;
  isMobile: boolean;

  constructor(props: LinkViewProps) {
    super(props);
    this.state = {
      preview: null,
      isImageBroken: false,
      title: null,
      mouseDown: false,
      dragging: false,
      touchStart: 0,
    };
    this.isMobile = window.matchMedia("(pointer: coarse)").matches;
  }

  componentDidMount(): void {
    this.observeViewport();
    void this.loadCard();
  }

  componentDidUpdate(prevProps: LinkViewProps): void {
    if (this.fileEntityKey(prevProps.fileEntity) !== this.fileEntityKey()) {
      this.setState({ preview: null, isImageBroken: false, title: null });
      void this.loadCard();
    }
  }

  componentWillUnmount(): void {
    this.abortController?.abort();
    this.observer?.disconnect();
  }

  private observeViewport(): void {
    const element = this.cardRef.current;
    const ownerWindow = element?.ownerDocument.defaultView;
    if (!element || !ownerWindow || !("IntersectionObserver" in ownerWindow)) {
      this.isNearViewport = true;
      return;
    }
    this.observer = new ownerWindow.IntersectionObserver(
      (entries) => {
        const isNear = entries.some((entry) => entry.isIntersecting);
        if (isNear === this.isNearViewport) return;
        this.isNearViewport = isNear;
        if (isNear && this.state.preview === null) {
          void this.loadPreview();
        }
      },
      { rootMargin: PREVIEW_ROOT_MARGIN }
    );
    this.observer.observe(element);
  }

  private fileEntityKey(fileEntity = this.props.fileEntity): string {
    return `${fileEntity.targetPath ?? ""}\n${fileEntity.linkText}\n${
      fileEntity.sourcePath
    }`;
  }

  private async loadCard(): Promise<void> {
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    const fileEntityKey = this.fileEntityKey();
    const title = await this.props.getTitle(
      this.props.fileEntity,
      abortController.signal
    );
    if (
      !abortController.signal.aborted &&
      fileEntityKey === this.fileEntityKey()
    ) {
      this.setState({ title });
    }
    if (this.isNearViewport) {
      await this.loadPreview();
    }
  }

  private async loadPreview(): Promise<void> {
    const abortController = this.abortController;
    if (!abortController || abortController.signal.aborted) return;
    const fileEntityKey = this.fileEntityKey();
    const preview = await this.props.getPreview(
      this.props.fileEntity,
      () => !abortController.signal.aborted && this.isNearViewport
    );
    if (
      preview &&
      !abortController.signal.aborted &&
      fileEntityKey === this.fileEntityKey()
    ) {
      this.setState({ preview, isImageBroken: false });
    }
  }

  async openFileWithOptions(options?: OpenPaneTarget): Promise<void> {
    await this.props.onClick(this.props.fileEntity, options);
  }

  private hoverLinkText(): string {
    return removeBlockReference(
      this.props.fileEntity.targetPath ?? this.props.fileEntity.linkText
    );
  }

  private draggedWikiLinkText(): string {
    return this.hoverLinkText().replace(/\.md$/i, "");
  }

  handleContextMenu = (event: React.MouseEvent | React.TouchEvent): void => {
    if ("button" in event && event.button !== 2) return;
    event.preventDefault();

    const clientX =
      "changedTouches" in event
        ? event.changedTouches[0].clientX
        : event.clientX;
    const clientY =
      "changedTouches" in event
        ? event.changedTouches[0].clientY
        : event.clientY;

    const menu = new Menu();

    menu.addItem((item) =>
      item.setTitle("Open link").onClick(async () => {
        await this.openFileWithOptions();
      })
    );

    menu.addItem((item) =>
      item.setTitle("Open in new tab").onClick(async () => {
        await this.openFileWithOptions("tab");
      })
    );

    menu.addItem((item) =>
      item.setTitle("Open to the right").onClick(async () => {
        await this.openFileWithOptions("split");
      })
    );

    menu.addItem((item) =>
      item.setTitle("Open in new window").onClick(async () => {
        await this.openFileWithOptions("window");
      })
    );

    menu.showAtPosition({ x: clientX, y: clientY });
  };

  // Cmd+hover opens the related-cards popup instead of Obsidian's page preview.
  onMouseEnter = (e: React.MouseEvent): void => {
    getCardHoverHandler()?.enter(
      e.currentTarget as HTMLElement,
      this.props.fileEntity,
      e.nativeEvent
    );
  };

  onMouseLeave = (e: React.MouseEvent): void => {
    getCardHoverHandler()?.leave(e.currentTarget as HTMLElement);
  };

  onMouseUpOrTouchEnd = async (
    event: React.MouseEvent | React.TouchEvent
  ): Promise<void> => {
    const longPress = Date.now() - this.state.touchStart >= 500;
    if (longPress && !this.state.dragging) {
      this.handleContextMenu(event);
    } else if (!this.state.dragging) {
      await this.props.onClick(this.props.fileEntity);
    }
    this.setState({ touchStart: 0, dragging: false });
  };

  render(): JSX.Element {
    return (
      <div
        ref={this.cardRef}
        className="twohop-links-box twohop-links-card"
        onTouchStart={() => {
          this.setState({ touchStart: Date.now() });
        }}
        onTouchMove={() => {
          if (Date.now() - this.state.touchStart < 200) {
            this.setState({ dragging: true });
          }
        }}
        onTouchEnd={this.onMouseUpOrTouchEnd}
        onTouchCancel={() => {
          this.setState({ touchStart: 0, dragging: false });
        }}
        onMouseDown={(event) => {
          if (this.isMobile) return;
          if (event.button === 0) {
            this.setState({ mouseDown: true });
          }
        }}
        onMouseUp={(event) => {
          if (this.isMobile) return;
          if (event.button === 1) {
            this.openFileWithOptions("tab");
          } else if (event.button === 0 && !this.state.dragging) {
            this.props.onClick(this.props.fileEntity);
          }
          this.setState({ mouseDown: false, dragging: false });
        }}
        onContextMenu={this.handleContextMenu}
        onMouseEnter={this.onMouseEnter}
        onMouseLeave={this.onMouseLeave}
        draggable="true"
        onDragStart={(event) => {
          event.dataTransfer.setData(
            "text/plain",
            `[[${this.draggedWikiLinkText()}]]`
          );
        }}
      >
        <div className="twohop-links-box-title">{this.state.title}</div>
        {this.state.preview?.imageUrl && !this.state.isImageBroken && (
          <div className="twohop-links-box-media">
            <img
              src={this.state.preview.imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => this.setState({ isImageBroken: true })}
            />
          </div>
        )}
        <div className="twohop-links-box-preview">
          {this.state.preview?.text}
        </div>
      </div>
    );
  }
}
