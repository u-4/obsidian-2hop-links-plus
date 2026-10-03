// Card excerpts and images, shared in behaviour with PalmWiki Home.
// excerpt(), the first-image rule and the preview store follow
// palmwiki-home/main.js (excerpt, firstImage, PreviewStore) as of 2026-10-04,
// rewritten in TypeScript. Keep the two in step when either changes.
import { App, TFile } from "obsidian";

export interface CardPreview {
  text: string;
  /** Resource URL of a local image, or a YouTube / web image URL. */
  imageUrl: string | null;
}

const MAX_PREVIEW_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const MAX_CACHED_PREVIEWS = 300;
const MAX_CONCURRENT_READS = 2;
const READ_YIELD_MS = 32;

/** Plain text for a card: no frontmatter, code, embeds or Markdown syntax. */
export function excerpt(body: string): string {
  let text = body.slice(0, 16384).replace(/^\uFEFF/, "");
  if (/^---\r?\n/.test(text)) {
    const end = text.slice(4).search(/\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/);
    if (end < 0) return "";
    text = text
      .slice(4 + end)
      .replace(/^\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/, "");
  }
  return text
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, " ")
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+] |\d+\. )\s*/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

/** The first local image embedded in the note, found through its metadata. */
export function firstLocalImage(app: App, file: TFile): TFile | null {
  const embeds = app.metadataCache.getFileCache(file)?.embeds ?? [];
  for (const embed of embeds.slice(0, 100)) {
    let link = String(embed.link || "")
      .split("|")[0]
      .split("#")[0]
      .trim();
    try {
      link = decodeURIComponent(link);
    } catch {
      continue;
    }
    if (
      !link ||
      /^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(link) ||
      // eslint-disable-next-line no-control-regex
      /[\x00-\x1f]/.test(link)
    ) {
      continue;
    }
    const image = app.metadataCache.getFirstLinkpathDest(link, file.path);
    if (
      !(image instanceof TFile) ||
      !IMAGE_EXTENSIONS.has(image.extension.toLowerCase())
    ) {
      continue;
    }
    // Do not decode an oversized first image just to make a small card.
    if (
      !Number.isFinite(image.stat.size) ||
      image.stat.size <= 0 ||
      image.stat.size > MAX_IMAGE_BYTES
    ) {
      return null;
    }
    return image;
  }
  return null;
}

/** A YouTube thumbnail or a web image written in the note body. */
export function findWebImage(body: string): string | null {
  const match = body.match(
    /<iframe[^>]*src="([^"]+)"[^>]*>|!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/
  );
  if (!match) return null;
  const url = match[1] ?? match[2];
  const youtube = getYouTubeThumbnailUrl(url);
  if (youtube) return youtube;
  if (match[2] && /\.(?:png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(url)) {
    return url;
  }
  return null;
}

export function getYouTubeThumbnailUrl(url: string): string | null {
  const id = url.match(
    /(?:youtube\.com\/embed\/|youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/
  )?.[1];
  return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
}

function snapshotKey(file: TFile): string {
  return JSON.stringify([file.path, file.stat.mtime, file.stat.size]);
}

interface PreviewJob {
  key: string;
  path: string;
  checks: Array<() => boolean>;
  promise: Promise<CardPreview | null>;
  resolve: (preview: CardPreview | null) => void;
}

/**
 * Reads card previews a few at a time and remembers them until the note
 * changes. Reads that are no longer needed (the card left the screen or the
 * view changed) are skipped.
 */
export class PreviewStore {
  private readonly cache = new Map<string, CardPreview>();
  private readonly jobs = new Map<string, PreviewJob>();
  private queue: PreviewJob[] = [];
  private active = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  reads = 0;

  constructor(private readonly app: App) {}

  /** A preview already read for this version of the note, if any. */
  get(file: TFile): CardPreview | undefined {
    const key = snapshotKey(file);
    const cached = this.cache.get(key);
    if (cached === undefined) return undefined;
    this.cache.delete(key);
    this.cache.set(key, cached);
    return cached;
  }

  read(file: TFile, isNeeded: () => boolean): Promise<CardPreview | null> {
    const cached = this.get(file);
    if (cached !== undefined) return Promise.resolve(cached);
    if (file.stat.size > MAX_PREVIEW_BYTES) {
      return Promise.resolve({ text: "", imageUrl: this.localImageUrl(file) });
    }
    const key = snapshotKey(file);
    const existing = this.jobs.get(key);
    if (existing) {
      existing.checks.push(isNeeded);
      return existing.promise;
    }
    let resolve: (preview: CardPreview | null) => void = () => undefined;
    const promise = new Promise<CardPreview | null>((done) => {
      resolve = done;
    });
    const job: PreviewJob = {
      key,
      path: file.path,
      checks: [isNeeded],
      promise,
      resolve,
    };
    this.jobs.set(key, job);
    this.queue.push(job);
    this.schedule();
    return promise;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    for (const job of this.queue) job.resolve(null);
    this.queue = [];
    this.jobs.clear();
    this.cache.clear();
  }

  private localImageUrl(file: TFile): string | null {
    const image = firstLocalImage(this.app, file);
    return image ? this.app.vault.getResourcePath(image) : null;
  }

  private schedule(): void {
    if (this.disposed || this.timer !== null || this.queue.length === 0) return;
    // Let titles paint first, and yield between reads.
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, READ_YIELD_MS);
  }

  private drain(): void {
    while (
      !this.disposed &&
      this.active < MAX_CONCURRENT_READS &&
      this.queue.length > 0
    ) {
      const job = this.queue.shift() as PreviewJob;
      const current = this.app.vault.getAbstractFileByPath(job.path);
      if (
        !(current instanceof TFile) ||
        snapshotKey(current) !== job.key ||
        !job.checks.some((check) => check())
      ) {
        this.jobs.delete(job.key);
        job.resolve(null);
        continue;
      }
      this.active++;
      this.reads++;
      Promise.resolve()
        .then(() => this.app.vault.cachedRead(current))
        .then((body): CardPreview | null => {
          const latest = this.app.vault.getAbstractFileByPath(job.path);
          if (
            this.disposed ||
            !(latest instanceof TFile) ||
            snapshotKey(latest) !== job.key
          ) {
            return null;
          }
          const preview = {
            text: excerpt(body),
            imageUrl: this.localImageUrl(latest) ?? findWebImage(body),
          };
          this.cache.set(job.key, preview);
          while (this.cache.size > MAX_CACHED_PREVIEWS) {
            const oldest = this.cache.keys().next().value;
            if (oldest === undefined) break;
            this.cache.delete(oldest);
          }
          return preview;
        })
        .catch(() => null)
        .then((preview) => job.resolve(preview))
        .finally(() => {
          this.active--;
          this.jobs.delete(job.key);
          this.schedule();
        });
    }
  }
}
