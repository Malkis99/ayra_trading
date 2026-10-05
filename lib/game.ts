export const DAILY_REWARDS = [10, 10, 15, 15, 20, 25, 50] as const;
export const QUEST_XP = 40;
export const QUEST_COINS = 10;

export interface GameState {
  name: string;
  bio: string;
  path: string;
  level: number;
  xp: number;
  coins: number;
  completedQuestsToday: Record<number, boolean>;
  lastQuestDate: string; // YYYY-MM-DD
  weeklyQuestCount: number;
  lastWeeklyResetDate: string; // YYYY-MM-DD of Monday
  dailyRewardIndex: number; // 0..6 or continuous count
  lastRewardClaimDate: string; // YYYY-MM-DD
  plan: "Free" | "Pro" | "Elite";
  equipment: Record<string, number>;
  frame: number;
  title: number;
  background: number;
  achievements: Record<string, boolean>;
  chronicle: string[];
}

export const INITIAL_GAME_STATE: GameState = {
  name: "TraderOne",
  bio: "Мой путь — дисциплина и процесс.",
  path: "Discipline",
  level: 1,
  xp: 0,
  coins: 0,
  completedQuestsToday: {},
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
  chronicle: ["Персонаж создан"],
};

export function xpForNextLevel(level: number): number {
  return 80 + level * 40;
}

export function getCharacterStatus(completedQuestsTodayCount: number): "Training" | "Resting" {
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
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
  const monday = new Date(d.setDate(diff));
  return getIsoDateString(monday);
}

export function addChronicleEvent(chronicle: string[], event: string): string[] {
  const next = [event, ...chronicle];
  if (next.length > 30) {
    return next.slice(0, 30);
  }
  return next;
}

export function checkAndApplyDateResets(state: GameState, currentDate: Date): GameState {
  const todayStr = getIsoDateString(currentDate);
  const mondayStr = getMondayIsoDateString(currentDate);

  let updatedState = { ...state };

  // Daily quest reset
  if (updatedState.lastQuestDate !== todayStr) {
    updatedState.completedQuestsToday = {};
    updatedState.lastQuestDate = todayStr;
  }

  // Weekly quest reset
  if (updatedState.lastWeeklyResetDate !== mondayStr) {
    updatedState.weeklyQuestCount = 0;
    updatedState.lastWeeklyResetDate = mondayStr;
  }

  return updatedState;
}

export function completeQuest(
  state: GameState,
  questIndex: number,
  questTitle: string,
  currentDate: Date
): { state: GameState; leveledUp: boolean; newLevel?: number } {
  let newState = checkAndApplyDateResets(state, currentDate);

  if (newState.completedQuestsToday[questIndex]) {
    return { state: newState, leveledUp: false };
  }

  const updatedCompletedToday = {
    ...newState.completedQuestsToday,
    [questIndex]: true,
  };

  let newXp = newState.xp + QUEST_XP;
  let newCoins = newState.coins + QUEST_COINS;
  let newLevel = newState.level;
  let leveledUp = false;

  let chronicle = addChronicleEvent(
    newState.chronicle,
    `Квест: ${questTitle} (+${QUEST_XP} XP)`
  );

  while (newXp >= xpForNextLevel(newLevel)) {
    newXp -= xpForNextLevel(newLevel);
    newLevel++;
    leveledUp = true;
    chronicle = addChronicleEvent(chronicle, `Level up! Lv ${newLevel}`);
  }

  newState = {
    ...newState,
    completedQuestsToday: updatedCompletedToday,
    xp: newXp,
    coins: newCoins,
    level: newLevel,
    weeklyQuestCount: newState.weeklyQuestCount + 1,
    chronicle,
  };

  return { state: newState, leveledUp, newLevel: leveledUp ? newLevel : undefined };
}

export function claimDailyReward(
  state: GameState,
  currentDate: Date
): { state: GameState; claimedCoins: number } {
  let newState = checkAndApplyDateResets(state, currentDate);
  const todayStr = getIsoDateString(currentDate);

  if (newState.lastRewardClaimDate === todayStr) {
    return { state: newState, claimedCoins: 0 };
  }

  const rewardIndex = newState.dailyRewardIndex % 7;
  const claimedCoins = DAILY_REWARDS[rewardIndex];

  const chronicle = addChronicleEvent(
    newState.chronicle,
    `Ежедневная награда: +${claimedCoins} Coins`
  );

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

  const chronicle = addChronicleEvent(state.chronicle, `Тариф: ${plan}`);
  return {
    ...state,
    plan,
    chronicle,
  };
}
