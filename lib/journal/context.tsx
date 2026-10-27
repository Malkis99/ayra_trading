"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  Account,
  Trade,
  Strategy,
  NoTradeEntry,
  JournalPreferences,
  TradingPlan,
  WeekPlan,
  Note,
  StorageUsage,
  JournalRepository,
  SyncConflict,
  SyncConflictChoice,
  JournalSnapshot,
  JournalAttachment,
  AttachmentCloudState,
} from "./types";
import type { AttachmentMetadata } from "./attachments/types";
import { cleanupFiles } from "./cloud/attachment-files";
import type { InitialSyncPlan, InitialSyncResult } from "./cloud/sync-engine";
import { journalRepository } from "./cloud";
import { defaultAttachmentRepository } from "./attachments/indexeddb-repository";
import { AppStorage } from "@/lib/storage";
import { spaceTabChannel } from "@/lib/auth/space-channel";

export interface CloudStatusView {
  state: "local" | "waitingInitialSync" | "syncing" | "synced" | "offline" | "error" | "manual";
  pending: number;
  blocked: number;
  conflicts: number;
  lastError?: string;
  lastSyncAt?: string;
  /** Screenshots waiting because the cloud has no space (0005). */
  noSpace?: number;
}

const LOCAL_STATUS: CloudStatusView = { state: "local", pending: 0, blocked: 0, conflicts: 0 };

interface JournalContextType {
  primaryPropAccountId: string | null | undefined;
  setPrimaryPropAccountId: (id: string | null | undefined) => void;
  /** Journal settings of the account: default unit, main account, default session (synced like the rest). */
  preferences: JournalPreferences;
  setPreferences: (preferences: JournalPreferences) => void;
  accounts: Account[];
  trades: Trade[];
  strategies: Strategy[];
  noTrades: NoTradeEntry[];
  plans: TradingPlan[];
  weekPlans: WeekPlan[];
  notes: Note[];
  /** Screenshot descriptions (live), synced with the journal (0005). */
  attachments: JournalAttachment[];
  /** Screenshots deleted (tombstones): hidden at once, even while the file waits for «Undo». */
  deletedAttachmentIds: Set<string>;
  saveAttachmentRecord: (meta: AttachmentMetadata) => void;
  updateAttachmentRecord: (id: string, updates: Partial<Pick<AttachmentMetadata, "kind" | "caption">>) => void;
  deleteAttachmentRecord: (id: string) => boolean;
  restoreAttachmentRecord: (id: string) => void;
  /** A screenshot not on this device: its file is in the cloud / being downloaded (cloud journal only). */
  attachmentCloudState: (id: string) => AttachmentCloudState;
  /** byUser: «Download» pressed (the only way in manual mode). */
  downloadAttachment: (id: string, opts?: { byUser?: boolean }) => Promise<boolean>;
  /** The copy here does not open (broken picture): a fresh one from the cloud replaces it. */
  repairAttachment: (id: string, opts?: { byUser?: boolean }) => Promise<boolean>;
  /** Bumped when screenshot files arrive in or leave this browser (the screenshot list reloads). */
  attachmentFilesVersion: number;
  storageUsage: StorageUsage;
  lastSelectedAccountId: string | null;
  lastSelectedInstrument: string | null;
  saveAccount: (account: Account) => Account;
  archiveAccount: (id: string) => Account;
  deleteAccount: (id: string) => boolean;
  softDeleteAccount: (id: string) => { undo: () => void } | null;
  saveTrade: (trade: Trade) => Trade;
  deleteTrade: (id: string) => boolean;
  importTrades: (trades: Trade[]) => number;
  deleteTradesByBatch: (batchId: string) => number;
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
  /** Cloud sync is used for the signed-in account (flag on). Guests and flag off: false. */
  cloudActive: boolean;
  /** Records changed here and in the cloud, waiting for a choice (empty unless cloudActive). */
  syncConflicts: SyncConflict[];
  resolveSyncConflict: (table: string, id: string, choice: SyncConflictChoice) => boolean;
  /** Everything stored, tombstones included (the conflict dialog shows a record deleted here). */
  getAllRecords: () => JournalSnapshot;
  /** First upload of this device's journal (4d): needed (button shown) / started before (offer "Continue"). */
  initialSync: { needed: boolean; started: boolean };
  analyzeInitialSync: () => Promise<InitialSyncPlan>;
  runInitialSync: (opts?: { onProgress?: (done: number, total: number) => void; shouldCancel?: () => boolean }) => Promise<InitialSyncResult>;
  /** Records an empty device downloaded from the cloud by itself; shown once, then cleared. */
  cloudDownloadNotice: number | null;
  clearCloudDownloadNotice: () => void;
  /** Exchange with the cloud (the header badge, T7b-4e). */
  cloudStatus: CloudStatusView;
  /** navigator.onLine, kept up to date. */
  online: boolean;
  /** Exchange with the cloud now ("Retry"). Never throws. */
  syncNow: () => Promise<void>;
  /** Auto / manual cloud exchange on this device (signed in, flag on). */
  syncMode: "auto" | "manual";
  setSyncMode: (mode: "auto" | "manual") => void;
  /** What is still not in the cloud right now (read live, for "Sign out and delete"): changes to send and conflicts. */
  readUnsynced: () => { pending: number; conflicts: number };
  /** The first-upload window (one for the whole app: the Journal button and the header badge open it). */
  initialSyncOpen: boolean;
  /** Open the first-upload window; autoStart: upload at once when the cloud is empty (setup window, «Automatic»). */
  openInitialSync: (opts?: { autoStart?: boolean }) => void;
  initialSyncAutoStart: boolean;
  /** The server already said whether cloud sync is on (guests: true). */
  cloudFlagKnown: boolean;
  /** After the guest journal was copied into the account: reload it and queue it for the cloud. */
  adoptCopiedJournal: () => void;
  closeInitialSync: () => void;
  /** Bumped when the user asks to resolve conflicts (the header badge): the conflict dialog opens anywhere. */
  conflictDialogRequest: number;
  requestConflictDialog: () => void;
  setLastSelectedAccountId: (id: string) => void;
  setLastSelectedInstrument: (inst: string) => void;
}

