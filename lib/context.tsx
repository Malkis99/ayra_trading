"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { Language, Dictionary } from "@/lib/i18n/types";
import { getDictionary } from "@/lib/i18n";

interface AppContextType {
  lang: Language;
  setLanguage: (l: Language) => void;
  dict: Dictionary;
  focusMode: boolean;
  setFocusMode: (f: boolean | ((prev: boolean) => boolean)) => void;
  isAddModalOpen: boolean;
  setAddModalOpen: (o: boolean) => void;
  addModalTab: string;
  setAddModalTab: (tab: string) => void;
  openAddModal: (tab?: string) => void;
  isSearchOpen: boolean;
  setSearchOpen: (o: boolean) => void;
  toastMessage: string | null;
  showToast: (msg: string) => void;
  userPlan: "Free" | "Pro" | "Elite";
  setUserPlan: (plan: "Free" | "Pro" | "Elite") => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({
  children,
  initialLang = "ru",
}: {
  children: React.ReactNode;
  initialLang?: Language;
}) {
  const [lang, setLangState] = useState<Language>(initialLang);
  const [focusMode, setFocusMode] = useState<boolean>(false);
  const [isAddModalOpen, setAddModalOpen] = useState<boolean>(false);
  const [addModalTab, setAddModalTab] = useState<string>("grid");
  const [isSearchOpen, setSearchOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [userPlan, setUserPlan] = useState<"Free" | "Pro" | "Elite">("Free");

  const dict = getDictionary(lang);

  const setLanguage = (newLang: Language) => {
    setLangState(newLang);
    try {
      localStorage.setItem("ayra_lang", newLang);
      document.cookie = `NEXT_LOCALE=${newLang}; path=/; max-age=31536000; SameSite=Lax`;
      document.documentElement.lang = newLang;
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    try {
      const savedLang = localStorage.getItem("ayra_lang") as Language | null;
      if (savedLang && (savedLang === "ru" || savedLang === "en")) {
        setLangState(savedLang);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const openAddModal = (tab: string = "grid") => {
    setAddModalTab(tab);
    setAddModalOpen(true);
  };

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
        lang,
        setLanguage,
        dict,
        focusMode,
        setFocusMode,
        isAddModalOpen,
        setAddModalOpen,
        addModalTab,
        setAddModalTab,
        openAddModal,
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
