"use client";

import { useCallback, useEffect, useState } from "react";
import { AppStorage } from "@/lib/storage";
import { emptyWatchlist, normalizeChartPrefs, normalizeWatchlist, type ChartPrefs, type Watchlist } from "./watchlist";
import { normalizeChartView, normalizeNotes, type ChartNotes, type ChartView } from "./chart-workspace";

/** The Watchlist of this space (account or guest), on this device; synced with the account (0008). */
export const MARKET_WATCHLIST_KEY = "ayra_market_watchlist";
/** The Chart's last instrument, timeframe and favourite timeframes (device only). */
export const MARKET_CHART_KEY = "ayra_market_chart";
/** How the Chart page is laid out (PR 1.3b); synced with the account (0008). */
export const MARKET_CHART_VIEW_KEY = "ayra_market_chart_view";
/** Notes per instrument (PR 1.3b); synced with the account (0008). */
export const MARKET_NOTES_KEY = "ayra_market_notes";

/** Every write of a Market key is announced: screens re-read, the account sync sends local changes. */
export const MARKET_STORE_EVENT = "ayra-market-store";
export type MarketStoreSource = "local" | "cloud";
export interface MarketStoreChange {
  key: string;
  source: MarketStoreSource;
}

export function readMarketKey<T>(key: string, normalize: (raw: unknown) => T): T {
  try {
    const raw = AppStorage.getItem(key);
    return normalize(raw ? JSON.parse(raw) : null);
  } catch {
    return normalize(null);
  }
}

export function writeMarketKey(key: string, value: unknown, source: MarketStoreSource = "local"): void {
  try {
    AppStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the change still applies until the page is reloaded
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<MarketStoreChange>(MARKET_STORE_EVENT, { detail: { key, source } }));
}

/**
 * A value kept on the device, a setter, and whether it was read yet (screens wait, so nothing jumps). It re-reads
 * when the same key is written elsewhere (another screen, or the account sync bringing another device's change).
 */
function useStored<T>(key: string, normalize: (raw: unknown) => T, initial: () => T, stamp?: (next: T) => T): [T, (next: T) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setValue(readMarketKey(key, normalize));
    setLoaded(true);
    const onChange = (e: Event) => {
      if ((e as CustomEvent<MarketStoreChange>).detail?.key === key) setValue(readMarketKey(key, normalize));
    };
    window.addEventListener(MARKET_STORE_EVENT, onChange);
    return () => window.removeEventListener(MARKET_STORE_EVENT, onChange);
  }, [key, normalize]);
  const update = useCallback(
    (next: T) => {
      const stamped = stamp ? stamp(next) : next;
      setValue(stamped);
      writeMarketKey(key, stamped);
    },
    [key, stamp]
  );
  return [value, update, loaded];
}

/** The time of a change made on this device (the account sync keeps the newest version). */
const stampNow = <T extends object>(next: T): T => ({ ...next, updatedAt: new Date().toISOString() });

export const useWatchlist = () => useStored<Watchlist>(MARKET_WATCHLIST_KEY, normalizeWatchlist, emptyWatchlist, stampNow);
export const useChartPrefs = () => useStored<ChartPrefs>(MARKET_CHART_KEY, normalizeChartPrefs, () => normalizeChartPrefs(null));
export const useChartView = () => useStored<ChartView>(MARKET_CHART_VIEW_KEY, normalizeChartView, () => normalizeChartView(null), stampNow);
export const useChartNotes = () => useStored<ChartNotes>(MARKET_NOTES_KEY, normalizeNotes, () => ({}));
