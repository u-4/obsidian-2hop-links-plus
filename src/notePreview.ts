// A light, read-only rendering of a note, shared in behaviour with PalmWiki
// Home. Follows NotePreview and previewMarkdown in palmwiki-home/main.js
// (1.7.1, commit c0db2d0), rewritten in TypeScript without search-term marks.
// Keep the two in step when either changes.
import { App, Component, MarkdownRenderer, TFile } from "obsidian";

const PREVIEW_CHARS = 20000;

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

  async show(file: TFile): Promise<void> {
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
      await MarkdownRenderer.render(this.app, text, content, file.path, component);
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
