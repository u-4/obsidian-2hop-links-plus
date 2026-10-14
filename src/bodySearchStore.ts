// Keeps the body-search texts on this device between Obsidian sessions, in
// IndexedDB. Nothing is synced or written to data.json. Each text is checked
// against the note's mtime and size before use, the store is bounded, and any
// failure quietly leaves search with the in-memory cache only.
import type { App } from "obsidian";
import type { BodySearchPersistence, StoredBodyText } from "./bodySearch";

const DATABASE_NAME = "2hop-links-plus-body-search";
const DATABASE_VERSION = 1;
const TEXTS = "texts";
const USES = "uses";
export const MAX_STORED_BODY_TEXTS = 2000;
export const MAX_STORED_BODY_CHARS = 10_000_000;
const PRUNE_EVERY_PUTS = 25;

interface TextRecord extends StoredBodyText {
  key: string;
}

interface UseRecord {
  key: string;
  chars: number;
  usedAt: number;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export class IndexedDbBodySearchStore implements BodySearchPersistence {
  private database: Promise<IDBDatabase | null> | null = null;
  private disabled = false;
  private putsSincePrune = 0;

  constructor(
    private readonly factory: IDBFactory,
    private readonly vaultId: string
  ) {}

  async getMany(paths: string[]): Promise<Map<string, StoredBodyText>> {
    const found = new Map<string, StoredBodyText>();
    const database = await this.open();
    if (!database || paths.length === 0) return found;
    try {
      const store = database.transaction(TEXTS, "readonly").objectStore(TEXTS);
      const records = await Promise.all(
        paths.map((path) =>
          requestResult<TextRecord | undefined>(store.get(this.keyOf(path)))
        )
      );
      records.forEach((record, index) => {
        if (record) found.set(paths[index], record);
      });
    } catch (error) {
      this.fail(error);
    }
    return found;
  }

  put(path: string, entry: StoredBodyText): void {
    void this.write(async (database) => {
      const key = this.keyOf(path);
      const transaction = database.transaction([TEXTS, USES], "readwrite");
      const record: TextRecord = { key, ...entry };
      const use: UseRecord = {
        key,
        chars: entry.text.length,
        usedAt: Date.now(),
      };
      transaction.objectStore(TEXTS).put(record);
      transaction.objectStore(USES).put(use);
      await transactionDone(transaction);
      if (++this.putsSincePrune >= PRUNE_EVERY_PUTS) {
        this.putsSincePrune = 0;
        await this.prune(database);
      }
    });
  }

  touch(paths: string[]): void {
    void this.write(async (database) => {
      const transaction = database.transaction(USES, "readwrite");
      const uses = transaction.objectStore(USES);
      const now = Date.now();
      for (const path of paths) {
        const key = this.keyOf(path);
        const request = uses.get(key);
        request.onsuccess = () => {
          const use = request.result as UseRecord | undefined;
          if (use) uses.put({ ...use, usedAt: now });
        };
      }
      await transactionDone(transaction);
    });
  }

  close(): void {
    const database = this.database;
    this.database = null;
    void database?.then((opened) => opened?.close()).catch(() => undefined);
  }

  private keyOf(path: string): string {
    return JSON.stringify([this.vaultId, path]);
  }

  private async write(
    work: (database: IDBDatabase) => Promise<void>
  ): Promise<void> {
    const database = await this.open();
    if (!database) return;
    try {
      await work(database);
    } catch (error) {
      this.fail(error);
    }
  }

  /** Drops the least recently used texts beyond the bounds (all vaults). */
  private prune(database: IDBDatabase): Promise<void> {
    const transaction = database.transaction([TEXTS, USES], "readwrite");
    const texts = transaction.objectStore(TEXTS);
    const uses = transaction.objectStore(USES);
    // Callbacks rather than await, so the transaction stays active.
    const request = uses.getAll();
    request.onsuccess = () => {
      const records = request.result as UseRecord[];
      let count = records.length;
      let chars = records.reduce((total, record) => total + record.chars, 0);
      records.sort((a, b) => a.usedAt - b.usedAt);
      for (const record of records) {
        if (count <= MAX_STORED_BODY_TEXTS && chars <= MAX_STORED_BODY_CHARS) {
          break;
        }
        texts.delete(record.key);
        uses.delete(record.key);
        count--;
        chars -= record.chars;
      }
    };
    return transactionDone(transaction);
  }

  private open(): Promise<IDBDatabase | null> {
    if (this.disabled) return Promise.resolve(null);
    if (!this.database) {
      this.database = new Promise<IDBDatabase | null>((resolve) => {
        let request: IDBOpenDBRequest;
        try {
          request = this.factory.open(DATABASE_NAME, DATABASE_VERSION);
        } catch (error) {
          this.fail(error);
          resolve(null);
          return;
        }
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(TEXTS)) {
            database.createObjectStore(TEXTS, { keyPath: "key" });
          }
          if (!database.objectStoreNames.contains(USES)) {
            database.createObjectStore(USES, { keyPath: "key" });
          }
        };
        request.onsuccess = () => {
          const database = request.result;
          // Let a newer version of the plugin upgrade the database.
          database.onversionchange = () => database.close();
          resolve(database);
        };
        request.onerror = () => {
          this.fail(request.error);
          resolve(null);
        };
        request.onblocked = () => {
          this.fail(new Error("IndexedDB open blocked"));
          resolve(null);
        };
      });
    }
    return this.database;
  }

  private fail(error: unknown): void {
    if (!this.disabled) {
      console.debug("2Hop Links: body-search store unavailable", error);
    }
    this.disabled = true;
  }
}

const stores = new Map<string, IndexedDbBodySearchStore>();

/** The store for this vault, or null where IndexedDB is unavailable. */
export function getBodySearchPersistence(
  app: App
): BodySearchPersistence | null {
  let factory: IDBFactory | undefined;
  try {
    factory = globalThis.indexedDB;
  } catch {
    return null;
  }
  if (!factory) return null;
  const vaultId =
    (app as unknown as { appId?: string }).appId ||
    app.vault?.getName?.() ||
    "vault";
  let store = stores.get(vaultId);
  if (!store) {
    store = new IndexedDbBodySearchStore(factory, vaultId);
    stores.set(vaultId, store);
  }
  return store;
}

/** Closes the database connections (on plugin unload). */
export function closeBodySearchPersistence(): void {
  for (const store of stores.values()) store.close();
  stores.clear();
}
