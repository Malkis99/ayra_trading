import { instantOf, wallAt } from "../sessions";
import type { CalendarNewsPrefs, Importance as Level } from "../calendar-news";
import type { FeedSource } from "./types";

/**
 * Market → Calendar, own (plan docs/market-feeds-plan.md, PR 3): the week's working days in the user's time zone,
 * events from the 0009 table grouped by the user's day, the importance and country filters applied. Pure functions;
 * the screen is components/market/OwnCalendar.tsx.
 */

/** A row of `market_events` as the site reads it. */
export interface CalendarEvent {
  id: string;
  source: FeedSource;
  kind: string;
  code: string | null;
  country: "us" | "eu";
  title: string;
  importance: 1 | 2 | 3;
  starts_at: string;
  time_tbd: boolean;
  status: "scheduled" | "released" | "cancelled";
  actual: string | null;
  previous: string | null;
  url: string | null;
  updated_at: string;
}

export const EVENT_COLUMNS = "id,source,kind,code,country,title,importance,starts_at,time_tbd,status,actual,previous,url,updated_at";

export interface CalendarDay {
  /** `2026-11-02` in the user's zone */
  date: string;
  /** 1 = Monday … 5 = Friday */
  weekday: number;
  /** the user's midnight of this day and of the next, ms */
  from: number;
  to: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Monday to Friday of a week in `zone`: `offset` 0 is the «current» week, 1 the next. On Saturday and Sunday the
 * current week is over, so the «current» one is the coming week (there is nothing left to show in the old one).
 */
export function workWeek(now: number, zone: string, offset: number): CalendarDay[] {
  const w = wallAt(now, zone);
  const weekend = w.wd === 0 || w.wd === 6;
  // days back to Monday (Sunday counts as the end of the week)
  const back = w.wd === 0 ? 6 : w.wd - 1;
  const shift = offset * 7 + (weekend ? 7 : 0) - back;
  const monday = Date.UTC(w.y, w.mo - 1, w.d + shift);
  return [0, 1, 2, 3, 4].map((i) => {
    const d = new Date(monday + i * 86_400_000);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const next = new Date(monday + (i + 1) * 86_400_000);
    return {
      date: `${y}-${pad(mo)}-${pad(day)}`,
      weekday: i + 1,
      from: instantOf(y, mo, day, 0, 0, zone),
      to: instantOf(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, zone),
    };
  });
}

/** The day to open first: today on a working day, otherwise Monday. */
export function initialDay(days: CalendarDay[], now: number): string {
  return (days.find((d) => now >= d.from && now < d.to) ?? days[0]).date;
}

const LEVEL: Record<1 | 2 | 3, Level> = { 3: "high", 2: "medium", 1: "low" };
export const levelOf = (importance: 1 | 2 | 3): Level => LEVEL[importance];

/** Our sources cover the USA and the euro area only. */
export const OWN_COUNTRIES = ["us", "eu"] as const;

/** The events the filters let through (importance, and the two countries we have). */
export function visibleEvents(events: CalendarEvent[], prefs: Pick<CalendarNewsPrefs, "importance" | "countries">): CalendarEvent[] {
  return events.filter((e) => prefs.importance.includes(levelOf(e.importance)) && (prefs.countries as readonly string[]).includes(e.country));
}

/** Are none of our two countries chosen (the filter then shows nothing here, by design)? */
export const noOwnCountry = (countries: readonly string[]) => !OWN_COUNTRIES.some((c) => countries.includes(c));

/** The events of one day, by time; a time to be announced goes last. */
export function eventsOfDay(events: CalendarEvent[], day: CalendarDay): CalendarEvent[] {
  return events
    .filter((e) => {
      const at = Date.parse(e.starts_at);
      return at >= day.from && at < day.to;
    })
    .sort((a, b) => Number(a.time_tbd) - Number(b.time_tbd) || a.starts_at.localeCompare(b.starts_at) || b.importance - a.importance);
}

/** How many shown events each day has (the tabs show it). */
export const countByDay = (events: CalendarEvent[], days: CalendarDay[]) => Object.fromEntries(days.map((d) => [d.date, eventsOfDay(events, d).length]));

/** «08:30» in the user's zone. */
export function clockIn(ms: number, zone: string): string {
  const w = wallAt(ms, zone);
  return `${pad(w.h)}:${pad(w.mi)}`;
}

/** The newest change of the shown data (the «updated at» line). */
export function lastUpdate(events: CalendarEvent[]): number | null {
  const times = events.map((e) => Date.parse(e.updated_at)).filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

/** How long after a release a figure is still «on its way» before the row says the source has not given it. */
export const FIGURE_WAIT_MS = 3 * 60 * 60_000;

export type EventStatus = "scheduled" | "due" | "released" | "cancelled" | "held" | "unavailable";

/**
 * What a row says: «expected» before the time; then for a data release «waiting for data» for three hours and, if no
 * figure came, «no data from the source — see the link» (the collector still asks for a week: a late figure replaces
 * it); a decision, press conference or speech has no figure — it is «held».
 */
export function eventStatus(e: Pick<CalendarEvent, "status" | "kind" | "starts_at">, now: number): EventStatus {
  if (e.status === "released") return "released";
  if (e.status === "cancelled") return "cancelled";
  const at = Date.parse(e.starts_at);
  if (at > now) return "scheduled";
  if (e.kind !== "release") return "held";
  return now - at <= FIGURE_WAIT_MS ? "due" : "unavailable";
}
