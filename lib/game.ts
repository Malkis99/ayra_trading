import { GAME_CONFIG } from "./game-config";
import { ITEMS } from "./items";
import { TITLES_CATALOG } from "./titles";
import {
  transliterateNickname,
  isValidLatinNickname,
  recordDailyStatEvent,
  DailyStatRecord,
} from "./stats";
import {
  AvatarAppearance,
  DEFAULT_AVATAR_APPEARANCE,
  validateAvatarAppearance,
} from "./avatar";
import {
  OnboardingState,
  INITIAL_ONBOARDING_STATE,
} from "./awakening";

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

export interface ProfileState {
  appearance: AvatarAppearance;
  minorMode: boolean;
  timezone: string;
}

export interface GameState {
  name: string;
  bio: string | null;
  path: string;
  level: number;
  xp: number;
  coins: number;
  createdAt: string; // ISO YYYY-MM-DD
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
  rewardedScreenshotHashes?: string[];
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
  dailyStats: Record<string, DailyStatRecord>;
  onboarding: OnboardingState;
  profile: ProfileState;
  aiConsent: boolean;
}

export function getIsoDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const INITIAL_GAME_STATE: GameState = {
  name: "TraderOne",
  bio: null,
  path: "Discipline",
  level: 1,
  xp: 0,
  coins: 0,
  createdAt: getIsoDateString(new Date()),
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
  rewardedScreenshotHashes: [],
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
  dailyStats: {},
  onboarding: INITIAL_ONBOARDING_STATE,
  profile: {
    appearance: DEFAULT_AVATAR_APPEARANCE,
    minorMode: false,
    timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC",
  },
  aiConsent: false,
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

  let bio = rawState.bio;
  if (
    bio === "Мой путь — дисциплина и процесс." ||
    bio === "My path is discipline and process" ||
    bio === "My path is discipline and process."
  ) {
    bio = null;
  }

  let name = rawState.name || INITIAL_GAME_STATE.name;
  if (!isValidLatinNickname(name)) {
    name = transliterateNickname(name);
  }

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

  const createdAt = rawState.createdAt || getIsoDateString(new Date());
  const dailyStats =
    rawState.dailyStats && typeof rawState.dailyStats === "object"
      ? rawState.dailyStats
      : {};

  let onboarding: OnboardingState;
  if (!rawState.onboarding) {
    onboarding = {
      status: "legacy",
      step: 1,
      subStep: 0,
      answers: {},
      legacyDismissed: false,
    };
  } else {
    onboarding = {
      status: rawState.onboarding.status || "none",
      step: rawState.onboarding.step || 1,
      subStep: rawState.onboarding.subStep || 0,
      answers: rawState.onboarding.answers || {},
      startedAt: rawState.onboarding.startedAt,
      finishedAt: rawState.onboarding.finishedAt,
      legacyDismissed: !!rawState.onboarding.legacyDismissed,
    };
  }

  const isMinor =
    !!rawState.profile?.minorMode ||
    !!rawState.minorMode ||
    onboarding.answers?.ageRange === "16-17";

  const profile: ProfileState = {
    appearance: validateAvatarAppearance(rawState.profile?.appearance || rawState.appearance),
    minorMode: isMinor,
    timezone:
      rawState.profile?.timezone ||
      rawState.timezone ||
      (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC"),
  };

  const aiConsent = !!rawState.aiConsent;

  return {
    ...INITIAL_GAME_STATE,
    ...rawState,
    name,
    bio,
    createdAt,
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
    dailyStats,
    onboarding,
    profile,
    aiConsent,
  };
}

export function checkAndApplyDateResets(
  state: GameState,
  currentDate: Date
): GameState {
  const todayStr = getIsoDateString(currentDate);
  const mondayStr = getMondayIsoDateString(currentDate);

  let updated = migrateState(state);

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
        updated.dailyStats = recordDailyStatEvent(updated.dailyStats, updated.lastQuestDate, {
          type: "shieldUsed",
        });
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
  } else if (!updated.lastQuestDate) {
    updated.lastQuestDate = todayStr;
  }

  if (updated.lastWeeklyResetDate !== mondayStr) {
    updated.weeklyQuestCount = 0;
    updated.lastWeeklyResetDate = mondayStr;
    updated.streakShieldsAvailable = GAME_CONFIG.STREAK_SHIELDS_PER_WEEK;
    updated.lastShieldResetDate = mondayStr;
  }

  return updated;
}

