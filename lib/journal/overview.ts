import { Account, Trade, TradingPlan } from "./types";
import { calculateJournalAnalytics, getLocalDateString } from "./stats";

/**
 * Read-only summaries for the Journal page header (KPI strip) and the "Today" panel.
 * They only aggregate existing data and reuse calculateJournalAnalytics; nothing is stored.
 */

export type KpiPeriod = "day" | "week" | "month" | "all";

const dayKey = (iso: string, tz: string) => getLocalDateString(iso, tz);

/** Monday of the week that contains `dateKey` (YYYY-MM-DD). */
function weekStart(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

/** Trades opened in the current day / week (Mon–Sun) / month in the user's timezone. */
export function filterTradesByPeriod(trades: Trade[], period: KpiPeriod, tz: string, now: Date = new Date()): Trade[] {
  if (period === "all") return trades;
  const today = getLocalDateString(now, tz);
  if (period === "day") return trades.filter((t) => dayKey(t.openedAt, tz) === today);
  if (period === "month") return trades.filter((t) => dayKey(t.openedAt, tz).slice(0, 7) === today.slice(0, 7));
  const start = weekStart(today);
  return trades.filter((t) => {
    const k = dayKey(t.openedAt, tz);
    return k >= start && k <= today;
  });
}

/** A trade "has a violation" when a mistake is tagged or a strategy rule was marked as not followed. */
export function hasViolation(t: Trade): boolean {
  return (t.mistakes?.length ?? 0) > 0 || Object.values(t.ruleChecks ?? {}).some((v) => v === "failed");
}

/**
 * Consecutive trading days without violations, counting back from the latest trading day.
 * Days without trades neither extend nor break the streak.
 */
export function cleanDaysStreak(trades: Trade[], tz: string): number {
  const byDay = new Map<string, Trade[]>();
  trades.forEach((t) => {
    const k = dayKey(t.openedAt, tz);
    byDay.set(k, [...(byDay.get(k) ?? []), t]);
  });
  const days = Array.from(byDay.keys()).sort().reverse();
  let streak = 0;
  for (const d of days) {
    if (byDay.get(d)!.some(hasViolation)) break;
    streak++;
  }
  return streak;
}

export interface JournalKpis {
  tradesCount: number;
  totalR: number;
  totalMoney: number | null;
  currency: string | null;
  totalPnlPercent: number | null;
  winRate: number | null; // 0..1, null without closed trades
  avgR: number | null;
  processScore: number | null; // average of trades that have a score
  cleanDays: number;
}

export function calculateKpis(periodTrades: Trade[], allTrades: Trade[], accounts: Account[], tz: string): JournalKpis {
  const a = calculateJournalAnalytics(periodTrades, accounts, { timeZone: tz });
  const scores = periodTrades.map((t) => t.processScore).filter((s): s is number => typeof s === "number");
  return {
    tradesCount: a.totalTrades,
    totalR: a.totalR,
    totalMoney: a.totalMoney,
    currency: a.isMultiCurrency ? null : a.currencies[0] ?? null,
    totalPnlPercent: a.totalPnlPercent,
    winRate: a.totalTrades > 0 ? a.winRate : null,
    avgR: a.expectancyR,
    processScore: scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null,
    cleanDays: cleanDaysStreak(allTrades, tz),
  };
}

export interface TodaySummary {
  dateKey: string;
  trades: Trade[];
  netR: number;
  cleanCount: number;
  /** Daily loss limit in R from today's plan (only when the plan sets it in R). */
  dailyLimitR: number | null;
  /** Loss used today against that limit, in R (0 when the day is not negative). */
  usedR: number;
  lastTrade: Trade | null;
}

export function summarizeToday(trades: Trade[], plan: TradingPlan | null, tz: string, now: Date = new Date()): TodaySummary {
  const today = getLocalDateString(now, tz);
  const todayTrades = trades.filter((t) => dayKey(t.openedAt, tz) === today);
  const netR = todayTrades.reduce((s, t) => s + (typeof t.rMultiple === "number" ? t.rMultiple : 0), 0);
  const limit = plan?.limits?.maxDailyLoss;
  const lastTrade = trades.length ? [...trades].sort((x, y) => y.openedAt.localeCompare(x.openedAt))[0] : null;
  return {
    dateKey: today,
    trades: todayTrades,
    netR,
    cleanCount: todayTrades.filter((t) => !hasViolation(t)).length,
    dailyLimitR: limit && limit.type === "r" ? Math.abs(limit.value) : null,
    usedR: netR < 0 ? -netR : 0,
    lastTrade,
  };
}

export interface TradeDayGroup {
  dateKey: string;
  trades: Trade[];
  netR: number;
  netMoney: number | null;
}

/** Groups already sorted trades by local day, keeping the order. */
export function groupTradesByDay(trades: Trade[], tz: string): TradeDayGroup[] {
  const groups: TradeDayGroup[] = [];
  for (const t of trades) {
    const k = dayKey(t.openedAt, tz);
    let g = groups[groups.length - 1];
    if (!g || g.dateKey !== k) {
      g = { dateKey: k, trades: [], netR: 0, netMoney: null };
      groups.push(g);
    }
    g.trades.push(t);
    if (typeof t.rMultiple === "number") g.netR += t.rMultiple;
    if (typeof t.pnlMoney === "number") g.netMoney = (g.netMoney ?? 0) + t.pnlMoney;
  }
  return groups;
}

export type TradeSortKey = "date" | "result" | "instrument";
export type SortDir = "asc" | "desc";

export function sortTrades(trades: Trade[], key: TradeSortKey, dir: SortDir): Trade[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...trades].sort((a, b) => {
    if (key === "result") return sign * ((a.rMultiple ?? a.pnlMoney ?? 0) - (b.rMultiple ?? b.pnlMoney ?? 0));
    if (key === "instrument") return sign * a.instrument.localeCompare(b.instrument) || b.openedAt.localeCompare(a.openedAt);
    return sign * a.openedAt.localeCompare(b.openedAt);
  });
}
