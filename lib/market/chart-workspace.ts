import { CHART_INTERVALS, DEFAULT_FAVORITE_INTERVALS, isChartInterval, isInstrumentId, type ChartInterval, type InstrumentId } from "./instruments";

/**
 * The Chart workspace (PR 1.3b): favourite timeframes, how the page is laid out, notes per instrument. All of it on
 * this device; notes may later go to the Journal (see the PR and `docs/market-plan.md`).
 */

/** Favourite timeframes in the canonical order; at least one stays. */
export function normalizeFavorites(raw: unknown): ChartInterval[] {
  if (!Array.isArray(raw)) return [...DEFAULT_FAVORITE_INTERVALS];
  const set = new Set(raw.filter(isChartInterval));
  const list = CHART_INTERVALS.filter((i) => set.has(i));
  return list.length ? list : [...DEFAULT_FAVORITE_INTERVALS];
}

/** Adds or removes a favourite; the last one cannot be removed. */
export function toggleFavorite(list: readonly ChartInterval[], interval: ChartInterval): ChartInterval[] {
  if (list.includes(interval)) return list.length > 1 ? list.filter((i) => i !== interval) : [...list];
  return CHART_INTERVALS.filter((i) => i === interval || list.includes(i));
}

export type PanelSide = "right" | "left";
export type NotesPlace = "below" | "side";

export interface ChartView {
  /** The Watchlist panel next to the chart. */
  watchlist: boolean;
  watchlistSide: PanelSide;
  /** Folded to a thin strip (the button stays). */
  watchlistFolded: boolean;
  notes: boolean;
  notesPlace: NotesPlace;
  /** TradingView's left drawing toolbar. */
  drawing: boolean;
}

export const DEFAULT_CHART_VIEW: ChartView = { watchlist: true, watchlistSide: "right", watchlistFolded: false, notes: true, notesPlace: "below", drawing: true };

export function normalizeChartView(raw: unknown): ChartView {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const bool = (k: keyof ChartView) => (typeof r[k] === "boolean" ? (r[k] as boolean) : (DEFAULT_CHART_VIEW[k] as boolean));
  return {
    watchlist: bool("watchlist"),
    watchlistSide: r.watchlistSide === "left" ? "left" : "right",
    watchlistFolded: bool("watchlistFolded"),
    notes: bool("notes"),
    notesPlace: r.notesPlace === "side" ? "side" : "below",
    drawing: bool("drawing"),
  };
}

export const NOTE_LIMIT = 2000;

export interface InstrumentNote {
  text: string;
  /** ISO time of the last change. */
  updatedAt: string;
}

export type ChartNotes = Partial<Record<InstrumentId, InstrumentNote>>;

/** Only catalog instruments, text cut to the limit, empty notes dropped. */
export function normalizeNotes(raw: unknown): ChartNotes {
  const out: ChartNotes = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isInstrumentId(id) || !v || typeof v !== "object") continue;
    const { text, updatedAt } = v as { text?: unknown; updatedAt?: unknown };
    if (typeof text !== "string" || !text.trim()) continue;
    out[id] = { text: text.slice(0, NOTE_LIMIT), updatedAt: typeof updatedAt === "string" ? updatedAt : new Date(0).toISOString() };
  }
  return out;
}

/** Sets (or clears, when empty) the note of an instrument. */
export function withNote(notes: ChartNotes, id: InstrumentId, text: string, now: Date): ChartNotes {
  const next = { ...notes };
  const cut = text.slice(0, NOTE_LIMIT);
  if (cut.trim()) next[id] = { text: cut, updatedAt: now.toISOString() };
  else delete next[id];
  return next;
}
