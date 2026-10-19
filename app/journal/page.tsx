"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { Account, Trade, AccountType, AccountCurrency, Note } from "@/lib/journal/types";
import { calculatePnlPercent } from "@/lib/journal/calc";
import { exportProfileDataJSON, calculateJournalStats } from "@/lib/stats";
import { AddTradeModal } from "@/components/AddTradeModal";
import { DashboardTab } from "@/components/journal/DashboardTab";
import { ReportsTab } from "@/components/journal/ReportsTab";
import { StrategiesTab } from "@/components/journal/StrategiesTab";
import { NoTradeTab } from "@/components/journal/NoTradeTab";
import { TradingPlanTab } from "@/components/journal/TradingPlanTab";
import { NotesTab } from "@/components/journal/NotesTab";
import { calculateProcessScore } from "@/lib/journal/process-score";
import { getDemoTrades, DEMO_ACCOUNT } from "@/lib/journal/demo-trades";
import { Plus, Download, AlertTriangle, Trash2, Edit2, FileUp, FileDown } from "lucide-react";
import dynamic from "next/dynamic";

// Loaded only when opened: parsers for ~25 platforms are not needed for the everyday journal.
const ImportWizard = dynamic(() => import("@/components/journal/ImportWizard").then((m) => m.ImportWizard), { ssr: false });
const ExportDialog = dynamic(() => import("@/components/journal/ExportDialog").then((m) => m.ExportDialog), { ssr: false });
import { Tabs, Segmented, Button, Input, Modal, NumberInput, Select } from "@/components/ui";
import { JournalKpiStrip, type JournalUnit } from "@/components/journal/JournalKpiStrip";
import { TodayPanel } from "@/components/journal/TodayPanel";
import { TradesTable } from "@/components/journal/TradesTable";
import { TradeQuickView } from "@/components/journal/TradeQuickView";
import { NoTradeModal } from "@/components/journal/NoTradeModal";
import type { KpiPeriod } from "@/lib/journal/overview";
import { getLocalDateString } from "@/lib/date-utils";
import { PropRulesModal } from "@/components/journal/PropRulesModal";
import { PropRulesCard } from "@/components/journal/PropRulesCard";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { recordPropRulesSaved } from "@/lib/game";
import { calculatePropMetrics, resolvePrimaryPropAccount } from "@/lib/journal/prop";
import { evaluatePropToastAlert } from "@/lib/journal/prop-toast";
import { AppStorage } from "@/lib/storage";
import { InitialSyncButton } from "@/components/journal/InitialSyncDialog";

