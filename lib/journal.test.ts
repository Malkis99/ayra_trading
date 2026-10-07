import { describe, it, expect } from "vitest";
import {
  calculateRMultiple,
  determineTradeResult,
  calculatePnlPercent,
  parseNumberInput,
  normalizeInstrument,
  validateTradeInputs,
} from "./journal/calc";
import { recordLoggedTrade, INITIAL_GAME_STATE } from "./game";
import { calculateJournalStats } from "./stats";

describe("T6a Journal Formulas & Anti-farm", () => {
  describe("Calculator pure functions", () => {
    it("parseNumberInput handles spaces, commas and numbers", () => {
      expect(parseNumberInput("1,234.56")).toBe(1234.56);
      expect(parseNumberInput("1 234,56")).toBe(1234.56);
      expect(parseNumberInput(" - 50.5 ")).toBe(-50.5);
      expect(parseNumberInput("")).toBeNull();
      expect(parseNumberInput(null)).toBeNull();
    });

    it("normalizeInstrument cleans instrument string to uppercase", () => {
      expect(normalizeInstrument("  xauusd  ")).toBe("XAUUSD");
      expect(normalizeInstrument("eur / usd")).toBe("EUR/USD");
      expect(normalizeInstrument("btc-usd")).toBe("BTC-USD");
    });

    it("calculateRMultiple calculates R correctly for LONG and SHORT", () => {
      // Primary formula: PnL / Risk
      expect(calculateRMultiple({ direction: "long", pnlMoney: 300, riskAmount: 100 })).toBe(3);
      expect(calculateRMultiple({ direction: "short", pnlMoney: -50, riskAmount: 100 })).toBe(-0.5);

      // Price formula LONG: (exit - entry) / (entry - stopLoss)
      expect(
        calculateRMultiple({
          direction: "long",
          entryPrice: 100,
          exitPrice: 130,
          stopLoss: 90,
        })
      ).toBe(3);

      // Price formula SHORT: (entry - exit) / (stopLoss - entry)
      expect(
        calculateRMultiple({
          direction: "short",
          entryPrice: 100,
          exitPrice: 80,
          stopLoss: 110,
        })
      ).toBe(2);

      // Invalid or incomplete inputs return null
      expect(calculateRMultiple({ direction: "long", entryPrice: 100 })).toBeNull();
    });

    it("determineTradeResult identifies win, loss, and breakeven (|R| < 0.05)", () => {
      expect(determineTradeResult({ rMultiple: 2.5 })).toBe("win");
      expect(determineTradeResult({ rMultiple: -1.0 })).toBe("loss");
      expect(determineTradeResult({ rMultiple: 0.03 })).toBe("breakeven");
      expect(determineTradeResult({ rMultiple: -0.02 })).toBe("breakeven");
      expect(determineTradeResult({ pnlMoney: 0 })).toBe("breakeven");
    });

    it("calculatePnlPercent calculates percent of start balance", () => {
      expect(calculatePnlPercent(500, 10000)).toBe(5);
      expect(calculatePnlPercent(-250, 10000)).toBe(-2.5);
      expect(calculatePnlPercent(100, 0)).toBeNull();
    });

    it("validateTradeInputs checks required fields and valid dates", () => {
      const valid = validateTradeInputs({
        accountId: "acc_1",
        instrument: "EURUSD",
        openedAt: new Date().toISOString(),
      });
      expect(Object.keys(valid).length).toBe(0);

      const invalid = validateTradeInputs({
        accountId: "",
        instrument: "  ",
        openedAt: "invalid-date",
      });
      expect(invalid.accountId).toBe("required");
      expect(invalid.instrument).toBe("required");
      expect(invalid.openedAt).toBe("invalidDate");
    });
  });

  describe("Trade XP & Anti-farm Rules", () => {
    it("Awards XP for valid trade and auto-closes q_tradelog quest", () => {
      const now = new Date();
      const trade = {
        id: "tr_1",
        accountId: "acc_1",
        instrument: "XAUUSD",
        direction: "long",
        openedAt: now.toISOString(),
        verification: "unverified",
      };

      const res = recordLoggedTrade(INITIAL_GAME_STATE, trade, [], now);

      expect(res.xpAwarded).toBe(10); // 10 base * 1.0 multiplier
      expect(res.questClosed).toBe(true); // q_tradelog closed
      expect(res.state.completedQuestsToday["q_tradelog"]).toBe(true);
      expect(res.newlyUnlocked).toContain("firstTrade");
    });

    it("Rejects XP for duplicate trades within 1 minute", () => {
      const now = new Date();
      const trade1 = {
        id: "tr_1",
        accountId: "acc_1",
        instrument: "XAUUSD",
        direction: "long",
        openedAt: now.toISOString(),
        verification: "unverified",
      };

      const trade2 = {
        id: "tr_2",
        accountId: "acc_1",
        instrument: "XAUUSD",
        direction: "long",
        openedAt: new Date(now.getTime() + 10000).toISOString(), // 10 seconds later
        verification: "unverified",
      };

      const res1 = recordLoggedTrade(INITIAL_GAME_STATE, trade1, [], now);
      const res2 = recordLoggedTrade(res1.state, trade2, [trade1], now);

      expect(res1.xpAwarded).toBe(10);
      expect(res2.xpAwarded).toBe(0); // Duplicate -> 0 XP
    });

    it("Enforces MAX_DAILY_TRADE_XP_COUNT = 3", () => {
      const now = new Date();
      let state = INITIAL_GAME_STATE;
      const trades = [];

      for (let i = 1; i <= 4; i++) {
        const trade = {
          id: `tr_${i}`,
          accountId: "acc_1",
          instrument: `NAS10${i}`,
          direction: "long",
          openedAt: new Date(now.getTime() - i * 3600000).toISOString(),
          verification: "unverified",
        };
        const res = recordLoggedTrade(state, trade, trades, now);
        state = res.state;
        trades.push(trade);

        if (i <= 3) {
          expect(res.xpAwarded).toBe(10);
        } else {
          expect(res.xpAwarded).toBe(0); // Cap reached
        }
      }
    });
  });

  describe("JournalStats calculation", () => {
    it("Computes real totalTrades, periodTrades, and dominant categories", () => {
      const now = new Date();
      const mockTrades = [
        {
          id: "1",
          openedAt: now.toISOString(),
          rMultiple: 2,
          notes: "Good trade",
          mistakes: ["fomo"],
          emotions: ["anxious"],
        },
        {
          id: "2",
          openedAt: now.toISOString(),
          rMultiple: -1,
          notes: "",
          mistakes: ["fomo", "no_stop"],
          emotions: ["anxious", "greedy"],
        },
      ];

      const stats = calculateJournalStats(mockTrades, 30, now);
      expect(stats.totalTrades).toBe(2);
      expect(stats.periodTrades).toBe(2);
      expect(stats.periodRResult).toBe(1);
      expect(stats.notesCount).toBe(1);
      expect(stats.frequentErrors).toContain("fomo");
      expect(stats.dominantEmotions).toContain("anxious");
    });
  });
});
