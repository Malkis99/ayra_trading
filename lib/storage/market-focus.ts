import { validateUserId } from "@/lib/storage";
import { clearedFocus, FocusDataError, migrateFocusV1, parseFocus, patchFocus, type FocusEntry, type FocusPatch } from "@/lib/market/market-focus";
import type { InstrumentId } from "@/lib/market/instruments";
import { alertsOf, claimAlert, recordCompletion, type FocusAlert } from "@/lib/market/focus-notifications";
import type { SessionSettings } from "@/lib/market/sessions";

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
      const request = indexedDB.open(this.name, 2);
      const fail = () => { done = true; reject(new FocusDataError("storage")); };
      request.onupgradeneeded = event => {
        const db = request.result, tx = request.transaction!;
        if ((event as IDBVersionChangeEvent).oldVersion === 0) {
          db.createObjectStore("entries", { keyPath: ["spaceId", "instrumentId"] });
          db.createObjectStore("preferences", { keyPath: "spaceId" });
        }
        db.createObjectStore("spaces", { keyPath: "spaceId" });
        if ((event as IDBVersionChangeEvent).oldVersion === 1) {
          const cursor = tx.objectStore("entries").openCursor();
          cursor.onsuccess = () => {
            const row = cursor.result; if (!row) return;
            try { const migrated = migrateFocusV1(row.value); if (migrated !== row.value) row.update(migrated); row.continue(); }
            catch { tx.abort(); }
          };
        }
      };
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); if (done) request.result.close(); else resolve(request.result); };
      request.onerror = request.onblocked = fail;
    });
  }
  private async transaction<T>(space: string, storeName: "entries" | "preferences" | "spaces", key: IDBValidKey, write: boolean,
    apply: (raw: unknown, store: IDBObjectStore) => T, epoch?: number): Promise<T> {
    validateSpace(space);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      let value: T, failure: unknown;
      let tx: IDBTransaction;
      try { tx = db.transaction(epoch === undefined ? storeName : [storeName, "spaces"], write ? "readwrite" : "readonly"); }
      catch (error) { db.close(); reject(error); return; }
      const store = tx.objectStore(storeName);
      const load = () => {
        const request = store.get(key);
        request.onsuccess = () => { try { value = apply(request.result, store); } catch (e) { failure = e; tx.abort(); } };
      };
      if (epoch === undefined) load();
      else {
        const guard = tx.objectStore("spaces").get(space);
        guard.onsuccess = () => { try { if (this.control(guard.result, space) !== epoch) throw new FocusDataError("cleared"); load(); } catch (e) { failure = e; tx.abort(); } };
      }
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onabort = tx.onerror = () => { db.close(); reject(failure ?? new FocusDataError("storage")); };
    });
  }
  private control(raw: unknown, space: string): number {
    if (raw === undefined) return 0;
    if (!raw || typeof raw !== "object" || !("spaceId" in raw) || raw.spaceId !== space || !("epoch" in raw) || !Number.isSafeInteger(raw.epoch) || Number(raw.epoch) < 0) throw new FocusDataError("invalid");
    return Number(raw.epoch);
  }
  epoch(space: string) { return this.transaction(space, "spaces", space, false, raw => this.control(raw, space)); }
  read(space: string, id: InstrumentId, epoch?: number) { return this.transaction(space, "entries", [space, id], false, raw => parseFocus(raw, space, id), epoch); }
  private async change(space: string, id: InstrumentId, change: (entry: FocusEntry) => { entry: FocusEntry; write: boolean }, epoch?: number) {
    const ticket = epoch ?? await this.epoch(space);
    const result = await this.transaction(space, "entries", [space, id], true, (raw, store) => {
      const entry = parseFocus(raw, space, id), result = change(entry);
      if (result.write) {
        if (entry.revision + 1 >= Number.MAX_SAFE_INTEGER) throw new FocusDataError("invalid");
        result.entry = { ...result.entry, revision: entry.revision + 1 };
        store.put(result.entry);
      }
      return result;
    }, ticket);
    if (result.write) notify({ spaceId: space, instrumentId: id });
    return result;
  }
  async patch(space: string, id: InstrumentId, patch: FocusPatch, epoch?: number) {
    return (await this.change(space, id, entry => ({ entry: recordCompletion(entry, patchFocus(entry, patch), patch, Date.now()), write: true }), epoch)).entry;
  }
  async configureAlerts(space: string, id: InstrumentId, revision: number, values: { completion: boolean; session: boolean; lead: number; reminder: number | null }, epoch: number) {
    return (await this.change(space, id, entry => {
      const a = alertsOf(entry);
      if (a.revision !== revision) throw new FocusDataError("conflict");
      if (typeof values.completion !== "boolean" || typeof values.session !== "boolean" || ![0, 5, 15].includes(values.lead)
        || !(values.reminder === null || Number.isSafeInteger(values.reminder) && values.reminder > Date.now())) throw new FocusDataError("invalid");
      if (!Number.isSafeInteger(a.revision + 1)) throw new FocusDataError("invalid");
      return { entry: { ...entry, localAlerts: { ...a, ...values, revision: a.revision + 1, enabledAt: Date.now(), completionEvent: null } }, write: true };
    }, epoch)).entry;
  }
  async claimAlert(space: string, id: InstrumentId, alert: FocusAlert, epoch: number, hours?: SessionSettings) {
    return (await this.change(space, id, entry => {
      const next = claimAlert(entry, alert, Date.now(), hours);
      return { entry: next ?? entry, write: next !== null };
    }, epoch)).write;
  }
  async reset(space: string, id: InstrumentId, revision: number, epoch?: number) {
    const result = await this.change(space, id, entry => entry.revision === revision ? { entry: clearedFocus(entry), write: true } : { entry, write: false }, epoch);
    return { kind: result.write ? "saved" as const : "conflict" as const, entry: result.entry };
  }
  private preference(raw: unknown, space: string): string | null {
    if (raw === undefined) return null;
    if (raw && typeof raw === "object" && "version" in raw && typeof raw.version === "number" && raw.version > 1) throw new FocusDataError("unsupported");
    if (!raw || typeof raw !== "object" || !("version" in raw) || raw.version !== 1 || !("spaceId" in raw) || raw.spaceId !== space || !("selectedInstrumentId" in raw) || typeof raw.selectedInstrumentId !== "string") throw new FocusDataError("invalid");
    return raw.selectedInstrumentId;
  }
  selection(space: string) { return this.transaction(space, "preferences", space, false, raw => this.preference(raw, space)); }
  async select(space: string, id: InstrumentId, epoch?: number) {
    const ticket = epoch ?? await this.epoch(space);
    await this.transaction(space, "preferences", space, true, (raw, store) => {
      this.preference(raw, space);
      store.put({ ...(raw as object | undefined), version: 1, spaceId: space, selectedInstrumentId: id });
    }, ticket);
  }
  /** A read-only probe never creates an empty database just to export/clear a profile. */
  private existing(): Promise<IDBDatabase | null> {
    return new Promise((resolve, reject) => {
      let absent = false, blocked = false;
      const request = indexedDB.open(this.name);
      request.onupgradeneeded = () => { absent = true; request.transaction!.abort(); };
      request.onerror = () => absent ? resolve(null) : reject(new FocusDataError("storage"));
      request.onblocked = () => { blocked = true; reject(new FocusDataError("storage")); };
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); if (blocked) db.close(); else if (db.version > 2) { db.close(); reject(new FocusDataError("unsupported")); } else resolve(db); };
    });
  }
  async exportSpace(space: string): Promise<FocusSnapshot> {
    validateSpace(space); const db = await this.existing();
    if (!db) return { databaseVersion: 2, entries: [], preferences: null };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["entries", "preferences"], "readonly"), rows: unknown[] = [];
      const cursor = tx.objectStore("entries").openCursor(), pref = tx.objectStore("preferences").get(space);
      cursor.onsuccess = () => { const row = cursor.result; if (!row) return; if (Array.isArray(row.key) && row.key[0] === space) rows.push(row.value); row.continue(); };
      tx.oncomplete = () => { const snapshot = { databaseVersion: db.version, entries: rows, preferences: pref.result ?? null }; db.close(); resolve(snapshot); };
      tx.onerror = tx.onabort = () => { db.close(); reject(new FocusDataError("storage")); };
    });
  }
  async clearSpace(space: string) {
    validateSpace(space); const probe = await this.existing(); if (!probe) return; probe.close();
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["entries", "preferences", "spaces"], "readwrite");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = tx.onabort = () => { db.close(); reject(new FocusDataError("storage")); };
      try {
        const control = tx.objectStore("spaces").get(space);
        control.onsuccess = () => { try { const epoch = this.control(control.result, space) + 1; if (!Number.isSafeInteger(epoch)) throw new FocusDataError("invalid"); tx.objectStore("spaces").put({ spaceId: space, epoch }); } catch { tx.abort(); } };
        const cursor = tx.objectStore("entries").openCursor();
        cursor.onsuccess = () => { const row = cursor.result; if (!row) return; try { if (Array.isArray(row.key) && row.key[0] === space) row.delete(); row.continue(); } catch { tx.abort(); } };
        tx.objectStore("preferences").delete(space);
      } catch { tx.abort(); }
    });
    notify({ spaceId: space, instrumentId: null });
  }
}
export interface FocusSnapshot { databaseVersion: number; entries: unknown[]; preferences: unknown }
export const focusStorage = new FocusStorage();
