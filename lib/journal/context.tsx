"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { Account, Trade, StorageUsage, JournalRepository } from "./types";
import { defaultJournalRepository } from "./repository";

interface JournalContextType {
  accounts: Account[];
  trades: Trade[];
  storageUsage: StorageUsage;
  lastSelectedAccountId: string | null;
  lastSelectedInstrument: string | null;
  saveAccount: (account: Account) => Account;
  archiveAccount: (id: string) => Account;
  deleteAccount: (id: string) => boolean;
  saveTrade: (trade: Trade) => Trade;
  deleteTrade: (id: string) => boolean;
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
    setStorageUsage(repository.getStorageUsage());
  }, [repository]);

  useEffect(() => {
    refresh();
    if (typeof window !== "undefined") {
      setLastSelectedAccountIdState(localStorage.getItem(LAST_ACCOUNT_KEY));
      setLastSelectedInstrumentState(localStorage.getItem(LAST_INSTRUMENT_KEY));
    }
  }, [refresh]);

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

  return (
    <JournalContext.Provider
      value={{
        accounts,
        trades,
        storageUsage,
        lastSelectedAccountId,
        lastSelectedInstrument,
        saveAccount,
        archiveAccount,
        deleteAccount,
        saveTrade,
        deleteTrade,
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
