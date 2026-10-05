import { GAME_CONFIG, StatKey, ReputationStageKey } from "./game-config";
import { TITLES_CATALOG } from "./titles";

export type { StatKey, ReputationStageKey };

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
  | { type: "titleUnlocked"; titleId: string }
  | { type: "titleSelected"; titleId: string }
  | { type: "nicknameChanged"; name: string }
  | { type: "postPublished" }
  | { type: "legacy"; text: string };

export type ChronicleEntry = ChronicleEventType | string;

export interface CustomGoal {
  id: string;
  title: string;
  category: string;
  createdAt: string;
}

export interface StatSnapshot {
  date: string;
  stats: Record<StatKey, number>;
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
  title: number; // Legacy ID for backwards compatibility
  unlockedTitles: string[];
  selectedTitle: string;
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
  stats: Record<StatKey, number>;
  statSnapshots: StatSnapshot[];
}

export const DEFAULT_NICKNAME = "TraderOne";

export const INITIAL_STATS: Record<StatKey, number> = {
  discipline: 40,
  trading: 30,
  intelligence: 20,
  focus: 25,
  psychology: 20,
  knowledge: 15,
  endurance: 10,
  strength: 10,
};

export const INITIAL_GAME_STATE: GameState = {
  name: DEFAULT_NICKNAME,
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
    "Верх": 0,
    "Низ": 3,
    "Обувь": 5,
  },
  frame: 1,
  title: 1,
  unlockedTitles: ["novice"],
  selectedTitle: "novice",
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
  stats: { ...INITIAL_STATS },
  statSnapshots: [],
};

// --- Nickname Transliteration & Validation ---

