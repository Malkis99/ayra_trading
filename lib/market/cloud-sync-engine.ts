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
/** After a failed exchange (network, the account not ready yet) the next try comes sooner. */
export const MARKET_SYNC_RETRY_MS = 30 * 1000;

/** An error of the cloud with its code (PostgREST / Postgres), so the screen can say what is wrong. */
export class MarketCloudError extends Error {
  constructor(
    public readonly code: string | undefined,
    message: string
  ) {
    super(message);
    this.name = "MarketCloudError";
  }
}

export interface MarketCloudRemote {
  currentUserId(): Promise<string | null>;
  /** user_features.cloud_sync (0004): the same switch as the journal's. */
  isSyncEnabled(userId: string): Promise<boolean>;
  fetchAll(): Promise<MarketCloudRow[]>;
  upsert(rows: MarketCloudRow[]): Promise<void>;
}

type ErrorLike = { code?: string; message?: string } | null;
const check = (error: ErrorLike) => {
  if (error) throw new MarketCloudError(error.code, error.message || "cloud error");
};

export class SupabaseMarketRemote implements MarketCloudRemote {
  constructor(private readonly getClient: () => SupabaseClient | null) {}
  private client(): SupabaseClient {
    const c = this.getClient();
    if (!c) throw new MarketCloudError("not_configured", "Supabase is not configured");
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
    check(error);
    return (data as { cloud_sync?: boolean } | null)?.cloud_sync === true;
  }
  async fetchAll() {
    // a handful of rows per account (Watchlist, view, up to one note per instrument)
    const { data, error } = await this.client().from(MARKET_TABLE).select("id, data").order("id").range(0, 499);
    check(error);
    return (data || []) as MarketCloudRow[];
  }
  async upsert(rows: MarketCloudRow[]) {
    if (!rows.length) return;
    // only id, data and device_id: user_id comes from the session, the rest is filled by the server (0008 trigger)
    const { error } = await this.client()
      .from(MARKET_TABLE)
      .upsert(rows.map((r) => ({ id: r.id, data: r.data, device_id: null })), { onConflict: "user_id,id" });
    check(error);
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

/**
 * What the last exchange found (shown on the Market, so a silent «on this device» never hides a problem):
 * - `on` — in the account;
 * - `guest` — not signed in (nothing to sync);
 * - `waiting` — the account is still opening on this page (tried again soon);
 * - `flagOff` — the cloud switch of the account (user_features.cloud_sync) is off;
 * - `noTable` — the Market table is not in the cloud (migration 0008 not applied);
 * - `offline` — no answer from the cloud (tried again soon);
 * - `refused` — the cloud answered with an error (its text in `detail`).
 */
export type MarketSyncKind = "on" | "guest" | "waiting" | "flagOff" | "noTable" | "offline" | "refused";
export interface MarketSyncStatus {
  kind: MarketSyncKind;
  detail?: string;
}

/** PostgREST «table not in the schema cache» / Postgres «relation does not exist». */
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01", "PGRST106"]);

export function classifySyncError(error: unknown): MarketSyncStatus {
  if (error instanceof MarketCloudError) {
    if (error.code && MISSING_TABLE_CODES.has(error.code)) return { kind: "noTable" };
    if (/market_user_data/.test(error.message) && /(not find|does not exist|schema cache)/i.test(error.message)) return { kind: "noTable" };
    return { kind: "refused", detail: error.code ? `${error.code}: ${error.message}` : error.message };
  }
  // fetch failed, timeout, offline
  return { kind: "offline" };
}

/** One exchange: pull, merge (newest wins; the first time the Watchlists are joined), write here, send what is newer. */
export async function syncMarketOnce(remote: MarketCloudRemote, store: MarketLocalStore, now: () => Date = () => new Date()): Promise<MarketSyncStatus> {
  try {
    const userId = await remote.currentUserId();
    if (!userId) return { kind: "guest" };
    // only the signed-in account's own space (never a guest's data, never another account's)
    if (userId !== store.userId()) return { kind: "waiting" };
    if (!(await remote.isSyncEnabled(userId))) return { kind: "flagOff" };
    const rows = await remote.fetchAll();
    // the device may have changed while the rows were coming: read it now
    const result = mergeMarket(store.read(), rows, !store.joined(), now());
    if (result.changed.watchlist || result.changed.view || result.changed.notes || result.changed.prefs) store.write(result.local, result.changed);
    // a Watchlist stamped by the merge (joined, or never stamped) is kept here too
    if (result.push.some((r) => r.id === "watchlist") && !result.changed.watchlist) store.write(result.local, { watchlist: true, view: false, notes: false, prefs: false });
    await remote.upsert(result.push);
    store.markJoined();
    return { kind: "on" };
  } catch (error) {
    return classifySyncError(error);
  }
}

// ---- The state for the screens ----

let status: MarketSyncStatus = { kind: "guest" };
let lastSyncedAt: number | null = null;
const listeners = new Set<() => void>();
const setStatus = (next: MarketSyncStatus) => {
  if (next.kind === "on") lastSyncedAt = Date.now();
  if (status.kind === next.kind && status.detail === next.detail && next.kind !== "on") return;
  status = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** «Sync now» of the running Market page (null when the Market is not open). */
let syncNow: (() => void) | null = null;
export const requestMarketSync = () => syncNow?.();

/** Is the Market kept in the account right now (sync on and the last exchange went through)? */
export function useMarketInAccount(): boolean {
  return useSyncExternalStore(subscribe, () => status.kind === "on", () => false);
}

/** What the last exchange found, and when it last went through. */
export function useMarketSyncStatus(): MarketSyncStatus & { lastSyncedAt: number | null } {
  const s = useSyncExternalStore(subscribe, () => status, () => status);
  return { ...s, lastSyncedAt };
}

/**
 * Runs the account sync while the Market is open: at once, after local changes (with a pause), when the tab comes
 * back, every 5 minutes, and 30 seconds after a failed try. A change still waiting is sent at once when the Market
 * is left or the tab is hidden or closed. Nothing happens for guests or in the e2e mock.
 */
export function useMarketCloudSync(): void {
  useEffect(() => {
    if (typeof window === "undefined" || isE2EMockEnabled()) return;
    const remote = new SupabaseMarketRemote(createSupabaseBrowserClient);
    let running = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const run = async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (running) {
        again = true;
        return;
      }
      running = true;
      do {
        again = false;
        const next = await syncMarketOnce(remote, appMarketStore);
        setStatus(next);
        if (retry) clearTimeout(retry);
        retry = null;
        if (!stopped && (next.kind === "offline" || next.kind === "waiting")) retry = setTimeout(run, MARKET_SYNC_RETRY_MS);
      } while (again && !stopped);
      running = false;
    };
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, MARKET_SYNC_DEBOUNCE_MS);
    };
    /** A change still waiting goes now (the tab is hidden, closed, or the Market is left). */
    const flush = () => {
      if (timer) run();
    };
    const onChange = (e: Event) => {
      if ((e as CustomEvent<MarketStoreChange>).detail?.source === "local") soon();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
      else flush();
    };

    syncNow = () => run();
    run();
    window.addEventListener(MARKET_STORE_EVENT, onChange);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    window.addEventListener("pagehide", flush);
    const interval = setInterval(run, MARKET_SYNC_PULL_MS);
    return () => {
      flush();
      stopped = true;
      syncNow = null;
      if (timer) clearTimeout(timer);
      if (retry) clearTimeout(retry);
      clearInterval(interval);
      window.removeEventListener(MARKET_STORE_EVENT, onChange);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, []);
}
