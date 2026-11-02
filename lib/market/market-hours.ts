import { categoryOf, type InstrumentId } from "./instruments";
import { NEW_YORK, instantOf, isForexOpen, nextForexClose, nextForexOpen, wallAt } from "./sessions";

/**
 * «Market open / closed» next to the chart (PR «Fullscreen + time and session», owner's idea 2026-11-01). Our own
 * calculation, no data:
 * - crypto trades around the clock;
 * - forex, indices, commodities and bonds (CFD feeds) follow the forex week, Sunday 17:00 – Friday 17:00 New York;
 *   the daily breaks of CFDs and holidays are not counted (and the line says so for non-forex);
 * - US stocks follow the regular NYSE hours, 09:30–16:00 New York, Monday–Friday, without holidays (owner's wording).
 */
export type MarketKind = "crypto" | "forex" | "cfd" | "stocks";

export function marketKindOf(id: InstrumentId): MarketKind {
  const category = categoryOf(id);
  if (category === "crypto") return "crypto";
  if (category === "stocks") return "stocks";
  if (category === "forex") return "forex";
  return "cfd";
}

export interface MarketState {
  open: boolean;
  /** When it closes (open) or opens (closed); null — around the clock. */
  changeAt: number | null;
}

const NYSE_OPEN = 9 * 60 + 30;
const NYSE_CLOSE = 16 * 60;

/** The New York instant of `minutes` after midnight, `addDays` days after the New York date of `ms`. */
function newYorkAt(ms: number, addDays: number, minutes: number): number {
  const w = wallAt(ms, NEW_YORK);
  const day = new Date(Date.UTC(w.y, w.mo - 1, w.d + addDays));
  return instantOf(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Math.floor(minutes / 60), minutes % 60, NEW_YORK);
}

/** Regular NYSE hours, Monday–Friday 09:30–16:00 New York; holidays are not known here. */
export function nyseState(ms: number): MarketState {
  const w = wallAt(ms, NEW_YORK);
  const min = w.h * 60 + w.mi;
  const weekday = w.wd >= 1 && w.wd <= 5;
  if (weekday && min >= NYSE_OPEN && min < NYSE_CLOSE) return { open: true, changeAt: newYorkAt(ms, 0, NYSE_CLOSE) };
  // the next weekday opening
  for (let add = weekday && min < NYSE_OPEN ? 0 : 1; add <= 7; add++) {
    const wd = (w.wd + add) % 7;
    if (wd >= 1 && wd <= 5) return { open: false, changeAt: newYorkAt(ms, add, NYSE_OPEN) };
  }
  return { open: false, changeAt: null };
}

export function marketState(kind: MarketKind, ms: number): MarketState {
  if (kind === "crypto") return { open: true, changeAt: null };
  if (kind === "stocks") return nyseState(ms);
  const open = isForexOpen(ms);
  return { open, changeAt: open ? nextForexClose(ms) : nextForexOpen(ms) };
}
