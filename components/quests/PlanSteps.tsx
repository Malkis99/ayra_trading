"use client";

import React from "react";
import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { QUEST_POOL, questReward } from "@/lib/quests";
import type { MissionStep } from "@/lib/quest-engine";
import { buttonClasses } from "@/components/ui/Button";

/**
 * The day plan in the journal as one short checklist (the morning protocol and the end-of-day review). It has no reward
 * of its own; a step that closes an existing journal quest shows that reward, the others are preparation only.
 */
export function PlanSteps({ protocol, ritual, hrefFor }: { protocol: MissionStep[]; ritual: MissionStep[]; hrefFor: (step: MissionStep) => string }) {
  const { dict } = useApp();
  const p = dict.questsPage.q2.page;
  const t = dict.questsPage.q2.protocol;
  const all = [...protocol, ...ritual];
  const done = all.filter((s) => s.state === "done").length;
  const rewardText = (questId: string) => {
    const tpl = QUEST_POOL.find((q) => q.id === questId);
    if (!tpl) return "";
    const r = questReward(tpl);
    return r.coins > 0 ? formatString(dict.questsPage.todayTab.rewardXpCoins, { xp: r.xp, coins: r.coins }) : formatString(dict.questsPage.todayTab.rewardXp, { xp: r.xp });
  };

  const row = (s: MissionStep) => (
    <li key={s.key} data-testid={`mission-step-${s.key}`} data-state={s.state} className="flex min-h-[44px] items-center gap-3 py-1.5">
      {s.state === "done" ? <Check size={16} aria-hidden="true" className="shrink-0 text-success" /> : <Circle size={16} aria-hidden="true" className="shrink-0 text-mu/70" />}
      <span className={s.state === "done" ? "min-w-0 flex-1 text-sm text-mu" : "min-w-0 flex-1 text-sm text-tx"}>
        {t.steps[s.key]}
        {s.rewardQuest && <span className="block text-xs font-semibold text-tx/70">{formatString(t.rewardStep, { reward: rewardText(s.rewardQuest) })}</span>}
      </span>
      {s.state !== "done" && (
        <Link href={hrefFor(s)} className={buttonClasses("ghost", "sm", "shrink-0")} data-testid={`mission-step-go-${s.key}`} aria-label={`${p.go}: ${t.steps[s.key]}`}>
          {p.go}
        </Link>
      )}
    </li>
  );

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-s1/60 p-4" aria-labelledby="plan-steps-title">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="plan-steps-title" className="text-sm font-semibold text-tx">{p.plan}</h3>
        <span className="text-xs text-mu" data-testid="plan-steps-count">{formatString(p.count, { done, total: all.length })}</span>
      </div>
      {protocol.length > 0 && (
        <ol data-testid="mission-morning_protocol" className="mt-1 divide-y divide-line/60">
          {protocol.map(row)}
        </ol>
      )}
      {ritual.length > 0 && (
        <ol data-testid="mission-eod_ritual" className={protocol.length > 0 ? "divide-y divide-line/60 border-t border-line/60" : "mt-1"}>
          {ritual.map(row)}
        </ol>
      )}
    </section>
  );
}
