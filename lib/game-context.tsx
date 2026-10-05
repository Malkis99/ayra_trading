"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
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
} from "@/lib/game";

const STORAGE_KEY = "ayra_demo_v1";

interface GameContextType {
  gameState: GameState;
  isLoaded: boolean;
  completeQuest: (
    questId: string,
    title: string,
    category: string,
    xp?: number,
    coins?: number
  ) => { leveledUp: boolean; newLevel?: number };
  passQuest: (questId: string) => void;
  replaceQuest: (questId: string) => boolean;
  toggleRestDay: () => void;
  claimDailyReward: () => number;
  setPlan: (plan: "Free" | "Pro" | "Elite") => void;
  updateProfile: (name: string, bio: string) => void;
  setEquipment: (equipment: Record<string, number>) => void;
  setFrame: (frame: number) => void;
  setTitle: (title: number) => void;
  setBackground: (bg: number) => void;
  addCustomGoal: (title: string, category: string) => void;
  removeCustomGoal: (goalId: string) => void;
  characterStatus: "Training" | "Resting";
}

const GameContext = createContext<GameContextType | undefined>(undefined);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [gameState, setGameState] = useState<GameState>(INITIAL_GAME_STATE);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  // Load from localStorage on client mount to avoid SSR hydration mismatch
  useEffect(() => {
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

  const completeQuest = useCallback(
    (
      questId: string,
      title: string,
      category: string,
      xp?: number,
      coins?: number
    ) => {
      let result = { leveledUp: false, newLevel: undefined as number | undefined };
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
        result = { leveledUp: res.leveledUp, newLevel: res.newLevel };
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
    setGameState((prev) => ({
      ...prev,
      name: name.trim() || prev.name,
      bio,
    }));
  }, []);

  const setEquipment = useCallback((equipment: Record<string, number>) => {
    setGameState((prev) => ({
      ...prev,
      equipment,
    }));
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

  const addCustomGoal = useCallback((title: string, category: string) => {
    setGameState((prev) => addCustomGoalLogic(prev, title, category));
  }, []);

  const removeCustomGoal = useCallback((goalId: string) => {
    setGameState((prev) => removeCustomGoalLogic(prev, goalId));
  }, []);

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
        completeQuest,
        passQuest,
        replaceQuest,
        toggleRestDay,
        claimDailyReward,
        setPlan,
        updateProfile,
        setEquipment,
        setFrame,
        setTitle,
        setBackground,
        addCustomGoal,
        removeCustomGoal,
        characterStatus,
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