const CYRILLIC_TO_LATIN_MAP: Record<string, string> = {
  А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ё: "Yo", Ж: "Zh",
  З: "Z", И: "I", Й: "Y", К: "K", Л: "L", М: "M", Н: "N", О: "O",
  П: "P", Р: "R", С: "S", Т: "T", У: "U", Ф: "F", Х: "Kh", Ц: "Ts",
  Ч: "Ch", Ш: "Sh", Щ: "Shch", Ъ: "", Ы: "Y", Ь: "", Э: "E", Ю: "Yu",
  Я: "Ya",
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

export function transliterateCyrillic(text: string): string {
  if (!text) return DEFAULT_NICKNAME;
  let result = "";
  for (const char of text) {
    if (CYRILLIC_TO_LATIN_MAP[char] !== undefined) {
      result += CYRILLIC_TO_LATIN_MAP[char];
    } else if (/[A-Za-z0-9_\.-]/.test(char)) {
      result += char;
    }
  }
  const trimmed = result.trim().slice(0, 24);
  if (trimmed.length < 3) {
    return DEFAULT_NICKNAME;
  }
  return trimmed;
}

export function validateNickname(rawName: string): {
  isValid: boolean;
  trimmedName: string;
  errorKey?: string;
} {
  const trimmed = rawName.trim();
  if (trimmed.length < 3 || trimmed.length > 24) {
    return {
      isValid: false,
      trimmedName: trimmed,
      errorKey: "profile.nicknameErrorLength",
    };
  }
  const validPattern = /^[A-Za-z0-9_\.-]+$/;
  if (!validPattern.test(trimmed)) {
    return {
      isValid: false,
      trimmedName: trimmed,
      errorKey: "profile.nicknameErrorChars",
    };
  }
  return {
    isValid: true,
    trimmedName: trimmed,
  };
}

export function containsCyrillic(text: string): boolean {
  return /[а-яА-ЯёЁ]/.test(text);
}

// --- XP & Level Calculations ---

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

// --- Reputation Functions ---

export interface ReputationInfo {
  points: number;
  stageKey: ReputationStageKey;
  stageIndex: number;
  nextStagePoints: number;
  pointsToNextStage: number;
  progressPercent: number;
  utilityPoints: number;
  qualityPoints: number;
  stabilityPoints: number;
}

export function getReputation(state: GameState): ReputationInfo {
  const totalQuestsCompleted = state.history ? state.history.length : 0;
  const utilityPoints = totalQuestsCompleted * 5;

  let totalStatLevels = 0;
  const stats = state.stats || INITIAL_STATS;
  for (const key of GAME_CONFIG.STAT_KEYS) {
    const info = getStatLevelAndRank(stats[key] || 0);
    totalStatLevels += info.level;
  }
  const qualityPoints = totalStatLevels * 5;
  const stabilityPoints = (state.currentStreak || 0) * 10;

  const points = utilityPoints + qualityPoints + stabilityPoints;

  const stages = GAME_CONFIG.REPUTATION_STAGES;
  let currentStageIndex = 0;

  for (let i = stages.length - 1; i >= 0; i--) {
    if (points >= stages[i].minPoints) {
      currentStageIndex = i;
      break;
    }
  }

  const currentStage = stages[currentStageIndex];
  const isMaxStage = currentStageIndex === stages.length - 1;

  let nextStagePoints = isMaxStage ? currentStage.minPoints : stages[currentStageIndex + 1].minPoints;
  let pointsToNextStage = isMaxStage ? 0 : nextStagePoints - points;

  let progressPercent = 100;
  if (!isMaxStage) {
    const stageSpan = nextStagePoints - currentStage.minPoints;
    const progressInStage = points - currentStage.minPoints;
    progressPercent = Math.min(100, Math.max(0, Math.round((progressInStage / stageSpan) * 100)));
  }

  return {
    points,
    stageKey: currentStage.key,
    stageIndex: currentStageIndex,
    nextStagePoints,
    pointsToNextStage,
    progressPercent,
    utilityPoints,
    qualityPoints,
    stabilityPoints,
  };
}

// --- Stat Level & Rank Functions ---

export interface StatInfo {
  xp: number;
  level: number;
  rankKey: string;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPercent: number;
}

export function getStatLevelAndRank(xp: number): StatInfo {
  const thresholds = GAME_CONFIG.STAT_THRESHOLDS;
  let level = 1;
  let rankKey = "novice";

  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (xp >= thresholds[i].xpRequired) {
      level = thresholds[i].level;
      rankKey = thresholds[i].rankKey;
      break;
    }
  }

  const currentLevelMinXp = thresholds[level - 1].xpRequired;
  const isMaxLevel = level >= thresholds.length;
  const nextLevelXp = isMaxLevel ? currentLevelMinXp : thresholds[level].xpRequired;

  let progressPercent = 100;
  if (!isMaxLevel) {
    const span = nextLevelXp - currentLevelMinXp;
    const prog = xp - currentLevelMinXp;
    progressPercent = Math.min(100, Math.max(0, Math.round((prog / span) * 100)));
  }

  return {
    xp,
    level,
    rankKey,
    currentLevelXp: xp - currentLevelMinXp,
    nextLevelXp: isMaxLevel ? 0 : nextLevelXp - currentLevelMinXp,
    progressPercent,
  };
}

export function getCharacterPower(state: GameState): number {
  let totalXp = 0;
  const stats = state.stats || INITIAL_STATS;
  for (const key of GAME_CONFIG.STAT_KEYS) {
    totalXp += stats[key] || 0;
  }
  return totalXp + (state.level || 1) * 100;
}

export function getStatBalance(state: GameState): {
  isBalanced: boolean;
  strongestStat: StatKey;
  weakestStat: StatKey;
  recommendedCategory: string;
} {
  const stats = state.stats || INITIAL_STATS;
  let maxStat: StatKey = "discipline";
  let minStat: StatKey = "discipline";
  let maxXp = -1;
  let minXp = Infinity;

  for (const key of GAME_CONFIG.STAT_KEYS) {
    const val = stats[key] || 0;
    if (val > maxXp) {
      maxXp = val;
      maxStat = key;
    }
    if (val < minXp) {
      minXp = val;
      minStat = key;
    }
  }

  const isBalanced = maxXp - minXp <= 100;

  const statToCategory: Record<StatKey, string> = {
    discipline: "Discipline",
    trading: "Trading",
    intelligence: "Mental",
    focus: "Psychology",
    psychology: "Psychology",
    knowledge: "Mental",
    endurance: "Physical",
    strength: "Physical",
  };

  return {
    isBalanced,
    strongestStat: maxStat,
    weakestStat: minStat,
    recommendedCategory: statToCategory[minStat] || "Trading",
  };
}

