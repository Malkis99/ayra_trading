"use client";

import React, { useState, useMemo } from "react";
import { Account, Strategy, Trade } from "@/lib/journal/types";
import {
  calculateJournalAnalytics,
  calculateEquityCurve,
  calculateReportSlice,
  type ReportSliceRow,
  type ReportSliceType,
} from "@/lib/journal/stats";
import { EquityCurve } from "./EquityCurve";
import { CalendarTab } from "./CalendarTab";
import { ProcessMatrix } from "./ProcessMatrix";
import { HelpCircle, Sparkles, AlertCircle, Shield, Search } from "lucide-react";
import { calculatePropMetrics } from "@/lib/journal/prop";
import { formatString } from "@/lib/i18n";
import { Button, EmptyState, FilterChip, Input, Modal } from "@/components/ui";
import { cn } from "@/components/ui/cn";

interface DashboardTabProps {
  trades: Trade[];
  accounts: Account[];
  strategies?: Strategy[];
  unit: "R" | "money" | "percent";
  onUnitChange: (unit: "R" | "money" | "percent") => void;
  onGoToTrades: () => void;
  onAddTradeForDate?: (dateStr: string) => void;
  isDemoMode: boolean;
  onEnableDemoMode: () => void;
  onExitDemoMode: () => void;
  dict: any;
  lang: string;
}

type MetricKey = "result" | "winrate" | "profitFactor" | "expectancyR" | "avgWinLoss" | "trades" | "drawdown";

/** Section title used across the analytics tab. */
function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="text-base font-semibold text-tx">{children}</h3>
      {aside}
    </div>
  );
}

/**
 * Journal analytics: filters, key metrics (with explanations), equity curve, calendar heatmap,
 * breakdowns by session / strategy / mistake and the Process × Outcome matrix.
 * All numbers come from lib/journal/stats (unchanged).
 */
