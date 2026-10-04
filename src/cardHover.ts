import type { FileEntity } from "./model/FileEntity";

/** Receives pointer movement over related cards (set by the plugin). */
export interface CardHoverHandler {
  enter(cardEl: HTMLElement, fileEntity: FileEntity, event: MouseEvent): void;
  leave(cardEl: HTMLElement): void;
}

let handler: CardHoverHandler | null = null;

export function setCardHoverHandler(next: CardHoverHandler | null): void {
  handler = next;
}

export function getCardHoverHandler(): CardHoverHandler | null {
  return handler;
}
