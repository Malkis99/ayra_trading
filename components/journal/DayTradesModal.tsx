"use client";

import React from "react";
import { Trade, Account } from "@/lib/journal/types";
import { CalendarDayStat } from "@/lib/journal/stats";
import { useJournal } from "@/lib/journal/context";
import { useApp } from "@/lib/context";
import { X, Plus, ArrowUpRight, ArrowDownRight, FileText, CheckCircle2 } from "lucide-react";

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
  const { getTradingPlan, notes } = useJournal();
  const { openNoteModal } = useApp();

  const plan = getTradingPlan(dayStat.dateStr);
  const dayNotes = notes.filter(
    (n) =>
      !n.archivedAt &&
      (n.createdAt.startsWith(dayStat.dateStr) || n.links?.date === dayStat.dateStr)
  );
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

        {/* Plan & Review Brief */}
        {plan && (
          <div className="p-3 bg-s1 rounded-xl border border-line space-y-1.5 text-xs">
            <div className="flex justify-between items-center border-b border-line/40 pb-1">
              <span className="font-bold text-tx">
                {dict.journal.tradingPlan.dayTab}
              </span>
              {plan.review?.completedAt && (
                <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 size={11} />
                  {dict.journal.tradingPlan.completedBadge}
                </span>
              )}
            </div>

            {plan.bias && plan.bias.length > 0 && (
              <div className="flex flex-wrap gap-1 items-center text-[11px]">
                <span className="text-mu">Bias:</span>
                {plan.bias.map((b, idx) => (
                  <span
                    key={idx}
                    className={`px-1.5 py-0.2 rounded font-bold text-[10px] ${
                      b.direction === "bullish"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : b.direction === "bearish"
                        ? "bg-rose-500/20 text-rose-400"
                        : "bg-amber-500/20 text-amber-300"
                    }`}
                  >
                    {b.instrument} ({b.direction.toUpperCase()})
                  </span>
                ))}
              </div>
            )}

            {plan.review?.lesson && (
              <p className="text-[11px] text-tx/80 italic border-t border-line/40 pt-1">
                {dict.journal.notes.lessonPrefix.replace("{lesson}", plan.review.lesson)}
              </p>
            )}
          </div>
        )}

        {/* Day Notes List */}
        {dayNotes.length > 0 && (
          <div className="space-y-1.5 text-xs">
            <span className="text-mu text-[11px] font-semibold block">
              {dict.journal.notes.dayNotesTitle.replace("{count}", String(dayNotes.length))}
            </span>
            <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
              {dayNotes.map((n) => (
                <div
                  key={n.id}
                  onClick={() => {
                    openNoteModal(n.links);
                    onClose();
                  }}
                  className="p-2 bg-s2/60 border border-line rounded-lg cursor-pointer hover:border-vi text-xs"
                >
                  <div className="font-bold text-tx text-[11px]">
                    {n.title || n.body.split("\n")[0]}
                  </div>
                  <p className="text-[10px] text-mu line-clamp-1 font-sans">{n.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}

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
        <div className="pt-2 border-t border-line flex justify-between items-center gap-2">
          <button
            onClick={() => {
              openNoteModal({ date: dayStat.dateStr });
              onClose();
            }}
            className="btn-ghost text-xs py-1.5 px-3 flex items-center gap-1 text-acc font-semibold border border-line rounded-xl"
          >
            <Plus size={13} />
            <span>{dict.journal.notes.addLinkedNoteBtn}</span>
          </button>

          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost text-xs py-2 px-3">
              {dict.journal.cancel}
            </button>
            <button
              onClick={() => {
                onAddTradeForDate(dayStat.dateStr);
                onClose();
              }}
              className="btn text-xs py-2 px-3 flex items-center gap-1.5 font-semibold"
            >
              <Plus size={15} />
              <span>{dict.journal.calendar.dayModal.addTradeDateBtn}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
