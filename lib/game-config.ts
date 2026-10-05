export const GAME_CONFIG = {
  STREAK_SHIELDS_PER_WEEK: 1,
  QUEST_REPLACEMENTS_PER_DAY: 2,
  CORE_QUESTS_PER_DAY: 3,
  BONUS_QUESTS_PER_DAY: 2,
  WEEKLY_CHALLENGE_TARGET: 10,
  DAILY_REWARD_VALUES: [10, 10, 15, 15, 20, 25, 50] as const,
  QUEST_XP: 40,
  QUEST_COINS: 10,
  MAX_CUSTOM_GOALS: 5,

  REPUTATION_STAGES: [
    { key: "growing", minPoints: 0, maxPoints: 99 },
    { key: "reliable", minPoints: 100, maxPoints: 249 },
    { key: "trusted", minPoints: 250, maxPoints: 499 },
    { key: "respected", minPoints: 500, maxPoints: 999 },
    { key: "honored", minPoints: 1000, maxPoints: Infinity },
  ] as const,

  STAT_KEYS: [
    "discipline",
    "trading",
    "intelligence",
    "focus",
    "psychology",
    "knowledge",
    "endurance",
    "strength",
  ] as const,

  STAT_THRESHOLDS: [
    { level: 1, rankKey: "novice", xpRequired: 0 },
    { level: 2, rankKey: "adept", xpRequired: 100 },
    { level: 3, rankKey: "skilled", xpRequired: 250 },
    { level: 4, rankKey: "expert", xpRequired: 500 },
    { level: 5, rankKey: "master", xpRequired: 1000 },
  ] as const,
};

export type StatKey = (typeof GAME_CONFIG.STAT_KEYS)[number];
export type ReputationStageKey = (typeof GAME_CONFIG.REPUTATION_STAGES)[number]["key"];
