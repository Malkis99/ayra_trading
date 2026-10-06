import { GAME_CONFIG } from "./game-config";
import { ITEMS } from "./items";
import { TITLES_CATALOG } from "./titles";
import { transliterateNickname, isValidLatinNickname } from "./stats";

export const DAILY_REWARDS = GAME_CONFIG.DAILY_REWARD_VALUES;
export const QUEST_XP = GAME_CONFIG.QUEST_XP;
export const QUEST_COINS = GAME_CONFIG.QUEST_COINS;

export type ChronicleEventType =
  | { type: "characterCreated" }
  | { type: "questDone"; title: string; xp: number }
  | { type: "levelUp"; level: number }
  | { type: "dailyReward"; coins: number }
  | { type: "planChanged"; plan: "Free" | "Pro" | "Elite" }
  | { type: "itemEquipped"; itemId: number; name?: string }
  | { type: "itemUnequipped"; slot: string; itemId?: number }
  | { type: "titleSelected"; titleId: string }
  | { type: "titleUnlocked"; titleId: string }
  | { type: "achievementUnlocked"; achievementId: string; title?: string }
  | { type: "postPublished" }
  | { type: "profileUpdated" }
  | { type: "legacy"; text: string };

export type ChronicleEntry = ChronicleEventType | string;

export interface CustomGoal {
  id: string;
  title: string;
  category: string;
  createdAt: string;
}

export interface StatSnapshot {
  date: string; // YYYY-MM-DD
  values: Record<string, number>;
}

export interface GameState {
  name: string;
  bio: string | null;
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
  title: number; // legacy title id
  unlockedTitles: string[];
  selectedTitle: string;
  background: number;
  loadouts: Record<string, Record<string, number>>;
  activeLoadout: string;
  itemsEquippedCount: number;
  achievements: Record<string, boolean>;
  posts: string[];
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
  statSnapshots: StatSnapshot[];
}

