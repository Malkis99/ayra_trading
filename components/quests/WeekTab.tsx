"use client";

import React from "react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import type { DayCell } from "@/lib/quests-view";
import { cn } from "@/components/ui/cn";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function formatDayKey(key: string, lang: "ru" | "en", opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** The 7 real days of this week (account time zone): quests done, rest, shield, no data, ahead. */
export function WeekTab({ days, weekCount }: { days: DayCell[]; weekCount: number }) {
  const { dict, lang } = useApp();
  const w = dict.questsPage.q1.week;
  const statusText = (d: DayCell) => (d.status === "done" ? formatString(w.status.done, { n: d.quests }) : w.status[d.status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-lg font-bold text-tx">
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
              "min-w-0 rounded-md border bg-s1 px-1 py-2.5 text-center sm:px-2",
              d.isToday ? "border-vi" : "border-line",
              (d.status === "future" || d.status === "beforeStart") && "opacity-60"
            )}
          >
            <div className="text-xs text-mu">{dict.questsPage.weekTab.days[WEEKDAY_KEYS[i]]}</div>
            <div className="text-xs text-mu">{formatDayKey(d.key, lang, { day: "numeric" })}</div>
            <div
              className={cn(
                "mt-1 break-words text-xs font-bold leading-tight sm:text-[13px]",
                d.status === "done" ? "text-success" : d.status === "rest" || d.status === "shield" ? "text-vi" : "text-mu"
              )}
            >
              {statusText(d)}
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-mu">{w.note}</p>
    </div>
  );
}
