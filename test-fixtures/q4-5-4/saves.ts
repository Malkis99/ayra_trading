/**
 * Q4.5-4 — synthetic device saves of every format the game ever wrote (from git history, docs/q4-5-4 section 1).
 * Each one has known, hand-checked totals so the reconciliation can be verified number by number. No real user data.
 */

/** Before any reward record (T3–T6, early October 2026): only totals. Level 3 + 50 XP = 120 + 160 + 50 = 330 XP (80 + 40·n). */
export const legacySave = {
  level: 3,
  xp: 50,
  coins: 120,
  achievements: { firstTrade: true },
  dailyStats: { "2026-10-10": { xpGained: 30, coinsGained: 10 } },
};

/**
 * After #98 (2026-10-27 14:50 UTC), before #99 (15:34): first actions with the OLD amounts (a rule that lived 44 minutes,
 * inside the deploy margin — so its amount is never proven: the smaller one is), history without exact times,
 * the daily coin cap. Quests: 2 × (40 XP, 10 Coins). First actions: trade (20/20), note (10 XP / 10 Coins, old rule).
 * Journal XP on 2026-10-27: 15 beyond the quests. Total XP = 110 + 15 = 125 → level 2 (120) + 5. Coins = 20 + 20 + 10 + 7 = 57.
 */
export const capSave = {
  level: 2,
  xp: 5,
  coins: 57,
  history: [
    { questId: "q_bias", questTitle: "Bias", category: "trading", xp: 40, coins: 10, completedAt: "2026-10-27" },
    { questId: "q_reflect", questTitle: "Reflect", category: "trading", xp: 40, coins: 10, completedAt: "2026-10-28" },
  ],
  firstActions: { trade: "2026-10-27T15:00:00Z", note: "2026-10-27T15:10:00Z" },
  dailyStats: { "2026-10-27": { xpGained: 55, coinsGained: 10 }, "2026-10-28": { xpGained: 40, coinsGained: 10 } },
  achievements: { firstTrade: true, firstNote: true },
};

/**
 * After #99: the coin log (since 2026-10-29), first actions with the NEW amounts, daily rewards in the coin log.
 * Quests: q_bias 2026-11-01 (40/10). First action dayPlan at 2026-11-01 (10 XP / 5 Coins, new rule).
 * Daily rewards: 2026-11-01 (10), 2026-11-02 (15). Total XP = 50 → level 1. Coins = 10 + 5 + 10 + 15 + 30 (before the log) = 70.
 */
export const coinLogSave = {
  level: 1,
  xp: 50,
  coins: 70,
  history: [{ questId: "q_bias", questTitle: "Bias", category: "trading", xp: 40, coins: 10, completedAt: "2026-11-01", at: "2026-11-01T09:00:00Z" }],
  firstActions: { dayPlan: "2026-11-01T08:00:00Z" },
  coinLogSince: "2026-10-29T00:00:00Z",
  coinLog: [
    { at: "2026-11-02T07:00:00Z", source: "dailyReward", amount: 15 },
    { at: "2026-11-01T09:00:00Z", source: "quest", amount: 10, questId: "q_bias", title: "Bias" },
    { at: "2026-11-01T08:00:00Z", source: "firstAction", amount: 5, kind: "dayPlan" },
    { at: "2026-11-01T07:00:00Z", source: "dailyReward", amount: 10 },
  ],
  dailyStats: { "2026-11-01": { xpGained: 40, coinsGained: 25 } },
};

/**
 * Missions (QH-6.4) and paid personal quests (QH-8.5): two missions 40/10 on 2026-11-16, a paid gold app run (250 XP)
 * and an unpaid QH-8.4 completion (never paid afterwards). Total XP = 330 → level 3 (120 + 160 = 280, 50 in level 3).
 * Coins = 20.
 */
export const missionsSave = {
  level: 3,
  xp: 50,
  coins: 20,
  history: [
    { questId: "m_lesson", questTitle: "Lesson", category: "study", xp: 40, coins: 10, completedAt: "2026-11-16", at: "2026-11-16T10:00:00Z" },
    { questId: "m_observation", questTitle: "Observation", category: "study", xp: 40, coins: 10, completedAt: "2026-11-16", at: "2026-11-16T11:00:00Z" },
  ],
  missionLedger: { day: "2026-11-16", claims: { m_lesson: "note:n1", m_observation: "note:n2" } },
  personalLedger: [
    { runId: "run_gold_1", questId: "pq_x", category: "discipline", rank: "gold", days: 29, xp: 250, day: "2026-11-17", at: "2026-11-17T12:00:00Z", verification: "app", paid: true },
    { runId: "run_old_84", questId: "pq_y", category: "health", rank: "silver", days: 25, xp: 0, day: "2026-11-15", at: "2026-11-15T12:00:00Z", verification: "self" },
  ],
  coinLogSince: "2026-11-10T00:00:00Z",
  coinLog: [],
  achievements: {},
};

/**
 * A tampered save: a quest worth 500 XP, a day with 150 Coins of quests after the cap, a level inconsistent with its
 * XP, a balance below its own records.
 */
export const tamperedSave = {
  level: 2,
  xp: 500,
  coins: 10,
  history: [
    { questId: "q_fake", questTitle: "Fake", category: "x", xp: 500, coins: 0, completedAt: "2026-11-05" },
    { questId: "q_a", questTitle: "A", category: "x", xp: 40, coins: 60, completedAt: "2026-11-06" },
    { questId: "q_b", questTitle: "B", category: "x", xp: 40, coins: 90, completedAt: "2026-11-06" },
  ],
  firstActions: { trade: "2026-10-01T00:00:00Z" },
};

/** The second device of the capSave account: the same q_bias day (same amounts), a different amount for q_reflect,
 *  its own quest, and the same first action recorded later. */
export const capSaveDeviceB = {
  level: 2,
  xp: 10,
  coins: 50,
  history: [
    { questId: "q_bias", questTitle: "Bias", category: "trading", xp: 40, coins: 10, completedAt: "2026-10-27" },
    { questId: "q_reflect", questTitle: "Reflect", category: "trading", xp: 30, coins: 10, completedAt: "2026-10-28" },
    { questId: "q_walk", questTitle: "Walk", category: "health", xp: 10, coins: 5, completedAt: "2026-10-29" },
  ],
  firstActions: { trade: "2026-10-28T10:00:00Z" },
  achievements: { firstTrade: true, streak3: true },
};