export const DashboardTab: React.FC<DashboardTabProps> = ({
  trades,
  accounts,
  strategies = [],
  unit,
  onGoToTrades,
  onAddTradeForDate,
  isDemoMode,
  onEnableDemoMode,
  onExitDemoMode,
  dict,
  lang,
}) => {
  const a = dict.journal.analytics;
  const [filterAccount, setFilterAccount] = useState<string>("all");
  const [filterPeriod, setFilterPeriod] = useState<string>("30d"); // 'currentMonth' | '7d' | '30d' | '90d' | 'all'
  const [filterVerification, setFilterVerification] = useState<string>("all"); // 'all' | 'verified'
  const [filterInstrument, setFilterInstrument] = useState<string>("");
  const [activeTooltip, setActiveTooltip] = useState<MetricKey | null>(null);

  const filteredTrades = useMemo(() => {
    const nowMs = Date.now();
    const now = new Date();
    return trades.filter((t) => {
      if (t.status !== "closed") return false;
      if (filterAccount !== "all" && t.accountId !== filterAccount) return false;
      if (filterVerification === "verified" && t.verification !== "verified") return false;
      if (filterInstrument.trim() && !t.instrument.toUpperCase().includes(filterInstrument.trim().toUpperCase())) return false;
      const tradeMs = new Date(t.closedAt || t.openedAt || t.createdAt).getTime();
      const diffDays = (nowMs - tradeMs) / (1000 * 60 * 60 * 24);
      if (filterPeriod === "7d" && diffDays > 7) return false;
      if (filterPeriod === "30d" && diffDays > 30) return false;
      if (filterPeriod === "90d" && diffDays > 90) return false;
      if (filterPeriod === "currentMonth") {
        const d = new Date(t.closedAt || t.openedAt || t.createdAt);
        if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return false;
      }
      return true;
    });
  }, [trades, filterAccount, filterPeriod, filterVerification, filterInstrument]);

  const analytics = useMemo(() => calculateJournalAnalytics(filteredTrades, accounts), [filteredTrades, accounts]);

  const propAccountsWithRules = useMemo(
    () => accounts.filter((acc) => acc.type === "prop" && !acc.archivedAt && acc.propRules && acc.propRules.startedAt),
    [accounts]
  );

  const processMetrics = useMemo(() => {
    const rated = filteredTrades.filter(
      (t) => (typeof t.processScore === "number" && t.processScore >= 0) || (typeof t.executionRating === "number" && t.executionRating > 0)
    );
    if (rated.length === 0) return { avgScore: null, compliancePercent: null };
    const scores = rated.map((t) => (typeof t.processScore === "number" ? t.processScore : (t.executionRating || 3) * 20));
    const avg = Math.round(scores.reduce((x, y) => x + y, 0) / scores.length);
    const goodCount = scores.filter((s) => s >= 80).length;
    return { avgScore: avg, compliancePercent: Math.round((goodCount / scores.length) * 100) };
  }, [filteredTrades]);

  const equityPoints = useMemo(() => calculateEquityCurve(filteredTrades, accounts), [filteredTrades, accounts]);

  const slices = useMemo(() => {
    const make = (type: ReportSliceType) =>
      calculateReportSlice(type, filteredTrades, accounts)
        .filter((r) => r.tradesCount > 0)
        .sort((x, y) => y.tradesCount - x.tradesCount)
        .slice(0, 6);
    return { session: make("session"), strategy: make("strategy"), mistake: make("mistake") };
  }, [filteredTrades, accounts]);

  const selectedAcc = accounts.find((acc) => acc.id === filterAccount);
  const currencySymbol = selectedAcc?.currency || "USD";

  const formatValue = (val: number | null, overrideUnit?: "R" | "money" | "percent") => {
    if (val === null || val === undefined) return "—";
    const targetUnit = overrideUnit || unit;
    if (targetUnit === "R") return `${val > 0 ? "+" : ""}${val.toFixed(2)} R`;
    if (targetUnit === "percent") return `${val > 0 ? "+" : ""}${val.toFixed(2)}%`;
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

  const hasData = filteredTrades.length > 0 || isDemoMode;
  const lowData = analytics.hasLowData ? formatString(dict.journal.dashboard.kpi.lowDataTag, { count: analytics.totalTrades }) : null;
  const resultValue = unit === "R" ? analytics.totalR : unit === "percent" ? analytics.totalPnlPercent : analytics.totalMoney;
  const toneOf = (v: number | null | undefined) => (v == null || v === 0 ? "text-tx" : v > 0 ? "text-long" : "text-short");
  const shots = filteredTrades.filter((t) => t.attachmentIds && t.attachmentIds.length > 0).length;

  const metrics: Array<{ key: string; help?: MetricKey; label: string; value: React.ReactNode; tone?: string; sub?: React.ReactNode }> = [
    { key: "result", help: "result", label: dict.journal.dashboard.kpi.result, value: formatValue(resultValue ?? null), tone: toneOf(resultValue), sub: lowData },
    {
      key: "winrate",
      help: "winrate",
      label: dict.journal.dashboard.kpi.winrate,
      value: `${(analytics.winRate * 100).toFixed(1)}%`,
      sub:
        analytics.totalTrades > 0 ? (
          <span className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-s2" aria-hidden="true">
            <span className="bg-long" style={{ width: `${(analytics.winsCount / analytics.totalTrades) * 100}%` }} />
            <span className="bg-mu/50" style={{ width: `${(analytics.breakevenCount / analytics.totalTrades) * 100}%` }} />
            <span className="bg-short" style={{ width: `${(analytics.lossesCount / analytics.totalTrades) * 100}%` }} />
          </span>
        ) : null,
    },
    {
      key: "profitFactor",
      help: "profitFactor",
      label: dict.journal.dashboard.kpi.profitFactor,
      value:
        unit === "money" && analytics.profitFactorMoney !== null
          ? analytics.profitFactorMoney.toFixed(2)
          : analytics.profitFactorR !== null
          ? analytics.profitFactorR.toFixed(2)
          : "—",
    },
    {
      key: "expectancyR",
      help: "expectancyR",
      label: dict.journal.dashboard.kpi.expectancyR,
      value: analytics.expectancyR !== null ? formatValue(analytics.expectancyR, "R") : "—",
      tone: toneOf(analytics.expectancyR),
      sub: formatString(a.rKnown, { known: analytics.knownRCount, total: analytics.totalTrades }),
    },
    {
      key: "avgWinLoss",
      help: "avgWinLoss",
      label: dict.journal.dashboard.kpi.avgWinLoss,
      value: (
        <span className="text-base">
          <span className="text-long">{analytics.avgWinR !== null ? `+${analytics.avgWinR.toFixed(2)}R` : "—"}</span>
          <span className="mx-1 text-mu">/</span>
          <span className="text-short">{analytics.avgLossR !== null ? `${analytics.avgLossR.toFixed(2)}R` : "—"}</span>
        </span>
      ),
      sub: `${a.payoff}: ${analytics.payoff !== null ? analytics.payoff.toFixed(2) : "—"}`,
    },
    {
      key: "trades",
      help: "trades",
      label: dict.journal.dashboard.kpi.trades,
      value: analytics.totalTrades,
      sub: formatString(a.tradesPerDay, { value: analytics.tradesPerDay.toFixed(1) }),
    },
    {
      key: "drawdown",
      help: "drawdown",
      label: dict.journal.dashboard.kpi.drawdown,
      value:
        unit === "money" && analytics.maxDrawdownMoney !== null
          ? `-${analytics.maxDrawdownMoney.toFixed(0)} ${currencySymbol}`
          : `-${analytics.maxDrawdownR.toFixed(2)} R`,
      tone: analytics.maxDrawdownR > 0 ? "text-short" : "text-tx",
      sub: a.peakToTrough,
    },
    {
      key: "process",
      label: dict.journal.processScoreLabel,
      value: processMetrics.avgScore !== null ? `${processMetrics.avgScore}/100` : "—",
      tone: "text-vi",
    },
    {
      key: "rules",
      label: `${dict.journal.ruleChecklistTitle}, %`,
      value: processMetrics.compliancePercent !== null ? `${processMetrics.compliancePercent}%` : "—",
      sub: a.rulesFollowed,
    },
    {
      key: "screenshots",
      label: dict.journal.attachments.statsCard,
      value: filteredTrades.length < 20 ? `${shots} / ${filteredTrades.length}` : `${Math.round((shots / Math.max(1, filteredTrades.length)) * 100)}%`,
      sub: filteredTrades.length < 20 ? formatString(dict.journal.dashboard.kpi.lowDataTag, { count: filteredTrades.length }) : `${shots} / ${filteredTrades.length}`,
    },
  ];

  const sliceLabel = (type: "session" | "strategy" | "mistake", key: string) => {
    if (type === "strategy") {
      if (key === "no_strategy") return dict.journal.noStrategySelected;
      return strategies.find((s) => s.id === key)?.name || dict.journal.strategiesTab.defaultName;
    }
    if (type === "session") return dict.journal.sessions[key] || key;
    if (key === "none") return dict.journal.overview.filters.withoutMistakes;
    return dict.journal.mistakes[key] || key;
  };

  const SliceCard = ({ title, type, rows }: { title: string; type: "session" | "strategy" | "mistake"; rows: ReportSliceRow[] }) => {
    const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.totalR)));
    return (
      <div className="rounded-lg border border-line bg-s1 p-4" data-testid={`slice-${type}`}>
        <h4 className="mb-3 text-sm font-semibold text-tx">{title}</h4>
        {rows.length === 0 ? (
          <p className="text-sm text-mu">{a.noBreakdown}</p>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((r) => (
              <li key={r.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate text-tx">{sliceLabel(type, r.key)}</span>
                  <span className={cn("shrink-0 font-semibold tabular-nums", toneOf(r.totalR))}>{formatValue(r.totalR, "R")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-s2" aria-hidden="true">
                    <span
                      className={cn("block h-full rounded-full", r.totalR >= 0 ? "bg-long" : "bg-short")}
                      style={{ width: `${Math.max(3, (Math.abs(r.totalR) / maxAbs) * 100)}%` }}
                    />
                  </span>
                  <span className="shrink-0 text-xs text-mu">
                    {formatString(a.tradesCount, { count: r.tradesCount })} · {formatString(a.winRateValue, { value: Math.round(r.winRate * 100) })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {isDemoMode && (
        <div className="flex flex-col items-start justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2.5">
            <Sparkles size={18} className="flex-none text-amber-300" aria-hidden="true" />
            <div>
              <b className="block text-sm font-semibold text-amber-100">{dict.journal.dashboard.demoMode.banner}</b>
              <p className="mt-0.5 text-xs text-mu">{dict.journal.dashboard.demoMode.infoNote}</p>
            </div>
          </div>
          <Button variant="secondary" onClick={onExitDemoMode}>
            {dict.journal.dashboard.demoMode.exitDemoBtn}
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-3 rounded-lg border border-line bg-s1 p-3">
        <div className="-mx-1 flex flex-wrap gap-2 px-1">
          <FilterChip
            name={dict.journal.overview.filters.account}
            value={filterAccount === "all" ? null : filterAccount}
            onChange={(v) => setFilterAccount(v ?? "all")}
            clearLabel={dict.journal.overview.filters.clearFilter}
            options={accounts.map((acc) => ({ value: acc.id, label: acc.name || dict.journal.accountsTab.mainAccountDefaultName }))}
          />
          <FilterChip
            name={dict.journal.overview.filters.period}
            value={filterPeriod}
            onChange={(v) => setFilterPeriod(v ?? "all")}
            clearLabel={dict.journal.overview.filters.clearFilter}
            options={[
              { value: "7d", label: dict.journal.dashboard.filters.period7d },
              { value: "30d", label: dict.journal.dashboard.filters.period30d },
              { value: "90d", label: dict.journal.dashboard.filters.period90d },
              { value: "currentMonth", label: dict.journal.dashboard.filters.periodCurrentMonth },
              { value: "all", label: dict.journal.dashboard.filters.periodAll },
            ]}
          />
          <FilterChip
            name={a.verification}
            value={filterVerification === "all" ? null : filterVerification}
            onChange={(v) => setFilterVerification(v ?? "all")}
            clearLabel={dict.journal.overview.filters.clearFilter}
            options={[{ value: "verified", label: dict.journal.dashboard.filters.verificationVerified }]}
          />
          <Input
            aria-label={dict.journal.tradesTab.searchPlaceholder}
            value={filterInstrument}
            onChange={(e) => setFilterInstrument(e.target.value)}
            placeholder={dict.journal.tradesTab.searchPlaceholder}
            leading={<Search size={16} aria-hidden="true" />}
            className="min-h-[40px]"
            containerClassName="min-w-[200px] flex-1 sm:max-w-xs"
          />
        </div>
        {analytics.isMultiCurrency && filterAccount === "all" && unit === "money" && (
          <p className="flex items-center gap-1.5 text-xs text-amber-200">
            <AlertCircle size={14} className="flex-none" aria-hidden="true" />
            <span>{dict.journal.dashboard.multiCurrencyWarning}</span>
          </p>
        )}
      </div>

      {/* Prop Account Dashboard Block */}
      {(() => {
        if (filterAccount !== "all") {
          const acc = accounts.find((a) => a.id === filterAccount);
          if (acc && acc.type === "prop" && acc.propRules && acc.propRules.startedAt) {
            const metrics = calculatePropMetrics(acc, trades);
            if (!metrics) return null;

            return (
              <div className="card p-4 bg-s2/60 border border-line space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield size={16} className="text-vi" />
                    <b className="text-xs font-bold text-tx">{acc.name || dict.journal.accountsTab.mainAccountDefaultName}</b>
                    <span className="chip text-[10px] uppercase">{acc.propRules.phaseLabel || "Prop"}</span>
                  </div>
                  <button onClick={onGoToTrades} className="text-xs text-vi hover:underline flex items-center gap-1 font-medium">
                    <span>{dict.journal.propRules.homeBlock.viewDetails}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {metrics.dailyLoss && (
                    <div className="p-2 bg-s1 rounded-lg border border-line">
                      <span className="text-mu block text-[10px]">{dict.journal.propRules.metrics.dailyLoss}</span>
                      <b className="text-tx font-mono">{metrics.dailyLoss.usedPct.toFixed(1)}%</b>
                    </div>
                  )}
                  {metrics.totalDrawdown && (
                    <div className="p-2 bg-s1 rounded-lg border border-line">
                      <span className="text-mu block text-[10px]">{dict.journal.propRules.metrics.totalDrawdown}</span>
                      <b className="text-tx font-mono">{metrics.totalDrawdown.usedPct.toFixed(1)}%</b>
                    </div>
                  )}
                  {metrics.profitTarget && (
                    <div className="p-2 bg-s1 rounded-lg border border-line">
                      <span className="text-mu block text-[10px]">{dict.journal.propRules.metrics.profitTarget}</span>
                      <b className="text-tx font-mono">{metrics.profitTarget.progressPct.toFixed(1)}%</b>
                    </div>
                  )}
                  {metrics.tradingDays && (
                    <div className="p-2 bg-s1 rounded-lg border border-line">
                      <span className="text-mu block text-[10px]">{dict.journal.propRules.metrics.tradingDays}</span>
                      <b className="text-tx font-mono">{metrics.tradingDays.count} / {metrics.tradingDays.minTradingDays || "—"}</b>
                    </div>
                  )}
                </div>
              </div>
            );
          }
        } else if (propAccountsWithRules.length > 0) {
          return (
            <div className="card p-3.5 bg-s2/40 border border-line space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-mu flex items-center gap-1.5">
                  <Shield size={14} className="text-vi" />
                  <span>{dict.journal.propRules.title} ({propAccountsWithRules.length})</span>
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {propAccountsWithRules.map((pAcc) => {
                  const pMetrics = calculatePropMetrics(pAcc, trades);
                  return (
                    <div key={pAcc.id} className="p-2.5 bg-s1 border border-line rounded-lg space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-tx text-[11px] truncate max-w-[120px]">
                          {pAcc.name || dict.journal.accountsTab.mainAccountDefaultName}
                        </span>
                        <span className="chip text-[9px]">{pAcc.propRules?.phaseLabel || "Prop"}</span>
                      </div>
                      <div className="flex justify-between text-[10px] text-mu font-mono">
                        <span>DL: {pMetrics?.dailyLoss ? `${pMetrics.dailyLoss.usedPct.toFixed(0)}%` : "—"}</span>
                        <span>DD: {pMetrics?.totalDrawdown ? `${pMetrics.totalDrawdown.usedPct.toFixed(0)}%` : "—"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }
        return null;
      })()}


      {filteredTrades.length === 0 && !isDemoMode && (
        <EmptyState
          icon={<Sparkles size={18} />}
          title={dict.journal.tradesTab.emptyTitle}
          description={dict.journal.tradesTab.emptyDesc}
          action={
            <Button onClick={onEnableDemoMode}>
              <Sparkles size={16} aria-hidden="true" />
              <span>{dict.journal.dashboard.demoMode.showExampleBtn}</span>
            </Button>
          }
        />
      )}

      {hasData && (
        <section>
          <SectionTitle>{a.keyMetrics}</SectionTitle>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {metrics.map((m) => (
              <div key={m.key} className="rounded-lg border border-line bg-s1 px-3 py-2.5" data-metric={m.key}>
                <dt className="flex items-center justify-between gap-1 text-xs font-medium text-mu">
                  <span className="truncate">{m.label}</span>
                  {m.help && (
                    <button
                      type="button"
                      onClick={() => setActiveTooltip(m.help!)}
                      aria-label={formatString(a.helpLabel, { name: m.label })}
                      className="-mr-1.5 grid h-7 w-7 shrink-0 place-items-center rounded text-mu hover:bg-s2 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                    >
                      <HelpCircle size={14} aria-hidden="true" />
                    </button>
                  )}
                </dt>
                <dd className={cn("mt-0.5 text-lg font-semibold tabular-nums", m.tone ?? "text-tx")}>{m.value}</dd>
                {m.sub && <dd className="text-xs text-mu">{m.sub}</dd>}
              </div>
            ))}
          </dl>
        </section>
      )}

      {hasData && <EquityCurve points={equityPoints} unit={unit} currencySymbol={currencySymbol} dict={dict} />}

      <section>
        <CalendarTab trades={trades} accounts={accounts} unit={unit} onAddTradeForDate={onAddTradeForDate ?? (() => {})} dict={dict} lang={lang} />
      </section>

      {hasData && (
        <section>
          <SectionTitle>{a.breakdownTitle}</SectionTitle>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <SliceCard title={a.bySession} type="session" rows={slices.session} />
            <SliceCard title={a.byStrategy} type="strategy" rows={slices.strategy} />
            <SliceCard title={a.byMistake} type="mistake" rows={slices.mistake} />
          </div>
        </section>
      )}

      {hasData && <ProcessMatrix trades={filteredTrades} dict={dict} />}

      <Modal
        isOpen={activeTooltip !== null}
        onClose={() => setActiveTooltip(null)}
        title={activeTooltip ? dict.journal.dashboard.kpi[activeTooltip] : ""}
        closeLabel={a.helpClose}
        size="sm"
      >
        <p className="text-sm leading-relaxed text-mu">{activeTooltip ? dict.journal.dashboard.kpi.tooltips[activeTooltip] : ""}</p>
      </Modal>
    </div>
  );
};