export function checkAchievements(
  state: GameState,
  allPlans: any[] = [],
  allNotes: any[] = []
): { state: GameState; newlyUnlocked: string[] } {
  const newlyUnlocked: string[] = [];
  let updatedState = { ...state };
  let chronicle = [...updatedState.chronicle];

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

  const hasStreakDay = Object.keys(updatedState.completedQuestsToday).length >= 3;

  if (hasStreakDay && !updatedState.achievements["streakDay"]) {
    updatedState.achievements = { ...updatedState.achievements, streakDay: true };
    chronicle = addChronicleEvent(chronicle, {
      type: "achievementUnlocked",
      achievementId: "streakDay",
    });
    newlyUnlocked.push("streakDay");
  }

  const hasLevel3 = updatedState.level >= 3;

  if (hasLevel3 && !updatedState.achievements["level3"]) {
    updatedState.achievements = { ...updatedState.achievements, level3: true };
    chronicle = addChronicleEvent(chronicle, {
      type: "achievementUnlocked",
      achievementId: "level3",
    });
    newlyUnlocked.push("level3");
  }

  const hasAuthor = updatedState.posts.length >= 1;

  if (hasAuthor && !updatedState.achievements["author"]) {
    updatedState.achievements = { ...updatedState.achievements, author: true };
    chronicle = addChronicleEvent(chronicle, {
      type: "achievementUnlocked",
      achievementId: "author",
    });
    newlyUnlocked.push("author");
  }

  const hasFirstTrade =
    updatedState.history.some((h) => h.questId === "q_tradelog") ||
    updatedState.achievements["firstTrade"];

  if (hasFirstTrade && !updatedState.achievements["firstTrade"]) {
    updatedState.achievements = { ...updatedState.achievements, firstTrade: true };
    chronicle = addChronicleEvent(chronicle, {
      type: "achievementUnlocked",
      achievementId: "firstTrade",
    });
    newlyUnlocked.push("firstTrade");
  }

  if (updatedState.achievements["consciousRefusal"]) {
    newlyUnlocked.push("consciousRefusal");
  }

  // T6c-2a achievements
  const hasFirstPlan = allPlans.length >= 1 || updatedState.achievements["firstPlan"];
  if (hasFirstPlan && !updatedState.achievements["firstPlan"]) {
    updatedState.achievements = { ...updatedState.achievements, firstPlan: true };
    chronicle = addChronicleEvent(chronicle, {
      type: "achievementUnlocked",
      achievementId: "firstPlan",
    });
    newlyUnlocked.push("firstPlan");
  }

  const hasFirstReview =
    allPlans.some((p) => p.review?.completedAt != null) ||
    updatedState.achievements["firstReview"];
  if (hasFirstReview && !updatedState.achievements["firstReview"]) {
    updatedState.achievements = { ...updatedState.achievements, firstReview: true };
    chronicle = addChronicleEvent(chronicle, {
      type: "achievementUnlocked",
      achievementId: "firstReview",
    });
    newlyUnlocked.push("firstReview");
  }

  const hasFirstNote = allNotes.length >= 1 || updatedState.achievements["firstNote"];
  if (hasFirstNote && !updatedState.achievements["firstNote"]) {
    updatedState.achievements = { ...updatedState.achievements, firstNote: true };
    chronicle = addChronicleEvent(chronicle, {
      type: "achievementUnlocked",
      achievementId: "firstNote",
    });
    newlyUnlocked.push("firstNote");
  }

  const hasPlans7 = allPlans.length >= 7 || updatedState.achievements["plans7"];
  if (hasPlans7 && !updatedState.achievements["plans7"]) {
    updatedState.achievements = { ...updatedState.achievements, plans7: true };
    chronicle = addChronicleEvent(chronicle, {
      type: "achievementUnlocked",
      achievementId: "plans7",
    });
    newlyUnlocked.push("plans7");
  }

  const hasFirstScreenshot =
    (updatedState.rewardedScreenshotHashes &&
      updatedState.rewardedScreenshotHashes.length > 0) ||
    updatedState.achievements["firstScreenshot"];
  if (hasFirstScreenshot && !updatedState.achievements["firstScreenshot"]) {
    updatedState.achievements = { ...updatedState.achievements, firstScreenshot: true };
    chronicle = addChronicleEvent(chronicle, {
      type: "achievementUnlocked",
      achievementId: "firstScreenshot",
    });
    newlyUnlocked.push("firstScreenshot");
  }

  updatedState.chronicle = chronicle;
  return { state: updatedState, newlyUnlocked };
}

