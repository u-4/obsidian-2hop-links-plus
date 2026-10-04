import { MarkdownView, TFile } from "obsidian";
import type TwohopLinksPlugin from "./main";
import { removeBlockReference } from "./utils";

// Links in a note body, in Reading view (rendered anchors) and in Live
// Preview or Source mode (CodeMirror spans).
const RENDERED_LINK = "a.internal-link";
const EDITOR_LINK = ".cm-hmd-internal-link";
// Popups that are not ours keep their own link behaviour.
const FOREIGN_POPUP = ".hover-popover, .hover-editor, .popover";

interface EditorWithView {
  cm?: { posAtDOM(node: Node): number };
}

/**
 * Turns Cmd+hover on links in a note body into the related-cards popup.
 *
 * The pointer events are taken at the document in the capture phase and not
 * passed on, so Obsidian's page preview (Hover Editor) does not also open for
 * these links, including when Cmd is pressed after pointing.
 */
export class BodyLinkHover {
  private current: HTMLElement | null = null;

  constructor(private readonly plugin: TwohopLinksPlugin) {}

  readonly onMouseOver = (event: MouseEvent): void => {
    const link = this.findLink(event.target);
    if (!link) return;
    event.stopPropagation();
    if (this.current === link) return;
    const resolved = this.resolve(link);
    if (!resolved) return;
    this.current = link;
    this.plugin.popover.enter(link, resolved.file, event, {
      heading: resolved.heading,
    });
  };

  readonly onMouseOut = (event: MouseEvent): void => {
    const link = this.current;
    if (!link) return;
    const to = event.relatedTarget;
    if (to instanceof Node && link.contains(to)) return;
    if (!(event.target instanceof Node) || !link.contains(event.target)) return;
    this.current = null;
    this.plugin.popover.leave(link);
  };

  private findLink(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) return null;
    const link = target.closest<HTMLElement>(
      `${RENDERED_LINK}, ${EDITOR_LINK}`
    );
    if (!link) return null;
    if (
      link.closest(
        ".twohop-popover, .twohop-title-strip, .twohop-links-container"
      )
    ) {
      return null;
    }
    if (link.closest(FOREIGN_POPUP)) return null;
    if (!link.closest(".markdown-preview-view, .markdown-source-view"))
      return null;
    return link;
  }

  private resolve(link: HTMLElement): { file: TFile; heading?: string } | null {
    const view = this.viewContaining(link);
    const sourcePath = view?.file?.path ?? "";
    let linkText: string | null = null;
    if (link.matches(RENDERED_LINK)) {
      linkText = link.dataset.href || link.getAttribute("href");
    } else if (view?.file) {
      linkText = this.editorLinkText(link, view);
    }
    if (!linkText) return null;
    const [path, ...subpaths] = linkText.split("|")[0].split("#");
    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(
      removeBlockReference(path),
      sourcePath
    );
    if (!(file instanceof TFile) || file.extension !== "md") return null;
    const heading = subpaths.pop()?.replace(/^\^.*/, "");
    return { file, heading: heading || undefined };
  }

  /** The link written at the span's place in the note, from the metadata. */
  private editorLinkText(span: HTMLElement, view: MarkdownView): string | null {
    const cm = (view.editor as unknown as EditorWithView).cm;
    const file = view.file;
    if (!cm || !file) return span.textContent;
    let pos: number;
    try {
      pos = cm.posAtDOM(span);
    } catch {
      return span.textContent;
    }
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const reference = [...(cache?.links ?? []), ...(cache?.embeds ?? [])].find(
      (ref) =>
        ref.position.start.offset <= pos && pos <= ref.position.end.offset
    );
    return reference?.link ?? span.textContent;
  }

  private viewContaining(el: HTMLElement): MarkdownView | null {
    let found: MarkdownView | null = null;
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (
        !found &&
        leaf.view instanceof MarkdownView &&
        leaf.view.containerEl.contains(el)
      ) {
        found = leaf.view;
      }
    });
    return found;
  }
}
