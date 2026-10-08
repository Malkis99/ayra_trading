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
  JOURNAL_MIN_SAMPLE_SIZE: 20,
  VERIFICATION_XP_MULTIPLIER: {
    unverified: 1.0,
    imported: 1.2,
    connected: 1.5,
    verified: 1.5,
  } as Record<string, number>,

  // Strategy & Process Score Config
  MAX_ACTIVE_STRATEGIES: 10,
  MAX_RULES_PER_STRATEGY: 25,
  PROCESS_SCORE: {
    WEIGHTS: {
      rules: 50,
      risk: 25,
      session: 25,
    },
    REQUIRED_RULE_MULTIPLIER: 2.0,
    MISTAKE_PENALTY_PER_ITEM: 15, // min(3 * count * 5, 30) = 15 per item
    MAX_MISTAKE_PENALTY: 30,
    THRESHOLDS: {
      GOOD: 80,
      BAD: 50,
    },
  },

  // No-Trade Journal Config
  NO_TRADE_XP: 10,
  NO_TRADE_DAILY_CAP: 1,

  // Plan & Note XP & Sample thresholds
  PLAN_DISCIPLINE_XP: 15,
  REVIEW_PSYCHOLOGY_XP: 15,
  NOTE_KNOWLEDGE_XP: 10,
  PLAN_COMPLIANCE_MIN_SAMPLE_SIZE: 5,
  NOTES_LIMIT: 500,

  // Screenshot & Attachments Config (T6c-2b)
  MAX_ATTACHMENTS_PER_TRADE: 5,
  SCREENSHOT_DAILY_XP_CAP: 1,
  SCREENSHOT_MIN_DIMENSION: 300,
  SCREENSHOT_XP: 10,

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
