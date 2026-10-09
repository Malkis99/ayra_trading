import { GAME_CONFIG } from "./game-config";

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
    discipline: "discipline",
    trading: "trading",
    intelligence: "mental",
    focus: "trading",
    psychology: "psychology",
    knowledge: "mental",
    endurance: "physical",
    strength: "physical",
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

export interface JournalStats {
  totalTrades: number;
  periodTrades: number;
  planCompliancePercent: number;
  averageProcessScore: number;
  periodRResult: number;
  journalStreakDays: number;
  notesCount: number;
  frequentErrors: string[];
  dominantEmotions: string[];
  propAccountsWithRulesCount: number;
  propDisciplineDaysCount: number;
}

export function calculateJournalStats(
  trades: any[] = [],
  periodDays: number = 30,
  referenceDate: Date = new Date()
): JournalStats {
  const totalTrades = trades.length;

  const nowMs = referenceDate.getTime();
  const periodMs = periodDays * 24 * 60 * 60 * 1000;

  const periodTradesList = trades.filter((t) => {
    const tradeTime = new Date(t.openedAt || t.createdAt).getTime();
    return !isNaN(tradeTime) && nowMs - tradeTime <= periodMs;
  });

  const periodTrades = periodTradesList.length;

  const periodRResult = periodTradesList.reduce((acc, t) => {
    return acc + (typeof t.rMultiple === "number" ? t.rMultiple : 0);
  }, 0);

  const notesCount = trades.filter((t) => t.notes && t.notes.trim().length > 0).length;

  // Mistakes count
  const mistakeCounts: Record<string, number> = {};
  trades.forEach((t) => {
    if (Array.isArray(t.mistakes)) {
      t.mistakes.forEach((m: string) => {
        mistakeCounts[m] = (mistakeCounts[m] || 0) + 1;
      });
    }
  });

  const frequentErrors = Object.entries(mistakeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([m]) => m);

  // Emotions count
  const emotionCounts: Record<string, number> = {};
  trades.forEach((t) => {
    if (Array.isArray(t.emotions)) {
      t.emotions.forEach((e: string) => {
        emotionCounts[e] = (emotionCounts[e] || 0) + 1;
      });
    }
  });

  const dominantEmotions = Object.entries(emotionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([e]) => e);

  // Calculate journal streak days (consecutive days ending today or yesterday with trades)
  const tradeDates = new Set<string>();
  trades.forEach((t) => {
    const dateStr = (t.openedAt || t.createdAt).split("T")[0];
    if (dateStr) tradeDates.add(dateStr);
  });

  let journalStreakDays = 0;
  let checkDate = new Date(referenceDate);

  while (true) {
    const y = checkDate.getFullYear();
    const m = String(checkDate.getMonth() + 1).padStart(2, "0");
    const d = String(checkDate.getDate()).padStart(2, "0");
    const ds = `${y}-${m}-${d}`;

    if (tradeDates.has(ds)) {
      journalStreakDays++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      // If today has no trades yet, check yesterday
      if (journalStreakDays === 0) {
        checkDate.setDate(checkDate.getDate() - 1);
        const y2 = checkDate.getFullYear();
        const m2 = String(checkDate.getMonth() + 1).padStart(2, "0");
        const d2 = String(checkDate.getDate()).padStart(2, "0");
        const ds2 = `${y2}-${m2}-${d2}`;
        if (tradeDates.has(ds2)) {
          journalStreakDays++;
          checkDate.setDate(checkDate.getDate() - 1);
          continue;
        }
      }
      break;
    }
  }

  // Execution ratings & Process Score
  const ratedTrades = trades.filter(
    (t) =>
      (typeof t.processScore === "number" && t.processScore >= 0) ||
      (typeof t.executionRating === "number" && t.executionRating > 0)
  );

  let averageProcessScore = 0;
  let planCompliancePercent = 100;

  if (ratedTrades.length > 0) {
    const scores = ratedTrades.map((t) => {
      if (typeof t.processScore === "number") return t.processScore;
      return (t.executionRating || 3) * 20;
    });

    const sumScore = scores.reduce((acc, s) => acc + s, 0);
    averageProcessScore = Number((sumScore / scores.length).toFixed(1));

    const compliantCount = scores.filter(
      (s) => s >= GAME_CONFIG.PROCESS_SCORE.THRESHOLDS.GOOD
    ).length;
    planCompliancePercent = Number(
      ((compliantCount / scores.length) * 100).toFixed(0)
    );
  }

  // Prop stats calculation
  let propAccountsWithRulesCount = 0;
  // If accounts list passed in trades array context or available in state, count them
  // We can count prop accounts with rules if trades/accounts provided

  return {
    totalTrades,
    periodTrades,
    planCompliancePercent,
    averageProcessScore,
    periodRResult: Number(periodRResult.toFixed(2)),
    journalStreakDays,
    notesCount,
    frequentErrors,
    dominantEmotions,
    propAccountsWithRulesCount,
    propDisciplineDaysCount: 0,
  };
}

export function exportProfileDataJSON(
  state: any,
  journalDataOrDate?:
    | {
        accounts: any[];
        trades: any[];
        strategies?: any[];
        noTrades?: any[];
        attachments?: any[];
      }
    | Date,
  exportedAtDate: Date = new Date()
): string {
  let journalData:
    | {
        accounts: any[];
        trades: any[];
        strategies?: any[];
        noTrades?: any[];
        attachments?: any[];
      }
    | undefined;
  let actualDate = exportedAtDate;

  if (journalDataOrDate instanceof Date) {
    actualDate = journalDataOrDate;
  } else if (journalDataOrDate && typeof journalDataOrDate === "object") {
    journalData = journalDataOrDate;
  }

  const todayStr = actualDate.toISOString().split("T")[0];

  const payload = {
    app: "ayra",
    exportVersion: "1.4",
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
    journal: {
      accounts: journalData?.accounts || [],
      trades: journalData?.trades || [],
      strategies: journalData?.strategies || [],
      noTrades: journalData?.noTrades || [],
      attachments: journalData?.attachments || [],
      imagesIncluded: false,
    },
  };

  return JSON.stringify(payload, null, 2);
}
