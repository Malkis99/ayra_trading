// Cyrillic to Latin transliteration map for migration
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
  А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ё: "Yo", Ж: "Zh",
  З: "Z", И: "I", Й: "Y", К: "K", Л: "L", М: "M", Н: "N", О: "O",
  П: "P", Р: "R", С: "S", Т: "T", У: "U", Ф: "F", Х: "Kh", Ц: "Ts",
  Ч: "Ch", Ш: "Sh", Щ: "Shch", Ъ: "", Ы: "Y", Ь: "", Э: "E", Ю: "Yu",
  Я: "Ya",
};

/**
 * Validates Latin nickname according to requirements:
 * Latin letters (A-Z, a-z), digits (0-9), _, ., -
 * Length: 3–24 characters.
 */
export function isValidLatinNickname(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 24) return false;
  return /^[A-Za-z0-9_.-]+$/.test(trimmed);
}

/**
 * Transliterates Cyrillic text to Latin using the mapping table.
 * Strips non-allowed characters, trims to 24 characters max.
 * Returns default "TraderOne" if result length < 3.
 */
export function transliterateNickname(name: string): string {
  const trimmed = name.trim();
  let result = "";
  for (const char of trimmed) {
    if (CYRILLIC_TO_LATIN[char] !== undefined) {
      result += CYRILLIC_TO_LATIN[char];
    } else if (/[A-Za-z0-9_.-]/.test(char)) {
      result += char;
    }
  }
  result = result.slice(0, 24);
  if (result.length < 3) {
    return "TraderOne";
  }
  return result;
}

export const REPUTATION_TIERS = [
  { id: "growing", minPoints: 0, maxPoints: 100 },
  { id: "reliable", minPoints: 101, maxPoints: 250 },
  { id: "trusted", minPoints: 251, maxPoints: 500 },
  { id: "respected", minPoints: 501, maxPoints: 1000 },
  { id: "honored", minPoints: 1001, maxPoints: Infinity },
] as const;

export type ReputationTierId = typeof REPUTATION_TIERS[number]["id"];

export interface ReputationInfo {
  points: number;
  tierId: ReputationTierId;
  tierIndex: number;
  currentTierMin: number;
  nextTierMin: number | null;
  pointsToNext: number;
  usefulness: number;
  quality: number;
  consistency: number;
}

/**
 * Pure function to calculate Reputation metrics.
 */
export function getReputation(state: { level: number; history?: any[]; currentStreak?: number }): ReputationInfo {
  const level = state.level || 1;
  const historyCount = state.history?.length || 0;
  const streak = state.currentStreak || 0;

  const points = Math.min(2000, level * 20 + historyCount * 5 + streak * 10);

  let tierIndex = 0;
  for (let i = 0; i < REPUTATION_TIERS.length; i++) {
    if (points >= REPUTATION_TIERS[i].minPoints) {
      tierIndex = i;
    }
  }

  const currentTier = REPUTATION_TIERS[tierIndex];
  const nextTier = REPUTATION_TIERS[tierIndex + 1] || null;

  const pointsToNext = nextTier ? Math.max(0, nextTier.minPoints - points) : 0;

  const usefulness = Math.min(100, Math.round((points / 1200) * 100));
  const quality = Math.min(100, Math.round((level / 20) * 100));
  const consistency = Math.min(100, Math.round((streak / 30) * 100));

  return {
    points,
    tierId: currentTier.id,
    tierIndex,
    currentTierMin: currentTier.minPoints,
    nextTierMin: nextTier ? nextTier.minPoints : null,
    pointsToNext,
    usefulness,
    quality,
    consistency,
  };
}

export type StatKey =
  | "discipline"
  | "trading"
  | "intelligence"
  | "focus"
  | "psychology"
  | "knowledge"
  | "endurance"
  | "strength";

export type StatRank = "novice" | "adept" | "skilled" | "expert" | "master";

export interface StatInfo {
  key: StatKey;
  iconName: string;
  categoryKey: string;
  xp: number;
  level: number;
  rank: StatRank;
  currentLevelXp: number;
  nextLevelXp: number;
  weeklyGain: number;
}

