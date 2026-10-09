"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { TabHeader } from "@/components/TabHeader";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { Account, Trade, AccountType, AccountCurrency } from "@/lib/journal/types";
import { calculatePnlPercent } from "@/lib/journal/calc";
import { exportProfileDataJSON, calculateJournalStats } from "@/lib/stats";
import { AddTradeModal } from "@/components/AddTradeModal";
import { DashboardTab } from "@/components/journal/DashboardTab";
import { CalendarTab } from "@/components/journal/CalendarTab";
import { ReportsTab } from "@/components/journal/ReportsTab";
import { StrategiesTab } from "@/components/journal/StrategiesTab";
import { NoTradeTab } from "@/components/journal/NoTradeTab";
import { TradingPlanTab } from "@/components/journal/TradingPlanTab";
import { NotesTab } from "@/components/journal/NotesTab";
import { calculateProcessScore, getProcessScoreCategory } from "@/lib/journal/process-score";
import { getDemoTrades, DEMO_ACCOUNT } from "@/lib/journal/demo-trades";
import { AttachmentManager } from "@/components/journal/AttachmentManager";
import { Plus, Download, AlertTriangle, Search, Trash2, Edit2, ShieldAlert, RefreshCw, FileText, Camera } from "lucide-react";
import { PropRulesModal } from "@/components/journal/PropRulesModal";
import { PropRulesCard } from "@/components/journal/PropRulesCard";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { recordPropRulesSaved } from "@/lib/game";
import { calculatePropMetrics, resolvePrimaryPropAccount } from "@/lib/journal/prop";
import { evaluatePropToastAlert } from "@/lib/journal/prop-toast";

