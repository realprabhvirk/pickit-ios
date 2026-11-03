/**
 * A tiny IndexedDB key-value store. Settings live here now; the session, recents and spilled
 * undo steps join them in Phase 1. Every call fails soft: private mode or blocked storage
 * must never stop the editor.
 */
const DB_NAME = 'pickit';
const DB_VERSION = 2;
/** kv: settings and the session index. docs: autosaved photos. spill: undo steps moved out of memory. */
export const STORES = ['kv', 'docs', 'spill'] as const;
type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function getItem<T>(key: string, store: StoreName = 'kv'): Promise<T | undefined> {
  try {
    return (await tx(store, 'readonly', (s) => s.get(key))) as T | undefined;
  } catch {
    return undefined;
  }
}

export async function setItem(key: string, value: unknown, store: StoreName = 'kv'): Promise<boolean> {
  try {
    await tx(store, 'readwrite', (s) => s.put(value, key));
    return true;
  } catch {
    return false;
  }
}

export async function deleteItem(key: string, store: StoreName = 'kv'): Promise<void> {
  try {
    await tx(store, 'readwrite', (s) => s.delete(key));
  } catch {
    /* already gone */
  }
}

export async function keys(store: StoreName): Promise<string[]> {
  try {
    return (await tx(store, 'readonly', (s) => s.getAllKeys())) as string[];
  } catch {
    return [];
  }
}

export async function clearStore(store: StoreName): Promise<void> {
  try {
    await tx(store, 'readwrite', (s) => s.clear());
  } catch {
    /* nothing to clear */
  }
}

/** Removes everything PicKit stored on this device: IndexedDB, OPFS, and old caches are left to the service worker. */
export async function clearAllData(): Promise<void> {
  try {
    const db = await open();
    db.close();
  } catch {
    /* nothing open */
  }
  dbPromise = null;
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
  try {
    const root = await navigator.storage?.getDirectory?.();
    if (root) {
      // @ts-expect-error: keys() is in WebKit and Chromium but not every lib.dom version
      for await (const name of root.keys()) await root.removeEntry(name, { recursive: true });
    }
  } catch {
    /* no OPFS */
  }
  try {
    localStorage.clear();
  } catch {
    /* blocked */
  }
}
