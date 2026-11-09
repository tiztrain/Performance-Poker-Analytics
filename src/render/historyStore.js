// ---------- Saved history in IndexedDB ----------
// IndexedDB is a database built into the browser. It holds far more than localStorage and keeps
// data on this device only. One record per hand: { id, raw } keyed by hand ID, so saving the same
// hand twice just overwrites it. If IndexedDB can't be opened (some private-browsing modes), the
// store falls back to memory and hands last only for this visit.

const DB_NAME = 'pokerHandReview';
const STORE = 'hands';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function createHistoryStore() {
  let dbPromise = openDb().catch(() => null);
  const memory = new Map();

  return {
    async all() {
      const db = await dbPromise;
      if (!db) return [...memory.values()];
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      await done(tx);
      return req.result;
    },
    async ids() {
      return (await this.all()).map(r => r.id);
    },
    async putMany(records) {
      const db = await dbPromise;
      if (!db) {
        records.forEach(r => memory.set(r.id, r));
        return;
      }
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      records.forEach(r => os.put(r));
      await done(tx);
    },
    async clear() {
      memory.clear();
      const db = await dbPromise;
      if (!db) return;
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await done(tx);
    },
    async persistent() {
      return !!(await dbPromise);
    },
  };
}
