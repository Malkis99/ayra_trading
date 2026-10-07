"use client";

import React, { useState, useMemo } from "react";
import { Trade, Account } from "@/lib/journal/types";
import { calculateCalendarMonth, CalendarDayStat } from "@/lib/journal/stats";
import { DayTradesModal } from "./DayTradesModal";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";

interface CalendarTabProps {
  trades: Trade[];
  accounts: Account[];
  unit: "R" | "money" | "percent";
  onAddTradeForDate: (dateStr: string) => void;
  dict: any;
  lang: string;
}

export const CalendarTab: React.FC<CalendarTabProps> = ({
  trades,
  accounts,
  unit,
  onAddTradeForDate,
  dict,
  lang,
}) => {
  const today = new Date();
  const [currentYear, setCurrentYear] = useState<number>(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(today.getMonth()); // 0-indexed

  const [selectedDayStat, setSelectedDayStat] = useState<CalendarDayStat | null>(
    null
  );

  // Month navigation
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleGoToToday = () => {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
  };

  // Calculate Month Stats
  const monthStat = useMemo(() => {
    return calculateCalendarMonth(currentYear, currentMonth, trades, accounts);
  }, [currentYear, currentMonth, trades, accounts]);

  // Weekday names starting Monday
  const weekdayNames = [
    dict.questsPage.weekTab.days.mon,
    dict.questsPage.weekTab.days.tue,
    dict.questsPage.weekTab.days.wed,
    dict.questsPage.weekTab.days.thu,
    dict.questsPage.weekTab.days.fri,
    dict.questsPage.weekTab.days.sat,
    dict.questsPage.weekTab.days.sun,
  ];

  // Padding days before the 1st day of the month (Monday-first offset)
  const firstDayObj = new Date(currentYear, currentMonth, 1);
  const dayOfWeekIndex = firstDayObj.getDay(); // 0 = Sun, 1 = Mon...
  const mondayOffset = dayOfWeekIndex === 0 ? 6 : dayOfWeekIndex - 1;

  // Month Title
  const monthTitle = new Date(currentYear, currentMonth, 1).toLocaleDateString(
    lang === "ru" ? "ru-RU" : "en-US",
    { month: "long", year: "numeric" }
  );

  const formatValue = (val: number | null) => {
    if (val === null || val === undefined) return "—";
    if (unit === "R") return `${val > 0 ? "+" : ""}${val.toFixed(2)} R`;
    if (unit === "percent") return `${val > 0 ? "+" : ""}${val.toFixed(2)}%`;
    return `${val > 0 ? "+" : ""}${val.toFixed(0)} $`;
  };

  return (
    <div className="space-y-4">
      {/* Month Navigation & Title */}
      <div className="card p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CalendarIcon size={18} className="text-vi flex-none" />
          <h2 className="font-serif text-lg font-bold text-tx capitalize">
            {monthTitle}
          </h2>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto text-xs">
          <button
            onClick={handleGoToToday}
            className="btn-secondary py-1.5 px-3 font-semibold text-xs"
          >
            {dict.journal.calendar.todayBtn}
          </button>
          <div className="flex gap-1 border border-line rounded-lg p-0.5 bg-s2">
            <button
              onClick={handlePrevMonth}
              className="p-1 text-mu hover:text-tx rounded hover:bg-white/5"
              aria-label="Previous Month"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={handleNextMonth}
              className="p-1 text-mu hover:text-tx rounded hover:bg-white/5"
              aria-label="Next Month"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Month Totals Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="card p-3 space-y-1">
          <span className="text-[11px] text-mu">
            {dict.journal.calendar.monthTotals.result}
          </span>
          <b
            className={`block font-mono text-base font-bold ${
              monthStat.totalResultR > 0
                ? "text-emerald-400"
                : monthStat.totalResultR < 0
                ? "text-rose-400"
                : "text-tx"
            }`}
          >
            {unit === "R"
              ? formatValue(monthStat.totalResultR)
              : formatValue(monthStat.totalResultMoney)}
          </b>
        </div>

        <div className="card p-3 space-y-1">
          <span className="text-[11px] text-mu">
            {dict.journal.calendar.monthTotals.trades}
          </span>
          <b className="block font-mono text-base font-bold text-tx">
            {monthStat.totalTradesCount}
          </b>
        </div>

        <div className="card p-3 space-y-1">
          <span className="text-[11px] text-mu">
            {dict.journal.calendar.monthTotals.winrate}
          </span>
          <b className="block font-mono text-base font-bold text-tx">
            {(monthStat.winRate * 100).toFixed(1)}%
          </b>
        </div>

        <div className="card p-3 space-y-1">
          <span className="text-[11px] text-mu">
            {dict.journal.calendar.monthTotals.bestDay}
          </span>
          <b className="block font-mono text-xs font-bold text-emerald-400 truncate">
            {monthStat.bestDayStr
              ? `${monthStat.bestDayStr.split("-")[2]}: ${formatValue(monthStat.bestDayR)}`
              : "—"}
          </b>
        </div>
      </div>

      {/* Main Grid + Week Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
        {/* Month Calendar Grid (8 cols on lg) */}
        <div className="lg:col-span-9 card p-3 space-y-2">
          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-mu pb-2 border-b border-line">
            {weekdayNames.map((dayName, i) => (
              <div key={i}>{dayName}</div>
            ))}
          </div>

          {/* Calendar Days Cells */}
          <div className="grid grid-cols-7 gap-1">
            {/* Blank padding cells before 1st of month */}
            {Array.from({ length: mondayOffset }).map((_, idx) => (
              <div key={`pad_${idx}`} className="h-16 sm:h-20 bg-s2/20 rounded-lg opacity-20" />
            ))}

            {/* Day Stat Cells */}
            {monthStat.days.map((dayStat) => {
              const isToday =
                dayStat.dateStr === today.toISOString().split("T")[0];

              let cellBg = "bg-s2/40 border-line/40 hover:bg-s2/80";
              let textColor = "text-mu";

              if (dayStat.status === "win") {
                cellBg = "bg-emerald-500/15 border-emerald-500/40 hover:bg-emerald-500/25";
                textColor = "text-emerald-400 font-bold";
              } else if (dayStat.status === "loss") {
                cellBg = "bg-rose-500/15 border-rose-500/40 hover:bg-rose-500/25";
                textColor = "text-rose-400 font-bold";
              } else if (dayStat.status === "breakeven") {
                cellBg = "bg-slate-500/15 border-slate-500/40 hover:bg-slate-500/25";
                textColor = "text-tx font-semibold";
              }

              return (
                <button
                  key={dayStat.dateStr}
                  onClick={() => setSelectedDayStat(dayStat)}
                  className={`h-16 sm:h-20 p-1.5 rounded-xl border text-left flex flex-col justify-between transition-all focus-visible:ring-2 focus-visible:ring-vi cursor-pointer relative ${cellBg} ${
                    isToday ? "ring-1 ring-vi" : ""
                  }`}
                  aria-label={`${dayStat.dateStr}: ${
                    dayStat.tradesCount
                  } trades, result ${formatValue(dayStat.totalR)}`}
                >
                  <div className="flex justify-between items-center w-full">
                    <span
                      className={`text-xs font-mono font-semibold ${
                        isToday
                          ? "bg-vi text-white px-1.5 py-0.2 rounded-full text-[10px]"
                          : "text-tx"
                      }`}
                    >
                      {dayStat.dayNumber}
                    </span>
                    {dayStat.tradesCount > 0 && (
                      <span className="text-[9px] font-mono text-mu bg-black/40 px-1 py-0.2 rounded border border-line">
                        {dayStat.tradesCount}t
                      </span>
                    )}
                  </div>

                  {dayStat.tradesCount > 0 && (
                    <div className={`text-[10px] sm:text-xs font-mono ${textColor} truncate`}>
                      {unit === "R"
                        ? formatValue(dayStat.totalR)
                        : unit === "percent"
                        ? formatValue(dayStat.totalPercent)
                        : formatValue(dayStat.totalMoney)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Week Summaries Column (3 cols on lg) */}
        <div className="lg:col-span-3 space-y-2">
          <div className="card p-3 space-y-2">
            <h4 className="h4 text-xs font-serif font-bold text-tx">
              {dict.journal.calendar.weekColumn.replace("{num}", "")} Summaries
            </h4>
            <div className="space-y-2 text-xs">
              {monthStat.weeks.map((week) => (
                <div
                  key={week.weekNumber}
                  className="p-2.5 rounded-xl border border-line bg-s2/40 flex items-center justify-between"
                >
                  <div>
                    <b className="text-tx block">
                      {dict.journal.calendar.weekColumn.replace(
                        "{num}",
                        String(week.weekNumber)
                      )}
                    </b>
                    <span className="text-[10px] text-mu">
                      {week.tradesCount} {dict.journal.tradesWord}
                    </span>
                  </div>
                  <b
                    className={`font-mono font-bold ${
                      week.totalR > 0
                        ? "text-emerald-400"
                        : week.totalR < 0
                        ? "text-rose-400"
                        : "text-tx"
                    }`}
                  >
                    {unit === "R"
                      ? formatValue(week.totalR)
                      : formatValue(week.totalMoney)}
                  </b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Day Modal */}
      {selectedDayStat && (
        <DayTradesModal
          dayStat={selectedDayStat}
          accounts={accounts}
          unit={unit}
          onClose={() => setSelectedDayStat(null)}
          onAddTradeForDate={onAddTradeForDate}
          dict={dict}
          lang={lang}
        />
      )}
    </div>
  );
};
