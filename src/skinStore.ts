/**
 * Local-only storage for custom marble skins.
 *
 * Images live in this browser's IndexedDB and are never sent anywhere.
 * Every uploaded file is center-cropped to a square and downscaled to
 * SKIN_SIZE px before being stored, so the database stays small.
 */

import { openDb, requestPersistentStorage, SKIN_STORE, withStore } from './db';

export const SKIN_SIZE = 256;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function imageSize(source: ImageBitmap | HTMLImageElement) {
  return source instanceof ImageBitmap
    ? { w: source.width, h: source.height }
    : { w: source.naturalWidth, h: source.naturalHeight };
}

/**
 * Turns an arbitrary user file into a small square PNG blob.
 * Throws when the file is not a usable image.
 */
export async function normalizeSkinFile(file: File): Promise<Blob> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('FILE_TOO_LARGE');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('NOT_AN_IMAGE');
  }

  const { w, h } = imageSize(bitmap);
  const side = Math.min(w, h);
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = SKIN_SIZE;
  canvas.height = SKIN_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('NO_CANVAS');
  }

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SKIN_SIZE, SKIN_SIZE);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('ENCODE_FAILED'));
    }, 'image/png');
  });
}

export async function getAllSkins(): Promise<{ [name: string]: Blob }> {
  const db = await openDb();
  if (!db) return {};

  return new Promise((resolve) => {
    const result: { [name: string]: Blob } = {};
    let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
    try {
      cursorRequest = db
        .transaction(SKIN_STORE, 'readonly')
        .objectStore(SKIN_STORE)
        .openCursor();
    } catch {
      resolve(result);
      return;
    }

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        if (typeof cursor.key === 'string' && cursor.value instanceof Blob) {
          result[cursor.key] = cursor.value;
        }
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    cursorRequest.onerror = () => resolve(result);
  });
}

export async function putSkin(name: string, blob: Blob): Promise<void> {
  await withStore(SKIN_STORE, 'readwrite', (store) => store.put(blob, name));
  void requestPersistentStorage();
}

export async function deleteSkin(name: string): Promise<void> {
  await withStore(SKIN_STORE, 'readwrite', (store) => store.delete(name));
}

export async function clearSkins(): Promise<void> {
  await withStore(SKIN_STORE, 'readwrite', (store) => store.clear());
}
