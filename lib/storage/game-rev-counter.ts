/**
 * The last game `rev` written under the cross-tab lock, per storage space, in IndexedDB (lib/game-store.ts). IndexedDB
 * transactions are seen by every tab at once, unlike localStorage, which tabs receive asynchronously.
 */
import type { GameStoreDeps, Revisioned } from "../game-store";

const IDB_NAME = "ayra_game_sync";
const IDB_STORE = "rev";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The last rev written under the lock, per space (IndexedDB), or undefined when IndexedDB is not available. */
export function browserRevCounter(spaceId: string): GameStoreDeps<Revisioned>["counter"] {
  if (typeof indexedDB === "undefined") return undefined;
  let db: Promise<IDBDatabase> | null = null;
  const tx = <T,>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) => {
    db = db ?? openDb();
    return db.then(
      (d) =>
        new Promise<T>((resolve, reject) => {
          const t = d.transaction(IDB_STORE, mode);
          const req = run(t.objectStore(IDB_STORE));
          t.oncomplete = () => resolve(req.result);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        })
    );
  };
  return {
    get: async () => {
      const v = await tx<unknown>("readonly", (s) => s.get(spaceId));
      return typeof v === "number" ? v : null;
    },
    put: async (rev: number) => {
      // never move the counter back (a slower write without the lock may come later)
      await tx<IDBValidKey>("readwrite", (s) => {
        const req = s.get(spaceId);
        req.onsuccess = () => {
          const cur = typeof req.result === "number" ? req.result : 0;
          if (rev > cur) s.put(rev, spaceId);
        };
        return req as unknown as IDBRequest<IDBValidKey>;
      });
    },
    reset: async (rev: number) => {
      await tx<IDBValidKey>("readwrite", (s) => s.put(rev, spaceId));
    },
  };
}
