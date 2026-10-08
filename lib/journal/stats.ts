import { Account, Trade } from "./types";
import { GAME_CONFIG } from "../game-config";
import { calculatePnlPercent } from "./calc";

export interface CalculateStatsOptions {
  timeZone?: string;
  referenceDate?: Date;
  minSampleSize?: number;
}

export interface JournalAnalytics {
  totalTrades: number; // Only closed trades
  winsCount: number;
  lossesCount: number;
  breakevenCount: number;
  winRate: number; // winsCount / totalTrades (0 if no trades)

  totalR: number;
  knownRCount: number;
  expectancyR: number | null; // avg R across trades with known R
  avgWinR: number | null;
  avgLossR: number | null;
  payoff: number | null; // avgWinR / |avgLossR|

  totalMoney: number | null; // null if multi-currency or no money
  isMultiCurrency: boolean;
  currencies: string[];

  totalPnlPercent: number | null; // sum PnL % relative to startBalance

  profitFactorR: number | null; // gross profit R / gross loss R
  profitFactorMoney: number | null; // gross profit $ / gross loss $

  maxDrawdownR: number; // Peak to trough DD in R
  maxDrawdownMoney: number | null; // Peak to trough DD in money

  bestTradeR: number | null;
  worstTradeR: number | null;
  bestTradeMoney: number | null;
  worstTradeMoney: number | null;

  longestWinStreak: number;
  longestLossStreak: number;

  avgHoldingTimeMinutes: number | null;
  tradesPerDay: number;

  hasLowData: boolean;
  minSampleSize: number;
}

export interface EquityPoint {
  index: number;
  tradeId?: string;
  dateStr: string;
  isoDate: string;
  rMultipleCum: number;
  moneyCum: number | null;
  percentCum: number | null;
}

export interface CalendarDayStat {
  dateStr: string; // YYYY-MM-DD
  dayNumber: number;
  tradesCount: number;
  totalR: number;
  totalMoney: number | null;
  totalPercent: number | null;
  status: "win" | "loss" | "breakeven" | "none";
  trades: Trade[];
}

export interface CalendarWeekStat {
  weekNumber: number;
  totalR: number;
  totalMoney: number | null;
  tradesCount: number;
}

export interface CalendarMonthStat {
  year: number;
  month: number; // 0-indexed (0 = Jan)
  days: CalendarDayStat[];
  weeks: CalendarWeekStat[];
  totalResultR: number;
  totalResultMoney: number | null;
  totalTradesCount: number;
  winRate: number;
  bestDayStr: string | null;
  bestDayR: number | null;
  worstDayStr: string | null;
  worstDayR: number | null;
}

export interface ReportSliceRow {
  key: string;
  labelKey?: string;
  tradesCount: number;
  winsCount: number;
  lossesCount: number;
  breakevenCount: number;
  winRate: number;
  avgR: number | null;
  totalR: number;
  totalMoney: number | null;
  profitFactor: number | null;
  hasLowData: boolean;
}

export interface ProcessOutcomeMatrix {
  goodWinCount: number;
  goodWinAvgR: number | null;
  goodLossCount: number;
  goodLossAvgR: number | null;
  badWinCount: number;
  badWinAvgR: number | null;
  badLossCount: number;
  badLossAvgR: number | null;
  mediumExecutionCount: number;
  unratedCount: number;
  usedProcessScoreFallback: boolean;
}

/**
 * Gets a YYYY-MM-DD date string in the specified timezone for an ISO date string or Date object.
 */
export function getLocalDateString(dateInput: string | Date, timeZone: string = "UTC"): string {
  const dateObj = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(dateObj.getTime())) return "1970-01-01";

  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(dateObj); // Returns YYYY-MM-DD format
  } catch {
    return dateObj.toISOString().split("T")[0];
  }
}

/**
 * Calculates analytics for closed trades.
 */
