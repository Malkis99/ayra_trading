"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import {
  GameState,
  type VerifyFailure,
  INITIAL_GAME_STATE,
  checkAndApplyDateResets,
  recordJournalTrades,
  acceptMission,
  verifyMission,
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
  modeSetPreview,
  setTradingDays as setTradingDaysLogic,
  setWeekChallenge as setWeekChallengeLogic,
  recordWeekBossResult as recordWeekBossResultLogic,
  createPersonalQuest as createPersonalQuestLogic,
  abandonPersonalQuest as abandonPersonalQuestLogic,
  restartPersonalQuest as restartPersonalQuestLogic,
  markPersonalQuestDay as markPersonalQuestDayLogic,
  savePersonalQuestNote as savePersonalQuestNoteLogic,
  completePersonalQuest as completePersonalQuestLogic,
  type PersonalQuestFailure,
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
import { isMissionId, type MissionData, type MissionId } from "./missions";
import { missionShadowOn, sendMissionShadow } from "./missions-shadow-client";
import { spaceTabChannel } from "@/lib/auth/space-channel";
import { dayKeyInZone } from "@/lib/day-key";
import { GameStore, browserLock, revOf, type Change } from "@/lib/game-store";
import { deviceRewardService, type RewardService } from "@/lib/reward-service";
import { generateDaySet, type DayMode, type WeekChallenge } from "@/lib/quest-engine";
import { ECONOMY_MODE_KEY, deviceRewardsAllowed, economyBasis, laterMode, readStickyMode, refusesReward, rememberMode, resolveEconomyMode, serverEconomyOn, type EconomyBasis, type EconomyMode, type SessionEconomy } from "./economy-mode";
import { useOptionalAuth } from "@/lib/auth/auth-context";
import { serverDay, type DayCall, type ServerDayStatus } from "./server-day-client";
import { mirrorServerDay } from "./server-day-mirror";
import type { WeekSnapshot } from "@/lib/day-snapshots";
import type { PQNoteField, PQResult, PQStartInput } from "@/lib/personal-quests";
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
  /** The journal reports the game day of its earliest live trade (null: none) once it is read (catalog 3 study choice). */
  recordJournalTrades: (firstTradeDay: string | null) => void;
  /** Pays the missions the saved journal confirms (QH-6.4), under the lock shared by all tabs, on fresh data. */
  /** QH-6.6: accepts a mission of today's set (gives nothing); false when it cannot be accepted or not saved. */
  acceptMission: (id: string) => boolean;
  /** QH-6.6: «Verify» of an accepted mission — the one claim of lib/game.ts, under the lock shared by all tabs. */
  verifyMission: (id: string, data: MissionData) => Promise<{ paid: boolean; xp: number; coins: number; leveledUp: boolean; newLevel?: number; failure?: VerifyFailure; saveFailed?: boolean }>;
  /**
   * Personal quests «My path» (QH-8.2): start, abandon, restart — under the lock shared by all tabs, on the freshest saved
   * state. Nothing gives XP or Coins. `reason: "notSaved"` when the change could not be saved.
   */
  createPersonalQuest: (input: PQStartInput & { id: string }) => Promise<{ ok: boolean; runId?: string; reason?: PersonalQuestFailure | "notSaved" }>;
  abandonPersonalQuest: (runId: string) => Promise<{ ok: boolean; reason?: PersonalQuestFailure | "notSaved" }>;
  restartPersonalQuest: (runId: string, newId: string) => Promise<{ ok: boolean; runId?: string; reason?: PersonalQuestFailure | "notSaved" }>;
  /** QH-8.3: today's self-report of a personal quest (once a day) and the quest diary — no rewards. */
  markPersonalQuestDay: (runId: string) => Promise<{ ok: boolean; reason?: PersonalQuestFailure | "notSaved" }>;
  savePersonalQuestNote: (runId: string, input: { day: string } & Partial<Record<PQNoteField, string>>) => Promise<{ ok: boolean; reason?: PersonalQuestFailure | "notSaved" }>;
  /** QH-8.4: completes a personal quest with the final report (once; the Journal checked on fresh data) — no XP, no Coins. */
  completePersonalQuest: (runId: string, report: string, data: MissionData | null) => Promise<PersonalCompletion>;
  /** Saves the edit-profile form: nickname (already accepted by the server for accounts), bio and optional details. */
  saveProfileEdits: (edits: { name: string; bio: string; details: ProfileDetails }) => void;
  /** Accounts: the cloud nickname is the source of truth; copies it into the local state without a chronicle entry. */
  syncCloudNickname: (nickname: string) => void;
  /**
   * Q4.4: who keeps the economy of this account (lib/economy-mode.ts) and the last notice to show. «local»: the device,
   * as before. Otherwise the device gives no rewards; for «cloud_active» the game day comes from the server.
   */
  economy: EconomyView;
  /** Q4.4: reads (and, for an account on the server economy, opens) the server's game day. */
  refreshServerDay: () => Promise<void>;
}

