"use client";

import React, { useMemo } from "react";
import type { Account, Trade } from "@/lib/journal/types";
import { calculateKpis, filterTradesByPeriod, type KpiPeriod } from "@/lib/journal/overview";
import { formatString } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n/types";
import { Segmented } from "@/components/ui";
import { cn } from "@/components/ui/cn";

export type JournalUnit = "R" | "money" | "percent";

export function formatSignedR(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)} R`;
}

export function formatSignedMoney(v: number | null | undefined, currency: string | null, lang: string): string {
  if (v == null || Number.isNaN(v)) return "—";
  try {
    const s = new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-US", {
      style: "currency",
      currency: currency ?? "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(v);
    return v > 0 ? `+${s}` : s;
  } catch {
    return `${v > 0 ? "+" : ""}${v} ${currency ?? ""}`.trim();
  }
}

const toneOf = (v: number | null | undefined) => (v == null || v === 0 ? "text-tx" : v > 0 ? "text-long" : "text-short");

type Props = {
  trades: Trade[];
  accounts: Account[];
  tz: string;
  unit: JournalUnit;
  onUnitChange: (u: JournalUnit) => void;
  period: KpiPeriod;
  onPeriodChange: (p: KpiPeriod) => void;
  dict: Dictionary;
  lang: string;
};

/** Compact KPI strip: result, win rate, average R, Process Score and clean-days streak for the chosen period. */
export function JournalKpiStrip({ trades, accounts, tz, unit, onUnitChange, period, onPeriodChange, dict, lang }: Props) {
  const t = dict.journal.overview;
  const k = useMemo(
    () => calculateKpis(filterTradesByPeriod(trades, period, tz), trades, accounts, tz),
    [trades, accounts, period, tz]
  );

  const result =
    unit === "money"
      ? { text: k.currency ? formatSignedMoney(k.totalMoney, k.currency, lang) : "—", value: k.totalMoney }
      : unit === "percent"
      ? { text: k.totalPnlPercent == null ? "—" : `${k.totalPnlPercent > 0 ? "+" : ""}${k.totalPnlPercent.toFixed(2)}%`, value: k.totalPnlPercent }
      : { text: k.tradesCount ? formatSignedR(k.totalR) : "—", value: k.tradesCount ? k.totalR : null };

  const tiles: Array<{ key: string; label: string; value: string; tone?: string; sub?: string }> = [
    { key: "result", label: t.kpiResult, value: result.text, tone: toneOf(result.value), sub: formatString(t.tradesCount, { count: k.tradesCount }) },
    { key: "winrate", label: t.kpiWinRate, value: k.winRate == null ? "—" : `${Math.round(k.winRate * 100)}%` },
    { key: "avgr", label: t.kpiAvgR, value: formatSignedR(k.avgR), tone: toneOf(k.avgR) },
    { key: "process", label: t.kpiProcess, value: k.processScore == null ? "—" : `${k.processScore}/100` },
    { key: "clean", label: t.kpiCleanDays, value: String(k.cleanDays) },
  ];

  return (
    <section aria-label={t.kpiResult} className="rounded-lg border border-line bg-s1 p-3 md:p-4" data-testid="journal-kpis">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<KpiPeriod>
          name={t.periodLabel}
          value={period}
          onChange={onPeriodChange}
          className="sm:w-[340px]"
          options={(["day", "week", "month", "all"] as KpiPeriod[]).map((p) => ({ value: p, label: t.periods[p], tone: "neutral" }))}
        />
        <Segmented<JournalUnit>
          name={t.unitLabel}
          value={unit}
          onChange={onUnitChange}
          className="sm:w-[150px]"
          options={[
            { value: "R", label: "R", tone: "neutral" },
            { value: "money", label: "$", tone: "neutral" },
            { value: "percent", label: "%", tone: "neutral" },
          ]}
        />
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile, i) => (
          <div key={tile.key} className={cn("rounded-md bg-s2/60 px-3 py-2.5", i === 0 && "col-span-2 sm:col-span-1")} data-kpi={tile.key}>
            <dt className="text-xs font-medium text-mu">{tile.label}</dt>
            <dd className={cn("mt-0.5 text-xl font-semibold tabular-nums", tile.tone ?? "text-tx")}>{tile.value}</dd>
            {tile.sub && <dd className="text-xs text-mu">{tile.sub}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}
