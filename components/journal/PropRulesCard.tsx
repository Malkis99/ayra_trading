"use client";

import React, { useState } from "react";
import { Account, Trade, PropLimitStatus } from "@/lib/journal/types";
import { calculatePropMetrics, PropMetricsSummary } from "@/lib/journal/prop";
import { PropDaysList } from "./PropDaysList";
import {
  Star,
  Settings,
  AlertTriangle,
  CheckCircle,
  Clock,
  HelpCircle,
  History,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface PropRulesCardProps {
  account: Account;
  accounts: Account[];
  trades: Trade[];
  onOpenRulesModal: (account: Account) => void;
  onTogglePrimaryProp: (accountId: string) => void;
  dict: any;
  lang: string;
}

export const PropRulesCard: React.FC<PropRulesCardProps> = ({
  account,
  accounts,
  trades,
  onOpenRulesModal,
  onTogglePrimaryProp,
  dict,
  lang,
}) => {
  const [showHistory, setShowHistory] = useState(false);
  const [showDaysList, setShowDaysList] = useState(false);

  const rules = account.propRules;
  const hasRules = Boolean(rules && rules.startedAt);
  const metrics: PropMetricsSummary | undefined = hasRules
    ? calculatePropMetrics(account, trades)
    : undefined;

  const isPrimary = Boolean(account.isPrimaryProp);

  const getStatusBadge = (status?: PropLimitStatus) => {
    if (!status) return null;

    if (status === "ok") {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">
          <CheckCircle size={11} />
          <span>{dict.journal.propRules.status.ok}</span>
        </span>
      );
    }
    if (status === "caution") {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
          <AlertTriangle size={11} />
          <span>{dict.journal.propRules.status.caution}</span>
        </span>
      );
    }
    if (status === "close") {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-300 bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 rounded-full">
          <AlertTriangle size={11} />
          <span>{dict.journal.propRules.status.close}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-300 bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 rounded-full">
        <Clock size={11} />
        <span>{dict.journal.propRules.status.reached}</span>
      </span>
    );
  };

  const getProgressBarColor = (status?: PropLimitStatus) => {
    if (status === "caution") return "bg-amber-400";
    if (status === "close") return "bg-rose-400";
    if (status === "reached") return "bg-purple-400";
    return "bg-emerald-400";
  };

  const formatCurrency = (val: number) => {
    try {
      return new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-US", {
        style: "currency",
        currency: account.currency || "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(val);
    } catch {
      return `${val} ${account.currency}`;
    }
  };

  if (!hasRules) {
    return (
      <div className="card p-5 space-y-4 border border-dashed border-line/80">
        <div className="flex justify-between items-start flex-wrap gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-base text-tx">
                {account.name || dict.journal.accountsTab.mainAccountDefaultName}
              </h4>
              <span className="badge-free text-[10px] uppercase">{account.type}</span>
              <button
                type="button"
                onClick={() => onTogglePrimaryProp(account.id)}
                aria-label={dict.journal.propRules.makePrimary}
                title={dict.journal.propRules.makePrimary}
                className={`p-1 rounded-md transition-colors ${
                  isPrimary ? "text-amber-400 hover:text-amber-300" : "text-mu hover:text-tx"
                }`}
              >
                <Star size={16} fill={isPrimary ? "currentColor" : "none"} />
              </button>
            </div>
            <p className="text-xs text-mu">{dict.journal.propRules.noRulesDesc}</p>
          </div>
          <button
            onClick={() => onOpenRulesModal(account)}
            className="btn text-xs py-2 px-3 flex items-center gap-1.5 font-semibold flex-none"
          >
            <Settings size={14} />
            <span>{dict.journal.propRules.configureBtn}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5 space-y-5 border border-line shadow-lg relative">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-lg text-tx">
              {account.name || dict.journal.accountsTab.mainAccountDefaultName}
            </h4>
            <span className="px-2 py-0.5 rounded bg-vi/20 text-vi text-xs font-semibold border border-vi/30">
              {rules?.phaseLabel || "Phase 1"}
            </span>
            <button
              type="button"
              onClick={() => onTogglePrimaryProp(account.id)}
              aria-label={dict.journal.propRules.makePrimary}
              title={dict.journal.propRules.makePrimary}
              className={`p-1 rounded-md transition-colors ${
                isPrimary ? "text-amber-400 hover:text-amber-300" : "text-mu hover:text-tx"
              }`}
            >
              <Star size={18} fill={isPrimary ? "currentColor" : "none"} />
            </button>
            {isPrimary && (
              <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded font-medium">
                {dict.journal.propRules.primaryBadge}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-mu pt-0.5">
            <span>
              {dict.journal.accountsTab.startBalance}:{" "}
              <b className="text-tx">{formatCurrency(metrics?.initialBalance || 0)}</b>
            </span>
            <span>·</span>
            <span>
              {dict.journal.propRules.balanceLabel}:{" "}
              <b
                className={
                  (metrics?.accumulatedPnL || 0) >= 0
                    ? "text-emerald-400"
                    : "text-rose-400"
                }
              >
                {formatCurrency(metrics?.currentBalance || 0)}
              </b>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onOpenRulesModal(account)}
            className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
          >
            <Settings size={14} />
            <span>{dict.journal.propRules.editBtn}</span>
          </button>
        </div>
      </div>

      {/* Mandatory Disclaimer Box */}
      <div className="p-3 bg-s2/60 border border-line/60 rounded-xl text-xs text-mu space-y-1">
        <div className="flex items-start gap-2">
          <Info size={15} className="text-acc flex-none mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-tx font-medium leading-relaxed">
              {dict.journal.propRules.disclaimer}
            </p>
            <p className="text-[11px] text-mu italic">
              {dict.journal.propRules.unrealizedDisclaimer}
            </p>
          </div>
        </div>
      </div>

      {/* 4 Segmented Progress Bars Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* 1. Daily Loss Limit */}
        {metrics?.dailyLoss ? (
          <div className="p-3 bg-s2/40 border border-line rounded-xl space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-tx flex items-center gap-1">
                <span>{dict.journal.propRules.metrics.dailyLoss}</span>
                <span title={`${dict.journal.propRules.dailyLossTooltip}: ${formatCurrency(metrics.dailyLoss.limitInMoney)}`}>
                  <HelpCircle size={12} className="text-mu" />
                </span>
              </span>
              {getStatusBadge(metrics.dailyLoss.status)}
            </div>

            <div className="w-full bg-s2 rounded-full h-2.5 overflow-hidden border border-line/40">
              <div
                className={`h-full transition-all duration-300 ${getProgressBarColor(
                  metrics.dailyLoss.status
                )}`}
                style={{ width: `${Math.min(100, metrics.dailyLoss.usedPct)}%` }}
              />
            </div>

            <div className="flex justify-between items-center text-[11px] text-mu">
              <span>
                {dict.journal.propRules.metrics.usedRemaining
                  .replace("{used}", formatCurrency(metrics.dailyLoss.usedMoney))
                  .replace("{remaining}", formatCurrency(Math.max(0, metrics.dailyLoss.remainingMoney)))}
              </span>
              <span className="font-mono font-bold text-tx">
                {metrics.dailyLoss.usedPct.toFixed(1)}%
              </span>
            </div>
          </div>
        ) : null}

        {/* 2. Total Drawdown Limit */}
        {metrics?.totalDrawdown ? (
          <div className="p-3 bg-s2/40 border border-line rounded-xl space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-tx flex items-center gap-1">
                <span>{dict.journal.propRules.metrics.totalDrawdown}</span>
                <span title={`${dict.journal.propRules.totalDrawdownTooltip}: ${formatCurrency(metrics.totalDrawdown.drawdownLevel)} (${metrics.totalDrawdown.mode})`}>
                  <HelpCircle size={12} className="text-mu" />
                </span>
              </span>
              {getStatusBadge(metrics.totalDrawdown.status)}
            </div>

            <div className="w-full bg-s2 rounded-full h-2.5 overflow-hidden border border-line/40">
              <div
                className={`h-full transition-all duration-300 ${getProgressBarColor(
                  metrics.totalDrawdown.status
                )}`}
                style={{ width: `${Math.min(100, metrics.totalDrawdown.usedPct)}%` }}
              />
            </div>

            <div className="flex justify-between items-center text-[11px] text-mu">
              <span>
                {dict.journal.propRules.metrics.remainingToLevel.replace(
                  "{remaining}",
                  formatCurrency(Math.max(0, metrics.totalDrawdown.remainingMoney))
                )}
              </span>
              <span className="font-mono font-bold text-tx">
                {metrics.totalDrawdown.usedPct.toFixed(1)}%
              </span>
            </div>
          </div>
        ) : null}

        {/* 3. Profit Target */}
        {metrics?.profitTarget ? (
          <div className="p-3 bg-s2/40 border border-line rounded-xl space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-tx flex items-center gap-1">
                <span>{dict.journal.propRules.metrics.profitTarget}</span>
                <span title={`${dict.journal.propRules.profitTargetTooltip}: ${formatCurrency(metrics.profitTarget.targetInMoney)}`}>
                  <HelpCircle size={12} className="text-mu" />
                </span>
              </span>
              {getStatusBadge(metrics.profitTarget.status)}
            </div>

            <div className="w-full bg-s2 rounded-full h-2.5 overflow-hidden border border-line/40">
              <div
                className="h-full bg-vi transition-all duration-300"
                style={{ width: `${Math.min(100, metrics.profitTarget.progressPct)}%` }}
              />
            </div>

            <div className="flex justify-between items-center text-[11px] text-mu">
              <span>
                {dict.journal.propRules.profitLabel}: {formatCurrency(metrics.profitTarget.currentProfit)} /{" "}
                {formatCurrency(metrics.profitTarget.targetInMoney)}
              </span>
              <span className="font-mono font-bold text-tx">
                {metrics.profitTarget.progressPct.toFixed(1)}%
              </span>
            </div>
          </div>
        ) : null}

        {/* 4. Trading Days */}
        {metrics?.tradingDays ? (
          <div className="p-3 bg-s2/40 border border-line rounded-xl space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-tx flex items-center gap-1">
                <span>{dict.journal.propRules.metrics.tradingDays}</span>
                <span title={`${dict.journal.propRules.minDaysTooltip}: ${metrics.tradingDays.minTradingDays || "—"}`}>
                  <HelpCircle size={12} className="text-mu" />
                </span>
              </span>
              {getStatusBadge(metrics.tradingDays.status)}
            </div>

            {metrics.tradingDays.minTradingDays ? (
              <div className="w-full bg-s2 rounded-full h-2.5 overflow-hidden border border-line/40">
                <div
                  className="h-full bg-acc transition-all duration-300"
                  style={{
                    width: `${Math.min(
                      100,
                      (metrics.tradingDays.count / metrics.tradingDays.minTradingDays) * 100
                    )}%`,
                  }}
                />
              </div>
            ) : null}

            <div className="flex justify-between items-center text-[11px] text-mu">
              <span>
                {dict.journal.propRules.metrics.daysProgress
                  .replace("{current}", String(metrics.tradingDays.count))
                  .replace("{min}", String(metrics.tradingDays.minTradingDays || "—"))}
              </span>
              {metrics.tradingDays.remainingDaysToMax != null && (
                <span className="font-mono text-tx">
                  {dict.journal.propRules.metrics.daysRemaining.replace(
                    "{remaining}",
                    String(metrics.tradingDays.remainingDaysToMax)
                  )}
                </span>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Consistency Rule Notice if defined */}
      {metrics?.consistency && (
        <div className="p-2.5 bg-s2/40 border border-line/40 rounded-lg text-xs flex justify-between items-center text-mu">
          <span>{dict.journal.propRules.wizard.consistencyRule}:</span>
          <b
            className={
              metrics.consistency.isPassing ? "text-emerald-400 font-mono" : "text-amber-300 font-mono"
            }
          >
            {dict.journal.propRules.metrics.consistencyUsage
              .replace("{share}", metrics.consistency.maxSingleDaySharePct.toFixed(1))
              .replace("{max}", String(metrics.consistency.allowedSharePct))}
          </b>
        </div>
      )}

      {/* Toggle Days History Table */}
      <div className="pt-2 border-t border-line/40 space-y-3">
        <button
          type="button"
          onClick={() => setShowDaysList(!showDaysList)}
          className="btn-ghost text-xs py-1 px-3 w-full flex items-center justify-between text-mu hover:text-tx"
        >
          <span>{dict.journal.propRules.daysList.title}</span>
          {showDaysList ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showDaysList && (
          <PropDaysList
            daysHistory={metrics?.daysHistory || []}
            currency={account.currency || "USD"}
            dict={dict}
            lang={lang}
          />
        )}
      </div>

      {/* Past Phases Archive Toggle */}
      {rules?.phaseHistory && rules.phaseHistory.length > 0 && (
        <div className="pt-2 border-t border-line/40 space-y-2">
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className="btn-ghost text-xs py-1 px-3 w-full flex items-center justify-between text-mu hover:text-tx"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <History size={14} />
              <span>
                {dict.journal.propRules.phaseHistoryTitle} ({rules.phaseHistory.length})
              </span>
            </span>
            {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showHistory && (
            <div className="space-y-2 pt-1">
              {rules.phaseHistory.map((item, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-s2/40 border border-line/60 rounded-xl text-xs space-y-1.5"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-tx">{item.phaseLabel}</span>
                    {item.userOutcome && (
                      <span className="chip text-[10px] capitalize">{item.userOutcome}</span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] text-mu">
                    <div>{dict.journal.propRules.history.finalBalance.replace("{val}", formatCurrency(item.finalBalance))}</div>
                    <div>{dict.journal.propRules.history.pnl.replace("{val}", formatCurrency(item.closedPnl))}</div>
                    <div>{dict.journal.propRules.history.days.replace("{val}", String(item.tradingDays))}</div>
                    {item.maxDailyLossUsedPct != null && (
                      <div>{dict.journal.propRules.history.dailyLoss.replace("{val}", item.maxDailyLossUsedPct.toFixed(1))}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
