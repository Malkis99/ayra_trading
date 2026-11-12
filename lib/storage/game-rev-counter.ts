/**
 * The latest commit of the game state per storage space, in IndexedDB (lib/game-store.ts). IndexedDB transactions are
 * seen by every tab at once, unlike localStorage, which tabs receive asynchronously — so a lock holder knows which
 * commit the saved value must show before it may change it.
 */
import { withCommit, type CommitLog, type GameStoreDeps, type Revisioned } from "../game-store";

const IDB_NAME = "ayra_game_sync";
const IDB_STORE = "commits";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains("rev")) db.deleteObjectStore("rev"); // the first draft of this store kept a bare number
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function asLog(v: unknown): CommitLog | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<CommitLog>;
  if (typeof o.rev !== "number" || typeof o.id !== "string") return null;
  return { rev: o.rev, id: o.id };
}

/** The commit log of one space, or undefined when IndexedDB is not available. */
export function browserCommitLog(spaceId: string): GameStoreDeps<Revisioned>["commits"] {
  if (typeof indexedDB === "undefined") return undefined;
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db = db ?? openDb();
    return db;
  };
  return {
    get: async () => {
      const d = await open();
      return new Promise<CommitLog | null>((resolve, reject) => {
        const t = d.transaction(IDB_STORE, "readonly");
        const req = t.objectStore(IDB_STORE).get(spaceId);
        t.oncomplete = () => resolve(asLog(req.result));
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    },
    // read and write in one transaction: two tabs recording at once cannot drop each other's commit
    record: async (rev: number, id: string) => {
      const d = await open();
      await new Promise<void>((resolve, reject) => {
        const t = d.transaction(IDB_STORE, "readwrite");
        const store = t.objectStore(IDB_STORE);
        const req = store.get(spaceId);
        req.onsuccess = () => {
          store.put(withCommit(asLog(req.result), rev, id), spaceId);
        };
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    },
  };
}
