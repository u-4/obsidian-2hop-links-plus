import React from "react";
import { FileEntity } from "../model/FileEntity";
import { removeBlockReference } from "../utils";
import { App, Menu, HoverParent, HoverPopover } from "obsidian";
import { HOVER_LINK_ID } from "../main";
import { OpenPaneTarget } from "../types";

interface LinkViewProps {
  fileEntity: FileEntity;
  onClick: (fileEntity: FileEntity, newLeaf?: OpenPaneTarget) => Promise<void>;
  getPreview: (fileEntity: FileEntity, signal: AbortSignal) => Promise<string>;
  getTitle: (fileEntity: FileEntity, signal: AbortSignal) => Promise<string>;
  app: App;
}

interface LinkViewState {
  preview: string | null;
  title: string | null;
  mouseDown: boolean;
  dragging: boolean;
  touchStart: number;
}

export default class LinkView
  extends React.Component<LinkViewProps, LinkViewState>
  implements HoverParent
{
  private abortController: AbortController | null = null;
  hoverPopover: HoverPopover | null;
  isMobile: boolean;

  constructor(props: LinkViewProps) {
    super(props);
    this.state = {
      preview: null,
      title: null,
      mouseDown: false,
      dragging: false,
      touchStart: 0,
    };
    this.isMobile = window.matchMedia("(pointer: coarse)").matches;
  }

  async componentDidMount(): Promise<void> {
    await this.loadPreviewAndTitle();
  }

  async componentDidUpdate(prevProps: LinkViewProps): Promise<void> {
    if (this.fileEntityKey(prevProps.fileEntity) !== this.fileEntityKey()) {
      await this.loadPreviewAndTitle();
    }
  }

  componentWillUnmount(): void {
    this.abortController?.abort();
  }

  private fileEntityKey(fileEntity = this.props.fileEntity): string {
    return `${fileEntity.targetPath ?? ""}\n${fileEntity.linkText}\n${
      fileEntity.sourcePath
    }`;
  }

  private async loadPreviewAndTitle(): Promise<void> {
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    const fileEntityKey = this.fileEntityKey();
    this.setState({ preview: null, title: null });
    const preview = await this.props.getPreview(
      this.props.fileEntity,
      abortController.signal
    );
    const title = await this.props.getTitle(
      this.props.fileEntity,
      abortController.signal
    );
    if (
      !abortController.signal.aborted &&
      fileEntityKey === this.fileEntityKey()
    ) {
      this.setState({
        preview: preview,
        title: title,
      });
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

  onMouseOver = (e: React.MouseEvent): void => {
    const targetEl = e.currentTarget as HTMLElement;

    if (targetEl.tagName !== "DIV") return;

    this.props.app.workspace.trigger("hover-link", {
      event: e.nativeEvent,
      source: HOVER_LINK_ID,
      hoverParent: this,
      targetEl,
      linktext: this.hoverLinkText(),
      sourcePath: this.props.fileEntity.sourcePath,
    });
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
        className={"twohop-links-box"}
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
        onMouseOver={this.onMouseOver}
        draggable="true"
        onDragStart={(event) => {
          event.dataTransfer.setData(
            "text/plain",
            `[[${this.draggedWikiLinkText()}]]`
          );
        }}
      >
        <div className="twohop-links-box-title">{this.state.title}</div>
        <div className={"twohop-links-box-preview"}>
          {this.state.preview &&
          this.state.preview.match(/^(app|https?):\/\//) ? (
            <img src={this.state.preview} alt={"preview image"} />
          ) : (
            <div>{this.state.preview}</div>
          )}
        </div>
      </div>
    );
  }
}
