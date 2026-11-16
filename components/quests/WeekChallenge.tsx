"use client";

import React, { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import { AppStorage } from "@/lib/storage";
import { addDaysToKey } from "@/lib/day-key";
import type { BossId, JournalSnapshot } from "@/lib/quest-engine";
import { challengeDays, closedPhase, weekMinutesLeft, type ChallengeDayState, type ClosedPhase, type CurrentPhase, type WeekTrophy } from "@/lib/week-trophies";
import { formatDayKey, weekRangeText } from "./WeekTab";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";

// QH-7: the week challenge cycle — phase, days, time left — and trophies. Display only: nothing here records or gives.

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
/** Weeks whose trophy this person has already seen celebrated (a viewer convenience on this device, per account). */
const SEEN_KEY = "ayra_week_trophies_seen";

type Phase = CurrentPhase | ClosedPhase;

export function PhaseChip({ phase }: { phase: Phase }) {
  const { dict } = useApp();
  return (
    <span
      data-testid="challenge-phase"
      data-phase={phase}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        phase === "completed" ? "border-go/60 bg-go/10 text-go" : phase === "conditionMet" ? "border-success/50 bg-success/10 text-success" : phase === "checking" || phase === "active" ? "border-vi/50 bg-vi/10 text-tx" : "border-line bg-s2 text-mu"
      )}
    >
      {dict.questsPage.q2.boss.phase[phase]}
    </span>
  );
}

/** Time left until Sunday 24:00 in the account zone (updated every minute). */
export function WeekTimeLeft() {
  const { dict } = useApp();
  const { gameState, gameDay } = useGame();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const b = dict.questsPage.q2.boss;
  const left = weekMinutesLeft(now, gameDay, gameState.profile?.timezone);
  const d = Math.floor(left / 1440);
  const h = Math.floor((left % 1440) / 60);
  const m = left % 60;
  return (
    <p className="text-xs font-semibold text-tx" data-testid="challenge-time-left" data-minutes={left}>
      {d > 0 ? formatString(b.timeLeftDays, { d, h }) : formatString(b.timeLeftHours, { h, m })}
    </p>
  );
}

const DAY_TONE: Record<ChallengeDayState, string> = {
  future: "border-dashed border-line bg-transparent text-mu",
  noTrades: "border-line bg-s2 text-mu",
  met: "border-success/40 bg-success/10 text-success",
  notMet: "border-[#e5b98a]/50 bg-[#e5b98a]/10 text-[#e5b98a]",
  insufficientData: "border-line bg-s2 text-mu",
};