export interface ScreenshotRewardResult {
  state: GameState;
  xpAwarded: number;
  leveledUp: boolean;
  newLevel?: number;
  newlyUnlocked: string[];
}

export function recordScreenshotAdded(
  state: GameState,
  screenshot: {
    hash: string;
    width: number;
    height: number;
    tradeOpenedAt?: string;
  },
  currentDate: Date = new Date()
): ScreenshotRewardResult {
  let newState = checkAndApplyDateResets(state, currentDate);
  const todayStr = getIsoDateString(currentDate);

  let isPlausible = true;

  // 1. Min dimension check
  const minDim = Math.min(screenshot.width, screenshot.height);
  if (minDim < GAME_CONFIG.SCREENSHOT_MIN_DIMENSION) {
    isPlausible = false;
  }

  // 2. Future date check
  if (screenshot.tradeOpenedAt) {
    const tradeOpenedMs = new Date(screenshot.tradeOpenedAt).getTime();
    if (isNaN(tradeOpenedMs) || tradeOpenedMs > currentDate.getTime() + 24 * 60 * 60 * 1000) {
      isPlausible = false;
    }
  }

  // 3. Duplicate hash check
  const rewardedHashes = newState.rewardedScreenshotHashes || [];
  if (rewardedHashes.includes(screenshot.hash)) {
    isPlausible = false;
  }

  // 4. Daily cap check
  const todayRecord = newState.dailyStats[todayStr];
  const screenshotsTodayCount = todayRecord?.questsCompleted?.["trading_screenshot"] || 0;
  if (screenshotsTodayCount >= GAME_CONFIG.SCREENSHOT_DAILY_XP_CAP) {
    isPlausible = false;
  }

  let xpAwarded = 0;
  let leveledUp = false;
  let newLevel: number | undefined;
  const newlyUnlocked: string[] = [];

  if (isPlausible) {
    xpAwarded = GAME_CONFIG.SCREENSHOT_XP;

    let newXp = newState.xp + xpAwarded;
    let currentLvl = newState.level;
    let chronicle = newState.chronicle;

    while (newXp >= xpForNextLevel(currentLvl)) {
      newXp -= xpForNextLevel(currentLvl);
      currentLvl++;
      leveledUp = true;
      chronicle = addChronicleEvent(chronicle, {
        type: "levelUp",
        level: currentLvl,
      });
    }

    const updatedDailyStats = recordDailyStatEvent(newState.dailyStats, todayStr, {
      type: "questDone",
      category: "trading_screenshot",
      xp: xpAwarded,
      coins: 0,
    });

    const newRewardedHashes = [...rewardedHashes, screenshot.hash];

    newState = {
      ...newState,
      xp: newXp,
      level: currentLvl,
      chronicle,
      dailyStats: updatedDailyStats,
      rewardedScreenshotHashes: newRewardedHashes,
    };

    if (leveledUp) {
      newLevel = currentLvl;
    }
  }

  const evalResult = checkAchievements(newState);
  newState = evalResult.state;
  newlyUnlocked.push(...evalResult.newlyUnlocked);

  return {
    state: newState,
    xpAwarded,
    leveledUp,
    newLevel,
    newlyUnlocked,
  };
}

