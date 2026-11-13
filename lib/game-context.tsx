"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import {
  GameState,
  INITIAL_GAME_STATE,
  checkAndApplyDateResets,
  completeSelfReportQuest,
  claimDailyReward as claimDailyRewardLogic,
  changePlan as changePlanLogic,
  getCharacterStatus,
  gameDayKey,
  passQuest as passQuestLogic,
  replaceQuest as replaceQuestLogic,
  toggleRestDay as toggleRestDayLogic,
  addCustomGoal as addCustomGoalLogic,
  removeCustomGoal as removeCustomGoalLogic,
  equipItem as equipItemLogic,
  unequipSlot as unequipSlotLogic,
  applyLoadout as applyLoadoutLogic,
  saveLoadout as saveLoadoutLogic,
  addPost as addPostLogic,
  deletePost as deletePostLogic,
  updateProfileInfo as updateProfileInfoLogic,
  recordLoggedTrade,
  recordNoTradeEntry,
  evaluatePlanQuestClosure,
  recordNoteSaved as recordNoteSavedLogic,
  recordScreenshotAdded,
  setDayMode as setDayModeLogic,
  setTradingDays as setTradingDaysLogic,
  setWeekChallenge as setWeekChallengeLogic,
  recordWeekBossResult as recordWeekBossResultLogic,
  type DayModeFailure,
  grantFirstAction as grantFirstActionLogic,
  type FirstActionKind,
  type ReplaceQuestFailure,
} from "@/lib/game";
import { APP_CLOSED_QUESTS } from "@/lib/quests";
import { ITEMS, FRAMES, TITLES, BACKGROUNDS } from "@/lib/items";
import { AvatarAppearance, validateAvatarAppearance } from "@/lib/avatar";
import type { ProfileDetails } from "@/lib/profile";
import { generateProgram } from "@/lib/awakening";
import { AppStorage } from "@/lib/storage";
import { spaceTabChannel } from "@/lib/auth/space-channel";
import { dayKeyInZone } from "@/lib/day-key";
import { GameStore, browserLock, revOf, type Change } from "@/lib/game-store";
import { deviceRewardService, type RewardService } from "@/lib/reward-service";
import type { DayMode, WeekChallenge } from "@/lib/quest-engine";
import type { WeekSnapshot } from "@/lib/day-snapshots";
import { browserCommitLog } from "@/lib/storage/game-rev-counter";

const STORAGE_KEY = "ayra_demo_v1";
/** One copy of the game state as it was before the Quests 2.0 (Q1) version first ran on this device; never overwritten. */
export const GAME_BACKUP_KEY = "ayra_demo_v1_backup_q1";
/** How often an open tab checks whether a new game day has begun (midnight in the account's time zone). */
const DAY_CHECK_MS = 60 * 1000;

/** Saved JSON → state of today (migrations and the day change applied). */
function parseSaved(raw: string): GameState {
  return checkAndApplyDateResets(JSON.parse(raw), new Date());
}

function makeStore(spaceId: string): GameStore<GameState> {
  return new GameStore<GameState>({
    read: () => (AppStorage.getActiveSpaceId() === spaceId ? AppStorage.getItem(STORAGE_KEY) : null),
    // AppStorage swallows a failed write (quota, storage off) and only logs it: the value is read back, and the write
    // counts only if it is really there
    write: (raw) => {
      try {
        if (!AppStorage.guardedSetItem(STORAGE_KEY, raw, spaceId)) return false;
        return AppStorage.getActiveSpaceId() === spaceId && AppStorage.getItem(STORAGE_KEY) === raw;
      } catch {
        return false;
      }
    },
    parse: parseSaved,
    lock: browserLock(`ayra-game:${spaceId}`),
    commits: browserCommitLog(spaceId),
  });
}