export function calculateJournalAnalytics(
  trades: Trade[],
  accounts: Account[],
  options: CalculateStatsOptions = {}
): JournalAnalytics {
  const minSampleSize = options.minSampleSize ?? GAME_CONFIG.JOURNAL_MIN_SAMPLE_SIZE;

  // Filter only closed trades
  const closedTrades = trades.filter((t) => t.status === "closed");

  // Sort trades by openedAt or createdAt ascending
  const sortedTrades = [...closedTrades].sort(
    (a, b) => new Date(a.openedAt || a.createdAt).getTime() - new Date(b.openedAt || b.createdAt).getTime()
  );

  const totalTrades = sortedTrades.length;

  // Currencies check
  const accountMap = new Map<string, Account>();
  accounts.forEach((a) => accountMap.set(a.id, a));

  const usedAccountIds = new Set(sortedTrades.map((t) => t.accountId));
  const currenciesSet = new Set<string>();
  usedAccountIds.forEach((accId) => {
    const acc = accountMap.get(accId);
    if (acc?.currency) {
      currenciesSet.add(acc.currency);
    }
  });

  const currencies = Array.from(currenciesSet);
  const isMultiCurrency = currencies.length > 1;

  let winsCount = 0;
  let lossesCount = 0;
  let breakevenCount = 0;

  let totalR = 0;
  let knownRCount = 0;
  let sumWinR = 0;
  let winRCount = 0;
  let sumLossR = 0;
  let lossRCount = 0;

  let grossProfitR = 0;
  let grossLossR = 0;

  let totalMoneyAcc = 0;
  let hasMoneyData = false;
  let grossProfitMoney = 0;
  let grossLossMoney = 0;

  let totalPnlPercentAcc = 0;
  let hasPercentData = false;

  let bestTradeR: number | null = null;
  let worstTradeR: number | null = null;
  let bestTradeMoney: number | null = null;
  let worstTradeMoney: number | null = null;

  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;

  let totalHoldingMinutes = 0;
  let validHoldingCount = 0;

  // Drawdown variables
  let peakR = 0;
  let cumR = 0;
  let maxDrawdownR = 0;

  let peakMoney = 0;
  let cumMoney = 0;
  let maxDrawdownMoneyAcc = 0;

  sortedTrades.forEach((trade) => {
    // Result breakdown
    if (trade.result === "win") {
      winsCount++;
      currentWinStreak++;
      currentLossStreak = 0;
      if (currentWinStreak > longestWinStreak) longestWinStreak = currentWinStreak;
    } else if (trade.result === "loss") {
      lossesCount++;
      currentLossStreak++;
      currentWinStreak = 0;
      if (currentLossStreak > longestLossStreak) longestLossStreak = currentLossStreak;
    } else {
      breakevenCount++;
      currentWinStreak = 0;
      currentLossStreak = 0;
    }

    // R metrics
    if (typeof trade.rMultiple === "number" && !isNaN(trade.rMultiple)) {
      const r = trade.rMultiple;
      knownRCount++;
      totalR += r;
      cumR += r;
      if (cumR > peakR) peakR = cumR;
      const ddR = peakR - cumR;
      if (ddR > maxDrawdownR) maxDrawdownR = ddR;

      if (trade.result === "win") {
        sumWinR += r;
        winRCount++;
        if (r > 0) grossProfitR += r;
      } else if (trade.result === "loss") {
        sumLossR += r;
        lossRCount++;
        if (r < 0) grossLossR += Math.abs(r);
      }

      if (bestTradeR === null || r > bestTradeR) bestTradeR = r;
      if (worstTradeR === null || r < worstTradeR) worstTradeR = r;
    }

    // Money metrics
    if (!isMultiCurrency && typeof trade.pnlMoney === "number" && !isNaN(trade.pnlMoney)) {
      const m = trade.pnlMoney;
      hasMoneyData = true;
      totalMoneyAcc += m;
      cumMoney += m;
      if (cumMoney > peakMoney) peakMoney = cumMoney;
      const ddMoney = peakMoney - cumMoney;
      if (ddMoney > maxDrawdownMoneyAcc) maxDrawdownMoneyAcc = ddMoney;

      if (m > 0) grossProfitMoney += m;
      else if (m < 0) grossLossMoney += Math.abs(m);

      if (bestTradeMoney === null || m > bestTradeMoney) bestTradeMoney = m;
      if (worstTradeMoney === null || m < worstTradeMoney) worstTradeMoney = m;
    }

    // Percent metrics
    const acc = accountMap.get(trade.accountId);
    if (acc?.startBalance && acc.startBalance > 0 && typeof trade.pnlMoney === "number") {
      const pct = calculatePnlPercent(trade.pnlMoney, acc.startBalance);
      if (pct !== null) {
        hasPercentData = true;
        totalPnlPercentAcc += pct;
      }
    }

    // Holding time
    if (trade.openedAt && trade.closedAt) {
      const openMs = new Date(trade.openedAt).getTime();
      const closeMs = new Date(trade.closedAt).getTime();
      if (!isNaN(openMs) && !isNaN(closeMs) && closeMs >= openMs) {
        totalHoldingMinutes += (closeMs - openMs) / (1000 * 60);
        validHoldingCount++;
      }
    }
  });

  const winRate = totalTrades > 0 ? winsCount / totalTrades : 0;
  const expectancyR = knownRCount > 0 ? totalR / knownRCount : null;
  const avgWinR = winRCount > 0 ? sumWinR / winRCount : null;
  const avgLossR = lossRCount > 0 ? sumLossR / lossRCount : null;
  const payoff = avgWinR !== null && avgLossR !== null && avgLossR !== 0 ? avgWinR / Math.abs(avgLossR) : null;

  const profitFactorR = grossLossR > 0 ? grossProfitR / grossLossR : null;
  const profitFactorMoney = grossLossMoney > 0 ? grossProfitMoney / grossLossMoney : null;

  const totalMoney = !isMultiCurrency && hasMoneyData ? totalMoneyAcc : null;
  const totalPnlPercent = hasPercentData ? totalPnlPercentAcc : null;
  const maxDrawdownMoney = !isMultiCurrency && hasMoneyData ? maxDrawdownMoneyAcc : null;

  const avgHoldingTimeMinutes = validHoldingCount > 0 ? totalHoldingMinutes / validHoldingCount : null;

  // Trades per day across span or period
  let tradesPerDay = 0;
  if (totalTrades > 0) {
    const firstTime = new Date(sortedTrades[0].openedAt || sortedTrades[0].createdAt).getTime();
    const lastTime = new Date(sortedTrades[totalTrades - 1].closedAt || sortedTrades[totalTrades - 1].openedAt || sortedTrades[totalTrades - 1].createdAt).getTime();
    const daysSpan = Math.max(1, Math.ceil((lastTime - firstTime) / (1000 * 60 * 60 * 24)));
    tradesPerDay = totalTrades / daysSpan;
  }

  const hasLowData = totalTrades < minSampleSize;

  return {
    totalTrades,
    winsCount,
    lossesCount,
    breakevenCount,
    winRate,

    totalR,
    knownRCount,
    expectancyR,
    avgWinR,
    avgLossR,
    payoff,

    totalMoney,
    isMultiCurrency,
    currencies,

    totalPnlPercent,

    profitFactorR,
    profitFactorMoney,

    maxDrawdownR,
    maxDrawdownMoney,

    bestTradeR,
    worstTradeR,
    bestTradeMoney,
    worstTradeMoney,

    longestWinStreak,
    longestLossStreak,

    avgHoldingTimeMinutes,
    tradesPerDay,

    hasLowData,
    minSampleSize,
  };
}