export function evaluatePlanQuestClosure(
  state: GameState,
  plan: any,
  todayTrades: any[],
  allPlans: any[] = [],
  allNotes: any[] = [],
  currentDate: Date = new Date()
): {
  state: GameState;
  closedQuests: string[];
  xpAwarded: number;
  newlyUnlocked: string[];
} {
  let newState = checkAndApplyDateResets(state, currentDate);
  const todayStr = getIsoDateString(currentDate);

  // Only close quests if plan date is today
  if (plan.date !== todayStr) {
    return { state: newState, closedQuests: [], xpAwarded: 0, newlyUnlocked: [] };
  }

  const closedQuests: string[] = [];
  let xpAwarded = 0;

  // 1. q_daily_bias (or q_bias)
  const hasBiasWithInst =
    Array.isArray(plan.bias) &&
    plan.bias.some((b: any) => b.instrument && b.instrument.trim().length > 0);

  if (hasBiasWithInst && !newState.completedQuestsToday["q_bias"]) {
    const res = completeQuest(
      newState,
      "q_bias",
      "Daily Bias перед сессией",
      "trading",
      QUEST_XP,
      QUEST_COINS,
      currentDate
    );
    newState = res.state;
    closedQuests.push("q_bias");
  }

  // 2. q_risk_limits_check (or q_riskcheck)
  const hasLimitFilled =
    plan.limits?.maxRiskPerTrade?.value != null ||
    plan.limits?.maxDailyLoss?.value != null ||
    plan.limits?.maxTrades != null;

  const isRiskLimitChecked =
    Array.isArray(plan.checklist) &&
    plan.checklist.some(
      (c: any) =>
        (c.key === "risk_limits_checked" || c.text?.toLowerCase().includes("риск")) &&
        c.done
    );

  if (hasLimitFilled && isRiskLimitChecked && !newState.completedQuestsToday["q_riskcheck"]) {
    const res = completeQuest(
      newState,
      "q_riskcheck",
      "Проверка дневного лимита риска",
      "trading",
      QUEST_XP,
      QUEST_COINS,
      currentDate
    );
    newState = res.state;
    closedQuests.push("q_riskcheck");
  }

  // 3. q_reflect (reflection)
  const reviewTextLen =
    (plan.review?.whatWorked || "").length +
    (plan.review?.whatToImprove || "").length +
    (plan.review?.lesson || "").length;

  const isReviewDone = plan.review?.completedAt != null && reviewTextLen >= 40;

  const isSessionNoteDone = allNotes.some((n: any) => {
    const isTodayNote = n.createdAt.startsWith(todayStr);
    const isSessionTemplate = n.templateKey === "session_review";
    return isTodayNote && isSessionTemplate && (n.body || "").length >= 80;
  });

  if ((isReviewDone || isSessionNoteDone) && !newState.completedQuestsToday["q_reflect"]) {
    const res = completeQuest(
      newState,
      "q_reflect",
      "10 минут рефлексии",
      "psychology",
      QUEST_XP,
      QUEST_COINS,
      currentDate
    );
    newState = res.state;
    closedQuests.push("q_reflect");
  }

  // Discipline XP for Plan created before first trade with bias & limits
  const firstTradeOpenedMs =
    todayTrades.length > 0
      ? Math.min(...todayTrades.map((t: any) => new Date(t.openedAt).getTime()))
      : null;

  const planCreatedMs = new Date(plan.createdAt).getTime();
  const isCreatedBeforeFirstTrade =
    firstTradeOpenedMs == null || planCreatedMs <= firstTradeOpenedMs;

  const todayRecord = newState.dailyStats[todayStr];
  const planXpCountToday = todayRecord?.questsCompleted?.["discipline_plan"] || 0;

  if (
    hasBiasWithInst &&
    hasLimitFilled &&
    isCreatedBeforeFirstTrade &&
    planXpCountToday < 1
  ) {
    const planXp = GAME_CONFIG.PLAN_DISCIPLINE_XP;
    xpAwarded += planXp;
    let newXp = newState.xp + planXp;
    let newLevel = newState.level;
    let chronicle = newState.chronicle;

    while (newXp >= xpForNextLevel(newLevel)) {
      newXp -= xpForNextLevel(newLevel);
      newLevel++;
      chronicle = addChronicleEvent(chronicle, { type: "levelUp", level: newLevel });
    }

    const updatedDailyStats = recordDailyStatEvent(newState.dailyStats, todayStr, {
      type: "questDone",
      category: "discipline_plan",
      xp: planXp,
      coins: 0,
    });

    newState = {
      ...newState,
      xp: newXp,
      level: newLevel,
      chronicle,
      dailyStats: updatedDailyStats,
    };
  }

  // Psychology XP for completed review
  const reviewXpCountToday = todayRecord?.questsCompleted?.["psychology_review"] || 0;

  if (plan.review?.completedAt != null && reviewXpCountToday < 1) {
    const reviewXp = GAME_CONFIG.REVIEW_PSYCHOLOGY_XP;
    xpAwarded += reviewXp;
    let newXp = newState.xp + reviewXp;
    let newLevel = newState.level;
    let chronicle = newState.chronicle;

    while (newXp >= xpForNextLevel(newLevel)) {
      newXp -= xpForNextLevel(newLevel);
      newLevel++;
      chronicle = addChronicleEvent(chronicle, { type: "levelUp", level: newLevel });
    }

    const updatedDailyStats = recordDailyStatEvent(newState.dailyStats, todayStr, {
      type: "questDone",
      category: "psychology_review",
      xp: reviewXp,
      coins: 0,
    });

    newState = {
      ...newState,
      xp: newXp,
      level: newLevel,
      chronicle,
      dailyStats: updatedDailyStats,
    };
  }

  const { state: finalState, newlyUnlocked } = checkAchievements(newState, allPlans, allNotes);

  return {
    state: finalState,
    closedQuests,
    xpAwarded,
    newlyUnlocked,
  };
}