interface GameContextType {
  gameState: GameState;
  /** Kept for old callers: the change is applied to the freshest saved state, like every other change. */
  setGameState: React.Dispatch<React.SetStateAction<GameState>>;
  isLoaded: boolean;
  /** The game day (account time zone): the same «today» for Quests, Home and Profile. */
  gameDay: string;
  previewItem: number | null;
  setPreviewItem: (itemId: number | null) => void;
  wardrobeFilter: string;
  setWardrobeFilter: (slot: string) => void;
  effectiveEquipment: Record<string, number>;
  completeQuest: (
    questId: string,
    title: string,
    category: string,
    xp?: number,
    coins?: number
  ) => QuestCompletion;
  /** The one adapter the Quests UI uses for rewards (lib/reward-service.ts); the server economy (Q4) replaces it. */
  rewards: RewardService;
  /** The day mode (Q2): free until the first reward of the day, then only «Rest» and back. */
  setDayMode: (mode: DayMode) => Promise<{ ok: boolean; reason?: DayModeFailure | "notSaved" }>;
  /** Trading days, 0 = Monday … 6 = Sunday; applies from the next generated day. */
  setTradingDays: (days: number[]) => boolean;
  /** Saves the week challenge once per week. */
  fixWeekChallenge: (challenge: WeekChallenge) => void;
  /** Writes a closed week challenge result once into its week snapshot (QH-3; no reward). */
  recordWeekBossResult: (week: string, result: NonNullable<WeekSnapshot["bossResult"]>) => void;
  /** The same as completeQuest, under the lock shared by all tabs (the Quests page). */
  completeQuestSafe: (questId: string, title: string, category: string, xp?: number) => Promise<QuestCompletion>;
  /** One-time reward for the first action of a kind on this account (coins and XP given; 0 if already given). */
  grantFirstAction: (kind: FirstActionKind) => { coins: number; xp: number };
  passQuest: (questId: string) => void;
  replaceQuest: (questId: string, shownQuestIds: string[]) => Promise<{ success: boolean; replacementId?: string; reason?: ReplaceQuestFailure | "notSaved" }>;
  toggleRestDay: () => void;
  claimDailyReward: () => number;
  setPlan: (plan: "Free" | "Pro" | "Elite") => void;
  updateProfile: (name: string, bio: string) => void;
  selectTitle: (titleId: string) => void;
  equipItem: (itemId: number) => string[];
  unequipSlot: (slot: string) => string[];
  applyLoadout: (loadoutName: string) => string[];
  saveLoadout: (loadoutName: string) => void;
  addPost: (content: string) => string[];
  deletePost: (postIndex: number) => void;
  recordTrade: (
    trade: any,
    allTrades: any[]
  ) => { xpAwarded: number; questClosed: boolean; leveledUp: boolean; newLevel?: number; newlyUnlocked: string[] };
  recordNoTrade: (
    entry: any,
    allNoTrades: any[]
  ) => { xpAwarded: number; leveledUp: boolean; newLevel?: number; newlyUnlocked: string[] };
  recordNoteSaved: (
    note: any,
    allNotes: any[]
  ) => { xpAwarded: number; leveledUp: boolean; newLevel?: number; newlyUnlocked: string[] };
  /** XP for a screenshot of a trade (same rules and limits as before), under the lock shared by all tabs. */
  recordScreenshot: (screenshot: { hash: string; width: number; height: number; tradeOpenedAt?: string }) => Promise<{
    xpAwarded: number;
    leveledUp: boolean;
    newLevel?: number;
    newlyUnlocked: string[];
  }>;
  checkAndClosePlanQuests: (
    plan: any,
    todayTrades: any[],
    allPlans?: any[],
    allNotes?: any[]
  ) => { closedQuests: string[]; xpAwarded: number; newlyUnlocked: string[] };
  setFrame: (frame: number) => void;
  setTitle: (title: number) => void;
  setBackground: (bg: number) => void;
  cycleFrame: () => void;
  cycleBackground: () => void;
  cycleTitle: () => void;
  /** false when the title is empty or too long, or 5 goals already exist. */
  addCustomGoal: (title: string, category: string) => boolean;
  removeCustomGoal: (goalId: string) => void;
  characterStatus: "Training" | "Resting";

