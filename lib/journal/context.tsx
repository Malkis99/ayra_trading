"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  Account,
  Trade,
  Strategy,
  NoTradeEntry,
  TradingPlan,
  WeekPlan,
  Note,
  StorageUsage,
  JournalRepository,
} from "./types";
import { defaultJournalRepository } from "./repository";
import { defaultAttachmentRepository } from "./attachments/indexeddb-repository";

interface JournalContextType {
  accounts: Account[];
  trades: Trade[];
  strategies: Strategy[];
  noTrades: NoTradeEntry[];
  plans: TradingPlan[];
  weekPlans: WeekPlan[];
  notes: Note[];
  storageUsage: StorageUsage;
  lastSelectedAccountId: string | null;
  lastSelectedInstrument: string | null;
  saveAccount: (account: Account) => Account;
  archiveAccount: (id: string) => Account;
  deleteAccount: (id: string) => boolean;
  saveTrade: (trade: Trade) => Trade;
  deleteTrade: (id: string) => boolean;
  saveStrategy: (strategy: Strategy) => Strategy;
  archiveStrategy: (id: string) => Strategy;
  deleteStrategy: (id: string) => boolean;
  saveNoTrade: (entry: NoTradeEntry) => NoTradeEntry;
  deleteNoTrade: (id: string) => boolean;
  getTradingPlan: (date: string) => TradingPlan | null;
  saveTradingPlan: (plan: TradingPlan) => TradingPlan;
  deleteTradingPlan: (date: string) => boolean;
  getWeekPlan: (weekStartDate: string) => WeekPlan | null;
  saveWeekPlan: (plan: WeekPlan) => WeekPlan;
  deleteWeekPlan: (weekStartDate: string) => boolean;
  getNote: (id: string) => Note | null;
  saveNote: (note: Note) => Note;
  archiveNote: (id: string) => Note;
  deleteNote: (id: string) => boolean;
  refresh: () => void;
  setLastSelectedAccountId: (id: string) => void;
  setLastSelectedInstrument: (inst: string) => void;
}

const JournalContext = createContext<JournalContextType | null>(null);

const LAST_ACCOUNT_KEY = "ayra_journal_last_account";
const LAST_INSTRUMENT_KEY = "ayra_journal_last_instrument";

