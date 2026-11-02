"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppStorage } from "@/lib/storage";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isE2EMockEnabled } from "@/lib/supabase/config";
import { mergeMarket, type MarketCloudRow, type MarketLocal } from "./cloud-sync";
import { normalizeChartPrefs, normalizeWatchlist } from "./watchlist";
import { normalizeChartView, normalizeNotes } from "./chart-workspace";
import {
  MARKET_CHART_KEY,
  MARKET_CHART_VIEW_KEY,
  MARKET_NOTES_KEY,
  MARKET_STORE_EVENT,
  MARKET_WATCHLIST_KEY,
  readMarketKey,
  writeMarketKey,
  type MarketStoreChange,
} from "./watchlist-store";

/** The account's Market rows (migration 0008). */
export const MARKET_TABLE = "market_user_data";
/** Set after the first join of this device's Watchlist with the account's (per account space). */
export const MARKET_CLOUD_JOINED_KEY = "ayra_market_cloud_joined";

/** Wait after the last change before sending (several quick edits = one request), as the journal (1 s). */
export const MARKET_SYNC_DEBOUNCE_MS = 1500;
/** Background pull of other devices' changes, as the journal (5 min). */
export const MARKET_SYNC_PULL_MS = 5 * 60 * 1000;

export interface MarketCloudRemote {
  currentUserId(): Promise<string | null>;
  /** user_features.cloud_sync (0004): the same switch as the journal's. */
  isSyncEnabled(userId: string): Promise<boolean>;
  fetchAll(): Promise<MarketCloudRow[]>;
  upsert(rows: MarketCloudRow[]): Promise<void>;
}

export class SupabaseMarketRemote implements MarketCloudRemote {
  constructor(private readonly getClient: () => SupabaseClient | null) {}
  private client(): SupabaseClient {
    const c = this.getClient();
    if (!c) throw new Error("Supabase is not configured");
    return c;
  }
  async currentUserId() {
    const c = this.getClient();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    return data.session?.user?.id ?? null;
  }
  async isSyncEnabled(userId: string) {
    const { data, error } = await this.client().from("user_features").select("cloud_sync").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { cloud_sync?: boolean } | null)?.cloud_sync === true;
  }
  async fetchAll() {
    // a handful of rows per account (Watchlist, view, up to one note per instrument)
    const { data, error } = await this.client().from(MARKET_TABLE).select("id, data").order("id").range(0, 499);
    if (error) throw new Error(error.message);
    return (data || []) as MarketCloudRow[];
  }
  async upsert(rows: MarketCloudRow[]) {
    if (!rows.length) return;
    // only id, data and device_id: user_id comes from the session, the rest is filled by the server (0008 trigger)
    const { error } = await this.client()
      .from(MARKET_TABLE)
      .upsert(rows.map((r) => ({ id: r.id, data: r.data, device_id: null })), { onConflict: "user_id,id" });
    if (error) throw new Error(error.message);
  }
}

/** The device side: what is read, written (marked as coming from the cloud) and whether the first join happened. */
export interface MarketLocalStore {
  userId(): string | null;
  read(): MarketLocal;
  write(next: MarketLocal, changed: { watchlist: boolean; view: boolean; notes: boolean; prefs: boolean }): void;
  joined(): boolean;
  markJoined(): void;
}

export const appMarketStore: MarketLocalStore = {
  userId: () => AppStorage.getUserId(),
  read: () => ({
    watchlist: readMarketKey(MARKET_WATCHLIST_KEY, normalizeWatchlist),
    view: readMarketKey(MARKET_CHART_VIEW_KEY, normalizeChartView),
    notes: readMarketKey(MARKET_NOTES_KEY, normalizeNotes),
    prefs: readMarketKey(MARKET_CHART_KEY, normalizeChartPrefs),
  }),
  write: (next, changed) => {
    if (changed.watchlist) writeMarketKey(MARKET_WATCHLIST_KEY, next.watchlist, "cloud");
    if (changed.view) writeMarketKey(MARKET_CHART_VIEW_KEY, next.view, "cloud");
    if (changed.notes) writeMarketKey(MARKET_NOTES_KEY, next.notes, "cloud");
    if (changed.prefs) writeMarketKey(MARKET_CHART_KEY, next.prefs, "cloud");
  },
  joined: () => AppStorage.getItem(MARKET_CLOUD_JOINED_KEY) === "1",
  markJoined: () => AppStorage.setItem(MARKET_CLOUD_JOINED_KEY, "1"),
};

export type MarketSyncState = "off" | "on" | "error";

/** One exchange: pull, merge (newest wins; the first time the Watchlists are joined), write here, send what is newer. */
export async function syncMarketOnce(remote: MarketCloudRemote, store: MarketLocalStore, now: () => Date = () => new Date()): Promise<MarketSyncState> {
  try {
    const userId = await remote.currentUserId();
    // only the signed-in account's own space (never a guest's data, never another account's)
    if (!userId || userId !== store.userId()) return "off";
    if (!(await remote.isSyncEnabled(userId))) return "off";
    const rows = await remote.fetchAll();
    // the device may have changed while the rows were coming: read it now
    const result = mergeMarket(store.read(), rows, !store.joined(), now());
    if (result.changed.watchlist || result.changed.view || result.changed.notes || result.changed.prefs) store.write(result.local, result.changed);
    // a Watchlist stamped by the merge (joined, or never stamped) is kept here too
    if (result.push.some((r) => r.id === "watchlist") && !result.changed.watchlist) store.write(result.local, { watchlist: true, view: false, notes: false, prefs: false });
    await remote.upsert(result.push);
    store.markJoined();
    return "on";
  } catch {
    return "error";
  }
}

// ---- The state for the screens («kept in the account» / «on this device») ----

let state: MarketSyncState = "off";
const listeners = new Set<() => void>();
const setState = (next: MarketSyncState) => {
  if (state === next) return;
  state = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Is the Market kept in the account right now (sync on and the last exchange went through)? */
export function useMarketInAccount(): boolean {
  return useSyncExternalStore(subscribe, () => state === "on", () => false);
}

/**
 * Runs the account sync while the Market is open: at once, after local changes (with a pause), when the tab comes
 * back, and every 5 minutes. Nothing happens for guests, with the journal's cloud switch off, or in the e2e mock.
 */
export function useMarketCloudSync(): void {
  useEffect(() => {
    if (typeof window === "undefined" || isE2EMockEnabled()) return;
    const remote = new SupabaseMarketRemote(createSupabaseBrowserClient);
    let running = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const run = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      do {
        again = false;
        const next = await syncMarketOnce(remote, appMarketStore);
        if (!stopped) setState(next);
      } while (again && !stopped);
      running = false;
    };
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, MARKET_SYNC_DEBOUNCE_MS);
    };
    const onChange = (e: Event) => {
      if ((e as CustomEvent<MarketStoreChange>).detail?.source === "local") soon();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };

    run();
    window.addEventListener(MARKET_STORE_EVENT, onChange);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const interval = setInterval(run, MARKET_SYNC_PULL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener(MARKET_STORE_EVENT, onChange);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);
}
