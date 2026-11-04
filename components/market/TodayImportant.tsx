"use client";

import React, { useEffect, useState } from "react";
import { ChevronRight, ExternalLink, ShieldCheck, Sparkles } from "lucide-react";
import { useApp } from "@/lib/context";
import { useOptionalGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import { browserTimeZone, timeZoneLabel } from "@/lib/timezones";
import { cn } from "@/components/ui";
import { clockIn, levelOf, type CalendarEvent } from "@/lib/market/feeds/calendar-view";
import { dayOf, nextImportant, todayItems, type NewsItem, type TodayItem } from "@/lib/market/feeds/today";
import { useMarketEvents } from "@/lib/market/feeds/use-market-events";
import { useMarketNews } from "@/lib/market/feeds/use-market-news";
import { Countdown } from "./LiveTimer";
import { NewsModal, whenIn } from "./NewsModal";

const DOT = { high: "bg-short", medium: "bg-amber-300", low: "bg-mu" } as const;
/** How far ahead «the nearest important event» is looked for when today has none. */
const LOOK_AHEAD_DAYS = 14;

function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** The profile's zone (the one «Time and session» uses). */
export function useUserZone(): string {
  const game = useOptionalGame();
  const [fallback, setFallback] = useState("UTC");
  useEffect(() => setFallback(browserTimeZone()), []);
  return game?.gameState.profile.timezone || fallback;
}

function Trust({ source }: { source: string }) {
  const { dict } = useApp();
  const t = dict.market.calendar.own;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-long/40 bg-long/10 px-1 py-px text-[10px] font-semibold text-long" title={formatString(t.trustHint, { source })} data-testid="today-trust">
      <ShieldCheck size={11} aria-hidden="true" />
      {t.official}
    </span>
  );
}

/**
 * «Today important» (PR 4): today in the user's zone — high-importance releases, the Fed's and ECB's decisions and
 * press conferences, policy speeches, the White House on tariffs and sanctions. The nearest one on top with a
 * countdown; when today has nothing, says so and names the nearest important event.
 */
export function TodayImportant() {
  const { dict, lang } = useApp();
  const t = dict.market.today;
  const own = dict.market.calendar.own;
  const zone = useUserZone();
  const now = useNow();
  const [open, setOpen] = useState<NewsItem | null>(null);

  const day = now === null ? null : dayOf(now, zone);
  const [events] = useMarketEvents(day?.from ?? 0, day ? day.from + LOOK_AHEAD_DAYS * 86_400_000 : 0);
  const [news] = useMarketNews(day?.from ?? 0, 100);

  if (now === null || !day) return <section className="min-h-[160px]" data-testid="today-important" aria-busy="true" />;

  const ready = events.status === "ready" && news.status === "ready";
  const unavailable = events.status === "unavailable" || news.status === "unavailable";
  const failed = events.status === "error" || news.status === "error";
  const eventRows = events.status === "ready" ? events.events : [];
  const items = ready ? todayItems(eventRows, news.items, day) : [];
  const next = ready ? nextImportant(eventRows, now) : null;
  const nextToday = next && Date.parse(next.starts_at) < day.to ? next : null;
  const eventTitle = (e: CalendarEvent) => (e.code && (own.events as Record<string, string>)[e.code]) || e.title;

  return (
    <section className="space-y-3 rounded-xl border border-vi/30 bg-gradient-to-b from-pri/10 to-s1 p-3 md:p-4" data-testid="today-important" aria-labelledby="today-important-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="today-important-title" className="inline-flex items-center gap-2 text-sm font-semibold text-tx">
          <Sparkles size={15} className="text-vi" aria-hidden="true" />
          {t.title}
        </h2>
        <p className="text-[11px] text-mu" data-testid="today-zone">
          {formatString(t.zone, { zone: timeZoneLabel(zone, lang, new Date(now)) })}
        </p>
      </div>

      {unavailable && <p className="text-xs text-mu" role="status" data-testid="today-unavailable">{t.unavailable}</p>}
      {failed && !unavailable && <p className="text-xs text-mu" role="alert" data-testid="today-error">{t.error}</p>}
      {!ready && !unavailable && !failed && <p className="text-xs text-mu">{own.loading}</p>}

      {ready && next && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-s2/40 px-3 py-2" data-testid="today-next" data-id={next.id}>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-mu">{nextToday ? t.next : t.nextLater}</span>
          <span className="min-w-0 text-sm font-semibold text-tx" data-testid="today-next-title">
            {eventTitle(next)}
          </span>
          <span className="text-xs tabular-nums text-mu" data-testid="today-next-time">
            {nextToday ? clockIn(Date.parse(next.starts_at), zone) : whenIn(Date.parse(next.starts_at), zone, lang)}
          </span>
          <span className="text-xs font-semibold text-vi" data-testid="today-next-countdown">
            {t.in} <Countdown to={Date.parse(next.starts_at)} format="human" />
          </span>
        </div>
      )}

      {ready && items.length === 0 && (
        <p className="text-xs text-mu" role="status" data-testid="today-empty">
          {t.empty}
        </p>
      )}

      {ready && items.length > 0 && (
        <ul className="divide-y divide-line/60" data-testid="today-list">
          {items.map((i) => (
            <TodayRow key={i.type === "event" ? i.event.id : i.news.id} item={i} zone={zone} now={now} onOpen={setOpen} eventTitle={eventTitle} />
          ))}
        </ul>
      )}

      <p className="text-[11px] font-semibold text-tx" data-testid="today-disclaimer">
        {dict.market.notAdvice}
      </p>
      <NewsModal item={open} zone={zone} onClose={() => setOpen(null)} />
    </section>
  );
}

