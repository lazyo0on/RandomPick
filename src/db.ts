/**
 * The single IndexedDB connection shared by everything stored locally
 * (marble skins and user-made maps). Both live in one database so the
 * version is managed in one place.
 *
 * Nothing here ever leaves the browser.
 */

const DB_NAME = 'marble-roulette';
const DB_VERSION = 2;

export const SKIN_STORE = 'skins';
export const MAP_STORE = 'maps';

let dbPromise: Promise<IDBDatabase | null> | null = null;

export function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    // Version 1 only had the skin store. Creating each store behind a
    // `contains` check keeps existing skins intact on upgrade.
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SKIN_STORE)) {
        db.createObjectStore(SKIN_STORE);
      }
      if (!db.objectStoreNames.contains(MAP_STORE)) {
        db.createObjectStore(MAP_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn('Local storage unavailable; nothing will be saved.');
      resolve(null);
    };
    request.onblocked = () => {
      console.warn('Another tab is holding an older version of the database.');
    };
  });

  return dbPromise;
}

/** Runs one request against a store and resolves null when storage is unusable. */
export async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    let request: IDBRequest<T>;
    try {
      request = action(db.transaction(storeName, mode).objectStore(storeName));
    } catch (e) {
      console.warn('Storage request failed', e);
      resolve(null);
      return;
    }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn('Storage request failed', request.error);
      resolve(null);
    };
  });
}

/**
 * Asks the browser to make this origin's storage durable, so saved skins
 * and maps are not silently evicted when the device runs low on disk space.
 * Browsers decide by their own heuristics; a refusal is harmless.
 */
let persistRequested = false;
export async function requestPersistentStorage(): Promise<void> {
  if (persistRequested) return;
  persistRequested = true;

  try {
    if (!navigator.storage?.persist || !navigator.storage.persisted) return;
    if (await navigator.storage.persisted()) return;
    const granted = await navigator.storage.persist();
    console.log(
      granted
        ? 'Local storage is persistent.'
        : 'Local storage is best-effort; the browser may evict it under storage pressure.',
    );
  } catch {
    // Not supported - nothing to do.
  }
}
