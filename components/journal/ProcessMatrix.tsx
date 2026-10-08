"use client";

import React from "react";
import { Trade } from "@/lib/journal/types";
import { calculateProcessOutcomeMatrix } from "@/lib/journal/stats";
import { Info } from "lucide-react";

interface ProcessMatrixProps {
  trades: Trade[];
  dict: any;
}

export const ProcessMatrix: React.FC<ProcessMatrixProps> = ({ trades, dict }) => {
  const matrix = calculateProcessOutcomeMatrix(trades);

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-line pb-2">
        <h4 className="h4 text-sm font-serif font-bold text-tx">
          {dict.journal.reports.matrix.title}
        </h4>
        <span className="text-[11px] text-mu flex items-center gap-1 italic">
          <Info size={13} />
          {dict.journal.reports.matrix.disclaimer}
        </span>
      </div>

      {/* 2x2 Grid */}
      <div className="grid grid-cols-2 gap-3 text-xs pt-1">
        {/* Top-Left: Good Process + Win = Correct */}
        <div className="p-3.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 space-y-1 relative">
          <div className="flex justify-between items-start">
            <span className="font-bold text-emerald-300">
              {dict.journal.reports.matrix.goodWinLabel}
            </span>
            <span className="text-[10px] text-emerald-400/80 font-semibold bg-emerald-500/20 px-1.5 py-0.5 rounded">
              ★ 4-5 · Win
            </span>
          </div>
          <div className="text-xl font-bold font-mono text-tx">
            {matrix.goodWinCount} <span className="text-xs text-mu">trades</span>
          </div>
          <div className="text-xs text-emerald-400 font-mono">
            Avg R: {matrix.goodWinAvgR !== null ? `+${matrix.goodWinAvgR} R` : "—"}
          </div>
        </div>

        {/* Top-Right: Good Process + Loss = Variance */}
        <div className="p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/10 space-y-1 relative">
          <div className="flex justify-between items-start">
            <span className="font-bold text-amber-300">
              {dict.journal.reports.matrix.goodLossLabel}
            </span>
            <span className="text-[10px] text-amber-400/80 font-semibold bg-amber-500/20 px-1.5 py-0.5 rounded">
              ★ 4-5 · Loss
            </span>
          </div>
          <div className="text-xl font-bold font-mono text-tx">
            {matrix.goodLossCount} <span className="text-xs text-mu">trades</span>
          </div>
          <div className="text-xs text-amber-400 font-mono">
            Avg R: {matrix.goodLossAvgR !== null ? `${matrix.goodLossAvgR} R` : "—"}
          </div>
        </div>

        {/* Bottom-Left: Poor Process + Win = Lucky */}
        <div className="p-3.5 rounded-xl border border-violet-500/40 bg-violet-500/10 space-y-1 relative">
          <div className="flex justify-between items-start">
            <span className="font-bold text-violet-300">
              {dict.journal.reports.matrix.badWinLabel}
            </span>
            <span className="text-[10px] text-violet-400/80 font-semibold bg-violet-500/20 px-1.5 py-0.5 rounded">
              ★ 1-2 · Win
            </span>
          </div>
          <div className="text-xl font-bold font-mono text-tx">
            {matrix.badWinCount} <span className="text-xs text-mu">trades</span>
          </div>
          <div className="text-xs text-violet-400 font-mono">
            Avg R: {matrix.badWinAvgR !== null ? `+${matrix.badWinAvgR} R` : "—"}
          </div>
        </div>

        {/* Bottom-Right: Poor Process + Loss = Fix */}
        <div className="p-3.5 rounded-xl border border-rose-500/40 bg-rose-500/10 space-y-1 relative">
          <div className="flex justify-between items-start">
            <span className="font-bold text-rose-300">
              {dict.journal.reports.matrix.badLossLabel}
            </span>
            <span className="text-[10px] text-rose-400/80 font-semibold bg-rose-500/20 px-1.5 py-0.5 rounded">
              ★ 1-2 · Loss
            </span>
          </div>
          <div className="text-xl font-bold font-mono text-tx">
            {matrix.badLossCount} <span className="text-xs text-mu">trades</span>
          </div>
          <div className="text-xs text-rose-400 font-mono">
            Avg R: {matrix.badLossAvgR !== null ? `${matrix.badLossAvgR} R` : "—"}
          </div>
        </div>
      </div>

      {/* Additional Stats & Source Label */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-mu pt-1 border-t border-line/40">
        <div>
          {matrix.mediumExecutionCount > 0 && (
            <span className="mr-3">
              {dict.journal.reports.matrix.mediumExecutionLabel}{" "}
              <b className="text-tx">{matrix.mediumExecutionCount}</b>
            </span>
          )}
          {matrix.unratedCount > 0 && (
            <span>
              {dict.journal.reports.matrix.unratedCount.replace(
                "{count}",
                String(matrix.unratedCount)
              )}
            </span>
          )}
        </div>

        <span className="italic">
          {dict.journal.reports.matrix.sourceLabel}{" "}
          {matrix.usedProcessScoreFallback
            ? dict.journal.reports.matrix.sourceProcessScore
            : dict.journal.reports.matrix.sourceManual}
        </span>
      </div>
    </div>
  );
};
