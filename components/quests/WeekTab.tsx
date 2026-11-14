"use client";

import React, { useRef } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import type { DayCell } from "@/lib/quests-view";
import type { JournalSnapshot } from "@/lib/quest-engine";
import { addDaysToKey } from "@/lib/day-key";
import { weekSummary, type DayDetail, type WeekDayView } from "@/lib/week-view";
import { WeekGoals, WeekObjectives } from "./WeekMissions";
import { DayPanel } from "./DayPanel";
import { MODE_ICONS } from "./ModeSwitch";
import { Button, buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function formatDayKey(key: string, lang: "ru" | "en", opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** «9–15 ноября», «27 октября – 2 ноября». */
function weekRangeText(start: string, lang: "ru" | "en"): string {
  const end = addDaysToKey(start, 6);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const from = sameMonth ? formatDayKey(start, lang, { day: "numeric" }) : formatDayKey(start, lang, { day: "numeric", month: "long" });
  return `${from}–${formatDayKey(end, lang, { day: "numeric", month: "long" })}`;
}

interface WeekTabProps {
  week: string;
  days: WeekDayView[];
  selected: string;
  detail: DayDetail;
  isCurrent: boolean;
  canGoBack: boolean;
  snapshot: JournalSnapshot;
  onWeek: (week: string) => void;
  onDay: (day: string) => void;
  onOpenToday: () => void;
}

/**
 * The interactive week (docs/quest-hub-plan.md, 4.2): earlier weeks can be opened (never future ones), a day opens a
 * read-only panel. Past days come from their snapshots (QH-3) or, before snapshots, from the history — marked so.
 */
export function WeekTab({ week, days, selected, detail, isCurrent, canGoBack, snapshot, onWeek, onDay, onOpenToday }: WeekTabProps) {
  const { dict, lang } = useApp();
  const v = dict.questsPage.q2.weekView;
  const status = dict.questsPage.q1.week.status;
  const summary = weekSummary(days);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const open = days.filter((d) => d.status !== "future");

  // ← → move between the days that can be opened
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const idx = open.findIndex((d) => d.key === days[i].key);
    const next = open[(idx + step + open.length) % open.length];
    onDay(next.key);
    refs.current[days.findIndex((d) => d.key === next.key)]?.focus();
  };

  const cellText = (d: WeekDayView) => {
    if (d.status === "future") return v.cellAhead;
    if (d.status === "beforeStart") return v.cellBefore;
    if (d.isToday) return v.cellToday;
    if (d.status === "rest") return v.cellRest;
    if (d.status === "shield") return v.cellShield;
    if (d.core) return formatString(v.cellCore, { done: d.core.done, total: d.core.total });
    if (d.quests > 0) return String(d.quests);
    return v.cellNoRecords;
  };
  // a phone cell is ~40px wide: long words get the short mark of the mini week
  const cellShort = (d: WeekDayView) => {
    const s = dict.questsPage.q2.dayShort;
    if (d.status === "future" || d.status === "beforeStart") return s.future;
    if (d.isToday) return s.today;
    if (d.status === "rest") return s.rest;
    if (!d.core && d.quests === 0 && d.status !== "shield") return s.noData;
    return cellText(d);
  };
  const ariaStatus = (d: WeekDayView) =>
    [d.core ? formatString(dict.questsPage.q2.page.dayAria, { done: d.core.done, total: d.core.total }) : d.status === "done" ? formatString(status.done, { n: d.quests }) : status[d.status], d.mode ? dict.questsPage.q2.modes[d.mode] : "", d.xp > 0 ? `+${d.xp} XP` : ""]
      .filter(Boolean)
      .join(", ");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="md" className="!w-11 !px-0" disabled={!canGoBack} aria-label={v.prev} onClick={() => onWeek(addDaysToKey(week, -7))} data-testid="week-prev">
            <ChevronLeft size={18} aria-hidden="true" />
          </Button>
          <h2 className="min-w-0 font-serif text-xl font-bold text-tx" data-testid="week-title" aria-live="polite">
            {weekRangeText(week, lang)}
          </h2>
          <Button variant="secondary" size="md" className="!w-11 !px-0" disabled={isCurrent} aria-label={v.next} onClick={() => onWeek(addDaysToKey(week, 7))} data-testid="week-next">
            <ChevronRight size={18} aria-hidden="true" />
          </Button>
        </div>
        {isCurrent ? (
          <p className="text-sm text-mu">{v.hint}</p>
        ) : (
          <button type="button" onClick={() => onWeek("")} className={buttonClasses("secondary", "md")} data-testid="week-current">
            {v.toCurrent}
          </button>
        )}
      </div>

      <div className="grid grid-cols-7 gap-1.5 sm:gap-2" data-testid="week-days" role="group" aria-label={weekRangeText(week, lang)}>
        {days.map((d, i) => {
          const ModeIcon = d.mode ? MODE_ICONS[d.mode] : null;
          const disabled = d.status === "future";
          const isSel = d.key === selected;
          return (
            <button
              key={d.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              disabled={disabled}
              aria-pressed={isSel}
              aria-current={d.isToday ? "date" : undefined}
              aria-label={formatString(v.dayAria, { date: formatDayKey(d.key, lang, { weekday: "long", day: "numeric", month: "long" }), status: ariaStatus(d) })}
              tabIndex={isSel ? 0 : -1}
              onClick={() => onDay(d.key)}
              onKeyDown={(e) => onKey(e, i)}
              data-testid={`week-day-${d.key}`}
              data-status={d.status}
              data-source={d.source}
              className={cn(
                "flex min-h-[92px] min-w-0 flex-col items-center gap-0.5 rounded-xl border px-0.5 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi sm:min-h-[112px] sm:px-1.5 sm:py-3",
                isSel ? "border-vi bg-pri/[0.16] shadow-[0_0_0_1px_rgb(var(--c-vi)/0.35)]" : d.isToday ? "border-vi/50 bg-s1" : "border-line bg-s1 hover:border-vi/40",
                disabled && "cursor-default border-dashed bg-transparent opacity-60 hover:border-line",
                d.status === "beforeStart" && "opacity-60"
              )}
            >
              <span className="text-[11px] font-semibold text-mu sm:text-xs" aria-hidden="true">
                {dict.questsPage.weekTab.days[WEEKDAY_KEYS[i]]}
              </span>
              <span className="font-serif text-base font-bold leading-tight text-tx sm:text-lg" aria-hidden="true">
                {formatDayKey(d.key, lang, { day: "numeric" })}
              </span>
              <span className="grid h-4 place-items-center text-mu" aria-hidden="true">
                {ModeIcon ? <ModeIcon size={14} /> : null}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "w-full break-words text-[11px] font-bold leading-tight sm:text-xs",
                  d.core ? (d.core.done === d.core.total ? "text-success" : "text-vi") : d.status === "done" ? "text-success" : d.status === "rest" || d.status === "shield" ? "text-vi" : "text-mu"
                )}
              >
                <span className="hidden sm:inline">{cellText(d)}</span>
                <span className="sm:hidden">{cellShort(d)}</span>
              </span>
              {d.xp > 0 && !d.isToday && (
                <span className="hidden text-[11px] text-mu sm:block" aria-hidden="true">
                  {formatString(v.cellXp, { xp: d.xp })}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-mu" data-testid="week-summary">
        <div className="flex gap-1.5">
          <dt>{v.summaryActive}</dt>
          <dd className="font-semibold text-tx" data-testid="week-active">
            {formatString(v.summaryActiveValue, { n: summary.active, total: summary.elapsed })}
          </dd>
        </div>
        {summary.full !== null && (
          <div className="flex gap-1.5" title={v.summaryFullHint}>
            <dt>{v.summaryFull}</dt>
            <dd className="font-semibold text-tx" data-testid="week-full">
              {formatString(v.summaryFullValue, { n: summary.full, total: summary.fullOf })}
            </dd>
          </div>
        )}
        <div className="flex gap-1.5">
          <dt>XP</dt>
          <dd className="font-semibold text-tx" data-testid="week-xp">
            +{summary.xp}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Coins</dt>
          <dd className="font-semibold text-go" data-testid="week-coins">
            +{summary.coins}
          </dd>
        </div>
      </dl>

      <DayPanel detail={detail} snapshot={snapshot} onOpenToday={onOpenToday} />

      {isCurrent && (
        <div className="grid items-start gap-4 2xl:grid-cols-2">
          <WeekObjectives snapshot={snapshot} />
          <WeekGoals snapshot={snapshot} />
        </div>
      )}
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
