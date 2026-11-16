/**
 * QH-8.1 economy simulation of personal quest rewards (docs/quest-hub-qh8-spec.md, section 7).
 *
 * The personal quests run day by day through the model's own rules (canStart, confirmedDays, settleRun), so the limits
 * are real, not assumed: at most 3 active and one per category, a reward only after the 30-day period and a final
 * report, once per run, abandoned runs and early or repeated settles pay nothing, backfilled marks do not count, and an
 * app-confirmed day needs a record saved in the (simulated) Journal that day — a key alone confirms nothing. The rest of
 * the economy is the live QH-6 simulation (simulateLive): missions, habits, journal XP, as they are today.
 *
 * Nothing here is used by the game. Variant C is the approved one (В-19); A and B stay for comparison.
 */

import { addDaysToKey } from "./day-key";
import { xpForNextLevel } from "./game";
import { simulateLive, type Player } from "./econ-sim-qh6";
import {
  PQ_RANK_XP,
  canStart,
  settleRun,
  type PQCategoryId,
  type PQLedgerEntry,
  type PQRank,
  type PQRates,
  type PQRecordCheck,
  type PQRun,
  type PQVerification,
} from "./personal-quests";

export type PQProfile = "none" | "steady" | "engaged" | "max3" | "self3" | "farmer" | "lazy";
export const PQ_PROFILES: PQProfile[] = ["none", "steady", "engaged", "max3", "self3", "farmer", "lazy"];

export type RateVariant = "A" | "B" | "C";
const flat = (bronze: number, silver: number, gold: number): PQRates => ({ app: { bronze, silver, gold }, self: { bronze, silver, gold } });
/** A: the owner's preliminary model for everyone. B: lower rates. C: approved — a self-reported run pays half. */
export const RATE_VARIANTS: Record<RateVariant, PQRates> = {
  A: flat(100, 180, 250),
  B: flat(60, 110, 150),
  C: PQ_RANK_XP,
};

type Slot = { hits: number; verification: PQVerification; category: PQCategoryId };
/** What each profile does: its slots (one category each), how many days of each 30 it really does, how it confirms them. */
const BEHAVIOUR: Record<PQProfile, { slots: Slot[]; tricks: boolean }> = {
  none: { slots: [], tricks: false },
  steady: { slots: [{ hits: 26, verification: "app", category: "learning" }], tricks: false },
  engaged: { slots: [{ hits: 29, verification: "app", category: "learning" }, { hits: 22, verification: "self", category: "habits" }], tricks: false },
  // the most anyone can get: three quests confirmed by AYRA data, every day
  max3: {
    slots: [
      { hits: 30, verification: "app", category: "learning" },
      { hits: 30, verification: "app", category: "trading" },
      { hits: 30, verification: "app", category: "discipline" },
    ],
    tricks: false,
  },
  // the most a self-report can get: three self-reported quests ticked every day
  self3: {
    slots: [
      { hits: 30, verification: "self", category: "physical" },
      { hits: 30, verification: "self", category: "habits" },
      { hits: 30, verification: "self", category: "psychology" },
    ],
    tricks: false,
  },
  // self3 plus every trick the rules must stop
  farmer: {
    slots: [
      { hits: 30, verification: "self", category: "physical" },
      { hits: 30, verification: "self", category: "habits" },
      { hits: 30, verification: "self", category: "psychology" },
    ],
    tricks: true,
  },
  lazy: { slots: [{ hits: 18, verification: "self", category: "physical" }, { hits: 15, verification: "self", category: "habits" }], tricks: false },
};

export interface PQOutcome {
  profile: PQProfile;
  variant: RateVariant;
  days: number;
  settled: number;
  paidRuns: number;
  xp: number;
  ranks: Record<PQRank | "none", number>;
  /**
   * Attempts the rules refused (farmer): a 4th quest, a second quest of an active category, an early or repeated
   * settle, a backfilled mark, a mark pointing to a record that was never saved.
   */
  refused: number;
  maxXpOneDay: number;
}

/** A missed day pattern spread over the period (deterministic): days with index ≥ hits are missed. */
const hitOn = (i: number, hits: number) => ((i * 7) % 30) < hits;

