// Private media store for review captures (screenshots, recordings).
// Media never goes into Quest task data or chrome.storage; only an id and
// metadata do. Today the bytes live in this browser profile's IndexedDB.
// A Quest-owned backend would add a server-side implementation with
// access-controlled private storage behind the same interface.

export interface MediaStore {
  /** 'device' = this browser profile only; 'private-server' = future authenticated storage. */
  readonly location: 'device' | 'private-server';
  put(blob: Blob): Promise<string>;
  get(id: string): Promise<Blob | null>;
  remove(id: string): Promise<void>;
}

const DB = 'quest-review-media';
const STORE = 'blobs';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Private media storage is unavailable in this browser.'));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Media storage failed.')); };
  }));
}

let counter = 0;
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `media-${Date.now()}-${++counter}`);

export const deviceMediaStore: MediaStore = {
  location: 'device',
  async put(blob) { const id = newId(); await run('readwrite', store => store.put(blob, id)); return id; },
  async get(id) { return ((await run('readonly', store => store.get(id))) as Blob | undefined) ?? null; },
  async remove(id) { await run('readwrite', store => store.delete(id)); },
};

/** In-memory store for tests and environments without IndexedDB. */
export function memoryMediaStore(): MediaStore {
  const blobs = new Map<string, Blob>();
  return {
    location: 'device',
    async put(blob) { const id = newId(); blobs.set(id, blob); return id; },
    async get(id) { return blobs.get(id) ?? null; },
    async remove(id) { blobs.delete(id); },
  };
}