/**
 * Calculates Equity Curve points (trade-by-trade cumulative curve)
 */
export function calculateEquityCurve(
  trades: Trade[],
  accounts: Account[],
  options: CalculateStatsOptions = {}
): EquityPoint[] {
  const timeZone = options.timeZone || "UTC";
  const closedTrades = trades
    .filter((t) => t.status === "closed")
    .sort((a, b) => new Date(a.openedAt || a.createdAt).getTime() - new Date(b.openedAt || b.createdAt).getTime());

  if (closedTrades.length === 0) return [];

  const accountMap = new Map<string, Account>();
  accounts.forEach((a) => accountMap.set(a.id, a));

  const usedAccountIds = new Set(closedTrades.map((t) => t.accountId));
  const currenciesSet = new Set<string>();
  usedAccountIds.forEach((accId) => {
    const acc = accountMap.get(accId);
    if (acc?.currency) currenciesSet.add(acc.currency);
  });
  const isMultiCurrency = currenciesSet.size > 1;

  const points: EquityPoint[] = [
    {
      index: 0,
      dateStr: getLocalDateString(closedTrades[0].openedAt || closedTrades[0].createdAt, timeZone),
      isoDate: closedTrades[0].openedAt || closedTrades[0].createdAt,
      rMultipleCum: 0,
      moneyCum: isMultiCurrency ? null : 0,
      percentCum: 0,
    },
  ];

  let rCum = 0;
  let mCum = 0;
  let pCum = 0;

  closedTrades.forEach((trade, idx) => {
    if (typeof trade.rMultiple === "number" && !isNaN(trade.rMultiple)) {
      rCum += trade.rMultiple;
    }

    if (!isMultiCurrency && typeof trade.pnlMoney === "number" && !isNaN(trade.pnlMoney)) {
      mCum += trade.pnlMoney;
    }

    const acc = accountMap.get(trade.accountId);
    if (acc?.startBalance && acc.startBalance > 0 && typeof trade.pnlMoney === "number") {
      const pct = calculatePnlPercent(trade.pnlMoney, acc.startBalance);
      if (pct !== null) pCum += pct;
    }

    const isoDate = trade.closedAt || trade.openedAt || trade.createdAt;
    const dateStr = getLocalDateString(isoDate, timeZone);

    points.push({
      index: idx + 1,
      tradeId: trade.id,
      dateStr,
      isoDate,
      rMultipleCum: Number(rCum.toFixed(2)),
      moneyCum: isMultiCurrency ? null : Number(mCum.toFixed(2)),
      percentCum: Number(pCum.toFixed(2)),
    });
  });

  return points;
}