export default function JournalPage() {
  const { dict, lang, showToast, setAddTradeModalOpen, openNoteModal } = useApp();
  const { gameState, recordNoTrade } = useGame();
  const {
    accounts,
    trades,
    strategies,
    noTrades,
    notes,
    storageUsage,
    saveAccount,
    primaryPropAccountId,
    setPrimaryPropAccountId,
    archiveAccount,
    deleteAccount,
    softDeleteAccount,
    saveTrade,
    deleteTrade,
    saveStrategy,
    archiveStrategy,
    deleteStrategy,
    saveNoTrade,
    deleteNoTrade,
  } = useJournal();

  // Subtab in Trades tab: 'trades' | 'noTrade'
  const [tradesSubtab, setTradesSubtab] = useState<"trades" | "noTrade">("trades");

  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<number>(0); // Default to Dashboard (0)

  useEffect(() => {
    const getTabFromUrl = () => {
      if (typeof window !== "undefined" && window.location.search) {
        return new URLSearchParams(window.location.search).get("tab");
      }
      return searchParams.get("tab");
    };

    const tabParam = getTabFromUrl();
    if (tabParam === "accounts") {
      setActiveTab(1);
    } else if (tabParam === "dashboard") {
      setActiveTab(0);
    } else if (tabParam === "reports") {
      setActiveTab(2);
    } else if (tabParam === "plan") {
      setActiveTab(3);
    } else if (tabParam === "strategies") {
      setActiveTab(4);
    }
  }, [searchParams]);

  // Demo Mode State
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);

  // Active trades and accounts (demo vs real)
  const activeTrades = useMemo(() => {
    return isDemoMode ? getDemoTrades() : trades;
  }, [isDemoMode, trades]);

  const activeAccounts = useMemo(() => {
    return isDemoMode ? [DEMO_ACCOUNT, ...accounts] : accounts;
  }, [isDemoMode, accounts]);

  // Unit Switcher: 'R' | 'money' | 'percent'
  const [unit, setUnit] = useState<"R" | "money" | "percent">("R");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedUnit = localStorage.getItem("ayra_journal_unit") as "R" | "money" | "percent";
      if (savedUnit && ["R", "money", "percent"].includes(savedUnit)) {
        setUnit(savedUnit);
      }
    }
  }, []);

  const handleUnitChange = (newUnit: "R" | "money" | "percent") => {
    setUnit(newUnit);
    if (typeof window !== "undefined") {
      localStorage.setItem("ayra_journal_unit", newUnit);
    }
  };

  // Trade Filters for Trades Tab (Tab 1)
  const [filterAccount, setFilterAccount] = useState<string>("all");
  const [filterPeriod, setFilterPeriod] = useState<string>("all");
  const [filterInstrument, setFilterInstrument] = useState<string>("");
  const [filterResult, setFilterResult] = useState<string>("all");
  const [filterDirection, setFilterDirection] = useState<string>("all");
  const [filterScreenshot, setFilterScreenshot] = useState<string>("all");
  const [page, setPage] = useState<number>(1);

  // Trade Detail / Edit / Delete state
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [deletingTradeId, setDeleteTradeId] = useState<string | null>(null);
  const [addTradeInitialDate, setAddTradeInitialDate] = useState<string | undefined>(undefined);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // Account Form & Prop Rules Modal state
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [accName, setAccName] = useState("");
  const [accType, setAccType] = useState<AccountType>("personal");
  const [accCurrency, setAccCurrency] = useState<AccountCurrency>("USD");
  const [accStartBalance, setAccStartBalance] = useState("");
  const [accountErrorMessage, setAccountErrorMessage] = useState<string | null>(null);

  const [propRulesModalAccount, setPropRulesModalAccount] = useState<Account | null>(null);
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    description: React.ReactNode;
    warningNote?: string;
    confirmLabel: string;
    cancelLabel: string;
    matchText?: string;
    isDanger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const resolvedPrimaryPropAccount = useMemo(() => {
    return resolvePrimaryPropAccount(accounts, primaryPropAccountId);
  }, [accounts, primaryPropAccountId]);

  // Toggle Primary Prop Account
  const handleTogglePrimaryProp = (accountIdToSet: string) => {
    const isCurrentlyPrimary =
      primaryPropAccountId === accountIdToSet ||
      (resolvedPrimaryPropAccount?.id === accountIdToSet && primaryPropAccountId !== null);

    if (isCurrentlyPrimary) {
      setPrimaryPropAccountId(null);
    } else {
      setPrimaryPropAccountId(accountIdToSet);
    }
    showToast(dict.journal.accountsTab.accountSavedToast);
  };

  // Save Prop Rules from modal
  const handleSavePropRules = (updatedAccount: Account) => {
    saveAccount(updatedAccount);
    const { newlyUnlocked } = recordPropRulesSaved(gameState);
    if (newlyUnlocked.includes("firstPropRules")) {
      showToast(dict.profile.achievements.firstPropRules);
    } else {
      showToast(dict.journal.accountsTab.accountSavedToast);
    }
  };

  const tabs = [
    dict.journal.tabs.dashboard,
    dict.journal.tabs.trades,
    dict.journal.tabs.reports,
    dict.journal.tabs.tradingPlan,
    dict.journal.tabs.strategies,
    dict.journal.tabs.accounts,
    dict.journal.tabs.notes,
  ];

  // Export JSON (guaranteed to export only real journal data, never demo data)
  const handleExportJSON = () => {
    const jsonStr = exportProfileDataJSON(gameState, { accounts, trades });
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateStr = new Date().toISOString().split("T")[0];
    link.href = url;
    link.download = `ayra-profile-${gameState.name}-${dateStr}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(dict.profile.statsTab.downloadedToast);
  };

  // Filter Trades for Trades Tab
  const filteredTrades = useMemo(() => {
    const nowMs = Date.now();

    return activeTrades.filter((t) => {
      if (filterAccount !== "all" && t.accountId !== filterAccount) return false;
      if (filterResult !== "all" && t.result !== filterResult) return false;
      if (filterDirection !== "all" && t.direction !== filterDirection) return false;

      const hasScreenshots = Boolean(t.attachmentIds && t.attachmentIds.length > 0);
      if (filterScreenshot === "with" && !hasScreenshots) return false;
      if (filterScreenshot === "without" && hasScreenshots) return false;

      if (filterInstrument.trim()) {
        const query = filterInstrument.trim().toUpperCase();
        if (!t.instrument.toUpperCase().includes(query)) return false;
      }

      if (filterPeriod !== "all") {
        const tradeMs = new Date(t.openedAt || t.createdAt).getTime();
        const diffDays = (nowMs - tradeMs) / (1000 * 60 * 60 * 24);
        if (filterPeriod === "7d" && diffDays > 7) return false;
        if (filterPeriod === "30d" && diffDays > 30) return false;
        if (filterPeriod === "90d" && diffDays > 90) return false;
      }

      return true;
    }).sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
  }, [activeTrades, filterAccount, filterPeriod, filterInstrument, filterResult, filterDirection, filterScreenshot]);

  // Paginated Trades (50 per page)
  const pageSize = 50;
  const paginatedTrades = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredTrades.slice(start, start + pageSize);
  }, [filteredTrades, page]);

  const totalPages = Math.ceil(filteredTrades.length / pageSize) || 1;

  // Formatting trade result values
  const formatTradeValue = (trade: Trade) => {
    const acc = activeAccounts.find((a) => a.id === trade.accountId);
    const curr = acc?.currency || "USD";

    if (unit === "R") {
      if (trade.rMultiple != null) {
        const val = trade.rMultiple;
        return val > 0 ? `+${val.toFixed(2)} R` : `${val.toFixed(2)} R`;
      }
      return "—";
    }

    if (unit === "percent") {
      const startBal = acc?.startBalance;
      const pct = calculatePnlPercent(trade.pnlMoney, startBal);
      if (pct != null) {
        return pct > 0 ? `+${pct.toFixed(2)}%` : `${pct.toFixed(2)}%`;
      }
      return "—";
    }

    if (trade.pnlMoney != null) {
      const val = trade.pnlMoney;
      try {
        const formatted = new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-US", {
          style: "currency",
          currency: curr,
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }).format(val);
        return val > 0 ? `+${formatted}` : formatted;
      } catch {
        return `${val} ${curr}`;
      }
    }

    return "—";
  };

  useEffect(() => {
    if (deletingTradeId && cancelButtonRef.current) {
      cancelButtonRef.current.focus();
    }
  }, [deletingTradeId]);

  const handleDeleteTradeConfirm = () => {
    if (deletingTradeId) {
      const tradeToDelete = trades.find((t) => t.id === deletingTradeId);
      const affectedAccount = tradeToDelete ? accounts.find((a) => a.id === tradeToDelete.accountId) : null;
      const prevMetrics = affectedAccount?.propRules ? calculatePropMetrics(affectedAccount, trades) : undefined;

      deleteTrade(deletingTradeId);
      setDeleteTradeId(null);
      setSelectedTrade(null);
      showToast(dict.journal.addTradeModal.tradeDeletedToast);

      if (affectedAccount && affectedAccount.propRules) {
        const remainingTrades = trades.filter((t) => t.id !== deletingTradeId);
        const currMetrics = calculatePropMetrics(affectedAccount, remainingTrades);
        const { alert } = evaluatePropToastAlert(affectedAccount, prevMetrics, currMetrics);
        if (alert) {
          let text = "";
          const roundedPct = Math.round(alert.usedPct);
          if (alert.limitType === "dailyLoss") {
            if (alert.level === "caution") text = dict.journal.propRules.toasts.dailyLossCaution.replace("{pct}", String(roundedPct));
            else if (alert.level === "close") text = dict.journal.propRules.toasts.dailyLossClose.replace("{pct}", String(roundedPct));
            else if (alert.level === "reached") text = dict.journal.propRules.toasts.dailyLossReached;
          } else if (alert.limitType === "totalDrawdown") {
            if (alert.level === "caution") text = dict.journal.propRules.toasts.totalDrawdownCaution.replace("{pct}", String(roundedPct));
            else if (alert.level === "close") text = dict.journal.propRules.toasts.totalDrawdownClose.replace("{pct}", String(roundedPct));
            else if (alert.level === "reached") text = dict.journal.propRules.toasts.totalDrawdownReached;
          }
          if (text) showToast(text);
        }
      }
    }
  };

  const handleOpenAccountModal = (account?: Account) => {
    setEditingAccount(account || null);
    setAccName(account?.name || "");
    setAccType(account?.type || "personal");
    setAccCurrency(account?.currency || "USD");
    setAccStartBalance(account?.startBalance != null ? String(account.startBalance) : "");
    setAccountErrorMessage(null);
    setIsAccountModalOpen(true);
  };

  const handleSaveAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newAcc: Account = {
      id: editingAccount?.id || `acc_${Date.now()}`,
      name: accName.trim() || null,
      type: accType,
      currency: accCurrency,
      startBalance: accStartBalance ? parseFloat(accStartBalance) || undefined : undefined,
      platform: "manual",
      archivedAt: editingAccount?.archivedAt,
      createdAt: editingAccount?.createdAt || new Date().toISOString(),
    };
    saveAccount(newAcc);
    setIsAccountModalOpen(false);
    showToast(dict.journal.accountsTab.accountSavedToast);
  };

  const handleArchiveAccount = (id: string) => {
    const acc = accounts.find((a) => a.id === id);
    const accName = acc?.name || dict.journal.accountsTab.mainAccountDefaultName;

    setConfirmConfig({
      isOpen: true,
      title: dict.confirmDialog.account.archiveTitle,
      description: dict.confirmDialog.account.archiveDesc.replace("{name}", accName),
      confirmLabel: dict.confirmDialog.archive,
      cancelLabel: dict.confirmDialog.cancel,
      isDanger: false,
      onConfirm: () => {
        archiveAccount(id);
        showToast(dict.journal.accountsTab.accountArchivedToast);
        setConfirmConfig(null);
      },
    });
  };

  const handleDeleteAccountAction = (account: Account) => {
    const accountTradesCount = trades.filter((t) => t.accountId === account.id).length;

    if (accountTradesCount > 0) {
      setConfirmConfig({
        isOpen: true,
        title: dict.confirmDialog.account.hasTradesTitle,
        description: dict.confirmDialog.account.hasTradesDesc
          .replace("{name}", account.name || dict.journal.accountsTab.mainAccountDefaultName)
          .replace("{count}", String(accountTradesCount)),
        confirmLabel: dict.confirmDialog.archive,
        cancelLabel: dict.confirmDialog.cancel,
        isDanger: false,
        onConfirm: () => {
          archiveAccount(account.id);
          showToast(dict.journal.accountsTab.accountArchivedToast);
          setConfirmConfig(null);
        },
      });
      return;
    }

    const isPropWithRules = account.type === "prop" && Boolean(account.propRules);
    const accName = account.name || dict.journal.accountsTab.mainAccountDefaultName;

    setConfirmConfig({
      isOpen: true,
      title: dict.confirmDialog.account.deleteTitle,
      description: dict.confirmDialog.account.deleteDesc.replace("{name}", accName),
      warningNote: isPropWithRules ? dict.confirmDialog.account.deletePropRulesWarning : undefined,
      matchText: isPropWithRules ? accName : undefined,
      confirmLabel: dict.confirmDialog.delete,
      cancelLabel: dict.confirmDialog.cancel,
      isDanger: true,
      onConfirm: () => {
        setConfirmConfig(null);
        const res = softDeleteAccount(account.id);
        if (res) {
          showToast(
            dict.confirmDialog.undoToast.replace("{name}", accName),
            dict.confirmDialog.undo,
            () => {
              res.undo();
              showToast(dict.confirmDialog.undoRestoredToast);
            }
          );
        }
      },
    });
  };

  const handleAddTradeForDate = (dateStr: string) => {
    const dateIso = `${dateStr}T12:00`;
    setAddTradeInitialDate(dateIso);
    setAddTradeModalOpen(true);
  };

  const handleSaveNoTradeAction = (entry: any) => {
    const saved = saveNoTrade(entry);
    const rewardRes = recordNoTrade(saved, noTrades);

    if (rewardRes.xpAwarded > 0) {
      showToast(dict.journal.noTrade.savedToast);
    } else {
      showToast(dict.journal.noTrade.duplicateToast);
    }
  };

  const handleRecalculateProcessScore = (trade: Trade) => {
    const currentStrategy = strategies.find((s) => s.id === trade.strategyId) || null;
    const currentAccount = accounts.find((a) => a.id === trade.accountId) || null;
    const nowIso = new Date().toISOString();

    const psRes = calculateProcessScore(trade, currentStrategy, currentAccount, nowIso);
    const updatedTrade: Trade = {
      ...trade,
      strategyVersion: currentStrategy ? currentStrategy.version : trade.strategyVersion,
      processScore: psRes.score,
      processScoreSnapshot: psRes.snapshot,
      updatedAt: nowIso,
    };

    saveTrade(updatedTrade);
    setSelectedTrade(updatedTrade);
    showToast(dict.journal.recalculatedToast);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-tx">{dict.journal.title}</h1>
          <p className="text-xs text-mu mt-0.5">{dict.journal.subtitle}</p>
        </div>
        <button
          onClick={() => {
            setAddTradeInitialDate(undefined);
            setAddTradeModalOpen(true);
          }}
          className="btn text-xs py-2 px-4 flex items-center gap-1.5 self-start sm:self-auto font-semibold"
        >
          <Plus size={16} />
          <span>{dict.home.quickActions.addTrade}</span>
        </button>
      </div>

      {/* Storage Usage Soft Warning Banner (>80%) */}
      {storageUsage.isWarning && (
        <div className="p-3 bg-amber-500/15 border border-amber-500/40 rounded-xl text-xs text-amber-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-400 flex-none" />
            <span>
              {dict.journal.storageWarning.replace(
                "{percent}",
                storageUsage.percentage.toFixed(0)
              )}
            </span>
          </div>
          <button
            onClick={handleExportJSON}
            className="btn-ghost py-1 px-3 text-xs flex items-center gap-1.5 flex-none"
          >
            <Download size={14} />
            <span>{dict.journal.exportBtn}</span>
          </button>
        </div>
      )}

      {/* Single-line Tabs */}
      <TabHeader tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* TAB 0: DASHBOARD */}
      {activeTab === 0 && (
        <div className="space-y-6">
          <DashboardTab
            trades={activeTrades}
            accounts={activeAccounts}
            unit={unit}
            onUnitChange={handleUnitChange}
            onGoToTrades={() => setActiveTab(1)}
            isDemoMode={isDemoMode}
            onEnableDemoMode={() => setIsDemoMode(true)}
            onExitDemoMode={() => setIsDemoMode(false)}
            dict={dict}
            lang={lang}
          />

          {/* Embedded Calendar Section */}
          <div className="pt-2 border-t border-line">
            <CalendarTab
              trades={activeTrades}
              accounts={activeAccounts}
              unit={unit}
              onAddTradeForDate={handleAddTradeForDate}
              dict={dict}
              lang={lang}
            />
          </div>
        </div>
      )}

      {/* TAB 1: TRADES */}
      {activeTab === 1 && (
        <div className="space-y-4">
          {/* Subtab Switcher: Trades / No-Trade */}
          <div className="flex rounded-xl bg-s2 border border-line p-1 max-w-xs text-xs font-semibold">
            <button
              onClick={() => setTradesSubtab("trades")}
              className={`flex-1 py-1.5 px-3 rounded-lg transition-colors ${
                tradesSubtab === "trades"
                  ? "bg-vi text-white shadow"
                  : "text-mu hover:text-tx"
              }`}
            >
              {dict.journal.tradesSubtab}
            </button>
            <button
              onClick={() => setTradesSubtab("noTrade")}
              className={`flex-1 py-1.5 px-3 rounded-lg transition-colors ${
                tradesSubtab === "noTrade"
                  ? "bg-vi text-white shadow"
                  : "text-mu hover:text-tx"
              }`}
            >
              {dict.journal.noTradeSubtab} ({noTrades.length})
            </button>
          </div>

          {tradesSubtab === "noTrade" ? (
            <NoTradeTab
              noTrades={noTrades}
              accounts={accounts}
              onSaveNoTrade={handleSaveNoTradeAction}
              onDeleteNoTrade={deleteNoTrade}
              dict={dict}
              lang={lang}
            />
          ) : (
        <div className="space-y-4">
          <div className="card p-3 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-mu">
                  {dict.journal.tradesTab.unitSwitcher}
                </span>
                <div className="flex rounded-lg border border-line bg-s2 p-0.5 text-xs">
                  <button
                    onClick={() => handleUnitChange("R")}
                    className={`px-3 py-1 font-bold rounded-md transition-colors ${
                      unit === "R" ? "bg-vi text-white" : "text-mu hover:text-tx"
                    }`}
                  >
                    R
                  </button>
                  <button
                    onClick={() => handleUnitChange("money")}
                    className={`px-3 py-1 font-bold rounded-md transition-colors ${
                      unit === "money" ? "bg-vi text-white" : "text-mu hover:text-tx"
                    }`}
                  >
                    $
                  </button>
                  <button
                    onClick={() => handleUnitChange("percent")}
                    className={`px-3 py-1 font-bold rounded-md transition-colors ${
                      unit === "percent" ? "bg-vi text-white" : "text-mu hover:text-tx"
                    }`}
                  >
                    %
                  </button>
                </div>
              </div>

              <div className="relative flex-1 max-w-xs">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
                <input
                  type="text"
                  value={filterInstrument}
                  onChange={(e) => {
                    setFilterInstrument(e.target.value);
                    setPage(1);
                  }}
                  placeholder={dict.journal.tradesTab.searchPlaceholder}
                  className="input text-xs pl-8 w-full"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              <select
                value={filterAccount}
                onChange={(e) => {
                  setFilterAccount(e.target.value);
                  setPage(1);
                }}
                className="input text-xs"
              >
                <option value="all">{dict.journal.tradesTab.filterAccount}</option>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || dict.journal.accountsTab.mainAccountDefaultName}
                  </option>
                ))}
              </select>

              <select
                value={filterPeriod}
                onChange={(e) => {
                  setFilterPeriod(e.target.value);
                  setPage(1);
                }}
                className="input text-xs"
              >
                <option value="all">{dict.journal.tradesTab.periodAll}</option>
                <option value="7d">{dict.journal.tradesTab.period7d}</option>
                <option value="30d">{dict.journal.tradesTab.period30d}</option>
                <option value="90d">{dict.journal.tradesTab.period90d}</option>
              </select>

              <select
                value={filterResult}
                onChange={(e) => {
                  setFilterResult(e.target.value);
                  setPage(1);
                }}
                className="input text-xs"
              >
                <option value="all">{dict.journal.tradesTab.resultAll}</option>
                <option value="win">{dict.journal.tradesTab.resultWin}</option>
                <option value="loss">{dict.journal.tradesTab.resultLoss}</option>
                <option value="breakeven">{dict.journal.tradesTab.resultBreakeven}</option>
              </select>

              <select
                value={filterDirection}
                onChange={(e) => {
                  setFilterDirection(e.target.value);
                  setPage(1);
                }}
                className="input text-xs"
              >
                <option value="all">{dict.journal.tradesTab.dirAll}</option>
                <option value="long">{dict.journal.addTradeModal.directionLong}</option>
                <option value="short">{dict.journal.addTradeModal.directionShort}</option>
              </select>

              <select
                value={filterScreenshot}
                onChange={(e) => {
                  setFilterScreenshot(e.target.value);
                  setPage(1);
                }}
                className="input text-xs"
              >
                <option value="all">{dict.journal.attachments.filterAll}</option>
                <option value="with">{dict.journal.attachments.filterWithScreenshots}</option>
                <option value="without">{dict.journal.attachments.filterWithoutScreenshots}</option>
              </select>
            </div>
          </div>

          {filteredTrades.length === 0 ? (
            <div className="card text-center p-8 space-y-3 border-dashed">
              <h3 className="h3">{dict.journal.tradesTab.emptyTitle}</h3>
              <p className="text-xs text-mu max-w-md mx-auto">
                {dict.journal.tradesTab.emptyDesc}
              </p>
              <button
                onClick={() => setAddTradeModalOpen(true)}
                className="btn text-xs py-2 px-4 inline-flex items-center gap-1.5"
              >
                <Plus size={16} />
                <span>{dict.home.quickActions.addTrade}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="hidden md:block overflow-x-auto card p-0">
                <table className="w-full text-xs text-left">
                  <thead className="bg-s2/80 text-mu font-semibold border-b border-line">
                    <tr>
                      <th className="p-3">{dict.journal.tradesTab.colDate}</th>
                      <th className="p-3">{dict.journal.tradesTab.colInstrument}</th>
                      <th className="p-3">{dict.journal.tradesTab.colDirection}</th>
                      <th className="p-3 text-right">{dict.journal.tradesTab.colResult}</th>
                      <th className="p-3">{dict.journal.tradesTab.colVerification}</th>
                      <th className="p-3">{dict.journal.tradesTab.colAccount}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/40">
                    {paginatedTrades.map((t) => {
                      const acc = activeAccounts.find((a) => a.id === t.accountId);
                      const isWin = t.result === "win";
                      const isLoss = t.result === "loss";

                      return (
                        <tr
                          key={t.id}
                          onClick={() => setSelectedTrade(t)}
                          className="hover:bg-s2/60 cursor-pointer transition-colors"
                        >
                          <td className="p-3 text-mu">
                            {new Date(t.openedAt).toLocaleDateString(
                              lang === "ru" ? "ru-RU" : "en-US",
                              {
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )}
                          </td>
                          <td className="p-3 font-bold text-tx">
                            <div className="flex items-center gap-1.5">
                              <span>{t.instrument}</span>
                              {t.attachmentIds && t.attachmentIds.length > 0 && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded bg-acc/20 border border-acc/40 text-acc font-mono">
                                  <Camera size={10} />
                                  <span>{t.attachmentIds.length}</span>
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                t.direction === "long"
                                  ? "bg-emerald-500/20 text-emerald-400"
                                  : "bg-rose-500/20 text-rose-400"
                              }`}
                            >
                              {t.direction.toUpperCase()}
                            </span>
                          </td>
                          <td className="p-3 text-right font-bold">
                            <span
                              className={
                                isWin
                                  ? "text-emerald-400"
                                  : isLoss
                                  ? "text-rose-400"
                                  : "text-tx"
                              }
                            >
                              {formatTradeValue(t)}
                            </span>
                          </td>
                          <td className="p-3">
                            <span
                              title={dict.journal.tradesTab.unverifiedTooltip}
                              className="px-2 py-0.5 rounded bg-white/5 border border-line text-[10px] text-mu font-medium inline-flex items-center gap-1"
                            >
                              <ShieldAlert size={10} />
                              {dict.journal.tradesTab.unverifiedBadge}
                            </span>
                          </td>
                          <td className="p-3 text-mu truncate max-w-[120px]">
                            {acc?.name || dict.journal.accountsTab.mainAccountDefaultName}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="grid grid-cols-1 gap-2.5 md:hidden">
                {paginatedTrades.map((t) => {
                  const acc = activeAccounts.find((a) => a.id === t.accountId);
                  const isWin = t.result === "win";
                  const isLoss = t.result === "loss";

                  return (
                    <div
                      key={t.id}
                      onClick={() => setSelectedTrade(t)}
                      className="card p-3 space-y-2 cursor-pointer hover:border-vi transition-colors"
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-tx">{t.instrument}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              t.direction === "long"
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "bg-rose-500/20 text-rose-400"
                            }`}
                          >
                            {t.direction.toUpperCase()}
                          </span>
                        </div>
                        <span
                          className={`font-bold text-sm ${
                            isWin
                              ? "text-emerald-400"
                              : isLoss
                              ? "text-rose-400"
                              : "text-tx"
                          }`}
                        >
                          {formatTradeValue(t)}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-[11px] text-mu border-t border-line/40 pt-1.5">
                        <span>
                          {new Date(t.openedAt).toLocaleDateString(
                            lang === "ru" ? "ru-RU" : "en-US",
                            {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
                        </span>
                        <span>
                          {acc?.name || dict.journal.accountsTab.mainAccountDefaultName}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <div className="flex justify-between items-center text-xs text-mu pt-2">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="btn-ghost py-1 px-3 disabled:opacity-40"
                  >
                    {dict.journal.prevBtn}
                  </button>
                  <span>
                    {dict.journal.pageOf
                      .replace("{page}", String(page))
                      .replace("{total}", String(totalPages))}
                  </span>
                  <button
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="btn-ghost py-1 px-3 disabled:opacity-40"
                  >
                    {dict.journal.nextBtn}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
          )}
        </div>
      )}

      {/* TAB 2: REPORTS */}
      {activeTab === 2 && (
        <ReportsTab
          trades={activeTrades}
          accounts={activeAccounts}
          unit={unit}
          dict={dict}
          lang={lang}
        />
      )}

      {/* TAB 3: TRADING PLAN */}
      {activeTab === 3 && <TradingPlanTab />}

      {/* TAB 4: STRATEGIES */}
      {activeTab === 4 && (
        <StrategiesTab
          strategies={strategies}
          trades={activeTrades}
          onSaveStrategy={saveStrategy}
          onArchiveStrategy={archiveStrategy}
          onDeleteStrategy={deleteStrategy}
          dict={dict}
          lang={lang}
        />
      )}

      {/* TAB 5: ACCOUNTS */}
      {activeTab === 5 && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="h3">{dict.journal.accountsTab.title}</h3>
            <button
              onClick={() => handleOpenAccountModal()}
              className="btn text-xs py-2 px-3 flex items-center gap-1.5 font-semibold"
            >
              <Plus size={15} />
              <span>{dict.journal.accountsTab.addAccountBtn}</span>
            </button>
          </div>

          {accountErrorMessage && (
            <div className="p-3 bg-rose-500/15 border border-rose-500/40 rounded-xl text-xs text-rose-300">
              {accountErrorMessage}
            </div>
          )}

          {/* Prop Accounts Cards Section */}
          {accounts.some((a) => a.type === "prop" && !a.archivedAt) && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="h4 text-sm font-bold text-vi uppercase tracking-wider">
                  {dict.journal.propRules.title}
                </h4>
                {primaryPropAccountId !== undefined && (
                  <button
                    type="button"
                    onClick={() => setPrimaryPropAccountId(undefined)}
                    className="text-xs text-vi hover:underline font-semibold flex items-center gap-1"
                  >
                    {dict.journal.propRules.autoSelectPrimary}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4">
                {accounts
                  .filter((a) => a.type === "prop" && !a.archivedAt)
                  .map((propAcc) => (
                    <PropRulesCard
                      key={propAcc.id}
                      account={propAcc}
                      accounts={accounts}
                      trades={trades}
                      isPrimary={resolvedPrimaryPropAccount?.id === propAcc.id}
                      onOpenRulesModal={(acc) => setPropRulesModalAccount(acc)}
                      onTogglePrimaryProp={handleTogglePrimaryProp}
                      dict={dict}
                      lang={lang}
                    />
                  ))}
              </div>
            </div>
          )}

          {/* All Accounts Grid */}
          <div className="space-y-3">
            <h4 className="h4 text-sm font-bold text-tx">{dict.journal.accountsTab.title}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {accounts.map((a) => {
                const tradeCount = trades.filter((t) => t.accountId === a.id).length;
                const isArchived = !!a.archivedAt;

                return (
                  <div key={a.id} className="card p-4 space-y-3 relative">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-sm text-tx">
                          {a.name || dict.journal.accountsTab.mainAccountDefaultName}
                        </h4>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="badge-free text-[10px] uppercase">{a.type}</span>
                          <span className="chip text-[10px]">{a.currency}</span>
                          {a.isPrimaryProp && (
                            <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded font-medium">
                              {dict.journal.propRules.primaryBadge}
                            </span>
                          )}
                          {isArchived && (
                            <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] px-1.5 py-0.5 rounded font-medium">
                              {dict.journal.accountsTab.archivedTag}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-mu space-y-1 border-t border-line/40 pt-2">
                      {a.startBalance != null && (
                        <div className="flex justify-between">
                          <span>{dict.journal.accountsTab.startBalance}:</span>
                          <b className="text-tx">
                            {a.startBalance} {a.currency}
                          </b>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>{dict.journal.tradesWord}:</span>
                        <b className="text-tx">{tradeCount}</b>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-1 border-t border-line/40">
                      <button
                        onClick={() => handleOpenAccountModal(a)}
                        className="btn-ghost text-xs py-1 px-2.5 flex-1 flex items-center justify-center gap-1"
                      >
                        <Edit2 size={12} />
                        <span>{dict.journal.accountsTab.editBtn}</span>
                      </button>

                      {a.type === "prop" && !isArchived && (
                        <button
                          onClick={() => setPropRulesModalAccount(a)}
                          className="btn-ghost text-xs py-1 px-2.5 text-vi hover:text-tx flex items-center gap-1 font-semibold"
                        >
                          <span>{dict.journal.propRules.editBtn}</span>
                        </button>
                      )}

                      {!isArchived && (
                        <button
                          onClick={() => handleArchiveAccount(a.id)}
                          className="btn-ghost text-xs py-1 px-2.5 text-amber-400 hover:text-amber-300 flex items-center gap-1"
                        >
                          {dict.journal.accountsTab.archiveBtn}
                        </button>
                      )}
                      {!isArchived && (
                        <button
                          onClick={() => handleDeleteAccountAction(a)}
                          className="btn-ghost text-xs py-1 px-2 text-rose-400 hover:text-rose-300 flex items-center gap-1"
                          title={dict.confirmDialog.delete}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DIALOG */}
      {confirmConfig && confirmConfig.isOpen && (
        <ConfirmDialog
          isOpen={confirmConfig.isOpen}
          title={confirmConfig.title}
          description={confirmConfig.description}
          warningNote={confirmConfig.warningNote}
          confirmLabel={confirmConfig.confirmLabel}
          cancelLabel={confirmConfig.cancelLabel}
          matchText={confirmConfig.matchText}
          isDanger={confirmConfig.isDanger}
          onConfirm={confirmConfig.onConfirm}
          onCancel={() => setConfirmConfig(null)}
        />
      )}

      {/* PROP RULES WIZARD MODAL */}
      {propRulesModalAccount && (
        <PropRulesModal
          isOpen={true}
          account={propRulesModalAccount}
          accounts={accounts}
          trades={trades}
          onClose={() => setPropRulesModalAccount(null)}
          onSave={handleSavePropRules}
          dict={dict}
        />
      )}

      {/* TAB 6: NOTES */}
      {activeTab === 6 && <NotesTab />}

      {/* TRADE DETAIL VIEW & DELETE MODAL */}
      {selectedTrade && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedTrade(null);
          }}
        >
          <div className="card w-full max-w-lg space-y-4 shadow-xl border border-line p-5">
            <div className="flex justify-between items-center border-b border-line pb-3">
              <div>
                <h3 className="h3">{dict.journal.tradesTab.viewTradeTitle}</h3>
                <span className="text-xs text-mu">
                  {selectedTrade.instrument} · {selectedTrade.direction.toUpperCase()}
                </span>
              </div>
              <button
                onClick={() => setSelectedTrade(null)}
                className="text-mu hover:text-tx text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {deletingTradeId === selectedTrade.id ? (
              <div className="p-4 bg-rose-500/15 border border-rose-500/40 rounded-xl space-y-3">
                <p className="text-xs font-semibold text-rose-200">
                  {dict.journal.tradesTab.confirmDelete}
                  <span className="block text-[11px] text-rose-300/80 font-normal mt-0.5">
                    ({dict.journal.attachments.deleteTradeConfirmWithScreenshots})
                  </span>
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    ref={cancelButtonRef}
                    onClick={() => setDeleteTradeId(null)}
                    className="btn-secondary text-xs py-1.5 px-4"
                  >
                    {dict.journal.tradesTab.cancelDelete}
                  </button>
                  <button
                    onClick={handleDeleteTradeConfirm}
                    className="bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs py-1.5 px-4 rounded-lg transition-colors"
                  >
                    {dict.journal.tradesTab.deleteConfirmYes}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2 p-3 bg-s2/60 rounded-xl border border-line">
                  <div>
                    <span className="text-mu block text-[11px]">
                      {dict.journal.addTradeModal.openedAtLabel}
                    </span>
                    <b className="text-tx">
                      {new Date(selectedTrade.openedAt).toLocaleString()}
                    </b>
                  </div>
                  <div>
                    <span className="text-mu block text-[11px]">
                      {dict.journal.tradesTab.colResult}
                    </span>
                    <b
                      className={
                        selectedTrade.result === "win"
                          ? "text-emerald-400"
                          : selectedTrade.result === "loss"
                          ? "text-rose-400"
                          : "text-tx"
                      }
                    >
                      {formatTradeValue(selectedTrade)}
                    </b>
                  </div>
                </div>

                {selectedTrade.entryPrice != null && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <span className="text-mu block text-[11px]">
                        {dict.journal.addTradeModal.entryPriceLabel}
                      </span>
                      <b className="text-tx">{selectedTrade.entryPrice}</b>
                    </div>
                    <div>
                      <span className="text-mu block text-[11px]">
                        {dict.journal.addTradeModal.exitPriceLabel}
                      </span>
                      <b className="text-tx">{selectedTrade.exitPrice ?? "—"}</b>
                    </div>
                    <div>
                      <span className="text-mu block text-[11px]">
                        {dict.journal.addTradeModal.stopLossLabel}
                      </span>
                      <b className="text-tx">{selectedTrade.stopLoss ?? "—"}</b>
                    </div>
                    <div>
                      <span className="text-mu block text-[11px]">
                        {dict.journal.addTradeModal.takeProfitLabel}
                      </span>
                      <b className="text-tx">{selectedTrade.takeProfit ?? "—"}</b>
                    </div>
                  </div>
                )}

                {/* Strategy & Process Score Section */}
                {(() => {
                  const strat = strategies.find((s) => s.id === selectedTrade.strategyId);
                  const psScore = selectedTrade.processScore ?? null;
                  const psCategory = getProcessScoreCategory(psScore);

                  if (!strat && psScore == null) return null;

                  return (
                    <div className="p-3 bg-s2/60 border border-line rounded-xl space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-[10px] text-mu block font-medium">
                            {dict.journal.strategyLabel}
                          </span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {strat && (
                              <span
                                className="w-2.5 h-2.5 rounded-full flex-none"
                                style={{ backgroundColor: strat.color }}
                              />
                            )}
                            <b className="text-tx font-bold">
                              {strat?.name || dict.journal.strategiesTab.defaultName}
                            </b>
                            <span className="text-[10px] text-mu font-semibold px-1 py-0.2 bg-s2 rounded border border-line">
                              v{selectedTrade.strategyVersion || strat?.version || 1}
                            </span>
                          </div>
                        </div>

                        {psScore != null && (
                          <div className="text-right">
                            <span className="text-[10px] text-mu block font-medium">
                              {dict.journal.processScoreLabel}
                            </span>
                            <span
                              className={`font-bold text-sm ${
                                psCategory === "good"
                                  ? "text-emerald-400"
                                  : psCategory === "bad"
                                  ? "text-rose-400"
                                  : "text-amber-300"
                              }`}
                            >
                              {psScore}/100
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Score Components Breakdown */}
                      {selectedTrade.processScoreSnapshot && (
                        <div className="pt-2 border-t border-line/40 space-y-1">
                          <div className="grid grid-cols-3 gap-1 text-[10px] text-mu">
                            {selectedTrade.processScoreSnapshot.components.map((comp) => (
                              <div key={comp.key} className="p-1 bg-s1 rounded border border-line/40">
                                <span className="block font-medium capitalize">{comp.key}:</span>
                                <b className="text-tx">{comp.score}%</b> ({comp.weight}%)
                              </div>
                            ))}
                          </div>

                          {selectedTrade.processScoreSnapshot.mistakesPenalty > 0 && (
                            <p className="text-[10px] text-rose-400 font-medium">
                              {dict.journal.mistakesPenaltyLabel}: -
                              {selectedTrade.processScoreSnapshot.mistakesPenalty}
                            </p>
                          )}
                        </div>
                      )}

                      <div className="flex justify-between items-center pt-1">
                        <span className="text-[10px] text-mu italic">
                          {dict.journal.processScoreDisclaimer}
                        </span>
                        {!isDemoMode && (
                          <button
                            onClick={() => handleRecalculateProcessScore(selectedTrade)}
                            className="btn-ghost text-[10px] py-0.5 px-2 flex items-center gap-1 text-vi hover:text-vi/80"
                          >
                            <RefreshCw size={10} />
                            <span>{dict.journal.recalculateProcessBtn}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {selectedTrade.notes && (
                  <div>
                    <span className="text-mu block text-[11px] mb-1">
                      {dict.journal.addTradeModal.notesLabel}
                    </span>
                    <p className="p-2.5 bg-s2/40 border border-line rounded-lg text-tx whitespace-pre-wrap">
                      {selectedTrade.notes}
                    </p>
                  </div>
                )}

                {/* Screenshots Manager in Trade View */}
                <div className="space-y-2 pt-2 border-t border-line">
                  <span className="text-xs text-mu block font-medium">
                    {dict.journal.attachments.title}
                  </span>
                  <AttachmentManager
                    tradeId={selectedTrade.id}
                    tradeOpenedAt={selectedTrade.openedAt}
                  />
                </div>

                {/* Linked Notes for this trade */}
                {(() => {
                  const linked = notes.filter((n) => !n.archivedAt && n.links?.tradeId === selectedTrade.id);
                  return (
                    <div className="space-y-2 pt-2 border-t border-line/40">
                      <div className="flex justify-between items-center">
                        <span className="text-mu text-[11px] font-semibold">
                          {dict.journal.notes.linkedNotesTitle} ({linked.length})
                        </span>
                        {!isDemoMode && (
                          <button
                            type="button"
                            onClick={() =>
                              openNoteModal({
                                tradeId: selectedTrade.id,
                                instrument: selectedTrade.instrument,
                                strategyId: selectedTrade.strategyId || undefined,
                              })
                            }
                            className="btn-ghost text-[10px] py-0.5 px-2 flex items-center gap-1 text-acc font-semibold hover:text-tx"
                          >
                            <Plus size={12} />
                            <span>{dict.journal.notes.addLinkedNoteBtn}</span>
                          </button>
                        )}
                      </div>

                      {linked.length > 0 && (
                        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                          {linked.map((n) => (
                            <div
                              key={n.id}
                              onClick={() => openNoteModal(n.links)}
                              className="p-2 bg-s2/60 border border-line rounded-lg text-xs space-y-1 cursor-pointer hover:border-vi"
                            >
                              <div className="font-bold text-tx text-[11px]">
                                {n.title || n.body.split("\n")[0]}
                              </div>
                              <p className="text-[10px] text-mu line-clamp-2 font-sans">
                                {n.body}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {!isDemoMode && (
                  <div className="flex justify-end gap-2 pt-3 border-t border-line">
                    <button
                      onClick={() => {
                        const tradeToEdit = selectedTrade;
                        setSelectedTrade(null);
                        setEditingTrade(tradeToEdit);
                      }}
                      className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-1"
                    >
                      <Edit2 size={13} />
                      <span>{dict.journal.tradesTab.editTradeBtn}</span>
                    </button>
                    <button
                      onClick={() => setDeleteTradeId(selectedTrade.id)}
                      className="bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 py-1.5 px-3 text-xs font-medium rounded-lg flex items-center gap-1 transition-colors"
                    >
                      <Trash2 size={13} />
                      <span>{dict.journal.tradesTab.deleteTradeBtn}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* EDIT / ADD TRADE MODAL */}
      {(editingTrade || addTradeInitialDate) && (
        <AddTradeModal
          isOpen={true}
          initialTrade={editingTrade || undefined}
          onClose={() => {
            setEditingTrade(null);
            setAddTradeInitialDate(undefined);
          }}
        />
      )}

      {/* ACCOUNT MODAL */}
      {isAccountModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAccountModalOpen(false);
          }}
        >
          <form
            onSubmit={handleSaveAccountSubmit}
            className="card w-full max-w-md space-y-4 p-5 shadow-xl border border-line"
          >
            <div className="flex justify-between items-center border-b border-line pb-3">
              <h3 className="h3">
                {editingAccount
                  ? dict.journal.accountsTab.editBtn
                  : dict.journal.accountsTab.addAccountBtn}
              </h3>
              <button
                type="button"
                onClick={() => setIsAccountModalOpen(false)}
                className="text-mu hover:text-tx text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="text-xs text-mu block mb-1">
                {dict.journal.accountNameLabel}
              </label>
              <input
                type="text"
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                placeholder={dict.journal.accountsTab.mainAccountDefaultName}
                className="input text-xs w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-mu block mb-1">
                  {dict.journal.accountTypeLabel}
                </label>
                <select
                  value={accType}
                  onChange={(e) => setAccType(e.target.value as AccountType)}
                  className="input text-xs w-full"
                >
                  <option value="personal">{dict.journal.accountsTab.typePersonal}</option>
                  <option value="prop">{dict.journal.accountsTab.typeProp}</option>
                  <option value="demo">{dict.journal.accountsTab.typeDemo}</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-mu block mb-1">
                  {dict.journal.currencyLabel}
                </label>
                <select
                  value={accCurrency}
                  onChange={(e) => setAccCurrency(e.target.value as AccountCurrency)}
                  className="input text-xs w-full"
                >
                  {["USD", "EUR", "GBP", "GEL", "RUB", "UAH", "KZT", "USDT"].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-mu block mb-1">
                {dict.journal.accountsTab.startBalance}
              </label>
              <input
                type="text"
                value={accStartBalance}
                onChange={(e) => setAccStartBalance(e.target.value)}
                placeholder="10000"
                className="input text-xs w-full"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setIsAccountModalOpen(false)}
                className="btn-ghost py-2 px-4 text-xs"
              >
                {dict.journal.cancel}
              </button>
              <button type="submit" className="btn-primary py-2 px-5 text-xs font-semibold">
                {dict.journal.save}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
