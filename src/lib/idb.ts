import type { RecordingMeta } from '../types';

const DB_NAME = 'english-record';
const DB_VERSION = 1;
const META_STORE = 'recordings';
const AUDIO_STORE = 'audio';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(AUDIO_STORE)) {
        db.createObjectStore(AUDIO_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir IndexedDB'));
  });
  return dbPromise;
}

function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        let request: IDBRequest<T> | void;
        try {
          request = run(tx);
        } catch (error) {
          reject(error);
          return;
        }
        tx.oncomplete = () => resolve((request as IDBRequest<T> | undefined)?.result as T);
        tx.onerror = () => reject(tx.error ?? new Error('Error de IndexedDB'));
        tx.onabort = () => reject(tx.error ?? new Error('Transacción cancelada'));
      }),
  );
}

export function saveRecording(meta: RecordingMeta, audio?: Blob): Promise<void> {
  return transaction<void>([META_STORE, AUDIO_STORE], 'readwrite', (tx) => {
    tx.objectStore(META_STORE).put(meta);
    if (audio) tx.objectStore(AUDIO_STORE).put(audio, meta.id);
  });
}

export function saveMeta(meta: RecordingMeta): Promise<void> {
  return transaction<void>([META_STORE], 'readwrite', (tx) => {
    tx.objectStore(META_STORE).put(meta);
  });
}

export function getMeta(id: string): Promise<RecordingMeta | undefined> {
  return transaction<RecordingMeta | undefined>([META_STORE], 'readonly', (tx) =>
    tx.objectStore(META_STORE).get(id),
  );
}

export function getAudio(id: string): Promise<Blob | undefined> {
  return transaction<Blob | undefined>([AUDIO_STORE], 'readonly', (tx) =>
    tx.objectStore(AUDIO_STORE).get(id),
  );
}

export function listRecordings(): Promise<RecordingMeta[]> {
  return transaction<RecordingMeta[]>([META_STORE], 'readonly', (tx) =>
    tx.objectStore(META_STORE).getAll(),
  ).then((items) => items.sort((a, b) => b.createdAt - a.createdAt));
}

export function deleteRecording(id: string): Promise<void> {
  return transaction<void>([META_STORE, AUDIO_STORE], 'readwrite', (tx) => {
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(AUDIO_STORE).delete(id);
  });
}

export async function storageUsage(): Promise<{ usage: number; quota: number }> {
  if (!navigator.storage?.estimate) return { usage: 0, quota: 0 };
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
}

export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