/**
 * Calculates Calendar month grid and stats.
 */
export function calculateCalendarMonth(
  year: number,
  month: number, // 0-indexed (0 = Jan)
  trades: Trade[],
  accounts: Account[],
  options: CalculateStatsOptions = {}
): CalendarMonthStat {
  const timeZone = options.timeZone || "UTC";
  const accountMap = new Map<string, Account>();
  accounts.forEach((a) => accountMap.set(a.id, a));

  const usedAccountIds = new Set(trades.map((t) => t.accountId));
  const currenciesSet = new Set<string>();
  usedAccountIds.forEach((accId) => {
    const acc = accountMap.get(accId);
    if (acc?.currency) currenciesSet.add(acc.currency);
  });
  const isMultiCurrency = currenciesSet.size > 1;

  // Filter closed trades belonging to this month in user's timezone
  const monthTradesMap = new Map<string, Trade[]>();

  trades
    .filter((t) => t.status === "closed")
    .forEach((trade) => {
      const isoDate = trade.closedAt || trade.openedAt || trade.createdAt;
      const localStr = getLocalDateString(isoDate, timeZone); // YYYY-MM-DD
      const [yStr, mStr] = localStr.split("-");
      if (parseInt(yStr, 10) === year && parseInt(mStr, 10) - 1 === month) {
        const list = monthTradesMap.get(localStr) || [];
        list.push(trade);
        monthTradesMap.set(localStr, list);
      }
    });

  // Build days for month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: CalendarDayStat[] = [];

  let monthTotalR = 0;
  let monthTotalMoney = 0;
  let monthTotalTrades = 0;
  let monthWins = 0;

  let bestDayStr: string | null = null;
  let bestDayR: number | null = null;
  let worstDayStr: string | null = null;
  let worstDayR: number | null = null;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayTrades = monthTradesMap.get(dateStr) || [];

    let dayR = 0;
    let dayMoney = 0;
    let dayPct = 0;
    let dayWins = 0;
    let dayLosses = 0;

    dayTrades.forEach((t) => {
      if (typeof t.rMultiple === "number") dayR += t.rMultiple;
      if (!isMultiCurrency && typeof t.pnlMoney === "number") dayMoney += t.pnlMoney;
      if (t.result === "win") {
        dayWins++;
        monthWins++;
      } else if (t.result === "loss") {
        dayLosses++;
      }

      const acc = accountMap.get(t.accountId);
      if (acc?.startBalance && acc.startBalance > 0 && typeof t.pnlMoney === "number") {
        const pct = calculatePnlPercent(t.pnlMoney, acc.startBalance);
        if (pct !== null) dayPct += pct;
      }
    });

    monthTotalR += dayR;
    monthTotalMoney += dayMoney;
    monthTotalTrades += dayTrades.length;

    let status: "win" | "loss" | "breakeven" | "none" = "none";
    if (dayTrades.length > 0) {
      if (dayR > 0.05) status = "win";
      else if (dayR < -0.05) status = "loss";
      else status = "breakeven";
    }

    if (dayTrades.length > 0) {
      if (bestDayR === null || dayR > bestDayR) {
        bestDayR = dayR;
        bestDayStr = dateStr;
      }
      if (worstDayR === null || dayR < worstDayR) {
        worstDayR = dayR;
        worstDayStr = dateStr;
      }
    }

    days.push({
      dateStr,
      dayNumber: d,
      tradesCount: dayTrades.length,
      totalR: Number(dayR.toFixed(2)),
      totalMoney: isMultiCurrency ? null : Number(dayMoney.toFixed(2)),
      totalPercent: Number(dayPct.toFixed(2)),
      status,
      trades: dayTrades,
    });
  }

  // Calculate week breakdown
  const weeks: CalendarWeekStat[] = [];
  let currentWeekR = 0;
  let currentWeekMoney = 0;
  let currentWeekTrades = 0;
  let currentWeekNum = 1;

  days.forEach((dayStat, idx) => {
    currentWeekR += dayStat.totalR;
    if (dayStat.totalMoney !== null) currentWeekMoney += dayStat.totalMoney;
    currentWeekTrades += dayStat.tradesCount;

    const dt = new Date(year, month, dayStat.dayNumber);
    const dayOfWeek = dt.getDay(); // 0 = Sun, 6 = Sat

    // End of week on Sunday or last day of month
    if (dayOfWeek === 0 || idx === days.length - 1) {
      weeks.push({
        weekNumber: currentWeekNum,
        totalR: Number(currentWeekR.toFixed(2)),
        totalMoney: isMultiCurrency ? null : Number(currentWeekMoney.toFixed(2)),
        tradesCount: currentWeekTrades,
      });
      currentWeekNum++;
      currentWeekR = 0;
      currentWeekMoney = 0;
      currentWeekTrades = 0;
    }
  });

  const winRate = monthTotalTrades > 0 ? monthWins / monthTotalTrades : 0;

  return {
    year,
    month,
    days,
    weeks,
    totalResultR: Number(monthTotalR.toFixed(2)),
    totalResultMoney: isMultiCurrency ? null : Number(monthTotalMoney.toFixed(2)),
    totalTradesCount: monthTotalTrades,
    winRate,
    bestDayStr,
    bestDayR: bestDayR !== null ? Number(bestDayR.toFixed(2)) : null,
    worstDayStr,
    worstDayR: worstDayR !== null ? Number(worstDayR.toFixed(2)) : null,
  };
}

