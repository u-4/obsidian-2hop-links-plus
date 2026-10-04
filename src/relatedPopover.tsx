// Light popups for related cards: Cmd+hover on a card opens the note's related
// cards above a read-only preview. Cmd+hover on a card or link inside a popup
// opens the next popup, so notes can be followed; clicking inside hands over to
// Hover Editor (or Obsidian's page preview) through the hover-link event.
// Adapted from CardPopover in palmwiki-home/main.js (1.7.1, commit c0db2d0).
import { Keymap, Scope, TFile } from "obsidian";
import React from "react";
import ReactDOM from "react-dom";
import type TwohopLinksPlugin from "./main";
import { FileEntity } from "./model/FileEntity";
import { NotePreview } from "./notePreview";
import LinkView from "./ui/LinkView";

export const HOVER_EDIT_SOURCE = "2hop-links-edit";
const MARGIN = 8;
const POPOVER_WIDTH = 560;
const POPOVER_HEIGHT = 600;
const MIN_HEIGHT = 240;
const OPEN_DELAY_MS = 60;
const SWITCH_DELAY_MS = 150;
const CLOSE_DELAY_MS = 300;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Placement {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(min, value), Math.max(min, max));

/**
 * Where a popup goes, by the free space around its anchor. A card's popup goes
 * beside the card, growing downward from a card in the upper half of the
 * window and upward from one in the lower half. A link's popup goes below the
 * link when there is room, otherwise above, and shrinks to the larger space.
 */
export function placePopover(
  anchor: Rect,
  viewport: { width: number; height: number },
  beside: boolean
): Placement {
  const width = Math.min(POPOVER_WIDTH, viewport.width - 2 * MARGIN);
  const maxHeight = Math.min(POPOVER_HEIGHT, viewport.height - 2 * MARGIN);
  if (beside) {
    const spaceRight = viewport.width - MARGIN - (anchor.right + MARGIN);
    const spaceLeft = anchor.left - MARGIN - MARGIN;
    let left: number;
    if (spaceRight >= width) left = anchor.right + MARGIN;
    else if (spaceLeft >= width) left = anchor.left - MARGIN - width;
    else if (spaceRight >= spaceLeft) left = viewport.width - MARGIN - width;
    else left = MARGIN;
    const height = maxHeight;
    const isUpperHalf = (anchor.top + anchor.bottom) / 2 < viewport.height / 2;
    const top = isUpperHalf ? anchor.top : anchor.bottom - height;
    return {
      left: clamp(left, MARGIN, viewport.width - MARGIN - width),
      top: clamp(top, MARGIN, viewport.height - MARGIN - height),
      width,
      height,
    };
  }

  const spaceBelow = viewport.height - MARGIN - (anchor.bottom + 4);
  const spaceAbove = anchor.top - 4 - MARGIN;
  let top: number;
  let height: number;
  if (spaceBelow >= maxHeight) {
    top = anchor.bottom + 4;
    height = maxHeight;
  } else if (spaceAbove >= maxHeight) {
    height = maxHeight;
    top = anchor.top - 4 - height;
  } else if (spaceBelow >= spaceAbove) {
    height = Math.max(Math.min(maxHeight, MIN_HEIGHT), spaceBelow);
    top = anchor.bottom + 4;
  } else {
    height = Math.max(Math.min(maxHeight, MIN_HEIGHT), spaceAbove);
    top = anchor.top - 4 - height;
  }
  return {
    left: clamp(anchor.left, MARGIN, viewport.width - MARGIN - width),
    top: clamp(top, MARGIN, viewport.height - MARGIN - height),
    width,
    height,
  };
}

interface PopoverEntry {
  el: HTMLElement;
  cardsEl: HTMLElement;
  preview: NotePreview;
  file: TFile;
  anchor: HTMLElement;
}

interface HoverTarget {
  anchor: HTMLElement;
  file: TFile;
}

export class RelatedPopover {
  private stack: PopoverEntry[] = [];
  private hovered: HoverTarget | null = null;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private keyDoc: Document | null = null;
  private readonly scope: Scope;
  private isScoped = false;