export function getStatRank(level: number): StatRank {
  if (level >= 20) return "master";
  if (level >= 15) return "expert";
  if (level >= 10) return "skilled";
  if (level >= 5) return "adept";
  return "novice";
}

export function statXpForNextLevel(level: number): number {
  return 50 + level * 25;
}

export function calculateStats(state: any): Record<StatKey, StatInfo> {
  const history = state.history || [];
  const weeklyCount = state.weeklyQuestCount || 0;
  const streak = state.currentStreak || 0;
  const postsCount = state.posts?.length || 0;
  const equipCount = Object.keys(state.equipment || {}).length;
  const level = state.level || 1;
  const completedToday = Object.keys(state.completedQuestsToday || {}).length;

  const rawXp: Record<StatKey, number> = {
    discipline: 20 + weeklyCount * 15,
    trading: 20 + completedToday * 15 + history.length * 5,
    intelligence: 20 + level * 20,
    focus: 20 + streak * 10,
    psychology: 20 + postsCount * 15,
    knowledge: 20 + level * 15,
    endurance: 20 + (state.isRestDay ? 15 : 5),
    strength: 20 + equipCount * 15,
  };

  const icons: Record<StatKey, string> = {
    discipline: "ShieldCheck",
    trading: "TrendingUp",
    intelligence: "Brain",
    focus: "Target",
    psychology: "Smile",
    knowledge: "BookOpen",
    endurance: "Activity",
    strength: "Zap",
  };

  const categories: Record<StatKey, string> = {
    discipline: "Discipline",
    trading: "Trading",
    intelligence: "Mental",
    focus: "Discipline",
    psychology: "Psychology",
    knowledge: "Mental",
    endurance: "Physical",
    strength: "Physical",
  };

  const weeklyGains: Record<StatKey, number> = {
    discipline: Math.min(25, weeklyCount * 3),
    trading: Math.min(25, completedToday * 4),
    intelligence: Math.min(25, level * 2),
    focus: Math.min(25, streak * 2),
    psychology: Math.min(25, postsCount * 3),
    knowledge: Math.min(25, level * 2),
    endurance: Math.min(25, state.isRestDay ? 5 : 2),
    strength: Math.min(25, equipCount * 3),
  };

  const result = {} as Record<StatKey, StatInfo>;

  (Object.keys(rawXp) as StatKey[]).forEach((key) => {
    let xp = rawXp[key];
    let lvl = 1;
    let req = statXpForNextLevel(lvl);

    while (xp >= req) {
      xp -= req;
      lvl++;
      req = statXpForNextLevel(lvl);
    }

    result[key] = {
      key,
      iconName: icons[key],
      categoryKey: categories[key],
      xp,
      level: lvl,
      rank: getStatRank(lvl),
      currentLevelXp: xp,
      nextLevelXp: req,
      weeklyGain: weeklyGains[key],
    };
  });

  return result;
}

export function getCharacterPower(stats: Record<StatKey, StatInfo>): number {
  return Object.values(stats).reduce((acc, s) => acc + s.level * 10 + s.xp, 0);
}

export function getStatBalance(stats: Record<StatKey, StatInfo>): {
  isBalanced: boolean;
  strongestStat: StatKey;
  weakestStat: StatKey;
  growthCategory: string;
} {
  const entries = Object.entries(stats) as [StatKey, StatInfo][];
  entries.sort((a, b) => b[1].level - a[1].level || b[1].xp - a[1].xp);

  const strongestStat = entries[0][0];
  const weakestStat = entries[entries.length - 1][0];

  const maxLevel = entries[0][1].level;
  const minLevel = entries[entries.length - 1][1].level;

  const isBalanced = maxLevel - minLevel <= 2;
  const growthCategory = entries[entries.length - 1][1].categoryKey;

  return {
    isBalanced,
    strongestStat,
    weakestStat,
    growthCategory,
  };
}

export interface DailyStatRecord {
  questsCompleted: Record<string, number>;
  totalQuestsCompleted: number;
  xpGained: number;
  coinsGained: number;
  questsSkipped: number;
  questsReplaced: number;
  isRestDay: boolean;
  shieldUsed: boolean;
  rewardsClaimed: number;
}

