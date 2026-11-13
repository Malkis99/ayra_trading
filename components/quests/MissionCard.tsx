"use client";

import React from "react";
import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { QUEST_POOL, questReward } from "@/lib/quests";
import type { MissionStep } from "@/lib/quest-engine";
import { buttonClasses } from "@/components/ui/Button";
import { VerificationBadge } from "./VerificationBadge";

/**
 * A composite mission (morning protocol, end-of-day ritual): its steps from the day plan. It has no reward of its own;
 * a step that closes an existing quest shows that quest's existing reward.
 */
export function MissionCard({
  id,
  kicker,
  title,
  desc,
  steps,
  hasPlan,
  hrefFor,
}: {
  id: string;
  kicker: string;
  title: string;
  desc: string;
  steps: MissionStep[];
  hasPlan: boolean;
  /** The exact block of the day plan for an open step. */
  hrefFor: (step: MissionStep) => string;
}) {
  const { dict } = useApp();
  const t = dict.questsPage.q2.protocol;
  const done = steps.filter((s) => s.state === "done").length;
  const rewardText = (questId: string) => {
    const tpl = QUEST_POOL.find((q) => q.id === questId);
    if (!tpl) return "";
    const r = questReward(tpl);
    return r.coins > 0
      ? formatString(dict.questsPage.todayTab.rewardXpCoins, { xp: r.xp, coins: r.coins })
      : formatString(dict.questsPage.todayTab.rewardXp, { xp: r.xp });
  };
  return (
    <section data-testid={`mission-${id}`} className="rounded-[18px] border border-vi/30 bg-gradient-to-br from-pri/20 via-s1 to-s1 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-vi">{kicker}</div>
          <h3 className="mt-0.5 font-serif text-lg font-bold text-tx">{title}</h3>
          <p className="mt-1 text-[13px] text-mu">{desc}</p>
        </div>
        <span className="whitespace-nowrap rounded-full bg-s2 px-2.5 py-0.5 text-xs font-semibold text-tx" data-testid={`mission-${id}-progress`}>
          {formatString(t.progress, { done, total: steps.length })}
        </span>
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.key} data-testid={`mission-step-${s.key}`} data-state={s.state} className="grid grid-cols-[22px_minmax(0,1fr)] items-start gap-3 rounded-md bg-ink/50 px-3 py-2.5 sm:grid-cols-[22px_minmax(0,1fr)_auto] sm:items-center">
            {s.state === "done" ? (
              <Check size={18} aria-hidden="true" className="mt-0.5 text-success sm:mt-0" />
            ) : (
              <Circle size={18} aria-hidden="true" className="mt-0.5 text-mu sm:mt-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm text-tx">{t.steps[s.key]}</div>
              <div className={s.rewardQuest ? "text-xs font-semibold text-tx/80" : "text-xs text-mu"}>
                {s.rewardQuest ? formatString(t.rewardStep, { reward: rewardText(s.rewardQuest) }) : t.progressOnly}
              </div>
            </div>
            <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3">
              <VerificationBadge source="journal" label={dict.questsPage.q1.card.badgeJournal} />
              {s.state !== "done" && (
                <Link
                  href={hrefFor(s)}
                  className={buttonClasses("ghost", "sm")}
                  data-testid={`mission-step-go-${s.key}`}
                  aria-label={`${t.go}: ${t.steps[s.key]}`}
                >
                  {t.go}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {!hasPlan && <span className="text-xs text-mu">{t.noPlan}</span>}
        <Link href="/journal?tab=plan" className={buttonClasses("secondary", "sm", "ml-auto")}>
          {t.openPlan}
        </Link>
      </div>
    </section>
  );
}
