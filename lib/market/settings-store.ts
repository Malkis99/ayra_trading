"use client";

import { useCallback, useEffect, useState } from "react";
import { AppStorage } from "@/lib/storage";
import { normalizeSettings, type MarketSessionsSettings } from "./sessions";

/** Sessions block settings of this space (account or guest), on this device. */
export const MARKET_SESSIONS_KEY = "ayra_market_sessions";
/** Killzone hours saved before 1.1b: read once into the new settings, never deleted. */
export const LEGACY_KILLZONES_KEY = "ayra_market_killzones";

function parse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readMarketSettings(): MarketSessionsSettings {
  try {
    return normalizeSettings(parse(AppStorage.getItem(MARKET_SESSIONS_KEY)), parse(AppStorage.getItem(LEGACY_KILLZONES_KEY)));
  } catch {
    return normalizeSettings(null);
  }
}

export function writeMarketSettings(value: MarketSessionsSettings): void {
  try {
    AppStorage.setItem(MARKET_SESSIONS_KEY, JSON.stringify(value));
  } catch {
    // storage full or blocked: the settings still apply until the page is reloaded
  }
}

/** The settings and a setter that keeps them on the device. Defaults until read in the browser. */
export function useMarketSettings(): [MarketSessionsSettings, (next: MarketSessionsSettings) => void] {
  const [value, setValue] = useState<MarketSessionsSettings>(() => normalizeSettings(null));
  useEffect(() => setValue(readMarketSettings()), []);
  const update = useCallback((next: MarketSessionsSettings) => {
    setValue(next);
    writeMarketSettings(next);
  }, []);
  return [value, update];
}