export interface EconomyView {
  mode: EconomyMode;
  /** Q4.5-1: on what the mode rests (lib/economy-mode.ts economyBasis) — «unconfirmed» keeps the old behaviour. */
  basis: EconomyBasis;
  gameSync: boolean;
  /** rewardsPaused | serverRefused | offline (null: nothing to say) */
  notice: "rewardsPaused" | "serverRefused" | "offline" | null;
  /** The server's code for «serverRefused». */
  noticeReason?: string;
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
/** What completing a personal quest returns (QH-8.4/8.5): only a saved change reports XP. */
export interface PersonalCompletion {
  ok: boolean;
  result?: PQResult;
  upgraded?: boolean;
  duplicate?: boolean;
  xp?: number;
  leveledUp?: boolean;
  newLevel?: number;
  reason?: PersonalQuestFailure | "notSaved";
}

/** A personal quest change that could not be saved (QH-8.2). */
const NOT_SAVED: { ok: boolean; runId?: string; reason?: PersonalQuestFailure | "notSaved" } = { ok: false, reason: "notSaved" };

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

  // Q4.4: who keeps the economy (the mode only moves forward; «local» = the device, as before)
  const [economy, setEconomy] = useState<EconomyView>({ mode: "local", basis: "unconfirmed", gameSync: false, notice: null });
  // the space the state was last loaded from (guest, or an account after sign-in): the server day is asked again for it
  const [loadedSpace, setLoadedSpace] = useState<string | null>(null);
  const economyRef = React.useRef<EconomyView>(economy);
  const setEconomyView = useCallback((v: Partial<EconomyView>) => {
    economyRef.current = { ...economyRef.current, ...v };
    setEconomy(economyRef.current);
  }, []);
  const rewardRefusedRef = React.useRef(false);
  /**
   * Outside «local» a change that gives a reward (XP, level, Coins, an achievement, a quest newly done, a paid personal
   * quest) is refused as a whole: the state stays, the caller gets its «not given» answer, the notice explains why.
   */
  const guardRewards = useCallback(
    <R,>(fn: (fresh: GameState) => Change<GameState, R>, failed: R) =>
      (fresh: GameState): Change<GameState, R> => {
        const c = fn(fresh);
        // the latest mode known right now: this tab's, or one another tab has just saved (F2: read at the moment of
        // the change, not when the tab was opened) — a «scheduled» tab never pays once another tab saw «pending»
        if (refusesReward(fresh, c.state, economyRef.current.mode, readStickyMode())) {
          rewardRefusedRef.current = true;
          return { state: fresh, result: failed };
        }
        return c;
      },
    []
  );
  const noteRefusal = useCallback(() => {
    if (!rewardRefusedRef.current) return;
    rewardRefusedRef.current = false;
    setEconomyView({ mode: laterMode(economyRef.current.mode, readStickyMode()), basis: "marked", notice: "rewardsPaused", noticeReason: undefined });
  }, [setEconomyView]);

