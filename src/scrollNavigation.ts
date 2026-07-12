import type { MarkdownView } from "obsidian";

const RESULTS_CONTAINER_CLASS = "twohop-links-container";
const ACTION_CLASS = "twohop-links-scroll-toggle";
const SCROLL_TOP_THRESHOLD_PX = 8;

export interface VerticalBounds {
  top: number;
  bottom: number;
  height: number;
}

interface ManagedScrollAction {
  view: MarkdownView;
  element: HTMLElement;
  frameId: number | null;
  settleTimeoutIds: number[];
  onScroll: EventListener;
  onUserScrollIntent: EventListener;
}

export type ScrollDestination = "links" | "top";

export function getScrollDestination(
  scrollTop: number,
  resultsBounds: VerticalBounds,
  viewportBounds: VerticalBounds
): ScrollDestination {
  if (scrollTop <= SCROLL_TOP_THRESHOLD_PX) {
    return "links";
  }

  const activationOffset = Math.min(
    120,
    Math.max(32, viewportBounds.height * 0.25)
  );
  const resultsHaveReachedTop =
    resultsBounds.top <= viewportBounds.top + activationOffset;
  const resultsRemainInView =
    resultsBounds.bottom > viewportBounds.top + SCROLL_TOP_THRESHOLD_PX;
  const resultsFitInViewport =
    resultsBounds.top >= viewportBounds.top - SCROLL_TOP_THRESHOLD_PX &&
    resultsBounds.bottom <= viewportBounds.bottom + SCROLL_TOP_THRESHOLD_PX;

  return (resultsHaveReachedTop || resultsFitInViewport) && resultsRemainInView
    ? "top"
    : "links";
}

export function getScrollDestinationLabel(
  destination: ScrollDestination
): string {
  return destination === "top"
    ? "Scroll to note top"
    : "Scroll to 2-hop links";
}

export class MarkdownScrollNavigator {
  private actions = new Map<MarkdownView, ManagedScrollAction>();

  constructor(
    private requestRender?: (view: MarkdownView) => Promise<void>
  ) {}

  ensure(view: MarkdownView): void {
    this.pruneDisconnectedViews();
    const existing = this.actions.get(view);
    if (existing) {
      this.updateAction(existing);
      return;
    }

    const element = view.addAction(
      "chevrons-up-down",
      getScrollDestinationLabel("links"),
      () => {
        void this.toggle(view);
      }
    );
    element.classList.add(ACTION_CLASS);

    const action: ManagedScrollAction = {
      view,
      element,
      frameId: null,
      settleTimeoutIds: [],
      onScroll: () => this.scheduleActionUpdate(action),
      onUserScrollIntent: () => this.clearSettleTimeouts(action),
    };
    this.actions.set(view, action);
    view.containerEl.addEventListener("scroll", action.onScroll, true);
    for (const eventName of ["wheel", "touchstart", "pointerdown", "keydown"]) {
      view.containerEl.addEventListener(
        eventName,
        action.onUserScrollIntent,
        true
      );
    }
    this.updateAction(action);
  }

  removeAll(): void {
    for (const view of Array.from(this.actions.keys())) {
      this.remove(view);
    }
  }

  prune(): void {
    this.pruneDisconnectedViews();
  }

  remove(view: MarkdownView): void {
    const action = this.actions.get(view);
    if (!action) return;

    view.containerEl.removeEventListener("scroll", action.onScroll, true);
    for (const eventName of ["wheel", "touchstart", "pointerdown", "keydown"]) {
      view.containerEl.removeEventListener(
        eventName,
        action.onUserScrollIntent,
        true
      );
    }
    const ownerWindow = view.containerEl.ownerDocument.defaultView;
    if (action.frameId != null && ownerWindow) {
      ownerWindow.cancelAnimationFrame(action.frameId);
    }
    if (ownerWindow) {
      for (const timeoutId of action.settleTimeoutIds) {
        ownerWindow.clearTimeout(timeoutId);
      }
    }
    action.element.remove();
    this.actions.delete(view);
  }

  private pruneDisconnectedViews(): void {
    for (const [view, action] of this.actions) {
      if (!view.containerEl.isConnected || !action.element.isConnected) {
        this.remove(view);
      }
    }
  }

  private scheduleActionUpdate(action: ManagedScrollAction): void {
    if (action.frameId != null) return;

    const ownerWindow = action.view.containerEl.ownerDocument.defaultView;
    if (!ownerWindow) {
      this.updateAction(action);
      return;
    }

    action.frameId = ownerWindow.requestAnimationFrame(() => {
      action.frameId = null;
      this.updateAction(action);
    });
  }

