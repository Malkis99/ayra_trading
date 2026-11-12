import { instantOf, wallAt } from "../sessions";
import type { CalendarEvent } from "./calendar-view";
import type { FeedSource } from "./types";

/**
 * «Today important» and the official news feed (PR 4–5, docs/market-feeds-plan.md): what of the calendar and the
 * official news matters today, in the user's zone; the nearest one with a countdown; the feed without noise.
 */

/** A row of `market_news` as the site reads it (only what the source itself gives: title, description, date). */
export interface NewsItem {
  id: string;
  source: FeedSource;
  trust: "official" | "agency";
  kind: "decision" | "statement" | "speech" | "testimony" | "press_conference" | "minutes" | "data" | "presidential_action" | "press_release";
  country: "us" | "eu";
  title: string;
  summary: string | null;
  url: string;
  published_at: string;
  importance: 1 | 2 | 3;
  dedupe_key: string;
}

export const NEWS_COLUMNS = "id,source,trust,kind,country,title,summary,url,published_at,importance,dedupe_key";

/** The user's day around `now`: midnight to midnight in `zone`. */
export function dayOf(now: number, zone: string): { from: number; to: number } {
  const w = wallAt(now, zone);
  const next = new Date(Date.UTC(w.y, w.mo - 1, w.d + 1));
  return { from: instantOf(w.y, w.mo, w.d, 0, 0, zone), to: instantOf(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, zone) };
}

/** Calendar events that matter on their own: high importance, and every rate decision and press conference. */
export const isImportantEvent = (e: CalendarEvent) => e.source !== "ons" && e.status !== "cancelled" && (e.importance === 3 || e.kind === "decision" || e.kind === "press_conference");

/**
 * News that matter today: decisions and press conferences; speeches and testimony of medium or high importance
 * (the Chair, the President, policy talks — not supervision or AI talks); anything else only when high (the White
 * House on tariffs and sanctions, the big releases).
 */
export function isImportantNews(n: NewsItem): boolean {
  if (n.kind === "decision" || n.kind === "press_conference") return true;
  if (n.kind === "speech" || n.kind === "testimony") return n.importance >= 2;
  return n.importance === 3;
}

/** One story once (several feeds, a decision and its statement), the first seen wins. */
export function dedupeNews(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items.filter((n) => (seen.has(n.dedupe_key) ? false : (seen.add(n.dedupe_key), true)));
}

export type TodayItem = { type: "event"; at: number; event: CalendarEvent } | { type: "news"; at: number; news: NewsItem };

/** Today's important events and news in one timeline, by time. */
export function todayItems(events: CalendarEvent[], news: NewsItem[], day: { from: number; to: number }): TodayItem[] {
  const within = (at: number) => at >= day.from && at < day.to;
  const items: TodayItem[] = [
    ...events.filter(isImportantEvent).map((event) => ({ type: "event" as const, at: Date.parse(event.starts_at), event })),
    ...dedupeNews(news.filter(isImportantNews)).map((n) => ({ type: "news" as const, at: Date.parse(n.published_at), news: n })),
  ].filter((i) => within(i.at));
  return items.sort((a, b) => a.at - b.at);
}

/** The nearest important event still to come (today first, otherwise the next days). */
export function nextImportant(events: CalendarEvent[], now: number): CalendarEvent | null {
  return events.filter((e) => isImportantEvent(e) && e.status === "scheduled" && Date.parse(e.starts_at) > now).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null;
}

/** The feed: importance chosen by the user (high only by default), newest first, repeats merged. */
export function feed(items: NewsItem[], levels: readonly (1 | 2 | 3)[]): NewsItem[] {
  return dedupeNews([...items].sort((a, b) => b.published_at.localeCompare(a.published_at))).filter((n) => levels.includes(n.importance));
}
