/**
 * QH-6 economy simulation (docs/quest-hub-qh6-spec.md). Compares today's rules with the proposed verifiable missions
 * over N days for several kinds of players. Nothing here is used by the app and no game rule is changed.
 *
 * - Today's rules: the real functions of lib/game.ts, as the Q2 simulation (lib/econ-sim.ts) does.
 * - Proposed rules: every existing journal reward (daily reward, trades, plan and review discipline XP, notes,
 *   screenshots, «no trade») still runs through the real functions; a verified mission is paid through the real
 *   generic reward function `completeQuest` (once per mission and day, the daily coin cap applies); habits are
 *   self-reports paid through the same function within the approved daily self-report cap (90 XP).
 *   Trading missions are the existing journal quests (q_bias, q_riskcheck, q_reflect) closed by the real journal rule.
 *
 * Run: npx vite-node scripts/econ-sim-qh6.ts [days]
 */
import {
  INITIAL_GAME_STATE,
  checkAndApplyDateResets,
  claimDailyReward,
  completeQuest,
  completeSelfReportQuest,
  evaluatePlanQuestClosure,
  recordLoggedTrade,
  recordNoTradeEntry,
  recordNoteSaved,
  recordScreenshotAdded,
  setDayMode,
  xpForNextLevel,
  type GameState,
} from "./game";
import { GAME_CONFIG } from "./game-config";
import { addDaysToKey, weekdayOfKey } from "./day-key";
import { APP_CLOSED_QUESTS, getTodaysQuests } from "./quests";
import type { DayMode } from "./quest-engine";

export type Player = "trader" | "learner" | "casual" | "maximiser";
export const PLAYERS: Player[] = ["trader", "learner", "casual", "maximiser"];

/** Reward of one verified mission (variant A is the owner's proposal; B and C are for comparison). */
export interface MissionRate {
  xp: number;
  coins: number;
  /** Coins only for trading missions (study and recovery missions give XP only). */
  tradingCoinsOnly?: boolean;
}
export const VARIANTS: Record<"A" | "B" | "C", MissionRate> = {
  A: { xp: 40, coins: 10 },
  B: { xp: 30, coins: 5 },
  C: { xp: 40, coins: 10, tradingCoinsOnly: true },
};

export interface Outcome {
  player: Player;
  rules: "current" | "A" | "B" | "C";
  days: number;
  totalXp: number;
  coins: number;
  level: number;
  /** XP from self-reports (current: ticked quests; proposed: habits). */
  selfXp: number;
  /** Verified missions completed (proposed) / journal quests closed (current). */
  missions: number;
  maxCoinsDay: number;
  maxMissionsDay: number;
  /** Days the existing journal quest «Log a trade» (q_tradelog, 40 XP + 10 Coins today) was closed by a trade. */
  tradeLog: number;
}

