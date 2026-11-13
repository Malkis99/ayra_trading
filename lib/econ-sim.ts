/**
 * Economy simulation (docs/quests-2.0-plan.md, 5.3; Q2). Runs the real game rules of lib/game.ts — no separate model —
 * for three kinds of players over N days and reports XP, coins and where the XP came from. The approved daily cap on
 * self-report XP (GAME_CONFIG.SELF_REPORT_DAILY_XP_CAP, 2026-11-13) is part of those rules.
 *
 * Run: npx vite-node scripts/econ-sim.ts
 */
import {
  INITIAL_GAME_STATE,
  checkAndApplyDateResets,
  claimDailyReward,
  completeSelfReportQuest,
  evaluatePlanQuestClosure,
  grantFirstAction,
  recordLoggedTrade,
  recordNoTradeEntry,
  recordNoteSaved,
  recordScreenshotAdded,
  setDayMode,
  xpForNextLevel,
  type GameState,
} from "./game";
import { addDaysToKey, weekdayOfKey } from "./day-key";
import { APP_CLOSED_QUESTS, getTodaysQuests } from "./quests";
import type { DayMode } from "./quest-engine";

export type Profile = "honest" | "active" | "farmer";

export interface DayLog {
  day: string;
  selfXp: number;
  totalXp: number;
  coins: number;
}

export interface SimResult {
  profile: Profile;
  days: number;
  totalXp: number;
  coins: number;
  level: number;
  selfXp: number;
  log: DayLog[];
}

export function totalXpOf(s: Pick<GameState, "xp" | "level">): number {
  let sum = s.xp;
  for (let lv = 1; lv < s.level; lv++) sum += xpForNextLevel(lv);
  return sum;
}

