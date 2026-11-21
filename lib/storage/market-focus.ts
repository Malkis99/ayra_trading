import { validateUserId } from "@/lib/storage";
import { clearedFocus, FocusDataError, parseFocus, patchFocus, type FocusEntry, type FocusPatch } from "@/lib/market/market-focus";
import type { InstrumentId } from "@/lib/market/instruments";

export const FOCUS_DATABASE = "ayra_market_focus_v1";
const EVENT = "ayra-market-focus-change", CHANNEL = "ayra-market-focus-local";
export type FocusNotice = { spaceId: string; instrumentId: string | null };
function validateSpace(space: string) {
  if (space === "guest") return;
  if (!space.startsWith("account:")) throw new FocusDataError("invalid");
  validateUserId(space.slice(8));
}
function notify(detail: FocusNotice) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail }));
  try { const channel = new BroadcastChannel(CHANNEL); channel.postMessage(detail); channel.close(); } catch { /* focus/visibility refresh remains available */ }
}
export function subscribeFocus(listener: (notice: FocusNotice) => void) {
  const received = (detail: FocusNotice) => { if (detail && typeof detail.spaceId === "string" && (typeof detail.instrumentId === "string" || detail.instrumentId === null)) listener(detail); };
  const local = (event: Event) => received((event as CustomEvent<FocusNotice>).detail);
  window.addEventListener(EVENT, local);
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = event => received(event.data); } catch { /* no polling */ }
  return () => { window.removeEventListener(EVENT, local); channel?.close(); };
}
/** Separate local database. No Market cloud events, REST, metadata outbox, or production schema. */
export class FocusStorage {
  constructor(private name = FOCUS_DATABASE) {}
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let done = false;
      const request = indexedDB.open(this.name, 1);
      const fail = () => { done = true; reject(new FocusDataError("storage")); };
      request.onupgradeneeded = () => {
        request.result.createObjectStore("entries", { keyPath: ["spaceId", "instrumentId"] });
        request.result.createObjectStore("preferences", { keyPath: "spaceId" });
      };
      request.onsuccess = () => { if (done) request.result.close(); else resolve(request.result); };
      request.onerror = request.onblocked = fail;
    });
  }
  private async transaction<T>(space: string, storeName: "entries" | "preferences", key: IDBValidKey, write: boolean,
    apply: (raw: unknown, store: IDBObjectStore) => T): Promise<T> {
    validateSpace(space);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      let value: T, failure: unknown;
      let tx: IDBTransaction;
      try { tx = db.transaction(storeName, write ? "readwrite" : "readonly"); }
      catch (error) { db.close(); reject(error); return; }
      const store = tx.objectStore(storeName), request = store.get(key);
      request.onsuccess = () => { try { value = apply(request.result, store); } catch (e) { failure = e; tx.abort(); } };
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onabort = tx.onerror = () => { db.close(); reject(failure ?? new FocusDataError("storage")); };
    });
  }
  read(space: string, id: InstrumentId) { return this.transaction(space, "entries", [space, id], false, raw => parseFocus(raw, space, id)); }
  private async change(space: string, id: InstrumentId, change: (entry: FocusEntry) => { entry: FocusEntry; write: boolean }) {
    const result = await this.transaction(space, "entries", [space, id], true, (raw, store) => {
      const entry = parseFocus(raw, space, id), result = change(entry);
      if (result.write) {
        if (entry.revision >= Number.MAX_SAFE_INTEGER) throw new FocusDataError("invalid");
        result.entry = { ...result.entry, revision: entry.revision + 1 };
        store.put(result.entry);
      }
      return result;
    });
    if (result.write) notify({ spaceId: space, instrumentId: id });
    return result;
  }
  async patch(space: string, id: InstrumentId, patch: FocusPatch) {
    return (await this.change(space, id, entry => ({ entry: patchFocus(entry, patch), write: true }))).entry;
  }
  async reset(space: string, id: InstrumentId, revision: number) {
    const result = await this.change(space, id, entry => entry.revision === revision ? { entry: clearedFocus(entry), write: true } : { entry, write: false });
    return { kind: result.write ? "saved" as const : "conflict" as const, entry: result.entry };
  }
  private preference(raw: unknown, space: string): string | null {
    if (raw === undefined) return null;
    if (raw && typeof raw === "object" && "version" in raw && typeof raw.version === "number" && raw.version > 1) throw new FocusDataError("unsupported");
    if (!raw || typeof raw !== "object" || !("version" in raw) || raw.version !== 1 || !("spaceId" in raw) || raw.spaceId !== space || !("selectedInstrumentId" in raw) || typeof raw.selectedInstrumentId !== "string") throw new FocusDataError("invalid");
    return raw.selectedInstrumentId;
  }
  selection(space: string) { return this.transaction(space, "preferences", space, false, raw => this.preference(raw, space)); }
  async select(space: string, id: InstrumentId) {
    await this.transaction(space, "preferences", space, true, (raw, store) => {
      this.preference(raw, space);
      store.put({ ...(raw as object | undefined), version: 1, spaceId: space, selectedInstrumentId: id });
    });
  }
}
export const focusStorage = new FocusStorage();
