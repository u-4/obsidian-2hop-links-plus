// A light, read-only rendering of a note, shared in behaviour with PalmWiki
// Home. Follows NotePreview and previewMarkdown in palmwiki-home/main.js
// (1.7.1, commit c0db2d0), rewritten in TypeScript without search-term marks.
// Keep the two in step when either changes.
import { App, Component, MarkdownRenderer, TFile } from "obsidian";

const PREVIEW_CHARS = 20000;

/** What to scroll to and highlight once a preview is drawn. */
export interface PreviewFocus {
  /** Heading named after "#" in the link, if any. */
  heading?: string;
  /** Paths of notes; the first rendered link to one of them is shown. */
  linkTargets: string[];
}

/** The note body without frontmatter, cut to PREVIEW_CHARS. */
export function previewMarkdown(body: string): { text: string; cut: boolean } {
  let text = String(body).replace(/^\uFEFF/, "");
  if (/^---\r?\n/.test(text)) {
    const end = text.slice(4).search(/\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/);
    if (end >= 0) {
      text = text
        .slice(4 + end)
        .replace(/^\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/, "");
    }
  }
  return text.length > PREVIEW_CHARS
    ? { text: text.slice(0, PREVIEW_CHARS), cut: true }
    : { text, cut: false };
}

/**
 * Renders a note's title and body into `el` with Obsidian's Markdown renderer.
 * No editor and no view, so it opens quickly; the newest show() wins.
 */
export class NotePreview {
  private token = 0;
  private component: Component | null = null;
  file: TFile | null = null;

  constructor(
    private readonly app: App,
    private readonly el: HTMLElement,
    private readonly onLink: (
      linkText: string,
      sourcePath: string,
      event: MouseEvent
    ) => void
  ) {
    el.addEventListener("click", (event) => {
      const link = (event.target as HTMLElement | null)?.closest?.(
        "a.internal-link"
      ) as HTMLAnchorElement | null;
      if (!link) return;
      event.preventDefault();
      this.onLink(
        link.dataset.href || link.getAttribute("href") || "",
        this.file?.path ?? "",
        event
      );
    });
  }

  async show(file: TFile, focus?: PreviewFocus): Promise<void> {
    const token = ++this.token;
    const doc = this.el.ownerDocument;
    let body: string | null = null;
    try {
      body = await this.app.vault.cachedRead(file);
    } catch {
      body = null;
    }
    if (token !== this.token) return;
    this.clear();
    this.file = file;
    const title = doc.createElement("div");
    title.className = "twohop-popover-preview-title";
    title.textContent = file.basename;
    const content = doc.createElement("div");
    content.className = "twohop-popover-preview-body";
    this.el.append(title, content);
    this.el.scrollTop = 0;
    if (body === null) {
      content.textContent = "読み込めませんでした。";
      return;
    }
    const { text, cut } = previewMarkdown(body);
    const component = new Component();
    component.load();
    this.component = component;
    try {
      await MarkdownRenderer.render(
        this.app,
        text,
        content,
        file.path,
        component
      );
    } catch {
      content.textContent = text;
    }
    if (token !== this.token) return;
    if (cut) {
      const more = doc.createElement("div");
      more.className = "twohop-popover-preview-hint";
      more.textContent = "（長いノートのため途中まで表示しています）";
      this.el.append(more);
    }
    if (focus) this.reveal(content, file, focus);
  }

  /**
   * Scrolls to and highlights the linked heading, or else the first block with
   * a link to one of the focus notes. Only the rendered links are examined.
   */
  private reveal(content: HTMLElement, file: TFile, focus: PreviewFocus): void {
    let target: HTMLElement | null = null;
    if (focus.heading) {
      const wanted = normalizeHeading(focus.heading);
      target =
        Array.from(
          content.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")
        ).find(
          (heading) => normalizeHeading(heading.textContent ?? "") === wanted
        ) ?? null;
    }
    if (!target && focus.linkTargets.length > 0) {
      const targets = new Set(focus.linkTargets);
      for (const link of Array.from(
        content.querySelectorAll<HTMLAnchorElement>("a.internal-link")
      )) {
        const href = (link.dataset.href || link.getAttribute("href") || "")
          .split("#")[0]
          .split("|")[0];
        const dest = href
          ? this.app.metadataCache.getFirstLinkpathDest(href, file.path)
          : null;
        if (dest && targets.has(dest.path)) {
          link.classList.add("twohop-popover-focus-link");
          target = lineAround(link);
          break;
        }
      }
    }
    if (!target) return;
    target.classList.add("twohop-popover-focus");
    // Keep the highlighted part about a third of the way down the preview.
    const elRect = this.el.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    this.el.scrollTop = Math.max(
      0,
      this.el.scrollTop + targetRect.top - elRect.top - this.el.clientHeight / 3
    );
  }

  dispose(): void {
    this.token++;
    this.clear();
  }

  private clear(): void {
    this.component?.unload();
    this.component = null;
    while (this.el.firstChild) this.el.firstChild.remove();
  }
}

function normalizeHeading(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The line holding a link: within its paragraph, list item or table cell,
 * only the part between line breaks (<br>, a newline in the text, a nested
 * list or the list bullet), wrapped in a span. Headings are taken whole.
 */
function lineAround(link: HTMLElement): HTMLElement {
  const block = link.closest("li, td, th, h1, h2, h3, h4, h5, h6, p");
  if (!(block instanceof HTMLElement)) return link;
  if (/^H\d$/.test(block.tagName)) return block;
  const isBoundary = (node: Node) =>
    node.nodeName === "BR" ||
    node.nodeName === "UL" ||
    node.nodeName === "OL" ||
    (node instanceof HTMLElement &&
      (node.classList.contains("list-bullet") ||
        node.classList.contains("list-collapse-indicator")));
  let child: Node = link;
  while (child.parentNode && child.parentNode !== block)
    child = child.parentNode;

  let first: Node = child;
  for (;;) {
    const prev = first.previousSibling;
    if (!prev || isBoundary(prev)) break;
    if (prev.nodeType === Node.TEXT_NODE && prev.textContent?.includes("\n")) {
      const text = prev as Text;
      const at = (text.textContent ?? "").lastIndexOf("\n") + 1;
      first = at < text.length ? text.splitText(at) : text.nextSibling ?? first;
      break;
    }
    first = prev;
  }
  let last: Node = child;
  for (;;) {
    const next = last.nextSibling;
    if (!next || isBoundary(next)) break;
    if (next.nodeType === Node.TEXT_NODE && next.textContent?.includes("\n")) {
      const text = next as Text;
      const at = (text.textContent ?? "").indexOf("\n");
      if (at > 0) {
        text.splitText(at);
        last = text;
      }
      break;
    }
    last = next;
  }
  const line = block.ownerDocument.createElement("span");
  block.insertBefore(line, first);
  let node: Node | null = first;
  while (node) {
    const following: Node | null = node === last ? null : node.nextSibling;
    line.appendChild(node);
    node = following;
  }
  return line;
}
