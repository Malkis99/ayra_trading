import { GAME_CONFIG } from "./game-config";

export const DAILY_REWARDS = GAME_CONFIG.DAILY_REWARD_VALUES;
export const QUEST_XP = GAME_CONFIG.QUEST_XP;
export const QUEST_COINS = GAME_CONFIG.QUEST_COINS;

export type ChronicleEventType =
  | { type: "characterCreated" }
  | { type: "questDone"; title: string; xp: number }
  | { type: "levelUp"; level: number }
  | { type: "dailyReward"; coins: number }
  | { type: "planChanged"; plan: "Free" | "Pro" | "Elite" }
  | { type: "itemEquipped"; name: string }
  | { type: "achievementUnlocked"; title: string }
  | { type: "postPublished" }
  | { type: "legacy"; text: string };

export type ChronicleEntry = ChronicleEventType | string;

export interface CustomGoal {
  id: string;
  title: string;
  category: string;
  createdAt: string;
}

export interface GameState {
  name: string;
  bio: string;
  path: string;
  level: number;
  xp: number;
  coins: number;
  completedQuestsToday: Record<string, boolean>;
  passedQuestsToday: Record<string, boolean>;
  replacementsUsedToday: number;
  lastQuestDate: string; // YYYY-MM-DD
  weeklyQuestCount: number;
  lastWeeklyResetDate: string; // YYYY-MM-DD of Monday
  dailyRewardIndex: number; // 0..6
  lastRewardClaimDate: string; // YYYY-MM-DD
  plan: "Free" | "Pro" | "Elite";
  equipment: Record<string, number>;
  frame: number;
  title: number;
  background: number;
  achievements: Record<string, boolean>;
  chronicle: ChronicleEntry[];
  currentStreak: number;
  bestStreak: number;
  streakShieldsAvailable: number;
  lastShieldResetDate: string; // YYYY-MM-DD of Monday
  isRestDay: boolean;
  history: Array<{
    questId: string;
    questTitle: string;
    category: string;
    xp: number;
    coins: number;
    completedAt: string;
  }>;
  customGoals: CustomGoal[];
}

export const INITIAL_GAME_STATE: GameState = {
  name: "TraderOne",
  bio: "Мой путь — дисциплина и процесс.",
  path: "Discipline",
  level: 1,
  xp: 0,
  coins: 0,
  completedQuestsToday: {},
  passedQuestsToday: {},
  replacementsUsedToday: 0,
  lastQuestDate: "",
  weeklyQuestCount: 0,
  lastWeeklyResetDate: "",
  dailyRewardIndex: 0,
  lastRewardClaimDate: "",
  plan: "Free",
  equipment: {},
  frame: 1,
  title: 1,
  background: 0,
  achievements: {},
  chronicle: [{ type: "characterCreated" }],
  currentStreak: 0,
  bestStreak: 0,
  streakShieldsAvailable: 1,
  lastShieldResetDate: "",
  isRestDay: false,
  history: [],
  customGoals: [],
};

export function xpForNextLevel(level: number): number {
  return 80 + level * 40;
}

export function getCharacterStatus(
  completedQuestsTodayCount: number,
  isRestDay: boolean
): "Training" | "Resting" {
  if (isRestDay) return "Resting";
  return completedQuestsTodayCount >= 1 ? "Training" : "Resting";
}

export function getIsoDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getMondayIsoDateString(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return getIsoDateString(monday);
}

export function addChronicleEvent(
  chronicle: ChronicleEntry[],
  event: ChronicleEventType
): ChronicleEntry[] {
  const next = [event, ...chronicle];
  if (next.length > 30) {
    return next.slice(0, 30);
  }
  return next;
}

export function migrateState(rawState: any): GameState {
  if (!rawState || typeof rawState !== "object") return INITIAL_GAME_STATE;

  const chronicleMigrated: ChronicleEntry[] = Array.isArray(rawState.chronicle)
    ? rawState.chronicle.map((item: any) => {
        if (typeof item === "string") {
          return { type: "legacy", text: item };
        }
        return item;
      })
    : INITIAL_GAME_STATE.chronicle;

  return {
    ...INITIAL_GAME_STATE,
    ...rawState,
    chronicle: chronicleMigrated,
    completedQuestsToday: rawState.completedQuestsToday || {},
    passedQuestsToday: rawState.passedQuestsToday || {},
    history: rawState.history || [],
    customGoals: rawState.customGoals || [],
  };
}

export function checkAndApplyDateResets(
  state: GameState,
  currentDate: Date
): GameState {
  const todayStr = getIsoDateString(currentDate);
  const mondayStr = getMondayIsoDateString(currentDate);

  let updated = migrateState(state);

  // Check if date changed
  if (updated.lastQuestDate && updated.lastQuestDate !== todayStr) {
    // Check if yesterday was active (>=1 completed quest or rest day)
    const yesterdayDoneCount = Object.keys(updated.completedQuestsToday).length;
    const wasActive = yesterdayDoneCount >= 1 || updated.isRestDay;

    let newStreak = updated.currentStreak;
    let newShields = updated.streakShieldsAvailable;

    if (wasActive) {
      newStreak += 1;
    } else {
      // Try using streak shield
      if (newShields > 0) {
        newShields -= 1;
        // Shield protected the streak!
      } else {
        // Streak resets gracefully
        newStreak = 0;
      }
    }

    const newBest = Math.max(updated.bestStreak, newStreak);

    updated.currentStreak = newStreak;
    updated.bestStreak = newBest;
    updated.streakShieldsAvailable = newShields;
    updated.completedQuestsToday = {};
    updated.passedQuestsToday = {};
    updated.replacementsUsedToday = 0;
    updated.isRestDay = false;
    updated.lastQuestDate = todayStr;
  } else if (!updated.lastQuestDate) {
    updated.lastQuestDate = todayStr;
  }

  // Weekly reset
  if (updated.lastWeeklyResetDate !== mondayStr) {
    updated.weeklyQuestCount = 0;
    updated.lastWeeklyResetDate = mondayStr;
    updated.streakShieldsAvailable = GAME_CONFIG.STREAK_SHIELDS_PER_WEEK;
    updated.lastShieldResetDate = mondayStr;
  }

  return updated;
}