const REPORT = "Итог: что изменилось за тридцать дней, что получилось, что нет и что я делаю дальше — честно и по делу.";

export function simulatePersonal(profile: PQProfile, days = 90, variant: RateVariant = "C", start = "2026-11-16"): PQOutcome {
  const rates = RATE_VARIANTS[variant];
  const b = BEHAVIOUR[profile];
  const runs: PQRun[] = [];
  const ledger: PQLedgerEntry[] = [];
  const ranks: PQOutcome["ranks"] = { bronze: 0, silver: 0, gold: 0, none: 0 };
  // the simulated Journal: records really saved, by key → the day saved (what QH-8.3 checks against)
  const journal = new Map<string, string>();
  const check: PQRecordCheck = (mark) => !!mark.sourceKey && journal.get(mark.sourceKey) === mark.day;
  let refused = 0;
  let xp = 0;
  let maxXpOneDay = 0;
  let seq = 0;
  const startRun = (slot: number, day: string): boolean => {
    const s = b.slots[slot];
    const next = { questId: `q${slot}`, category: s.category, verification: s.verification, title: `Quest ${slot}`, goal: "goal", dailyAction: "action" };
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
        const res = settleRun(run, ledger, REPORT, day, `${day}T20:00:00.000Z`, check, rates);
        if ("entry" in res) {
          ledger.push(res.entry);
          run.status = "completed";
          ranks[res.entry.rank ?? "none"]++;
          xp += res.entry.xp;
          dayXp += res.entry.xp;
          if (b.tricks) {
            // a second settle of the same run (another tab, a reload): refused
            if ("failure" in settleRun(run, ledger, "x".repeat(100), day, `${day}T20:01:00.000Z`, check, rates)) refused++;
            // a second quest in a category that is still active, while a slot is free: refused
            const busy = runs.find((r) => r.status === "active");
            if (busy && canStart(runs, { questId: "dup", category: busy.category, verification: "self", title: "x", goal: "x", dailyAction: "x" }, day) === "categoryActive") refused++;
          }
        }
      }
      if (!run || run.status === "completed") startRun(slot, day);
    }
    if (b.tricks) {
      // a 4th quest: refused
      if (canStart(runs, { questId: "extra", category: "discipline", verification: "self", title: "x", goal: "x", dailyAction: "x" }, day) === "maxActive") refused++;
      // settling a run before its period is over: refused
      const live = runs.find((r) => r.status === "active");
      if (live && "failure" in settleRun(live, ledger, "x".repeat(100), day, `${day}T21:00:00.000Z`, check, rates)) refused++;
    }
    // today's marks (saved on their own day; an app mark points to the record saved in the Journal today)
    for (const run of runs.filter((r) => r.status === "active")) {
      const slot = Number(run.questId.slice(1));
      const idx = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${run.startDay}T00:00:00Z`)) / 86400000);
      if (hitOn(idx, b.slots[slot].hits)) {
        const sourceKey = run.verification === "app" ? `note:${run.id}:${day}` : undefined;
        if (sourceKey) journal.set(sourceKey, day);
        run.marks.push({ day, at: `${day}T19:00:00.000Z`, savedOn: day, source: run.verification, sourceKey });
      }
      if (b.tricks && idx > 0) {
        // a backfilled mark for yesterday (a note may be kept; it never counts) and an app mark with an invented key
        run.marks.push({ day: addDaysToKey(day, -1), at: `${day}T19:05:00.000Z`, savedOn: day, source: run.verification });
        run.marks.push({ day, at: `${day}T19:06:00.000Z`, savedOn: day, source: "app", sourceKey: `note:fake:${day}` });
        refused += 2;
      }
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
export function combined(player: Player, profile: PQProfile, days = 90, variant: RateVariant = "C", base = simulateLive(player, days)): CombinedRow {
  const pq = simulatePersonal(profile, days, variant);
  const total = base.totalXp + pq.xp;
  return { player, profile, variant, days, baseXp: base.totalXp, pqXp: pq.xp, share: total ? pq.xp / total : 0, baseLevel: levelOf(base.totalXp), level: levelOf(total), coins: base.coins };
}
