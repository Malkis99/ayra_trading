import { AppStorage, buildKey, validateUserId } from "@/lib/storage";
import { emptyPriorityAccount, type PriorityAccount, type PriorityStore } from "@/lib/market/priority-queue";
import { validPriorityOperation } from "@/lib/market/watchlist-meta";

export const PRIORITY_EVENT = "ayra-priority-change";
export const PRIORITY_SIGNAL = "ayra_market_priority_signal";
const DATABASE = "ayra_watchlist_priorities_v1";
/** One IndexedDB read/write transaction per account record: no lost queue updates between tabs. Guests never open it. */
export class BrowserPriorityStore implements PriorityStore {
  private database() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("accounts");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("priority_storage_unavailable"));
      request.onblocked = () => reject(new Error("priority_storage_blocked"));
    });
  }
  private async transaction(userId: string, change?: (current: PriorityAccount) => PriorityAccount): Promise<PriorityAccount> {
    validateUserId(userId);
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("accounts", change ? "readwrite" : "readonly"), store = transaction.objectStore("accounts");
      let result: PriorityAccount, changed = false;
      const request = store.get(userId);
      request.onsuccess = () => {
        try {
          const current = request.result === undefined ? emptyPriorityAccount() : request.result as PriorityAccount;
          if (current.version !== 1 || !Array.isArray(current.queue) || !current.queue.every(q => validPriorityOperation(q.operation) && q.operation.userId === userId && ["pending", "conflict", "error"].includes(q.status))) throw new Error("priority_storage_unsupported");
          result = change ? change(current) : current;
          changed = JSON.stringify(result) !== JSON.stringify(current);
          if (changed) store.put(result, userId);
        } catch { transaction.abort(); }
      };
      transaction.oncomplete = () => {
        db.close();
        if (changed && typeof window !== "undefined") {
          AppStorage.setItem(PRIORITY_SIGNAL, crypto.randomUUID(), userId);
          window.dispatchEvent(new CustomEvent(PRIORITY_EVENT, { detail: { userId } }));
        }
        resolve(result);
      };
      transaction.onabort = transaction.onerror = () => { db.close(); reject(new Error("priority_storage_failed")); };
    });
  }
  read(userId: string) { return this.transaction(userId); }
  update(userId: string, change: (current: PriorityAccount) => PriorityAccount) { return this.transaction(userId, change); }
}
export const prioritySignalKey = (userId: string) => buildKey({ isGuest: false, userId }, PRIORITY_SIGNAL);
