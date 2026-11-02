import { isChartInterval, isInstrumentId, type ChartInterval, type InstrumentId } from "./instruments";

/**
 * Layouts 1 / 2 / 4 of the Chart (owner 2026-11-01): several TradingView charts at once; on phones only 1 and 2.
 * Window 1 is the main chart (the toolbar above, the Watchlist, notes); windows 2–4 have their own instrument and
 * timeframe. «One instrument in all windows» (off by default, owner's idea) shows window 1's instrument everywhere,
 * each window keeping its own timeframe. Kept on the device.
 */
export const LAYOUTS = [1, 2, 4] as const;
export type ChartLayout = (typeof LAYOUTS)[number];
export const isLayout = (v: unknown): v is ChartLayout => (LAYOUTS as readonly unknown[]).includes(v);

export interface ChartPane {
  /** null: the same instrument as window 1 until another one is picked. */
  instrument: InstrumentId | null;
  interval: ChartInterval;
}

/** Windows 2, 3, 4: by default the main instrument on 4 h, 1 D and 15 min (a common way to look at several timeframes). */
export const DEFAULT_PANES: readonly ChartPane[] = [
  { instrument: null, interval: "240" },
  { instrument: null, interval: "D" },
  { instrument: null, interval: "15" },
];

export function normalizePanes(raw: unknown): ChartPane[] {
  const list = Array.isArray(raw) ? raw : [];
  return DEFAULT_PANES.map((d, i) => {
    const r = list[i] && typeof list[i] === "object" ? (list[i] as Record<string, unknown>) : {};
    return {
      instrument: isInstrumentId(r.instrument) ? r.instrument : null,
      interval: isChartInterval(r.interval) ? r.interval : d.interval,
    };
  });
}

/** What is shown: on phones at most two windows. */
export const effectiveLayout = (layout: ChartLayout, narrow: boolean): ChartLayout => (narrow && layout === 4 ? 2 : layout);

/** The instrument of window `index` (0 = the main one). */
export function paneInstrument(index: number, main: InstrumentId, panes: readonly ChartPane[], link: boolean): InstrumentId {
  if (index === 0 || link) return main;
  return panes[index - 1]?.instrument ?? main;
}

export function withPane(panes: readonly ChartPane[], index: number, patch: Partial<ChartPane>): ChartPane[] {
  return panes.map((p, i) => (i === index - 1 ? { ...p, ...patch } : p));
}
