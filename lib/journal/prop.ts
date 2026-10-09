import {
  Account,
  Trade,
  PropRules,
  PropDayReset,
  PropLimitStatus,
} from "./types";
import { GAME_CONFIG } from "../game-config";

export interface DailyLossResult {
  dayPnL: number;
  baseBalance: number;
  limitInMoney: number;
  usedMoney: number;
  usedPct: number;
  remainingMoney: number;
  status: PropLimitStatus;
}

export interface TotalDrawdownResult {
  currentBalance: number;
  peakBalance: number;
  drawdownLevel: number;
  limitInMoney: number;
  usedMoney: number;
  usedPct: number;
  remainingMoney: number;
  status: PropLimitStatus;
  mode: "static" | "trailingClosed";
  lockAtInitial: boolean;
}

export interface ProfitTargetResult {
  initialBalance: number;
  currentBalance: number;
  targetInMoney: number;
  currentProfit: number;
  progressPct: number;
  remainingMoney: number;
  status: PropLimitStatus;
}

export interface TradingDaysResult {
  count: number;
  minTradingDays?: number;
  maxTradingDays?: number;
  remainingDaysToMax?: number | null;
  status: PropLimitStatus;
}

export interface ConsistencyResult {
  maxSingleDaySharePct: number;
  allowedSharePct: number;
  isPassing: boolean;
  hasProfit: boolean;
}

export interface PropDaySummary {
  dayKey: string;
  dayPnL: number;
  dailyLimitMoney: number;
  dailyLimitUsedPct: number;
  isTradingDay: boolean;
  tradeCount: number;
}

export interface PreTradePrediction {
  dailyLossPct: number;
  dailyLossStatus: PropLimitStatus;
  totalDrawdownPct: number;
  totalDrawdownStatus: PropLimitStatus;
  maxUsedPct: number;
  worstStatus: PropLimitStatus;
}

export interface PropMetricsSummary {
  initialBalance: number;
  currentBalance: number;
  accumulatedPnL: number;
  tradeCount: number;
  dailyLoss?: DailyLossResult;
  totalDrawdown?: TotalDrawdownResult;
  profitTarget?: ProfitTargetResult;
  tradingDays?: TradingDaysResult;
  consistency?: ConsistencyResult;
  todayDayKey: string;
  daysHistory: PropDaySummary[];
}

export function getLimitStatus(usedPct: number): PropLimitStatus {
  const t = GAME_CONFIG.PROP_RULE_THRESHOLDS;
  if (usedPct >= t.REACHED * 100) return "reached";
  if (usedPct >= t.CLOSE * 100) return "close";
  if (usedPct >= t.CAUTION * 100) return "caution";
  return "ok";
}

/**
 * Calculates prop firm day key (YYYY-MM-DD) for a given timestamp based on dayReset timezone and hour.
 */
export function getPropFirmDayKey(dateInput: Date | string, dayReset?: PropDayReset): string {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) {
    return new Date().toISOString().split("T")[0];
  }

  const tz = dayReset?.timezone || "UTC";
  const resetHour = dayReset?.hour ?? 0;

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const parts = formatter.formatToParts(d);
    let year = "";
    let month = "";
    let day = "";
    let hour = 0;

    for (const p of parts) {
      if (p.type === "year") year = p.value;
      if (p.type === "month") month = p.value;
      if (p.type === "day") day = p.value;
      if (p.type === "hour") hour = parseInt(p.value, 10) % 24;
    }

    const localDate = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10)));

    if (resetHour > 0 && hour < resetHour) {
      localDate.setUTCDate(localDate.getUTCDate() - 1);
    }

    const y = localDate.getUTCFullYear();
    const m = String(localDate.getUTCMonth() + 1).padStart(2, "0");
    const dayStr = String(localDate.getUTCDate()).padStart(2, "0");

    return `${y}-${m}-${dayStr}`;
  } catch {
    const utcDate = new Date(d);
    if (resetHour > 0 && utcDate.getUTCHours() < resetHour) {
      utcDate.setUTCDate(utcDate.getUTCDate() - 1);
    }
    return utcDate.toISOString().split("T")[0];
  }
}

