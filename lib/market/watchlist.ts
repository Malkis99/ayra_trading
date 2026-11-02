import {
  DEFAULT_CHART_INSTRUMENT,
  DEFAULT_CHART_INTERVAL,
  isChartInterval,
  isInstrumentId,
  type ChartInterval,
  type InstrumentId,
} from "./instruments";
import { normalizeFavorites } from "./chart-workspace";
import { isLayout, normalizePanes, type ChartLayout, type ChartPane } from "./chart-layout";
import { DEFAULT_CHART_STYLE, isChartStyle, normalizeIndicators, type ChartStyle, type IndicatorId } from "./chart-tools";

/**
 * The Watchlist (PR 1.3): catalog instruments in the user's order, on this device. Owner's decision 2026-11-01: at
 * most 30; the cloud comes later in its own PR with a migration — the shape below is what it will sync.
 */
export const WATCHLIST_LIMIT = 30;

export interface Watchlist {
  version: 1;
  ids: InstrumentId[];
  /** ISO time of the last change (the account sync keeps the newest version, migration 0008). */
  updatedAt?: string;
}

export const emptyWatchlist = (): Watchlist => ({ version: 1, ids: [] });

/** Whatever was stored: only catalog instruments, each once, at most the limit, in the stored order. */
export function normalizeWatchlist(raw: unknown): Watchlist {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { ids?: unknown }).ids) ? (raw as { ids: unknown[] }).ids : [];
  const ids: InstrumentId[] = [];
  for (const id of list) {
    if (isInstrumentId(id) && !ids.includes(id) && ids.length < WATCHLIST_LIMIT) ids.push(id);
  }
  const updatedAt = raw && typeof raw === "object" ? (raw as { updatedAt?: unknown }).updatedAt : undefined;
  return typeof updatedAt === "string" ? { version: 1, ids, updatedAt } : { version: 1, ids };
}

export const isFull = (w: Watchlist) => w.ids.length >= WATCHLIST_LIMIT;

/** Added at the end; nothing changes when it is already there or the list is full. */
export function addTo(w: Watchlist, id: InstrumentId): Watchlist {
  if (w.ids.includes(id) || isFull(w)) return w;
  return { ...w, ids: [...w.ids, id] };
}

export function removeFrom(w: Watchlist, id: InstrumentId): Watchlist {
  return w.ids.includes(id) ? { ...w, ids: w.ids.filter((x) => x !== id) } : w;
}

/** One step up (-1) or down (+1); the ends stay where they are. */
export function move(w: Watchlist, id: InstrumentId, step: -1 | 1): Watchlist {
  const i = w.ids.indexOf(id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= w.ids.length) return w;
  const ids = [...w.ids];
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return { ...w, ids };
}

/** The Chart's last instrument, timeframe and favourite timeframes on this device. */
export interface ChartPrefs {
  instrument: InstrumentId;
  interval: ChartInterval;
  favorites: ChartInterval[];
  /** «Chart type»: TradingView style (candles by default). */
  style: ChartStyle;
  /** «Indicators» from our list. */
  indicators: IndicatorId[];
  /** Layout 1 / 2 / 4 and windows 2–4 (on the device). */
  layout: ChartLayout;
  panes: ChartPane[];
  /** «One instrument in all windows» (off by default). */
  link: boolean;
}

export function normalizeChartPrefs(raw: unknown): ChartPrefs {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    instrument: isInstrumentId(r.instrument) ? r.instrument : DEFAULT_CHART_INSTRUMENT,
    interval: isChartInterval(r.interval) ? r.interval : DEFAULT_CHART_INTERVAL,
    favorites: normalizeFavorites(r.favorites),
    style: isChartStyle(r.style) ? r.style : DEFAULT_CHART_STYLE,
    indicators: normalizeIndicators(r.indicators),
    layout: isLayout(r.layout) ? r.layout : 1,
    panes: normalizePanes(r.panes),
    link: r.link === true,
  };
}