  private updateAction(action: ManagedScrollAction): void {
    const target = this.findVisibleResultsContainer(action.view);
    const scrollHost = target ? this.findScrollHost(target) : null;
    const destination = target
      ? getScrollDestination(
          scrollHost?.scrollTop ?? action.view.currentMode.getScroll(),
          target.getBoundingClientRect(),
          scrollHost?.getBoundingClientRect() ??
            action.view.containerEl.getBoundingClientRect()
        )
      : "links";
    const label = getScrollDestinationLabel(destination);

    action.element.setAttribute("aria-label", label);
    action.element.setAttribute("title", label);
    action.element.dataset.twohopScrollDestination = destination;
  }

  private async toggle(view: MarkdownView): Promise<void> {
    const action = this.actions.get(view);
    if (action) this.clearSettleTimeouts(action);

    let target = this.findVisibleResultsContainer(view);
    if (!target && this.requestRender) {
      await this.requestRender(view);
      target = this.findVisibleResultsContainer(view);
    }
    if (!target) return;

    const scrollHost = this.findScrollHost(target);
    const destination = getScrollDestination(
      scrollHost?.scrollTop ?? view.currentMode.getScroll(),
      target.getBoundingClientRect(),
      scrollHost?.getBoundingClientRect() ??
        view.containerEl.getBoundingClientRect()
    );
    const ownerWindow = target.ownerDocument.defaultView;
    const reduceMotion =
      ownerWindow?.matchMedia("(prefers-reduced-motion: reduce)").matches ??
      false;
    const behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth";

    if (destination === "top") {
      if (scrollHost && typeof scrollHost.scrollTo === "function") {
        scrollHost.scrollTo({ top: 0, behavior });
      } else {
        view.currentMode.applyScroll(0);
      }
    } else {
      target.scrollIntoView({
        behavior,
        block: "start",
        inline: "nearest",
      });
      if (action) {
        this.scheduleResultsAlignment(action, behavior, reduceMotion);
      }
    }

    if (ownerWindow) {
      ownerWindow.setTimeout(() => {
        const action = this.actions.get(view);
        if (action) this.updateAction(action);
      }, reduceMotion ? 0 : 350);
    }
  }

  private clearSettleTimeouts(action: ManagedScrollAction): void {
    const ownerWindow = action.view.containerEl.ownerDocument.defaultView;
    if (ownerWindow) {
      for (const timeoutId of action.settleTimeoutIds) {
        ownerWindow.clearTimeout(timeoutId);
      }
    }
    action.settleTimeoutIds = [];
  }

  private scheduleResultsAlignment(
    action: ManagedScrollAction,
    behavior: ScrollBehavior,
    reduceMotion: boolean
  ): void {
    const ownerWindow = action.view.containerEl.ownerDocument.defaultView;
    if (!ownerWindow) return;

    const delays = reduceMotion ? [0, 80] : [250, 650, 1100];
    action.settleTimeoutIds = delays.map((delay) =>
      ownerWindow.setTimeout(() => {
        const currentAction = this.actions.get(action.view);
        if (currentAction !== action) return;

        const target = this.findVisibleResultsContainer(action.view);
        if (!target) return;

        const scrollHost = this.findScrollHost(target);
        const destination = getScrollDestination(
          scrollHost?.scrollTop ?? action.view.currentMode.getScroll(),
          target.getBoundingClientRect(),
          scrollHost?.getBoundingClientRect() ??
            action.view.containerEl.getBoundingClientRect()
        );
        if (destination === "links") {
          target.scrollIntoView({
            behavior,
            block: "start",
            inline: "nearest",
          });
        }
        this.updateAction(action);
      }, delay)
    );
  }

  private findVisibleResultsContainer(
    view: MarkdownView
  ): HTMLElement | null {
    const selectors =
      view.getMode() === "preview"
        ? [`.markdown-preview-view > .${RESULTS_CONTAINER_CLASS}`]
        : [
            `.markdown-source-view .cm-sizer > .${RESULTS_CONTAINER_CLASS}`,
            `.markdown-source-view .CodeMirror-lines > .${RESULTS_CONTAINER_CLASS}`,
          ];

    for (const selector of selectors) {
      const candidates = Array.from(
        view.containerEl.querySelectorAll<HTMLElement>(selector)
      );
      const visible = candidates.find(
        (candidate) =>
          candidate.isConnected &&
          candidate.getClientRects().length > 0 &&
          !candidate.closest(
            ".markdown-embed-content, .hover-popover, .popover"
          )
      );
      if (visible) return visible;
    }

    return null;
  }

  private findScrollHost(target: HTMLElement): HTMLElement | null {
    const knownHost = target.closest<HTMLElement>(
      ".cm-scroller, .markdown-preview-view, .CodeMirror-scroll"
    );
    if (knownHost) return knownHost;

    const ownerWindow = target.ownerDocument.defaultView;
    let ancestor = target.parentElement;
    while (ancestor) {
      const overflowY = ownerWindow?.getComputedStyle(ancestor).overflowY ?? "";
      if (
        /(auto|scroll|overlay)/.test(overflowY) &&
        ancestor.scrollHeight > ancestor.clientHeight
      ) {
        return ancestor;
      }
      ancestor = ancestor.parentElement;
    }

    return null;
  }
}