/**
 * Filters closed trades belonging to account and phase (closedAt >= startedAt)
 */
export function getPhaseTrades(trades: Trade[], propRules: PropRules, accountId: string): Trade[] {
  if (!propRules || !propRules.startedAt) return [];
  const startedAtMs = new Date(propRules.startedAt).getTime();

  return trades.filter((t) => {
    if (t.accountId !== accountId) return false;
    if (t.status !== "closed") return false;
    if (!t.closedAt) return false;
    const closedAtMs = new Date(t.closedAt).getTime();
    return !isNaN(closedAtMs) && closedAtMs >= startedAtMs;
  });
}

/**
 * Calculates Daily Loss metric
 */
export function calculateDailyLoss(
  phaseTrades: Trade[],
  propRules: PropRules,
  accountStartBalance: number,
  targetDayKey: string
): DailyLossResult | undefined {
  const limitRule = propRules.maxDailyLoss;
  if (!limitRule || typeof limitRule.value !== "number" || limitRule.value <= 0) {
    return undefined;
  }

  const initialBalance = propRules.initialBalance ?? accountStartBalance ?? 0;

  const dayTradesMap: Record<string, Trade[]> = {};
  phaseTrades.forEach((t) => {
    const key = getPropFirmDayKey(t.closedAt!, propRules.dayReset);
    if (!dayTradesMap[key]) dayTradesMap[key] = [];
    dayTradesMap[key].push(t);
  });

  const dayTrades = dayTradesMap[targetDayKey] || [];
  const dayPnL = dayTrades.reduce((sum, t) => sum + (t.pnlMoney || 0), 0);

  let baseBalance = initialBalance;
  if (limitRule.base === "startOfDayBalance") {
    let priorPnL = 0;
    phaseTrades.forEach((t) => {
      const key = getPropFirmDayKey(t.closedAt!, propRules.dayReset);
      if (key < targetDayKey) {
        priorPnL += t.pnlMoney || 0;
      }
    });
    baseBalance = initialBalance + priorPnL;
  }

  const limitInMoney =
    limitRule.type === "money" ? limitRule.value : baseBalance * (limitRule.value / 100);

  const usedMoney = Math.max(0, -dayPnL);
  const usedPct = limitInMoney > 0 ? (usedMoney / limitInMoney) * 100 : 0;
  const remainingMoney = limitInMoney - usedMoney;
  const status = getLimitStatus(usedPct);

  return {
    dayPnL,
    baseBalance,
    limitInMoney,
    usedMoney,
    usedPct,
    remainingMoney,
    status,
  };
}

/**
 * Calculates Total Drawdown metric
 */