  // Onboarding & Settings extensions
  saveOnboardingAnswer: (key: string, value: any) => void;
  setOnboardingStep: (step: number, subStep: number) => void;
  completeOnboarding: () => void;
  dismissLegacyBanner: () => void;
  setAiConsent: (consent: boolean) => void;
  updateAvatarAppearance: (appearance: AvatarAppearance) => void;
  updateMinorMode: (minorMode: boolean) => void;
  updateTimezone: (timezone: string) => void;
  /** Saves the edit-profile form: nickname (already accepted by the server for accounts), bio and optional details. */
  saveProfileEdits: (edits: { name: string; bio: string; details: ProfileDetails }) => void;
  /** Accounts: the cloud nickname is the source of truth; copies it into the local state without a chronicle entry. */
  syncCloudNickname: (nickname: string) => void;
}

export interface QuestCompletion {
  completed: boolean;
  /** The change could not be saved: nothing was given (try again). */
  saveFailed?: boolean;
  /** Less XP than the quest's own value: the daily cap on self-report XP was reached. */
  capped?: boolean;
  xp: number;
  leveledUp: boolean;
  newLevel?: number;
  newlyUnlocked: string[];
}

const NOT_COMPLETED: QuestCompletion = { completed: false, xp: 0, leveledUp: false, newlyUnlocked: [] };
const SAVE_FAILED: QuestCompletion = { ...NOT_COMPLETED, saveFailed: true };