  constructor(private readonly plugin: TwohopLinksPlugin) {
    // Obsidian takes Escape before page listeners, so popups hold a key scope.
    this.scope = new Scope(plugin.app.scope);
    this.scope.register([], "Escape", () => {
      this.close();
      return false;
    });
  }

  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key !== "Meta" && event.key !== "Control") return;
    const target = this.hovered;
    if (target && this.levelToOpen(target.anchor) !== null) {
      this.schedule(() => this.openFor(target), OPEN_DELAY_MS);
    }
  };

  /** A card or link under the pointer. Cmd opens its popup. */
  enter(anchor: HTMLElement, file: TFile, event: MouseEvent): void {
    this.hovered = { anchor, file };
    this.cancelClose();
    this.listen(anchor.ownerDocument);
    const level = this.levelToOpen(anchor);
    if (level === null || this.stack[level]?.anchor === anchor) return;
    if (Keymap.isModifier(event, "Mod")) {
      this.schedule(() => this.openFor({ anchor, file }), OPEN_DELAY_MS);
    } else if (level === 0 && this.stack.length > 0) {
      // While a popup is open, pointing at another card switches to it,
      // a little slower so crossing a card on the way does not.
      this.schedule(() => this.openFor({ anchor, file }), SWITCH_DELAY_MS);
    }
  }

  leave(anchor: HTMLElement): void {
    if (this.hovered?.anchor === anchor) this.hovered = null;
    this.cancelOpen();
    // Inside a popup the pointer is still over it; the popup's own mouseleave
    // closes the stack when the pointer really goes away.
    if (anchor.closest(".twohop-popover")) return;
    if (this.stack.length > 0) this.scheduleClose();
  }

  close(): void {
    this.cancelClose();
    this.cancelOpen();
    this.closeFrom(0);
    if (this.isScoped) {
      this.plugin.app.keymap.popScope(this.scope);
      this.isScoped = false;
    }
  }

  dispose(): void {
    this.close();
    this.hovered = null;
    this.keyDoc?.removeEventListener("keydown", this.onKey, true);
    this.keyDoc = null;
  }

  /** The stack level a popup for this anchor opens at, or null. */
  private levelToOpen(anchor: HTMLElement): number | null {
    for (let level = this.stack.length - 1; level >= 0; level--) {
      if (this.stack[level].el.contains(anchor)) return level + 1;
    }
    return anchor.closest(".twohop-popover") ? null : 0;
  }

  private openFor(target: HoverTarget): void {
    if (!target.anchor.isConnected) return;
    const level = this.levelToOpen(target.anchor);
    if (level === null) return;
    this.open(level, target.anchor, target.file);
  }

  private open(level: number, anchor: HTMLElement, file: TFile): void {
    this.closeFrom(level);
    const doc = anchor.ownerDocument;
    this.listen(doc);
    const el = doc.createElement("div");
    el.className = "twohop-popover";
    const cardsEl = doc.createElement("div");
    cardsEl.className = "twohop-popover-cards";
    const previewEl = doc.createElement("div");
    previewEl.className = "twohop-popover-preview markdown-rendered";
    el.append(cardsEl, previewEl);
    const preview = new NotePreview(
      this.plugin.app,
      previewEl,
      (linkText, sourcePath, event) => {
        this.close();
        void this.plugin.app.workspace.openLinkText(
          linkText,
          sourcePath,
          Keymap.isModEvent(event)
        );
      }
    );
    const entry: PopoverEntry = { el, cardsEl, preview, file, anchor };

    el.addEventListener("mouseenter", () => this.cancelClose());
    el.addEventListener("mouseleave", () => this.scheduleClose());
    // Links in the preview open the next popup here; stop Obsidian's own page
    // preview (Hover Editor) from opening on Cmd as well.
    previewEl.addEventListener(
      "mouseover",
      (event) => {
        const link = (event.target as HTMLElement | null)?.closest?.(
          "a.internal-link"
        ) as HTMLAnchorElement | null;
        if (!link) return;
        event.stopPropagation();
        const target = this.linkTarget(link, file);
        if (target) this.enter(link, target, event);
      },
      true
    );
    previewEl.addEventListener("mouseout", (event) => {
      const link = (event.target as HTMLElement | null)?.closest?.(
        "a.internal-link"
      );
      if (link instanceof HTMLElement) this.leave(link);
    });
    previewEl.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      if ((event.target as HTMLElement | null)?.closest?.("a")) return;
      if (doc.defaultView?.getSelection()?.toString()) return;
      this.edit(entry);
    });

    if (!this.isScoped) {
      this.plugin.app.keymap.pushScope(this.scope);
      this.isScoped = true;
    }
    this.stack.push(entry);
    doc.body.append(el);
    const win = doc.defaultView;
    const placement = placePopover(
      anchor.getBoundingClientRect(),
      { width: win?.innerWidth ?? 1024, height: win?.innerHeight ?? 768 },
      level === 0 || anchor.classList.contains("twohop-links-card")
    );
    Object.assign(el.style, {
      left: `${placement.left}px`,
      top: `${placement.top}px`,
      width: `${placement.width}px`,
      height: `${placement.height}px`,
    });
    this.renderCards(entry);
    void preview.show(file);
  }

  private renderCards(entry: PopoverEntry): void {
    const activePath = this.plugin.app.workspace.getActiveFile()?.path ?? "";
    const entities = this.plugin.links.getHoverLinks(entry.file, activePath);
    if (entities.length === 0) {
      entry.cardsEl.hidden = true;
      return;
    }
    ReactDOM.render(
      <>
        {entities.map((entity: FileEntity) => (
          <LinkView
            key={entity.key()}
            fileEntity={entity}
            onClick={async (fileEntity, newLeaf) => {
              this.close();
              await this.plugin.openFileEntity(fileEntity, newLeaf);
            }}
            getPreview={this.plugin.getCardPreview}
            getTitle={this.plugin.getCardTitle}
            app={this.plugin.app}
          />
        ))}
      </>,
      entry.cardsEl
    );
  }

  private linkTarget(link: HTMLAnchorElement, from: TFile): TFile | null {
    const href = link.dataset.href || link.getAttribute("href") || "";
    const path = href.split("#")[0].split("|")[0];
    const file = path
      ? this.plugin.app.metadataCache.getFirstLinkpathDest(path, from.path)
      : null;
    return file instanceof TFile && file.extension === "md" ? file : null;
  }

  /**
   * Hands the note to the page preview (Hover Editor) at the popup's place.
   * The anchor is the first popup's card, which stays in the document after
   * the popups close. The event carries Cmd so the hand-over also works when
   * the page preview setting requires Cmd for this source, and its position
   * is 20 px above the popup because Hover Editor opens 20 px below it.
   */
  private edit(entry: PopoverEntry): void {
    const rect = entry.el.getBoundingClientRect();
    const root = this.stack[0];
    this.close();
    if (!root?.anchor.isConnected) return;
    const win = root.anchor.ownerDocument.defaultView ?? window;
    const event = new win.MouseEvent("mouseover", {
      clientX: rect.left,
      clientY: rect.top - 20,
      metaKey: true,
      ctrlKey: true,
      bubbles: true,
    });
    this.plugin.app.workspace.trigger("hover-link", {
      event,
      source: HOVER_EDIT_SOURCE,
      hoverParent: { hoverPopover: null },
      targetEl: root.anchor,
      linktext: entry.file.path,
      sourcePath: "",
    });
  }

  private listen(doc: Document): void {
    if (this.keyDoc === doc) return;
    this.keyDoc?.removeEventListener("keydown", this.onKey, true);
    this.keyDoc = doc;
    doc.addEventListener("keydown", this.onKey, true);
  }

  private schedule(fn: () => void, delay: number): void {
    this.cancelOpen();
    this.openTimer = setTimeout(() => {
      this.openTimer = null;
      fn();
    }, delay);
  }

  private cancelOpen(): void {
    if (this.openTimer !== null) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
  }

  private scheduleClose(): void {
    this.cancelClose();
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      this.close();
    }, CLOSE_DELAY_MS);
  }

  private cancelClose(): void {
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  private closeFrom(level: number): void {
    while (this.stack.length > level) {
      const entry = this.stack.pop() as PopoverEntry;
      ReactDOM.unmountComponentAtNode(entry.cardsEl);
      entry.preview.dispose();
      entry.el.remove();
    }
  }
}
