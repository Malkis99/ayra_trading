"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink, RotateCw, ShieldCheck } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { cn } from "@/components/ui";
import type { CalendarNewsPrefs } from "@/lib/market/calendar-news";
import {
  clockIn,
  countByDay,
  eventsOfDay,
  initialDay,
  lastUpdate,
  levelOf,
  noOwnCountry,
  visibleEvents,
  workWeek,
  type CalendarEvent,
} from "@/lib/market/feeds/calendar-view";
import { useMarketEvents } from "@/lib/market/feeds/use-market-events";

const LEVEL_DOT = { high: "bg-short", medium: "bg-amber-300", low: "bg-mu" } as const;

/** The live minute (the «today» marks and the default day move with the clock). */
function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * Market → Calendar → «Official events» (PR 3, docs/market-feeds-plan.md): Monday to Friday tabs, this week or the
 * next, times in the user's zone (the same as «Time and session»), the figure and the previous one from BLS / BEA,
 * the source with its trust mark on every row.
 */
export function OwnCalendar({ prefs, zone }: { prefs: CalendarNewsPrefs; zone: string }) {
  const { dict, lang } = useApp();
  const t = dict.market.calendar.own;
  const names = dict.market.calendar.countryNames;
  const now = useNow();
  const [week, setWeek] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);

  const days = useMemo(() => (now === null ? [] : workWeek(now, zone, week)), [now, zone, week]);
  const from = days[0]?.from ?? 0;
  const to = days.length ? days[4].to : 0;
  const [state, retry] = useMarketEvents(from, to);

  // a new week opens on its first day; this week on today
  useEffect(() => setPicked(null), [week, zone]);
  if (now === null || !days.length) return <div className="min-h-[360px]" data-testid="own-calendar" aria-busy="true" />;

  const dayId = picked ?? (week === 0 ? initialDay(days, now) : days[0].date);
  const day = days.find((d) => d.date === dayId) ?? days[0];
  const shown = state.status === "ready" ? visibleEvents(state.events, prefs) : [];
  const counts = countByDay(shown, days);
  const rows = eventsOfDay(shown, day);
  const updated = state.status === "ready" ? lastUpdate(state.events) : null;
  const dateLabel = (date: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ru-RU", { ...opts, timeZone: "UTC" }).format(Date.parse(`${date}T12:00:00Z`));
  const todayDate = days.find((d) => now >= d.from && now < d.to)?.date;

  return (
    <div className="space-y-3" data-testid="own-calendar" data-week={week}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-line bg-s1 p-0.5 text-xs font-semibold" role="group" aria-label={t.weekLabel}>
          {[0, 1].map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={week === w}
              onClick={() => setWeek(w)}
              className={cn("rounded-md px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi", week === w ? "bg-pri/40 text-tx" : "text-mu hover:text-tx")}
              data-testid={w === 0 ? "own-calendar-this-week" : "own-calendar-next-week"}
            >
              {w === 0 ? t.thisWeek : t.nextWeek}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-mu" data-testid="own-calendar-range">
          {dateLabel(days[0].date, { day: "numeric", month: "long" })} – {dateLabel(days[4].date, { day: "numeric", month: "long" })}
        </p>
      </div>

      {/* Monday … Friday: five equal tabs, they always fit (no sideways scroll) */}
      <div className="grid grid-cols-5 gap-1" role="tablist" aria-label={t.daysLabel} data-testid="own-calendar-days">
        {days.map((d) => {
          const active = d.date === day.date;
          return (
            <button
              key={d.date}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setPicked(d.date)}
              className={cn(
                "flex min-w-0 flex-col items-center rounded-lg border px-1 py-1.5 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                active ? "border-vi/70 bg-pri/25 text-tx" : "border-line text-mu hover:border-vi/50 hover:text-tx"
              )}
              data-testid={`own-calendar-day-${d.weekday}`}
              data-date={d.date}
            >
              <span className="text-xs font-semibold">{t.weekdays[d.weekday - 1]}</span>
              <span className="text-[11px] tabular-nums">{dateLabel(d.date, { day: "numeric", month: "short" })}</span>
              <span className={cn("mt-0.5 text-[10px] tabular-nums", counts[d.date] ? "text-vi" : "text-mu/60")} data-testid={`own-calendar-day-${d.weekday}-count`}>
                {d.date === todayDate ? t.today : formatString(t.count, { n: counts[d.date] ?? 0 })}
              </span>
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-s1" role="tabpanel" data-testid="own-calendar-list" data-day={day.date}>
        {state.status === "loading" && <p className="px-4 py-10 text-center text-xs text-mu">{t.loading}</p>}
        {state.status === "unavailable" && (
          <p className="px-4 py-10 text-center text-xs text-mu" role="status" data-testid="own-calendar-unavailable">
            {t.unavailable}
          </p>
        )}
        {state.status === "error" && (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center" role="alert" data-testid="own-calendar-error">
            <p className="text-xs text-mu">{t.error}</p>
            <button type="button" onClick={retry} className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-tx hover:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi">
              <RotateCw size={13} aria-hidden="true" />
              {t.retry}
            </button>
          </div>
        )}
        {state.status === "ready" && noOwnCountry(prefs.countries) && (
          <p className="px-4 py-10 text-center text-xs text-mu" role="status" data-testid="own-calendar-no-country">
            {t.noCountry}
          </p>
        )}
        {state.status === "ready" && !noOwnCountry(prefs.countries) && rows.length === 0 && (
          <p className="px-4 py-10 text-center text-xs text-mu" role="status" data-testid="own-calendar-empty">
            {t.empty}
          </p>
        )}
        {state.status === "ready" && rows.length > 0 && (
          <ul className="divide-y divide-line/70">
            {rows.map((e) => (
              <EventRow key={e.id} e={e} zone={zone} now={now} names={names} />
            ))}
          </ul>
        )}
      </div>

      {updated !== null && (
        <p className="text-[11px] text-mu" data-testid="own-calendar-updated">
          {formatString(t.updated, { time: `${dateLabel(new Date(updated).toISOString().slice(0, 10), { day: "numeric", month: "short" })} ${clockIn(updated, zone)}` })}
        </p>
      )}
    </div>
  );
}

function EventRow({ e, zone, now, names }: { e: CalendarEvent; zone: string; now: number; names: Record<string, string> }) {
  const { dict } = useApp();
  const t = dict.market.calendar.own;
  const level = levelOf(e.importance);
  const at = Date.parse(e.starts_at);
  const title = (e.code && (t.events as Record<string, string>)[e.code]) || e.title;
  const status = e.status === "released" ? "released" : e.status === "cancelled" ? "cancelled" : at <= now ? "due" : "scheduled";
  const source = t.sources[e.source];

  return (
    <li className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2.5 md:grid-cols-[3.5rem_minmax(0,1fr)_auto] md:items-center md:px-4" data-testid="own-calendar-event" data-id={e.id} data-level={level} data-status={status}>
      <span className="pt-0.5 text-sm font-semibold tabular-nums text-tx md:pt-0" data-testid="own-calendar-event-time">
        {e.time_tbd ? <span className="text-[11px] font-normal text-mu">{t.tbd}</span> : clockIn(at, zone)}
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="flex min-w-0 items-start gap-2 text-sm text-tx">
          <span aria-hidden="true" className={cn("mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full", LEVEL_DOT[level])} />
          <span className="sr-only">{dict.market.calendar.levels[level]}</span>
          <span className="min-w-0 font-semibold" data-testid="own-calendar-event-title">
            {title}
          </span>
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-4 text-[11px] text-mu">
          <span>{names[e.country]}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1 rounded border border-long/40 bg-long/10 px-1 py-px font-semibold text-long" title={formatString(t.trustHint, { source })} data-testid="own-calendar-event-trust">
            <ShieldCheck size={11} aria-hidden="true" />
            {t.official}
          </span>
          {e.url ? (
            <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-vi hover:underline" data-testid="own-calendar-event-source">
              {source}
              <ExternalLink size={10} aria-hidden="true" />
            </a>
          ) : (
            <span data-testid="own-calendar-event-source">{source}</span>
          )}
        </p>
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 text-xs md:col-start-3 md:justify-end md:pl-0" data-testid="own-calendar-event-figures">
        <span className="tabular-nums">
          <span className="text-mu">{t.actual} </span>
          <span className={cn("font-semibold", e.actual ? "text-tx" : "text-mu")} data-testid="own-calendar-event-actual">
            {e.actual ?? "—"}
          </span>
        </span>
        <span className="tabular-nums">
          <span className="text-mu">{t.previous} </span>
          <span className="text-tx" data-testid="own-calendar-event-previous">
            {e.previous ?? "—"}
          </span>
        </span>
        <span
          className={cn(
            "rounded px-1.5 py-px text-[10px] font-semibold",
            status === "released" ? "bg-long/15 text-long" : status === "cancelled" ? "bg-short/15 text-short" : status === "due" ? "bg-amber-300/15 text-amber-300" : "bg-s2 text-mu"
          )}
          data-testid="own-calendar-event-status"
        >
          {t.status[status]}
        </span>
      </div>
    </li>
  );
}
