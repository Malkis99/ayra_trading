/**
 * QH-8.1 economy simulation of personal quest rewards (docs/quest-hub-qh8-spec.md, section 7).
 *
 * The personal quests run day by day through the model's own rules (canStart, confirmedDays, settleRun), so the limits
 * are real, not assumed: at most 3 active, a reward only after the 30-day period and a final report, once per run,
 * abandoned runs and early or repeated settles pay nothing, backfilled marks do not count. The rest of the economy is
 * the live QH-6 simulation (simulateLive): missions, habits, journal XP, as they are today.
 *
 * Nothing here is used by the game; the rates are the owner's preliminary model plus two variants for comparison.
 */

import { addDaysToKey } from "./day-key";
import { xpForNextLevel } from "./game";
import { simulateLive, type Player } from "./econ-sim-qh6";
import { PROPOSED_RANK_XP, canStart, confirmedDays, settleRun, type PQLedgerEntry, type PQRank, type PQRun, type PQVerification } from "./personal-quests";

export type PQProfile = "none" | "steady" | "engaged" | "max3" | "farmer" | "lazy";
export const PQ_PROFILES: PQProfile[] = ["none", "steady", "engaged", "max3", "farmer", "lazy"];

export type RateVariant = "A" | "B" | "C";
/** A: the owner's preliminary model. B: lower rates. C: A, but a self-reported run pays half (proposal). */
export const RATE_VARIANTS: Record<RateVariant, { rates: Record<PQRank, number>; selfFactor: number }> = {
  A: { rates: PROPOSED_RANK_XP, selfFactor: 1 },
  B: { rates: { bronze: 60, silver: 110, gold: 150 }, selfFactor: 1 },
  C: { rates: PROPOSED_RANK_XP, selfFactor: 0.5 },
};

/** What each profile does: its slots, how many days of each 30 it really does, how it confirms them. */
const BEHAVIOUR: Record<PQProfile, { slots: Array<{ hits: number; verification: PQVerification }>; tricks: boolean }> = {
  none: { slots: [], tricks: false },
  steady: { slots: [{ hits: 26, verification: "app" }], tricks: false },
  engaged: { slots: [{ hits: 29, verification: "app" }, { hits: 22, verification: "self" }], tricks: false },
  // the most anyone can honestly do: three quests, every day
  max3: { slots: [{ hits: 30, verification: "app" }, { hits: 30, verification: "app" }, { hits: 30, verification: "self" }], tricks: false },
  // ticks three self-reported quests every day and tries every trick the rules must stop
  farmer: { slots: [{ hits: 30, verification: "self" }, { hits: 30, verification: "self" }, { hits: 30, verification: "self" }], tricks: true },
  lazy: { slots: [{ hits: 18, verification: "self" }, { hits: 15, verification: "self" }], tricks: false },
};

export interface PQOutcome {
  profile: PQProfile;
  variant: RateVariant;
  days: number;
  settled: number;
  paidRuns: number;
  xp: number;
  ranks: Record<PQRank | "none", number>;
  /** Attempts the rules refused (farmer): a 4th quest, early or repeated settles, abandon-and-restart. */
  refused: number;
  maxXpOneDay: number;
}

/** A missed day pattern spread over the period (deterministic): days with index ≥ hits are missed. */
const hitOn = (i: number, hits: number) => ((i * 7) % 30) < hits;

