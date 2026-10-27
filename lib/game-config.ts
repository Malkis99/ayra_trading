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
    imported: 0, // import files never give XP (owner decision 2026-10-14)
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

  // Prop Rules Config (T6d)
  PROP_DISCIPLINE_XP: 10,
  JOURNAL_DISCIPLINE_DAILY_XP_CAP: 25,
  PROP_RULE_THRESHOLDS: {
    CAUTION: 0.70,
    CLOSE: 0.90,
    REACHED: 1.00,
  },

  // ---- Economy on this device until the server economy (0007), docs/economy-coins-plan.md (owner 2026-10-27) ----
  /**
   * Coins per day from daily quests and the daily reward together (confirmed by the owner 2026-10-27): the honest
   * maximum today is 50 (day 7 of the reward) + 40 (quests the app checks) = 90. One-time rewards are not counted.
   */
  DAILY_COIN_CAP: 100,
  /** The device clock moved back by more than this: no rewards and no new day until real time catches up. */
  CLOCK_BACK_TOLERANCE_MS: 10 * 60 * 1000,
  /**
   * One-time reward per account for the first action of each kind (created in the app; not edits, sync, undo or the
   * guest copy). Coins: owner decision 2026-10-27. XP: kept as before (PLACEHOLDER values set with 0005 economy).
   */
  FIRST_ACTION_REWARDS: {
    trade: { coins: 20, xp: 20 },
    account: { coins: 10, xp: 10 },
    strategy: { coins: 10, xp: 10 },
    import: { coins: 20, xp: 10 },
    dayPlan: { coins: 5, xp: 10 },
    weekPlan: { coins: 5, xp: 10 },
    note: { coins: 5, xp: 10 },
    noTrade: { coins: 5, xp: 10 },
    screenshot: { coins: 5, xp: 10 },
  } as Record<"trade" | "account" | "strategy" | "import" | "dayPlan" | "weekPlan" | "note" | "noTrade" | "screenshot", { coins: number; xp: number }>,

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
