"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import {
  TradingPlan,
  WeekPlan,
  PlanBiasItem,
  PlanLevelItem,
  PlanEventItem,
  PlanLimits,
  PlanChecklistItem,
  DayReview,
  EMOTIONS_CATALOG,
  INSTRUMENT_AUTOCOMPLETE,
} from "@/lib/journal/types";
import { getLocalDateString, getMondayLocalDateString } from "@/lib/date-utils";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Copy,
  Check,
  CheckSquare,
  AlertCircle,
  HelpCircle,
  Sparkles,
  Info,
} from "lucide-react";

export const STANDARD_CHECKLIST_KEYS = [
  "bias_defined",
  "key_levels_marked",
  "events_checked",
  "risk_limits_checked",
  "ready_to_follow_plan",
] as const;

export function TradingPlanTab() {
  const { dict, lang, showToast } = useApp();
  const { gameState, checkAndClosePlanQuests } = useGame();
  const {
    plans,
    weekPlans,
    trades,
    strategies,
    getTradingPlan,
    saveTradingPlan,
    getWeekPlan,
    saveWeekPlan,
  } = useJournal();

  // Mode: 'day' | 'week'
  const [mode, setMode] = useState<"day" | "week">("day");

  // Selected Day (Date object & YYYY-MM-DD string)
  const [selectedDayDate, setSelectedDayDate] = useState<Date>(new Date());
  const dayStr = useMemo(() => {
    return getLocalDateString(selectedDayDate, gameState.profile?.timezone);
  }, [selectedDayDate, gameState.profile?.timezone]);

  // Selected Week (Date object & Monday YYYY-MM-DD string)
  const [selectedWeekDate, setSelectedWeekDate] = useState<Date>(new Date());
  const mondayStr = useMemo(() => {
    return getMondayLocalDateString(selectedWeekDate, gameState.profile?.timezone);
  }, [selectedWeekDate, gameState.profile?.timezone]);

  // Current Day Plan state
  const [dayPlan, setDayPlan] = useState<TradingPlan>(() => {
    const existing = getTradingPlan(dayStr);
    if (existing) return existing;
    const nowIso = new Date().toISOString();
    return {
      date: dayStr,
      bias: [],
      levels: [],
      events: [],
      checklist: STANDARD_CHECKLIST_KEYS.map((key) => ({ key, done: false })),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });

  // Current Week Plan state
  const [weekPlanState, setWeekPlanState] = useState<WeekPlan>(() => {
    const existing = getWeekPlan(mondayStr);
    if (existing) return existing;
    const nowIso = new Date().toISOString();
    return {
      weekStartDate: mondayStr,
      goals: [""],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });

  // Save status: 'saved' | 'saving' | 'idle'
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "idle">("saved");

  // References for debounce timers and pending flush
  const daySaveTimer = useRef<NodeJS.Timeout | null>(null);
  const weekSaveTimer = useRef<NodeJS.Timeout | null>(null);
  const pendingDayPlanRef = useRef<TradingPlan | null>(null);
  const pendingWeekPlanRef = useRef<WeekPlan | null>(null);

  // Sync state when dayStr changes
  useEffect(() => {
    // Flush pending day plan first if switching days
    if (pendingDayPlanRef.current) {
      saveTradingPlan(pendingDayPlanRef.current);
      checkAndClosePlanQuests(pendingDayPlanRef.current, trades);
      pendingDayPlanRef.current = null;
    }

    const existing = getTradingPlan(dayStr);
    if (existing) {
      setDayPlan(existing);
    } else {
      const nowIso = new Date().toISOString();
      setDayPlan({
        date: dayStr,
        bias: [],
        levels: [],
        events: [],
        checklist: STANDARD_CHECKLIST_KEYS.map((key) => ({ key, done: false })),
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
    setSaveStatus("saved");
  }, [dayStr, getTradingPlan]);

  // Sync state when mondayStr changes
  useEffect(() => {
    if (pendingWeekPlanRef.current) {
      saveWeekPlan(pendingWeekPlanRef.current);
      pendingWeekPlanRef.current = null;
    }

    const existing = getWeekPlan(mondayStr);
    if (existing) {
      setWeekPlanState(existing);
    } else {
      const nowIso = new Date().toISOString();
      setWeekPlanState({
        weekStartDate: mondayStr,
        goals: [""],
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
    setSaveStatus("saved");
  }, [mondayStr, getWeekPlan]);

  // Flush on unmount & window unload
  const flushPending = useCallback(() => {
    if (pendingDayPlanRef.current) {
      saveTradingPlan(pendingDayPlanRef.current);
      checkAndClosePlanQuests(pendingDayPlanRef.current, trades);
      pendingDayPlanRef.current = null;
    }
    if (pendingWeekPlanRef.current) {
      saveWeekPlan(pendingWeekPlanRef.current);
      pendingWeekPlanRef.current = null;
    }
  }, [saveTradingPlan, saveWeekPlan, checkAndClosePlanQuests, trades]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      flushPending();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      flushPending();
    };
  }, [flushPending]);

  // Trigger day plan auto-save with ~500ms debounce
  const updateDayPlan = useCallback(
    (updater: (prev: TradingPlan) => TradingPlan) => {
      setDayPlan((prev) => {
        const next = updater(prev);
        const updatedWithTs: TradingPlan = {
          ...next,
          updatedAt: new Date().toISOString(),
        };
        pendingDayPlanRef.current = updatedWithTs;
        setSaveStatus("saving");

        if (daySaveTimer.current) clearTimeout(daySaveTimer.current);
        daySaveTimer.current = setTimeout(() => {
          if (pendingDayPlanRef.current) {
            saveTradingPlan(pendingDayPlanRef.current);
            checkAndClosePlanQuests(pendingDayPlanRef.current, trades);
            pendingDayPlanRef.current = null;
            setSaveStatus("saved");
          }
        }, 500);

        return updatedWithTs;
      });
    },
    [saveTradingPlan, checkAndClosePlanQuests, trades]
  );

  // Trigger week plan auto-save with ~500ms debounce
  const updateWeekPlan = useCallback(
    (updater: (prev: WeekPlan) => WeekPlan) => {
      setWeekPlanState((prev) => {
        const next = updater(prev);
        const updatedWithTs: WeekPlan = {
          ...next,
          updatedAt: new Date().toISOString(),
        };
        pendingWeekPlanRef.current = updatedWithTs;
        setSaveStatus("saving");

        if (weekSaveTimer.current) clearTimeout(weekSaveTimer.current);
        weekSaveTimer.current = setTimeout(() => {
          if (pendingWeekPlanRef.current) {
            saveWeekPlan(pendingWeekPlanRef.current);
            pendingWeekPlanRef.current = null;
            setSaveStatus("saved");
          }
        }, 500);

        return updatedWithTs;
      });
    },
    [saveWeekPlan]
  );

  // Day Navigation handlers
  const handlePrevDay = () => {
    const prev = new Date(selectedDayDate);
    prev.setDate(prev.getDate() - 1);
    setSelectedDayDate(prev);
  };

  const handleNextDay = () => {
    const next = new Date(selectedDayDate);
    next.setDate(next.getDate() + 1);
    setSelectedDayDate(next);
  };

  const handleTodayDay = () => {
    setSelectedDayDate(new Date());
  };

  // Week Navigation handlers
  const handlePrevWeek = () => {
    const prev = new Date(selectedWeekDate);
    prev.setDate(prev.getDate() - 7);
    setSelectedWeekDate(prev);
  };

  const handleNextWeek = () => {
    const next = new Date(selectedWeekDate);
    next.setDate(next.getDate() + 7);
    setSelectedWeekDate(next);
  };

  const handleThisWeek = () => {
    setSelectedWeekDate(new Date());
  };

  // Copy previous day's plan
  const handleCopyPreviousPlan = () => {
    // Find last existing plan before current dayStr
    const allSorted = [...plans]
      .filter((p) => p.date < dayStr)
      .sort((a, b) => b.date.localeCompare(a.date));

    const prevPlan = allSorted[0];
    if (!prevPlan) {
      showToast(dict.journal.tradingPlan.noPreviousPlanToast);
      return;
    }

    updateDayPlan((current) => {
      // Copy limits, copy checklist items (both standard and custom) resetting done to false
      const copiedChecklist = current.checklist.map((c) => ({ ...c, done: false }));
      if (prevPlan.checklist) {
        prevPlan.checklist.forEach((item) => {
          if (item.text) {
            // custom item
            if (!copiedChecklist.some((c) => c.text === item.text)) {
              copiedChecklist.push({ text: item.text, done: false });
            }
          }
        });
      }

      return {
        ...current,
        limits: prevPlan.limits ? { ...prevPlan.limits } : current.limits,
        checklist: copiedChecklist,
      };
    });

    showToast(dict.journal.tradingPlan.planCopiedToast);
  };

  // Trades for selected day
  const dayTrades = useMemo(() => {
    return trades.filter((t) => t.openedAt.startsWith(dayStr));
  }, [trades, dayStr]);

  // Calculate Plan vs Fact stats
  const planFactStats = useMemo(() => {
    const tradesCount = dayTrades.length;
    const maxTrades = dayPlan.limits?.maxTrades;

    // First trade timestamp vs plan creation timestamp
    const firstTradeOpenedAt = dayTrades.length > 0
      ? dayTrades.map((t) => new Date(t.openedAt).getTime()).sort((a, b) => a - b)[0]
      : null;

    const planCreatedAt = new Date(dayPlan.createdAt).getTime();
    const createdBeforeFirstTrade =
      firstTradeOpenedAt != null ? planCreatedAt <= firstTradeOpenedAt : null;

    // Check limit exceeded
    const isMaxTradesExceeded = maxTrades != null && tradesCount > maxTrades;

    return {
      tradesCount,
      maxTrades,
      firstTradeOpenedAt,
      createdBeforeFirstTrade,
      isMaxTradesExceeded,
    };
  }, [dayTrades, dayPlan]);

  // Active strategy default risk tooltip
  const activeStrategyWithLimit = useMemo(() => {
    return strategies.find((s) => !s.archivedAt && s.riskLimit?.value != null);
  }, [strategies]);

  // Handlers for Bias
  const handleAddBias = () => {
    if (dayPlan.bias.length >= 8) return;
    updateDayPlan((prev) => ({
      ...prev,
      bias: [...prev.bias, { instrument: "XAUUSD", direction: "neutral", note: "" }],
    }));
  };

  const handleUpdateBias = (index: number, field: keyof PlanBiasItem, value: any) => {
    updateDayPlan((prev) => {
      const nextBias = [...prev.bias];
      nextBias[index] = { ...nextBias[index], [field]: value };
      return { ...prev, bias: nextBias };
    });
  };

  const handleDeleteBias = (index: number) => {
    updateDayPlan((prev) => ({
      ...prev,
      bias: prev.bias.filter((_, i) => i !== index),
    }));
  };

  // Handlers for Levels
  const handleAddLevel = () => {
    if (dayPlan.levels.length >= 12) return;
    updateDayPlan((prev) => ({
      ...prev,
      levels: [...prev.levels, { instrument: "", price: undefined, label: "" }],
    }));
  };

  const handleUpdateLevel = (index: number, field: keyof PlanLevelItem, value: any) => {
    updateDayPlan((prev) => {
      const nextLevels = [...prev.levels];
      nextLevels[index] = { ...nextLevels[index], [field]: value };
      return { ...prev, levels: nextLevels };
    });
  };

  const handleDeleteLevel = (index: number) => {
    updateDayPlan((prev) => ({
      ...prev,
      levels: prev.levels.filter((_, i) => i !== index),
    }));
  };

  // Handlers for Events
  const handleAddEvent = () => {
    if (dayPlan.events.length >= 8) return;
    updateDayPlan((prev) => ({
      ...prev,
      events: [...prev.events, { time: "", text: "" }],
    }));
  };

  const handleUpdateEvent = (index: number, field: keyof PlanEventItem, value: any) => {
    updateDayPlan((prev) => {
      const nextEvents = [...prev.events];
      nextEvents[index] = { ...nextEvents[index], [field]: value };
      return { ...prev, events: nextEvents };
    });
  };

  const handleDeleteEvent = (index: number) => {
    updateDayPlan((prev) => ({
      ...prev,
      events: prev.events.filter((_, i) => i !== index),
    }));
  };

  // Handlers for Limits
  const handleUpdateLimits = (limitsUpdater: (prevLimits: PlanLimits) => PlanLimits) => {
    updateDayPlan((prev) => ({
      ...prev,
      limits: limitsUpdater(prev.limits || {}),
    }));
  };

  // Handlers for Checklist
  const handleToggleChecklist = (index: number) => {
    updateDayPlan((prev) => {
      const nextList = [...prev.checklist];
      nextList[index] = { ...nextList[index], done: !nextList[index].done };
      return { ...prev, checklist: nextList };
    });
  };

  const [customChecklistInput, setCustomChecklistInput] = useState("");
  const handleAddCustomChecklistItem = () => {
    const trimmed = customChecklistInput.trim();
    if (!trimmed) return;
    updateDayPlan((prev) => ({
      ...prev,
      checklist: [...prev.checklist, { text: trimmed.slice(0, 80), done: false }],
    }));
    setCustomChecklistInput("");
  };

  const handleDeleteChecklistItem = (index: number) => {
    updateDayPlan((prev) => ({
      ...prev,
      checklist: prev.checklist.filter((_, i) => i !== index),
    }));
  };

  // Day Review handlers
  const reviewState = dayPlan.review || {
    rating: 0,
    followedPlan: "yes",
    emotions: [],
    whatWorked: "",
    whatToImprove: "",
    lesson: "",
  };

  const handleUpdateReview = (updater: (prevReview: DayReview) => DayReview) => {
    updateDayPlan((prev) => {
      const currentRev = prev.review || {
        rating: 0,
        followedPlan: "yes",
        emotions: [],
        whatWorked: "",
        whatToImprove: "",
        lesson: "",
      };
      return {
        ...prev,
        review: updater(currentRev),
      };
    });
  };

  const handleCompleteDayReview = () => {
    handleUpdateReview((prev) => ({
      ...prev,
      completedAt: new Date().toISOString(),
    }));
    showToast(dict.journal.tradingPlan.dayCompletedToast);
  };

  // Week Goals handlers
  const handleAddWeekGoal = () => {
    if (weekPlanState.goals.length >= 3) return;
    updateWeekPlan((prev) => ({
      ...prev,
      goals: [...prev.goals, ""],
    }));
  };

  const handleUpdateWeekGoal = (index: number, val: string) => {
    updateWeekPlan((prev) => {
      const nextGoals = [...prev.goals];
      nextGoals[index] = val.slice(0, 120);
      return { ...prev, goals: nextGoals };
    });
  };

  const handleDeleteWeekGoal = (index: number) => {
    updateWeekPlan((prev) => ({
      ...prev,
      goals: prev.goals.filter((_, i) => i !== index),
    }));
  };

  return (
    <div className="space-y-5">
      {/* Mode Switcher & Save Status Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-s2/60 p-3 rounded-2xl border border-line">
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-s1 border border-line p-1 text-xs font-semibold">
            <button
              onClick={() => setMode("day")}
              className={`py-1.5 px-3 rounded-lg transition-colors ${
                mode === "day" ? "bg-vi text-white shadow" : "text-mu hover:text-tx"
              }`}
            >
              {dict.journal.tradingPlan.dayTab}
            </button>
            <button
              onClick={() => setMode("week")}
              className={`py-1.5 px-3 rounded-lg transition-colors ${
                mode === "week" ? "bg-vi text-white shadow" : "text-mu hover:text-tx"
              }`}
            >
              {dict.journal.tradingPlan.weekTab}
            </button>
          </div>

          <span className="text-[11px] text-mu font-medium flex items-center gap-1.5 ml-2">
            {saveStatus === "saving" && (
              <span className="text-amber-400 flex items-center gap-1 animate-pulse">
                <span>●</span> {dict.journal.saving}
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="text-emerald-400 flex items-center gap-1">
                <Check size={12} /> {dict.journal.saved}
              </span>
            )}
          </span>
        </div>

        {/* Date Selector */}
        {mode === "day" ? (
          <div className="flex items-center gap-1.5 self-start sm:self-auto text-xs">
            <button
              onClick={handlePrevDay}
              className="btn-ghost p-1.5 text-mu hover:text-tx"
              title={dict.journal.prevBtn}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={handleTodayDay}
              className="btn-secondary py-1 px-2.5 text-xs font-semibold"
            >
              {dict.journal.today}
            </button>
            <input
              type="date"
              value={dayStr}
              onChange={(e) => {
                if (e.target.value) {
                  const [y, m, d] = e.target.value.split("-").map(Number);
                  setSelectedDayDate(new Date(y, m - 1, d));
                }
              }}
              className="input text-xs py-1 px-2 border-line bg-s1"
            />
            <button
              onClick={handleNextDay}
              className="btn-ghost p-1.5 text-mu hover:text-tx"
              title={dict.journal.nextBtn}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 self-start sm:self-auto text-xs">
            <button
              onClick={handlePrevWeek}
              className="btn-ghost p-1.5 text-mu hover:text-tx"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={handleThisWeek}
              className="btn-secondary py-1 px-2.5 text-xs font-semibold"
            >
              {dict.journal.tradingPlan.thisWeek}
            </button>
            <span className="text-xs font-bold text-tx px-2">
              {mondayStr}
            </span>
            <button
              onClick={handleNextWeek}
              className="btn-ghost p-1.5 text-mu hover:text-tx"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* MODE 1: DAY PLAN */}
      {mode === "day" && (
        <div className="space-y-4">
          {/* "Plan & Fact" Banner */}
          {(dayTrades.length > 0 || dayPlan.limits?.maxTrades != null) && (
            <div className="card p-4 bg-s2/80 border border-line space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line/40 pb-2">
                <div className="flex items-center gap-2">
                  <h4 className="font-serif font-bold text-sm text-tx">
                    {dict.journal.tradingPlan.planFactTitle}
                  </h4>
                  {planFactStats.isMaxTradesExceeded && (
                    <span className="badge-free text-[10px] text-amber-300 bg-amber-500/10 border-amber-500/30">
                      {dict.journal.tradingPlan.limitReachedBadge}
                    </span>
                  )}
                </div>

                {/* Plan Created Before First Trade Badge */}
                {planFactStats.createdBeforeFirstTrade != null && (
                  <div className="flex items-center gap-1.5 text-xs text-mu">
                    <span>
                      {dict.journal.tradingPlan.createdBeforeFirstTradeLabel}
                    </span>
                    <span
                      className={`font-bold px-1.5 py-0.5 rounded text-[11px] ${
                        planFactStats.createdBeforeFirstTrade
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : "bg-s2 text-mu border border-line"
                      }`}
                    >
                      {planFactStats.createdBeforeFirstTrade ? "✓" : "—"}
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-2.5 bg-s1 rounded-xl border border-line">
                  <span className="text-mu block text-[11px]">
                    {dict.journal.tradingPlan.tradesCountLabel}
                  </span>
                  <b className="text-tx text-sm font-bold">
                    {planFactStats.maxTrades != null
                      ? dict.journal.tradingPlan.tradesCountOf
                          .replace("{count}", String(planFactStats.tradesCount))
                          .replace("{max}", String(planFactStats.maxTrades))
                      : `${planFactStats.tradesCount}`}
                  </b>
                </div>

                <div className="p-2.5 bg-s1 rounded-xl border border-line">
                  <span className="text-mu block text-[11px]">
                    {dict.journal.tradingPlan.maxRiskLabel}
                  </span>
                  <b className="text-tx text-sm font-bold">
                    {dayPlan.limits?.maxRiskPerTrade
                      ? `${dayPlan.limits.maxRiskPerTrade.value} ${dayPlan.limits.maxRiskPerTrade.type.toUpperCase()}`
                      : "—"}
                  </b>
                </div>

                <div className="p-2.5 bg-s1 rounded-xl border border-line">
                  <span className="text-mu block text-[11px]">
                    {dict.journal.tradingPlan.maxDailyLossLabel}
                  </span>
                  <b className="text-tx text-sm font-bold">
                    {dayPlan.limits?.maxDailyLoss
                      ? `${dayPlan.limits.maxDailyLoss.value} ${dayPlan.limits.maxDailyLoss.type.toUpperCase()}`
                      : "—"}
                  </b>
                </div>
              </div>
            </div>
          )}

          {/* Copy Previous Plan Button */}
          <div className="flex justify-between items-center">
            <button
              onClick={handleCopyPreviousPlan}
              className="btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5 text-acc hover:text-tx border border-line rounded-xl"
            >
              <Copy size={14} />
              <span>{dict.journal.tradingPlan.copyPrevPlanBtn}</span>
            </button>
          </div>

          {/* Card Blocks Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* BLOCK 1: BIAS */}
            <div className="card p-4 space-y-3 border border-line">
              <div className="flex justify-between items-center border-b border-line pb-2">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-vi" />
                  <h4 className="font-bold text-sm text-tx">
                    {dict.journal.tradingPlan.biasTitle}
                  </h4>
                  <span className="text-[10px] text-mu font-semibold">
                    ({dayPlan.bias.length}/8)
                  </span>
                </div>
                {dayPlan.bias.length < 8 && (
                  <button
                    onClick={handleAddBias}
                    className="btn-ghost text-xs py-1 px-2.5 flex items-center gap-1 font-medium"
                  >
                    <Plus size={13} />
                    <span>{dict.journal.addBtn}</span>
                  </button>
                )}
              </div>

              {dayPlan.bias.length === 0 ? (
                <p className="text-xs text-mu py-3 text-center italic">
                  {dict.journal.tradingPlan.noBiasHint}
                </p>
              ) : (
                <div className="space-y-2.5">
                  {dayPlan.bias.map((bItem, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-s2/60 border border-line rounded-xl space-y-2 text-xs"
                    >
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                        <input
                          type="text"
                          value={bItem.instrument}
                          onChange={(e) =>
                            handleUpdateBias(idx, "instrument", e.target.value.toUpperCase())
                          }
                          placeholder="EURUSD, BTCUSD..."
                          className="input text-xs uppercase font-bold w-full sm:w-32"
                          list="bias-inst-list"
                        />
                        <datalist id="bias-inst-list">
                          {INSTRUMENT_AUTOCOMPLETE.map((inst) => (
                            <option key={inst} value={inst} />
                          ))}
                        </datalist>

                        <div className="flex rounded-lg border border-line bg-s1 p-0.5 text-[11px] font-semibold w-full sm:w-auto">
                          <button
                            type="button"
                            onClick={() => handleUpdateBias(idx, "direction", "bullish")}
                            className={`flex-1 sm:flex-none px-2.5 py-1 rounded transition-colors ${
                              bItem.direction === "bullish"
                                ? "bg-emerald-500/20 text-emerald-400 font-bold"
                                : "text-mu hover:text-tx"
                            }`}
                          >
                            Bullish
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateBias(idx, "direction", "bearish")}
                            className={`flex-1 sm:flex-none px-2.5 py-1 rounded transition-colors ${
                              bItem.direction === "bearish"
                                ? "bg-rose-500/20 text-rose-400 font-bold"
                                : "text-mu hover:text-tx"
                            }`}
                          >
                            Bearish
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateBias(idx, "direction", "neutral")}
                            className={`flex-1 sm:flex-none px-2.5 py-1 rounded transition-colors ${
                              bItem.direction === "neutral"
                                ? "bg-amber-500/20 text-amber-300 font-bold"
                                : "text-mu hover:text-tx"
                            }`}
                          >
                            Neutral
                          </button>
                        </div>

                        <button
                          onClick={() => handleDeleteBias(idx)}
                          className="text-mu hover:text-rose-400 p-1 self-end sm:self-auto"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      <input
                        type="text"
                        value={bItem.note || ""}
                        onChange={(e) => handleUpdateBias(idx, "note", e.target.value.slice(0, 200))}
                        placeholder={dict.journal.tradingPlan.biasNotePlaceholder}
                        className="input text-xs w-full text-mu"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* BLOCK 2: LEVELS */}
            <div className="card p-4 space-y-3 border border-line">
              <div className="flex justify-between items-center border-b border-line pb-2">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-tx">
                    {dict.journal.tradingPlan.levelsTitle}
                  </h4>
                  <span className="text-[10px] text-mu font-semibold">
                    ({dayPlan.levels.length}/12)
                  </span>
                </div>
                {dayPlan.levels.length < 12 && (
                  <button
                    onClick={handleAddLevel}
                    className="btn-ghost text-xs py-1 px-2.5 flex items-center gap-1 font-medium"
                  >
                    <Plus size={13} />
                    <span>{dict.journal.addBtn}</span>
                  </button>
                )}
              </div>

              {dayPlan.levels.length === 0 ? (
                <p className="text-xs text-mu py-3 text-center italic">
                  {dict.journal.tradingPlan.noLevelsHint}
                </p>
              ) : (
                <div className="space-y-2">
                  {dayPlan.levels.map((lvl, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <input
                        type="text"
                        value={lvl.instrument || ""}
                        onChange={(e) => handleUpdateLevel(idx, "instrument", e.target.value.toUpperCase())}
                        placeholder={dict.journal.tradingPlan.instrumentPlaceholder}
                        className="input text-xs uppercase font-bold w-24 flex-none"
                      />
                      <input
                        type="number"
                        step="any"
                        value={lvl.price != null ? lvl.price : ""}
                        onChange={(e) =>
                          handleUpdateLevel(
                            idx,
                            "price",
                            e.target.value ? parseFloat(e.target.value) : undefined
                          )
                        }
                        placeholder={dict.journal.tradingPlan.pricePlaceholder}
                        className="input text-xs w-28 flex-none"
                      />
                      <input
                        type="text"
                        value={lvl.label || ""}
                        onChange={(e) => handleUpdateLevel(idx, "label", e.target.value.slice(0, 80))}
                        placeholder={dict.journal.tradingPlan.labelPlaceholder}
                        className="input text-xs flex-1"
                      />
                      <button
                        onClick={() => handleDeleteLevel(idx)}
                        className="text-mu hover:text-rose-400 p-1"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* BLOCK 3: EVENTS */}
            <div className="card p-4 space-y-3 border border-line">
              <div className="flex justify-between items-center border-b border-line pb-2">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-tx">
                    {dict.journal.tradingPlan.eventsTitle}
                  </h4>
                  <span className="text-[10px] text-mu font-semibold">
                    ({dayPlan.events.length}/8)
                  </span>
                </div>
                {dayPlan.events.length < 8 && (
                  <button
                    onClick={handleAddEvent}
                    className="btn-ghost text-xs py-1 px-2.5 flex items-center gap-1 font-medium"
                  >
                    <Plus size={13} />
                    <span>{dict.journal.addBtn}</span>
                  </button>
                )}
              </div>

              {dayPlan.events.length === 0 ? (
                <p className="text-xs text-mu py-3 text-center italic">
                  {dict.journal.tradingPlan.noEventsHint}
                </p>
              ) : (
                <div className="space-y-2">
                  {dayPlan.events.map((evt, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <input
                        type="text"
                        value={evt.time || ""}
                        onChange={(e) => handleUpdateEvent(idx, "time", e.target.value)}
                        placeholder="15:30"
                        className="input text-xs w-20 flex-none"
                      />
                      <input
                        type="text"
                        value={evt.text || ""}
                        onChange={(e) => handleUpdateEvent(idx, "text", e.target.value.slice(0, 120))}
                        placeholder={dict.journal.tradingPlan.eventTextPlaceholder}
                        className="input text-xs flex-1"
                      />
                      <button
                        onClick={() => handleDeleteEvent(idx)}
                        className="text-mu hover:text-rose-400 p-1"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* BLOCK 4: LIMITS */}
            <div className="card p-4 space-y-3 border border-line">
              <div className="flex justify-between items-center border-b border-line pb-2">
                <h4 className="font-bold text-sm text-tx">
                  {dict.journal.tradingPlan.limitsTitle}
                </h4>

                {/* Strategy Tooltip hint */}
                {activeStrategyWithLimit && (
                  <div
                    className="text-[10px] text-acc flex items-center gap-1 bg-s2/80 px-2 py-0.5 rounded border border-line"
                    title={dict.journal.tradingPlan.fromStrategy.replace(
                      "{val}",
                      `${activeStrategyWithLimit.riskLimit?.value}${activeStrategyWithLimit.riskLimit?.type}`
                    )}
                  >
                    <Info size={11} />
                    <span>
                      {dict.journal.tradingPlan.fromStrategy.replace(
                        "{val}",
                        `${activeStrategyWithLimit.riskLimit?.value}${activeStrategyWithLimit.riskLimit?.type.toUpperCase()}`
                      )}
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                {/* Max Risk per Trade */}
                <div>
                  <label className="text-mu block text-[11px] mb-1">
                    {dict.journal.tradingPlan.maxRiskPerTrade}
                  </label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="any"
                      value={
                        dayPlan.limits?.maxRiskPerTrade?.value != null
                          ? dayPlan.limits.maxRiskPerTrade.value
                          : ""
                      }
                      onChange={(e) => {
                        const val = e.target.value ? parseFloat(e.target.value) : undefined;
                        handleUpdateLimits((prev) => ({
                          ...prev,
                          maxRiskPerTrade: val != null
                            ? { type: prev.maxRiskPerTrade?.type || "r", value: val }
                            : undefined,
                        }));
                      }}
                      placeholder="1"
                      className="input text-xs w-full"
                    />
                    <select
                      value={dayPlan.limits?.maxRiskPerTrade?.type || "r"}
                      onChange={(e) => {
                        const t = e.target.value as "r" | "percent";
                        handleUpdateLimits((prev) => ({
                          ...prev,
                          maxRiskPerTrade: prev.maxRiskPerTrade
                            ? { ...prev.maxRiskPerTrade, type: t }
                            : undefined,
                        }));
                      }}
                      className="input text-xs w-16 uppercase flex-none"
                    >
                      <option value="r">R</option>
                      <option value="percent">%</option>
                    </select>
                  </div>
                </div>

                {/* Max Daily Loss */}
                <div>
                  <label className="text-mu block text-[11px] mb-1">
                    {dict.journal.tradingPlan.maxDailyLoss}
                  </label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="any"
                      value={
                        dayPlan.limits?.maxDailyLoss?.value != null
                          ? dayPlan.limits.maxDailyLoss.value
                          : ""
                      }
                      onChange={(e) => {
                        const val = e.target.value ? parseFloat(e.target.value) : undefined;
                        handleUpdateLimits((prev) => ({
                          ...prev,
                          maxDailyLoss: val != null
                            ? { type: prev.maxDailyLoss?.type || "r", value: val }
                            : undefined,
                        }));
                      }}
                      placeholder="2"
                      className="input text-xs w-full"
                    />
                    <select
                      value={dayPlan.limits?.maxDailyLoss?.type || "r"}
                      onChange={(e) => {
                        const t = e.target.value as "r" | "percent";
                        handleUpdateLimits((prev) => ({
                          ...prev,
                          maxDailyLoss: prev.maxDailyLoss
                            ? { ...prev.maxDailyLoss, type: t }
                            : undefined,
                        }));
                      }}
                      className="input text-xs w-16 uppercase flex-none"
                    >
                      <option value="r">R</option>
                      <option value="percent">%</option>
                    </select>
                  </div>
                </div>

                {/* Max Trades */}
                <div>
                  <label className="text-mu block text-[11px] mb-1">
                    {dict.journal.tradingPlan.maxTrades}
                  </label>
                  <input
                    type="number"
                    value={dayPlan.limits?.maxTrades != null ? dayPlan.limits.maxTrades : ""}
                    onChange={(e) => {
                      const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                      handleUpdateLimits((prev) => ({
                        ...prev,
                        maxTrades: val,
                      }));
                    }}
                    placeholder="3"
                    className="input text-xs w-full"
                  />
                </div>
              </div>
            </div>

            {/* BLOCK 5: CHECKLIST */}
            <div className="card p-4 space-y-3 border border-line lg:col-span-2">
              <div className="flex justify-between items-center border-b border-line pb-2">
                <div className="flex items-center gap-2">
                  <CheckSquare size={16} className="text-vi" />
                  <h4 className="font-bold text-sm text-tx">
                    {dict.journal.tradingPlan.checklistTitle}
                  </h4>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                {dayPlan.checklist.map((item, idx) => {
                  const label = item.key
                    ? (dict.journal.tradingPlan.checklistItems?.[item.key as keyof typeof dict.journal.tradingPlan.checklistItems] || item.key)
                    : item.text || "";

                  return (
                    <div
                      key={idx}
                      onClick={() => handleToggleChecklist(idx)}
                      className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-colors ${
                        item.done
                          ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
                          : "bg-s2/60 border-line text-tx/80 hover:border-line/80"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={item.done}
                          onChange={() => {}} // Handled by div click
                          className="w-4 h-4 rounded border-line text-vi focus:ring-vi flex-none"
                        />
                        <span className="font-medium">{label}</span>
                      </div>

                      {!item.key && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteChecklistItem(idx);
                          }}
                          className="text-mu hover:text-rose-400 p-1"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add Custom Item */}
              <div className="flex gap-2 pt-2 border-t border-line/40">
                <input
                  type="text"
                  value={customChecklistInput}
                  onChange={(e) => setCustomChecklistInput(e.target.value)}
                  placeholder={dict.journal.tradingPlan.customChecklistPlaceholder}
                  className="input text-xs flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCustomChecklistItem();
                    }
                  }}
                />
                <button
                  onClick={handleAddCustomChecklistItem}
                  className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1 font-semibold"
                >
                  <Plus size={14} />
                  <span>{dict.journal.addBtn}</span>
                </button>
              </div>
            </div>

            {/* BLOCK 6: NOTE */}
            <div className="card p-4 space-y-3 border border-line lg:col-span-2">
              <h4 className="font-bold text-sm text-tx">
                {dict.journal.tradingPlan.noteTitle}
              </h4>
              <textarea
                value={dayPlan.note || ""}
                onChange={(e) =>
                  updateDayPlan((prev) => ({ ...prev, note: e.target.value.slice(0, 500) }))
                }
                maxLength={500}
                rows={3}
                placeholder={dict.journal.tradingPlan.notePlaceholder}
                className="input text-xs w-full"
              />
            </div>

            {/* BLOCK 7: DAY REVIEW (SECTION 4) */}
            <div className="card p-5 space-y-4 border border-line lg:col-span-2 bg-s2/40">
              <div className="flex justify-between items-center border-b border-line pb-3">
                <div className="flex items-center gap-2">
                  <h4 className="font-serif font-bold text-base text-tx">
                    {dict.journal.tradingPlan.reviewTitle}
                  </h4>
                  {dayPlan.review?.completedAt && (
                    <span className="badge-free text-[10px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                      ✓ {dict.journal.tradingPlan.completedBadge}
                    </span>
                  )}
                </div>
              </div>

              {/* Day Rating 1-5 */}
              <div className="space-y-1">
                <label className="text-xs text-mu block font-semibold">
                  {dict.journal.tradingPlan.dayRatingLabel} (1–5)
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() =>
                        handleUpdateReview((prev) => ({ ...prev, rating: star }))
                      }
                      className={`w-9 h-9 rounded-xl border text-sm font-bold transition-colors ${
                        reviewState.rating >= star
                          ? "bg-amber-500/20 border-amber-500 text-amber-400"
                          : "bg-s1 border-line text-mu hover:text-tx"
                      }`}
                    >
                      {star}★
                    </button>
                  ))}
                </div>
              </div>

              {/* Followed Plan? */}
              <div className="space-y-1">
                <label className="text-xs text-mu block font-semibold">
                  {dict.journal.tradingPlan.followedPlanLabel}
                </label>
                <div className="flex rounded-xl bg-s1 border border-line p-1 max-w-sm text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateReview((prev) => ({ ...prev, followedPlan: "yes" }))
                    }
                    className={`flex-1 py-1.5 px-3 rounded-lg transition-colors ${
                      reviewState.followedPlan === "yes"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold"
                        : "text-mu hover:text-tx"
                    }`}
                  >
                    {dict.journal.tradingPlan.followedYes}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateReview((prev) => ({ ...prev, followedPlan: "partly" }))
                    }
                    className={`flex-1 py-1.5 px-3 rounded-lg transition-colors ${
                      reviewState.followedPlan === "partly"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold"
                        : "text-mu hover:text-tx"
                    }`}
                  >
                    {dict.journal.tradingPlan.followedPartly}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateReview((prev) => ({ ...prev, followedPlan: "no" }))
                    }
                    className={`flex-1 py-1.5 px-3 rounded-lg transition-colors ${
                      reviewState.followedPlan === "no"
                        ? "bg-rose-500/20 text-rose-400 border border-rose-500/30 font-bold"
                        : "text-mu hover:text-tx"
                    }`}
                  >
                    {dict.journal.tradingPlan.followedNo}
                  </button>
                </div>
              </div>

              {/* Day Emotions Multi-select */}
              <div className="space-y-1">
                <label className="text-xs text-mu block font-semibold">
                  {dict.journal.emotionsHeader}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {EMOTIONS_CATALOG.map((emo) => {
                    const active = (reviewState.emotions || []).includes(emo);
                    return (
                      <button
                        key={emo}
                        type="button"
                        onClick={() =>
                          handleUpdateReview((prev) => {
                            const curEmos = prev.emotions || [];
                            const nextEmos = curEmos.includes(emo)
                              ? curEmos.filter((e) => e !== emo)
                              : [...curEmos, emo];
                            return { ...prev, emotions: nextEmos };
                          })
                        }
                        className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                          active
                            ? "bg-acc/20 border-acc text-tx font-bold"
                            : "bg-s1 border-line text-mu hover:text-tx"
                        }`}
                      >
                        {dict.journal.emotions[emo]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Three Text Areas: What worked, What to improve, Lesson */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-mu block font-semibold mb-1">
                    {dict.journal.tradingPlan.whatWorkedLabel}
                  </label>
                  <textarea
                    value={reviewState.whatWorked || ""}
                    onChange={(e) =>
                      handleUpdateReview((prev) => ({
                        ...prev,
                        whatWorked: e.target.value.slice(0, 300),
                      }))
                    }
                    maxLength={300}
                    rows={3}
                    placeholder={dict.journal.tradingPlan.whatWorkedPlaceholder}
                    className="input text-xs w-full"
                  />
                </div>

                <div>
                  <label className="text-xs text-mu block font-semibold mb-1">
                    {dict.journal.tradingPlan.whatToImproveLabel}
                  </label>
                  <textarea
                    value={reviewState.whatToImprove || ""}
                    onChange={(e) =>
                      handleUpdateReview((prev) => ({
                        ...prev,
                        whatToImprove: e.target.value.slice(0, 300),
                      }))
                    }
                    maxLength={300}
                    rows={3}
                    placeholder={dict.journal.tradingPlan.whatToImprovePlaceholder}
                    className="input text-xs w-full"
                  />
                </div>

                <div>
                  <label className="text-xs text-mu block font-semibold mb-1">
                    {dict.journal.tradingPlan.lessonLabel}
                  </label>
                  <textarea
                    value={reviewState.lesson || ""}
                    onChange={(e) =>
                      handleUpdateReview((prev) => ({
                        ...prev,
                        lesson: e.target.value.slice(0, 300),
                      }))
                    }
                    maxLength={300}
                    rows={3}
                    placeholder={dict.journal.tradingPlan.lessonPlaceholder}
                    className="input text-xs w-full"
                  />
                </div>
              </div>

              {/* Complete Day Button */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleCompleteDayReview}
                  className="btn-primary py-2 px-5 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Check size={15} />
                  <span>{dict.journal.tradingPlan.completeDayBtn}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODE 2: WEEK PLAN */}
      {mode === "week" && (
        <div className="card p-5 space-y-4 border border-line">
          <div className="flex justify-between items-center border-b border-line pb-3">
            <h4 className="font-serif font-bold text-base text-tx">
              {dict.journal.tradingPlan.weekPlanTitle}
            </h4>
          </div>

          {/* Week Goals (Up to 3) */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-tx">
                {dict.journal.tradingPlan.weekGoalsUpTo3}
              </label>
              {weekPlanState.goals.length < 3 && (
                <button
                  onClick={handleAddWeekGoal}
                  className="btn-ghost text-xs py-1 px-2.5 flex items-center gap-1 font-medium text-acc"
                >
                  <Plus size={13} />
                  <span>{dict.journal.addBtn}</span>
                </button>
              )}
            </div>

            <div className="space-y-2">
              {weekPlanState.goals.map((goal, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-mu w-5">{idx + 1}.</span>
                  <input
                    type="text"
                    value={goal}
                    onChange={(e) => handleUpdateWeekGoal(idx, e.target.value)}
                    placeholder={dict.journal.tradingPlan.weekGoalPlaceholder}
                    className="input text-xs flex-1"
                  />
                  {weekPlanState.goals.length > 1 && (
                    <button
                      onClick={() => handleDeleteWeekGoal(idx)}
                      className="text-mu hover:text-rose-400 p-1"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Week Focus */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-tx block">
              {dict.journal.tradingPlan.weekFocusLabel}
            </label>
            <input
              type="text"
              value={weekPlanState.focus || ""}
              onChange={(e) =>
                updateWeekPlan((prev) => ({ ...prev, focus: e.target.value.slice(0, 200) }))
              }
              placeholder={dict.journal.tradingPlan.weekFocusPlaceholder}
              className="input text-xs w-full"
            />
          </div>

          {/* Week Summary */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-tx block">
              {dict.journal.tradingPlan.weekSummaryLabel}
            </label>
            <textarea
              value={weekPlanState.summary || ""}
              onChange={(e) =>
                updateWeekPlan((prev) => ({ ...prev, summary: e.target.value.slice(0, 500) }))
              }
              maxLength={500}
              rows={4}
              placeholder={dict.journal.tradingPlan.weekSummaryPlaceholder}
              className="input text-xs w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