export function JournalProvider({
  children,
  repository = defaultJournalRepository,
}: {
  children: React.ReactNode;
  repository?: JournalRepository;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [noTrades, setNoTrades] = useState<NoTradeEntry[]>([]);
  const [plans, setPlans] = useState<TradingPlan[]>([]);
  const [weekPlans, setWeekPlans] = useState<WeekPlan[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [storageUsage, setStorageUsage] = useState<StorageUsage>({
    bytesUsed: 0,
    bytesLimit: 5 * 1024 * 1024,
    percentage: 0,
    isWarning: false,
  });
  const [lastSelectedAccountId, setLastSelectedAccountIdState] = useState<string | null>(null);
  const [lastSelectedInstrument, setLastSelectedInstrumentState] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setAccounts(repository.getAccounts());
    setTrades(repository.getTrades());
    setStrategies(repository.getStrategies());
    setNoTrades(repository.getNoTrades());
    setPlans(repository.getTradingPlans());
    setWeekPlans(repository.getWeekPlans());
    setNotes(repository.getNotes());
    setStorageUsage(repository.getStorageUsage());
  }, [repository]);

  useEffect(() => {
    refresh();
    if (typeof window !== "undefined") {
      setLastSelectedAccountIdState(localStorage.getItem(LAST_ACCOUNT_KEY));
      setLastSelectedInstrumentState(localStorage.getItem(LAST_INSTRUMENT_KEY));

      // Quiet background cleanup of orphan attachments
      const currentTrades = repository.getTrades();
      const validTradeIds = new Set(currentTrades.map((t) => t.id));
      defaultAttachmentRepository.cleanupOrphans(validTradeIds).catch(() => {});
    }
  }, [refresh, repository]);

  const setLastSelectedAccountId = useCallback((id: string) => {
    setLastSelectedAccountIdState(id);
    if (typeof window !== "undefined") {
      localStorage.setItem(LAST_ACCOUNT_KEY, id);
    }
  }, []);

  const setLastSelectedInstrument = useCallback((inst: string) => {
    setLastSelectedInstrumentState(inst);
    if (typeof window !== "undefined") {
      localStorage.setItem(LAST_INSTRUMENT_KEY, inst);
    }
  }, []);

  const saveAccount = useCallback(
    (account: Account) => {
      const saved = repository.saveAccount(account);
      refresh();
      return saved;
    },
    [repository, refresh]
  );

  const archiveAccount = useCallback(
    (id: string) => {
      const archived = repository.archiveAccount(id);
      refresh();
      return archived;
    },
    [repository, refresh]
  );

  const deleteAccount = useCallback(
    (id: string) => {
      const result = repository.deleteAccount(id);
      refresh();
      return result;
    },
    [repository, refresh]
  );

  const saveTrade = useCallback(
    (trade: Trade) => {
      const saved = repository.saveTrade(trade);
      setLastSelectedAccountId(trade.accountId);
      setLastSelectedInstrument(trade.instrument);
      refresh();
      return saved;
    },
    [repository, setLastSelectedAccountId, setLastSelectedInstrument, refresh]
  );

  const deleteTrade = useCallback(
    (id: string) => {
      const result = repository.deleteTrade(id);
      refresh();
      return result;
    },
    [repository, refresh]
  );

  const saveStrategy = useCallback(
    (strategy: Strategy) => {
      const saved = repository.saveStrategy(strategy);
      refresh();
      return saved;
    },
    [repository, refresh]
  );

  const archiveStrategy = useCallback(
    (id: string) => {
      const archived = repository.archiveStrategy(id);
      refresh();
      return archived;
    },
    [repository, refresh]
  );

  const deleteStrategy = useCallback(
    (id: string) => {
      const result = repository.deleteStrategy(id);
      refresh();
      return result;
    },
    [repository, refresh]
  );

  const saveNoTrade = useCallback(
    (entry: NoTradeEntry) => {
      const saved = repository.saveNoTrade(entry);
      refresh();
      return saved;
    },
    [repository, refresh]
  );

  const deleteNoTrade = useCallback(
    (id: string) => {
      const result = repository.deleteNoTrade(id);
      refresh();
      return result;
    },
    [repository, refresh]
  );

  const getTradingPlan = useCallback(
    (date: string) => {
      return repository.getTradingPlan(date);
    },
    [repository]
  );

  const saveTradingPlan = useCallback(
    (plan: TradingPlan) => {
      const saved = repository.saveTradingPlan(plan);
      refresh();
      return saved;
    },
    [repository, refresh]
  );

  const deleteTradingPlan = useCallback(
    (date: string) => {
      const result = repository.deleteTradingPlan(date);
      refresh();
      return result;
    },
    [repository, refresh]
  );

  const getWeekPlan = useCallback(
    (weekStartDate: string) => {
      return repository.getWeekPlan(weekStartDate);
    },
    [repository]
  );

  const saveWeekPlan = useCallback(
    (plan: WeekPlan) => {
      const saved = repository.saveWeekPlan(plan);
      refresh();
      return saved;
    },
    [repository, refresh]
  );

  const deleteWeekPlan = useCallback(
    (weekStartDate: string) => {
      const result = repository.deleteWeekPlan(weekStartDate);
      refresh();
      return result;
    },
    [repository, refresh]
  );

  const getNote = useCallback(
    (id: string) => {
      return repository.getNote(id);
    },
    [repository]
  );

  const saveNote = useCallback(
    (note: Note) => {
      const saved = repository.saveNote(note);
      refresh();
      return saved;
    },
    [repository, refresh]
  );

  const archiveNote = useCallback(
    (id: string) => {
      const archived = repository.archiveNote(id);
      refresh();
      return archived;
    },
    [repository, refresh]
  );

  const deleteNote = useCallback(
    (id: string) => {
      const result = repository.deleteNote(id);
      refresh();
      return result;
    },
    [repository, refresh]
  );

  return (
    <JournalContext.Provider
      value={{
        accounts,
        trades,
        strategies,
        noTrades,
        plans,
        weekPlans,
        notes,
        storageUsage,
        lastSelectedAccountId,
        lastSelectedInstrument,
        saveAccount,
        archiveAccount,
        deleteAccount,
        saveTrade,
        deleteTrade,
        saveStrategy,
        archiveStrategy,
        deleteStrategy,
        saveNoTrade,
        deleteNoTrade,
        getTradingPlan,
        saveTradingPlan,
        deleteTradingPlan,
        getWeekPlan,
        saveWeekPlan,
        deleteWeekPlan,
        getNote,
        saveNote,
        archiveNote,
        deleteNote,
        refresh,
        setLastSelectedAccountId,
        setLastSelectedInstrument,
      }}
    >
      {children}
    </JournalContext.Provider>
  );
}

export function useJournal(): JournalContextType {
  const context = useContext(JournalContext);
  if (!context) {
    throw new Error("useJournal must be used within a JournalProvider");
  }
  return context;
}