/** The seven days by the challenge's conditions (a day without trades is a full day, never a failure). */
export function ChallengeDays({ boss, snapshot, week }: { boss: BossId; snapshot: JournalSnapshot; week: string }) {
  const { dict, lang } = useApp();
  const { gameDay } = useGame();
  const b = dict.questsPage.q2.boss;
  const days = challengeDays(boss, snapshot, week, gameDay);
  return (
    <div className="mt-3">
      <div className="text-xs font-semibold text-mu">{b.daysTitle}</div>
      <ol className="mt-1.5 grid grid-cols-7 gap-1" data-testid="challenge-days">
        {days.map((d, i) => {
          const label = [b.dayStates[d.state], d.trades > 0 ? formatString(b.dayTrades, { n: d.trades }) : ""].filter(Boolean).join(", ");
          return (
            <li key={d.key} className="min-w-0 text-center" data-testid={`challenge-day-${d.key}`} data-state={d.state}>
              <div className="text-[11px] text-mu" aria-hidden="true">
                {dict.questsPage.weekTab.days[WEEKDAY_KEYS[i]]}
              </div>
              <div className={cn("mt-1 grid h-8 place-items-center rounded-lg border text-xs font-bold", DAY_TONE[d.state], d.key === gameDay && "ring-1 ring-inset ring-vi")}>
                <span aria-hidden="true">{b.dayMarks[d.state]}</span>
                <span className="sr-only">{formatString(b.dayAria, { date: formatDayKey(d.key, lang, { weekday: "long", day: "numeric", month: "long" }), state: label })}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function readSeen(): string[] {
  try {
    const raw = AppStorage.getItem(SEEN_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * A trophy. `celebrate`: the first time this person sees a new trophy it appears with a short reveal (none with reduced
 * motion: the «New trophy» line says it instead). Seeing it again shows it plainly.
 */
export function TrophyCard({ trophy, celebrate }: { trophy: WeekTrophy; celebrate?: boolean }) {
  const { dict, lang } = useApp();
  const t = dict.questsPage.q2.trophy;
  const b = dict.questsPage.q2.boss;
  const [isNew, setIsNew] = useState(false);
  useEffect(() => {
    if (!celebrate) return;
    const seen = readSeen();
    if (seen.includes(trophy.week)) return;
    setIsNew(true);
    try {
      AppStorage.setItem(SEEN_KEY, JSON.stringify([trophy.week, ...seen].slice(0, 60)));
    } catch {
      // a viewer convenience only: without storage the reveal may show again
    }
  }, [celebrate, trophy.week]);
  const name = b.names[trophy.boss] ?? trophy.boss;
  return (
    <div
      data-testid="trophy-card"
      data-week={trophy.week}
      data-new={isNew}
      className={cn("flex items-start gap-3 rounded-xl border border-go/50 bg-gradient-to-br from-go/10 to-transparent p-3", isNew && "trophy-reveal")}
    >
      <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-go/20 text-go">
        <Trophy size={20} />
      </span>
      <div className="min-w-0">
        {isNew && (
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-go" data-testid="trophy-new" role="status">
            {t.newOne}
          </p>
        )}
        <p className="font-serif text-[15px] font-bold text-tx">{formatString(t.title, { name })}</p>
        <p className="text-xs text-mu">{formatString(t.week, { range: weekRangeText(trophy.week, lang) })}</p>
        <ul className="mt-1 space-y-0.5 text-xs text-mu">
          {trophy.conditions
            .filter((c) => c.total > 0)
            .map((c) => (
              <li key={c.key}>{formatString(t.conditionLine, { name: b.conditions[c.key as keyof typeof b.conditions] ?? c.key, done: c.done, total: c.total })}</li>
            ))}
        </ul>
      </div>
    </div>
  );
}

/** The closed previous week at the top of the current week: its phase and, for a win, the trophy (celebrated once). */
export function LastWeekResult({ week, onOpen }: { week: string; onOpen: () => void }) {
  const { dict } = useApp();
  const { gameState } = useGame();
  const b = dict.questsPage.q2.boss;
  const last = addDaysToKey(week, -7);
  const snap = gameState.questWeeks?.find((w) => w.week === last);
  const phase = closedPhase(snap);
  if (phase === "none" || !snap?.boss) return null;
  const trophy = gameState.weekTrophies?.find((t) => t.week === last);
  return (
    <section className="rounded-2xl border border-line bg-s1 p-4" data-testid="last-week-result" data-phase={phase}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-vi">{b.lastWeek}</div>
          <h3 className="font-serif text-base font-bold text-tx">{b.names[snap.boss]}</h3>
        </div>
        <PhaseChip phase={phase} />
      </div>
      <div className="mt-3">
        {phase === "completed" && trophy ? (
          <TrophyCard trophy={trophy} celebrate />
        ) : (
          <p className="text-sm text-mu">{phase === "checking" ? b.checkingNote : phase === "notCompleted" ? b.notCompletedNote : b.notApplicableNote}</p>
        )}
      </div>
      <button type="button" onClick={onOpen} className={buttonClasses("ghost", "md", "-ml-3 mt-1 text-vi")} data-testid="last-week-open">
        {b.openWeek}
      </button>
    </section>
  );
}

/** Every trophy, newest first (History and the profile). */
export function WeekTrophies() {
  const { dict } = useApp();
  const { gameState } = useGame();
  const t = dict.questsPage.q2.trophy;
  const list = gameState.weekTrophies || [];
  return (
    <section className="rounded-2xl border border-line bg-s1 p-4" data-testid="week-trophies">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-tx">
          <Trophy size={16} aria-hidden="true" className="text-go" />
          {t.listTitle}
        </h3>
        {list.length > 0 && <span className="text-xs text-mu" data-testid="week-trophies-count">{formatString(t.count, { n: list.length })}</span>}
      </div>
      {list.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {list.map((tr) => (
            <li key={tr.week}>
              <TrophyCard trophy={tr} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-mu">{t.listEmpty}</p>
      )}
      <p className="mt-3 text-xs text-mu">{t.symbolic}</p>
    </section>
  );
}