export interface NoTradeRewardResult {
  state: GameState;
  xpAwarded: number;
  leveledUp: boolean;
  newLevel?: number;
  newlyUnlocked: string[];
}

export function recordNoTradeEntry(
  state: GameState,
  entry: {
    id: string;
    date: string;
    reason: string;
    instrument?: string | null;
  },
  allNoTrades: any[],
  currentDate: Date = new Date()
): NoTradeRewardResult {
  let newState = checkAndApplyDateResets(state, currentDate);
  const todayStr = getIsoDateString(currentDate);

  let isPlausible = true;

  if (!entry.reason || !entry.reason.trim()) {
    isPlausible = false;
  }

  const entryDateMs = new Date(entry.date).getTime();
  const nowMs = currentDate.getTime();

  if (isNaN(entryDateMs) || entryDateMs > nowMs + 24 * 60 * 60 * 1000) {
    isPlausible = false;
  }

  if (nowMs - entryDateMs > 7 * 24 * 60 * 60 * 1000) {
    isPlausible = false;
  }

  const entryDateStr = entry.date.split("T")[0];
  const isDuplicate = allNoTrades.some((other) => {
    if (other.id === entry.id) return false;
    const otherDateStr = (other.date || "").split("T")[0];
    const sameInstrument = (other.instrument || "").toUpperCase() === (entry.instrument || "").toUpperCase();
    return otherDateStr === entryDateStr && other.reason === entry.reason && sameInstrument;
  });

  if (isDuplicate) {
    isPlausible = false;
  }

  const todayRecord = newState.dailyStats[todayStr];
  const noTradesTodayXpCount = todayRecord?.questsCompleted?.["discipline_no_trade"] || 0;
  if (noTradesTodayXpCount >= GAME_CONFIG.NO_TRADE_DAILY_CAP) {
    isPlausible = false;
  }

  let xpAwarded = 0;
  let leveledUp = false;
  let newLevel: number | undefined;

  if (isPlausible) {
    xpAwarded = GAME_CONFIG.NO_TRADE_XP;
    let newXp = newState.xp + xpAwarded;
    let currentLvl = newState.level;
    let chronicle = newState.chronicle;

    while (newXp >= xpForNextLevel(currentLvl)) {
      newXp -= xpForNextLevel(currentLvl);
      currentLvl++;
      leveledUp = true;
      chronicle = addChronicleEvent(chronicle, {
        type: "levelUp",
        level: currentLvl,
      });
    }

    const updatedDailyStats = recordDailyStatEvent(newState.dailyStats, todayStr, {
      type: "questDone",
      category: "discipline_no_trade",
      xp: xpAwarded,
      coins: 0,
    });

    newState = {
      ...newState,
      xp: newXp,
      level: currentLvl,
      chronicle,
      dailyStats: updatedDailyStats,
    };

    if (leveledUp) {
      newLevel = currentLvl;
    }
  }

  if (!newState.achievements["consciousRefusal"]) {
    newState.achievements = { ...newState.achievements, consciousRefusal: true };
    newState.chronicle = addChronicleEvent(newState.chronicle, {
      type: "achievementUnlocked",
      achievementId: "consciousRefusal",
    });
  }

  const { state: finalState, newlyUnlocked } = checkAchievements(newState);

  return {
    state: finalState,
    xpAwarded,
    leveledUp,
    newLevel,
    newlyUnlocked,
  };
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
  const todayStr = getIsoDateString(currentDate);

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
      completedAt: todayStr,
    },
    ...newState.history,
  ];

  const updatedDailyStats = recordDailyStatEvent(newState.dailyStats, todayStr, {
    type: "questDone",
    category,
    xp: xpAmount,
    coins: coinsAmount,
  });

  newState = {
    ...newState,
    completedQuestsToday: updatedCompletedToday,
    xp: newXp,
    coins: newCoins,
    level: newLevel,
    weeklyQuestCount: newState.weeklyQuestCount + 1,
    chronicle,
    history: newHistory,
    dailyStats: updatedDailyStats,
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
  const todayStr = getIsoDateString(currentDate);
  const updatedDailyStats = recordDailyStatEvent(newState.dailyStats, todayStr, {
    type: "questSkipped",
  });

  return {
    ...newState,
    passedQuestsToday: {
      ...newState.passedQuestsToday,
      [questId]: true,
    },
    dailyStats: updatedDailyStats,
  };
}

