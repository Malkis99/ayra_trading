"use client";

import React, { useState, useMemo } from "react";
import { Trade, Account } from "@/lib/journal/types";
import {
  calculateReportSlice,
  ReportSliceType,
  ReportSliceRow,
  generateReportCSV,
} from "@/lib/journal/stats";
import { ProcessMatrix } from "./ProcessMatrix";
import { Download, ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";

interface ReportsTabProps {
  trades: Trade[];
  accounts: Account[];
  unit: "R" | "money" | "percent";
  dict: any;
  lang: string;
}

export const ReportsTab: React.FC<ReportsTabProps> = ({
  trades,
  accounts,
  unit,
  dict,
  lang,
}) => {
  const [sliceType, setSliceType] = useState<ReportSliceType>("instrument");

  // Filters State
  const [filterAccount, setFilterAccount] = useState<string>("all");
  const [filterPeriod, setFilterPeriod] = useState<string>("30d");
  const [filterVerification, setFilterVerification] = useState<string>("all");

  // Table Sort State
  const [sortField, setSortField] = useState<keyof ReportSliceRow>("tradesCount");
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // Filter Trades
  const filteredTrades = useMemo(() => {
    const nowMs = Date.now();
    const now = new Date();

    return trades.filter((t) => {
      if (t.status !== "closed") return false;
      if (filterAccount !== "all" && t.accountId !== filterAccount) return false;
      if (filterVerification === "verified" && t.verification !== "verified")
        return false;

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
  }, [trades, filterAccount, filterPeriod, filterVerification]);

  // Aggregate Report Slice Rows
  const rawRows = useMemo(() => {
    return calculateReportSlice(sliceType, filteredTrades, accounts);
  }, [sliceType, filteredTrades, accounts]);

  // Sort Rows
  const sortedRows = useMemo(() => {
    return [...rawRows].sort((a, b) => {
      const valA = a[sortField] ?? 0;
      const valB = b[sortField] ?? 0;

      if (typeof valA === "string" && typeof valB === "string") {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }

      const numA = Number(valA);
      const numB = Number(valB);
      return sortAsc ? numA - numB : numB - numA;
    });
  }, [rawRows, sortField, sortAsc]);

  // Max absolute totalR for scaling horizontal bars
  const maxAbsR = useMemo(() => {
    const maxVal = Math.max(0, ...rawRows.map((r) => Math.abs(r.totalR)));
    return maxVal || 1;
  }, [rawRows]);

  // Identify Best & Worst Groups
  const { bestKey, worstKey } = useMemo(() => {
    if (rawRows.length < 2) return { bestKey: null, worstKey: null };
    let best = rawRows[0];
    let worst = rawRows[0];

    rawRows.forEach((r) => {
      if (r.totalR > best.totalR) best = r;
      if (r.totalR < worst.totalR) worst = r;
    });

    return {
      bestKey: best.totalR > 0 ? best.key : null,
      worstKey: worst.totalR < 0 ? worst.key : null,
    };
  }, [rawRows]);

  const handleSort = (field: keyof ReportSliceRow) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  // CSV Export Download
  const handleDownloadCSV = () => {
    const csvContent = generateReportCSV(sortedRows, {
      group: dict.journal.reports.table.group,
      trades: dict.journal.reports.table.trades,
      winrate: dict.journal.reports.table.winrate,
      avgR: dict.journal.reports.table.avgR,
      sumR: dict.journal.reports.table.sumR,
      profitFactor: dict.journal.reports.table.profitFactor,
    });

    const blob = new Blob(["\uFEFF" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateStr = new Date().toISOString().split("T")[0];
    link.href = url;
    link.download = `ayra-report-${sliceType}-${dateStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const sliceList: { id: ReportSliceType; label: string }[] = [
    { id: "instrument", label: dict.journal.reports.slices.instrument },
    { id: "session", label: dict.journal.reports.slices.session },
    { id: "dayOfWeek", label: dict.journal.reports.slices.dayOfWeek },
    { id: "entryHour", label: dict.journal.reports.slices.entryHour },
    { id: "direction", label: dict.journal.reports.slices.direction },
    { id: "emotionBefore", label: dict.journal.reports.slices.emotionBefore },
    { id: "mistake", label: dict.journal.reports.slices.mistake },
    { id: "executionRating", label: dict.journal.reports.slices.executionRating },
    { id: "account", label: dict.journal.reports.slices.account },
  ];

  // Helper to display localized group labels
  const formatGroupLabel = (key: string) => {
    if (sliceType === "session") {
      return (dict.journal.sessions as any)[key] || key;
    }
    if (sliceType === "emotionBefore" || sliceType === "emotionAfter") {
      return (dict.journal.emotions as any)[key] || key;
    }
    if (sliceType === "mistake") {
      return (dict.journal.mistakes as any)[key] || key;
    }
    if (sliceType === "dayOfWeek") {
      const idx = parseInt(key, 10);
      const refDate = new Date(2026, 2, 1 + idx); // 2026-03-01 is Sunday
      return refDate.toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
        weekday: "long",
      });
    }
    return key;
  };

  return (
    <div className="space-y-5">
      {/* Top Filter Controls */}
      <div className="card p-3.5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="h3 font-serif">{dict.journal.reports.title}</h3>

          <div className="flex gap-2 text-xs">
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

            <button
              onClick={handleDownloadCSV}
              disabled={sortedRows.length === 0}
              className="btn text-xs py-1.5 px-3 flex items-center gap-1.5 font-semibold disabled:opacity-40"
            >
              <Download size={14} />
              <span>{dict.journal.reports.downloadCsvBtn}</span>
            </button>
          </div>
        </div>

        {/* Slice Selector Chips */}
        <div className="flex gap-1.5 overflow-x-auto text-xs pb-1 pt-1">
          {sliceList.map((item) => {
            const isActive = sliceType === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setSliceType(item.id)}
                className={`chip cursor-pointer transition-colors whitespace-nowrap ${
                  isActive ? "border-vi text-tx font-bold bg-s2" : "text-mu"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Process x Outcome Matrix */}
      <ProcessMatrix trades={filteredTrades} dict={dict} />

      {/* Aggregated Slice Table */}
      <div className="card p-0 overflow-hidden space-y-0">
        <div className="p-3 bg-s2/60 border-b border-line flex justify-between items-center text-xs">
          <b className="text-tx">
            {dict.journal.reports.slices[sliceType]} ({sortedRows.length})
          </b>
        </div>

        {sortedRows.length === 0 ? (
          <div className="p-8 text-center text-xs text-mu">
            {dict.journal.dashboard.equityCurve.emptyState}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-s2/80 text-mu font-semibold border-b border-line select-none">
                <tr>
                  <th
                    onClick={() => handleSort("key")}
                    className="p-3 cursor-pointer hover:text-tx transition-colors"
                  >
                    <div className="flex items-center gap-1">
                      <span>{dict.journal.reports.table.group}</span>
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("tradesCount")}
                    className="p-3 text-right cursor-pointer hover:text-tx transition-colors"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>{dict.journal.reports.table.trades}</span>
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("winRate")}
                    className="p-3 text-right cursor-pointer hover:text-tx transition-colors"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>{dict.journal.reports.table.winrate}</span>
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("avgR")}
                    className="p-3 text-right cursor-pointer hover:text-tx transition-colors"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>{dict.journal.reports.table.avgR}</span>
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("totalR")}
                    className="p-3 text-right cursor-pointer hover:text-tx transition-colors"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>{dict.journal.reports.table.sumR}</span>
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("profitFactor")}
                    className="p-3 text-right cursor-pointer hover:text-tx transition-colors"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>{dict.journal.reports.table.profitFactor}</span>
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th className="p-3 text-center">
                    {dict.journal.reports.table.resultBar}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/40">
                {sortedRows.map((row) => {
                  const label = formatGroupLabel(row.key);
                  const barWidthPercent = Math.min(
                    100,
                    Math.round((Math.abs(row.totalR) / maxAbsR) * 100)
                  );
                  const isPositive = row.totalR >= 0;
                  const isBest = row.key === bestKey;
                  const isWorst = row.key === worstKey;

                  return (
                    <tr
                      key={row.key}
                      className="hover:bg-s2/60 transition-colors"
                    >
                      <td className="p-3 font-semibold text-tx">
                        <div className="flex items-center gap-2">
                          <span>{label}</span>
                          {row.hasLowData && (
                            <span className="text-[9px] text-mu bg-white/5 border border-line px-1 rounded">
                              {dict.journal.dashboard.kpi.lowDataTag.replace(
                                "{count}",
                                String(row.tradesCount)
                              )}
                            </span>
                          )}
                          {isBest && (
                            <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9px] px-1 rounded font-bold">
                              {dict.journal.reports.table.bestGroup}
                            </span>
                          )}
                          {isWorst && (
                            <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[9px] px-1 rounded font-bold">
                              {dict.journal.reports.table.worstGroup}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono text-mu">
                        {row.tradesCount}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-tx">
                        {(row.winRate * 100).toFixed(1)}%
                      </td>
                      <td className="p-3 text-right font-mono text-tx">
                        {row.avgR !== null ? `${row.avgR > 0 ? "+" : ""}${row.avgR} R` : "—"}
                      </td>
                      <td
                        className={`p-3 text-right font-mono font-bold ${
                          row.totalR > 0
                            ? "text-emerald-400"
                            : row.totalR < 0
                            ? "text-rose-400"
                            : "text-tx"
                        }`}
                      >
                        {row.totalR > 0 ? `+${row.totalR} R` : `${row.totalR} R`}
                      </td>
                      <td className="p-3 text-right font-mono text-tx">
                        {row.profitFactor !== null ? row.profitFactor.toFixed(2) : "—"}
                      </td>
                      <td className="p-3 w-28">
                        {/* Horizontal Bar */}
                        <div className="w-full bg-s2 rounded-full h-2 overflow-hidden border border-line/40">
                          <div
                            style={{ width: `${barWidthPercent}%` }}
                            className={`h-full ${
                              isPositive ? "bg-emerald-500" : "bg-rose-500"
                            }`}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
