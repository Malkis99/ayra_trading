import { describe, it, expect } from "vitest";
import type { Account, Trade, TradingPlan } from "./types";
import {
  calculateKpis,
  cleanDaysStreak,
  filterTradesByPeriod,
  groupTradesByDay,
  hasViolation,
  sortTrades,
  summarizeToday,
} from "./overview";

const acc: Account = { id: "a1", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: "2026-01-01T00:00:00Z" };

let n = 0;
function trade(openedAt: string, r: number, extra: Partial<Trade> = {}): Trade {
  n++;
  return {
    id: `t${n}`,
    accountId: "a1",
    instrument: "XAUUSD",
    direction: "long",
    status: "closed",
    openedAt,
    closedAt: openedAt,
    rMultiple: r,
    pnlMoney: r * 100,
    result: r > 0 ? "win" : r < 0 ? "loss" : "breakeven",
    emotions: [],
    mistakes: [],
    verification: "unverified",
    source: "manual",
    createdAt: openedAt,
    updatedAt: openedAt,
    schemaVersion: 3,
    ...extra,
  };
}

const NOW = new Date("2026-03-11T15:00:00Z"); // Wednesday
const TZ = "UTC";

describe("journal overview", () => {
  const trades = [
    trade("2026-03-11T09:00:00Z", 2, { processScore: 80 }),
    trade("2026-03-11T11:00:00Z", -1, { processScore: 60 }),
    trade("2026-03-09T10:00:00Z", 1.5), // Monday, same week
    trade("2026-03-02T10:00:00Z", -1, { mistakes: ["fomo"] }), // previous week, same month
    trade("2026-02-20T10:00:00Z", 3),
  ];

  it("filters by day, week (Mon–Sun), month and all", () => {
    expect(filterTradesByPeriod(trades, "day", TZ, NOW)).toHaveLength(2);
    expect(filterTradesByPeriod(trades, "week", TZ, NOW)).toHaveLength(3);
    expect(filterTradesByPeriod(trades, "month", TZ, NOW)).toHaveLength(4);
    expect(filterTradesByPeriod(trades, "all", TZ, NOW)).toHaveLength(5);
  });

  it("violations: mistakes or a failed rule check", () => {
    expect(hasViolation(trade("2026-03-01T00:00:00Z", 1))).toBe(false);
    expect(hasViolation(trade("2026-03-01T00:00:00Z", 1, { ruleChecks: { r1: "failed" } }))).toBe(true);
    expect(hasViolation(trade("2026-03-01T00:00:00Z", 1, { ruleChecks: { r1: "na" } }))).toBe(false);
  });

  it("clean days streak counts back over trading days until the first violation", () => {
    expect(cleanDaysStreak(trades, TZ)).toBe(2); // 11th and 9th clean, 2nd has a mistake
    expect(cleanDaysStreak([], TZ)).toBe(0);
  });

  it("KPIs reuse journal analytics and average process score", () => {
    const k = calculateKpis(filterTradesByPeriod(trades, "day", TZ, NOW), trades, [acc], TZ);
    expect(k.tradesCount).toBe(2);
    expect(k.totalR).toBe(1);
    expect(k.winRate).toBe(0.5);
    expect(k.avgR).toBe(0.5);
    expect(k.totalMoney).toBe(100);
    expect(k.currency).toBe("USD");
    expect(k.processScore).toBe(70);
    expect(k.cleanDays).toBe(2);
    expect(calculateKpis([], trades, [acc], TZ).winRate).toBeNull();
  });

  it("today summary: net R, discipline and the daily R limit from the plan", () => {
    const plan = { limits: { maxDailyLoss: { type: "r", value: 3 } } } as unknown as TradingPlan;
    const losing = [...trades, trade("2026-03-11T13:00:00Z", -2.5, { mistakes: ["late_entry"] })];
    const s = summarizeToday(losing, plan, TZ, NOW);
    expect(s.trades).toHaveLength(3);
    expect(s.netR).toBe(-1.5);
    expect(s.usedR).toBe(1.5);
    expect(s.dailyLimitR).toBe(3);
    expect(s.cleanCount).toBe(2);
    expect(s.lastTrade?.openedAt).toBe("2026-03-11T13:00:00Z");
    expect(summarizeToday(trades, null, TZ, NOW).dailyLimitR).toBeNull();
  });

  it("groups sorted trades by day with day totals; sorts by date, result, instrument", () => {
    const sorted = sortTrades(trades, "date", "desc");
    const groups = groupTradesByDay(sorted, TZ);
    expect(groups.map((g) => g.dateKey)).toEqual(["2026-03-11", "2026-03-09", "2026-03-02", "2026-02-20"]);
    expect(groups[0].netR).toBe(1);
    expect(groups[0].netMoney).toBe(100);
    expect(sortTrades(trades, "result", "desc")[0].rMultiple).toBe(3);
    expect(sortTrades(trades, "result", "asc")[0].rMultiple).toBe(-1);
  });
});
