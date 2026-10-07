"use client";

import React from "react";
import { Trade, Account } from "@/lib/journal/types";
import { CalendarDayStat } from "@/lib/journal/stats";
import { X, Plus, ArrowUpRight, ArrowDownRight } from "lucide-react";

interface DayTradesModalProps {
  dayStat: CalendarDayStat;
  accounts: Account[];
  unit: "R" | "money" | "percent";
  onClose: () => void;
  onAddTradeForDate: (dateStr: string) => void;
  dict: any;
  lang: string;
}

export const DayTradesModal: React.FC<DayTradesModalProps> = ({
  dayStat,
  accounts,
  unit,
  onClose,
  onAddTradeForDate,
  dict,
  lang,
}) => {
  const accountMap = new Map<string, Account>();
  accounts.forEach((a) => accountMap.set(a.id, a));

  const formatVal = (val: number | null, currSymbol: string = "$") => {
    if (val === null || val === undefined) return "—";
    if (unit === "R") return `${val > 0 ? "+" : ""}${val.toFixed(2)} R`;
    if (unit === "percent") return `${val > 0 ? "+" : ""}${val.toFixed(2)}%`;

    try {
      const formatted = new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-US", {
        style: "currency",
        currency: currSymbol,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(val);
      return val > 0 ? `+${formatted}` : formatted;
    } catch {
      return `${val > 0 ? "+" : ""}${val} ${currSymbol}`;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-lg space-y-4 shadow-2xl border border-line p-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-line pb-3">
          <div>
            <h3 className="h3 font-serif">
              {dict.journal.calendar.dayModal.title.replace("{date}", dayStat.dateStr)}
            </h3>
            <span className="text-xs text-mu">
              {dayStat.tradesCount} {dict.journal.tradesWord}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-mu hover:text-tx text-lg font-bold p-1 rounded-lg hover:bg-white/5"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Day Summary */}
        <div className="p-3 bg-s2/60 rounded-xl border border-line flex justify-between items-center text-xs">
          <span className="text-mu font-semibold">
            {dict.journal.calendar.dayModal.daySummary}:
          </span>
          <b
            className={`font-mono text-sm font-bold ${
              dayStat.totalR > 0
                ? "text-emerald-400"
                : dayStat.totalR < 0
                ? "text-rose-400"
                : "text-tx"
            }`}
          >
            {unit === "R"
              ? formatVal(dayStat.totalR)
              : unit === "percent"
              ? formatVal(dayStat.totalPercent)
              : formatVal(dayStat.totalMoney)}
          </b>
        </div>

        {/* Trades List */}
        {dayStat.trades.length === 0 ? (
          <div className="text-center py-6 text-xs text-mu border border-dashed border-line rounded-xl">
            {dict.journal.calendar.dayModal.noTradesDay}
          </div>
        ) : (
          <div className="space-y-2">
            {dayStat.trades.map((t) => {
              const acc = accountMap.get(t.accountId);
              const currSymbol = acc?.currency || "USD";
              const isWin = t.result === "win";
              const isLoss = t.result === "loss";

              return (
                <div
                  key={t.id}
                  className="p-3 rounded-xl border border-line bg-s1 flex items-center justify-between text-xs hover:border-vi/50 transition-colors"
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
                        {acc?.name || "Main"} ·{" "}
                        {new Date(t.openedAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>

                  <b
                    className={`font-mono ${
                      isWin
                        ? "text-emerald-400"
                        : isLoss
                        ? "text-rose-400"
                        : "text-tx"
                    }`}
                  >
                    {unit === "R"
                      ? formatVal(t.rMultiple ?? null)
                      : formatVal(t.pnlMoney ?? null, currSymbol)}
                  </b>
                </div>
              );
            })}
          </div>
        )}

        {/* Actions */}
        <div className="pt-2 border-t border-line flex justify-between gap-2">
          <button onClick={onClose} className="btn-ghost text-xs py-2 px-4">
            {dict.journal.cancel}
          </button>
          <button
            onClick={() => {
              onAddTradeForDate(dayStat.dateStr);
              onClose();
            }}
            className="btn text-xs py-2 px-4 flex items-center gap-1.5 font-semibold"
          >
            <Plus size={15} />
            <span>{dict.journal.calendar.dayModal.addTradeDateBtn}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
