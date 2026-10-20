// Dedicated durable store. Never mixes shift drafts/media with task or authentication state.
export function deviceTransaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, done: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('quest-shift-activity-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('entries');
    request.onerror = () => reject(request.error ?? new Error('Device storage is unavailable.'));
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('entries', mode); let value: T;
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Device save failed. Keep this page open and retry.')); };
      try { work(tx.objectStore('entries'), result => { value = result; }, error => { tx.abort(); reject(error); }); } catch (error) { tx.abort(); reject(error); }
    };
  });
}
export const deviceKey = (org: string, actor: string, key: string) => JSON.stringify([org, actor, key]);
export const deviceGet = <T>(key: string) => deviceTransaction<T | null>('readonly', (store, done) => { const r = store.get(key); r.onsuccess = () => done((r.result as T | undefined) ?? null); });
export const devicePut = (key: string, value: unknown) => deviceTransaction<void>('readwrite', (store, done) => { store.put(value, key); done(); });
export const deviceRemove = (key: string) => deviceTransaction<void>('readwrite', (store, done) => { store.delete(key); done(); });
