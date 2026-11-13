"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Flame } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatNumber, formatString } from "@/lib/i18n";
import { xpForNextLevel } from "@/lib/game";
import { titleDisplayName } from "@/lib/titles";
import type { NextStep } from "@/lib/quests-view";
import { Character } from "@/components/Character";
import { buttonClasses } from "@/components/ui/Button";
import { questTitle } from "./quest-text";

interface Props {
  coreDone: number;
  coreTotal: number;
  earned: { xp: number; coins: number };
  next: NextStep;
  /** The button text of a journal step (for example «Set the limits»). */
  nextJournalCta?: string;
  onNextQuest: (questId: string) => void;
}

/** Day progress as a small ring: the three missions of the day at a glance. */
function DayRing({ done, total, label }: { done: number; total: number; label: string }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const part = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div className="relative grid h-12 w-12 shrink-0 place-items-center" role="img" aria-label={label} data-testid="hero-day">
      <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="3" className="stroke-white/[0.08]" />
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-vi transition-[stroke-dashoffset] motion-reduce:transition-none" strokeDasharray={c} strokeDashoffset={c * (1 - part)} />
      </svg>
      <span className="font-serif text-sm font-bold text-tx" aria-hidden="true">
        {done}/{total}
      </span>
    </div>
  );
}

/**
 * The top of Quests (docs/quests-ux-3.0-plan.md, 9): who I am and the day at a glance — the original character in a small
 * frame with the level, name, XP, streak, the day's progress — and one next step.
 */
export function QuestsHeader({ coreDone, coreTotal, earned, next, nextJournalCta, onNextQuest }: Props) {
  const { dict, lang } = useApp();
  const { gameState, effectiveEquipment } = useGame();
  const p = dict.questsPage.q2.page;
  const need = xpForNextLevel(gameState.level);
  const pct = Math.min(100, Math.round((gameState.xp / need) * 100));

  return (
    <section data-testid="quests-hero" className="rounded-2xl border border-line bg-gradient-to-br from-pri/[0.14] via-s1 to-s1 p-3 sm:p-4">
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="relative shrink-0">
          <div className="grid h-[72px] w-14 place-items-end sm:h-[92px] sm:w-[72px] justify-center overflow-hidden rounded-xl bg-[radial-gradient(70%_60%_at_50%_65%,rgb(var(--c-vi)/0.22),transparent_70%)] ring-1 ring-vi/25">
            <Character appearance={gameState.profile.appearance} equipment={effectiveEquipment} size="fill" />
          </div>
          <div className="lvbadge !absolute -bottom-2 -right-2 !h-7 !w-7 !text-xs" aria-label={formatString(p.levelAria, { level: gameState.level })}>
            {gameState.level}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="truncate font-serif text-lg font-bold leading-tight text-tx sm:text-xl">{gameState.name}</h2>
            <span className="hidden truncate text-xs text-mu sm:inline">{titleDisplayName(dict, gameState.selectedTitle)}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-valuemin={0} aria-valuemax={need} aria-valuenow={gameState.xp} aria-label={formatString(p.levelAria, { level: gameState.level })}>
            <span className="block h-full rounded-full bg-gradient-to-r from-pri to-vi" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-xs text-mu">
            <span data-testid="hero-xp">{formatString(p.xp, { xp: formatNumber(lang, gameState.xp), need: formatNumber(lang, need) })}</span>
            <span data-testid="today-earned">{formatString(p.today, { xp: formatNumber(lang, earned.xp), coins: formatNumber(lang, earned.coins) })}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5 sm:gap-3">
          <div className="hidden flex-col items-center sm:flex" data-testid="hero-streak" aria-label={formatString(p.streakAria, { n: gameState.currentStreak, best: gameState.bestStreak })}>
            <Flame size={16} aria-hidden="true" className="text-vi" />
            <span className="text-sm font-semibold text-tx" aria-hidden="true">{formatString(p.streak, { n: gameState.currentStreak })}</span>
          </div>
          <DayRing done={coreDone} total={coreTotal} label={formatString(p.dayAria, { done: coreDone, total: coreTotal })} />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 border-t border-line/70 pt-3">
        <span className="inline-flex items-center gap-1 text-xs text-mu sm:hidden" aria-label={formatString(p.streakAria, { n: gameState.currentStreak, best: gameState.bestStreak })}>
          <Flame size={14} aria-hidden="true" className="text-vi" />
          {formatString(p.streak, { n: gameState.currentStreak })}
        </span>
        <span className="hidden text-xs font-semibold uppercase tracking-[0.12em] text-mu sm:inline">{p.next}</span>
        <NextAction next={next} journalCta={nextJournalCta} onNextQuest={onNextQuest} />
      </div>
    </section>
  );
}

function NextAction({ next, journalCta, onNextQuest }: { next: NextStep; journalCta?: string; onNextQuest: (questId: string) => void }) {
  const { dict, lang } = useApp();
  const p = dict.questsPage.q2.page;
  const cls = buttonClasses("primary", "md", "ml-auto min-w-0 max-w-full justify-between gap-3 text-left sm:max-w-[420px]");
  if (next.kind === "quest" || next.kind === "journal") {
    const title = questTitle(dict, lang, next.quest);
    const label = next.kind === "journal" && journalCta ? journalCta : title;
    const inner = (
      <>
        <span className="min-w-0 truncate">{label}</span>
        <ArrowRight size={16} aria-hidden="true" className="shrink-0" />
      </>
    );
    return next.kind === "journal" ? (
      <Link href={next.href} data-testid="hero-next" className={cls} aria-label={`${p.next}: ${label}`}>
        {inner}
      </Link>
    ) : (
      <button type="button" data-testid="hero-next" onClick={() => onNextQuest(next.quest.id)} className={cls} aria-label={`${p.next}: ${label}`}>
        {inner}
      </button>
    );
  }
  return (
    <p data-testid="hero-next" className="ml-auto text-sm font-semibold text-tx">
      {next.kind === "rest" ? p.nextRest : p.nextDone}
    </p>
  );
}
