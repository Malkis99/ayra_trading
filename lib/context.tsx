"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { Language, Dictionary } from "@/lib/i18n/types";
import { getDictionary } from "@/lib/i18n";
import { AppStorage } from "@/lib/storage";
import { LOCALE_CHOICE_EVENT } from "@/lib/profile-timezone";
import { pushToast, shiftToast, toastDuration, type ToastItem, type ToastLevel } from "@/lib/toast-queue";

interface AppContextType {
  lang: Language;
  setLanguage: (l: Language, origin?: "user" | "cloud") => void;
  dict: Dictionary;
  focusMode: boolean;
  setFocusMode: (f: boolean | ((prev: boolean) => boolean)) => void;
  isAddModalOpen: boolean;
  setAddModalOpen: (o: boolean) => void;
  addModalTab: string;
  setAddModalTab: (tab: string) => void;
  openAddModal: (tab?: string) => void;
  isAddTradeModalOpen: boolean;
  setAddTradeModalOpen: (o: boolean) => void;
  isNoteModalOpen: boolean;
  setNoteModalOpen: (o: boolean) => void;
  noteModalLinks: any;
  openNoteModal: (links?: any, templateKey?: any) => void;
  isSearchOpen: boolean;
  setSearchOpen: (o: boolean) => void;
  toastMessage: string | null;
  toastActionLabel: string | null;
  onToastAction: (() => void) | null;
  /** "risk" for a trading-risk warning (a prop limit): a reward or other message never replaces it (lib/toast-queue). */
  toastLevel: ToastLevel;
  /** Closes the message on screen (the next waiting one, if any, comes up). */
  dismissToast: () => void;
  showToast: (msg: string, actionLabel?: string, onAction?: () => void, level?: ToastLevel) => void;
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
  const [isAddTradeModalOpen, setAddTradeModalOpen] = useState<boolean>(false);
  const [isNoteModalOpen, setNoteModalOpen] = useState<boolean>(false);
  const [noteModalLinks, setNoteModalLinks] = useState<any>(undefined);
  const [noteModalTemplateKey, setNoteModalTemplateKey] = useState<any>(undefined);
  const [isSearchOpen, setSearchOpen] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);
  const currentToast = toasts[0] ?? null;
  const [userPlan, setUserPlan] = useState<"Free" | "Pro" | "Elite">("Free");

  const dict = getDictionary(lang);

  const setLanguage = useCallback((newLang: Language, origin: "user" | "cloud" = "user") => {
    setLangState(newLang);
    try {
      AppStorage.setItem("ayra_lang", newLang);
      document.cookie = `NEXT_LOCALE=${newLang}; path=/; max-age=31536000; SameSite=Lax`;
      document.documentElement.lang = newLang;
    } catch {
      // ignore storage errors
    }
    if (origin === "user") window.dispatchEvent(new CustomEvent(LOCALE_CHOICE_EVENT, { detail: newLang }));
  }, []);

  useEffect(() => {
    try {
      const savedLang = AppStorage.getItem("ayra_lang") as Language | null;
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

  const openNoteModal = (links?: any, templateKey?: any) => {
    setNoteModalLinks(links);
    setNoteModalTemplateKey(templateKey);
    setNoteModalOpen(true);
  };

  const showToast = useCallback((msg: string, actionLabel?: string, onAction?: () => void, level: ToastLevel = "info") => {
    const item: ToastItem = { id: ++toastSeq.current, message: msg, level, actionLabel: actionLabel || null, onAction: onAction || null };
    setToasts((q) => pushToast(q, item));
  }, []);
  const dismissToast = useCallback(() => {
    setToasts((q) => (q[0] ? shiftToast(q, q[0].id) : q));
  }, []);

  // each message keeps its own time on screen (a warning longer); then the next waiting one comes up
  useEffect(() => {
    if (!currentToast) return;
    const id = currentToast.id;
    const timer = setTimeout(() => setToasts((q) => shiftToast(q, id)), toastDuration(currentToast));
    return () => clearTimeout(timer);
  }, [currentToast]);

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
        isAddTradeModalOpen,
        setAddTradeModalOpen,
        isNoteModalOpen,
        setNoteModalOpen,
        noteModalLinks,
        openNoteModal,
        isSearchOpen,
        setSearchOpen,
        toastMessage: currentToast?.message ?? null,
        toastActionLabel: currentToast?.actionLabel ?? null,
        onToastAction: currentToast?.onAction ?? null,
        toastLevel: currentToast?.level ?? "info",
        dismissToast,
        showToast,
        userPlan,
        setUserPlan,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

/** Like useApp, but returns undefined outside AppProvider (shared UI components, unit tests). */
export function useOptionalApp(): AppContextType | undefined {
  return useContext(AppContext);
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
