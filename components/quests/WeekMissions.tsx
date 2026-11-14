"use client";

import React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import {
  ALL_DAYS,
  bossConditions,
  bossState,
  currentBoss,
  lastWeekTradeCount,
  weekGoals,
  weekObjectives,
  type CheckState,
  type JournalSnapshot,
} from "@/lib/quest-engine";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function StateText({ state }: { state: CheckState }) {
  const { dict } = useApp();
  return (
    <span
      className={cn(
        "whitespace-nowrap text-xs font-semibold",
        state === "met" ? "text-success" : state === "notMet" ? "text-[#e5b98a]" : "text-mu"
      )}
    >
      {dict.questsPage.q2.states[state]}
    </span>
  );
}

/** Trading days: the day mode of the next days follows them (today's quests do not change). */
export function TradingDaysPicker() {
  const { dict, showToast } = useApp();
  const { gameState, setTradingDays } = useGame();
  const t = dict.questsPage.q2.week;
  const days = gameState.tradingDays && gameState.tradingDays.length > 0 ? gameState.tradingDays : ALL_DAYS;
  const toggle = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    if (next.length === 0) return; // at least one day stays a trading day
    if (setTradingDays(next)) showToast(t.tradingDaysSaved);
    else showToast(dict.questsPage.q1.today.notSaved);
  };
  return (
    <section className="rounded-2xl border border-line bg-s1 p-4" data-testid="trading-days">
      <h3 className="text-[15px] font-semibold text-tx">{t.tradingDaysTitle}</h3>
      <p className="mt-1 text-xs text-mu">{t.tradingDaysHint}</p>
      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {WEEKDAY_KEYS.map((k, i) => {
          const on = days.includes(i);
          const label = dict.questsPage.weekTab.days[k];
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              aria-label={formatString(t.tradingDaysLabel, { day: label })}
              data-testid={`trading-day-${i}`}
              onClick={() => toggle(i)}
              className={cn(
                "min-h-[44px] rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                on ? "bg-vi/15 text-tx ring-1 ring-inset ring-vi" : "bg-s2 text-mu hover:text-tx"
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The Weekly Boss — computed from the journal; no rewards yet. `compact` (the progress rail of Today) leaves out the
 * deadline line and links to the Week tab instead.
 */
export function WeeklyBoss({ snapshot, compact, onOpenWeek }: { snapshot: JournalSnapshot; compact?: boolean; onOpenWeek?: () => void }) {
  const { dict } = useApp();
  const { gameState, gameDay } = useGame();
  const t = dict.questsPage.q2.week;
  const b = dict.questsPage.q2.boss;

  const boss = currentBoss(gameState.questWeek, snapshot, gameDay);
  const conditions = bossConditions(boss, snapshot, gameDay);
  const overall = bossState(conditions);
  const basedOnData = (gameState.questWeek?.boss === boss && !!gameState.questWeek) || lastWeekTradeCount(snapshot, gameDay) > 0;

  return (
    <section className="rounded-2xl border border-vi/35 bg-gradient-to-b from-[#1d1b2a] to-s1 p-4" data-testid="weekly-boss" data-boss={boss} data-state={overall}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center bg-gradient-to-br from-[#6d55a8] to-[#2c2148] font-serif text-xl font-bold text-[#efe9ff] [clip-path:polygon(50%_0,100%_25%,100%_75%,50%_100%,0_75%,0_25%)]">
          {b.names[boss].slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-vi">{b.kicker}</div>
          <h3 className="font-serif text-lg font-bold text-tx">{b.names[boss]}</h3>
          <p className="text-xs text-mu">{basedOnData ? b.chosenFrom : b.chosenDefault}</p>
        </div>
        <span className="basis-full text-sm font-semibold text-tx" data-testid="boss-overall">
          {b.overall[overall]}
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {conditions.map((c) => (
          <li key={c.key} data-testid={`boss-condition-${c.key}`} data-state={c.state} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-ink/55 px-3 py-2.5 text-sm">
            <div className="min-w-0">
              <div className="text-tx">{b.conditions[c.key as keyof typeof b.conditions]}</div>
              <div className="text-xs text-mu">
                {b.source[c.source]}
                {c.total > 0 ? ` · ${formatString(t.progress, { done: c.done, total: c.total })}` : ""}
              </div>
            </div>
            <StateText state={c.state} />
          </li>
        ))}
      </ul>
      {compact ? (
        onOpenWeek && (
          <button type="button" onClick={onOpenWeek} className={buttonClasses("ghost", "md", "-ml-4 mt-1 gap-1 text-vi")} data-testid="boss-open-week">
            {dict.questsPage.q2.hub.bossOpen}
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        )
      ) : (
        <p className="mt-3 text-xs text-mu" data-testid="boss-until-end">
          {b.untilEnd} {b.noReward}
        </p>
      )}
    </section>
  );
}

/** The week objectives — computed from the journal; no rewards. */
export function WeekObjectives({ snapshot, dayKey, past }: { snapshot: JournalSnapshot; dayKey?: string; past?: boolean }) {
  const { dict } = useApp();
  const { gameDay } = useGame();
  const t = dict.questsPage.q2.week;
  const v = dict.questsPage.q2.weekView;
  const objectives = weekObjectives(snapshot, dayKey || gameDay);

  return (
    <section className="rounded-2xl border border-line bg-s1 p-4" data-testid="week-objectives">
      <h3 className="text-[15px] font-semibold text-tx">{past ? v.pastObjectives : t.objectivesTitle}</h3>
      <p className="mt-1 text-xs text-mu">{past ? v.pastObjectivesNote : t.objectivesNote}</p>
      <ul className="mt-2 divide-y divide-line">
        {objectives.map((o) => (
          <li key={o.key} data-testid={`objective-${o.key}`} data-state={past && o.state === "pending" ? "notMet" : o.state} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-tx">{t.objectives[o.key]}</div>
              <div className="text-xs text-mu">
                {t.objectiveHints[o.key]}
                {o.total > 0 && o.key !== "weekReview" ? ` · ${formatString(t.progress, { done: o.done, total: o.total })}` : ""}
              </div>
            </div>
            <StateText state={past && o.state === "pending" ? "notMet" : o.state} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The goals of the week plan (from the journal), with a link to edit them there. */
export function WeekGoals({ snapshot, dayKey }: { snapshot: JournalSnapshot; dayKey?: string }) {
  const { dict } = useApp();
  const { gameDay } = useGame();
  const t = dict.questsPage.q2.week;
  const goals = weekGoals(snapshot, dayKey || gameDay);

  return (
    <section className="rounded-2xl border border-line bg-s1 p-4" data-testid="week-goals">
      <h3 className="text-[15px] font-semibold text-tx">{t.goalsTitle}</h3>
      {goals.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-tx">
          {goals.map((g, i) => (
            <li key={i} className="break-words [overflow-wrap:anywhere]">
              {g}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-mu">{t.goalsEmpty}</p>
      )}
      <Link href="/journal?tab=plan" className={buttonClasses("ghost", "md", "mt-2 -ml-2")}>
        {t.openWeekPlan}
      </Link>
    </section>
  );
}

/**
 * A closed week's challenge (QH-4 rail): the result written once in its week snapshot (QH-3), never recomputed here.
 * No snapshot (a week before snapshots), no challenge, or a result still waiting for the journal — said as it is.
 */
export function PastWeekBoss({ week }: { week: string }) {
  const { dict, lang } = useApp();
  const { gameState } = useGame();
  const t = dict.questsPage.q2.week;
  const b = dict.questsPage.q2.boss;
  const v = dict.questsPage.q2.weekView;
  const snap = gameState.questWeeks?.find((w) => w.week === week);
  const result = snap?.bossResult;
  const state = !snap ? "unsaved" : !snap.boss ? "none" : result ? result.state : "pending";

  return (
    <section className="rounded-2xl border border-vi/35 bg-gradient-to-b from-[#1d1b2a] to-s1 p-4" data-testid="past-boss" data-state={state}>
      <div className="text-xs font-bold uppercase tracking-[0.14em] text-vi">{v.pastBoss}</div>
      {snap?.boss ? (
        <>
          <div className="mt-2 flex items-center gap-3">
            <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center bg-gradient-to-br from-[#6d55a8] to-[#2c2148] font-serif text-lg font-bold text-[#efe9ff] [clip-path:polygon(50%_0,100%_25%,100%_75%,50%_100%,0_75%,0_25%)]">
              {b.names[snap.boss].slice(0, 1)}
            </span>
            <div className="min-w-0">
              <h3 className="font-serif text-lg font-bold text-tx">{b.names[snap.boss]}</h3>
              {result && (
                <p className="text-xs text-mu">
                  {formatString(v.pastBossAt, { date: new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "long" }).format(new Date(result.at)) })}
                </p>
              )}
            </div>
          </div>
          {result ? (
            <>
              <p className="mt-3 text-sm font-semibold text-tx" data-testid="past-boss-overall">
                {b.overall[result.state]}
              </p>
              <ul className="mt-2 space-y-2">
                {result.conditions.map((c) => (
                  <li key={c.key} data-testid={`past-boss-condition-${c.key}`} data-state={c.state} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-ink/55 px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="text-tx">{b.conditions[c.key as keyof typeof b.conditions]}</div>
                      <div className="text-xs text-mu">
                        {b.source[c.source]}
                        {c.total > 0 ? ` · ${formatString(t.progress, { done: c.done, total: c.total })}` : ""}
                      </div>
                    </div>
                    <StateText state={c.state} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-sm text-mu">{v.pastBossPending}</p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-mu">{snap ? v.pastBossNone : v.pastBossUnsaved}</p>
      )}
      <p className="mt-3 text-xs text-mu">{b.noReward}</p>
    </section>
  );
}
