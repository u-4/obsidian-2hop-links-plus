import { MarkdownView, TFile } from "obsidian";
import React from "react";
import ReactDOM from "react-dom";
import type TwohopLinksPlugin from "./main";
import LinkView from "./ui/LinkView";

const SHOW_DELAY_MS = 150;
const HIDE_DELAY_MS = 2500;
const MARGIN = 8;
const GAP = 6;
const STRIP_HEIGHT = 150;
const MIN_STRIP_HEIGHT = 100;

/**
 * Cosense-style row of cards above the note title: pointing at the title
 * shows the notes that link to this note, and the row goes away a few seconds
 * after the pointer leaves the title and the row.
 */
export class TitleStrip {
  private el: HTMLElement | null = null;
  private title: HTMLElement | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly plugin: TwohopLinksPlugin) {}

  readonly onMouseOver = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (this.el?.contains(target)) {
      this.cancelHide();
      return;
    }
    const title = target.closest<HTMLElement>(".inline-title");
    if (!title || title.closest(".hover-popover, .hover-editor, .popover")) {
      return;
    }
    this.cancelHide();
    if (this.title === title && this.el) return;
    this.cancelShow();
    this.showTimer = setTimeout(() => {
      this.showTimer = null;
      this.show(title);
    }, SHOW_DELAY_MS);
  };

  readonly onMouseOut = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const from =
      target.closest(".inline-title") ??
      (this.el?.contains(target) ? this.el : null);
    if (!from) return;
    const to = event.relatedTarget;
    if (
      to instanceof Node &&
      (this.el?.contains(to) || this.title?.contains(to))
    ) {
      return;
    }
    this.cancelShow();
    if (this.el) this.scheduleHide();
  };

  hide(): void {
    this.cancelShow();
    this.cancelHide();
    if (this.el) {
      ReactDOM.unmountComponentAtNode(this.el);
      this.el.remove();
    }
    this.el = null;
    this.title = null;
  }

  private show(title: HTMLElement): void {
    if (!title.isConnected) return;
    const file = this.fileOf(title);
    if (!file) return;
    const entities = this.plugin.links.getBacklinkEntities(file);
    this.hide();
    if (entities.length === 0) return;

    const doc = title.ownerDocument;
    const el = doc.createElement("div");
    el.className = "twohop-title-strip";
    doc.body.append(el);
    this.el = el;
    this.title = title;

    // Above the title like Cosense; below it when there is no room above.
    const win = doc.defaultView;
    const rect = title.getBoundingClientRect();
    const viewRect = (
      title.closest(".view-content") ?? title
    ).getBoundingClientRect();
    const width = Math.max(
      200,
      Math.min(
        viewRect.right - rect.left - MARGIN,
        (win?.innerWidth ?? 1024) - rect.left - MARGIN
      )
    );
    // It may cover the view header above the title, as in Cosense, with
    // shorter cards when that space is small.
    const roomAbove = rect.top - GAP - MARGIN;
    const height =
      roomAbove >= MIN_STRIP_HEIGHT
        ? Math.min(STRIP_HEIGHT, roomAbove)
        : STRIP_HEIGHT;
    const top =
      roomAbove >= MIN_STRIP_HEIGHT
        ? rect.top - GAP - height
        : rect.bottom + GAP;
    Object.assign(el.style, {
      left: `${rect.left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });

    ReactDOM.render(
      <>
        {entities.map((entity) => (
          <LinkView
            key={entity.key()}
            fileEntity={entity}
            onClick={async (fileEntity, newLeaf) => {
              this.hide();
              this.plugin.popover.close();
              await this.plugin.openFileEntity(fileEntity, newLeaf);
            }}
            getPreview={this.plugin.getCardPreview}
            getTitle={this.plugin.getCardTitle}
            app={this.plugin.app}
          />
        ))}
      </>,
      el
    );
  }

  private fileOf(title: HTMLElement): TFile | null {
    let file: TFile | null = null;
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (
        !file &&
        leaf.view instanceof MarkdownView &&
        leaf.view.containerEl.contains(title)
      ) {
        file = leaf.view.file;
      }
    });
    return file;
  }

  private scheduleHide(): void {
    this.cancelHide();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      // Keep the row while a popup opened from one of its cards is showing.
      if (this.plugin.popover.isOpen()) {
        this.scheduleHide();
        return;
      }
      this.hide();
    }, HIDE_DELAY_MS);
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private cancelShow(): void {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
  }
}
