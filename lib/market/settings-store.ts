"use client";

import { AppStorage } from "@/lib/storage";
import { normalizeSettings, type MarketSessionsSettings } from "./sessions";
import { readMarketKey, stampNow, useStored, writeMarketKey, type MarketStoreSource } from "./watchlist-store";

/** Sessions block settings of this space (account or guest); synced with the account in the `chart_view` row (0008). */
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

/** The stored settings, or the killzones saved before 1.1b (kept, not lost). */
const normalizeStored = (raw: unknown): MarketSessionsSettings => {
  let legacy: unknown = null;
  try {
    legacy = parse(AppStorage.getItem(LEGACY_KILLZONES_KEY));
  } catch {
    // storage blocked: no old killzones
  }
  return normalizeSettings(raw, legacy);
};

export function readMarketSettings(): MarketSessionsSettings {
  return readMarketKey(MARKET_SESSIONS_KEY, normalizeStored);
}

export function writeMarketSettings(value: MarketSessionsSettings, source: MarketStoreSource = "local"): void {
  writeMarketKey(MARKET_SESSIONS_KEY, value, source);
}

/**
 * The settings, a setter that keeps them (with the time of the change, for the account sync), and whether they were
 * read yet (the block waits for it, so it never draws with the defaults first and then jumps). Every screen showing
 * them re-reads when they change elsewhere — another screen, or another device through the account.
 */
export const useMarketSettings = () =>
  useStored<MarketSessionsSettings>(MARKET_SESSIONS_KEY, normalizeStored, () => normalizeSettings(null), stampNow);
