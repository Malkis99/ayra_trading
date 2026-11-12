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
  weekCount: number;
  next: NextStep;
  onNextQuest: (questId: string) => void;
}

/** Top of the page: the character, level and XP, the mission of the day, the week, the streak and one next step. */
export function QuestsHero({ coreDone, coreTotal, weekCount, next, onNextQuest }: Props) {
  const { dict, lang } = useApp();
  const { gameState, effectiveEquipment } = useGame();
  const h = dict.questsPage.q1.hero;
  const need = xpForNextLevel(gameState.level);
  const pct = Math.min(100, Math.round((gameState.xp / need) * 100));

  return (
    <section
      data-testid="quests-hero"
      className="relative grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 gap-y-4 overflow-hidden rounded-[20px] border border-line bg-gradient-to-br from-pri/25 via-s1/90 to-s1 p-4 sm:grid-cols-[132px_minmax(0,1fr)] sm:p-5 lg:grid-cols-[170px_minmax(0,1fr)_300px]"
    >
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 -right-16 h-64 w-96 rounded-full bg-vi/10 blur-3xl" />

      <div className="relative grid place-items-end justify-center lg:row-span-2">
        <span aria-hidden="true" className="absolute bottom-1 h-6 w-24 rounded-[50%] bg-vi/25 blur-md sm:w-32" />
        <span aria-hidden="true" className="absolute bottom-2.5 h-3.5 w-20 rounded-[50%] border border-vi/35 sm:w-28" />
        <div className="relative h-[128px] w-full sm:h-[190px]">
          <Character appearance={gameState.profile.appearance} equipment={effectiveEquipment} size="fill" />
        </div>
      </div>

      <div className="flex min-w-0 flex-col justify-center gap-3">
      <div className="flex min-w-0 items-center gap-3.5">
        <div className="lvbadge !h-[46px] !w-[46px] !text-lg sm:!h-[52px] sm:!w-[52px] sm:!text-xl" aria-label={formatString(h.level, { level: gameState.level })}>
          {gameState.level}
        </div>
        <div className="min-w-0">
          <div className="break-all font-serif text-lg font-bold leading-tight text-tx sm:text-2xl">{gameState.name}</div>
          <div className="text-[13px] text-mu">{titleDisplayName(dict, gameState.selectedTitle)}</div>
        </div>
      </div>
        <div>
          <div className="mb-1.5 flex justify-between gap-2 text-xs text-mu">
            <span>{h.xpLabel}</span>
            <span data-testid="hero-xp">{formatString(h.xpValue, { xp: formatNumber(lang, gameState.xp), need: formatNumber(lang, need) })}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-valuemin={0} aria-valuemax={need} aria-valuenow={gameState.xp} aria-label={h.xpLabel}>
            <span className="block h-full rounded-full bg-gradient-to-r from-pri to-vi" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="col-span-2 min-w-0 rounded-lg border border-line bg-ink/55 p-3.5 lg:col-span-1 lg:col-start-2 lg:row-start-2" data-testid="hero-mission">
        <div className="text-xs font-bold uppercase tracking-[0.14em] text-vi">{h.missionKicker}</div>
        {gameState.isRestDay ? (
          <div className="mt-1 font-serif text-base font-semibold text-tx">{h.restMission}</div>
        ) : (
          <>
            <div className="mt-1 font-serif text-base font-semibold text-tx">{h.missionTitle}</div>
            <div className="text-xs text-mu">{formatString(h.missionProgress, { done: coreDone, total: coreTotal })}</div>
            <div className="mt-2 flex gap-1.5" aria-hidden="true">
              {Array.from({ length: coreTotal }, (_, i) => (
                <span key={i} className={`h-1 flex-1 rounded ${i < coreDone ? "bg-vi" : "bg-white/[0.08]"}`} />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="col-span-2 flex min-w-0 flex-col gap-2.5 lg:col-span-1 lg:col-start-3 lg:row-span-2 lg:row-start-1">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-lg border border-line bg-ink/55 p-3">
            <div className="text-xs text-mu">{h.weekLabel}</div>
            <div className="font-serif text-xl font-bold text-tx" data-testid="hero-week-count">{formatNumber(lang, weekCount)}</div>
          </div>
          <div className="rounded-lg border border-line bg-ink/55 p-3">
            <div className="flex items-center gap-1 text-xs text-mu">
              <Flame size={13} aria-hidden="true" className="text-vi" />
              {h.streakLabel}
            </div>
            <div className="font-serif text-xl font-bold text-tx" data-testid="hero-streak">
              {formatString(h.streakValue, { n: gameState.currentStreak })}
            </div>
            <div className="text-xs text-mu">{formatString(h.streakBest, { best: gameState.bestStreak })}</div>
          </div>
        </div>
        <NextStepAction next={next} onNextQuest={onNextQuest} />
      </div>
    </section>
  );
}

function NextStepAction({ next, onNextQuest }: { next: NextStep; onNextQuest: (questId: string) => void }) {
  const { dict, lang } = useApp();
  const h = dict.questsPage.q1.hero;
  if (next.kind === "quest") {
    return (
      <button type="button" data-testid="hero-next" onClick={() => onNextQuest(next.quest.id)} className={buttonClasses("primary", "md", "w-full py-2.5 text-left lg:mt-auto")}>
        <span className="min-w-0 flex-1 leading-snug">{formatString(h.nextQuest, { title: questTitle(dict, lang, next.quest) })}</span>
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    );
  }
  if (next.kind === "journal") {
    return (
      <Link href={next.href} data-testid="hero-next" className={buttonClasses("primary", "md", "w-full py-2.5 text-left lg:mt-auto")}>
        <span className="min-w-0 flex-1 leading-snug">{formatString(h.nextJournal, { title: questTitle(dict, lang, next.quest) })}</span>
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    );
  }
  return (
    <p data-testid="hero-next" className="rounded-lg bg-s2/70 p-3 text-sm text-mu lg:mt-auto">
      {next.kind === "rest" ? h.nextRest : h.nextDone}
    </p>
  );
}
