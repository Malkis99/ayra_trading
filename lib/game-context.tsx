"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import {
  GameState,
  INITIAL_GAME_STATE,
  checkAndApplyDateResets,
  completeQuest as completeQuestLogic,
  claimDailyReward as claimDailyRewardLogic,
  changePlan as changePlanLogic,
  getCharacterStatus,
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
} from "@/lib/game";
import { ITEMS, FRAMES, TITLES, BACKGROUNDS } from "@/lib/items";
import { AvatarAppearance, validateAvatarAppearance } from "@/lib/avatar";
import { OnboardingState, generateProgram } from "@/lib/awakening";

const STORAGE_KEY = "ayra_demo_v1";

interface GameContextType {
  gameState: GameState;
  isLoaded: boolean;
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
  ) => { leveledUp: boolean; newLevel?: number; newlyUnlocked: string[] };
  passQuest: (questId: string) => void;
  replaceQuest: (questId: string) => boolean;
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
  setFrame: (frame: number) => void;
  setTitle: (title: number) => void;
  setBackground: (bg: number) => void;
  cycleFrame: () => void;
  cycleBackground: () => void;
  cycleTitle: () => void;
  addCustomGoal: (title: string, category: string) => void;
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
}

const GameContext = createContext<GameContextType | undefined>(undefined);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [gameState, setGameState] = useState<GameState>(INITIAL_GAME_STATE);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [previewItem, setPreviewItem] = useState<number | null>(null);
  const [wardrobeFilter, setWardrobeFilter] = useState<string>("all");

  // Load from localStorage on client mount to avoid SSR hydration mismatch, with safety timer fallback
  useEffect(() => {
    let timer: NodeJS.Timeout;

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const resetted = checkAndApplyDateResets(parsed, new Date());
        setGameState(resetted);
      } else {
        const resetted = checkAndApplyDateResets(INITIAL_GAME_STATE, new Date());
        setGameState(resetted);
      }
    } catch {
      setGameState(INITIAL_GAME_STATE);
    } finally {
      setIsLoaded(true);
    }

    // Safety fallback timer: force hydrated = true after 1.5s to prevent infinite whiteout or splash freeze
    timer = setTimeout(() => {
      setIsLoaded(true);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  // Save to localStorage whenever state changes after mount
  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
    } catch {
      // ignore storage errors
    }
  }, [gameState, isLoaded]);

  const saveOnboardingAnswer = useCallback((key: string, value: any) => {
    setGameState((prev) => {
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

      const newStartedAt =
        prev.onboarding.startedAt || new Date().toISOString();

      return {
        ...prev,
        name: newName,
        profile: {
          ...prev.profile,
          appearance: newAppearance,
          minorMode: newMinorMode,
        },
        onboarding: {
          ...prev.onboarding,
          status: newStatus,
          answers: newAnswers,
          startedAt: newStartedAt,
        },
      };
    });
  }, []);

  const setOnboardingStep = useCallback((step: number, subStep: number) => {
    setGameState((prev) => ({
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
  }, []);

  const completeOnboarding = useCallback(() => {
    setGameState((prev) => {
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
  }, []);

  const dismissLegacyBanner = useCallback(() => {
    setGameState((prev) => ({
      ...prev,
      onboarding: {
        ...prev.onboarding,
        legacyDismissed: true,
      },
    }));
  }, []);

  const setAiConsent = useCallback((aiConsent: boolean) => {
    setGameState((prev) => ({
      ...prev,
      aiConsent,
    }));
  }, []);

  const updateAvatarAppearance = useCallback((appearance: AvatarAppearance) => {
    const valid = validateAvatarAppearance(appearance);
    setGameState((prev) => ({
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
  }, []);

  const updateMinorMode = useCallback((minorMode: boolean) => {
    setGameState((prev) => ({
      ...prev,
      profile: {
        ...prev.profile,
        minorMode,
      },
    }));
  }, []);

  const completeQuest = useCallback(
    (
      questId: string,
      title: string,
      category: string,
      xp?: number,
      coins?: number
    ) => {
      let result = {
        leveledUp: false,
        newLevel: undefined as number | undefined,
        newlyUnlocked: [] as string[],
      };
      setGameState((prev) => {
        const res = completeQuestLogic(
          prev,
          questId,
          title,
          category,
          xp,
          coins,
          new Date()
        );
        result = {
          leveledUp: res.leveledUp,
          newLevel: res.newLevel,
          newlyUnlocked: res.newlyUnlocked,
        };
        return res.state;
      });
      return result;
    },
    []
  );

  const passQuest = useCallback((questId: string) => {
    setGameState((prev) => passQuestLogic(prev, questId, new Date()));
  }, []);

  const replaceQuest = useCallback((questId: string) => {
    let success = false;
    setGameState((prev) => {
      const res = replaceQuestLogic(prev, questId, new Date());
      success = res.success;
      return res.state;
    });
    return success;
  }, []);

  const toggleRestDay = useCallback(() => {
    setGameState((prev) => toggleRestDayLogic(prev, new Date()));
  }, []);

  const claimDailyReward = useCallback(() => {
    let claimedCoins = 0;
    setGameState((prev) => {
      const res = claimDailyRewardLogic(prev, new Date());
      claimedCoins = res.claimedCoins;
      return res.state;
    });
    return claimedCoins;
  }, []);

  const setPlan = useCallback((plan: "Free" | "Pro" | "Elite") => {
    setGameState((prev) => changePlanLogic(prev, plan));
  }, []);

  const updateProfile = useCallback((name: string, bio: string) => {
    setGameState((prev) => updateProfileInfoLogic(prev, name, bio));
  }, []);

  const selectTitle = useCallback((titleId: string) => {
    setGameState((prev) => {
      if (!prev.unlockedTitles.includes(titleId)) return prev;
      return { ...prev, selectedTitle: titleId };
    });
  }, []);

  const equipItem = useCallback((itemId: number) => {
    let newlyUnlocked: string[] = [];
    setGameState((prev) => {
      const res = equipItemLogic(prev, itemId);
      newlyUnlocked = res.newlyUnlocked;
      return res.state;
    });
    setPreviewItem(null);
    return newlyUnlocked;
  }, []);

  const unequipSlot = useCallback((slot: string) => {
    let newlyUnlocked: string[] = [];
    setGameState((prev) => {
      const res = unequipSlotLogic(prev, slot);
      newlyUnlocked = res.newlyUnlocked;
      return res.state;
    });
    setPreviewItem(null);
    return newlyUnlocked;
  }, []);

  const applyLoadout = useCallback((loadoutName: string) => {
    let newlyUnlocked: string[] = [];
    setGameState((prev) => {
      const res = applyLoadoutLogic(prev, loadoutName);
      newlyUnlocked = res.newlyUnlocked;
      return res.state;
    });
    setPreviewItem(null);
    return newlyUnlocked;
  }, []);

  const saveLoadout = useCallback((loadoutName: string) => {
    setGameState((prev) => saveLoadoutLogic(prev, loadoutName));
  }, []);

  const addPost = useCallback((content: string) => {
    let newlyUnlocked: string[] = [];
    setGameState((prev) => {
      const res = addPostLogic(prev, content);
      newlyUnlocked = res.newlyUnlocked;
      return res.state;
    });
    return newlyUnlocked;
  }, []);

  const deletePost = useCallback((postIndex: number) => {
    setGameState((prev) => deletePostLogic(prev, postIndex));
  }, []);

  const recordTrade = useCallback((trade: any, allTrades: any[]) => {
    let result = {
      xpAwarded: 0,
      questClosed: false,
      leveledUp: false,
      newLevel: undefined as number | undefined,
      newlyUnlocked: [] as string[],
    };
    setGameState((prev) => {
      const res = recordLoggedTrade(prev, trade, allTrades, new Date());
      result = {
        xpAwarded: res.xpAwarded,
        questClosed: res.questClosed,
        leveledUp: res.leveledUp,
        newLevel: res.newLevel,
        newlyUnlocked: res.newlyUnlocked,
      };
      return res.state;
    });
    return result;
  }, []);

  const recordNoTrade = useCallback((entry: any, allNoTrades: any[]) => {
    let result = {
      xpAwarded: 0,
      leveledUp: false,
      newLevel: undefined as number | undefined,
      newlyUnlocked: [] as string[],
    };
    setGameState((prev) => {
      const res = recordNoTradeEntry(prev, entry, allNoTrades, new Date());
      result = {
        xpAwarded: res.xpAwarded,
        leveledUp: res.leveledUp,
        newLevel: res.newLevel,
        newlyUnlocked: res.newlyUnlocked,
      };
      return res.state;
    });
    return result;
  }, []);

  const setFrame = useCallback((frame: number) => {
    setGameState((prev) => ({
      ...prev,
      frame,
    }));
  }, []);

  const setTitle = useCallback((title: number) => {
    setGameState((prev) => ({
      ...prev,
      title,
    }));
  }, []);

  const setBackground = useCallback((background: number) => {
    setGameState((prev) => ({
      ...prev,
      background,
    }));
  }, []);

  const cycleFrame = useCallback(() => {
    setGameState((prev) => {
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
  }, []);

  const cycleBackground = useCallback(() => {
    setGameState((prev) => ({
      ...prev,
      background: (prev.background + 1) % BACKGROUNDS.length,
    }));
  }, []);

  const cycleTitle = useCallback(() => {
    setGameState((prev) => {
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
  }, []);

  const addCustomGoal = useCallback((title: string, category: string) => {
    setGameState((prev) => addCustomGoalLogic(prev, title, category));
  }, []);

  const removeCustomGoal = useCallback((goalId: string) => {
    setGameState((prev) => removeCustomGoalLogic(prev, goalId));
  }, []);

  const effectiveEquipment = useMemo(() => {
    const eq = { ...gameState.equipment };
    if (previewItem != null && ITEMS[previewItem]) {
      eq[ITEMS[previewItem].slot] = previewItem;
    }
    return eq;
  }, [gameState.equipment, previewItem]);

  const completedTodayCount = Object.keys(gameState.completedQuestsToday).length;
  const characterStatus = getCharacterStatus(
    completedTodayCount,
    gameState.isRestDay
  );

  return (
    <GameContext.Provider
      value={{
        gameState,
        isLoaded,
        previewItem,
        setPreviewItem,
        wardrobeFilter,
        setWardrobeFilter,
        effectiveEquipment,
        completeQuest,
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
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error("useGame must be used within a GameProvider");
  }
  return context;
}