const GameContext = createContext<GameContextType | undefined>(undefined);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [gameState, setGameStateRaw] = useState<GameState>(INITIAL_GAME_STATE);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [previewItem, setPreviewItem] = useState<number | null>(null);
  const [wardrobeFilter, setWardrobeFilter] = useState<string>("all");
  const [now, setNow] = useState<Date>(() => new Date());

  // This tab's copy, always the latest one it knows (updated together with the React state)
  const gameStateRef = React.useRef(gameState);
  const isLoadedRef = React.useRef(isLoaded);
  useEffect(() => {
    isLoadedRef.current = isLoaded;
  }, [isLoaded]);

  // Space the in-memory state was loaded from. State is never written into any other space.
  const loadedSpaceRef = React.useRef<string | null>(null);
  const storeRef = React.useRef<GameStore<GameState> | null>(null);

  const showState = useCallback((next: GameState) => {
    if (next === gameStateRef.current) return;
    gameStateRef.current = next;
    setGameStateRaw(next);
  }, []);

  /**
   * Every change: on the freshest saved state, written at once (lib/game-store.ts). When it could not be saved (no
   * storage, refused, no room, another space, a late copy from another tab), `failed` is returned: nothing is reported
   * as given and the screen keeps the saved state.
   */
  const applySync = useCallback(
    <R,>(fn: (fresh: GameState) => Change<GameState, R>, failed: R): R => {
      const store = storeRef.current;
      if (!store) return failed; // not loaded yet: nothing is saved, nothing is given
      const out = store.applySync(gameStateRef.current, fn);
      showState(out.state);
      return out.saved ? out.result : failed;
    },
    [showState]
  );

  /** Changes that give rewards from the Quests page and screenshots: also under the lock shared by all tabs. */
  const applyLocked = useCallback(
    async <R,>(fn: (fresh: GameState) => Change<GameState, R>, failed: R): Promise<R> => {
      const store = storeRef.current;
      if (!store) return failed;
      const out = await store.applyLocked(() => gameStateRef.current, fn);
      showState(out.state);
      return out.saved ? out.result : failed;
    },
    [showState]
  );

  /** A change without a reward; returns false when it could not be saved. */
  const update = useCallback(
    (fn: (fresh: GameState) => GameState): boolean => applySync((s) => ({ state: fn(s), result: true }), false),
    [applySync]
  );

  const setGameState = useCallback<React.Dispatch<React.SetStateAction<GameState>>>(
    (value) => {
      update((s) => (typeof value === "function" ? (value as (p: GameState) => GameState)(s) : value));
    },
    [update]
  );

  const reloadGameState = useCallback(() => {
    try {
      const spaceId = AppStorage.getActiveSpaceId();
      loadedSpaceRef.current = spaceId;
      storeRef.current = makeStore(spaceId);
      const saved = AppStorage.getItem(STORAGE_KEY);
      storeRef.current.noteLoaded(saved);
      // one untouched copy of the progress from before this version (removed with the space data like any other key)
      if (saved && !AppStorage.getItem(GAME_BACKUP_KEY)) {
        try {
          AppStorage.guardedSetItem(GAME_BACKUP_KEY, saved, spaceId);
        } catch {
          // no room: the progress itself is not touched
        }
      }
      const loaded = saved ? parseSaved(saved) : checkAndApplyDateResets(INITIAL_GAME_STATE, new Date());
      // keep the migrated state saved, as before (through the store: the freshest copy wins)
      // (if it cannot be written now, the loaded state is shown as it is: nothing is lost, nothing is added)
      const next = storeRef.current.applySync(loaded, (fresh) => ({ state: fresh === loaded ? { ...loaded } : fresh, result: null })).state;
      gameStateRef.current = next;
      setGameStateRaw(next);
    } catch {
      gameStateRef.current = INITIAL_GAME_STATE;
      setGameStateRaw(INITIAL_GAME_STATE);
    } finally {
      setPreviewItem(null);
      setWardrobeFilter("all");
      setIsLoaded(true);
    }
  }, []);

  // Before switching space: write this tab's copy only if it is newer than the saved one
  useEffect(() => {
    const unregister = AppStorage.registerFlushHandler((targetSpaceId) => {
      if (targetSpaceId !== loadedSpaceRef.current || !isLoadedRef.current) return;
      try {
        const raw = AppStorage.getItem(STORAGE_KEY);
        const savedRev = raw ? revOf(JSON.parse(raw)) : -1;
        // only when this tab's copy is strictly newer (a failed write is retried); an equal rev may be another
        // writer's newer content (for example the onboarding page) and is never overwritten
        if (revOf(gameStateRef.current) > savedRev) {
          AppStorage.guardedSetItem(STORAGE_KEY, JSON.stringify(gameStateRef.current), targetSpaceId);
        }
      } catch {
        // ignore storage errors
      }
    });
    return unregister;
  }, []);

  // Load from AppStorage on client mount with fallback timer
  useEffect(() => {
    reloadGameState();
    const timer = setTimeout(() => {
      setIsLoaded(true);
    }, 1500);
    return () => clearTimeout(timer);
  }, [reloadGameState]);

  // Subscribe to cross-tab/local space changes
  useEffect(() => {
    const unsubscribe = spaceTabChannel.subscribe(() => {
      reloadGameState();
    });
    return () => unsubscribe();
  }, [reloadGameState]);

  // Another tab saved the game: take its copy when it is newer (nothing is written back)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !e.key.endsWith(STORAGE_KEY) || e.newValue == null) return;
      if (AppStorage.getActiveSpaceId() !== loadedSpaceRef.current) return;
      const raw = AppStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      try {
        const saved = parseSaved(raw);
        if (revOf(saved) > revOf(gameStateRef.current)) {
          storeRef.current?.noteLoaded(raw, saved);
          showState(saved);
        }
      } catch {
        // ignore a broken value: the next change reads the store again
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [showState]);

  // Midnight in the account's time zone while the tab is open: start the new game day once
  useEffect(() => {
    if (!isLoaded) return;
    const check = () => {
      const t = new Date();
      const s = gameStateRef.current;
      if (s.lastQuestDate && dayKeyInZone(t, s.profile?.timezone) > s.lastQuestDate) {
        update((fresh) => checkAndApplyDateResets(fresh, t));
        setNow(t); // re-render only when the day changes
      }
    };
    const timer = setInterval(check, DAY_CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [isLoaded, update]);

  const saveOnboardingAnswer = useCallback((key: string, value: any) => {
    update((prev) => {
      const newAnswers = { ...prev.onboarding.answers, [key]: value };
      const currentStatus = prev.onboarding.status;
      const newStatus =
        currentStatus === "done" || currentStatus === "legacy"
          ? currentStatus
          : "inProgress";

      let newName = prev.name;
      if (key === "nickname" && typeof value === "string" && value.trim()) {
        newName = value.trim();
      }

      let newAppearance = prev.profile.appearance;
      if (key === "appearance" && typeof value === "object") {
        newAppearance = validateAvatarAppearance(value);
      }

      let newMinorMode = prev.profile.minorMode;
      if (key === "ageRange") {
        newMinorMode = value === "16-17";
      }

      // The onboarding answer is the profile time zone (IANA id)
      const newTimezone = key === "timezone" && typeof value === "string" && value ? value : prev.profile.timezone;

      const newStartedAt =
        prev.onboarding.startedAt || new Date().toISOString();

      return {
        ...prev,
        name: newName,
        profile: {
          ...prev.profile,
          appearance: newAppearance,
          minorMode: newMinorMode,
          timezone: newTimezone,
        },
        onboarding: {
          ...prev.onboarding,
          status: newStatus,
          answers: newAnswers,
          startedAt: newStartedAt,
        },
      };
    });
  }, [update]);

  const setOnboardingStep = useCallback((step: number, subStep: number) => {
    update((prev) => ({
      ...prev,
      onboarding: {
        ...prev.onboarding,
        step,
        subStep,
        status:
          prev.onboarding.status === "done" || prev.onboarding.status === "legacy"
            ? prev.onboarding.status
            : "inProgress",
        startedAt: prev.onboarding.startedAt || new Date().toISOString(),
      },
    }));
  }, [update]);

  const completeOnboarding = useCallback(() => {
    update((prev) => {
      generateProgram(prev.onboarding.answers);
      return {
        ...prev,
        onboarding: {
          ...prev.onboarding,
          status: "done",
          step: 5,
          subStep: 0,
          finishedAt: prev.onboarding.finishedAt || new Date().toISOString(),
        },
      };
    });
  }, [update]);

  const dismissLegacyBanner = useCallback(() => {
    update((prev) => ({
      ...prev,
      onboarding: {
        ...prev.onboarding,
        legacyDismissed: true,
      },
    }));
  }, [update]);

  const setAiConsent = useCallback((aiConsent: boolean) => {
    update((prev) => ({
      ...prev,
      aiConsent,
    }));
  }, [update]);

  const updateAvatarAppearance = useCallback((appearance: AvatarAppearance) => {
    const valid = validateAvatarAppearance(appearance);
    update((prev) => ({
      ...prev,
      profile: {
        ...prev.profile,
        appearance: valid,
      },
      onboarding: {
        ...prev.onboarding,
        answers: {
          ...prev.onboarding.answers,
          appearance: valid,
        },
      },
    }));
  }, [update]);

  const updateMinorMode = useCallback((minorMode: boolean) => {
    update((prev) => ({
      ...prev,
      profile: {
        ...prev.profile,
        minorMode,
      },
    }));
  }, [update]);

  const saveProfileEdits = useCallback((edits: { name: string; bio: string; details: ProfileDetails }) => {
    update((prev) => ({ ...updateProfileInfoLogic(prev, edits.name, edits.bio), profileDetails: edits.details }));
  }, [update]);

  const syncCloudNickname = useCallback((nickname: string) => {
    update((prev) => (prev.name === nickname || !nickname ? prev : { ...prev, name: nickname }));
  }, [update]);

  // A new zone never moves the game day back and never takes earned rewards (docs/quests-2.0-plan.md, 4.2)
  const updateTimezone = useCallback((timezone: string) => {
    update((prev) => (prev.profile.timezone === timezone ? prev : checkAndApplyDateResets({ ...prev, profile: { ...prev.profile, timezone } }, new Date())));
  }, [update]);

  // A quest ticked by the person (Quests, Home). Quests the app checks itself close only by themselves; a
  // self-reported quest gives XP, never coins (owner decision 2026-10-27).
  const questChange = useCallback(
    (questId: string, title: string, category: string, xp?: number) =>
      (fresh: GameState): Change<GameState, QuestCompletion> => {
        // the daily cap on self-report XP is applied here, in the game rules (lib/game.ts), on fresh data
        const res = completeSelfReportQuest(fresh, questId, title, category, xp ?? 0, new Date());
        const completed = res.state.completedQuestsToday[questId] === true && !fresh.completedQuestsToday[questId];
        if (!completed) return { state: fresh, result: NOT_COMPLETED };
        return {
          state: res.state,
          result: { completed, xp: res.xpGiven, capped: res.capped, leveledUp: res.leveledUp, newLevel: res.newLevel, newlyUnlocked: res.newlyUnlocked },
        };
      },
    []
  );

  const completeQuest = useCallback(
    (questId: string, title: string, category: string, xp?: number, _coins?: number): QuestCompletion => {
      if (APP_CLOSED_QUESTS.has(questId)) return NOT_COMPLETED;
      return applySync(questChange(questId, title, category, xp), SAVE_FAILED);
    },
    [applySync, questChange]
  );

  const completeQuestSafe = useCallback(
    async (questId: string, title: string, category: string, xp?: number): Promise<QuestCompletion> => {
      if (APP_CLOSED_QUESTS.has(questId)) return NOT_COMPLETED;
      return applyLocked(questChange(questId, title, category, xp), SAVE_FAILED);
    },
    [applyLocked, questChange]
  );

  const rewards = useMemo(() => deviceRewardService(completeQuestSafe), [completeQuestSafe]);

  // A mode change reads the day's rewards on fresh data under the shared lock: another tab's reward cannot slip past it
  const setDayMode = useCallback(
    (mode: DayMode) =>
      applyLocked(
        (s) => {
          const res = setDayModeLogic(s, mode, new Date());
          return { state: res.ok ? res.state : s, result: { ok: res.ok, reason: res.reason as DayModeFailure | "notSaved" | undefined } };
        },
        { ok: false, reason: "notSaved" as const }
      ),
    [applyLocked]
  );

  const setTradingDays = useCallback((days: number[]) => update((prev) => setTradingDaysLogic(prev, days)), [update]);

  const fixWeekChallenge = useCallback(
    (challenge: WeekChallenge) => {
      if (gameStateRef.current.questWeek?.week === challenge.week) return;
      update((prev) => setWeekChallengeLogic(prev, challenge));
    },
    [update]
  );

  const recordWeekBossResult = useCallback(
    (week: string, result: NonNullable<WeekSnapshot["bossResult"]>) => {
      const w = gameStateRef.current.questWeeks?.find((x) => x.week === week);
      if (!w || w.bossResult || !w.boss) return;
      update((prev) => recordWeekBossResultLogic(prev, week, result));
    },
    [update]
  );

  // One-time reward for the first action of a kind on this account (the journal decides it is the first)
  const grantFirstAction = useCallback((kind: FirstActionKind) => {
    return applySync((s) => {
      const res = grantFirstActionLogic(s, kind, new Date());
      return { state: res.state, result: { coins: res.coins, xp: res.xp } };
    }, { coins: 0, xp: 0 });
  }, [applySync]);

  const passQuest = useCallback((questId: string) => {
    update((prev) => passQuestLogic(prev, questId, new Date()));
  }, [update]);

  const replaceQuest = useCallback(
    (questId: string, shownQuestIds: string[]) =>
      applyLocked((s) => {
        const res = replaceQuestLogic(s, questId, shownQuestIds, new Date());
        return { state: res.success ? res.state : s, result: { success: res.success, replacementId: res.replacementId, reason: res.reason as ReplaceQuestFailure | "notSaved" | undefined } };
      }, { success: false, replacementId: undefined, reason: "notSaved" as const }),
    [applyLocked]
  );

  const toggleRestDay = useCallback(() => {
    update((prev) => toggleRestDayLogic(prev, new Date()));
  }, [update]);

  const claimDailyReward = useCallback(() => {
    return applySync((s) => {
      const res = claimDailyRewardLogic(s, new Date());
      return { state: res.state, result: res.claimedCoins };
    }, 0);
  }, [applySync]);

  const setPlan = useCallback((plan: "Free" | "Pro" | "Elite") => {
    update((prev) => changePlanLogic(prev, plan));
  }, [update]);

  const updateProfile = useCallback((name: string, bio: string) => {
    update((prev) => updateProfileInfoLogic(prev, name, bio));
  }, [update]);

  const selectTitle = useCallback((titleId: string) => {
    update((prev) => {
      if (!prev.unlockedTitles.includes(titleId)) return prev;
      return { ...prev, selectedTitle: titleId };
    });
  }, [update]);

  const equipItem = useCallback((itemId: number) => {
    const newlyUnlocked = applySync((s) => {
      const res = equipItemLogic(s, itemId);
      return { state: res.state, result: res.newlyUnlocked };
    }, [] as string[]);
    setPreviewItem(null);
    return newlyUnlocked;
  }, [applySync]);

  const unequipSlot = useCallback((slot: string) => {
    const newlyUnlocked = applySync((s) => {
      const res = unequipSlotLogic(s, slot);
      return { state: res.state, result: res.newlyUnlocked };
    }, [] as string[]);
    setPreviewItem(null);
    return newlyUnlocked;
  }, [applySync]);

  const applyLoadout = useCallback((loadoutName: string) => {
    const newlyUnlocked = applySync((s) => {
      const res = applyLoadoutLogic(s, loadoutName);
      return { state: res.state, result: res.newlyUnlocked };
    }, [] as string[]);
    setPreviewItem(null);
    return newlyUnlocked;
  }, [applySync]);

  const saveLoadout = useCallback((loadoutName: string) => {
    update((prev) => saveLoadoutLogic(prev, loadoutName));
  }, [update]);

  const addPost = useCallback((content: string) => {
    return applySync((s) => {
      const res = addPostLogic(s, content);
      return { state: res.state, result: res.newlyUnlocked };
    }, [] as string[]);
  }, [applySync]);

  const deletePost = useCallback((postIndex: number) => {
    update((prev) => deletePostLogic(prev, postIndex));
  }, [update]);

  const recordTrade = useCallback((trade: any, allTrades: any[]) => {
    return applySync((s) => {
      const res = recordLoggedTrade(s, trade, allTrades, new Date());
      return {
        state: res.state,
        result: { xpAwarded: res.xpAwarded, questClosed: res.questClosed, leveledUp: res.leveledUp, newLevel: res.newLevel, newlyUnlocked: res.newlyUnlocked },
      };
    }, { ...{ xpAwarded: 0, leveledUp: false, newLevel: undefined as number | undefined, newlyUnlocked: [] as string[] }, questClosed: false });
  }, [applySync]);

  const recordNoteSaved = useCallback((note: any, allNotes: any[]) => {
    return applySync((s) => {
      const res = recordNoteSavedLogic(s, note, allNotes, new Date());
      return { state: res.state, result: { xpAwarded: res.xpAwarded, leveledUp: res.leveledUp, newLevel: res.newLevel, newlyUnlocked: res.newlyUnlocked } };
    }, { xpAwarded: 0, leveledUp: false, newLevel: undefined as number | undefined, newlyUnlocked: [] as string[] });
  }, [applySync]);

  const recordScreenshot = useCallback(
    (screenshot: { hash: string; width: number; height: number; tradeOpenedAt?: string }) =>
      applyLocked((s) => {
        const res = recordScreenshotAdded(s, screenshot, new Date());
        return { state: res.state, result: { xpAwarded: res.xpAwarded, leveledUp: res.leveledUp, newLevel: res.newLevel, newlyUnlocked: res.newlyUnlocked } };
      }, { xpAwarded: 0, leveledUp: false, newLevel: undefined as number | undefined, newlyUnlocked: [] as string[] }),
    [applyLocked]
  );

  const checkAndClosePlanQuests = useCallback(
    (plan: any, todayTrades: any[], allPlans: any[] = [], allNotes: any[] = []) => {
      return applySync((s) => {
        const res = evaluatePlanQuestClosure(s, plan, todayTrades, allPlans, allNotes, new Date());
        return { state: res.state, result: { closedQuests: res.closedQuests, xpAwarded: res.xpAwarded, newlyUnlocked: res.newlyUnlocked } };
      }, { closedQuests: [] as string[], xpAwarded: 0, newlyUnlocked: [] as string[] });
    },
    [applySync]
  );

  const recordNoTrade = useCallback((entry: any, allNoTrades: any[]) => {
    return applySync((s) => {
      const res = recordNoTradeEntry(s, entry, allNoTrades, new Date());
      return { state: res.state, result: { xpAwarded: res.xpAwarded, leveledUp: res.leveledUp, newLevel: res.newLevel, newlyUnlocked: res.newlyUnlocked } };
    }, { xpAwarded: 0, leveledUp: false, newLevel: undefined as number | undefined, newlyUnlocked: [] as string[] });
  }, [applySync]);

  const setFrame = useCallback((frame: number) => {
    update((prev) => ({
      ...prev,
      frame,
    }));
  }, [update]);

  const setTitle = useCallback((title: number) => {
    update((prev) => ({
      ...prev,
      title,
    }));
  }, [update]);

  const setBackground = useCallback((background: number) => {
    update((prev) => ({
      ...prev,
      background,
    }));
  }, [update]);

  const cycleFrame = useCallback(() => {
    update((prev) => {
      let nextFrame = prev.frame;
      for (let i = 1; i <= FRAMES.length; i++) {
        const idx = (prev.frame + i) % FRAMES.length;
        if (prev.level >= FRAMES[idx].reqLevel) {
          nextFrame = idx;
          break;
        }
      }
      return { ...prev, frame: nextFrame };
    });
  }, [update]);

  const cycleBackground = useCallback(() => {
    update((prev) => ({
      ...prev,
      background: (prev.background + 1) % BACKGROUNDS.length,
    }));
  }, [update]);

  const cycleTitle = useCallback(() => {
    update((prev) => {
      let nextTitle = prev.title;
      for (let i = 1; i <= TITLES.length; i++) {
        const idx = (prev.title + i) % TITLES.length;
        if (prev.level >= TITLES[idx].reqLevel) {
          nextTitle = idx;
          break;
        }
      }
      return { ...prev, title: nextTitle };
    });
  }, [update]);

  const addCustomGoal = useCallback((title: string, category: string) => {
    return applySync((s) => {
      const next = addCustomGoalLogic(s, title, category, new Date());
      return { state: next, result: next.customGoals.length > s.customGoals.length };
    }, false);
  }, [applySync]);

  const removeCustomGoal = useCallback((goalId: string) => {
    update((prev) => removeCustomGoalLogic(prev, goalId));
  }, [update]);

  const effectiveEquipment = useMemo(() => {
    const eq = { ...gameState.equipment };
    if (previewItem != null && ITEMS[previewItem]) {
      eq[ITEMS[previewItem].slot] = previewItem;
    }
    return eq;
  }, [gameState.equipment, previewItem]);

  const gameDay = gameDayKey(gameState, now);

  const completedTodayCount = Object.keys(gameState.completedQuestsToday).length;
  const characterStatus = getCharacterStatus(
    completedTodayCount,
    gameState.isRestDay
  );

  return (
    <GameContext.Provider
      value={{
        gameState,
        setGameState,
        isLoaded,
        gameDay,
        previewItem,
        setPreviewItem,
        wardrobeFilter,
        setWardrobeFilter,
        effectiveEquipment,
        completeQuest,
        completeQuestSafe,
        rewards,
        setDayMode,
        setTradingDays,
        fixWeekChallenge,
        recordWeekBossResult,
        grantFirstAction,
        passQuest,
        replaceQuest,
        toggleRestDay,
        claimDailyReward,
        setPlan,
        updateProfile,
        selectTitle,
        equipItem,
        unequipSlot,
        applyLoadout,
        saveLoadout,
        addPost,
        deletePost,
        recordTrade,
        recordNoTrade,
        recordNoteSaved,
        recordScreenshot,
        checkAndClosePlanQuests,
        setFrame,
        setTitle,
        setBackground,
        cycleFrame,
        cycleBackground,
        cycleTitle,
        addCustomGoal,
        removeCustomGoal,
        characterStatus,
        saveOnboardingAnswer,
        setOnboardingStep,
        completeOnboarding,
        dismissLegacyBanner,
        setAiConsent,
        updateAvatarAppearance,
        updateMinorMode,
        updateTimezone,
        saveProfileEdits,
        syncCloudNickname,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

/** The game, or null outside a GameProvider (the journal works without it in tests). */
export function useOptionalGame() {
  return useContext(GameContext);
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error("useGame must be used within a GameProvider");
  }
  return context;
}