/** Time on the left; the title on one line, the source, trust mark and status under it (never squeezed on a phone). */
function TodayRow({ item, zone, now, onOpen, eventTitle }: { item: TodayItem; zone: string; now: number; onOpen: (n: NewsItem) => void; eventTitle: (e: CalendarEvent) => string }) {
  const { dict } = useApp();
  const own = dict.market.calendar.own;
  const isEvent = item.type === "event";
  const importance = isEvent ? item.event.importance : item.news.importance;
  const sourceKey = isEvent ? item.event.source : item.news.source;
  const source = own.sources[sourceKey];
  const status = isEvent ? (item.event.status === "released" ? "released" : item.at <= now ? "due" : "scheduled") : "released";
  const time = isEvent && item.event.time_tbd ? "—" : clockIn(item.at, zone);
  const link = isEvent ? item.event.url : null;

  const body = (
    <>
      <span className="pt-0.5 text-sm font-semibold tabular-nums text-tx" data-testid="today-item-time">
        {time}
      </span>
      <span className="min-w-0 space-y-1">
        <span className="flex min-w-0 items-start gap-2 text-sm text-tx">
          <span aria-hidden="true" className={cn("mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full", DOT[levelOf(importance)])} />
          <span className="min-w-0">
            {!isEvent && <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-mu">{dict.market.officialNews.kinds[item.news.kind]}</span>}
            <span className="font-semibold" data-testid="today-item-title">
              {isEvent ? eventTitle(item.event) : item.news.title}
            </span>
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-4 text-[11px] text-mu">
          <Trust source={source} />
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-vi hover:underline" data-testid="today-item-source">
              {source}
              <ExternalLink size={10} aria-hidden="true" />
            </a>
          ) : (
            <span data-testid="today-item-source">{source}</span>
          )}
          <span className={cn("rounded px-1.5 py-px text-[10px] font-semibold", status === "released" ? "bg-long/15 text-long" : status === "due" ? "bg-amber-300/15 text-amber-300" : "bg-s2 text-mu")} data-testid="today-item-status">
            {own.status[status]}
          </span>
          {isEvent && item.event.actual && (
            <span className="tabular-nums">
              {own.actual} <span className="font-semibold text-tx">{item.event.actual}</span>
              {item.event.previous && <> · {own.previous} {item.event.previous}</>}
            </span>
          )}
        </span>
      </span>
    </>
  );

  if (isEvent) {
    return (
      <li className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 py-2" data-testid="today-item" data-type="event" data-id={item.event.id}>
        {body}
      </li>
    );
  }
  return (
    <li className="py-1" data-testid="today-item" data-type="news" data-id={item.news.id}>
      <button
        type="button"
        onClick={() => onOpen(item.news)}
        className="grid w-full grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-x-3 rounded-md py-1 text-left hover:bg-s2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
        data-testid="today-item-open"
      >
        {body}
        <ChevronRight size={16} aria-hidden="true" className="mt-0.5 text-mu" />
      </button>
    </li>
  );
}
