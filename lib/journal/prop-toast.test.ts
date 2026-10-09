import { describe, it, expect, beforeEach } from "vitest";
import { evaluatePropToastAlert } from "./prop-toast";
import { Account, Trade, PropToastLog } from "./types";
import { calculatePropMetrics } from "./prop";
import { INITIAL_GAME_STATE, recordPropDisciplineDay, recordPropRulesSaved } from "../game";

describe("Prop Toast & XP Logic", () => {
  const mockAccount: Account = {
    id: "acc_prop_1",
    name: "FTMO $100k",
    type: "prop",
    currency: "USD",
    startBalance: 100000,
    platform: "manual",
    createdAt: "2026-01-01T00:00:00Z",
    propRules: {
      phaseLabel: "Phase 1",
      initialBalance: 100000,
      startedAt: "2026-05-01T00:00:00Z",
      maxDailyLoss: { type: "percent", value: 5, base: "initialBalance" }, // 5000 limit
      maxTotalDrawdown: { type: "percent", value: 10, mode: "static" }, // 10000 limit
      dayReset: { timezone: "UTC", hour: 0 },
    },
  };

  const testDate = new Date("2026-05-01T12:00:00Z");

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

  beforeEach(() => {
    if (typeof window !== "undefined") {
      localStorage.clear();
    }
  });

  describe("evaluatePropToastAlert", () => {
    it("returns null if status remains 'ok'", () => {
      const prevMetrics = calculatePropMetrics(mockAccount, [], testDate);
      const currMetrics = calculatePropMetrics(mockAccount, [], testDate);

      const res = evaluatePropToastAlert(mockAccount, prevMetrics, currMetrics, testDate, {});
      expect(res.alert).toBeNull();
    });

    it("triggers alert when status jumps from 'ok' to 'close' (highest reached level)", () => {
      const prevMetrics = calculatePropMetrics(mockAccount, [], testDate);

      const lossTrade = createMockTrade({
        id: "t1",
        pnlMoney: -4600, // 4600 loss = 92% of 5000 daily limit -> "close"
        result: "loss",
      });

      const currMetrics = calculatePropMetrics(mockAccount, [lossTrade], testDate);

      const res = evaluatePropToastAlert(mockAccount, prevMetrics, currMetrics, testDate, {});
      expect(res.alert).toBeDefined();
      expect(res.alert?.level).toBe("close");
      expect(res.alert?.limitType).toBe("dailyLoss");
      expect(res.updatedLog["acc_prop_1"]?.shown).toContain("dailyLoss:close");
    });

    it("suppresses duplicate alert token on the same prop firm day", () => {
      const prevMetrics = calculatePropMetrics(mockAccount, [], testDate);

      const lossTrade = createMockTrade({
        id: "t1",
        pnlMoney: -3600, // 72% -> "caution"
        result: "loss",
      });

      const currMetrics = calculatePropMetrics(mockAccount, [lossTrade], testDate);
      const initialLog: PropToastLog = {
        acc_prop_1: {
          dayKey: "2026-05-01",
          shown: ["dailyLoss:caution"], // Already shown today
        },
      };

      const res = evaluatePropToastAlert(mockAccount, prevMetrics, currMetrics, testDate, initialLog);
      expect(res.alert).toBeNull(); // Suppressed
    });

    it("allows alert on a new prop firm day key", () => {
      const nextDate = new Date("2026-05-02T12:00:00Z");
      const prevMetrics = calculatePropMetrics(mockAccount, [], nextDate);

      const lossTrade = createMockTrade({
        id: "t2",
        openedAt: "2026-05-02T10:00:00Z",
        closedAt: "2026-05-02T12:00:00Z",
        pnlMoney: -3600, // 72% -> "caution"
        result: "loss",
      });

      const currMetrics = calculatePropMetrics(mockAccount, [lossTrade], nextDate);
      const previousDayLog: PropToastLog = {
        acc_prop_1: {
          dayKey: "2026-05-01",
          shown: ["dailyLoss:caution"], // Shown YESTERDAY
        },
      };

      const res = evaluatePropToastAlert(mockAccount, prevMetrics, currMetrics, nextDate, previousDayLog);
      expect(res.alert).toBeDefined();
      expect(res.alert?.level).toBe("caution");
    });
  });

  describe("Prop Discipline XP & Cap", () => {
    it("awards 10 XP for completing a prop firm day within limits", () => {
      const res = recordPropDisciplineDay(
        INITIAL_GAME_STATE,
        "acc_prop_1",
        "2026-05-01",
        true,
        true,
        true,
        testDate
      );

      expect(res.xpAwarded).toBe(10);
      expect(res.state.xp).toBe(10);
    });

    it("respects JOURNAL_DISCIPLINE_DAILY_XP_CAP (25 XP) across discipline sources", () => {
      let state = {
        ...INITIAL_GAME_STATE,
        dailyStats: {
          "2026-05-01": {
            date: "2026-05-01",
            totalQuestsCompleted: 2,
            questsCompleted: {
              discipline_plan: 15,
              discipline_no_trade: 5,
            },
            xpGained: 20,
            coinsGained: 0,
            questsSkipped: 0,
            questsReplaced: 0,
            isRestDay: false,
            restDays: 0,
            shieldUsed: false,
            shieldsUsed: 0,
            rewardsClaimed: 0,
          },
        },
      };

      const res = recordPropDisciplineDay(
        state,
        "acc_prop_1",
        "2026-05-01",
        true,
        true,
        true,
        testDate
      );

      expect(res.xpAwarded).toBe(5); // Capped at 5
    });

    it("unlocks firstPropRules achievement on saving rules", () => {
      const res = recordPropRulesSaved(INITIAL_GAME_STATE);
      expect(res.newlyUnlocked).toContain("firstPropRules");
      expect(res.state.achievements["firstPropRules"]).toBe(true);
    });
  });
});
