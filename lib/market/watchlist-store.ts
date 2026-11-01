"use client";

import { useCallback, useEffect, useState } from "react";
import { AppStorage } from "@/lib/storage";
import { emptyWatchlist, normalizeChartPrefs, normalizeWatchlist, type ChartPrefs, type Watchlist } from "./watchlist";

/** The Watchlist of this space (account or guest), on this device. */
export const MARKET_WATCHLIST_KEY = "ayra_market_watchlist";
/** The Chart's last instrument and timeframe. */
export const MARKET_CHART_KEY = "ayra_market_chart";

function read<T>(key: string, normalize: (raw: unknown) => T): T {
  try {
    const raw = AppStorage.getItem(key);
    return normalize(raw ? JSON.parse(raw) : null);
  } catch {
    return normalize(null);
  }
}

function write(key: string, value: unknown): void {
  try {
    AppStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the change still applies until the page is reloaded
  }
}

/** A value kept on the device, a setter, and whether it was read yet (screens wait, so nothing jumps). */
function useStored<T>(key: string, normalize: (raw: unknown) => T, initial: () => T): [T, (next: T) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setValue(read(key, normalize));
    setLoaded(true);
  }, [key, normalize]);
  const update = useCallback(
    (next: T) => {
      setValue(next);
      write(key, next);
    },
    [key]
  );
  return [value, update, loaded];
}

export const useWatchlist = () => useStored<Watchlist>(MARKET_WATCHLIST_KEY, normalizeWatchlist, emptyWatchlist);
export const useChartPrefs = () => useStored<ChartPrefs>(MARKET_CHART_KEY, normalizeChartPrefs, () => normalizeChartPrefs(null));
