// IndexedDB local offline store & sync queue for True Offline Mode

export type OfflineRecord = {
  id: string;
  collection: string; // e.g. "inventory", "finance", "customers", "crm", "tasks"
  data: unknown;
  updatedAt: number;
};

export type OfflineMutation = {
  id: string;
  type: string; // e.g. "inventory.product.create", "finance.invoice.create"
  payload: unknown;
  createdAt: number;
  status: "pending" | "syncing" | "failed";
  retryCount: number;
  error?: string;
};

const DB_NAME = "anops_offline_db";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      return reject(new Error("IndexedDB is not available"));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("records")) {
        const recordStore = db.createObjectStore("records", { keyPath: "id" });
        recordStore.createIndex("collection", "collection", { unique: false });
      }
      if (!db.objectStoreNames.contains("mutations")) {
        const mutationStore = db.createObjectStore("mutations", { keyPath: "id" });
        mutationStore.createIndex("status", "status", { unique: false });
        mutationStore.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Cache a record locally for offline lookup */
export async function saveOfflineRecord(collection: string, id: string, data: unknown): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction("records", "readwrite");
    const store = tx.objectStore("records");
    store.put({ id: `${collection}:${id}`, collection, data, updatedAt: Date.now() });
  } catch (e) {
    console.warn("[offlineStore] saveOfflineRecord error:", e);
  }
}

/** Get all records belonging to a collection */
export async function getOfflineRecords<T = unknown>(collection: string): Promise<T[]> {
  try {
    const db = await openDB();
    const tx = db.transaction("records", "readonly");
    const store = tx.objectStore("records");
    const index = store.index("collection");
    return new Promise((resolve) => {
      const request = index.getAll(collection);
      request.onsuccess = () => resolve(request.result.map((r: OfflineRecord) => r.data as T));
      request.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/** Queue a mutation to be performed when online */
export async function queueOfflineMutation(type: string, payload: unknown): Promise<OfflineMutation> {
  const db = await openDB();
  const tx = db.transaction("mutations", "readwrite");
  const store = tx.objectStore("mutations");
  const mutation: OfflineMutation = {
    id: `mut_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    type,
    payload,
    createdAt: Date.now(),
    status: "pending",
    retryCount: 0,
  };
  return new Promise((resolve, reject) => {
    const req = store.add(mutation);
    req.onsuccess = () => {
      // notify listeners that mutation queue changed
      window.dispatchEvent(new CustomEvent("anops:offline-mutations-updated"));
      resolve(mutation);
    };
    req.onerror = () => reject(req.error);
  });
}

/** List all pending mutations */
export async function getPendingMutations(): Promise<OfflineMutation[]> {
  try {
    const db = await openDB();
    const tx = db.transaction("mutations", "readonly");
    const store = tx.objectStore("mutations");
    return new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/** Delete or complete a mutation */
export async function removeOfflineMutation(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction("mutations", "readwrite");
    const store = tx.objectStore("mutations");
    store.delete(id);
    window.dispatchEvent(new CustomEvent("anops:offline-mutations-updated"));
  } catch (e) {
    console.warn("[offlineStore] removeOfflineMutation error:", e);
  }
}

/** Clear all synchronized mutations */
export async function clearAllCompletedMutations(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction("mutations", "readwrite");
    tx.objectStore("mutations").clear();
    window.dispatchEvent(new CustomEvent("anops:offline-mutations-updated"));
  } catch {}
}
