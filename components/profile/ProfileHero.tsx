"use client";

import React from "react";
import Link from "next/link";
import { Palette, Shirt } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useAuth } from "@/lib/auth/auth-context";
import { Character } from "@/components/Character";
import { cn } from "@/components/ui/cn";
import { xpForNextLevel } from "@/lib/game";
import { TITLES_CATALOG } from "@/lib/titles";
import { formatNumber, formatString } from "@/lib/i18n";

/** Small cosmic stage behind the character (nebula, soft floor glow). Purely decorative. */
export function CosmicStage({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative isolate overflow-hidden rounded-2xl border border-vi/25 bg-[#0d0b14]", className)}>
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(55% 50% at 50% 40%, rgba(163,138,209,0.28), transparent 70%), radial-gradient(90% 55% at 50% 100%, rgba(80,52,143,0.55), transparent 70%), radial-gradient(30% 25% at 20% 20%, rgba(163,138,209,0.12), transparent 70%)",
        }}
      />
      <div aria-hidden="true" className="absolute bottom-[7%] left-1/2 -z-10 h-5 w-[55%] -translate-x-1/2 rounded-[50%] bg-vi/35 blur-md" />
      {children}
    </div>
  );
}

export function titleName(dict: ReturnType<typeof useApp>["dict"], titleId: string): string {
  const byId = dict.titles.byId as Record<string, string>;
  return byId[titleId] || byId.novice;
}

type Props = { onEditCharacter: () => void; onOpenWardrobe: () => void };

/** Top of the profile: the character on a cosmic stage, nickname, level with XP to the next level, rank, plan. */
export function ProfileHero({ onEditCharacter, onOpenWardrobe }: Props) {
  const { dict, lang } = useApp();
  const { gameState } = useGame();
  const { authState } = useAuth();
  const h = dict.profile.hero;
  const isSignedIn = authState === "authenticated";
  const next = xpForNextLevel(gameState.level);
  const pct = Math.min(100, Math.round((gameState.xp / next) * 100));
  const title = TITLES_CATALOG.find((t) => t.id === gameState.selectedTitle) || TITLES_CATALOG[0];

  return (
    <section aria-label={h.label} className="relative overflow-hidden rounded-2xl border border-line bg-s1/80 p-3 sm:p-5">
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-pri/20 blur-3xl" />
      <div className="relative flex items-stretch gap-3 sm:gap-6">
        <CosmicStage className="w-[104px] shrink-0 sm:w-[180px] lg:w-[210px]">
          <div className="flex h-[176px] items-end justify-center pb-[6%] pt-3 sm:h-[260px] lg:h-[300px]">
            <div className="h-full" style={{ aspectRatio: "100 / 230" }}>
              <Character appearance={gameState.profile.appearance} equipment={gameState.equipment} size="fill" className="h-full w-full" />
            </div>
          </div>
        </CosmicStage>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-3 sm:gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-all font-serif text-2xl font-bold leading-tight text-tx sm:text-4xl" data-testid="profile-nickname">
                {gameState.name}
              </h1>
              {!isSignedIn && (
                <span className="rounded-md bg-vi/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-vi">{h.guest}</span>
              )}
            </div>
            <p className="mt-1 text-sm text-mu">
              <span className="sr-only">{h.rank}: </span>
              <span className="font-semibold text-vi">{titleName(dict, title.id)}</span>
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="font-serif text-lg font-semibold text-tx sm:text-xl">{formatString(h.level, { level: gameState.level })}</span>
              <span className="text-xs tabular-nums text-mu">
                {formatString(h.xp, { xp: formatNumber(lang, gameState.xp), next: formatNumber(lang, next), nextLevel: gameState.level + 1 })}
              </span>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-s2"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={next}
              aria-valuenow={gameState.xp}
              aria-label={formatString(h.level, { level: gameState.level })}
            >
              <div className="h-full rounded-full bg-gradient-to-r from-pri to-vi transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onEditCharacter}
              className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-xl bg-pri px-2.5 text-[13px] sm:gap-2 sm:px-4 sm:text-sm font-semibold text-white shadow-[0_8px_20px_-10px_rgba(163,138,209,0.9)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
            >
              <Palette size={16} aria-hidden="true" />
              <span>{h.editCharacter}</span>
            </button>
            <button
              type="button"
              onClick={onOpenWardrobe}
              className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-xl border border-edge bg-s2/60 px-2.5 text-[13px] sm:gap-2 sm:px-4 sm:text-sm font-semibold text-tx transition hover:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
            >
              <Shirt size={16} aria-hidden="true" />
              <span>{h.wardrobe}</span>
            </button>
            {isSignedIn && (
              <Link
                href="/plans"
                className="inline-flex min-h-[32px] items-center rounded-lg border border-vi/50 bg-vi/10 px-2.5 text-xs font-semibold text-tx transition hover:bg-vi/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
              >
                ★ {gameState.plan}
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
