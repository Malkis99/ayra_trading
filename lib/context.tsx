"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

interface AppContextType {
  focusMode: boolean;
  setFocusMode: (f: boolean | ((prev: boolean) => boolean)) => void;
  isAddModalOpen: boolean;
  setAddModalOpen: (o: boolean) => void;
  isSearchOpen: boolean;
  setSearchOpen: (o: boolean) => void;
  toastMessage: string | null;
  showToast: (msg: string) => void;
  userPlan: "Free" | "Pro" | "Elite";
  setUserPlan: (plan: "Free" | "Pro" | "Elite") => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [focusMode, setFocusMode] = useState<boolean>(false);
  const [isAddModalOpen, setAddModalOpen] = useState<boolean>(false);
  const [isSearchOpen, setSearchOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [userPlan, setUserPlan] = useState<"Free" | "Pro" | "Elite">("Free");

  const showToast = (msg: string) => {
    setToastMessage(msg);
  };

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 2200);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape") {
        setAddModalOpen(false);
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <AppContext.Provider
      value={{
        focusMode,
        setFocusMode,
        isAddModalOpen,
        setAddModalOpen,
        isSearchOpen,
        setSearchOpen,
        toastMessage,
        showToast,
        userPlan,
        setUserPlan,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
