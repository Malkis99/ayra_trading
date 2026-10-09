"use client";

import React from "react";
import { PropDaySummary } from "@/lib/journal/prop";
import { Check, Minus } from "lucide-react";

interface PropDaysListProps {
  daysHistory: PropDaySummary[];
  currency: string;
  dict: any;
  lang: string;
}

export const PropDaysList: React.FC<PropDaysListProps> = ({
  daysHistory,
  currency,
  dict,
  lang,
}) => {
  if (!daysHistory || daysHistory.length === 0) return null;

  return (
    <div className="card p-4 space-y-3 bg-s2/40 border border-line/60 rounded-xl">
      <div className="flex justify-between items-center">
        <h4 className="font-semibold text-xs text-tx uppercase tracking-wider">
          {dict.journal.propRules.daysList.title}
        </h4>
        <span className="text-[10px] text-mu font-mono">14 {dict.journal.daysShort}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="text-[11px] text-mu font-semibold border-b border-line/60">
            <tr>
              <th className="pb-2">{dict.journal.propRules.daysList.colDate}</th>
              <th className="pb-2 text-right">{dict.journal.propRules.daysList.colPnL}</th>
              <th className="pb-2 text-right">{dict.journal.propRules.daysList.colDailyLoss}</th>
              <th className="pb-2 text-center">{dict.journal.propRules.daysList.colTradingDay}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/30">
            {daysHistory.map((day) => {
              const isWin = day.dayPnL > 0;
              const isLoss = day.dayPnL < 0;

              const formattedPnL = new Intl.NumberFormat(
                lang === "ru" ? "ru-RU" : "en-US",
                {
                  style: "currency",
                  currency,
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                }
              ).format(day.dayPnL);

              return (
                <tr key={day.dayKey} className="hover:bg-s2/60 transition-colors">
                  <td className="py-2 text-tx font-mono text-[11px]">{day.dayKey}</td>
                  <td
                    className={`py-2 text-right font-bold ${
                      isWin
                        ? "text-emerald-400"
                        : isLoss
                        ? "text-rose-400"
                        : "text-mu"
                    }`}
                  >
                    {day.dayPnL > 0 ? `+${formattedPnL}` : formattedPnL}
                  </td>
                  <td className="py-2 text-right font-mono text-[11px] text-mu">
                    {day.dailyLimitMoney > 0
                      ? `${day.dailyLimitUsedPct.toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="py-2 text-center">
                    {day.isTradingDay ? (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400">
                        <Check size={12} />
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-s2 text-mu">
                        <Minus size={12} />
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