const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00Z`);

function startState(start: string): GameState {
  const s = {
    ...INITIAL_GAME_STATE,
    createdAt: addDaysToKey(start, -1),
    lastQuestDate: addDaysToKey(start, -1),
    onboarding: { status: "done", step: 5, subStep: 0, answers: { experience: "intermediate", mainProblem: "discipline", markets: ["forex"] } },
    profile: { ...INITIAL_GAME_STATE.profile, timezone: "UTC" },
  } as unknown as GameState;
  return checkAndApplyDateResets(s, at(addDaysToKey(start, -1), "12:00"));
}

const shownSelf = (s: GameState, day: string) => {
  const set = getTodaysQuests(day, s.questReplacements || {}, s.questDay?.day === day ? s.questDay : null);
  return [...set.core, ...set.bonus].filter((q) => !APP_CLOSED_QUESTS.has(q.id) && !s.passedQuestsToday[q.id]);
};
const selfXpOfSet = (s: GameState, day: string) => shownSelf(s, day).reduce((n, q) => n + q.xpReward, 0);

/** Self-reported quests the player ticks: all of them, or the first n. Returns XP gained from them. */
function tickSelf(s: GameState, day: string, n: number | "all", time: string): { s: GameState; xp: number } {
  let xp = 0;
  const quests = shownSelf(s, day);
  for (const q of n === "all" ? quests : quests.slice(0, n)) {
    const before = totalXpOf(s);
    s = completeSelfReportQuest(s, q.id, q.id, q.category, q.xpReward, at(day, time)).state;
    // a second tab / double click: the same quest again (blocked by the rules)
    s = completeSelfReportQuest(s, q.id, q.id, q.category, q.xpReward, at(day, time)).state;
    xp += totalXpOf(s) - before;
  }
  return { s, xp };
}

function plan(day: string, created: string, review = false) {
  return {
    date: day,
    bias: [{ instrument: "EURUSD", direction: "bullish" }],
    levels: [],
    events: [],
    limits: { maxTrades: 3 },
    checklist: [{ key: "risk_limits_checked", done: true }],
    createdAt: `${day}T${created}:00Z`,
    review: review ? { rating: 4, followedPlan: "yes", emotions: [], whatWorked: "Waited for the retest and kept the risk.", lesson: "Patience pays.", completedAt: `${day}T20:00:00Z` } : undefined,
  };
}

/** One profile over `days` days starting on a Monday. */
export function simulate(profile: Profile, days = 90, start = "2026-11-16"): SimResult {
  let s = startState(start);
  const trades: Array<{ id: string; accountId: string; instrument: string; direction: string; openedAt: string; verification: string }> = [];
  const notes: Array<{ id: string; body: string; createdAt: string; templateKey?: string }> = [];
  const noTrades: Array<{ id: string; date: string; reason: string; instrument?: string }> = [];
  const log: DayLog[] = [];
  let selfTotal = 0;

  for (let i = 0; i < days; i++) {
    const day = addDaysToKey(start, i);
    const wd = weekdayOfKey(day);
    const xp0 = totalXpOf(s);
    const coins0 = s.coins;
    let selfXp = 0;
    s = checkAndApplyDateResets(s, at(day, "06:00"));

    if (profile === "honest") {
      const tradingDay = wd <= 4;
      if (wd === 6) s = setDayMode(s, "rest", at(day, "06:05")).state;
      else if (!tradingDay) s = setDayMode(s, "study", at(day, "06:05")).state;
      s = claimDailyReward(s, at(day, "07:00")).state;
      if (tradingDay) {
        const p = plan(day, "07:30");
        s = evaluatePlanQuestClosure(s, p, [], [p], notes, at(day, "07:30")).state;
        const t = { id: `t${i}`, accountId: "a1", instrument: "EURUSD", direction: "long", openedAt: `${day}T10:00:00Z`, verification: "unverified" };
        trades.push(t);
        s = recordLoggedTrade(s, t, trades, at(day, "10:05")).state;
        if (i === 0) {
          s = grantFirstAction(s, "trade", at(day, "10:05")).state;
          s = grantFirstAction(s, "dayPlan", at(day, "10:05")).state;
        }
        const r = tickSelf(s, day, 2, "12:00");
        s = r.s;
        selfXp += r.xp;
        const pr = plan(day, "07:30", true);
        s = evaluatePlanQuestClosure(s, pr, [t], [pr], notes, at(day, "20:05")).state;
      } else if (wd === 5) {
        const r = tickSelf(s, day, 1, "12:00");
        s = r.s;
        selfXp += r.xp;
      }
    } else {
      // active and farmer play every day; the farmer first looks for the mode whose set gives the most self-report XP
      if (profile === "farmer") {
        let best: { mode: DayMode; xp: number } = { mode: "trading", xp: selfXpOfSet(s, day) };
        for (const m of ["study", "recovery"] as DayMode[]) {
          const tryS = setDayMode(s, m, at(day, "06:01")).state;
          const xp = selfXpOfSet(tryS, day);
          if (xp > best.xp) best = { mode: m, xp };
        }
        s = setDayMode(s, best.mode, at(day, "06:02")).state;
      }
      s = claimDailyReward(s, at(day, "07:00")).state;
      s = claimDailyReward(s, at(day, "07:01")).state; // again: nothing
      const p = plan(day, "07:30");
      s = evaluatePlanQuestClosure(s, p, [], [p], notes, at(day, "07:30")).state;
      const dayTrades = [0, 1, 2].map((k) => ({ id: `t${i}_${k}`, accountId: "a1", instrument: ["EURUSD", "GBPUSD", "XAUUSD"][k], direction: "long", openedAt: `${day}T${10 + k}:00:00Z`, verification: "unverified" }));
      for (const t of dayTrades) {
        trades.push(t);
        s = recordLoggedTrade(s, t, trades, at(day, "13:00")).state;
      }
      if (profile === "farmer") {
        // duplicates, a future date and extra trades: blocked or capped by the existing rules
        const dup = { ...dayTrades[0], id: `d${i}`, openedAt: `${day}T10:00:20Z` };
        trades.push(dup);
        s = recordLoggedTrade(s, dup, trades, at(day, "13:01")).state;
        const fut = { ...dayTrades[0], id: `f${i}`, instrument: "US30", openedAt: `${addDaysToKey(day, 5)}T10:00:00Z` };
        trades.push(fut);
        s = recordLoggedTrade(s, fut, trades, at(day, "13:02")).state;
        for (let k = 0; k < 5; k++) {
          const extra = { id: `x${i}_${k}`, accountId: "a1", instrument: `X${k}`, direction: "short", openedAt: `${day}T${14 + k}:00:00Z`, verification: "unverified" };
          trades.push(extra);
          s = recordLoggedTrade(s, extra, trades, at(day, "13:03")).state;
        }
      }
      s = recordScreenshotAdded(s, { hash: `h${i}`, width: 1200, height: 800, tradeOpenedAt: dayTrades[0].openedAt }, at(day, "13:10")).state;
      s = recordScreenshotAdded(s, { hash: `h${i}b`, width: 1200, height: 800, tradeOpenedAt: dayTrades[0].openedAt }, at(day, "13:11")).state;
      const note = { id: `n${i}`, body: `Lesson ${i}: waited for confirmation, respected the plan and kept the risk at one percent of the account.`, createdAt: `${day}T15:00:00Z` };
      notes.push(note);
      s = recordNoteSaved(s, note, notes, at(day, "15:00")).state;
      const nt = { id: `nt${i}`, date: `${day}T16:00:00Z`, reason: "setup_incomplete", instrument: "NAS100" };
      noTrades.push(nt);
      s = recordNoTradeEntry(s, nt, noTrades, at(day, "16:00")).state;
      const r = tickSelf(s, day, "all", "17:00");
      s = r.s;
      selfXp += r.xp;
      const pr = plan(day, "07:30", true);
      s = evaluatePlanQuestClosure(s, pr, dayTrades, [pr], notes, at(day, "20:05")).state;
    }

    selfTotal += selfXp;
    log.push({ day, selfXp, totalXp: totalXpOf(s) - xp0, coins: s.coins - coins0 });
  }
  return { profile, days, totalXp: totalXpOf(s), coins: s.coins, level: s.level, selfXp: selfTotal, log };
}

/** What a daily cap on self-report XP would change (an option for the owner; not applied in the game). */
export function withSelfCap(r: SimResult, cap: number | null): { totalXp: number; selfXp: number } {
  if (cap == null) return { totalXp: r.totalXp, selfXp: r.selfXp };
  let cut = 0;
  for (const d of r.log) cut += Math.max(0, d.selfXp - cap);
  return { totalXp: r.totalXp - cut, selfXp: r.selfXp - cut };
}

