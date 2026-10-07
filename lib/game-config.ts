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

  // Journal Trade XP & Anti-farm config
  TRADE_BASE_XP: 10,
  MAX_DAILY_TRADE_XP_COUNT: 3,
  VERIFICATION_XP_MULTIPLIER: {
    unverified: 1.0,
    imported: 1.2,
    connected: 1.5,
    verified: 1.5,
  } as Record<string, number>,

  // Level unlock thresholds
  LEVEL_UNLOCKS: {
    FRAME_BLUE_LEVEL: 3,
    FRAME_GOLD_LEVEL: 4,
    TITLE_DISCIPLINED_LEVEL: 3,
    TITLE_STRATEGIST_LEVEL: 5,
  },

  // Characteristic -> Developed by Task Categories (Spec v1.4)
  STAT_DEVELOPED_BY_CATEGORIES: {
    discipline: ["discipline", "lifestyle"],
    trading: ["trading"],
    intelligence: ["mental"],
    focus: ["trading", "social"],
    psychology: ["psychology", "social"],
    knowledge: ["mental"],
    endurance: ["physical", "lifestyle"],
    strength: ["physical"],
  } as Record<string, string[]>,
};