export function totalXpOf(s: Pick<GameState, "xp" | "level">): number {
  let sum = s.xp;
  for (let lv = 1; lv < s.level; lv++) sum += xpForNextLevel(lv);
  return sum;
}
function levelOf(total: number): number {
  let lv = 1;
  while (total >= xpForNextLevel(lv)) {
    total -= xpForNextLevel(lv);
    lv++;
  }
  return lv;
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

interface Journal {
  trades: Array<{ id: string; accountId: string; instrument: string; direction: string; openedAt: string; verification: string }>;
  notes: Array<{ id: string; body: string; createdAt: string; templateKey?: string }>;
  noTrades: Array<{ id: string; date: string; reason: string; instrument?: string }>;
}

function plan(day: string, opts: { levels: boolean; review: boolean }) {
  return {
    date: day,
    bias: [{ instrument: "EURUSD", direction: "bullish" }],
    levels: opts.levels ? [{ instrument: "EURUSD", price: 1.1, label: "POI" }] : [],
    events: [],
    limits: { maxTrades: 3, maxRiskPerTrade: { value: 1, unit: "percent" } },
    checklist: [{ key: "risk_limits_checked", done: true }],
    createdAt: `${day}T07:30:00Z`,
    review: opts.review ? { rating: 4, followedPlan: "yes", emotions: ["calm"], whatWorked: "Waited for the retest and kept the risk.", lesson: "Patience pays off again.", completedAt: `${day}T20:00:00Z` } : undefined,
  };
}

const LONG = "Lesson: waited for confirmation, respected the plan and kept the risk at one percent of the account balance.";

/** A day of journal actions both rule sets share (they exist today and stay as they are). */
function journalDay(s: GameState, j: Journal, day: string, i: number, trades: number, extras: boolean): GameState {
  for (let k = 0; k < trades; k++) {
    const t = { id: `t${i}_${k}`, accountId: "a1", instrument: ["EURUSD", "GBPUSD", "XAUUSD"][k % 3], direction: "long", openedAt: `${day}T${10 + k}:00:00Z`, verification: "unverified" };
    j.trades.push(t);
    s = recordLoggedTrade(s, t, j.trades, at(day, "13:00")).state;
  }
  if (extras) {
    if (trades > 0) s = recordScreenshotAdded(s, { hash: `h${i}`, width: 1200, height: 800, tradeOpenedAt: `${day}T10:00:00Z` }, at(day, "13:10")).state;
    const nt = { id: `nt${i}`, date: `${day}T16:00:00Z`, reason: "setup_incomplete", instrument: "NAS100" };
    j.noTrades.push(nt);
    s = recordNoTradeEntry(s, nt, j.noTrades, at(day, "16:00")).state;
  }
  return s;
}

function note(s: GameState, j: Journal, day: string, id: string, templateKey: string, time: string): GameState {
  const n = { id, body: LONG, createdAt: `${day}T${time}:00Z`, templateKey };
  j.notes.push(n);
  return recordNoteSaved(s, n, j.notes, at(day, time)).state;
}

/* ------------------------------------------------------------------ today's rules */

const shownSelf = (s: GameState, day: string) => {
  const set = getTodaysQuests(day, s.questReplacements || {}, s.questDay?.day === day ? s.questDay : null);
  return [...set.core, ...set.bonus].filter((q) => !APP_CLOSED_QUESTS.has(q.id) && !s.passedQuestsToday[q.id]);
};
function tickSelf(s: GameState, day: string, n: number | "all", time: string): { s: GameState; xp: number } {
  let xp = 0;
  const qs = shownSelf(s, day);
  for (const q of n === "all" ? qs : qs.slice(0, n)) {
    const before = totalXpOf(s);
    s = completeSelfReportQuest(s, q.id, q.id, q.category, q.xpReward, at(day, time)).state;
    xp += totalXpOf(s) - before;
  }
  return { s, xp };
}

/** What each player does on a day (the same behaviour for both rule sets). */
interface Plan {
  open: boolean;
  mode: DayMode;
  trades: number;
  extras: boolean;
  /** Trading missions done (prep, risk, review) — or study/recovery missions done. */
  missions: number;
  habits: number;
}

function behaviour(player: Player, i: number, day: string): Plan {
  const wd = weekdayOfKey(day); // 0 = Monday
  switch (player) {
    case "trader":
      if (wd <= 4) return { open: true, mode: "trading", trades: 1, extras: false, missions: 3, habits: 2 };
      if (wd === 5) return { open: true, mode: "study", trades: 0, extras: false, missions: 3, habits: 1 };
      return { open: true, mode: "rest", trades: 0, extras: false, missions: 0, habits: 0 };
    case "learner": // never trades
      if (wd <= 4) return { open: true, mode: "study", trades: 0, extras: false, missions: 3, habits: 2 };
      if (wd === 5) return { open: true, mode: "recovery", trades: 0, extras: false, missions: 3, habits: 2 };
      return { open: true, mode: "rest", trades: 0, extras: false, missions: 0, habits: 0 };
    case "casual": // three days a week, two missions, one habit, no trades
      if (wd === 0 || wd === 2 || wd === 4) return { open: true, mode: "trading", trades: 0, extras: false, missions: 2, habits: 1 };
      return { open: false, mode: "trading", trades: 0, extras: false, missions: 0, habits: 0 };
    case "maximiser": // every day, everything the rules allow, 3 trades, all journal extras, habits to the cap
    default:
      return { open: true, mode: "trading", trades: 3, extras: true, missions: 3, habits: 9 };
  }
}

export function simulateCurrent(player: Player, days = 90, start = "2026-11-16"): Outcome {
  let s = startState(start);
  const j: Journal = { trades: [], notes: [], noTrades: [] };
  let selfXp = 0;
  let missions = 0;
  let maxCoinsDay = 0;
  let maxMissionsDay = 0;
  let tradeLog = 0;
  for (let i = 0; i < days; i++) {
    const day = addDaysToKey(start, i);
    const b = behaviour(player, i, day);
    const coins0 = s.coins;
    s = checkAndApplyDateResets(s, at(day, "06:00"));
    if (!b.open) continue;
    if (b.mode !== s.questDay?.mode) s = setDayMode(s, b.mode, at(day, "06:05")).state;
    s = claimDailyReward(s, at(day, "07:00")).state;
    const isMission = (id: string) => (APP_CLOSED_QUESTS.has(id) && id !== "q_tradelog") || id.startsWith("m_");
    const done0 = Object.keys(s.completedQuestsToday).filter(isMission).length;
    if (b.mode === "trading") {
      // today: the day plan closes q_bias and q_riskcheck (levels are not required yet), the review closes q_reflect
      const p = plan(day, { levels: b.missions >= 1, review: b.missions >= 3 });
      s = evaluatePlanQuestClosure(s, plan(day, { levels: true, review: false }), [], [p], j.notes, at(day, "07:30")).state;
      s = journalDay(s, j, day, i, b.trades, b.extras);
      if (b.extras) s = note(s, j, day, `n${i}`, "lesson", "15:00");
      // today a player also ticks self-reported core quests: the habits count plus core quests of the set
      const r = tickSelf(s, day, player === "maximiser" ? "all" : b.habits, "17:00");
      s = r.s;
      selfXp += r.xp;
      const dayTrades = j.trades.filter((t) => t.openedAt.startsWith(day));
      s = evaluatePlanQuestClosure(s, p, dayTrades, [p], j.notes, at(day, "20:05")).state;
    } else if (b.mode === "study" || b.mode === "recovery") {
      // today study and recovery quests are self-reports: one click each (the gap QH-6 closes)
      s = note(s, j, day, `n${i}`, "lesson", "15:00");
      const r = tickSelf(s, day, "all", "17:00");
      s = r.s;
      selfXp += r.xp;
    }
    const closed = Object.keys(s.completedQuestsToday).filter(isMission).length - done0;
    if (s.completedQuestsToday.q_tradelog) tradeLog++;
    missions += closed;
    maxMissionsDay = Math.max(maxMissionsDay, closed);
    maxCoinsDay = Math.max(maxCoinsDay, s.coins - coins0);
  }
  const totalXp = totalXpOf(s);
  return { player, rules: "current", days, totalXp, coins: s.coins, level: s.level, selfXp, missions, maxCoinsDay, maxMissionsDay, tradeLog };
}

/* ------------------------------------------------------------------ proposed rules (variant A paid for real) */

/** Mission ids of study and recovery (new; trading missions are the existing journal quests). */
const STUDY = ["m_trade_review", "m_backtest", "m_lesson"];
const STUDY_NO_TRADES = ["m_lesson", "m_backtest", "m_idea"]; // no trades: the lesson-type alternative replaces the review
const RECOVERY = ["m_day_state", "m_mistake", "m_plan_tomorrow"];
/** Habits (self-reports) and their catalogue XP. */
const HABIT_XP = [30, 30, 25, 30, 40, 35, 30, 30, 45];

export function simulateProposed(player: Player, days = 90, start = "2026-11-16", rate: MissionRate = VARIANTS.A): Outcome {
  let s = startState(start);
  const j: Journal = { trades: [], notes: [], noTrades: [] };
  let selfXp = 0;
  let missions = 0;
  let maxCoinsDay = 0;
  let maxMissionsDay = 0;
  let tradeLog = 0;
  for (let i = 0; i < days; i++) {
    const day = addDaysToKey(start, i);
    const b = behaviour(player, i, day);
    const coins0 = s.coins;
    s = checkAndApplyDateResets(s, at(day, "06:00"));
    if (!b.open) continue;
    if (b.mode !== s.questDay?.mode) s = setDayMode(s, b.mode, at(day, "06:05")).state;
    s = claimDailyReward(s, at(day, "07:00")).state;
    const done = () => Object.keys(s.completedQuestsToday).filter((id) => (APP_CLOSED_QUESTS.has(id) && id !== "q_tradelog") || id.startsWith("m_")).length;
    const done0 = done();

    if (b.mode === "trading") {
      // Preparation needs a direction and a POI; risk needs limits and the checklist item; review 40+ characters.
      // The real journal rule closes the existing quests at today's rate (variant A = today's QUEST_XP/QUEST_COINS).
      const prep = plan(day, { levels: b.missions >= 1, review: false });
      if (b.missions >= 1) s = evaluatePlanQuestClosure(s, prep, [], [prep], j.notes, at(day, "07:30")).state;
      s = journalDay(s, j, day, i, b.trades, b.extras);
      if (b.extras) s = note(s, j, day, `n${i}`, "lesson", "15:00");
      if (b.missions >= 3) {
        const p = plan(day, { levels: true, review: true });
        s = evaluatePlanQuestClosure(s, p, j.trades.filter((t) => t.openedAt.startsWith(day)), [p], j.notes, at(day, "20:05")).state;
      }
      // the maximiser tries to close the same missions again (a second tab, a reload): nothing more
      if (player === "maximiser") {
        const p = plan(day, { levels: true, review: true });
        s = evaluatePlanQuestClosure(s, p, [], [p], j.notes, at(day, "20:10")).state;
      }
    } else if (b.mode === "study" || b.mode === "recovery") {
      const ids = b.mode === "recovery" ? RECOVERY : j.trades.length > 0 ? STUDY : STUDY_NO_TRADES;
      for (const id of ids.slice(0, b.missions)) {
        // the saved record behind each mission (lesson / mistake notes also earn today's note XP, once a day)
        if (id === "m_lesson" || id === "m_idea") s = note(s, j, day, `${id}${i}`, id === "m_lesson" ? "lesson" : "idea", "15:00");
        if (id === "m_mistake") s = note(s, j, day, `${id}${i}`, "weekly_mistake", "15:05");
        const coins = rate.tradingCoinsOnly ? 0 : rate.coins;
        s = completeQuest(s, id, id, "Mental", rate.xp, coins, at(day, "15:10")).state;
        s = completeQuest(s, id, id, "Mental", rate.xp, coins, at(day, "15:11")).state; // twice: paid once
      }
    }

    // habits: self-reports within the approved daily cap, never coins
    let left = GAME_CONFIG.SELF_REPORT_DAILY_XP_CAP;
    for (let h = 0; h < b.habits; h++) {
      const xp = Math.min(left, HABIT_XP[h % HABIT_XP.length]);
      left -= xp;
      const before = totalXpOf(s);
      s = completeQuest(s, `h_${h}`, `h_${h}`, "Physical", xp, 0, at(day, "21:00")).state;
      selfXp += totalXpOf(s) - before;
    }

    const closed = done() - done0;
    if (s.completedQuestsToday.q_tradelog) tradeLog++;
    missions += closed;
    maxMissionsDay = Math.max(maxMissionsDay, closed);
    maxCoinsDay = Math.max(maxCoinsDay, s.coins - coins0);
  }
  return { player, rules: "A", days, totalXp: totalXpOf(s), coins: s.coins, level: s.level, selfXp, missions, maxCoinsDay, maxMissionsDay, tradeLog };
}

/**
 * Variants B and C from the real run of A: the same days and missions, only the mission rate differs. Trading
 * missions are the existing journal quests (paid at today's QUEST_XP/QUEST_COINS in A), so the difference per mission
 * is (A − B); the daily coin cap is not reached by any player (checked by the tests), so coins scale the same way.
 */
export function variantOf(a: Outcome, tradingMissions: number, otherMissions: number, key: "B" | "C"): Outcome {
  const r = VARIANTS[key];
  const dXp = (VARIANTS.A.xp - r.xp) * (tradingMissions + otherMissions);
  const dCoins = (VARIANTS.A.coins - r.coins) * (r.tradingCoinsOnly ? 0 : tradingMissions) + (r.tradingCoinsOnly ? VARIANTS.A.coins * otherMissions : (VARIANTS.A.coins - r.coins) * otherMissions);
  const totalXp = a.totalXp - dXp;
  return { ...a, rules: key, totalXp, coins: a.coins - dCoins, level: levelOf(totalXp) };
}

/** Missions of a run split by kind (for the variants). */
export function missionSplit(player: Player, days = 90, start = "2026-11-16"): { trading: number; other: number } {
  let trading = 0;
  let other = 0;
  for (let i = 0; i < days; i++) {
    const b = behaviour(player, i, addDaysToKey(start, i));
    if (!b.open) continue;
    if (b.mode === "trading") trading += b.missions;
    else if (b.mode === "study" || b.mode === "recovery") other += b.missions;
  }
  return { trading, other };
}