export const INITIAL_GAME_STATE: GameState = {
  name: "TraderOne",
  bio: null,
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
  equipment: {
    Верх: 0, // Starter Shirt
    Низ: 3,  // Starter Pants
    Обувь: 5 // Starter Sneakers
  },
  frame: 1,
  title: 1,
  unlockedTitles: ["novice"],
  selectedTitle: "novice",
  background: 0,
  loadouts: {
    session: {},
    community: {},
  },
  activeLoadout: "session",
  itemsEquippedCount: 0,
  achievements: {},
  posts: [],
  chronicle: [{ type: "characterCreated" }],
  currentStreak: 0,
  bestStreak: 0,
  streakShieldsAvailable: 1,
  lastShieldResetDate: "",
  isRestDay: false,
  history: [],
  customGoals: [],
  statSnapshots: [],
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

  // 1. Bio migration: if default text, set to null
  let bio = rawState.bio;
  if (
    bio === "Мой путь — дисциплина и процесс." ||
    bio === "My path is discipline and process" ||
    bio === "My path is discipline and process."
  ) {
    bio = null;
  }

  // 2. Nickname migration: transliterate if contains Cyrillic or non-allowed chars
  let name = rawState.name || INITIAL_GAME_STATE.name;
  if (!isValidLatinNickname(name)) {
    name = transliterateNickname(name);
  }

  // 3. Loadouts migration: map legacy keys "Сессия" / "Сообщество" to "session" / "community"
  let loadouts = rawState.loadouts;
  if (loadouts && typeof loadouts === "object") {
    const newLoadouts: Record<string, Record<string, number>> = {};
    Object.entries(loadouts).forEach(([k, v]) => {
      const newKey = k === "Сессия" ? "session" : k === "Сообщество" ? "community" : k;
      newLoadouts[newKey] = v as Record<string, number>;
    });
    loadouts = newLoadouts;
  } else {
    loadouts = INITIAL_GAME_STATE.loadouts;
  }

  let activeLoadout = rawState.activeLoadout || "session";
  if (activeLoadout === "Сессия") activeLoadout = "session";
  if (activeLoadout === "Сообщество") activeLoadout = "community";

  // 4. Titles silent migration based on requirements without toasts/chronicle
  const unlockedTitles = new Set<string>(
    Array.isArray(rawState.unlockedTitles) ? rawState.unlockedTitles : ["novice"]
  );
  unlockedTitles.add("novice");

  const currentLevel = rawState.level || 1;
  const currentAch = rawState.achievements || {};

  TITLES_CATALOG.forEach((t) => {
    if (t.source === "level" && t.reqLevel && currentLevel >= t.reqLevel) {
      unlockedTitles.add(t.id);
    }
    if (t.source === "achievement" && t.reqAchievement && currentAch[t.reqAchievement]) {
      unlockedTitles.add(t.id);
    }
  });

  const selectedTitle =
    rawState.selectedTitle && unlockedTitles.has(rawState.selectedTitle)
      ? rawState.selectedTitle
      : "novice";

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
    name,
    bio,
    loadouts,
    activeLoadout,
    unlockedTitles: Array.from(unlockedTitles),
    selectedTitle,
    itemsEquippedCount: rawState.itemsEquippedCount || 0,
    achievements: rawState.achievements || {},
    posts: rawState.posts || [],
    chronicle: chronicleMigrated,
    completedQuestsToday: rawState.completedQuestsToday || {},
    passedQuestsToday: rawState.passedQuestsToday || {},
    history: rawState.history || [],
    customGoals: rawState.customGoals || [],
    statSnapshots: Array.isArray(rawState.statSnapshots) ? rawState.statSnapshots : [],
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

export function checkAchievements(
  state: GameState
): { state: GameState; newlyUnlocked: string[] } {
  const newlyUnlocked: string[] = [];
  let updatedState = { ...state };
  let chronicle = [...updatedState.chronicle];

  // 1. firstQuest: completed >= 1 quest
  const hasFirstQuest =
    updatedState.history.length >= 1 ||
    Object.keys(updatedState.completedQuestsToday).length >= 1 ||
    updatedState.weeklyQuestCount >= 1;

  if (hasFirstQuest && !updatedState.achievements["firstQuest"]) {
    updatedState.achievements = { ...updatedState.achievements, firstQuest: true };
    chronicle = addChronicleEvent(chronicle, {
      type: "achievementUnlocked",
      achievementId: "firstQuest",
    });
    newlyUnlocked.push("firstQuest");
  }

  // 2. stylist: itemsEquippedCount >= 1 or Object.keys(equipment).length >= 1
  const hasStylist =
    updatedState.itemsEquippedCount >= 1 ||
    Object.keys(updatedState.equipment).length >= 1;

  if (hasStylist && !updatedState.achievements["stylist"]) {
    updatedState.achievements = { ...updatedState.achievements, stylist: true };
    chronicle = addChronicleEvent(chronicle, {
      type: "achievementUnlocked",
      achievementId: "stylist",
    });
    newlyUnlocked.push("stylist");
  }

  // 3. streakDay: 3 quests completed today
  const hasStreakDay = Object.keys(updatedState.completedQuestsToday).length >= 3;

  if (hasStreakDay && !updatedState.achievements["streakDay"]) {
    updatedState.achievements = { ...updatedState.achievements, streakDay: true };
    chronicle = addChronicleEvent(chronicle, {
      type: "achievementUnlocked",
      achievementId: "streakDay",
    });
    newlyUnlocked.push("streakDay");
  }

  // 4. level3: level >= 3
  const hasLevel3 = updatedState.level >= 3;

  if (hasLevel3 && !updatedState.achievements["level3"]) {
    updatedState.achievements = { ...updatedState.achievements, level3: true };
    chronicle = addChronicleEvent(chronicle, {
      type: "achievementUnlocked",
      achievementId: "level3",
    });
    newlyUnlocked.push("level3");
  }

  // 5. author: posts.length >= 1
  const hasAuthor = updatedState.posts.length >= 1;

  if (hasAuthor && !updatedState.achievements["author"]) {
    updatedState.achievements = { ...updatedState.achievements, author: true };
    chronicle = addChronicleEvent(chronicle, {
      type: "achievementUnlocked",
      achievementId: "author",
    });
    newlyUnlocked.push("author");
  }

  updatedState.chronicle = chronicle;
  return { state: updatedState, newlyUnlocked };
}

export function completeQuest(
  state: GameState,
  questId: string,
  questTitle: string,
  category: string,
  xpAmount: number = QUEST_XP,
  coinsAmount: number = QUEST_COINS,
  currentDate: Date = new Date()
): {
  state: GameState;
  leveledUp: boolean;
  newLevel?: number;
  newlyUnlocked: string[];
} {
  let newState = checkAndApplyDateResets(state, currentDate);

  if (newState.completedQuestsToday[questId]) {
    return { state: newState, leveledUp: false, newlyUnlocked: [] };
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

  const { state: finalState, newlyUnlocked } = checkAchievements(newState);

  return {
    state: finalState,
    leveledUp,
    newLevel: leveledUp ? newLevel : undefined,
    newlyUnlocked,
  };
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

export function equipItem(
  state: GameState,
  itemId: number
): { state: GameState; newlyUnlocked: string[] } {
  const item = ITEMS[itemId];
  if (!item || state.level < item.reqLevel) {
    return { state, newlyUnlocked: [] };
  }

  const newEq = { ...state.equipment, [item.slot]: itemId };
  let chronicle = addChronicleEvent(state.chronicle, {
    type: "itemEquipped",
    itemId,
  });

  const nextState: GameState = {
    ...state,
    equipment: newEq,
    itemsEquippedCount: state.itemsEquippedCount + 1,
    chronicle,
  };

  return checkAchievements(nextState);
}

export function unequipSlot(
  state: GameState,
  slot: string
): { state: GameState; newlyUnlocked: string[] } {
  if (state.equipment[slot] == null) {
    return { state, newlyUnlocked: [] };
  }

  const itemId = state.equipment[slot];
  const newEq = { ...state.equipment };
  delete newEq[slot];

  let chronicle = addChronicleEvent(state.chronicle, {
    type: "itemUnequipped",
    slot,
    itemId,
  });

  const nextState: GameState = {
    ...state,
    equipment: newEq,
    chronicle,
  };

  return checkAchievements(nextState);
}

export function applyLoadout(
  state: GameState,
  loadoutName: string
): { state: GameState; newlyUnlocked: string[] } {
  const targetEq = state.loadouts[loadoutName] || {};
  const nextState: GameState = {
    ...state,
    equipment: { ...targetEq },
    activeLoadout: loadoutName,
  };

  return checkAchievements(nextState);
}

export function saveLoadout(state: GameState, loadoutName: string): GameState {
  return {
    ...state,
    loadouts: {
      ...state.loadouts,
      [loadoutName]: { ...state.equipment },
    },
    activeLoadout: loadoutName,
  };
}

export function addPost(
  state: GameState,
  content: string
): { state: GameState; newlyUnlocked: string[] } {
  const trimmed = content.trim();
  if (!trimmed || trimmed.length > 280) {
    return { state, newlyUnlocked: [] };
  }

  let chronicle = addChronicleEvent(state.chronicle, {
    type: "postPublished",
  });

  const nextState: GameState = {
    ...state,
    posts: [trimmed, ...state.posts],
    chronicle,
  };

  return checkAchievements(nextState);
}

export function selectTitle(
  state: GameState,
  titleId: string
): GameState {
  if (!state.unlockedTitles.includes(titleId) || state.selectedTitle === titleId) {
    return state;
  }
  const chronicle = addChronicleEvent(state.chronicle, {
    type: "titleSelected",
    titleId,
  });
  return {
    ...state,
    selectedTitle: titleId,
    chronicle,
  };
}

export function checkAndUnlockTitles(
  state: GameState
): { state: GameState; newlyUnlockedTitles: string[] } {
  const newlyUnlockedTitles: string[] = [];
  const currentUnlocked = new Set(state.unlockedTitles);
  let chronicle = state.chronicle;

  TITLES_CATALOG.forEach((t) => {
    if (currentUnlocked.has(t.id)) return;

    let unlock = false;
    if (t.source === "level" && t.reqLevel && state.level >= t.reqLevel) {
      unlock = true;
    }
    if (t.source === "achievement" && t.reqAchievement && state.achievements[t.reqAchievement]) {
      unlock = true;
    }

    if (unlock) {
      currentUnlocked.add(t.id);
      newlyUnlockedTitles.push(t.id);
      chronicle = addChronicleEvent(chronicle, {
        type: "titleUnlocked",
        titleId: t.id,
      });
    }
  });

  if (newlyUnlockedTitles.length === 0) {
    return { state, newlyUnlockedTitles: [] };
  }

  return {
    state: {
      ...state,
      unlockedTitles: Array.from(currentUnlocked),
      chronicle,
    },
    newlyUnlockedTitles,
  };
}

export function updateProfileInfo(
  state: GameState,
  name: string,
  bio: string
): GameState {
  const trimmedName = name.trim();
  const finalName =
    trimmedName && isValidLatinNickname(trimmedName) ? trimmedName : state.name;
  const finalBio = bio.trim() ? bio.slice(0, 160) : null;

  const changed = finalName !== state.name || finalBio !== state.bio;
  let chronicle = state.chronicle;

  if (changed) {
    chronicle = addChronicleEvent(chronicle, { type: "profileUpdated" });
  }

  return {
    ...state,
    name: finalName,
    bio: finalBio,
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