export type ReportSliceType =
  | "strategy"
  | "instrument"
  | "session"
  | "dayOfWeek"
  | "entryHour"
  | "direction"
  | "emotionBefore"
  | "emotionAfter"
  | "mistake"
  | "executionRating"
  | "account";

/**
 * Aggregates closed trades into a Report slice table.
 */
export function calculateReportSlice(
  sliceType: ReportSliceType,
  trades: Trade[],
  accounts: Account[],
  options: CalculateStatsOptions = {}
): ReportSliceRow[] {
  const minSampleSize = options.minSampleSize ?? GAME_CONFIG.JOURNAL_MIN_SAMPLE_SIZE;
  const timeZone = options.timeZone || "UTC";

  const accountMap = new Map<string, Account>();
  accounts.forEach((a) => accountMap.set(a.id, a));

  const closedTrades = trades.filter((t) => t.status === "closed");

  const currenciesSet = new Set<string>();
  closedTrades.forEach((t) => {
    const acc = accountMap.get(t.accountId);
    if (acc?.currency) currenciesSet.add(acc.currency);
  });
  const isMultiCurrency = currenciesSet.size > 1;

  const groupsMap = new Map<string, Trade[]>();

  closedTrades.forEach((trade) => {
    let keys: string[] = [];

    switch (sliceType) {
      case "instrument":
        keys = [trade.instrument || "UNKNOWN"];
        break;
      case "session":
        keys = [trade.session || "other"];
        break;
      case "dayOfWeek": {
        const localDate = new Date(trade.openedAt || trade.createdAt);
        const dayIdx = localDate.getDay(); // 0 = Sun
        keys = [String(dayIdx)];
        break;
      }
      case "entryHour": {
        const dateObj = new Date(trade.openedAt || trade.createdAt);
        const hour = dateObj.getHours();
        keys = [`${String(hour).padStart(2, "0")}:00`];
        break;
      }
      case "direction":
        keys = [trade.direction];
        break;
      case "emotionBefore":
        keys = trade.emotions && trade.emotions.length > 0 ? trade.emotions : ["none"];
        break;
      case "emotionAfter":
        keys = trade.emotions && trade.emotions.length > 0 ? trade.emotions : ["none"];
        break;
      case "mistake":
        keys = trade.mistakes && trade.mistakes.length > 0 ? trade.mistakes : ["none"];
        break;
      case "strategy":
        keys = [trade.strategyId || "no_strategy"];
        break;
      case "executionRating":
        if (trade.executionRating) {
          keys = [`${trade.executionRating}★`];
        } else if (typeof trade.processScore === "number") {
          if (trade.processScore >= GAME_CONFIG.PROCESS_SCORE.THRESHOLDS.GOOD) {
            keys = ["good_ps"];
          } else if (trade.processScore < GAME_CONFIG.PROCESS_SCORE.THRESHOLDS.BAD) {
            keys = ["bad_ps"];
          } else {
            keys = ["medium_ps"];
          }
        } else {
          keys = ["unrated"];
        }
        break;
      case "account": {
        const acc = accountMap.get(trade.accountId);
        keys = [acc?.name || trade.accountId];
        break;
      }
    }

    keys.forEach((k) => {
      const list = groupsMap.get(k) || [];
      list.push(trade);
      groupsMap.set(k, list);
    });
  });

  const rows: ReportSliceRow[] = [];

  groupsMap.forEach((groupTrades, key) => {
    let winsCount = 0;
    let lossesCount = 0;
    let breakevenCount = 0;
    let totalR = 0;
    let knownRCount = 0;
    let grossProfitR = 0;
    let grossLossR = 0;

    let totalMoneyAcc = 0;
    let grossProfitMoney = 0;
    let grossLossMoney = 0;

    groupTrades.forEach((t) => {
      if (t.result === "win") winsCount++;
      else if (t.result === "loss") lossesCount++;
      else breakevenCount++;

      if (typeof t.rMultiple === "number" && !isNaN(t.rMultiple)) {
        totalR += t.rMultiple;
        knownRCount++;
        if (t.rMultiple > 0) grossProfitR += t.rMultiple;
        else if (t.rMultiple < 0) grossLossR += Math.abs(t.rMultiple);
      }

      if (!isMultiCurrency && typeof t.pnlMoney === "number") {
        totalMoneyAcc += t.pnlMoney;
        if (t.pnlMoney > 0) grossProfitMoney += t.pnlMoney;
        else if (t.pnlMoney < 0) grossLossMoney += Math.abs(t.pnlMoney);
      }
    });

    const tradesCount = groupTrades.length;
    const winRate = tradesCount > 0 ? winsCount / tradesCount : 0;
    const avgR = knownRCount > 0 ? totalR / knownRCount : null;
    const profitFactor = grossLossR > 0 ? grossProfitR / grossLossR : null;

    rows.push({
      key,
      tradesCount,
      winsCount,
      lossesCount,
      breakevenCount,
      winRate,
      avgR: avgR !== null ? Number(avgR.toFixed(2)) : null,
      totalR: Number(totalR.toFixed(2)),
      totalMoney: isMultiCurrency ? null : Number(totalMoneyAcc.toFixed(2)),
      profitFactor: profitFactor !== null ? Number(profitFactor.toFixed(2)) : null,
      hasLowData: tradesCount < minSampleSize,
    });
  });

  return rows.sort((a, b) => b.tradesCount - a.tradesCount);
}

