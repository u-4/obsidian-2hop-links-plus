export interface AnimationFrameApi {
  requestAnimationFrame(callback: (timestamp: number) => void): number;
  cancelAnimationFrame(handle: number): void;
}

export interface AnimationFrameRetryOptions {
  frameApi: AnimationFrameApi;
  maxFrames: number;
  shouldContinue: () => boolean;
  isReady: () => boolean;
  onReady: () => void;
}

export interface MarkdownHostRetryContext {
  isUnloaded: boolean;
  showLinksInMarkdown: boolean;
  showInSeparatePane: boolean;
  isActiveLeaf: boolean;
  leafViewType: string;
  activeFilePath: string | null;
  expectedFilePath: string;
}

// Injection and cleanup must cover both the visible and hidden mode hosts.
// Current-mode readiness uses getMarkdownHostSelector() separately.
export const ALL_MARKDOWN_HOST_SELECTOR =
  ".markdown-source-view .CodeMirror-lines, .markdown-preview-view, .markdown-source-view .cm-sizer";

export function shouldContinueMarkdownHostRetry(
  context: MarkdownHostRetryContext
): boolean {
  return (
    !context.isUnloaded &&
    context.showLinksInMarkdown &&
    !context.showInSeparatePane &&
    context.isActiveLeaf &&
    context.leafViewType === "markdown" &&
    context.activeFilePath === context.expectedFilePath
  );
}

export function getMarkdownHostSelector(mode: string): string {
  return mode === "preview"
    ? ".markdown-preview-view"
    : ".markdown-source-view .CodeMirror-lines, .markdown-source-view .cm-sizer";
}

function queryMarkdownHostElements(
  root: ParentNode,
  selector: string
): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (element) => !element.closest(".markdown-embed-content")
  );
}

export function getAllMarkdownHostElements(root: ParentNode): HTMLElement[] {
  return queryMarkdownHostElements(root, ALL_MARKDOWN_HOST_SELECTOR);
}

export function getCurrentMarkdownHostElements(
  root: ParentNode,
  mode: string
): HTMLElement[] {
  return queryMarkdownHostElements(root, getMarkdownHostSelector(mode));
}

/**
 * Waits for a view-owned DOM target without emitting duplicate workspace events.
 * A new schedule or cancel call always invalidates the previous attempt.
 */
export class BoundedAnimationFrameRetry {
  private frameApi: AnimationFrameApi | null = null;
  private frameHandle: number | null = null;
  private generation = 0;

  schedule(options: AnimationFrameRetryOptions): boolean {
    this.cancel();

    const requestedFrames = Number.isFinite(options.maxFrames)
      ? Math.floor(options.maxFrames)
      : 0;
    let remainingFrames = Math.max(0, requestedFrames);
    if (remainingFrames === 0 || !options.shouldContinue()) {
      return false;
    }

    const generation = ++this.generation;
    this.frameApi = options.frameApi;

    const check = (): void => {
      if (generation !== this.generation) {
        return;
      }

      this.frameHandle = null;
      if (!options.shouldContinue()) {
        this.finish(generation);
        return;
      }

      if (options.isReady()) {
        this.finish(generation);
        options.onReady();
        return;
      }

      remainingFrames -= 1;
      if (remainingFrames <= 0) {
        this.finish(generation);
        return;
      }

      this.frameHandle = options.frameApi.requestAnimationFrame(check);
    };

    this.frameHandle = options.frameApi.requestAnimationFrame(check);
    return true;
  }

  cancel(): void {
    this.generation += 1;
    if (this.frameApi && this.frameHandle !== null) {
      this.frameApi.cancelAnimationFrame(this.frameHandle);
    }
    this.frameApi = null;
    this.frameHandle = null;
  }

  isPending(): boolean {
    return this.frameHandle !== null;
  }

  private finish(generation: number): void {
    if (generation !== this.generation) {
      return;
    }
    this.frameApi = null;
    this.frameHandle = null;
  }
}
