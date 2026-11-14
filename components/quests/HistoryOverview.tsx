"use client";

import React, { useRef } from "react";
import { Coins, Flame, Info, Shield, Sparkles, Target, CalendarCheck, CheckCheck } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatNumber, formatString } from "@/lib/i18n";
import { GAME_CONFIG } from "@/lib/game-config";
import { mapLook, type HistoryStats, type MapLook } from "@/lib/history-view";
import type { WeekDayView } from "@/lib/week-view";
import { cn } from "@/components/ui/cn";
import { formatDayKey } from "./WeekTab";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const CELL: Record<MapLook, string> = {
  high: "bg-[#8d6fd0]",
  mid: "bg-[#6b52a8]",
  low: "bg-[#4a3a78]",
  rest: "border-[1.5px] border-[#7fcfa6]/60 bg-[#7fcfa6]/[0.06]",
  shield: "border-[1.5px] border-vi/70",
  none: "bg-s2",
  noData: "border border-dashed border-edge",
  beforeStart: "bg-white/[0.02]",
  future: "border border-dashed border-line/60 bg-transparent",
  today: "border border-vi bg-s2",
};

/** One figure: an icon, a value, a label and, when needed, how it is counted. */
function Stat({ icon, value, label, hint, testId, muted }: { icon: React.ReactNode; value: React.ReactNode; label: string; hint?: string; testId: string; muted?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-s1 px-3 py-2.5 sm:px-3.5 sm:py-3" data-testid={testId}>
      <div className={cn("flex items-center gap-1.5 whitespace-nowrap text-[17px] font-bold leading-tight sm:text-lg", muted ? "text-mu" : "text-tx")}>
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
        <span className="min-w-0 truncate">{value}</span>
      </div>
      <div className="mt-0.5 text-xs text-mu">{label}</div>
      {hint && <div className="text-[11px] leading-snug text-mu/80">{hint}</div>}
    </div>
  );
}

/** The figures of the 12 weeks: counted from saved data only; what cannot be counted says so. */
export function HistoryStatsBlock({ stats }: { stats: HistoryStats }) {
  const { dict, lang } = useApp();
  const { gameState } = useGame();
  const v = dict.questsPage.q2.historyView;
  const q = dict.questsPage.q1.discipline;
  const n = (x: number) => formatNumber(lang, x);

  return (
    <section aria-label={v.statsLabel} className="space-y-2.5" data-testid="history-stats">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        <div className="min-w-0 rounded-xl border border-line bg-s1 px-3 py-2.5 sm:px-3.5 sm:py-3" data-testid="discipline">
          <div className="flex items-center gap-1.5 text-[17px] font-bold leading-tight text-tx sm:text-lg" data-testid="streak-current">
            <Flame size={16} aria-hidden="true" className="shrink-0 text-vi" />
            {formatString(v.streakValue, { n: gameState.currentStreak })}
          </div>
          <div className="mt-0.5 text-xs text-mu">
            {v.streak} · <span data-testid="streak-best">{formatString(v.streakBest, { n: gameState.bestStreak })}</span>
          </div>
        </div>
        <Stat testId="stat-active" icon={<CalendarCheck size={16} className="text-vi" />} value={formatString(v.activeValue, { n: stats.active, total: stats.days })} label={v.active} hint={formatString(v.rest, { n: stats.restDays })} />
        <Stat
          testId="stat-full"
          muted={!stats.full}
          icon={<CheckCheck size={16} className="text-success" />}
          value={stats.full ? formatString(v.fullValue, { n: stats.full.done, total: stats.full.of }) : "—"}
          label={v.full}
          hint={stats.full ? v.bySnapshots : v.noSnapshots}
        />
        <Stat
          testId="stat-core"
          muted={!stats.core}
          icon={<Target size={16} className="text-vi" />}
          value={stats.core ? formatString(v.coreValue, { n: stats.core.done, total: stats.core.of }) : "—"}
          label={v.core}
          hint={stats.core ? v.bySnapshots : v.noSnapshots}
        />
        <Stat testId="stat-xp" icon={<Sparkles size={16} className="text-vi" />} value={`+${n(stats.xp)}`} label={v.xp} hint={v.allSources} />
        <Stat testId="stat-coins" icon={<Coins size={16} className="text-go" />} value={<span className="text-go">+{n(stats.coins)}</span>} label={v.coins} hint={v.allSources} />
        <div className="col-span-2 min-w-0 rounded-xl border border-line bg-s1 px-3 py-2.5 sm:col-span-1 sm:px-3.5 sm:py-3" data-testid="stat-shields">
          <div className="flex items-center gap-1.5 text-[17px] font-bold leading-tight text-tx sm:text-lg">
            <Shield size={16} aria-hidden="true" className="shrink-0 text-vi" />
            {formatString(v.shieldsValue, { n: stats.shieldsUsed })}
          </div>
          <div className="mt-0.5 text-xs text-mu" data-testid="shield-count">
            {v.shields} · <span className="sr-only">{formatString(q.shieldCount, { count: gameState.streakShieldsAvailable, max: GAME_CONFIG.STREAK_SHIELDS_PER_WEEK })}</span>
            <span aria-hidden="true">{formatString(v.shieldsNow, { n: gameState.streakShieldsAvailable, max: GAME_CONFIG.STREAK_SHIELDS_PER_WEEK })}</span>
          </div>
        </div>
      </div>
      <p className="flex items-start gap-2 text-xs text-mu" data-testid="history-totals-note">
        <Info size={14} aria-hidden="true" className="mt-px shrink-0" />
        {v.totalsNote}
      </p>
      <p className="flex items-start gap-2 text-xs text-mu" data-testid="history-reliability">
        <Info size={14} aria-hidden="true" className="mt-px shrink-0" />
        {stats.snapshotsFrom ? formatString(v.reliability, { date: formatDayKey(stats.snapshotsFrom, lang, { day: "numeric", month: "long" }) }) : v.reliabilityNone}
      </p>
    </section>
  );
}

