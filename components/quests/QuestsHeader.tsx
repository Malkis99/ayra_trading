"use client";

import React from "react";
import { Coins, Flame } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatNumber, formatString } from "@/lib/i18n";
import { xpForNextLevel } from "@/lib/game";
import { titleDisplayName } from "@/lib/titles";
import { Character } from "@/components/Character";

/** One number of the profile strip: a compact chip on a phone, a small block with its label from `sm`. */
function Stat({ icon, value, label, extra, sr, testId, phoneLabel }: { icon?: React.ReactNode; value: React.ReactNode; label: string; extra?: string; sr: string; testId?: string; phoneLabel?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5 sm:block sm:rounded-xl sm:bg-white/[0.04] sm:px-3.5 sm:py-2">
      <span className="sr-only" data-testid={testId}>
        {sr}
      </span>
      <div className="flex items-center gap-1.5 whitespace-nowrap text-sm font-bold text-tx sm:text-[15px]" aria-hidden="true">
        {icon}
        {value}
      </div>
      <div className={`truncate text-xs text-mu ${phoneLabel ? "" : "hidden sm:block"}`} aria-hidden="true">
        {label}
        {extra && <span className="hidden sm:inline">{extra}</span>}
      </div>
    </div>
  );
}

/**
 * The profile strip of the Quest Hub (docs/quest-hub-plan.md, 2–3): the original character in a frame with the level,
 * the name, XP to the next level, the streak, Coins and today's earnings. The same on every tab.
 */
export function QuestsHeader({ earned }: { earned: { xp: number; coins: number } }) {
  const { dict, lang } = useApp();
  const { gameState, effectiveEquipment } = useGame();
  const p = dict.questsPage.q2.page;
  const h = dict.questsPage.q2.hub;
  const need = xpForNextLevel(gameState.level);
  const pct = Math.min(100, Math.round((gameState.xp / need) * 100));
  const todayText = formatString(p.today, { xp: formatNumber(lang, earned.xp), coins: formatNumber(lang, earned.coins) });

  return (
    <section
      data-testid="quests-hero"
      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 rounded-2xl border border-line bg-s1 bg-[radial-gradient(90%_160%_at_0%_0%,rgb(var(--c-pri)/0.22),transparent_60%)] px-3 py-3 sm:gap-x-5 sm:px-[18px] sm:py-3.5 lg:grid-cols-[auto_minmax(0,1fr)_auto]"
    >
      <div className="relative shrink-0">
        {/* a portrait crop of the whole figure: the character is only scaled, never stretched */}
        <div className="relative h-[60px] w-12 overflow-hidden rounded-xl bg-ink bg-[radial-gradient(75%_55%_at_50%_30%,rgb(var(--c-vi)/0.28),transparent_72%)] shadow-[inset_0_-14px_18px_-12px_rgb(var(--c-pri)/0.55)] ring-1 ring-vi/40 sm:h-[92px] sm:w-[72px]">
          <div className="absolute left-1/2 top-0 h-[150px] w-[66px] -translate-x-1/2 sm:h-[228px] sm:w-[99px]">
            <Character appearance={gameState.profile.appearance} equipment={effectiveEquipment} size="fill" />
          </div>
        </div>
        <div className="lvbadge !absolute -bottom-1.5 -right-1.5 !h-6 !w-6 !text-[11px] sm:!h-7 sm:!w-7 sm:!text-xs" aria-label={formatString(p.levelAria, { level: gameState.level })}>
          {gameState.level}
        </div>
      </div>

      <div className="min-w-0 sm:max-w-[520px]">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate font-serif text-lg font-bold leading-tight text-tx sm:text-[21px]">{gameState.name}</h2>
          <span className="hidden truncate text-xs text-mu sm:inline">{titleDisplayName(dict, gameState.selectedTitle)}</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-valuemin={0} aria-valuemax={need} aria-valuenow={gameState.xp} aria-label={formatString(p.levelAria, { level: gameState.level })}>
          <span className="block h-full rounded-full bg-gradient-to-r from-pri to-vi" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3 text-xs text-mu">
          <span data-testid="hero-xp">{formatString(p.xp, { xp: formatNumber(lang, gameState.xp), need: formatNumber(lang, need) })}</span>
          <span className="hidden sm:inline">{formatString(h.toLevel, { level: gameState.level + 1 })}</span>
        </div>
      </div>

      <div className="col-span-2 flex items-center gap-x-5 border-t border-line/60 pt-2 sm:gap-2 lg:col-span-1 lg:border-0 lg:pt-0">
        <Stat
          testId="hero-streak"
          sr={formatString(p.streakAria, { n: gameState.currentStreak, best: gameState.bestStreak })}
          icon={<Flame size={15} aria-hidden="true" className="text-vi" />}
          value={formatNumber(lang, gameState.currentStreak)}
          label={h.streakLabel}
          extra={formatString(h.streakBest, { best: gameState.bestStreak })}
        />
        <Stat
          sr={`${formatNumber(lang, gameState.coins)} ${h.coins}`}
          icon={<Coins size={15} aria-hidden="true" className="text-go" />}
          value={<span className="text-go">{formatNumber(lang, gameState.coins)}</span>}
          label={h.coins}
        />
        <div className="ml-auto min-w-0 lg:ml-0">
          <Stat
            testId="today-earned"
            sr={todayText}
            value={formatString(h.todayXp, { xp: formatNumber(lang, earned.xp) })}
            label={h.todayLabel}
            phoneLabel
            extra={earned.coins > 0 ? formatString(h.todayCoins, { coins: formatNumber(lang, earned.coins) }) : undefined}
          />
        </div>
      </div>
    </section>
  );
}
