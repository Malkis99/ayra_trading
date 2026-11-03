import { isInstrumentId, INSTRUMENTS, type InstrumentId } from "./instruments";

/**
 * Market 1.4 «Calendar» and «News» (owner 2026-11-03): TradingView's free «events» (economic calendar) and
 * «timeline» (news) widgets. Their filters are kept here and follow the account in the Market's `chart_view` row
 * (0008) under `calendar`, with their own change time — the same way as the sessions block's settings.
 *
 * What the widgets can do (checked on the live widgets, 2026-11-03):
 * - the calendar filters by importance (`importanceFilter`: -1 low, 0 medium, 1 high) and countries
 *   (`countryFilter`, lower-case codes, `eu` = euro area); it shows times by the DEVICE's clock — its `timezone`
 *   option is dropped (even an explicit zone), so the profile's zone cannot be applied inside it;
 * - the news follow one symbol (`feedMode: "symbol"`, `symbol`) or show the top stories; headlines come in English
 *   whatever the site's language; links lead to TradingView's own news pages only (no brokers, no ads seen).
 */

export const IMPORTANCE = ["high", "medium", "low"] as const;
export type Importance = (typeof IMPORTANCE)[number];
const IMPORTANCE_CODE: Record<Importance, string> = { high: "1", medium: "0", low: "-1" };

/** Countries offered in the filter (the main currencies' economies). */
export const CALENDAR_COUNTRIES = ["us", "eu", "gb", "jp", "cn", "de", "ca", "au", "nz", "ch"] as const;
export type CalendarCountry = (typeof CALENDAR_COUNTRIES)[number];

export interface CalendarNewsPrefs {
  importance: Importance[];
  countries: CalendarCountry[];
  /** News about this instrument only; none = the top stories. */
  newsInstrument: InstrumentId | null;
  /** When they were last changed here (the account sync keeps the newest). */
  updatedAt?: string;
}

/** PLACEHOLDER defaults (owner may change): high and medium importance; USA, euro area, UK, Japan; all news. */
export const DEFAULT_CALENDAR_NEWS: CalendarNewsPrefs = {
  importance: ["high", "medium"],
  countries: ["us", "eu", "gb", "jp"],
  newsInstrument: null,
};

const isImportance = (v: unknown): v is Importance => typeof v === "string" && (IMPORTANCE as readonly string[]).includes(v);
const isCountry = (v: unknown): v is CalendarCountry => typeof v === "string" && (CALENDAR_COUNTRIES as readonly string[]).includes(v);

/** Read back, in the offered order, never empty (at least one importance and one country stay). */
export function normalizeCalendarNews(raw: unknown): CalendarNewsPrefs {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const importance = IMPORTANCE.filter((i) => Array.isArray(v.importance) && v.importance.some((x) => x === i && isImportance(x)));
  const countries = CALENDAR_COUNTRIES.filter((c) => Array.isArray(v.countries) && v.countries.some((x) => x === c && isCountry(x)));
  return {
    importance: importance.length ? importance : [...DEFAULT_CALENDAR_NEWS.importance],
    countries: countries.length ? countries : [...DEFAULT_CALENDAR_NEWS.countries],
    newsInstrument: isInstrumentId(v.newsInstrument) ? v.newsInstrument : null,
    ...(typeof v.updatedAt === "string" ? { updatedAt: v.updatedAt } : {}),
  };
}

/** Turns one option on or off; the last one stays on (an empty filter would show nothing). */
export function toggleIn<T extends string>(list: readonly T[], item: T, order: readonly T[]): T[] {
  const next = list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  return next.length ? order.filter((x) => next.includes(x)) : [...list];
}

/** The calendar widget's options. */
export function eventsOptions(prefs: CalendarNewsPrefs): Record<string, unknown> {
  return {
    width: "100%",
    height: "100%",
    importanceFilter: prefs.importance.map((i) => IMPORTANCE_CODE[i]).join(","),
    countryFilter: prefs.countries.join(","),
  };
}

/** The news widget's options: one instrument's news, or the top stories. */
export function timelineOptions(prefs: CalendarNewsPrefs, compact: boolean): Record<string, unknown> {
  const base = { width: "100%", height: "100%", displayMode: compact ? "compact" : "regular" };
  return prefs.newsInstrument ? { ...base, feedMode: "symbol", symbol: INSTRUMENTS[prefs.newsInstrument].symbol } : { ...base, feedMode: "all_symbols" };
}

/** The device's own time zone (the calendar's times follow it). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Do two zones show the same clock right now (e.g. Asia/Tbilisi and Asia/Yerevan)? */
export function sameClock(a: string, b: string, at: Date = new Date()): boolean {
  if (a === b) return true;
  try {
    const f = (zone: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", day: "2-digit" }).format(at);
    return f(a) === f(b);
  } catch {
    return false;
  }
}
