"use client";

import React from "react";
import { CalendarDays, ChevronRight } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import type { DayCell } from "@/lib/quests-view";
import type { JournalSnapshot } from "@/lib/quest-engine";
import { WeekGoals, WeekObjectives } from "./WeekMissions";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function formatDayKey(key: string, lang: "ru" | "en", opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

const statusColor = (d: DayCell) => (d.status === "done" ? "text-success" : d.status === "rest" || d.status === "shield" ? "text-vi" : "text-mu");

/**
 * The Week tab's main column: the 7 real days of this week (account time zone) — quests done, rest, shield, no data,
 * ahead — then the week objectives and the goals of the week plan. The Boss and trading days are in the rail.
 */
export function WeekTab({ days, weekCount, snapshot }: { days: DayCell[]; weekCount: number; snapshot: JournalSnapshot }) {
  const { dict, lang } = useApp();
  const w = dict.questsPage.q1.week;
  const statusText = (d: DayCell) => (d.status === "done" ? formatString(w.status.done, { n: d.quests }) : w.status[d.status]);
  // a phone column is ~40px wide: a short mark is shown, the full status stays for screen readers
  const shortText = (d: DayCell) => formatString(dict.questsPage.q2.dayShort[d.status], { n: d.quests });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-xl font-bold text-tx">
          {formatString(w.title, { from: formatDayKey(days[0].key, lang), to: formatDayKey(days[6].key, lang) })}
        </h2>
        <span className="text-sm text-mu" data-testid="week-count">{formatString(w.count, { n: weekCount })}</span>
      </div>
      <ol className="grid grid-cols-7 gap-1.5 sm:gap-2" data-testid="week-days">
        {days.map((d, i) => (
          <li
            key={d.key}
            data-testid={`week-day-${d.key}`}
            data-status={d.status}
            aria-current={d.isToday ? "date" : undefined}
            className={cn(
              "min-w-0 rounded-xl border bg-s1 px-1 py-2.5 text-center sm:px-2 sm:py-3",
              d.isToday ? "border-vi" : "border-line",
              (d.status === "future" || d.status === "beforeStart") && "border-dashed bg-transparent opacity-70"
            )}
          >
            <div className="text-xs font-semibold text-mu">{dict.questsPage.weekTab.days[WEEKDAY_KEYS[i]]}</div>
            <div className="font-serif text-base font-bold text-tx sm:text-lg">{formatDayKey(d.key, lang, { day: "numeric" })}</div>
            <div className={cn("mt-1 break-words text-xs font-bold leading-tight sm:text-[13px]", statusColor(d))}>
              <span className="hidden sm:inline">{statusText(d)}</span>
              <span className="sm:hidden" aria-hidden="true">
                {shortText(d)}
              </span>
              <span className="sr-only sm:hidden">{statusText(d)}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-mu">{w.note}</p>
      <div className="grid items-start gap-4 2xl:grid-cols-2">
        <WeekObjectives snapshot={snapshot} />
        <WeekGoals snapshot={snapshot} />
      </div>
    </div>
  );
}

/** The week at a glance for the progress rail of Today: 7 small cells and a link to the Week tab. */
export function WeekCard({ days, weekCount, onOpen }: { days: DayCell[]; weekCount: number; onOpen: () => void }) {
  const { dict, lang } = useApp();
  const w = dict.questsPage.q1.week;
  const h = dict.questsPage.q2.hub;
  return (
    <section className="rounded-2xl border border-line bg-s1 p-4" data-testid="week-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold text-tx">
          <CalendarDays size={16} aria-hidden="true" className="shrink-0 text-vi" />
          <span className="truncate">{formatString(h.weekTitle, { from: formatDayKey(days[0].key, lang, { day: "numeric" }), to: formatDayKey(days[6].key, lang) })}</span>
        </h3>
        <button type="button" onClick={onOpen} className={buttonClasses("ghost", "md", "-mr-3 shrink-0 gap-1 text-vi")} data-testid="week-card-open">
          {h.weekOpen}
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
      <ol className="grid grid-cols-7 gap-1">
        {days.map((d, i) => (
          <li key={d.key} className="min-w-0 text-center">
            <div className="text-[11px] text-mu" aria-hidden="true">{dict.questsPage.weekTab.days[WEEKDAY_KEYS[i]]}</div>
            <div
              className={cn(
                "mt-1 grid h-8 place-items-center rounded-lg text-xs font-bold",
                d.status === "done" ? "bg-success/15 text-success" : d.status === "rest" || d.status === "shield" ? "bg-vi/10 text-vi" : "bg-s2 text-mu",
                d.isToday && "ring-1 ring-inset ring-vi",
                (d.status === "future" || d.status === "beforeStart") && "border border-dashed border-line bg-transparent"
              )}
            >
              <span aria-hidden="true">{formatString(dict.questsPage.q2.dayShort[d.status], { n: d.quests })}</span>
              <span className="sr-only">{`${formatDayKey(d.key, lang, { day: "numeric", month: "long" })}: ${d.status === "done" ? formatString(w.status.done, { n: d.quests }) : w.status[d.status]}`}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-mu">{formatString(h.weekCount, { n: weekCount })}</p>
    </section>
  );
}