const JournalContext = createContext<JournalContextType | null>(null);

const LAST_ACCOUNT_KEY = "ayra_journal_last_account";
const LAST_INSTRUMENT_KEY = "ayra_journal_last_instrument";

export function JournalProvider({
  children,
  repository = journalRepository,
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
  const [attachments, setAttachments] = useState<JournalAttachment[]>([]);
  const [deletedAttachmentIds, setDeletedAttachmentIds] = useState<Set<string>>(() => new Set());
  const [attachmentFilesVersion, setAttachmentFilesVersion] = useState(0);
  const [storageUsage, setStorageUsage] = useState<StorageUsage>({
    bytesUsed: 0,
    bytesLimit: 5 * 1024 * 1024,
    percentage: 0,
    isWarning: false,
  });
  const [primaryPropAccountId, setPrimaryPropAccountIdState] = useState<string | null | undefined>(undefined);
  const [preferences, setPreferencesState] = useState<JournalPreferences>({});
  const [lastSelectedAccountId, setLastSelectedAccountIdState] = useState<string | null>(null);
  const [lastSelectedInstrument, setLastSelectedInstrumentState] = useState<string | null>(null);
  const pendingDeletionsRef = React.useRef<Map<string, { timer: NodeJS.Timeout; account: Account }>>(new Map());

  const refresh = useCallback(() => {
    setPrimaryPropAccountIdState(repository.getPrimaryPropAccountId());
    setPreferencesState(repository.getPreferences());
    setAccounts(repository.getAccounts());
    setTrades(repository.getTrades());
    setStrategies(repository.getStrategies());
    setNoTrades(repository.getNoTrades());
    setPlans(repository.getTradingPlans());
    setWeekPlans(repository.getWeekPlans());
    setNotes(repository.getNotes());
    const shots = repository.getAttachmentRecords?.(true) ?? [];
    setAttachments(shots.filter((a) => !a.deletedAt));
    setDeletedAttachmentIds(new Set(shots.filter((a) => a.deletedAt).map((a) => a.id)));
    setStorageUsage(repository.getStorageUsage());
  }, [repository]);

  // Files of deleted screenshots leave this browser after the «Undo» pause (guests and the local journal too)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const rows = repository.getAttachmentRecords?.(true) ?? [];
    if (!rows.some((a) => a.deletedAt)) return;
    cleanupFiles(defaultAttachmentRepository, rows, Date.now())
      .then((removed) => removed && setAttachmentFilesVersion((n) => n + 1))
      .catch(() => {});
  }, [repository, attachments]);
  useEffect(() => repository.subscribeAttachmentFiles?.(() => setAttachmentFilesVersion((n) => n + 1)), [repository]);

  const saveAttachmentRecord = useCallback(
    (meta: AttachmentMetadata) => {
      repository.saveAttachmentRecord?.(meta);
      refresh();
    },
    [repository, refresh]
  );
  const updateAttachmentRecord = useCallback(
    (id: string, updates: Partial<Pick<AttachmentMetadata, "kind" | "caption">>) => {
      repository.updateAttachmentRecord?.(id, updates);
      refresh();
    },
    [repository, refresh]
  );
  const deleteAttachmentRecord = useCallback(
    (id: string) => {
      const done = repository.deleteAttachmentRecord?.(id) ?? false;
      refresh();
      return done;
    },
    [repository, refresh]
  );
  const restoreAttachmentRecord = useCallback(
    (id: string) => {
      repository.restoreAttachmentRecord?.(id);
      refresh();
    },
    [repository, refresh]
  );
  const attachmentCloudState = useCallback((id: string) => repository.attachmentCloudState?.(id) ?? "none", [repository]);
  const repairAttachment = useCallback(async (id: string, opts?: { byUser?: boolean }) => {
    const ok = (await repository.repairAttachment?.(id, opts)) ?? false;
    if (ok) setAttachmentFilesVersion((n) => n + 1);
    return ok;
  }, [repository]);
  const downloadAttachment = useCallback(async (id: string, opts?: { byUser?: boolean }) => {
    const ok = (await repository.downloadAttachment?.(id, opts)) ?? false;
    setAttachmentFilesVersion((n) => n + 1);
    return ok;
  }, [repository]);

  // Register flush handler to execute pending soft deletions for current space before switching
  useEffect(() => {
    const unregister = AppStorage.registerFlushHandler(() => {
      pendingDeletionsRef.current.forEach(({ timer, account }) => {
        clearTimeout(timer);
        try {
          repository.deleteAccount(account.id);
        } catch {}
      });
      pendingDeletionsRef.current.clear();
    });
    return unregister;
  }, [repository]);

  // Subscribe to space changes across tabs/locally
  useEffect(() => {
    const unsubscribe = spaceTabChannel.subscribe(() => {
      pendingDeletionsRef.current.forEach(({ timer }) => clearTimeout(timer));
      pendingDeletionsRef.current.clear();
      refresh();
      if (typeof window !== "undefined") {
        setLastSelectedAccountIdState(AppStorage.getItem(LAST_ACCOUNT_KEY));
        setLastSelectedInstrumentState(AppStorage.getItem(LAST_INSTRUMENT_KEY));
      }
    });
    return () => unsubscribe();
  }, [refresh]);

  // Records that arrive from the cloud (accounts with cloud sync only) refresh the screen
  useEffect(() => repository.subscribe?.(refresh), [repository, refresh]);

  // Cloud sync status and conflicts (T7b-4c): only for a signed-in account with the flag on
  const [cloudActive, setCloudActive] = useState(false);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);
  const [initialSync, setInitialSync] = useState<{ needed: boolean; started: boolean }>({ needed: false, started: false });
  const [cloudDownloadNotice, setCloudDownloadNotice] = useState<number | null>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudStatusView>(LOCAL_STATUS);
  // read at once: a child (the trade card) must not act on «auto» before the first status refresh
  const [syncMode, setSyncModeState] = useState<"auto" | "manual">(() => (typeof window === "undefined" ? "auto" : repository.getSyncMode?.() ?? "auto"));
  const [online, setOnline] = useState(true);
  const [initialSyncOpen, setInitialSyncOpen] = useState(false);
  const [initialSyncAutoStart, setInitialSyncAutoStart] = useState(false);
  const [cloudFlagKnown, setCloudFlagKnown] = useState(false);
  const [conflictDialogRequest, setConflictDialogRequest] = useState(0);
  const refreshSync = useCallback(() => {
    const status = repository.getCloudStatus?.();
    setCloudStatus(status ? { ...status, blocked: status.blocked.length } : LOCAL_STATUS);
    const active = repository.isCloudActive?.() ?? false;
    setCloudActive(active);
    setCloudFlagKnown(repository.isCloudFlagKnown?.() ?? true);
    setSyncModeState(repository.getSyncMode?.() ?? "auto");
    setSyncConflicts(active ? repository.listConflicts?.() ?? [] : []);
    setInitialSync(repository.getInitialSyncInfo?.() ?? { needed: false, started: false });
    const downloaded = repository.takeCloudDownloadNotice?.() ?? null;
    if (downloaded) setCloudDownloadNotice(downloaded);
  }, [repository]);
  // Local data appears / disappears (the first-upload button depends on it)
  useEffect(() => {
    refreshSync();
  }, [trades, accounts, notes, refreshSync]);
  const analyzeInitialSync = useCallback(() => repository.analyzeInitialSync?.() ?? Promise.reject(new Error("local")), [repository]);
  const runInitialSync = useCallback(
    async (opts?: { onProgress?: (done: number, total: number) => void; shouldCancel?: () => boolean }) => {
      if (!repository.runInitialSync) throw new Error("local");
      try {
        return await repository.runInitialSync(opts);
      } finally {
        refresh();
        refreshSync();
      }
    },
    [repository, refresh, refreshSync]
  );
  const clearCloudDownloadNotice = useCallback(() => setCloudDownloadNotice(null), []);
  const syncNow = useCallback(async () => {
    try {
      await repository.syncNow?.();
    } catch {}
    refreshSync();
  }, [repository, refreshSync]);
  const setSyncMode = useCallback(
    (mode: "auto" | "manual") => {
      repository.setSyncMode?.(mode);
      setSyncModeState(mode);
      refreshSync();
    },
    [repository, refreshSync]
  );
  const adoptCopiedJournal = useCallback(() => {
    refresh();
    repository.adoptLocalRecords?.();
    refreshSync();
  }, [repository, refresh, refreshSync]);
  const readUnsynced = useCallback(() => {
    if (!(repository.isCloudActive?.() ?? false)) return { pending: 0, conflicts: 0 };
    const s = repository.getCloudStatus?.();
    return { pending: s?.pending ?? 0, conflicts: repository.listConflicts?.().length ?? 0 };
  }, [repository]);
  const openInitialSync = useCallback((opts?: { autoStart?: boolean }) => {
    setInitialSyncAutoStart(Boolean(opts?.autoStart));
    setInitialSyncOpen(true);
  }, []);
  const closeInitialSync = useCallback(() => setInitialSyncOpen(false), []);
  const requestConflictDialog = useCallback(() => setConflictDialogRequest((n) => n + 1), []);
  // Network on / off: the badge shows it at once (the engine also retries when it comes back)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => {
      setOnline(navigator.onLine);
      refreshSync();
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [refreshSync]);
  useEffect(() => {
    refreshSync();
    const unsubscribe = repository.subscribeStatus?.(refreshSync);
    const unsubscribeSpace = spaceTabChannel.subscribe(refreshSync);
    return () => {
      unsubscribe?.();
      unsubscribeSpace();
    };
  }, [repository, refreshSync]);
  const resolveSyncConflict = useCallback(
    (table: string, id: string, choice: SyncConflictChoice) => {
      const done = repository.resolveConflict?.(table, id, choice) ?? false;
      refresh();
      refreshSync();
      return done;
    },
    [repository, refresh, refreshSync]
  );

  useEffect(() => {
    refresh();
    if (typeof window !== "undefined") {
      setLastSelectedAccountIdState(AppStorage.getItem(LAST_ACCOUNT_KEY));
      setLastSelectedInstrumentState(AppStorage.getItem(LAST_INSTRUMENT_KEY));

      // Quiet background cleanup of orphan attachments
      const currentTrades = repository.getTrades();
      const validTradeIds = new Set(currentTrades.map((t) => t.id));
      defaultAttachmentRepository.cleanupOrphans(validTradeIds).catch(() => {});
      // Descriptions of screenshots added to a trade that was never saved: deleted like their files (after 24 h)
      const anyTrade = new Set(repository.getAllRecords().trades.map((t) => t.id));
      const day = 24 * 3600 * 1000;
      for (const a of repository.getAttachmentRecords?.() ?? []) {
        if (!anyTrade.has(a.tradeId) && Date.now() - Date.parse(a.createdAt) > day) repository.deleteAttachmentRecord?.(a.id);
      }
    }
  }, [refresh, repository]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      pendingDeletionsRef.current.forEach(({ timer, account }) => {
        clearTimeout(timer);
        try {
          repository.deleteAccount(account.id);
        } catch {}
      });
      pendingDeletionsRef.current.clear();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", handleBeforeUnload);
      return () => {
        handleBeforeUnload();
        window.removeEventListener("beforeunload", handleBeforeUnload);
      };
    }
  }, [repository]);

  const setPrimaryPropAccountId = useCallback(
    (id: string | null | undefined) => {
      setPrimaryPropAccountIdState(id);
      repository.setPrimaryPropAccountId(id);
    },
    [repository]
  );

  const setPreferences = useCallback(
    (next: JournalPreferences) => {
      repository.setPreferences(next);
      setPreferencesState(repository.getPreferences());
    },
    [repository]
  );

  const setLastSelectedAccountId = useCallback((id: string) => {
    setLastSelectedAccountIdState(id);
    if (typeof window !== "undefined") {
      const activeSpaceId = AppStorage.getActiveSpaceId();
      AppStorage.guardedSetItem(LAST_ACCOUNT_KEY, id, activeSpaceId);
    }
  }, []);

  const setLastSelectedInstrument = useCallback((inst: string) => {
    setLastSelectedInstrumentState(inst);
    if (typeof window !== "undefined") {
      const activeSpaceId = AppStorage.getActiveSpaceId();
      AppStorage.guardedSetItem(LAST_INSTRUMENT_KEY, inst, activeSpaceId);
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

  const softDeleteAccount = useCallback(
    (id: string) => {
      const accountToDelete = repository.getAccount(id);
      if (!accountToDelete) return null;

      const hasTrades = repository.getTrades().some((t) => t.accountId === id);
      if (hasTrades) {
        throw new Error("Cannot delete account with trades. Archive it instead.");
      }

      setAccounts((prev) => prev.filter((a) => a.id !== id));

      const currentPrimary = repository.getPrimaryPropAccountId();
      if (currentPrimary === id) {
        setPrimaryPropAccountId(undefined);
      }

      const timer = setTimeout(() => {
        pendingDeletionsRef.current.delete(id);
        try {
          repository.deleteAccount(id);
        } catch {}
        refresh();
      }, 8000);

      pendingDeletionsRef.current.set(id, { timer, account: accountToDelete });

      const undo = () => {
        const pending = pendingDeletionsRef.current.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          pendingDeletionsRef.current.delete(id);
          refresh();
        }
      };

      return { undo };
    },
    [repository, setPrimaryPropAccountId, refresh]
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

  const importTrades = useCallback(
    (list: Trade[]) => {
      const added = repository.importTrades(list);
      refresh();
      return added;
    },
    [repository, refresh]
  );

  const deleteTradesByBatch = useCallback(
    (batchId: string) => {
      const removed = repository.deleteTradesByBatch(batchId);
      refresh();
      return removed;
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
        getAllRecords: () => repository.getAllRecords(),
        initialSync,
        analyzeInitialSync,
        runInitialSync,
        cloudDownloadNotice,
        clearCloudDownloadNotice,
        cloudStatus,
        online,
        syncNow,
        syncMode,
        setSyncMode,
        readUnsynced,
        initialSyncOpen,
        openInitialSync,
        initialSyncAutoStart,
        cloudFlagKnown,
        adoptCopiedJournal,
        closeInitialSync,
        conflictDialogRequest,
        requestConflictDialog,
        cloudActive,
        syncConflicts,
        resolveSyncConflict,
        accounts,
        trades,
        strategies,
        noTrades,
        plans,
        weekPlans,
        notes,
        attachments,
        deletedAttachmentIds,
        saveAttachmentRecord,
        updateAttachmentRecord,
        deleteAttachmentRecord,
        restoreAttachmentRecord,
        attachmentCloudState,
        downloadAttachment,
        repairAttachment,
        attachmentFilesVersion,
        storageUsage,
        primaryPropAccountId,
        setPrimaryPropAccountId,
        preferences,
        setPreferences,
        lastSelectedAccountId,
        lastSelectedInstrument,
        saveAccount,
        archiveAccount,
        deleteAccount,
        softDeleteAccount,
        saveTrade,
        deleteTrade,
        importTrades,
        deleteTradesByBatch,
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
