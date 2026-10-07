"use client";

import React, { useState, useMemo } from "react";
import { Account, Trade } from "@/lib/journal/types";
import {
  calculateJournalAnalytics,
  calculateEquityCurve,
} from "@/lib/journal/stats";
import { EquityCurve } from "./EquityCurve";
import { HelpCircle, Sparkles, X, ChevronRight, AlertCircle, ArrowUpRight, ArrowDownRight } from "lucide-react";

interface DashboardTabProps {
  trades: Trade[];
  accounts: Account[];
  unit: "R" | "money" | "percent";
  onUnitChange: (unit: "R" | "money" | "percent") => void;
  onGoToTrades: () => void;
  isDemoMode: boolean;
  onEnableDemoMode: () => void;
  onExitDemoMode: () => void;
  dict: any;
  lang: string;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  trades,
  accounts,
  unit,
  onUnitChange,
  onGoToTrades,
  isDemoMode,
  onEnableDemoMode,
  onExitDemoMode,
  dict,
  lang,
}) => {
  // Filters State
  const [filterAccount, setFilterAccount] = useState<string>("all");
  const [filterPeriod, setFilterPeriod] = useState<string>("30d"); // 'currentMonth' | '7d' | '30d' | '90d' | 'all'
  const [filterVerification, setFilterVerification] = useState<string>("all"); // 'all' | 'verified'
  const [filterInstrument, setFilterInstrument] = useState<string>("");

  // Tooltip modal state
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  // Filter Trades
  const filteredTrades = useMemo(() => {
    const nowMs = Date.now();
    const now = new Date();

    return trades.filter((t) => {
      // Filter closed trades only for analytics
      if (t.status !== "closed") return false;

      // Account filter
      if (filterAccount !== "all" && t.accountId !== filterAccount) return false;

      // Verification filter
      if (filterVerification === "verified" && t.verification !== "verified") return false;

      // Instrument filter
      if (filterInstrument.trim()) {
        const query = filterInstrument.trim().toUpperCase();
        if (!t.instrument.toUpperCase().includes(query)) return false;
      }

      // Period filter
      const tradeMs = new Date(t.closedAt || t.openedAt || t.createdAt).getTime();
      const diffDays = (nowMs - tradeMs) / (1000 * 60 * 60 * 24);

      if (filterPeriod === "7d" && diffDays > 7) return false;
      if (filterPeriod === "30d" && diffDays > 30) return false;
      if (filterPeriod === "90d" && diffDays > 90) return false;
      if (filterPeriod === "currentMonth") {
        const tradeDate = new Date(t.closedAt || t.openedAt || t.createdAt);
        if (
          tradeDate.getFullYear() !== now.getFullYear() ||
          tradeDate.getMonth() !== now.getMonth()
        ) {
          return false;
        }
      }

      return true;
    });
  }, [trades, filterAccount, filterPeriod, filterVerification, filterInstrument]);

  // Analytics Calculation
  const analytics = useMemo(() => {
    return calculateJournalAnalytics(filteredTrades, accounts);
  }, [filteredTrades, accounts]);

  // Equity Curve Points
  const equityPoints = useMemo(() => {
    return calculateEquityCurve(filteredTrades, accounts);
  }, [filteredTrades, accounts]);

  // Currency symbol
  const selectedAcc = accounts.find((a) => a.id === filterAccount);
  const currencySymbol = selectedAcc?.currency || "USD";

  // Recent Trades (5-8 trades)
  const recentTrades = useMemo(() => {
    return [...filteredTrades]
      .sort(
        (a, b) =>
          new Date(b.closedAt || b.openedAt).getTime() -
          new Date(a.closedAt || a.openedAt).getTime()
      )
      .slice(0, 6);
  }, [filteredTrades]);

  // Format metric value helper
  const formatValue = (val: number | null, overrideUnit?: "R" | "money" | "percent") => {
    if (val === null || val === undefined) return "—";
    const targetUnit = overrideUnit || unit;

    if (targetUnit === "R") {
      return `${val > 0 ? "+" : ""}${val.toFixed(2)} R`;
    }
    if (targetUnit === "percent") {
      return `${val > 0 ? "+" : ""}${val.toFixed(2)}%`;
    }

    // Money
    try {
      const formatted = new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-US", {
        style: "currency",
        currency: currencySymbol,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(val);
      return val > 0 ? `+${formatted}` : formatted;
    } catch {
      return `${val > 0 ? "+" : ""}${val} ${currencySymbol}`;
    }
  };

  return (
    <div className="space-y-5">
      {/* Demo Banner */}
      {isDemoMode && (
        <div className="card bg-gradient-to-r from-amber-500/20 via-s1 to-s1 border-amber-500/40 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Sparkles size={18} className="text-amber-400 flex-none" />
            <div>
              <b className="text-xs text-amber-200 block font-bold">
                {dict.journal.dashboard.demoMode.banner}
              </b>
              <p className="text-[11px] text-mu mt-0.5">
                {dict.journal.dashboard.demoMode.infoNote}
              </p>
            </div>
          </div>
          <button
            onClick={onExitDemoMode}
            className="btn-secondary text-xs py-1.5 px-3 flex-none self-end sm:self-auto"
          >
            {dict.journal.dashboard.demoMode.exitDemoBtn}
          </button>
        </div>
      )}

      {/* Top Filters & Unit Switcher */}
      <div className="card p-3.5 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Unit Switcher */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-mu">
              {dict.journal.tradesTab.unitSwitcher}
            </span>
            <div className="flex rounded-lg border border-line bg-s2 p-0.5 text-xs">
              <button
                onClick={() => onUnitChange("R")}
                className={`px-3 py-1 font-bold rounded-md transition-colors ${
                  unit === "R" ? "bg-vi text-white" : "text-mu hover:text-tx"
                }`}
              >
                R
              </button>
              <button
                onClick={() => {
                  if (analytics.isMultiCurrency && filterAccount === "all") {
                    // Lock money unit if multi currency
                    return;
                  }
                  onUnitChange("money");
                }}
                disabled={analytics.isMultiCurrency && filterAccount === "all"}
                className={`px-3 py-1 font-bold rounded-md transition-colors ${
                  unit === "money" ? "bg-vi text-white" : "text-mu hover:text-tx"
                } ${
                  analytics.isMultiCurrency && filterAccount === "all"
                    ? "opacity-40 cursor-not-allowed"
                    : ""
                }`}
                title={
                  analytics.isMultiCurrency && filterAccount === "all"
                    ? dict.journal.dashboard.multiCurrencyWarning
                    : ""
                }
              >
                $
              </button>
              <button
                onClick={() => onUnitChange("percent")}
                className={`px-3 py-1 font-bold rounded-md transition-colors ${
                  unit === "percent" ? "bg-vi text-white" : "text-mu hover:text-tx"
                }`}
              >
                %
              </button>
            </div>
          </div>

          {/* Filter Dropdowns */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs flex-1 max-w-2xl">
            {/* Account */}
            <select
              value={filterAccount}
              onChange={(e) => setFilterAccount(e.target.value)}
              className="input text-xs"
            >
              <option value="all">{dict.journal.dashboard.filters.allAccounts}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || dict.journal.accountsTab.mainAccountDefaultName}
                </option>
              ))}
            </select>

            {/* Period */}
            <select
              value={filterPeriod}
              onChange={(e) => setFilterPeriod(e.target.value)}
              className="input text-xs"
            >
              <option value="30d">{dict.journal.dashboard.filters.period30d}</option>
              <option value="7d">{dict.journal.dashboard.filters.period7d}</option>
              <option value="90d">{dict.journal.dashboard.filters.period90d}</option>
              <option value="currentMonth">
                {dict.journal.dashboard.filters.periodCurrentMonth}
              </option>
              <option value="all">{dict.journal.dashboard.filters.periodAll}</option>
            </select>

            {/* Verification */}
            <select
              value={filterVerification}
              onChange={(e) => setFilterVerification(e.target.value)}
              className="input text-xs"
            >
              <option value="all">{dict.journal.dashboard.filters.verificationAll}</option>
              <option value="verified">
                {dict.journal.dashboard.filters.verificationVerified}
              </option>
            </select>

            {/* Instrument Search */}
            <input
              type="text"
              value={filterInstrument}
              onChange={(e) => setFilterInstrument(e.target.value)}
              placeholder={dict.journal.tradesTab.searchPlaceholder}
              className="input text-xs"
            />
          </div>
        </div>

        {/* Multi-currency notice if money mode disabled */}
        {analytics.isMultiCurrency && filterAccount === "all" && unit === "money" && (
          <div className="text-[11px] text-amber-300 flex items-center gap-1.5 pt-1">
            <AlertCircle size={14} className="flex-none" />
            <span>{dict.journal.dashboard.multiCurrencyWarning}</span>
          </div>
        )}
      </div>

      {/* Empty State / Demo Mode Prompt */}
      {filteredTrades.length === 0 && !isDemoMode && (
        <div className="card text-center p-8 space-y-3 border-dashed">
          <h3 className="h3">{dict.journal.tradesTab.emptyTitle}</h3>
          <p className="text-xs text-mu max-w-md mx-auto">
            {dict.journal.tradesTab.emptyDesc}
          </p>
          <button
            onClick={onEnableDemoMode}
            className="btn text-xs py-2 px-4 inline-flex items-center gap-1.5"
          >
            <Sparkles size={16} />
            <span>{dict.journal.dashboard.demoMode.showExampleBtn}</span>
          </button>
        </div>
      )}

      {/* KPI Cards Grid */}
      {(filteredTrades.length > 0 || isDemoMode) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {/* CARD 1: Result */}
          <div className="card p-3.5 space-y-2 relative">
            <div className="flex justify-between items-center text-xs text-mu">
              <span>{dict.journal.dashboard.kpi.result}</span>
              <button
                onClick={() => setActiveTooltip("result")}
                className="text-mu hover:text-tx focus-visible:outline-none"
              >
                <HelpCircle size={14} />
              </button>
            </div>
            <b
              className={`block text-xl font-mono font-bold ${
                (analytics.totalR > 0 && unit === "R") ||
                ((analytics.totalMoney ?? 0) > 0 && unit === "money") ||
                ((analytics.totalPnlPercent ?? 0) > 0 && unit === "percent")
                  ? "text-emerald-400"
                  : (analytics.totalR < 0 && unit === "R") ||
                    ((analytics.totalMoney ?? 0) < 0 && unit === "money") ||
                    ((analytics.totalPnlPercent ?? 0) < 0 && unit === "percent")
                  ? "text-rose-400"
                  : "text-tx"
              }`}
            >
              {unit === "R"
                ? formatValue(analytics.totalR, "R")
                : unit === "percent"
                ? formatValue(analytics.totalPnlPercent, "percent")
                : formatValue(analytics.totalMoney, "money")}
            </b>
            {analytics.hasLowData && (
              <span className="inline-block text-[10px] text-mu bg-white/5 border border-line px-1.5 py-0.5 rounded">
                {dict.journal.dashboard.kpi.lowDataTag.replace(
                  "{count}",
                  String(analytics.totalTrades)
                )}
              </span>
            )}
          </div>

          {/* CARD 2: Winrate */}
          <div className="card p-3.5 space-y-2 relative">
            <div className="flex justify-between items-center text-xs text-mu">
              <span>{dict.journal.dashboard.kpi.winrate}</span>
              <button
                onClick={() => setActiveTooltip("winrate")}
                className="text-mu hover:text-tx focus-visible:outline-none"
              >
                <HelpCircle size={14} />
              </button>
            </div>
            <b className="block text-xl font-mono font-bold text-tx">
              {(analytics.winRate * 100).toFixed(1)}%
            </b>

            {/* Segmented Bar: Win / Breakeven / Loss */}
            {analytics.totalTrades > 0 && (
              <div className="space-y-1">
                <div className="h-2 rounded-full overflow-hidden flex bg-s2 border border-line/40">
                  <div
                    style={{
                      width: `${(analytics.winsCount / analytics.totalTrades) * 100}%`,
                    }}
                    className="bg-emerald-500 h-full"
                  />
                  <div
                    style={{
                      width: `${
                        (analytics.breakevenCount / analytics.totalTrades) * 100
                      }%`,
                    }}
                    className="bg-slate-400 h-full"
                  />
                  <div
                    style={{
                      width: `${
                        (analytics.lossesCount / analytics.totalTrades) * 100
                      }%`,
                    }}
                    className="bg-rose-500 h-full"
                  />
                </div>
                <div className="flex justify-between text-[10px] text-mu font-mono">
                  <span className="text-emerald-400">{analytics.winsCount}W</span>
                  <span className="text-slate-400">{analytics.breakevenCount}BE</span>
                  <span className="text-rose-400">{analytics.lossesCount}L</span>
                </div>
              </div>
            )}
          </div>

          {/* CARD 3: Profit Factor */}
          <div className="card p-3.5 space-y-2 relative">
            <div className="flex justify-between items-center text-xs text-mu">
              <span>{dict.journal.dashboard.kpi.profitFactor}</span>
              <button
                onClick={() => setActiveTooltip("profitFactor")}
                className="text-mu hover:text-tx focus-visible:outline-none"
              >
                <HelpCircle size={14} />
              </button>
            </div>
            <b className="block text-xl font-mono font-bold text-tx">
              {unit === "money" && analytics.profitFactorMoney !== null
                ? analytics.profitFactorMoney.toFixed(2)
                : analytics.profitFactorR !== null
                ? analytics.profitFactorR.toFixed(2)
                : "—"}
            </b>
            {analytics.hasLowData && (
              <span className="inline-block text-[10px] text-mu bg-white/5 border border-line px-1.5 py-0.5 rounded">
                {dict.journal.dashboard.kpi.lowDataTag.replace(
                  "{count}",
                  String(analytics.totalTrades)
                )}
              </span>
            )}
          </div>

          {/* CARD 4: Expectancy (R) */}
          <div className="card p-3.5 space-y-2 relative">
            <div className="flex justify-between items-center text-xs text-mu">
              <span>{dict.journal.dashboard.kpi.expectancyR}</span>
              <button
                onClick={() => setActiveTooltip("expectancyR")}
                className="text-mu hover:text-tx focus-visible:outline-none"
              >
                <HelpCircle size={14} />
              </button>
            </div>
            <b className="block text-xl font-mono font-bold text-tx">
              {analytics.expectancyR !== null
                ? formatValue(analytics.expectancyR, "R")
                : "—"}
            </b>
            <span className="text-[10px] text-mu block">
              R known: {analytics.knownRCount} / {analytics.totalTrades}
            </span>
          </div>

          {/* CARD 5: Avg Win / Loss & Payoff */}
          <div className="card p-3.5 space-y-2 relative">
            <div className="flex justify-between items-center text-xs text-mu">
              <span>{dict.journal.dashboard.kpi.avgWinLoss}</span>
              <button
                onClick={() => setActiveTooltip("avgWinLoss")}
                className="text-mu hover:text-tx focus-visible:outline-none"
              >
                <HelpCircle size={14} />
              </button>
            </div>
            <div className="flex items-center justify-between font-mono text-xs">
              <span className="text-emerald-400 font-bold">
                {analytics.avgWinR !== null ? `+${analytics.avgWinR.toFixed(2)}R` : "—"}
              </span>
              <span className="text-mu">/</span>
              <span className="text-rose-400 font-bold">
                {analytics.avgLossR !== null ? `${analytics.avgLossR.toFixed(2)}R` : "—"}
              </span>
            </div>
            <div className="text-[10px] text-mu">
              Payoff:{" "}
              <b className="text-tx font-mono">
                {analytics.payoff !== null ? analytics.payoff.toFixed(2) : "—"}
              </b>
            </div>
          </div>

          {/* CARD 6: Trades */}
          <div className="card p-3.5 space-y-2 relative">
            <div className="flex justify-between items-center text-xs text-mu">
              <span>{dict.journal.dashboard.kpi.trades}</span>
              <button
                onClick={() => setActiveTooltip("trades")}
                className="text-mu hover:text-tx focus-visible:outline-none"
              >
                <HelpCircle size={14} />
              </button>
            </div>
            <b className="block text-xl font-mono font-bold text-tx">
              {analytics.totalTrades}
            </b>
            <span className="text-[10px] text-mu block">
              ~{analytics.tradesPerDay.toFixed(1)} trades / day
            </span>
          </div>

          {/* CARD 7: Max Drawdown */}
          <div className="card p-3.5 space-y-2 relative col-span-2 sm:col-span-1">
            <div className="flex justify-between items-center text-xs text-mu">
              <span>{dict.journal.dashboard.kpi.drawdown}</span>
              <button
                onClick={() => setActiveTooltip("drawdown")}
                className="text-mu hover:text-tx focus-visible:outline-none"
              >
                <HelpCircle size={14} />
              </button>
            </div>
            <b className="block text-xl font-mono font-bold text-rose-400">
              {unit === "money" && analytics.maxDrawdownMoney !== null
                ? `-${analytics.maxDrawdownMoney.toFixed(0)} ${currencySymbol}`
                : `-${analytics.maxDrawdownR.toFixed(2)} R`}
            </b>
            <span className="text-[10px] text-mu block">Peak to trough</span>
          </div>
        </div>
      )}

      {/* SVG Equity Curve Chart */}
      {(filteredTrades.length > 0 || isDemoMode) && (
        <EquityCurve
          points={equityPoints}
          unit={unit}
          currencySymbol={currencySymbol}
          dict={dict}
        />
      )}

      {/* Recent Trades Table (5-8) */}
      {(recentTrades.length > 0 || isDemoMode) && (
        <div className="card p-4 space-y-3">
          <div className="flex justify-between items-center">
            <h4 className="h4 text-sm font-serif">
              {dict.journal.dashboard.recentTrades.title}
            </h4>
            <button
              onClick={onGoToTrades}
              className="text-xs text-vi font-semibold hover:underline flex items-center gap-1"
            >
              <span>{dict.journal.dashboard.recentTrades.viewAllBtn}</span>
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="divide-y divide-line/40 text-xs">
            {recentTrades.map((t) => {
              const isWin = t.result === "win";
              const isLoss = t.result === "loss";

              return (
                <div
                  key={t.id}
                  onClick={onGoToTrades}
                  className="py-2 flex items-center justify-between hover:bg-s2/40 px-2 rounded-lg cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`p-1 rounded ${
                        t.direction === "long"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-rose-500/20 text-rose-400"
                      }`}
                    >
                      {t.direction === "long" ? (
                        <ArrowUpRight size={14} />
                      ) : (
                        <ArrowDownRight size={14} />
                      )}
                    </span>
                    <div>
                      <b className="text-tx font-bold block">{t.instrument}</b>
                      <span className="text-[10px] text-mu">
                        {new Date(t.closedAt || t.openedAt).toLocaleDateString(
                          lang === "ru" ? "ru-RU" : "en-US",
                          { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }
                        )}
                      </span>
                    </div>
                  </div>

                  <b
                    className={`font-mono ${
                      isWin ? "text-emerald-400" : isLoss ? "text-rose-400" : "text-tx"
                    }`}
                  >
                    {unit === "R"
                      ? formatValue(t.rMultiple ?? null, "R")
                      : formatValue(t.pnlMoney ?? null, "money")}
                  </b>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* KPI Tooltip Modal */}
      {activeTooltip && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveTooltip(null);
          }}
        >
          <div className="card w-full max-w-sm p-5 space-y-3 shadow-2xl border border-line">
            <div className="flex justify-between items-center border-b border-line pb-2">
              <b className="text-sm text-tx">
                {(dict.journal.dashboard.kpi as any)[activeTooltip] || activeTooltip}
              </b>
              <button
                onClick={() => setActiveTooltip(null)}
                className="text-mu hover:text-tx p-1"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-mu leading-relaxed">
              {(dict.journal.dashboard.kpi.tooltips as any)[activeTooltip] ||
                "Definition placeholder"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