export function updateStatSnapshots(
  snapshots: StatSnapshot[],
  dateStr: string,
  stats: Record<StatKey, number>
): StatSnapshot[] {
  const filtered = snapshots.filter((s) => s.date !== dateStr);
  const next = [...filtered, { date: dateStr, stats: { ...stats } }];
  if (next.length > 30) {
    return next.slice(next.length - 30);
  }
  return next;
}

// --- Title Logic ---

export function checkAndUnlockTitles(state: GameState): {
  state: GameState;
  newlyUnlocked: string[];
} {
  const newlyUnlocked: string[] = [];
  let unlocked = [...(state.unlockedTitles || ["novice"])];
  let chronicle = state.chronicle;

  for (const item of TITLES_CATALOG) {
    if (unlocked.includes(item.id)) continue;
    if (item.isComingSoon) continue;

    let conditionMet = false;
    if (item.source === "level" && item.reqLevel && state.level >= item.reqLevel) {
      conditionMet = true;
    } else if (item.source === "achievement" && item.reqAchievement) {
      if (state.achievements && state.achievements[item.reqAchievement]) {
        conditionMet = true;
      }
    }

    if (conditionMet) {
      unlocked.push(item.id);
      newlyUnlocked.push(item.id);
      chronicle = addChronicleEvent(chronicle, {
        type: "titleUnlocked",
        titleId: item.id,
      });
    }
  }

  return {
    state: {
      ...state,
      unlockedTitles: unlocked,
      chronicle,
    },
    newlyUnlocked,
  };
}

export function selectTitle(
  state: GameState,
  titleId: string
): { state: GameState; success: boolean } {
  if (!state.unlockedTitles.includes(titleId)) {
    return { state, success: false };
  }
  if (state.selectedTitle === titleId) {
    return { state, success: true };
  }

  const chronicle = addChronicleEvent(state.chronicle, {
    type: "titleSelected",
    titleId,
  });

  return {
    state: {
      ...state,
      selectedTitle: titleId,
      chronicle,
    },
    success: true,
  };
}

// --- Migration ---

export function migrateState(rawState: any): GameState {
  if (!rawState || typeof rawState !== "object") return INITIAL_GAME_STATE;

  // 1. Bio migration: if default text or empty string, convert to null
  let bio = rawState.bio;
  if (
    bio === undefined ||
    bio === "Мой путь — дисциплина и процесс." ||
    bio === ""
  ) {
    bio = null;
  }

  // 2. Nickname migration: if contains Cyrillic or invalid chars, transliterate & sanitize
  let name = rawState.name || DEFAULT_NICKNAME;
  if (containsCyrillic(name)) {
    name = transliterateCyrillic(name);
  } else {
    const val = validateNickname(name);
    if (!val.isValid) {
      name = DEFAULT_NICKNAME;
    }
  }

  // 3. Chronicle migration
  const chronicleMigrated: ChronicleEntry[] = Array.isArray(rawState.chronicle)
    ? rawState.chronicle.map((item: any) => {
        if (typeof item === "string") {
          return { type: "legacy", text: item };
        }
        return item;
      })
    : INITIAL_GAME_STATE.chronicle;

  // 4. Equipment migration: preserve starter equipment if empty
  let equipment = rawState.equipment;
  if (!equipment || typeof equipment !== "object" || Object.keys(equipment).length === 0) {
    equipment = {
      "Верх": 0,
      "Низ": 3,
      "Обувь": 5,
    };
  }

  // 5. Title migration
  let unlockedTitles: string[] = Array.isArray(rawState.unlockedTitles)
    ? rawState.unlockedTitles
    : ["novice"];
  if (!unlockedTitles.includes("novice")) {
    unlockedTitles.push("novice");
  }

  let selectedTitle = rawState.selectedTitle || "novice";
  if (!unlockedTitles.includes(selectedTitle)) {
    selectedTitle = "novice";
  }

  // 6. Stats & Snapshots
  const stats = {
    ...INITIAL_STATS,
    ...(rawState.stats || {}),
  };

  const statSnapshots = Array.isArray(rawState.statSnapshots)
    ? rawState.statSnapshots
    : [];

  const merged: GameState = {
    ...INITIAL_GAME_STATE,
    ...rawState,
    name,
    bio,
    equipment,
    unlockedTitles,
    selectedTitle,
    chronicle: chronicleMigrated,
    stats,
    statSnapshots,
    completedQuestsToday: rawState.completedQuestsToday || {},
    passedQuestsToday: rawState.passedQuestsToday || {},
    history: rawState.history || [],
    customGoals: rawState.customGoals || [],
  };

  // Run auto-unlock check on migrated state
  const { state: checkedState } = checkAndUnlockTitles(merged);
  return checkedState;
}