const JOURNAL_TABS = ["trades", "analytics", "plan", "reports", "strategies", "accounts", "notes"] as const;
type JournalTab = (typeof JOURNAL_TABS)[number];
const KPI_PERIOD_KEY = "ayra_journal_kpi_period";

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
    getTradingPlan,
    saveTradingPlan,
  } = useJournal();

  // Subtab in Trades tab: 'trades' | 'noTrade'
  const [tradesSubtab, setTradesSubtab] = useState<"trades" | "noTrade">("trades");

  const searchParams = useSearchParams();
  // Trades first; rare sections live in the "More" menu.
  const [activeTab, setActiveTabState] = useState<JournalTab>("trades");
  const setActiveTab = (tab: JournalTab) => {
    setActiveTabState(tab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      window.history.replaceState(window.history.state, "", url.toString());
    }
  };

  useEffect(() => {
    const getTabFromUrl = () => {
      if (typeof window !== "undefined" && window.location.search) {
        return new URLSearchParams(window.location.search).get("tab");
      }
      return searchParams.get("tab");
    };

    const tabParam = getTabFromUrl();
    const mapped = tabParam === "dashboard" ? "analytics" : tabParam;
    if (mapped && (JOURNAL_TABS as readonly string[]).includes(mapped)) {
      setActiveTabState(mapped as JournalTab);
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
  const [unit, setUnit] = useState<JournalUnit>("R");
  const [kpiPeriod, setKpiPeriod] = useState<KpiPeriod>("month");
  const [isNoTradeModalOpen, setNoTradeModalOpen] = useState(false);
  const [isImportOpen, setImportOpen] = useState(false);
  const [isExportOpen, setExportOpen] = useState(false);
  const [tableTrades, setTableTrades] = useState<Trade[]>([]);
  const tz = gameState.profile?.timezone || "UTC";
  const todayPlan = getTradingPlan(getLocalDateString(new Date(), gameState.profile?.timezone));

  useEffect(() => {
    try {
      const saved = AppStorage.getItem(KPI_PERIOD_KEY);
      if (saved === "day" || saved === "week" || saved === "month" || saved === "all") setKpiPeriod(saved);
    } catch {}
  }, []);
  const handleKpiPeriodChange = (p: KpiPeriod) => {
    setKpiPeriod(p);
    try {
      AppStorage.setItem(KPI_PERIOD_KEY, p);
    } catch {}
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedUnit = AppStorage.getItem("ayra_journal_unit") as "R" | "money" | "percent";
      if (savedUnit && ["R", "money", "percent"].includes(savedUnit)) {
        setUnit(savedUnit);
      }
    }
  }, []);

  const handleUnitChange = (newUnit: "R" | "money" | "percent") => {
    setUnit(newUnit);
    if (typeof window !== "undefined") {
      AppStorage.setItem("ayra_journal_unit", newUnit);
    }
  };

  // Trade Detail / Edit / Delete state
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [addTradeInitialDate, setAddTradeInitialDate] = useState<string | undefined>(undefined);

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

  // All sections are visible at once (no "More" menu); the row scrolls on phones.
  const journalTabs: Array<{ id: JournalTab; label: string }> = [
    { id: "trades", label: dict.journal.tabs.trades },
    { id: "analytics", label: dict.journal.tabs.analytics },
    { id: "plan", label: dict.journal.tabs.plan },
    { id: "reports", label: dict.journal.tabs.reports },
    { id: "strategies", label: dict.journal.tabs.strategies },
    { id: "accounts", label: dict.journal.tabs.accounts },
    { id: "notes", label: dict.journal.tabs.notes },
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

  // Formatting trade result values
  const formatTradeValue = (trade: Trade) => {
    const acc = activeAccounts.find((a) => a.id === trade.accountId);
    const curr = acc?.currency || "USD";

    // R or % unknown but the result in money is known (e.g. imported without risk): show the money instead of "—"
    if (unit === "R" && trade.rMultiple != null) {
      const val = trade.rMultiple;
      return val > 0 ? `+${val.toFixed(2)} R` : `${val.toFixed(2)} R`;
    }

    if (unit === "percent") {
      const startBal = acc?.startBalance;
      const pct = calculatePnlPercent(trade.pnlMoney, startBal);
      if (pct != null) {
        return pct > 0 ? `+${pct.toFixed(2)}%` : `${pct.toFixed(2)}%`;
      }
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

  const handleDeleteTradeConfirm = (deletingTradeId: string | null) => {
    if (deletingTradeId) {
      const tradeToDelete = trades.find((t) => t.id === deletingTradeId);
      const affectedAccount = tradeToDelete ? accounts.find((a) => a.id === tradeToDelete.accountId) : null;
      const prevMetrics = affectedAccount?.propRules ? calculatePropMetrics(affectedAccount, trades) : undefined;

      deleteTrade(deletingTradeId);
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

  const openAddTrade = () => {
    setAddTradeInitialDate(undefined);
    setAddTradeModalOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Header: one primary action */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl font-bold text-tx md:text-3xl">{dict.journal.title}</h1>
          <p className="mt-0.5 text-sm text-mu">{dict.journal.subtitle}</p>
        </div>
        {!isDemoMode && (
          <div className="flex shrink-0 items-center gap-2">
          {/* First upload of this device's journal (signed in, sync on, never synced, with local data) */}
          <InitialSyncButton />
          <Button variant="secondary" onClick={() => setImportOpen(true)} data-testid="journal-import">
            <FileUp size={18} aria-hidden="true" />
            <span className="hidden sm:inline">{dict.journal.importExport.importBtn}</span>
            <span className="sr-only sm:hidden">{dict.journal.importExport.importBtn}</span>
          </Button>
          <Button variant="secondary" onClick={() => setExportOpen(true)} data-testid="journal-export">
            <FileDown size={18} aria-hidden="true" />
            <span className="hidden sm:inline">{dict.journal.importExport.exportBtn}</span>
            <span className="sr-only sm:hidden">{dict.journal.importExport.exportBtn}</span>
          </Button>
          <Button onClick={openAddTrade} className="shrink-0">
            <Plus size={18} aria-hidden="true" />
            <span className="hidden sm:inline">{dict.home.quickActions.addTrade}</span>
            <span className="sm:hidden">{dict.journal.overview.addTrade}</span>
          </Button>
          </div>
        )}
      </div>

      {/* Storage Usage Soft Warning Banner (>80%) */}
      {storageUsage.isWarning && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="flex-none text-amber-400" aria-hidden="true" />
            <span>{dict.journal.storageWarning.replace("{percent}", storageUsage.percentage.toFixed(0))}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={handleExportJSON}>
            <Download size={14} aria-hidden="true" />
            <span>{dict.journal.exportBtn}</span>
          </Button>
        </div>
      )}

      <JournalKpiStrip
        trades={activeTrades}
        accounts={activeAccounts}
        tz={tz}
        unit={unit}
        onUnitChange={handleUnitChange}
        period={kpiPeriod}
        onPeriodChange={handleKpiPeriodChange}
        dict={dict}
        lang={lang}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
        <div className="order-2 min-w-0 space-y-4 xl:order-1">
          <Tabs<JournalTab> items={journalTabs} value={activeTab} onChange={setActiveTab} label={dict.journal.title} idPrefix="journal" />

      {/* TRADES */}
      {activeTab === "trades" && (
        <div className="space-y-4">
          <Segmented<"trades" | "noTrade">
            name={dict.journal.tabs.trades}
            value={tradesSubtab}
            onChange={setTradesSubtab}
            className="max-w-sm"
            options={[
              { value: "trades", label: dict.journal.tradesSubtab, tone: "accent" },
              { value: "noTrade", label: `${dict.journal.noTradeSubtab} (${noTrades.length})`, tone: "accent" },
            ]}
          />
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
            <TradesTable
              trades={activeTrades}
              accounts={activeAccounts}
              strategies={strategies}
              tz={tz}
              unit={unit}
              dict={dict}
              lang={lang}
              formatTradeValue={formatTradeValue}
              onOpenTrade={setSelectedTrade}
              onAddTrade={openAddTrade}
              readOnly={isDemoMode}
              onFilteredChange={setTableTrades}
            />
          )}
        </div>
      )}

      {/* TAB 0: DASHBOARD */}
      {activeTab === "analytics" && (
        <div className="space-y-6">
          <DashboardTab
            trades={activeTrades}
            accounts={activeAccounts}
            strategies={strategies}
            onAddTradeForDate={handleAddTradeForDate}
            unit={unit}
            onUnitChange={handleUnitChange}
            onGoToTrades={() => setActiveTab("trades")}
            isDemoMode={isDemoMode}
            onEnableDemoMode={() => setIsDemoMode(true)}
            onExitDemoMode={() => setIsDemoMode(false)}
            dict={dict}
            lang={lang}
          />

        </div>
      )}

      {/* TAB 2: REPORTS */}
      {activeTab === "reports" && (
        <ReportsTab
          trades={activeTrades}
          accounts={activeAccounts}
          unit={unit}
          dict={dict}
          lang={lang}
        />
      )}

      {/* TAB 3: TRADING PLAN */}
      {activeTab === "plan" && <TradingPlanTab />}

      {/* TAB 4: STRATEGIES */}
      {activeTab === "strategies" && (
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
      {activeTab === "accounts" && (
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
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

                    <div className="flex flex-wrap gap-2 pt-1 border-t border-line/40">
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

      {activeTab === "notes" && <NotesTab />}
        </div>

        <div className="order-1 xl:sticky xl:top-4 xl:order-2">
          <TodayPanel
            trades={activeTrades}
            plan={isDemoMode ? null : todayPlan}
            onSavePlan={isDemoMode ? undefined : saveTradingPlan}
            tz={tz}
            dict={dict}
            lang={lang}
            formatTradeValue={formatTradeValue}
            onAddTrade={openAddTrade}
            onAddNoTrade={() => setNoTradeModalOpen(true)}
            onAddNote={() => openNoteModal()}
            onOpenPlan={() => setActiveTab("plan")}
            onOpenTrade={setSelectedTrade}
            readOnly={isDemoMode}
          />
        </div>
      </div>

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

      <NoTradeModal
        isOpen={isNoTradeModalOpen}
        accounts={accounts}
        onClose={() => setNoTradeModalOpen(false)}
        onSave={(entry) => {
          handleSaveNoTradeAction(entry);
          setNoTradeModalOpen(false);
        }}
        dict={dict}
      />

      {isImportOpen && <ImportWizard isOpen={isImportOpen} onClose={() => setImportOpen(false)} accounts={accounts} trades={trades} userTimeZone={tz} />}
      {isExportOpen && (
      <ExportDialog
        isOpen={isExportOpen}
        onClose={() => setExportOpen(false)}
        trades={trades}
        filteredTrades={tableTrades}
        accounts={accounts}
        strategies={strategies}
        notes={notes}
      />
      )}

      {/* TRADE QUICK VIEW */}
      <TradeQuickView
        trade={selectedTrade}
        onClose={() => setSelectedTrade(null)}
        strategies={strategies}
        notes={notes}
        readOnly={isDemoMode}
        formatTradeValue={formatTradeValue}
        onEdit={(tr) => {
          setSelectedTrade(null);
          setEditingTrade(tr);
        }}
        onConfirmDelete={(tr) => handleDeleteTradeConfirm(tr.id)}
        onRecalculate={handleRecalculateProcessScore}
        onAddLinkedNote={(tr) => openNoteModal({ tradeId: tr.id, instrument: tr.instrument, strategyId: tr.strategyId || undefined })}
        onOpenNote={(n: Note) => openNoteModal(n.links)}
        dict={dict}
        lang={lang}
      />

      {/* EDIT / ADD TRADE MODAL */}
      {(editingTrade || addTradeInitialDate) && (
        <AddTradeModal
          isOpen={true}
          initialTrade={editingTrade || undefined}
          initialOpenedAt={editingTrade ? undefined : addTradeInitialDate}
          onClose={() => {
            setEditingTrade(null);
            setAddTradeInitialDate(undefined);
          }}
        />
      )}

      {/* ACCOUNT MODAL */}
      <Modal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        title={editingAccount ? dict.journal.accountsTab.editBtn : dict.journal.accountsTab.addAccountBtn}
        closeLabel={dict.journal.addTradeModal.closeLabel}
        data-testid="account-modal"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsAccountModalOpen(false)}>
              {dict.journal.cancel}
            </Button>
            <Button type="submit" form="journal-account-form">
              {dict.journal.save}
            </Button>
          </>
        }
      >
        <form id="journal-account-form" onSubmit={handleSaveAccountSubmit} className="space-y-4">
          <Input
            label={dict.journal.accountNameLabel}
            value={accName}
            onChange={(e) => setAccName(e.target.value)}
            placeholder={dict.journal.accountsTab.mainAccountDefaultName}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select<AccountType>
              label={dict.journal.accountTypeLabel}
              value={accType}
              onChange={setAccType}
              data-testid="account-type-select"
              options={[
                { value: "personal", label: dict.journal.accountsTab.typePersonal },
                { value: "prop", label: dict.journal.accountsTab.typeProp },
                { value: "demo", label: dict.journal.accountsTab.typeDemo },
              ]}
            />
            <Select<AccountCurrency>
              label={dict.journal.currencyLabel}
              value={accCurrency}
              onChange={setAccCurrency}
              data-testid="account-currency-select"
              options={(["USD", "EUR", "GBP", "GEL", "RUB", "UAH", "KZT", "USDT"] as AccountCurrency[]).map((c) => ({ value: c, label: c }))}
            />
          </div>
          <NumberInput
            label={dict.journal.accountsTab.startBalance}
            optional
            value={accStartBalance}
            onChange={(e) => setAccStartBalance(e.target.value)}
            placeholder="10000"
          />
        </form>
      </Modal>
    </div>
  );
}