export function calculateTotalDrawdown(
  phaseTrades: Trade[],
  propRules: PropRules,
  accountStartBalance: number
): TotalDrawdownResult | undefined {
  const limitRule = propRules.maxTotalDrawdown;
  if (!limitRule || typeof limitRule.value !== "number" || limitRule.value <= 0) {
    return undefined;
  }

  const initialBalance = propRules.initialBalance ?? accountStartBalance ?? 0;
  const mode = limitRule.mode || "static";
  const lockAtInitial = Boolean(limitRule.lockAtInitial);

  const sortedTrades = [...phaseTrades].sort(
    (a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime()
  );

  let runningBalance = initialBalance;
  let peakBalance = initialBalance;

  sortedTrades.forEach((t) => {
    runningBalance += t.pnlMoney || 0;
    if (runningBalance > peakBalance) {
      peakBalance = runningBalance;
    }
  });

  const currentBalance = runningBalance;

  const limitInMoney =
    limitRule.type === "money" ? limitRule.value : initialBalance * (limitRule.value / 100);

  let drawdownLevel = 0;
  let usedMoney = 0;

  if (mode === "static") {
    drawdownLevel = initialBalance - limitInMoney;
    usedMoney = Math.max(0, initialBalance - currentBalance);
  } else {
    // trailingClosed
    const rawLevel = peakBalance - limitInMoney;
    drawdownLevel = lockAtInitial ? Math.min(initialBalance, rawLevel) : rawLevel;
    usedMoney = Math.max(0, peakBalance - currentBalance);
  }

  const usedPct = limitInMoney > 0 ? (usedMoney / limitInMoney) * 100 : 0;
  const remainingMoney = currentBalance - drawdownLevel;
  const status = getLimitStatus(usedPct);

  return {
    currentBalance,
    peakBalance,
    drawdownLevel,
    limitInMoney,
    usedMoney,
    usedPct,
    remainingMoney,
    status,
    mode,
    lockAtInitial,
  };
}

/**
 * Calculates Profit Target progress
 */
export function calculateProfitTarget(
  phaseTrades: Trade[],
  propRules: PropRules,
  accountStartBalance: number
): ProfitTargetResult | undefined {
  const targetRule = propRules.profitTarget;
  if (!targetRule || typeof targetRule.value !== "number" || targetRule.value <= 0) {
    return undefined;
  }

  const initialBalance = propRules.initialBalance ?? accountStartBalance ?? 0;
  const accumulatedPnL = phaseTrades.reduce((sum, t) => sum + (t.pnlMoney || 0), 0);
  const currentBalance = initialBalance + accumulatedPnL;

  const targetInMoney =
    targetRule.type === "money" ? targetRule.value : initialBalance * (targetRule.value / 100);

  const currentProfit = Math.max(0, currentBalance - initialBalance);
  const progressPct = targetInMoney > 0 ? (currentProfit / targetInMoney) * 100 : 0;
  const remainingMoney = Math.max(0, targetInMoney - (currentBalance - initialBalance));
  const status: PropLimitStatus = progressPct >= 100 ? "reached" : "ok";

  return {
    initialBalance,
    currentBalance,
    targetInMoney,
    currentProfit,
    progressPct,
    remainingMoney,
    status,
  };
}

/**
 * Calculates Trading Days progress
 */
export function calculateTradingDays(
  phaseTrades: Trade[],
  propRules: PropRules
): TradingDaysResult | undefined {
  if (propRules.minTradingDays == null && propRules.maxTradingDays == null) {
    return undefined;
  }

  const dayTradesMap: Record<string, Trade[]> = {};
  phaseTrades.forEach((t) => {
    const key = getPropFirmDayKey(t.closedAt!, propRules.dayReset);
    if (!dayTradesMap[key]) dayTradesMap[key] = [];
    dayTradesMap[key].push(t);
  });

  const minPnl = propRules.minTradingDayMinPnl;

  let count = 0;
  Object.values(dayTradesMap).forEach((trades) => {
    if (trades.length > 0) {
      if (minPnl != null) {
        const pnl = trades.reduce((sum, t) => sum + (t.pnlMoney || 0), 0);
        if (pnl >= minPnl) count++;
      } else {
        count++;
      }
    }
  });

  const minDays = propRules.minTradingDays;
  const maxDays = propRules.maxTradingDays;

  const remainingDaysToMax = maxDays != null ? Math.max(0, maxDays - count) : null;
  const status: PropLimitStatus = minDays ? (count >= minDays ? "reached" : "ok") : "ok";

  return {
    count,
    minTradingDays: minDays,
    maxTradingDays: maxDays,
    remainingDaysToMax,
    status,
  };
}

/**
 * Calculates Consistency Rule share
 */
export function calculateConsistency(
  phaseTrades: Trade[],
  propRules: PropRules
): ConsistencyResult | undefined {
  const consistency = propRules.consistencyRule;
  if (!consistency || typeof consistency.maxSingleDayShare !== "number") {
    return undefined;
  }

  const dayTradesMap: Record<string, number> = {};
  phaseTrades.forEach((t) => {
    const key = getPropFirmDayKey(t.closedAt!, propRules.dayReset);
    dayTradesMap[key] = (dayTradesMap[key] || 0) + (t.pnlMoney || 0);
  });

  const positiveDayPnLs = Object.values(dayTradesMap).filter((pnl) => pnl > 0);
  const totalPositivePnL = positiveDayPnLs.reduce((a, b) => a + b, 0);

  if (totalPositivePnL <= 0) {
    return {
      maxSingleDaySharePct: 0,
      allowedSharePct: consistency.maxSingleDayShare,
      isPassing: true,
      hasProfit: false,
    };
  }

  const maxSingleDayPnL = Math.max(...positiveDayPnLs);
  const maxSingleDaySharePct = (maxSingleDayPnL / totalPositivePnL) * 100;
  const isPassing = maxSingleDaySharePct <= consistency.maxSingleDayShare;

  return {
    maxSingleDaySharePct,
    allowedSharePct: consistency.maxSingleDayShare,
    isPassing,
    hasProfit: true,
  };
}

/**
 * Calculates 14-day history table of prop firm days
 */
export function getPropDaysHistory(
  phaseTrades: Trade[],
  propRules: PropRules,
  accountStartBalance: number,
  nowDate: Date = new Date()
): PropDaySummary[] {
  const todayKey = getPropFirmDayKey(nowDate, propRules.dayReset);

  const dayTradesMap: Record<string, Trade[]> = {};
  phaseTrades.forEach((t) => {
    const key = getPropFirmDayKey(t.closedAt!, propRules.dayReset);
    if (!dayTradesMap[key]) dayTradesMap[key] = [];
    dayTradesMap[key].push(t);
  });

  const history: PropDaySummary[] = [];
  const baseDate = new Date(nowDate);

  for (let i = 13; i >= 0; i--) {
    const d = new Date(baseDate);
    d.setUTCDate(d.getUTCDate() - i);
    const dayKey = getPropFirmDayKey(d, propRules.dayReset);

    if (history.some((h) => h.dayKey === dayKey)) continue;

    const trades = dayTradesMap[dayKey] || [];
    const dayPnL = trades.reduce((sum, t) => sum + (t.pnlMoney || 0), 0);
    const tradeCount = trades.length;

    let isTradingDay = tradeCount > 0;
    if (propRules.minTradingDayMinPnl != null && isTradingDay) {
      isTradingDay = dayPnL >= propRules.minTradingDayMinPnl;
    }

    const dailyLossRes = calculateDailyLoss(phaseTrades, propRules, accountStartBalance, dayKey);

    history.push({
      dayKey,
      dayPnL,
      dailyLimitMoney: dailyLossRes?.limitInMoney ?? 0,
      dailyLimitUsedPct: dailyLossRes?.usedPct ?? 0,
      isTradingDay,
      tradeCount,
    });
  }

  return history.slice(-14);
}

/**
 * Pre-trade check risk prediction
 */
export function predictPreTradeUsage(
  account: Account,
  phaseTrades: Trade[],
  riskAmountMoney: number,
  editingTradeId?: string,
  nowDate: Date = new Date()
): PreTradePrediction | undefined {
  if (!account.propRules || riskAmountMoney <= 0) {
    return undefined;
  }

  const propRules = account.propRules;
  const initialBalance = propRules.initialBalance ?? account.startBalance ?? 0;
  const todayKey = getPropFirmDayKey(nowDate, propRules.dayReset);

  const activeTrades = editingTradeId
    ? phaseTrades.filter((t) => t.id !== editingTradeId)
    : phaseTrades;

  // 1. Daily Loss Prediction
  const dailyLossRule = propRules.maxDailyLoss;
  let dailyLossPct = 0;
  let dailyLossStatus: PropLimitStatus = "ok";

  if (dailyLossRule && dailyLossRule.value > 0) {
    const currentDailyRes = calculateDailyLoss(activeTrades, propRules, initialBalance, todayKey);
    const currentDayPnL = currentDailyRes?.dayPnL ?? 0;
    const baseBalance = currentDailyRes?.baseBalance ?? initialBalance;

    const limitInMoney =
      dailyLossRule.type === "money"
        ? dailyLossRule.value
        : baseBalance * (dailyLossRule.value / 100);

    const predictedDayPnL = currentDayPnL - riskAmountMoney;
    const predictedUsedMoney = Math.max(0, -predictedDayPnL);
    dailyLossPct = limitInMoney > 0 ? (predictedUsedMoney / limitInMoney) * 100 : 0;
    dailyLossStatus = getLimitStatus(dailyLossPct);
  }

  // 2. Total Drawdown Prediction
  const drawdownRule = propRules.maxTotalDrawdown;
  let totalDrawdownPct = 0;
  let totalDrawdownStatus: PropLimitStatus = "ok";

  if (drawdownRule && drawdownRule.value > 0) {
    const accumulatedPnL = activeTrades.reduce((sum, t) => sum + (t.pnlMoney || 0), 0);
    const currentBalance = initialBalance + accumulatedPnL;
    const predictedBalance = currentBalance - riskAmountMoney;

    const limitInMoney =
      drawdownRule.type === "money"
        ? drawdownRule.value
        : initialBalance * (drawdownRule.value / 100);

    const mode = drawdownRule.mode || "static";

    if (mode === "static") {
      const predictedUsedMoney = Math.max(0, initialBalance - predictedBalance);
      totalDrawdownPct = limitInMoney > 0 ? (predictedUsedMoney / limitInMoney) * 100 : 0;
    } else {
      let peakBalance = initialBalance;
      let running = initialBalance;
      const sorted = [...activeTrades].sort(
        (a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime()
      );
      sorted.forEach((t) => {
        running += t.pnlMoney || 0;
        if (running > peakBalance) peakBalance = running;
      });

      const predictedUsedMoney = Math.max(0, peakBalance - predictedBalance);
      totalDrawdownPct = limitInMoney > 0 ? (predictedUsedMoney / limitInMoney) * 100 : 0;
    }

    totalDrawdownStatus = getLimitStatus(totalDrawdownPct);
  }

  const maxUsedPct = Math.max(dailyLossPct, totalDrawdownPct);
  const worstStatus: PropLimitStatus = getLimitStatus(maxUsedPct);

  return {
    dailyLossPct,
    dailyLossStatus,
    totalDrawdownPct,
    totalDrawdownStatus,
    maxUsedPct,
    worstStatus,
  };
}

/**
 * Full Prop Metrics aggregation for account
 */
export function calculatePropMetrics(
  account: Account,
  allTrades: Trade[],
  nowDate: Date = new Date()
): PropMetricsSummary | undefined {
  if (!account.propRules || !account.propRules.startedAt) {
    return undefined;
  }

  const propRules = account.propRules;
  const initialBalance = propRules.initialBalance ?? account.startBalance ?? 0;
  const phaseTrades = getPhaseTrades(allTrades, propRules, account.id);
  const todayDayKey = getPropFirmDayKey(nowDate, propRules.dayReset);

  const accumulatedPnL = phaseTrades.reduce((sum, t) => sum + (t.pnlMoney || 0), 0);
  const currentBalance = initialBalance + accumulatedPnL;

  const dailyLoss = calculateDailyLoss(phaseTrades, propRules, initialBalance, todayDayKey);
  const totalDrawdown = calculateTotalDrawdown(phaseTrades, propRules, initialBalance);
  const profitTarget = calculateProfitTarget(phaseTrades, propRules, initialBalance);
  const tradingDays = calculateTradingDays(phaseTrades, propRules);
  const consistency = calculateConsistency(phaseTrades, propRules);
  const daysHistory = getPropDaysHistory(phaseTrades, propRules, initialBalance, nowDate);

  return {
    initialBalance,
    currentBalance,
    accumulatedPnL,
    tradeCount: phaseTrades.length,
    dailyLoss,
    totalDrawdown,
    profitTarget,
    tradingDays,
    consistency,
    todayDayKey,
    daysHistory,
  };
}
