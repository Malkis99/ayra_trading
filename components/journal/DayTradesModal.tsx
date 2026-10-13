"use client";

import React from "react";
import { Trade, Account } from "@/lib/journal/types";
import { CalendarDayStat } from "@/lib/journal/stats";
import { useJournal } from "@/lib/journal/context";
import { useApp } from "@/lib/context";
import { Plus, ArrowUpRight, ArrowDownRight, CheckCircle2 } from "lucide-react";
import { Button, Modal } from "@/components/ui";

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
    <Modal
      isOpen
      onClose={onClose}
      title={dict.journal.calendar.dayModal.title.replace("{date}", dayStat.dateStr)}
      subtitle={`${dayStat.tradesCount} ${dict.journal.tradesWord}`}
      closeLabel={dict.journal.addTradeModal.closeLabel}
      data-testid="day-trades-modal"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              openNoteModal({ date: dayStat.dateStr });
              onClose();
            }}
          >
            <Plus size={16} aria-hidden="true" />
            <span>{dict.journal.notes.addLinkedNoteBtn}</span>
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {dict.journal.cancel}
            </Button>
            <Button
              onClick={() => {
                onAddTradeForDate(dayStat.dateStr);
                onClose();
              }}
            >
              <Plus size={16} aria-hidden="true" />
              <span>{dict.journal.calendar.dayModal.addTradeDateBtn}</span>
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Day Summary */}
        <div className="p-3 bg-s2/60 rounded-xl border border-line flex justify-between items-center text-xs">
          <span className="text-mu font-semibold">
            {dict.journal.calendar.dayModal.daySummary}:
          </span>
          <b
            className={`tabular-nums text-sm font-bold ${
              dayStat.totalR > 0
                ? "text-long"
                : dayStat.totalR < 0
                ? "text-short"
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
                <span className="text-[10px] text-long font-semibold flex items-center gap-1">
                  <CheckCircle2 size={11} />
                  {dict.journal.tradingPlan.completedBadge}
                </span>
              )}
            </div>

            {plan.bias && plan.bias.length > 0 && (
              <div className="flex flex-wrap gap-1 items-center text-[11px]">
                <span className="text-mu">{dict.journal.tradingPlan.biasTitle}:</span>
                {plan.bias.map((b, idx) => (
                  <span
                    key={idx}
                    className={`px-1.5 py-0.2 rounded font-bold text-[10px] ${
                      b.direction === "bullish"
                        ? "bg-emerald-500/20 text-long"
                        : b.direction === "bearish"
                        ? "bg-rose-500/20 text-short"
                        : "bg-amber-500/20 text-amber-300"
                    }`}
                  >
                    {b.instrument} · {dict.journal.overview.bias[b.direction]}
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
                          ? "bg-emerald-500/20 text-long"
                          : "bg-rose-500/20 text-short"
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
                        {acc?.name || dict.journal.accountsTab.mainAccountDefaultName} ·{" "}
                        {new Date(t.openedAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>

                  <b
                    className={`tabular-nums ${
                      isWin
                        ? "text-long"
                        : isLoss
                        ? "text-short"
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

      </div>
    </Modal>
  );
};