export function recordDailyStatEvent(
  dailyStats: Record<string, DailyStatRecord>,
  dateStr: string,
  event: {
    type: "questDone" | "questSkipped" | "questReplaced" | "restDay" | "shieldUsed" | "rewardClaimed";
    category?: string;
    xp?: number;
    coins?: number;
  }
): Record<string, DailyStatRecord> {
  const existingRecord: DailyStatRecord = dailyStats[dateStr] || {
    questsCompleted: {},
    totalQuestsCompleted: 0,
    xpGained: 0,
    coinsGained: 0,
    questsSkipped: 0,
    questsReplaced: 0,
    isRestDay: false,
    shieldUsed: false,
    rewardsClaimed: 0,
  };

  const updatedRecord = { ...existingRecord };

  if (event.type === "questDone") {
    updatedRecord.totalQuestsCompleted += 1;
    updatedRecord.xpGained += event.xp || 0;
    updatedRecord.coinsGained += event.coins || 0;
    if (event.category) {
      const catCount = updatedRecord.questsCompleted[event.category] || 0;
      updatedRecord.questsCompleted = {
        ...updatedRecord.questsCompleted,
        [event.category]: catCount + 1,
      };
    }
  } else if (event.type === "questSkipped") {
    updatedRecord.questsSkipped += 1;
  } else if (event.type === "questReplaced") {
    updatedRecord.questsReplaced += 1;
  } else if (event.type === "restDay") {
    updatedRecord.isRestDay = true;
  } else if (event.type === "shieldUsed") {
    updatedRecord.shieldUsed = true;
  } else if (event.type === "rewardClaimed") {
    updatedRecord.rewardsClaimed += 1;
    updatedRecord.coinsGained += event.coins || 0;
  }

  const nextStats = { ...dailyStats, [dateStr]: updatedRecord };

  // Keep max 365 days
  const keys = Object.keys(nextStats).sort();
  if (keys.length > 365) {
    const toRemove = keys.slice(0, keys.length - 365);
    toRemove.forEach((k) => delete nextStats[k]);
  }

  return nextStats;
}

export interface ProfileObservations {
  topCategory: string | null;
  growthZone: StatKey;
  streakInsight: string;
  adviceTextKey: string;
}

export function getProfileObservations(
  state: any,
  statsMap: Record<StatKey, StatInfo>
): ProfileObservations {
  const history = state.history || [];
  const categoryCounts: Record<string, number> = {};

  history.forEach((h: any) => {
    if (h.category) {
      categoryCounts[h.category] = (categoryCounts[h.category] || 0) + 1;
    }
  });

  let topCategory: string | null = null;
  let maxCount = 0;
  Object.entries(categoryCounts).forEach(([cat, count]) => {
    if (count > maxCount) {
      maxCount = count;
      topCategory = cat;
    }
  });

  const balance = getStatBalance(statsMap);

  return {
    topCategory,
    growthZone: balance.weakestStat,
    streakInsight: state.currentStreak >= 3 ? "strongStreak" : "buildingStreak",
    adviceTextKey: balance.isBalanced ? "balancedProfile" : "focusGrowthZone",
  };
}

export function exportProfileDataJSON(state: any, exportedAtDate: Date = new Date()): string {
  const todayStr = exportedAtDate.toISOString().split("T")[0];
  const filename = `ayra-profile-${state.name || "TraderOne"}-${todayStr}.json`;

  const payload = {
    app: "ayra",
    exportVersion: "1.0",
    exportedAt: exportedAtDate.toISOString(),
    user: {
      name: state.name,
      bio: state.bio,
      path: state.path,
      level: state.level,
      xp: state.xp,
      coins: state.coins,
      createdAt: state.createdAt || todayStr,
      currentStreak: state.currentStreak,
      bestStreak: state.bestStreak,
      plan: state.plan,
      selectedTitle: state.selectedTitle,
      unlockedTitles: state.unlockedTitles,
      equipment: state.equipment,
      loadouts: state.loadouts,
      activeLoadout: state.activeLoadout,
      achievements: state.achievements,
      dailyStats: state.dailyStats || {},
      history: state.history || [],
      posts: state.posts || [],
      customGoals: state.customGoals || [],
      chronicle: state.chronicle || [],
    },
  };

  return JSON.stringify(payload, null, 2);
}
