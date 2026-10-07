import { describe, it, expect } from "vitest";
import {
  calculateJournalAnalytics,
  calculateEquityCurve,
  calculateCalendarMonth,
  calculateReportSlice,
  calculateProcessOutcomeMatrix,
  generateReportCSV,
  getLocalDateString,
} from "./stats";
import { Trade, Account } from "./types";

const mockAccountUSD: Account = {
  id: "acc_usd",
  name: "Main USD Account",
  type: "personal",
  currency: "USD",
  startBalance: 10000,
  platform: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const mockAccountEUR: Account = {
  id: "acc_eur",
  name: "Euro Account",
  type: "personal",
  currency: "EUR",
  startBalance: 5000,
  platform: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("Journal Analytics Engine (lib/journal/stats.ts)", () => {
  it("handles empty trades array correctly", () => {
    const res = calculateJournalAnalytics([], [mockAccountUSD]);
    expect(res.totalTrades).toBe(0);
    expect(res.winRate).toBe(0);
    expect(res.totalR).toBe(0);
    expect(res.expectancyR).toBeNull();
    expect(res.payoff).toBeNull();
    expect(res.profitFactorR).toBeNull();
    expect(res.maxDrawdownR).toBe(0);
    expect(res.hasLowData).toBe(true);
  });

  it("calculates metrics for manual trades (wins, losses, breakeven, streaks, drawdown)", () => {
    const trades: Trade[] = [
      {
        id: "1",
        accountId: "acc_usd",
        instrument: "EURUSD",
        direction: "long",
        status: "closed",
        openedAt: "2026-03-01T10:00:00.000Z",
        closedAt: "2026-03-01T12:00:00.000Z",
        rMultiple: 2.0,
        pnlMoney: 200,
        result: "win",
        emotions: ["calm"],
        mistakes: [],
        verification: "unverified",
        source: "manual",
        createdAt: "2026-03-01T10:00:00.000Z",
        updatedAt: "2026-03-01T12:00:00.000Z",
        schemaVersion: 1,
      },
      {
        id: "2",
        accountId: "acc_usd",
        instrument: "EURUSD",
        direction: "long",
        status: "closed",
        openedAt: "2026-03-02T10:00:00.000Z",
        closedAt: "2026-03-02T11:00:00.000Z",
        rMultiple: 3.0,
        pnlMoney: 300,
        result: "win",
        emotions: ["confident"],
        mistakes: [],
        verification: "unverified",
        source: "manual",
        createdAt: "2026-03-02T10:00:00.000Z",
        updatedAt: "2026-03-02T11:00:00.000Z",
        schemaVersion: 1,
      },
      {
        id: "3",
        accountId: "acc_usd",
        instrument: "BTCUSD",
        direction: "short",
        status: "closed",
        openedAt: "2026-03-03T10:00:00.000Z",
        closedAt: "2026-03-03T14:00:00.000Z",
        rMultiple: -1.0,
        pnlMoney: -100,
        result: "loss",
        emotions: ["anxious"],
        mistakes: ["early_entry"],
        verification: "unverified",
        source: "manual",
        createdAt: "2026-03-03T10:00:00.000Z",
        updatedAt: "2026-03-03T14:00:00.000Z",
        schemaVersion: 1,
      },
      {
        id: "4",
        accountId: "acc_usd",
        instrument: "BTCUSD",
        direction: "short",
        status: "closed",
        openedAt: "2026-03-04T10:00:00.000Z",
        closedAt: "2026-03-04T10:30:00.000Z",
        rMultiple: 0.02,
        pnlMoney: 2,
        result: "breakeven",
        emotions: [],
        mistakes: [],
        verification: "unverified",
        source: "manual",
        createdAt: "2026-03-04T10:00:00.000Z",
        updatedAt: "2026-03-04T10:30:00.000Z",
        schemaVersion: 1,
      },
    ];

    const res = calculateJournalAnalytics(trades, [mockAccountUSD]);
    expect(res.totalTrades).toBe(4);
    expect(res.winsCount).toBe(2);
    expect(res.lossesCount).toBe(1);
    expect(res.breakevenCount).toBe(1);

    // Winrate = 2 / 4 = 0.5 (50%)
    expect(res.winRate).toBe(0.5);

    // R metrics: 2 + 3 - 1 + 0.02 = 4.02
    expect(res.totalR).toBeCloseTo(4.02);
    expect(res.expectancyR).toBeCloseTo(1.005);
    expect(res.avgWinR).toBe(2.5); // (2+3)/2
    expect(res.avgLossR).toBe(-1);
    expect(res.payoff).toBe(2.5); // 2.5 / |-1|

    // Profit factor R = (2 + 3) / 1 = 5.0
    expect(res.profitFactorR).toBeCloseTo(5.0);

    // Money: 200 + 300 - 100 + 2 = 402
    expect(res.totalMoney).toBe(402);

    // Drawdown R: Peak was 5 (after trade 1 and 2: 2 + 3 = 5).
    // Trade 3 drop to 4 -> DD = 1.
    expect(res.maxDrawdownR).toBe(1);

    // Streaks: wins 2, losses 1
    expect(res.longestWinStreak).toBe(2);
    expect(res.longestLossStreak).toBe(1);
  });

  it("handles multi-currency accounts correctly by locking money mode", () => {
    const trades: Trade[] = [
      {
        id: "1",
        accountId: "acc_usd",
        instrument: "EURUSD",
        direction: "long",
        status: "closed",
        openedAt: "2026-03-01T10:00:00.000Z",
        rMultiple: 2.0,
        pnlMoney: 200,
        result: "win",
        emotions: [],
        mistakes: [],
        verification: "unverified",
        source: "manual",
        createdAt: "2026-03-01T10:00:00.000Z",
        updatedAt: "2026-03-01T10:00:00.000Z",
        schemaVersion: 1,
      },
      {
        id: "2",
        accountId: "acc_eur",
        instrument: "GER40",
        direction: "short",
        status: "closed",
        openedAt: "2026-03-02T10:00:00.000Z",
        rMultiple: 1.5,
        pnlMoney: 150,
        result: "win",
        emotions: [],
        mistakes: [],
        verification: "unverified",
        source: "manual",
        createdAt: "2026-03-02T10:00:00.000Z",
        updatedAt: "2026-03-02T10:00:00.000Z",
        schemaVersion: 1,
      },
    ];

    const res = calculateJournalAnalytics(trades, [mockAccountUSD, mockAccountEUR]);
    expect(res.isMultiCurrency).toBe(true);
    expect(res.totalMoney).toBeNull();
    expect(res.maxDrawdownMoney).toBeNull();
    expect(res.totalR).toBe(3.5); // R is still available across currencies
  });

  it("handles timezone day boundaries and month transitions", () => {
    // 2026-03-31T22:30:00Z -> In UTC+4 (e.g. Dubai) it is 2026-04-01 02:30:00 (April 1st)
    const isoDate = "2026-03-31T22:30:00Z";

    const utcDate = getLocalDateString(isoDate, "UTC");
    expect(utcDate).toBe("2026-03-31");

    const dubaiDate = getLocalDateString(isoDate, "Asia/Dubai"); // UTC+4
    expect(dubaiDate).toBe("2026-04-01");

    const nyDate = getLocalDateString(isoDate, "America/New_York"); // UTC-4/5
    expect(nyDate).toBe("2026-03-31");
  });

  it("calculates Calendar month grid correctly", () => {
    const trades: Trade[] = [
      {
        id: "t1",
        accountId: "acc_usd",
        instrument: "XAUUSD",
        direction: "long",
        status: "closed",
        openedAt: "2026-03-15T10:00:00.000Z",
        closedAt: "2026-03-15T12:00:00.000Z",
        rMultiple: 2.5,
        pnlMoney: 250,
        result: "win",
        emotions: [],
        mistakes: [],
        verification: "unverified",
        source: "manual",
        createdAt: "2026-03-15T10:00:00.000Z",
        updatedAt: "2026-03-15T12:00:00.000Z",
        schemaVersion: 1,
      },
    ];

    const monthStat = calculateCalendarMonth(2026, 2, trades, [mockAccountUSD], { timeZone: "UTC" }); // Month 2 = March
    expect(monthStat.year).toBe(2026);
    expect(monthStat.month).toBe(2);
    expect(monthStat.days.length).toBe(31);
    expect(monthStat.totalTradesCount).toBe(1);
    expect(monthStat.totalResultR).toBe(2.5);

    const day15 = monthStat.days.find((d) => d.dayNumber === 15);
    expect(day15?.tradesCount).toBe(1);
    expect(day15?.totalR).toBe(2.5);
    expect(day15?.status).toBe("win");
  });

  it("calculates Report slices and Process x Outcome matrix", () => {
    const trades: Trade[] = [
      {
        id: "t1",
        accountId: "acc_usd",
        instrument: "EURUSD",
        direction: "long",
        status: "closed",
        openedAt: "2026-03-01T10:00:00.000Z",
        rMultiple: 2.0,
        result: "win",
        executionRating: 5,
        emotions: ["calm"],
        mistakes: [],
        verification: "unverified",
        source: "manual",
        createdAt: "2026-03-01T10:00:00.000Z",
        updatedAt: "2026-03-01T10:00:00.000Z",
        schemaVersion: 1,
      },
      {
        id: "t2",
        accountId: "acc_usd",
        instrument: "EURUSD",
        direction: "short",
        status: "closed",
        openedAt: "2026-03-02T10:00:00.000Z",
        rMultiple: -1.0,
        result: "loss",
        executionRating: 1,
        emotions: ["anxious"],
        mistakes: ["fomo"],
        verification: "unverified",
        source: "manual",
        createdAt: "2026-03-02T10:00:00.000Z",
        updatedAt: "2026-03-02T10:00:00.000Z",
        schemaVersion: 1,
      },
    ];

    const slice = calculateReportSlice("instrument", trades, [mockAccountUSD]);
    expect(slice.length).toBe(1);
    expect(slice[0].key).toBe("EURUSD");
    expect(slice[0].tradesCount).toBe(2);
    expect(slice[0].totalR).toBe(1.0);

    const matrix = calculateProcessOutcomeMatrix(trades);
    expect(matrix.goodWinCount).toBe(1); // rating 5 win
    expect(matrix.goodWinAvgR).toBe(2.0);
    expect(matrix.badLossCount).toBe(1); // rating 1 loss
    expect(matrix.badLossAvgR).toBe(-1.0);
  });

  it("generates clean CSV export string", () => {
    const sliceRows = [
      {
        key: "XAUUSD",
        tradesCount: 10,
        winsCount: 7,
        lossesCount: 3,
        breakevenCount: 0,
        winRate: 0.7,
        avgR: 1.5,
        totalR: 15.0,
        totalMoney: 1500,
        profitFactor: 2.5,
        hasLowData: true,
      },
    ];

    const csv = generateReportCSV(sliceRows, {
      group: "Instrument",
      trades: "Trades",
      winrate: "Win Rate",
      avgR: "Avg R",
      sumR: "Sum R",
      profitFactor: "Profit Factor",
    });

    expect(csv).toContain("Instrument,Trades,Win Rate,Avg R,Sum R,Profit Factor");
    expect(csv).toContain("XAUUSD,10,70.0%,1.50,15.00,2.50");
  });

  it("recalculates analytics for 5,000 trades in < 100ms (performance benchmark)", () => {
    const mock5000Trades: Trade[] = Array.from({ length: 5000 }).map((_, i) => ({
      id: `trade_${i}`,
      accountId: "acc_usd",
      instrument: i % 2 === 0 ? "EURUSD" : "BTCUSD",
      direction: i % 3 === 0 ? "short" : "long",
      status: "closed",
      openedAt: new Date(1770000000000 + i * 60000).toISOString(),
      closedAt: new Date(1770000000000 + i * 60000 + 300000).toISOString(),
      rMultiple: (i % 5) - 2, // -2, -1, 0, 1, 2
      pnlMoney: ((i % 5) - 2) * 100,
      result: (i % 5) - 2 > 0 ? "win" : (i % 5) - 2 < 0 ? "loss" : "breakeven",
      emotions: ["calm"],
      mistakes: [],
      executionRating: (i % 5) + 1,
      verification: "unverified",
      source: "manual",
      createdAt: new Date(1770000000000 + i * 60000).toISOString(),
      updatedAt: new Date(1770000000000 + i * 60000).toISOString(),
      schemaVersion: 1,
    }));

    const startTime = performance.now();
    const res = calculateJournalAnalytics(mock5000Trades, [mockAccountUSD]);
    const duration = performance.now() - startTime;

    expect(res.totalTrades).toBe(5000);
    expect(duration).toBeLessThan(100); // Must be faster than ~100ms
  });
});
