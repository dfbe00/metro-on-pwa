// db.js — Motor Offline-First con IndexedDB para Metro-ON PWA
const DB_NAME = "metro_on_offline_db";
const DB_VERSION = 1;

export const STORES = {
  KV: "kv",
  ASSETS: "assets",
  INVENTORY: "inventory",
  REPORTS: "reports",
  COMMENTS: "comments",
  INTERVENTIONS: "interventions",
  QUEUE: "offline_queue"
};

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORES.KV)) {
        db.createObjectStore(STORES.KV, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORES.ASSETS)) {
        db.createObjectStore(STORES.ASSETS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.INVENTORY)) {
        db.createObjectStore(STORES.INVENTORY, { keyPath: "part_code" });
      }
      if (!db.objectStoreNames.contains(STORES.REPORTS)) {
        db.createObjectStore(STORES.REPORTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.COMMENTS)) {
        db.createObjectStore(STORES.COMMENTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.INTERVENTIONS)) {
        db.createObjectStore(STORES.INTERVENTIONS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.QUEUE)) {
        db.createObjectStore(STORES.QUEUE, { keyPath: "qid", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function cacheCollection(storeName, items) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.clear();
    for (const item of items || []) {
      store.put(item);
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedCollection(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueOfflineReport(payload) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.QUEUE, "readwrite");
    const store = tx.objectStore(STORES.QUEUE);
    const record = {
      ...payload,
      queuedAt: new Date().toISOString()
    };
    const req = store.add(record);
    req.onsuccess = () => resolve({ ...record, qid: req.result });
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOfflineQueue() {
  return getCachedCollection(STORES.QUEUE);
}

export async function removeOfflineQueueItem(qid) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.QUEUE, "readwrite");
    tx.objectStore(STORES.QUEUE).delete(qid);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveDraftLocal(draft) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.KV, "readwrite");
    tx.objectStore(STORES.KV).put({
      key: "active_draft",
      value: draft,
      updatedAt: new Date().toISOString()
    });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getDraftLocal() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.KV, "readonly");
    const req = tx.objectStore(STORES.KV).get("active_draft");
    req.onsuccess = () => resolve(req.result?.value || null);
    req.onerror = () => reject(req.error);
  });
}

export async function setKV(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.KV, "readwrite");
    tx.objectStore(STORES.KV).put({ key, value, updatedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getKV(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.KV, "readonly");
    const req = tx.objectStore(STORES.KV).get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}
