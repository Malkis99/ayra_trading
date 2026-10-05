"use client";

import React, { useState } from "react";
import { Shield, HelpCircle } from "lucide-react";
import { useGame } from "@/lib/game-context";
import { useApp } from "@/lib/context";
import { getReputation } from "@/lib/game";
import { GAME_CONFIG } from "@/lib/game-config";
import { formatString, formatNumber } from "@/lib/i18n";

export function ReputationBlock() {
  const { gameState } = useGame();
  const { dict, lang } = useApp();
  const [showTooltip, setShowTooltip] = useState(false);

  const rep = getReputation(gameState);
  const stages = GAME_CONFIG.REPUTATION_STAGES;

  const stageName = (dict.reputation.stages as any)[rep.stageKey] || rep.stageKey;

  return (
    <div className="card relative bg-gradient-to-br from-[#1c182a] via-[#14121f] to-[#100e19] p-4 border border-line overflow-hidden">
      {/* Top row: Shield + Header + Points */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-vi/15 border border-vi/40 text-vi-lt shadow-[0_0_12px_rgba(163,138,209,0.25)]">
            <Shield size={22} />
          </div>

          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="font-serif text-lg font-bold text-tx">
                {dict.reputation.title}
              </h3>
              <button
                type="button"
                onClick={() => setShowTooltip((prev) => !prev)}
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                className="text-mu hover:text-vi-lt transition-colors"
                aria-label={dict.reputation.tooltipTitle}
              >
                <HelpCircle size={15} />
              </button>
            </div>
            <p className="text-xs text-vi-lt font-semibold">{stageName}</p>
          </div>
        </div>

        <div className="text-right">
          <span className="font-serif text-2xl font-bold text-go tabular-nums">
            {formatNumber(lang, rep.points)}
          </span>
          <p className="text-[10px] uppercase text-mu font-semibold tracking-wider">
            Points
          </p>
        </div>
      </div>

      {/* Tooltip Popup */}
      {showTooltip && (
        <div className="mt-3 p-3 rounded-xl bg-s2 border border-line text-xs space-y-1.5 animate-fade-in z-20">
          <p className="font-semibold text-tx border-b border-line pb-1">
            {dict.reputation.tooltipTitle}
          </p>
          <div className="flex justify-between text-mu">
            <span>{dict.reputation.utility}:</span>
            <span className="text-tx font-mono">{formatNumber(lang, rep.utilityPoints)}</span>
          </div>
          <div className="flex justify-between text-mu">
            <span>{dict.reputation.quality}:</span>
            <span className="text-tx font-mono">{formatNumber(lang, rep.qualityPoints)}</span>
          </div>
          <div className="flex justify-between text-mu">
            <span>{dict.reputation.stability}:</span>
            <span className="text-tx font-mono">{formatNumber(lang, rep.stabilityPoints)}</span>
          </div>
        </div>
      )}

      {/* Segmented Progress Bar (5 stages) */}
      <div className="mt-4 space-y-1.5">
        <div className="grid grid-cols-5 gap-1.5">
          {stages.map((st, idx) => {
            const isActive = idx === rep.stageIndex;
            const isPassed = idx < rep.stageIndex;

            return (
              <div key={st.key} className="flex flex-col gap-1">
                <div
                  className={`h-2.5 rounded-full border transition-all duration-300 ${
                    isPassed
                      ? "bg-vi border-vi shadow-[0_0_8px_rgba(163,138,209,0.3)]"
                      : isActive
                      ? "bg-gradient-to-r from-vi to-go border-go shadow-[0_0_10px_rgba(214,169,74,0.4)]"
                      : "bg-s2 border-line/40"
                  }`}
                />
                <span
                  className={`text-[9px] text-center truncate ${
                    isActive ? "text-go font-bold" : isPassed ? "text-vi-lt" : "text-mu/60"
                  }`}
                >
                  {(dict.reputation.stages as any)[st.key] || st.key}
                </span>
              </div>
            );
          })}
        </div>

        {/* Stage progress label */}
        <div className="flex items-center justify-between text-[11px] text-mu pt-1">
          <span>
            {rep.pointsToNextStage > 0
              ? formatString(dict.reputation.pointsToNext, {
                  points: formatNumber(lang, rep.pointsToNextStage),
                })
              : dict.reputation.maxStage}
          </span>
          <span className="text-[10px] text-mu/80 italic">{dict.reputation.note}</span>
        </div>
      </div>
    </div>
  );
}