export function completeQuest(
  state: GameState,
  questId: string,
  questTitle: string,
  category: string,
  xpAmount: number = QUEST_XP,
  coinsAmount: number = QUEST_COINS,
  currentDate: Date = new Date()
): { state: GameState; leveledUp: boolean; newLevel?: number } {
  let newState = checkAndApplyDateResets(state, currentDate);

  if (newState.completedQuestsToday[questId]) {
    return { state: newState, leveledUp: false };
  }

  const updatedCompletedToday = {
    ...newState.completedQuestsToday,
    [questId]: true,
  };

  let newXp = newState.xp + xpAmount;
  let newCoins = newState.coins + coinsAmount;
  let newLevel = newState.level;
  let leveledUp = false;

  let chronicle = addChronicleEvent(newState.chronicle, {
    type: "questDone",
    title: questTitle,
    xp: xpAmount,
  });

  while (newXp >= xpForNextLevel(newLevel)) {
    newXp -= xpForNextLevel(newLevel);
    newLevel++;
    leveledUp = true;
    chronicle = addChronicleEvent(chronicle, {
      type: "levelUp",
      level: newLevel,
    });
  }

  const newHistory = [
    {
      questId,
      questTitle,
      category,
      xp: xpAmount,
      coins: coinsAmount,
      completedAt: getIsoDateString(currentDate),
    },
    ...newState.history,
  ];

  newState = {
    ...newState,
    completedQuestsToday: updatedCompletedToday,
    xp: newXp,
    coins: newCoins,
    level: newLevel,
    weeklyQuestCount: newState.weeklyQuestCount + 1,
    chronicle,
    history: newHistory,
  };

  return { state: newState, leveledUp, newLevel: leveledUp ? newLevel : undefined };
}

export function passQuest(
  state: GameState,
  questId: string,
  currentDate: Date = new Date()
): GameState {
  let newState = checkAndApplyDateResets(state, currentDate);
  return {
    ...newState,
    passedQuestsToday: {
      ...newState.passedQuestsToday,
      [questId]: true,
    },
  };
}

export function replaceQuest(
  state: GameState,
  questId: string,
  currentDate: Date = new Date()
): { state: GameState; success: boolean } {
  let newState = checkAndApplyDateResets(state, currentDate);

  if (newState.replacementsUsedToday >= GAME_CONFIG.QUEST_REPLACEMENTS_PER_DAY) {
    return { state: newState, success: false };
  }

  newState = {
    ...newState,
    replacementsUsedToday: newState.replacementsUsedToday + 1,
    passedQuestsToday: {
      ...newState.passedQuestsToday,
      [questId]: true,
    },
  };

  return { state: newState, success: true };
}

export function toggleRestDay(
  state: GameState,
  currentDate: Date = new Date()
): GameState {
  let newState = checkAndApplyDateResets(state, currentDate);
  return {
    ...newState,
    isRestDay: !newState.isRestDay,
  };
}

export function claimDailyReward(
  state: GameState,
  currentDate: Date = new Date()
): { state: GameState; claimedCoins: number } {
  let newState = checkAndApplyDateResets(state, currentDate);
  const todayStr = getIsoDateString(currentDate);

  if (newState.lastRewardClaimDate === todayStr) {
    return { state: newState, claimedCoins: 0 };
  }

  const rewardIndex = newState.dailyRewardIndex % 7;
  const claimedCoins = DAILY_REWARDS[rewardIndex];

  const chronicle = addChronicleEvent(newState.chronicle, {
    type: "dailyReward",
    coins: claimedCoins,
  });

  newState = {
    ...newState,
    coins: newState.coins + claimedCoins,
    dailyRewardIndex: newState.dailyRewardIndex + 1,
    lastRewardClaimDate: todayStr,
    chronicle,
  };

  return { state: newState, claimedCoins };
}

export function changePlan(
  state: GameState,
  plan: "Free" | "Pro" | "Elite"
): GameState {
  if (state.plan === plan) return state;

  const chronicle = addChronicleEvent(state.chronicle, {
    type: "planChanged",
    plan,
  });
  return {
    ...state,
    plan,
    chronicle,
  };
}

export function addCustomGoal(
  state: GameState,
  title: string,
  category: string
): GameState {
  if (state.customGoals.length >= GAME_CONFIG.MAX_CUSTOM_GOALS) return state;
  const newGoal: CustomGoal = {
    id: `goal_${Date.now()}`,
    title,
    category,
    createdAt: getIsoDateString(new Date()),
  };
  return {
    ...state,
    customGoals: [...state.customGoals, newGoal],
  };
}

export function removeCustomGoal(state: GameState, goalId: string): GameState {
  return {
    ...state,
    customGoals: state.customGoals.filter((g) => g.id !== goalId),
  };
}
