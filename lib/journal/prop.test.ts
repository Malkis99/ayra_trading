import { describe, it, expect } from "vitest";
import {
  getPropFirmDayKey,
  calculateDailyLoss,
  calculateTotalDrawdown,
  calculateProfitTarget,
  calculateTradingDays,
  calculateConsistency,
  predictPreTradeUsage,
  getPhaseTrades,
  getLimitStatus,
} from "./prop";
import { Account, Trade, PropRules } from "./types";

describe("lib/journal/prop.ts", () => {
  const mockAccount: Account = {
    id: "acc_prop_1",
    name: "FTMO $100k",
    type: "prop",
    currency: "USD",
    startBalance: 100000,
    platform: "manual",
    createdAt: "2026-01-01T00:00:00Z",
  };

  const basePropRules: PropRules = {
    phaseLabel: "Phase 1",
    initialBalance: 100000,
    startedAt: "2026-05-01T00:00:00Z",
    maxDailyLoss: { type: "percent", value: 5, base: "initialBalance" },
    maxTotalDrawdown: { type: "percent", value: 10, mode: "static" },
    profitTarget: { type: "percent", value: 10 },
    minTradingDays: 4,
    dayReset: { timezone: "UTC", hour: 0 },
  };

  const createMockTrade = (overrides: Partial<Trade>): Trade => ({
    id: "t_mock",
    accountId: "acc_prop_1",
    instrument: "EURUSD",
    direction: "long",
    status: "closed",
    openedAt: "2026-05-01T10:00:00Z",
    closedAt: "2026-05-01T12:00:00Z",
    pnlMoney: 0,
    result: "breakeven",
    emotions: [],
    mistakes: [],
    verification: "unverified",
    source: "manual",
    createdAt: "2026-05-01T12:00:00Z",
    updatedAt: "2026-05-01T12:00:00Z",
    schemaVersion: 4,
    ...overrides,
  });

  describe("getPropFirmDayKey", () => {
    it("handles reset hour 17 in New York timezone", () => {
      const keyBefore = getPropFirmDayKey("2026-05-01T20:59:59Z", {
        timezone: "America/New_York",
        hour: 17,
      });
      expect(keyBefore).toBe("2026-04-30");

      const keyAfter = getPropFirmDayKey("2026-05-01T21:00:00Z", {
        timezone: "America/New_York",
        hour: 17,
      });
      expect(keyAfter).toBe("2026-05-01");
    });

    it("handles midnight reset (hour 0)", () => {
      const key = getPropFirmDayKey("2026-05-01T00:05:00Z", {
        timezone: "UTC",
        hour: 0,
      });
      expect(key).toBe("2026-05-01");
    });
  });

  describe("getPhaseTrades", () => {
    it("filters closed trades on account with closedAt >= startedAt", () => {
      const trades: Trade[] = [
        createMockTrade({
          id: "t1",
          openedAt: "2026-04-20T10:00:00Z",
          closedAt: "2026-04-20T11:00:00Z", // Before startedAt
          pnlMoney: 500,
          result: "win",
        }),
        createMockTrade({
          id: "t2",
          openedAt: "2026-05-01T10:00:00Z",
          closedAt: "2026-05-01T12:00:00Z", // Valid
          pnlMoney: -1000,
          result: "loss",
        }),
        createMockTrade({
          id: "t3",
          accountId: "other_acc",
          openedAt: "2026-05-01T10:00:00Z",
          closedAt: "2026-05-01T12:00:00Z", // Other account
          pnlMoney: 500,
          result: "win",
        }),
      ];

      const res = getPhaseTrades(trades, basePropRules, "acc_prop_1");
      expect(res.length).toBe(1);
      expect(res[0].id).toBe("t2");
    });
  });

  describe("calculateDailyLoss", () => {
    it("calculates daily loss correctly on negative day PnL", () => {
      const trades: Trade[] = [
        createMockTrade({
          id: "t1",
          openedAt: "2026-05-01T12:00:00Z",
          closedAt: "2026-05-01T13:00:00Z",
          pnlMoney: -3500, // 3500 loss on 5000 limit (70% used -> caution)
          result: "loss",
        }),
      ];

      const res = calculateDailyLoss(trades, basePropRules, 100000, "2026-05-01");
      expect(res).toBeDefined();
      expect(res?.limitInMoney).toBe(5000);
      expect(res?.usedMoney).toBe(3500);
      expect(res?.usedPct).toBe(70);
      expect(res?.status).toBe("caution");
    });

    it("handles startOfDayBalance base option", () => {
      const rules: PropRules = {
        ...basePropRules,
        maxDailyLoss: { type: "percent", value: 5, base: "startOfDayBalance" },
      };

      const trades: Trade[] = [
        createMockTrade({
          id: "t1",
          openedAt: "2026-05-01T10:00:00Z",
          closedAt: "2026-05-01T12:00:00Z",
          pnlMoney: 10000, // Balance becomes 110,000 on Day 1
          result: "win",
        }),
        createMockTrade({
          id: "t2",
          openedAt: "2026-05-02T10:00:00Z",
          closedAt: "2026-05-02T12:00:00Z",
          pnlMoney: -2000, // Day 2
          result: "loss",
        }),
      ];

      const res = calculateDailyLoss(trades, rules, 100000, "2026-05-02");
      expect(res?.baseBalance).toBe(110000);
      expect(res?.limitInMoney).toBe(5500); // 5% of 110,000
    });
  });

  describe("calculateTotalDrawdown", () => {
    it("handles static total drawdown", () => {
      const trades: Trade[] = [
        createMockTrade({
          id: "t1",
          openedAt: "2026-05-01T10:00:00Z",
          closedAt: "2026-05-01T12:00:00Z",
          pnlMoney: -9500, // 9.5% drawdown on 10% limit (95% used -> close)
          result: "loss",
        }),
      ];

      const res = calculateTotalDrawdown(trades, basePropRules, 100000);
      expect(res).toBeDefined();
      expect(res?.limitInMoney).toBe(10000);
      expect(res?.usedMoney).toBe(9500);
      expect(res?.usedPct).toBe(95);
      expect(res?.status).toBe("close");
      expect(res?.drawdownLevel).toBe(90000);
    });

    it("handles trailingClosed drawdown with lockAtInitial = true", () => {
      const rules: PropRules = {
        ...basePropRules,
        maxTotalDrawdown: {
          type: "percent",
          value: 10,
          mode: "trailingClosed",
          lockAtInitial: true,
        },
      };

      const trades: Trade[] = [
        createMockTrade({
          id: "t1",
          openedAt: "2026-05-01T10:00:00Z",
          closedAt: "2026-05-01T12:00:00Z",
          pnlMoney: 15000,
          result: "win",
        }),
        createMockTrade({
          id: "t2",
          openedAt: "2026-05-02T10:00:00Z",
          closedAt: "2026-05-02T12:00:00Z",
          pnlMoney: -5000,
          result: "loss",
        }),
      ];

      const res = calculateTotalDrawdown(trades, rules, 100000);
      expect(res?.drawdownLevel).toBe(100000); // Locked at initial
      expect(res?.peakBalance).toBe(115000);
      expect(res?.usedMoney).toBe(5000);
    });
  });

  describe("predictPreTradeUsage", () => {
    it("incorporates positive day PnL into pre-trade prediction", () => {
      const trades: Trade[] = [
        createMockTrade({
          id: "t1",
          openedAt: "2026-05-01T10:00:00Z",
          closedAt: "2026-05-01T12:00:00Z",
          pnlMoney: 2000,
          result: "win",
        }),
      ];

      const acc: Account = { ...mockAccount, propRules: basePropRules };
      const pred = predictPreTradeUsage(acc, trades, 1000, undefined, new Date("2026-05-01T14:00:00Z"));
      expect(pred?.dailyLossPct).toBe(0);
      expect(pred?.dailyLossStatus).toBe("ok");
    });

    it("incorporates negative day PnL into pre-trade prediction", () => {
      const trades: Trade[] = [
        createMockTrade({
          id: "t1",
          openedAt: "2026-05-01T10:00:00Z",
          closedAt: "2026-05-01T12:00:00Z",
          pnlMoney: -3000,
          result: "loss",
        }),
      ];

      const acc: Account = { ...mockAccount, propRules: basePropRules };
      const pred = predictPreTradeUsage(acc, trades, 1500, undefined, new Date("2026-05-01T14:00:00Z"));
      expect(pred?.dailyLossPct).toBe(90);
      expect(pred?.dailyLossStatus).toBe("close");
    });

    it("excludes trade being edited from pre-trade check", () => {
      const trades: Trade[] = [
        createMockTrade({
          id: "t_edit",
          openedAt: "2026-05-01T10:00:00Z",
          closedAt: "2026-05-01T12:00:00Z",
          pnlMoney: -3000,
          result: "loss",
        }),
      ];

      const acc: Account = { ...mockAccount, propRules: basePropRules };
      const pred = predictPreTradeUsage(acc, trades, 1000, "t_edit", new Date("2026-05-01T14:00:00Z"));
      expect(pred?.dailyLossPct).toBe(20);
    });
  });

  describe("getLimitStatus", () => {
    it("maps percentage thresholds correctly", () => {
      expect(getLimitStatus(0)).toBe("ok");
      expect(getLimitStatus(69.9)).toBe("ok");
      expect(getLimitStatus(70)).toBe("caution");
      expect(getLimitStatus(89.9)).toBe("caution");
      expect(getLimitStatus(90)).toBe("close");
      expect(getLimitStatus(99.9)).toBe("close");
      expect(getLimitStatus(100)).toBe("reached");
      expect(getLimitStatus(115)).toBe("reached");
    });
  });
});