  // Q4.5-1: the session's economy mark (app_metadata.ayra_economy, written only by the server)
  const auth = useOptionalAuth();
  const sessionEconomy = auth?.sessionEconomy ?? null;
  const sessionEconomyRef = React.useRef<SessionEconomy | null>(sessionEconomy);
  sessionEconomyRef.current = sessionEconomy;
  /** Recomputes the mode of the loaded space from every source (never backwards) and keeps a mark on the device. */
  const settleEconomy = useCallback(
    (spaceId: string | null) => {
      const session = sessionEconomyRef.current;
      const mode = resolveEconomyMode({ known: laterMode(economyRef.current.mode, readStickyMode()), spaceId, session });
      if (mode !== "local" && spaceId) rememberMode(mode, spaceId);
      const matching = session && spaceId === `account:${session.userId}` ? session : null;
      const basis = economyBasis(mode, matching, Date.now());
      if (mode !== economyRef.current.mode || basis !== economyRef.current.basis) setEconomyView({ mode, basis });
    },
    [setEconomyView]
  );

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
      const out = store.applySync(gameStateRef.current, guardRewards(fn, failed));
      showState(out.state);
      noteRefusal();
      return out.saved ? out.result : failed;
    },
    [showState, guardRewards, noteRefusal]
  );

  /** Changes that give rewards from the Quests page and screenshots: also under the lock shared by all tabs. */
  const applyLocked = useCallback(
    async <R,>(fn: (fresh: GameState) => Change<GameState, R>, failed: R): Promise<R> => {
      const store = storeRef.current;
      if (!store) return failed;
      const out = await store.applyLocked(() => gameStateRef.current, guardRewards(fn, failed));
      showState(out.state);
      noteRefusal();
      return out.saved ? out.result : failed;
    },
    [showState, guardRewards, noteRefusal]
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
      // the economy mode this device knows for the space (never backwards: lib/economy-mode.ts)
      {
        const session = sessionEconomyRef.current;
        const mode = resolveEconomyMode({ known: readStickyMode(), spaceId, session });
        if (mode !== "local") rememberMode(mode, spaceId);
        const matching = session && spaceId === `account:${session.userId}` ? session : null;
        economyRef.current = { mode, basis: economyBasis(mode, matching, Date.now()), gameSync: false, notice: null };
      }
      setEconomy(economyRef.current);
      setLoadedSpace(spaceId);
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

  // Q4.5-1 (F2): another tab saved a mode for this space — it holds here at once
  useEffect(() => {
    const onMode = (e: StorageEvent) => {
      if (!e.key || !e.key.endsWith(ECONOMY_MODE_KEY)) return;
      if (AppStorage.getActiveSpaceId() !== loadedSpaceRef.current) return;
      settleEconomy(loadedSpaceRef.current);
    };
    window.addEventListener("storage", onMode);
    return () => window.removeEventListener("storage", onMode);
  }, [settleEconomy]);
  useEffect(() => {
    if (!loadedSpaceRef.current) return;
    settleEconomy(loadedSpaceRef.current);
  }, [sessionEconomy, settleEconomy]);

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

  // What the journal has (catalog 3: «Trade review» or «Observation» for a new day); gives nothing
  const recordJournalTradesCb = useCallback((firstTradeDay: string | null) => {
    update((prev) => recordJournalTrades(prev, firstTradeDay, new Date()));
  }, [update]);

  // Q4.4: the server's answer about the account — the mode (forward only) and, for «cloud_active», its game day
  const applyServerStatus = useCallback(
    (st: ServerDayStatus | null) => {
      if (!st) return;
      const mode = rememberMode(st.state);
      setEconomyView({ mode, gameSync: !!st.game_sync });
      if (mode !== "cloud_active" || !st.day) return;
      const store = storeRef.current;
      if (!store) return;
      // the server's day is copied as it is (not a reward: never XP, Coins or levels; lib/server-day-mirror.ts)
      const out = store.applySync(gameStateRef.current, (fresh) => ({ state: mirrorServerDay(fresh, st, new Date()), result: true }));
      showState(out.state);
    },
    [setEconomyView, showState]
  );
  const noteServerRefusal = useCallback(
    (r: DayCall) => {
      if (r.ok) return;
      if (r.error === "network") setEconomyView({ notice: "offline", noticeReason: undefined });
      else setEconomyView({ notice: "serverRefused", noticeReason: r.error });
    },
    [setEconomyView]
  );
  const runCloud = useCallback(
    async (call: Promise<DayCall>): Promise<DayCall> => {
      const r = await call;
      if (r.ok) {
        applyServerStatus(r.status);
        setEconomyView({ notice: null, noticeReason: undefined });
      } else noteServerRefusal(r);
      return r;
    },
    [applyServerStatus, noteServerRefusal, setEconomyView]
  );
  const onCloud = () => economyRef.current.mode === "cloud_active";

  const refreshServerDay = useCallback(async () => {
    if (!serverEconomyOn() || !AppStorage.getActiveSpaceId().startsWith("account:")) return;
    const r = await serverDay.status();
    if (!r.ok) {
      // 404 = the feature is off; 503 = the server economy is not installed: the device keeps what it knows
      if (r.error === "network") setEconomyView({ notice: "offline", noticeReason: undefined });
      return;
    }
    const st = r.status;
    applyServerStatus(st);
    if (st && st.state === "cloud_active" && !st.day && st.game_day && st.opening_mode) {
      // the server opens the day in the mode of the saved trading days; the app offers the extras of that mode
      const extras = generateDaySet(gameStateRef.current, st.game_day, st.opening_mode).bonus.slice(0, 2);
      await runCloud(serverDay.open(extras));
    }
  }, [applyServerStatus, runCloud, setEconomyView]);

  useEffect(() => {
    if (!isLoaded || !serverEconomyOn() || !loadedSpace?.startsWith("account:")) return;
    void refreshServerDay();
    const onFocus = () => {
      if (document.visibilityState === "visible") void refreshServerDay();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [isLoaded, loadedSpace, refreshServerDay]);

  // QH-6.6: accepting a mission gives nothing; it only marks the mission as taken for today (Q4.4: on the server day for
  // an account on the server economy — the device shows the server's answer)
  const acceptMissionCb = useCallback(
    (id: string) => {
      if (onCloud()) {
        void runCloud(serverDay.accept(id));
        return true;
      }
      return applySync((s) => {
        const res = acceptMission(s, id, new Date());
        return { state: res.state, result: res.ok };
      }, false);
    },
    [applySync, runCloud]
  );

  // QH-6.6: «Verify» — the same claim as every mission payment, on the freshest saved state, one tab at a time
  const verifyMissionCb = useCallback(
    async (id: string, data: MissionData) => {
      const now = new Date();
      // Q4.4: once the move started the device never pays; the server checks (and pays only once payouts are on).
      // «migration_scheduled» still pays on the device (owner decision 2026-11-18). The latest known mode decides.
      const mode = laterMode(economyRef.current.mode, readStickyMode());
      if (!deviceRewardsAllowed(mode)) {
        const nothing = { paid: false, xp: 0, coins: 0, leveledUp: false, saveFailed: false };
        if (mode !== "cloud_active" || !economyRef.current.gameSync) return { ...nothing, failure: { reason: "rewardsPaused" } as VerifyFailure };
        const r = await serverDay.verify(id);
        void refreshServerDay();
        if (!r.ok) {
          const map: Record<string, VerifyFailure["reason"]> = { mission_not_accepted: "notAccepted", day_cap: "dayFull", source_used: "sourceUsed", sync_paused: "rewardsPaused", mission_not_assigned: "notAvailable", day_not_open: "notAvailable", account_not_active: "rewardsPaused" };
          return { ...nothing, failure: { reason: map[r.error] ?? "serverUnavailable" } as VerifyFailure };
        }
        const reason = typeof r.body.reason === "string" ? r.body.reason : "";
        if (reason === "payout_disabled") return { ...nothing, failure: { reason: "serverPayoutsOff" } as VerifyFailure };
        if (reason === "not_seen_by_server") return { ...nothing, failure: { reason: "notSeenByServer" } as VerifyFailure };
        if (r.body.paid === true) return { ...nothing, paid: true }; // the server's XP arrives with its projection (Q4.5)
        return { ...nothing, failure: { reason: (reason || "notAvailable") as VerifyFailure["reason"] } };
      }
      const out = await applyLocked((s) => {
        const res = verifyMission(s, id, data, now);
        const day = gameDayKey(res.state, now);
        const done = res.paid || res.state.completedQuestsToday[id] === true;
        const source = done && res.state.missionLedger?.day === day ? res.state.missionLedger.claims[id as MissionId] : undefined;
        return { state: res.state, result: { paid: res.paid, xp: res.xp, coins: res.coins, leveledUp: res.leveledUp, newLevel: res.newLevel, failure: res.failure, saveFailed: false, shadow: { day, done, source } } };
      }, { paid: false, xp: 0, coins: 0, leveledUp: false, newLevel: undefined as number | undefined, failure: undefined as VerifyFailure | undefined, saveFailed: true, shadow: null as { day: string; done: boolean; source?: string } | null });
      // Q4.2 shadow mode: the server repeats the check on the cloud journal, after the app has decided and saved. Not
      // awaited and never applied: nothing in the game changes from the server's answer.
      if (missionShadowOn() && deviceRewardsAllowed(economyRef.current.mode) && out.shadow && isMissionId(id)) {
        const { shadow, ...rest } = out;
        const source = shadow.source && !shadow.source.startsWith("paid:") ? shadow.source : undefined;
        void sendMissionShadow([{ id, day: shadow.day, done: shadow.done, ...(source ? { source } : {}), ...(rest.failure ? { reason: rest.failure.reason } : {}) }]);
        return rest;
      }
      const { shadow: _shadow, ...rest } = out;
      return rest;
    },
    [applyLocked, refreshServerDay]
  );

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
    async (mode: DayMode): Promise<{ ok: boolean; reason?: DayModeFailure | "notSaved" }> => {
      if (onCloud()) {
        // the server composes the slots; the app offers the extras of the new mode (the server checks them)
        const extras = mode === "rest" ? undefined : modeSetPreview(gameStateRef.current, mode, new Date()).bonus.slice(0, 2);
        const r = await runCloud(serverDay.mode(mode, extras));
        return r.ok ? { ok: true } : { ok: false, reason: "notSaved" };
      }
      return applyLocked(
        (s) => {
          const res = setDayModeLogic(s, mode, new Date());
          return { state: res.ok ? res.state : s, result: { ok: res.ok, reason: res.reason as DayModeFailure | "notSaved" | undefined } };
        },
        { ok: false, reason: "notSaved" as const }
      );
    },
    [applyLocked, runCloud]
  );

  const setTradingDays = useCallback(
    (days: number[]) => {
      // on the server economy the server keeps them too (from the next game day)
      if (onCloud()) void runCloud(serverDay.tradingDays(days));
      return update((prev) => setTradingDaysLogic(prev, days));
    },
    [update, runCloud]
  );

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

  // Personal quests (QH-8.2): one tab at a time on fresh data, so two tabs cannot pass the limits together; no rewards
  const createPersonalQuest = useCallback(
    (input: PQStartInput & { id: string }) =>
      applyLocked((s) => {
        const res = createPersonalQuestLogic(s, input, new Date());
        return { state: res.state, result: { ok: res.ok, runId: res.runId, reason: res.reason as PersonalQuestFailure | "notSaved" | undefined } };
      }, NOT_SAVED),
    [applyLocked]
  );
  const abandonPersonalQuest = useCallback(
    (runId: string) =>
      applyLocked((s) => {
        const res = abandonPersonalQuestLogic(s, runId, new Date());
        return { state: res.state, result: { ok: res.ok, reason: res.reason as PersonalQuestFailure | "notSaved" | undefined } };
      }, NOT_SAVED),
    [applyLocked]
  );
  const restartPersonalQuest = useCallback(
    (runId: string, newId: string) =>
      applyLocked((s) => {
        const res = restartPersonalQuestLogic(s, runId, newId, new Date());
        return { state: res.state, result: { ok: res.ok, runId: res.runId, reason: res.reason as PersonalQuestFailure | "notSaved" | undefined } };
      }, NOT_SAVED),
    [applyLocked]
  );

  const markPersonalQuestDay = useCallback(
    (runId: string) =>
      applyLocked((s) => {
        const res = markPersonalQuestDayLogic(s, runId, new Date());
        return { state: res.state, result: { ok: res.ok, reason: res.reason as PersonalQuestFailure | "notSaved" | undefined } };
      }, NOT_SAVED),
    [applyLocked]
  );
  const savePersonalQuestNote = useCallback(
    (runId: string, input: { day: string } & Partial<Record<PQNoteField, string>>) =>
      applyLocked((s) => {
        const res = savePersonalQuestNoteLogic(s, runId, input, new Date());
        return { state: res.state, result: { ok: res.ok, reason: res.reason as PersonalQuestFailure | "notSaved" | undefined } };
      }, NOT_SAVED),
    [applyLocked]
  );

  const completePersonalQuest = useCallback(
    (runId: string, report: string, data: MissionData | null) =>
      applyLocked(
        (s) => {
          const res = completePersonalQuestLogic(s, runId, report, data, new Date());
          const out: PersonalCompletion = { ok: res.ok, result: res.result, upgraded: res.upgraded, duplicate: res.duplicate, xp: res.xp, leveledUp: res.leveledUp, newLevel: res.newLevel, reason: res.reason };
          return { state: res.state, result: out };
        },
        // not saved: nothing is reported as given
        NOT_SAVED as PersonalCompletion
      ),
    [applyLocked]
  );

  // One-time reward for the first action of a kind on this account (the journal decides it is the first)
  const grantFirstAction = useCallback((kind: FirstActionKind) => {
    return applySync((s) => {
      const res = grantFirstActionLogic(s, kind, new Date());
      return { state: res.state, result: { coins: res.coins, xp: res.xp } };
    }, { coins: 0, xp: 0 });
  }, [applySync]);

  const passQuest = useCallback((questId: string) => {
    // a mission of the server day is put off on the server; an extra stays a device mark
    if (onCloud() && isMissionId(questId)) {
      void runCloud(serverDay.pass(questId));
      return;
    }
    update((prev) => passQuestLogic(prev, questId, new Date()));
  }, [update, runCloud]);

  const replaceQuest = useCallback(
    async (questId: string, shownQuestIds: string[]): Promise<{ success: boolean; replacementId?: string; reason?: ReplaceQuestFailure | "notSaved" }> => {
      if (onCloud()) {
        // the app picks the replacement by its own rules (lib/quests.ts pickReplacement); the server checks it
        const local = replaceQuestLogic(gameStateRef.current, questId, shownQuestIds, new Date());
        if (!local.success || !local.replacementId) return { success: false, reason: local.reason };
        const r = await runCloud(serverDay.replace(questId, local.replacementId));
        if (r.ok) return { success: true, replacementId: local.replacementId };
        return { success: false, reason: r.error === "replacement_limit" ? "limit" : r.error === "network" ? "notSaved" : "notReplaceable" };
      }
      return applyLocked((s) => {
        const res = replaceQuestLogic(s, questId, shownQuestIds, new Date());
        return { state: res.success ? res.state : s, result: { success: res.success, replacementId: res.replacementId, reason: res.reason as ReplaceQuestFailure | "notSaved" | undefined } };
      }, { success: false, replacementId: undefined, reason: "notSaved" as const });
    },
    [applyLocked, runCloud]
  );

  const toggleRestDay = useCallback(() => {
    if (onCloud()) {
      const s = gameStateRef.current;
      void setDayMode(s.isRestDay ? s.questDay?.modeBeforeRest ?? "trading" : "rest");
      return;
    }
    update((prev) => toggleRestDayLogic(prev, new Date()));
  }, [update, setDayMode]);

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
        recordJournalTrades: recordJournalTradesCb,
        acceptMission: acceptMissionCb,
        verifyMission: verifyMissionCb,
        createPersonalQuest,
        abandonPersonalQuest,
        restartPersonalQuest,
        markPersonalQuestDay,
        savePersonalQuestNote,
        completePersonalQuest,
        saveProfileEdits,
        syncCloudNickname,
        economy,
        refreshServerDay,
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