/**
 * Calculates Process x Outcome 2x2 Matrix.
 */
export function calculateProcessOutcomeMatrix(trades: Trade[]): ProcessOutcomeMatrix {
  const closedTrades = trades.filter((t) => t.status === "closed");

  let goodWinCount = 0;
  let goodWinRSum = 0;

  let goodLossCount = 0;
  let goodLossRSum = 0;

  let badWinCount = 0;
  let badWinRSum = 0;

  let badLossCount = 0;
  let badLossRSum = 0;

  let mediumExecutionCount = 0;
  let unratedCount = 0;
  let usedProcessScoreFallback = false;

  closedTrades.forEach((t) => {
    let isGood = false;
    let isBad = false;
    let isMedium = false;

    if (t.executionRating) {
      isGood = t.executionRating >= 4;
      isBad = t.executionRating <= 2;
      isMedium = t.executionRating === 3;
    } else if (typeof t.processScore === "number") {
      usedProcessScoreFallback = true;
      isGood = t.processScore >= GAME_CONFIG.PROCESS_SCORE.THRESHOLDS.GOOD;
      isBad = t.processScore < GAME_CONFIG.PROCESS_SCORE.THRESHOLDS.BAD;
      isMedium =
        t.processScore >= GAME_CONFIG.PROCESS_SCORE.THRESHOLDS.BAD &&
        t.processScore < GAME_CONFIG.PROCESS_SCORE.THRESHOLDS.GOOD;
    } else {
      unratedCount++;
      return;
    }

    if (isMedium) {
      mediumExecutionCount++;
      return;
    }

    const isWin = t.result === "win";
    const isLoss = t.result === "loss";
    const r = typeof t.rMultiple === "number" ? t.rMultiple : 0;

    if (isGood) {
      if (isWin) {
        goodWinCount++;
        goodWinRSum += r;
      } else if (isLoss) {
        goodLossCount++;
        goodLossRSum += r;
      }
    } else if (isBad) {
      if (isWin) {
        badWinCount++;
        badWinRSum += r;
      } else if (isLoss) {
        badLossCount++;
        badLossRSum += r;
      }
    }
  });

  return {
    goodWinCount,
    goodWinAvgR: goodWinCount > 0 ? Number((goodWinRSum / goodWinCount).toFixed(2)) : null,

    goodLossCount,
    goodLossAvgR: goodLossCount > 0 ? Number((goodLossRSum / goodLossCount).toFixed(2)) : null,

    badWinCount,
    badWinAvgR: badWinCount > 0 ? Number((badWinRSum / badWinCount).toFixed(2)) : null,

    badLossCount,
    badLossAvgR: badLossCount > 0 ? Number((badLossRSum / badLossCount).toFixed(2)) : null,

    mediumExecutionCount,
    unratedCount,
    usedProcessScoreFallback,
  };
}

/**
 * Generates CSV string for a Report Slice.
 */
export function generateReportCSV(
  rows: ReportSliceRow[],
  headers: {
    group: string;
    trades: string;
    winrate: string;
    avgR: string;
    sumR: string;
    profitFactor: string;
  }
): string {
  const escapeCsv = (str: string) => {
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [
    [headers.group, headers.trades, headers.winrate, headers.avgR, headers.sumR, headers.profitFactor].join(","),
  ];

  rows.forEach((row) => {
    const winRatePct = (row.winRate * 100).toFixed(1);
    const avgRStr = row.avgR !== null ? row.avgR.toFixed(2) : "";
    const sumRStr = row.totalR.toFixed(2);
    const pfStr = row.profitFactor !== null ? row.profitFactor.toFixed(2) : "";

    lines.push([
      escapeCsv(row.key),
      row.tradesCount.toString(),
      `${winRatePct}%`,
      avgRStr,
      sumRStr,
      pfStr,
    ].join(","));
  });

  return lines.join("\n");
}