export function replaceQuest(
  state: GameState,
  questId: string,
  currentDate: Date = new Date()
): { state: GameState; success: boolean } {
  let newState = checkAndApplyDateResets(state, currentDate);
  const todayStr = getIsoDateString(currentDate);

  if (newState.replacementsUsedToday >= GAME_CONFIG.QUEST_REPLACEMENTS_PER_DAY) {
    return { state: newState, success: false };
  }

  const updatedDailyStats = recordDailyStatEvent(newState.dailyStats, todayStr, {
    type: "questReplaced",
  });

  newState = {
    ...newState,
    replacementsUsedToday: newState.replacementsUsedToday + 1,
    passedQuestsToday: {
      ...newState.passedQuestsToday,
      [questId]: true,
    },
    dailyStats: updatedDailyStats,
  };

  return { state: newState, success: true };
}

export function toggleRestDay(
  state: GameState,
  currentDate: Date = new Date()
): GameState {
  let newState = checkAndApplyDateResets(state, currentDate);
  const todayStr = getIsoDateString(currentDate);
  const nextRestDayState = !newState.isRestDay;

  let updatedDailyStats = newState.dailyStats;
  if (nextRestDayState) {
    updatedDailyStats = recordDailyStatEvent(newState.dailyStats, todayStr, {
      type: "restDay",
    });
  }

  return {
    ...newState,
    isRestDay: nextRestDayState,
    dailyStats: updatedDailyStats,
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

  const updatedDailyStats = recordDailyStatEvent(newState.dailyStats, todayStr, {
    type: "rewardClaimed",
    coins: claimedCoins,
  });

  newState = {
    ...newState,
    coins: newState.coins + claimedCoins,
    dailyRewardIndex: newState.dailyRewardIndex + 1,
    lastRewardClaimDate: todayStr,
    chronicle,
    dailyStats: updatedDailyStats,
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

export function deletePost(state: GameState, postIndex: number): GameState {
  if (postIndex < 0 || postIndex >= state.posts.length) return state;
  const nextPosts = [...state.posts];
  nextPosts.splice(postIndex, 1);
  return {
    ...state,
    posts: nextPosts,
  };
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

export interface NoteRewardResult {
  state: GameState;
  xpAwarded: number;
  leveledUp: boolean;
  newLevel?: number;
  newlyUnlocked: string[];
}

export function recordNoteSaved(
  state: GameState,
  note: any,
  allNotes: any[],
  currentDate: Date = new Date()
): NoteRewardResult {
  let newState = checkAndApplyDateResets(state, currentDate);
  const todayStr = getIsoDateString(currentDate);

  let isPlausible = true;
  const bodyText = (note.body || "").trim();

  if (bodyText.length < 80) {
    isPlausible = false;
  }

  // Duplicate body check
  const isDuplicate = allNotes.some(
    (other) => other.id !== note.id && (other.body || "").trim() === bodyText
  );
  if (isDuplicate) {
    isPlausible = false;
  }

  // Daily cap check (max 1 per day for Knowledge XP)
  const todayRecord = newState.dailyStats[todayStr];
  const notesTodayXpCount = todayRecord?.questsCompleted?.["knowledge_note"] || 0;
  if (notesTodayXpCount >= 1) {
    isPlausible = false;
  }

  let xpAwarded = 0;
  let leveledUp = false;
  let newLevel: number | undefined;

  if (isPlausible) {
    xpAwarded = GAME_CONFIG.NOTE_KNOWLEDGE_XP;
    let newXp = newState.xp + xpAwarded;
    let currentLvl = newState.level;
    let chronicle = newState.chronicle;

    while (newXp >= xpForNextLevel(currentLvl)) {
      newXp -= xpForNextLevel(currentLvl);
      currentLvl++;
      leveledUp = true;
      chronicle = addChronicleEvent(chronicle, {
        type: "levelUp",
        level: currentLvl,
      });
    }

    const updatedDailyStats = recordDailyStatEvent(newState.dailyStats, todayStr, {
      type: "questDone",
      category: "knowledge_note",
      xp: xpAwarded,
      coins: 0,
    });

    newState = {
      ...newState,
      xp: newXp,
      level: currentLvl,
      chronicle,
      dailyStats: updatedDailyStats,
    };

    if (leveledUp) {
      newLevel = currentLvl;
    }
  }

  // Session Review template note body >= 80 chars auto-closes q_reflect
  if (
    note.templateKey === "session_review" &&
    bodyText.length >= 80 &&
    !newState.completedQuestsToday["q_reflect"]
  ) {
    const res = completeQuest(
      newState,
      "q_reflect",
      "10 минут рефлексии",
      "psychology",
      QUEST_XP,
      QUEST_COINS,
      currentDate
    );
    newState = res.state;
  }

  // First note achievement
  if (!newState.achievements["firstNote"]) {
    newState.achievements = { ...newState.achievements, firstNote: true };
    newState.chronicle = addChronicleEvent(newState.chronicle, {
      type: "achievementUnlocked",
      achievementId: "firstNote",
    });
  }

  const { state: finalState, newlyUnlocked } = checkAchievements(
    newState,
    [],
    [...allNotes, note]
  );

  return {
    state: finalState,
    xpAwarded,
    leveledUp,
    newLevel,
    newlyUnlocked,
  };
}

export interface TradeRewardResult {
  state: GameState;
  xpAwarded: number;
  questClosed: boolean;
  leveledUp: boolean;
  newLevel?: number;
  newlyUnlocked: string[];
}

export function recordLoggedTrade(
  state: GameState,
  trade: {
    id: string;
    accountId: string;
    instrument: string;
    direction: string;
    openedAt: string;
    verification: string;
  },
  allTrades: any[],
  currentDate: Date = new Date()
): TradeRewardResult {
  let newState = checkAndApplyDateResets(state, currentDate);
  const todayStr = getIsoDateString(currentDate);

  // 1. Anti-farm validation
  let isPlausible = true;

  const tradeOpenedMs = new Date(trade.openedAt).getTime();
  if (isNaN(tradeOpenedMs) || tradeOpenedMs > currentDate.getTime() + 24 * 60 * 60 * 1000) {
    isPlausible = false;
  }

  const isDuplicate = allTrades.some(
    (other) =>
      other.id !== trade.id &&
      other.accountId === trade.accountId &&
      other.instrument === trade.instrument &&
      other.direction === trade.direction &&
      Math.abs(new Date(other.openedAt).getTime() - tradeOpenedMs) < 60 * 1000
  );
  if (isDuplicate) {
    isPlausible = false;
  }

  const todayRecord = newState.dailyStats[todayStr];
  const tradesTodayXpCount = todayRecord?.questsCompleted?.["trading_trade"] || 0;
  if (tradesTodayXpCount >= GAME_CONFIG.MAX_DAILY_TRADE_XP_COUNT) {
    isPlausible = false;
  }

  let xpAwarded = 0;
  let leveledUp = false;
  let newLevel: number | undefined;

  if (isPlausible) {
    const multiplier =
      GAME_CONFIG.VERIFICATION_XP_MULTIPLIER[trade.verification] || 1.0;
    xpAwarded = Math.round(GAME_CONFIG.TRADE_BASE_XP * multiplier);

    let newXp = newState.xp + xpAwarded;
    let currentLvl = newState.level;

    let chronicle = newState.chronicle;

    while (newXp >= xpForNextLevel(currentLvl)) {
      newXp -= xpForNextLevel(currentLvl);
      currentLvl++;
      leveledUp = true;
      chronicle = addChronicleEvent(chronicle, {
        type: "levelUp",
        level: currentLvl,
      });
    }

    const updatedDailyStats = recordDailyStatEvent(newState.dailyStats, todayStr, {
      type: "questDone",
      category: "trading_trade",
      xp: xpAwarded,
      coins: 0,
    });

    newState = {
      ...newState,
      xp: newXp,
      level: currentLvl,
      chronicle,
      dailyStats: updatedDailyStats,
    };

    if (leveledUp) {
      newLevel = currentLvl;
    }
  }

  // 2. Auto-close q_tradelog quest idempotently
  let questClosed = false;
  let questUnlocked: string[] = [];

  if (!newState.completedQuestsToday["q_tradelog"]) {
    const questRes = completeQuest(
      newState,
      "q_tradelog",
      "Запись сделки в журнал",
      "trading",
      QUEST_XP,
      QUEST_COINS,
      currentDate
    );
    newState = questRes.state;
    questClosed = true;
    if (questRes.leveledUp) {
      leveledUp = true;
      newLevel = questRes.newLevel;
    }
    questUnlocked = questRes.newlyUnlocked;
  }

  // 3. First trade achievement
  if (!newState.achievements["firstTrade"]) {
    newState.achievements = { ...newState.achievements, firstTrade: true };
    newState.chronicle = addChronicleEvent(newState.chronicle, {
      type: "achievementUnlocked",
      achievementId: "firstTrade",
    });
    questUnlocked.push("firstTrade");
  }

  const { state: finalState, newlyUnlocked: achUnlocked } = checkAchievements(newState);

  const allNewlyUnlocked = Array.from(
    new Set([...questUnlocked, ...achUnlocked])
  );

  return {
    state: finalState,
    xpAwarded,
    questClosed,
    leveledUp,
    newLevel,
    newlyUnlocked: allNewlyUnlocked,
  };
}
