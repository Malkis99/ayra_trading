"use client";

import React from "react";
import { Brain, Dumbbell, GraduationCap, LineChart, Repeat, ShieldCheck, type LucideIcon } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { PQ_PERIOD_DAYS, PQ_RANKS, PQ_RANK_DAYS, PQ_RANK_XP, type PQCategoryId, type PQRank, type PQVerification } from "@/lib/personal-quests";
import { cn } from "@/components/ui/cn";

// Shared pieces of «My path» (QH-8.2, QH-8.3): category signs, verification labels, the rewards table, ids, errors.

export const CATEGORY_ICONS: Record<PQCategoryId, LucideIcon> = {
  discipline: ShieldCheck,
  physical: Dumbbell,
  learning: GraduationCap,
  psychology: Brain,
  trading: LineChart,
  habits: Repeat,
};

/** A new id for a run or a quest (stable once made: the same request is never saved twice). */
export function newPqId(prefix: "pq" | "pqq"): string {
  const c = typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  const raw = c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}_${raw.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

/** The category sign: a violet tile with its icon. */
export function CategoryIcon({ category, size = "md" }: { category: PQCategoryId; size?: "sm" | "md" }) {
  const Icon = CATEGORY_ICONS[category];
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-xl border border-vi/30 bg-vi/10 text-vi", size === "md" ? "h-11 w-11" : "h-8 w-8")} aria-hidden="true">
      <Icon size={size === "md" ? 20 : 16} />
    </span>
  );
}

/** The verification label: a self-report always says so in words, never only by colour. */
export function VerificationLabel({ verification }: { verification: PQVerification }) {
  const { dict } = useApp();
  return (
    <span
      data-testid="pq-verification"
      data-verification={verification}
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", verification === "app" ? "border-success/40 bg-success/10 text-success" : "border-line bg-s2 text-mu")}
    >
      {dict.personalQuests.verification[verification]}
    </span>
  );
}

/** Rewards by rank (variant C): one column for a verification, or both. Shown as a future reward — nothing is given here. */
export function RewardTable({ verification, testId = "pq-rewards" }: { verification?: PQVerification; testId?: string }) {
  const { dict } = useApp();
  const p = dict.personalQuests;
  const cols: PQVerification[] = verification ? [verification] : ["app", "self"];
  const ranks = [...PQ_RANKS].reverse();
  const range = (r: PQRank) => (r === "gold" ? `${PQ_RANK_DAYS.gold}–${PQ_PERIOD_DAYS}` : r === "silver" ? `${PQ_RANK_DAYS.silver}–${PQ_RANK_DAYS.gold - 1}` : `${PQ_RANK_DAYS.bronze}–${PQ_RANK_DAYS.silver - 1}`);
  return (
    <table className="w-full text-sm" data-testid={testId}>
      {!verification && (
        <thead>
          <tr className="text-left text-[11px] text-mu">
            <th scope="col" className="pb-1 font-semibold" />
            <th scope="col" className="pb-1 text-right font-semibold">{p.path.rail.rewardsApp}</th>
            <th scope="col" className="pb-1 text-right font-semibold">{p.path.rail.rewardsSelf}</th>
          </tr>
        </thead>
      )}
      <tbody className="divide-y divide-line/60">
        {ranks.map((r) => (
          <tr key={r} data-rank={r}>
            <th scope="row" className="py-1.5 text-left font-medium text-tx">
              {formatString(p.path.rankRow, { rank: p.ranks[r], days: range(r) })}
            </th>
            {cols.map((v) => (
              <td key={v} className={cn("py-1.5 text-right font-semibold", r === "gold" ? "text-go" : "text-tx")} data-testid={`pq-xp-${r}-${v}`}>
                {formatString(p.path.rankXp, { xp: PQ_RANK_XP[v][r] })}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function errorText(dict: ReturnType<typeof useApp>["dict"], reason?: string): string {
  const e = dict.personalQuests.path.errors as Record<string, string>;
  return (reason && e[reason]) || e.notSaved;
}
