// Small card images. A local image is decoded once, drawn at about the size
// a card shows it, and kept as a small blob URL, so cards do not hold
// full-resolution photos in memory.
import { App, Platform, TFile } from "obsidian";

/** The largest CSS box a card image fills (object-fit: cover). */
const THUMBNAIL_BOX_WIDTH = 320;
const THUMBNAIL_BOX_HEIGHT = 120;
const MAX_PIXEL_RATIO = 2;
/** Images already about this small are shown as they are. */
const KEEP_ORIGINAL_SCALE = 0.8;
/** Larger files are not decoded for a card; same limit as the first image. */
export const MAX_THUMBNAIL_SOURCE_BYTES = 2 * 1024 * 1024;
/** On phones and tablets, an image without a thumbnail is shown up to this. */
export const MOBILE_MAX_ORIGINAL_BYTES = 512 * 1024;
const MAX_THUMBNAILS = 150;
const MAX_THUMBNAILS_MOBILE = 80;

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  bmp: "image/bmp",
};

/** A small image, "original" when the image is already small, or null. */
export type ThumbnailResult = Blob | "original" | null;

export interface ThumbnailEnvironment {
  isMobile: boolean;
  pixelRatio(): number;
  makeThumbnail(
    data: ArrayBuffer,
    type: string,
    width: number,
    height: number
  ): Promise<ThumbnailResult>;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
}

export interface ThumbnailLease {
  /** The URL to show, when already known: null means no image. */
  url: string | null | undefined;
  ready: Promise<string | null>;
  /** The card no longer shows the image; it may be dropped from memory. */
  release(): void;
}

interface Entry {
  url: string | null | undefined;
  isBlob: boolean;
  refs: number;
  ready: Promise<string | null>;
}

/**
 * Makes card thumbnails one at a time and keeps the most recent ones.
 * Thumbnails in use by a card are never dropped; blob URLs are revoked when
 * dropped and when the plugin unloads. If a thumbnail cannot be made (an
 * unsupported format or browser), the original image is used, on mobile only
 * when its file is small.
 */
export class CardThumbnails {
  private readonly entries = new Map<string, Entry>();
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  made = 0;

  constructor(
    private readonly app: App,
    private readonly env: ThumbnailEnvironment = browserEnvironment()
  ) {}

  acquire(imagePath: string, originalUrl: string): ThumbnailLease {
    const file = this.app.vault.getAbstractFileByPath(imagePath);
    if (!(file instanceof TFile) || this.disposed) {
      const url = this.disposed ? null : originalUrl;
      return { url, ready: Promise.resolve(url), release: () => undefined };
    }
    const key = JSON.stringify([file.path, file.stat.mtime, file.stat.size]);
    let entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    } else {
      const created: Entry = {
        url: undefined,
        isBlob: false,
        refs: 0,
        ready: Promise.resolve(null),
      };
      created.ready = this.enqueue(() => this.generate(file, originalUrl)).then(
        ({ url, isBlob }) => {
          if (this.disposed || this.entries.get(key) !== created) {
            if (isBlob && url) this.env.revokeObjectUrl(url);
            return this.disposed ? null : url;
          }
          created.url = url;
          created.isBlob = isBlob;
          this.prune();
          return url;
        }
      );
      entry = created;
      this.entries.set(key, entry);
    }
    const leased = entry;
    leased.refs++;
    let released = false;
    return {
      url: leased.url,
      ready: leased.ready,
      release: () => {
        if (released) return;
        released = true;
        leased.refs--;
        this.prune();
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      if (entry.isBlob && entry.url) this.env.revokeObjectUrl(entry.url);
    }
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async generate(
    file: TFile,
    originalUrl: string
  ): Promise<{ url: string | null; isBlob: boolean }> {
    const fallback = {
      url:
        !this.env.isMobile || file.stat.size <= MOBILE_MAX_ORIGINAL_BYTES
          ? originalUrl
          : null,
      isBlob: false,
    };
    const type = MIME_TYPES[file.extension.toLowerCase()];
    if (this.disposed) return { url: null, isBlob: false };
    if (!type || !(file.stat.size > 0)) return fallback;
    if (file.stat.size > MAX_THUMBNAIL_SOURCE_BYTES) return fallback;
    try {
      const data = await this.app.vault.readBinary(file);
      if (this.disposed) return { url: null, isBlob: false };
      const ratio = Math.min(
        MAX_PIXEL_RATIO,
        Math.max(1, this.env.pixelRatio() || 1)
      );
      const result = await this.env.makeThumbnail(
        data,
        type,
        Math.round(THUMBNAIL_BOX_WIDTH * ratio),
        Math.round(THUMBNAIL_BOX_HEIGHT * ratio)
      );
      if (result === "original") return { url: originalUrl, isBlob: false };
      if (!result) return fallback;
      this.made++;
      return { url: this.env.createObjectUrl(result), isBlob: true };
    } catch (error) {
      console.debug("2Hop Links: could not make a card thumbnail", error);
      return fallback;
    }
  }

  private prune(): void {
    const limit = this.env.isMobile ? MAX_THUMBNAILS_MOBILE : MAX_THUMBNAILS;
    if (this.entries.size <= limit) return;
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= limit) break;
      if (entry.refs > 0 || entry.url === undefined) continue;
      this.entries.delete(key);
      if (entry.isBlob && entry.url) this.env.revokeObjectUrl(entry.url);
    }
  }
}

/** Decodes the image once and draws it to cover width x height. */
export async function drawThumbnail(
  data: ArrayBuffer,
  type: string,
  width: number,
  height: number
): Promise<ThumbnailResult> {
  if (
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  ) {
    return null;
  }
  const bitmap = await createImageBitmap(new Blob([data], { type }));
  try {
    if (!(bitmap.width > 0) || !(bitmap.height > 0)) return null;
    const scale = Math.min(
      1,
      Math.max(width / bitmap.width, height / bitmap.height)
    );
    if (scale >= KEEP_ORIGINAL_SCALE) return "original";
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    try {
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      // PNG and WebP may be transparent; photos compress better as JPEG.
      const outputType =
        type === "image/png" || type === "image/webp"
          ? "image/png"
          : "image/jpeg";
      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, outputType, 0.85)
      );
    } finally {
      // Give the canvas memory back at once; iOS limits it in total.
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    bitmap.close();
  }
}

function browserEnvironment(): ThumbnailEnvironment {
  return {
    isMobile: Platform.isMobile,
    pixelRatio: () =>
      typeof window === "undefined" ? 1 : window.devicePixelRatio,
    makeThumbnail: drawThumbnail,
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  };
}

let provider: CardThumbnails | null = null;

/** The thumbnails cards use (set by the plugin while it is loaded). */
export function setCardThumbnails(next: CardThumbnails | null): void {
  provider = next;
}

export function getCardThumbnails(): CardThumbnails | null {
  return provider;
}
