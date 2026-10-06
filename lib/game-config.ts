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

  // Level unlock thresholds
  LEVEL_UNLOCKS: {
    FRAME_BLUE_LEVEL: 3,
    FRAME_GOLD_LEVEL: 4,
    TITLE_DISCIPLINED_LEVEL: 3,
    TITLE_STRATEGIST_LEVEL: 5,
  },

  // Characteristic -> Developed by Task Categories (Spec v1.1)
  STAT_DEVELOPED_BY_CATEGORIES: {
    discipline: ["Discipline", "Lifestyle"],
    trading: ["Trading"],
    intelligence: ["Mental"],
    focus: ["Trading", "Social"],
    psychology: ["Psychology", "Social"],
    knowledge: ["Mental"],
    endurance: ["Physical", "Lifestyle"],
    strength: ["Physical"],
  } as Record<string, string[]>,
};
