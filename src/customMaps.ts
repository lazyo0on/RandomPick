/**
 * Maps the user builds in the editor, kept in this browser only.
 *
 * A stored record is a StageDef plus an id and a timestamp, so maps can be
 * listed newest-first and updated in place when re-saved from the editor.
 */

import { MAP_STORE, openDb, requestPersistentStorage, withStore } from './db';
import { StageDef } from './data/maps';

export type CustomMap = StageDef & {
  id: string;
  updatedAt: number;
};

function newId(): string {
  return `map_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Strips anything that is not part of a StageDef before storing. */
function toRecord(stage: StageDef, id: string): CustomMap {
  return {
    id,
    updatedAt: Date.now(),
    title: stage.title,
    goalY: stage.goalY,
    zoomY: stage.zoomY,
    entities: JSON.parse(JSON.stringify(stage.entities ?? [])),
  };
}

export async function getCustomMaps(): Promise<CustomMap[]> {
  const db = await openDb();
  if (!db) return [];

  return new Promise((resolve) => {
    const out: CustomMap[] = [];
    let request: IDBRequest<IDBCursorWithValue | null>;
    try {
      request = db
        .transaction(MAP_STORE, 'readonly')
        .objectStore(MAP_STORE)
        .openCursor();
    } catch {
      resolve(out);
      return;
    }

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const value = cursor.value as CustomMap;
        if (value && Array.isArray(value.entities)) out.push(value);
        cursor.continue();
      } else {
        out.sort((a, b) => a.updatedAt - b.updatedAt);
        resolve(out);
      }
    };
    request.onerror = () => resolve(out);
  });
}

/**
 * Creates or replaces a stored map.
 * Pass an existing id to overwrite that map instead of adding another.
 */
export async function saveCustomMap(
  stage: StageDef,
  id?: string,
): Promise<CustomMap> {
  const record = toRecord(stage, id || newId());
  await withStore(MAP_STORE, 'readwrite', (store) => store.put(record));
  void requestPersistentStorage();
  return record;
}

export async function deleteCustomMap(id: string): Promise<void> {
  await withStore(MAP_STORE, 'readwrite', (store) => store.delete(id));
}