// --- Date Resets & Quest Actions ---

export function checkAndApplyDateResets(
  state: GameState,
  currentDate: Date
): GameState {
  const todayStr = getIsoDateString(currentDate);
  const mondayStr = getMondayIsoDateString(currentDate);

  let updated = migrateState(state);

  // Check if date changed
  if (updated.lastQuestDate && updated.lastQuestDate !== todayStr) {
    const yesterdayDoneCount = Object.keys(updated.completedQuestsToday).length;
    const wasActive = yesterdayDoneCount >= 1 || updated.isRestDay;

    let newStreak = updated.currentStreak;
    let newShields = updated.streakShieldsAvailable;

    if (wasActive) {
      newStreak += 1;
    } else {
      if (newShields > 0) {
        newShields -= 1;
      } else {
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

    // Take daily stat snapshot
    updated.statSnapshots = updateStatSnapshots(
      updated.statSnapshots,
      todayStr,
      updated.stats
    );
  } else if (!updated.lastQuestDate) {
    updated.lastQuestDate = todayStr;
    updated.statSnapshots = updateStatSnapshots(
      updated.statSnapshots,
      todayStr,
      updated.stats
    );
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

  // Check achievements
  let achievements = { ...newState.achievements };
  if (!achievements["first_quest"]) {
    achievements["first_quest"] = true;
    chronicle = addChronicleEvent(chronicle, {
      type: "achievementUnlocked",
      title: "First Quest Completed",
    });
  }

  // Grant Stat XP based on category
  const updatedStats = { ...newState.stats };
  const statGains: Record<string, StatKey[]> = {
    Trading: ["trading", "discipline", "intelligence"],
    Discipline: ["discipline", "endurance"],
    Psychology: ["psychology", "focus"],
    Physical: ["strength", "endurance"],
    Mental: ["intelligence", "focus", "knowledge"],
    Social: ["knowledge"],
    Lifestyle: ["psychology", "strength"],
  };

  const targetStats = statGains[category] || ["discipline"];
  for (const sk of targetStats) {
    updatedStats[sk] = (updatedStats[sk] || 0) + 15;
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
    achievements,
    stats: updatedStats,
  };

  // Re-check title unlocks
  const titleCheck = checkAndUnlockTitles(newState);
  newState = titleCheck.state;

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

export function equipItem(
  state: GameState,
  slot: string,
  itemId: number,
  itemName: string
): GameState {
  const newEquipment = {
    ...state.equipment,
    [slot]: itemId,
  };

  let chronicle = addChronicleEvent(state.chronicle, {
    type: "itemEquipped",
    name: itemName,
  });

  let achievements = { ...state.achievements };
  if (!achievements["first_equip"]) {
    achievements["first_equip"] = true;
    chronicle = addChronicleEvent(chronicle, {
      type: "achievementUnlocked",
      title: "First Item Equipped",
    });
  }

  let newState: GameState = {
    ...state,
    equipment: newEquipment,
    chronicle,
    achievements,
  };

  const titleCheck = checkAndUnlockTitles(newState);
  return titleCheck.state;
}

export function unequipItem(state: GameState, slot: string): GameState {
  const newEquipment = { ...state.equipment };
  delete newEquipment[slot];
  return {
    ...state,
    equipment: newEquipment,
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
