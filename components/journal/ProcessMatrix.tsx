"use client";

import React from "react";
import { Trade } from "@/lib/journal/types";
import { calculateProcessOutcomeMatrix } from "@/lib/journal/stats";
import { formatString } from "@/lib/i18n";
import { Info } from "lucide-react";
import { cn } from "@/components/ui/cn";

interface ProcessMatrixProps {
  trades: Trade[];
  dict: any;
}

/** 2×2 matrix: execution quality (rows) × trade outcome (columns), with counts and average R. */
export const ProcessMatrix: React.FC<ProcessMatrixProps> = ({ trades, dict }) => {
  const matrix = calculateProcessOutcomeMatrix(trades);
  const m = dict.journal.reports.matrix;
  const a = dict.journal.analytics;
  const fmtR = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v} R`);

  const Cell = ({ label, count, avg, tone }: { label: string; count: number; avg: number | null; tone: string }) => (
    <div className={cn("space-y-1 rounded-md border p-3", tone)}>
      <div className="text-sm font-semibold">{label}</div>
      <div className="text-xl font-bold tabular-nums text-tx">{count}</div>
      <div className="text-xs text-mu">{formatString(a.avgRValue, { value: fmtR(avg) })}</div>
    </div>
  );

  return (
    <section className="space-y-3 rounded-lg border border-line bg-s1 p-4" data-testid="process-matrix">
      <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
        <h3 className="text-base font-semibold text-tx">{m.title}</h3>
        <span className="flex items-center gap-1 text-xs text-mu">
          <Info size={13} aria-hidden="true" />
          {m.disclaimer}
        </span>
      </div>

      <div className="grid grid-cols-[auto_1fr_1fr] items-stretch gap-2 text-sm">
        <span />
        <span className="text-center text-xs font-semibold text-mu">{m.winHeader}</span>
        <span className="text-center text-xs font-semibold text-mu">{m.lossHeader}</span>

        <span className="flex max-w-[92px] items-center text-xs font-semibold text-mu">{m.goodProcessHeader}</span>
        <Cell label={m.goodWinLabel} count={matrix.goodWinCount} avg={matrix.goodWinAvgR} tone="border-long/40 bg-long/10 text-long" />
        <Cell label={m.goodLossLabel} count={matrix.goodLossCount} avg={matrix.goodLossAvgR} tone="border-amber-400/40 bg-amber-400/10 text-amber-200" />

        <span className="flex max-w-[92px] items-center text-xs font-semibold text-mu">{m.badProcessHeader}</span>
        <Cell label={m.badWinLabel} count={matrix.badWinCount} avg={matrix.badWinAvgR} tone="border-vi/40 bg-vi/10 text-vi" />
        <Cell label={m.badLossLabel} count={matrix.badLossCount} avg={matrix.badLossAvgR} tone="border-short/40 bg-short/10 text-short" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs text-mu">
        <div className="space-x-3">
          {matrix.mediumExecutionCount > 0 && (
            <span>
              {m.mediumExecutionLabel} <b className="text-tx">{matrix.mediumExecutionCount}</b>
            </span>
          )}
          {matrix.unratedCount > 0 && <span>{m.unratedCount.replace("{count}", String(matrix.unratedCount))}</span>}
        </div>
        <span className="italic">
          {m.sourceLabel} {matrix.usedProcessScoreFallback ? m.sourceProcessScore : m.sourceManual}
        </span>
      </div>
    </section>
  );
};