/**
 * 12 weeks × 7 days. On a phone and a tablet a row is a week (big cells, no sideways scroll); from `lg` a column is a
 * week (the usual heat map). One DOM for both: the grid flows by rows below `lg` and by columns from `lg`. Each day is a button;
 * arrows move by day and by week the way the map is drawn; future days cannot be opened.
 */
export function ActivityMap({ map, selected, onSelect }: { map: WeekDayView[][]; selected: string; onSelect: (key: string) => void }) {
  const { dict, lang } = useApp();
  const v = dict.questsPage.q2.historyView;
  const legend = v.legend;
  const status = dict.questsPage.q1.week.status;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const all = map.flat();

  const label = (d: WeekDayView) => {
    const parts = [
      d.isToday
        ? status.today
        : d.status === "future"
          ? status.future
          : d.core
            ? formatString(dict.questsPage.q2.page.dayAria, { done: d.core.done, total: d.core.total })
            : d.status === "done"
              ? formatString(status.done, { n: d.quests })
              : status[d.status],
      d.source === "history" && !d.isToday ? v.partial : "",
    ].filter(Boolean);
    return formatString(v.cellLabel, { date: formatDayKey(d.key, lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" }), status: parts.join(", ") });
  };

  const onKey = (e: React.KeyboardEvent, key: string) => {
    const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
    const steps: Record<string, number> = wide ? { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 } : { ArrowUp: -7, ArrowDown: 7, ArrowLeft: -1, ArrowRight: 1 };
    const step = steps[e.key];
    if (!step && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const open = all.filter((d) => d.status !== "future");
    let next: WeekDayView | undefined;
    if (e.key === "Home") next = open[0];
    else if (e.key === "End") next = open[open.length - 1];
    else {
      const i = all.findIndex((d) => d.key === key);
      next = all[i + step];
      if (!next || next.status === "future") return;
    }
    if (!next) return;
    onSelect(next.key);
    refs.current[next.key]?.focus();
  };

  const monthOf = (k: string) => formatDayKey(k, lang, { month: "short" }).replace(".", "");

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-s1 p-3 sm:p-5" data-testid="activity-map">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold text-tx">{v.mapTitle}</h2>
        <span className="text-xs text-mu">{v.mapNote}</span>
      </div>
      <div
        role="grid"
        aria-label={v.mapLabel}
        data-testid="activity-grid"
        className="mt-4 grid grid-cols-[1.6rem_repeat(7,minmax(0,1fr))] gap-[3px] sm:max-w-[400px] sm:gap-1.5 lg:max-w-[640px] lg:grid-flow-col lg:grid-cols-[auto] lg:auto-cols-[minmax(0,1fr)] lg:grid-rows-[auto_repeat(7,auto)] lg:gap-[5px]"
      >
        {/* weekday names: the first row on a phone, the first column from sm */}
        <span aria-hidden="true" />
        {WEEKDAY_KEYS.map((k) => (
          <span key={k} aria-hidden="true" className="self-center text-center text-[11px] text-mu lg:pr-1 lg:text-right">
            {dict.questsPage.weekTab.days[k]}
          </span>
        ))}
        {map.map((week, wi) => {
          const first = week[0].key;
          // the month label of a column: the month of its Sunday, shown when it changes
          const sunday = week[6].key;
          const newMonth = wi === 0 || sunday.slice(0, 7) !== map[wi - 1][6].key.slice(0, 7);
          return (
            <div key={first} role="row" aria-label={formatString(v.weekOf, { date: formatDayKey(first, lang, { day: "numeric", month: "long" }) })} className="contents">
              <span aria-hidden="true" className="self-center whitespace-nowrap text-[10px] leading-none text-mu sm:text-[11px] lg:self-end lg:pb-1 lg:text-left">
                {/* a row (phone, tablet): the month when it changes, else the date of the Monday; a column (lg): the month */}
                <span className="lg:hidden">{newMonth ? monthOf(sunday).slice(0, 3) : formatDayKey(first, lang, { day: "numeric" })}</span>
                <span className="hidden lg:inline">{newMonth ? monthOf(sunday) : ""}</span>
              </span>
              {week.map((d) => {
                const look = mapLook(d);
                const isSel = d.key === selected;
                const future = d.status === "future";
                return (
                  <span key={d.key} role="gridcell" className="contents">
                    <button
                      ref={(el) => {
                        refs.current[d.key] = el;
                      }}
                      type="button"
                      disabled={future}
                      aria-label={label(d)}
                      aria-pressed={isSel}
                      aria-current={d.isToday ? "date" : undefined}
                      tabIndex={isSel ? 0 : -1}
                      onClick={() => onSelect(d.key)}
                      onKeyDown={(e) => onKey(e, d.key)}
                      data-testid="activity-cell"
                      data-day={d.key}
                      data-status={d.status}
                      data-quests={d.quests}
                      data-source={d.source}
                      className={cn(
                        "relative aspect-square w-full min-w-0 rounded-md transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tx lg:max-w-[44px] lg:rounded-[6px]",
                        CELL[look],
                        d.isToday && "ring-1 ring-vi ring-offset-1 ring-offset-s1",
                        isSel && "ring-2 ring-tx ring-offset-1 ring-offset-s1",
                        future && "cursor-default",
                        d.status === "beforeStart" && "opacity-50"
                      )}
                    >
                      {d.source === "history" && !d.isToday && (
                        <span aria-hidden="true" className="absolute right-[3px] top-[3px] h-1.5 w-1.5 rounded-full bg-[#e5b98a]/80" />
                      )}
                    </button>
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-mu" data-testid="activity-legend">
        {(["high", "mid", "low", "rest", "shield", "none", "noData"] as const).map((k) => (
          <li key={k} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cn("inline-block h-3 w-3 rounded-[3px]", CELL[k])} />
            {legend[k]}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="relative inline-block h-3 w-3 rounded-[3px] bg-[#4a3a78]">
            <span className="absolute right-[1px] top-[1px] h-1 w-1 rounded-full bg-[#e5b98a]" />
          </span>
          {legend.partial}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-[3px] border border-vi" />
          {legend.today}
        </li>
      </ul>
    </section>
  );
}