export function simulatePersonal(profile: PQProfile, days = 90, variant: RateVariant = "A", start = "2026-11-16"): PQOutcome {
  const { rates, selfFactor } = RATE_VARIANTS[variant];
  const b = BEHAVIOUR[profile];
  const runs: PQRun[] = [];
  const ledger: PQLedgerEntry[] = [];
  const ranks: PQOutcome["ranks"] = { bronze: 0, silver: 0, gold: 0, none: 0 };
  let refused = 0;
  let xp = 0;
  let maxXpOneDay = 0;
  let seq = 0;
  const startRun = (slot: number, day: string): boolean => {
    const s = b.slots[slot];
    const next = { questId: `q${slot}`, category: (s.verification === "app" ? "learning" : "habits") as PQRun["category"], verification: s.verification, title: `Quest ${slot}`, goal: "goal", dailyAction: "action" };
    if (canStart(runs, next, day)) return false;
    runs.push({ ...next, id: `r${++seq}`, startState: "", expectedResult: "", startDay: day, marks: [], status: "active" });
    return true;
  };
  for (let d = 0; d < days; d++) {
    const day = addDaysToKey(start, d);
    let dayXp = 0;
    // settle what has ended (the report the day after the last day), then start the next run in that slot
    for (let slot = 0; slot < b.slots.length; slot++) {
      const run = runs.filter((r) => r.questId === `q${slot}`).pop();
      if (run && run.status === "active" && day > addDaysToKey(run.startDay, 29)) {
        const res = settleRun(run, ledger, "Итог: что изменилось за тридцать дней, что получилось, что нет и что я делаю дальше — честно и по делу.", day, `${day}T20:00:00.000Z`, rates);
        if ("entry" in res) {
          const pay = Math.round(res.entry.xp * (res.entry.verification === "self" ? selfFactor : 1));
          ledger.push({ ...res.entry, xp: pay });
          run.status = "completed";
          ranks[res.entry.rank ?? "none"]++;
          xp += pay;
          dayXp += pay;
          if (b.tricks) {
            // a second settle of the same run (another tab, a reload): refused
            if ("failure" in settleRun(run, ledger, "x".repeat(100), day, `${day}T20:01:00.000Z`, rates)) refused++;
          }
        }
      }
      if (!run || run.status === "completed") startRun(slot, day);
    }
    if (b.tricks) {
      // a 4th quest: refused
      if (canStart(runs, { questId: "extra", category: "habits", verification: "self", title: "x", goal: "x", dailyAction: "x" }, day) === "maxActive") refused++;
      // settling a run before its period is over: refused
      const live = runs.find((r) => r.status === "active");
      if (live && "failure" in settleRun(live, ledger, "x".repeat(100), day, `${day}T21:00:00.000Z`, rates)) refused++;
    }
    // today's marks (saved on their own day); the farmer also backfills earlier days, which never count
    for (const run of runs.filter((r) => r.status === "active")) {
      const slot = Number(run.questId.slice(1));
      const idx = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${run.startDay}T00:00:00Z`)) / 86400000);
      if (hitOn(idx, b.slots[slot].hits)) run.marks.push({ day, at: `${day}T19:00:00.000Z`, savedOn: day, source: run.verification, sourceKey: run.verification === "app" ? `note:${run.id}:${day}` : undefined });
      if (b.tricks && idx > 0) run.marks.push({ day: addDaysToKey(day, -1), at: `${day}T19:05:00.000Z`, savedOn: day, source: run.verification });
    }
    maxXpOneDay = Math.max(maxXpOneDay, dayXp);
  }
  return { profile, variant, days, settled: ledger.length, paidRuns: ledger.filter((e) => e.xp > 0).length, xp, ranks, refused, maxXpOneDay };
}

/* ------------------------------------------------------------------ with the rest of the economy */

export function levelOf(total: number): number {
  let lv = 1;
  while (total >= xpForNextLevel(lv)) {
    total -= xpForNextLevel(lv);
    lv++;
  }
  return lv;
}

export interface CombinedRow {
  player: Player;
  profile: PQProfile;
  variant: RateVariant;
  days: number;
  baseXp: number;
  pqXp: number;
  /** Personal quest XP as a share of all XP. */
  share: number;
  baseLevel: number;
  level: number;
  coins: number;
}

/** The live economy of a player (today's rules) plus a personal quest profile. Coins never change: rewards are XP only. */
export function combined(player: Player, profile: PQProfile, days = 90, variant: RateVariant = "A", base = simulateLive(player, days)): CombinedRow {
  const pq = simulatePersonal(profile, days, variant);
  const total = base.totalXp + pq.xp;
  return { player, profile, variant, days, baseXp: base.totalXp, pqXp: pq.xp, share: total ? pq.xp / total : 0, baseLevel: levelOf(base.totalXp), level: levelOf(total), coins: base.coins };
}
