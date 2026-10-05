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
  addChronicleEvent,
} from "@/lib/game";

const STORAGE_KEY = "ayra_demo_v1";

interface GameContextType {
  gameState: GameState;
  isLoaded: boolean;
  completeQuest: (index: number, title: string) => { leveledUp: boolean; newLevel?: number };
  claimDailyReward: () => number;
  setPlan: (plan: "Free" | "Pro" | "Elite") => void;
  updateProfile: (name: string, bio: string) => void;
  setEquipment: (equipment: Record<string, number>) => void;
  setFrame: (frame: number) => void;
  setTitle: (title: number) => void;
  setBackground: (bg: number) => void;
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
        const parsed = JSON.parse(saved) as GameState;
        // Merge with initial to preserve any missing keys
        const merged: GameState = { ...INITIAL_GAME_STATE, ...parsed };
        const resetted = checkAndApplyDateResets(merged, new Date());
        setGameState(resetted);
      } else {
        const resetted = checkAndApplyDateResets(INITIAL_GAME_STATE, new Date());
        setGameState(resetted);
      }
    } catch {
      // Fallback to default state on parse error
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
    (index: number, title: string) => {
      let result = { leveledUp: false, newLevel: undefined as number | undefined };
      setGameState((prev) => {
        const res = completeQuestLogic(prev, index, title, new Date());
        result = { leveledUp: res.leveledUp, newLevel: res.newLevel };
        return res.state;
      });
      return result;
    },
    []
  );

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

  const completedTodayCount = Object.keys(gameState.completedQuestsToday).length;
  const characterStatus = getCharacterStatus(completedTodayCount);

  return (
    <GameContext.Provider
      value={{
        gameState,
        isLoaded,
        completeQuest,
        claimDailyReward,
        setPlan,
        updateProfile,
        setEquipment,
        setFrame,
        setTitle,
        setBackground,
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
