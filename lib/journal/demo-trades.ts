import { Account, Trade } from "./types";

export const DEMO_ACCOUNT: Account = {
  id: "acc_demo_main",
  name: "Проп-счёт 100k USD",
  type: "prop",
  currency: "USD",
  startBalance: 100000,
  platform: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
};

/**
 * Returns a deterministic set of 60 trades spanning 90 days leading up to referenceDate.
 */
export function getDemoTrades(referenceDate: Date = new Date()): Trade[] {
  const refMs = referenceDate.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  // Static templates for 60 trades (deterministic seed values)
  const templates = [
    { inst: "XAUUSD", dir: "long", r: 2.5, pnl: 1250, res: "win", sess: "london", em: ["calm", "confident"], mis: [], rat: 5 },
    { inst: "EURUSD", dir: "short", r: -1.0, pnl: -500, res: "loss", sess: "newyork", em: ["anxious"], mis: ["fomo"], rat: 2 },
    { inst: "NAS100", dir: "long", r: 3.2, pnl: 1600, res: "win", sess: "newyork", em: ["focused"], mis: [], rat: 5 },
    { inst: "BTCUSD", dir: "long", r: -1.0, pnl: -500, res: "loss", sess: "asia", em: ["impatient"], mis: ["early_entry"], rat: 1 },
    { inst: "XAUUSD", dir: "short", r: 0.02, pnl: 10, res: "breakeven", sess: "london", em: ["calm"], mis: [], rat: 4 },
    { inst: "US30", dir: "long", r: 1.8, pnl: 900, res: "win", sess: "overlap", em: ["confident"], mis: [], rat: 4 },
    { inst: "GBPUSD", dir: "short", r: 2.1, pnl: 1050, res: "win", sess: "london", em: ["calm"], mis: [], rat: 5 },
    { inst: "EURUSD", dir: "long", r: -1.0, pnl: -500, res: "loss", sess: "newyork", em: ["frustrated"], mis: ["revenge_trade"], rat: 1 },
    { inst: "NAS100", dir: "short", r: -1.0, pnl: -500, res: "loss", sess: "newyork", em: ["greedy"], mis: ["oversized"], rat: 2 },
    { inst: "XAUUSD", dir: "long", r: 2.8, pnl: 1400, res: "win", sess: "london", em: ["focused"], mis: [], rat: 5 },

    { inst: "BTCUSD", dir: "short", r: 1.5, pnl: 750, res: "win", sess: "asia", em: ["calm"], mis: [], rat: 4 },
    { inst: "ETHUSD", dir: "long", r: -1.0, pnl: -500, res: "loss", sess: "asia", em: ["fearful"], mis: ["no_stop"], rat: 1 },
    { inst: "EURUSD", dir: "short", r: 2.0, pnl: 1000, res: "win", sess: "london", em: ["confident"], mis: [], rat: 5 },
    { inst: "GER40", dir: "long", r: 0.01, pnl: 5, res: "breakeven", sess: "london", em: ["calm"], mis: [], rat: 4 },
    { inst: "XAUUSD", dir: "short", r: -1.0, pnl: -500, res: "loss", sess: "newyork", em: ["anxious"], mis: ["news_ignored"], rat: 2 },
    { inst: "NAS100", dir: "long", r: 4.0, pnl: 2000, res: "win", sess: "newyork", em: ["focused"], mis: [], rat: 5 },
    { inst: "US30", dir: "short", r: 1.2, pnl: 600, res: "win", sess: "newyork", em: ["calm"], mis: [], rat: 4 },
    { inst: "GBPUSD", dir: "long", r: -1.0, pnl: -500, res: "loss", sess: "london", em: ["impatient"], mis: ["late_entry"], rat: 2 },
    { inst: "XAUUSD", dir: "long", r: 2.2, pnl: 1100, res: "win", sess: "london", em: ["confident"], mis: [], rat: 5 },
    { inst: "BTCUSD", dir: "short", r: 1.9, pnl: 950, res: "win", sess: "overlap", em: ["focused"], mis: [], rat: 4 },

    { inst: "EURUSD", dir: "long", r: -1.0, pnl: -500, res: "loss", sess: "newyork", em: ["frustrated"], mis: ["overtrading"], rat: 2 },
    { inst: "NAS100", dir: "short", r: -1.0, pnl: -500, res: "loss", sess: "newyork", em: ["revenge"], mis: ["revenge_trade"], rat: 1 },
    { inst: "XAUUSD", dir: "short", r: 3.5, pnl: 1750, res: "win", sess: "london", em: ["calm"], mis: [], rat: 5 },
    { inst: "US30", dir: "long", r: 2.0, pnl: 1000, res: "win", sess: "overlap", em: ["confident"], mis: [], rat: 4 },
    { inst: "GBPUSD", dir: "short", r: -0.01, pnl: -5, res: "breakeven", sess: "london", em: ["calm"], mis: [], rat: 4 },
    { inst: "EURUSD", dir: "long", r: 1.6, pnl: 800, res: "win", sess: "newyork", em: ["focused"], mis: [], rat: 4 },
    { inst: "BTCUSD", dir: "long", r: -1.0, pnl: -500, res: "loss", sess: "asia", em: ["anxious"], mis: ["early_entry"], rat: 2 },
    { inst: "XAUUSD", dir: "long", r: 2.4, pnl: 1200, res: "win", sess: "london", em: ["confident"], mis: [], rat: 5 },
    { inst: "NAS100", dir: "long", r: -1.0, pnl: -500, res: "loss", sess: "newyork", em: ["fomo"], mis: ["fomo"], rat: 2 },
    { inst: "GER40", dir: "short", r: 2.1, pnl: 1050, res: "win", sess: "london", em: ["calm"], mis: [], rat: 4 },

    { inst: "US30", dir: "short", r: 1.7, pnl: 850, res: "win", sess: "newyork", em: ["focused"], mis: [], rat: 4 },
    { inst: "XAUUSD", dir: "short", r: -1.0, pnl: -500, res: "loss", sess: "london", em: ["impatient"], mis: ["exited_early"], rat: 2 },
    { inst: "EURUSD", dir: "long", r: 2.0, pnl: 1000, res: "win", sess: "london", em: ["confident"], mis: [], rat: 5 },
    { inst: "GBPUSD", dir: "long", r: -1.0, pnl: -500, res: "loss", sess: "london", em: ["anxious"], mis: ["moved_stop"], rat: 1 },
    { inst: "BTCUSD", dir: "short", r: 2.9, pnl: 1450, res: "win", sess: "asia", em: ["calm"], mis: [], rat: 5 },
    { inst: "NAS100", dir: "short", r: 0.03, pnl: 15, res: "breakeven", sess: "newyork", em: ["calm"], mis: [], rat: 4 },
    { inst: "XAUUSD", dir: "long", r: 3.1, pnl: 1550, res: "win", sess: "london", em: ["focused"], mis: [], rat: 5 },
    { inst: "US30", dir: "long", r: -1.0, pnl: -500, res: "loss", sess: "overlap", em: ["frustrated"], mis: ["ignored_plan"], rat: 1 },
    { inst: "EURUSD", dir: "short", r: 1.8, pnl: 900, res: "win", sess: "newyork", em: ["calm"], mis: [], rat: 4 },
    { inst: "GBPUSD", dir: "long", r: 2.3, pnl: 1150, res: "win", sess: "london", em: ["confident"], mis: [], rat: 5 },

    { inst: "XAUUSD", dir: "short", r: -1.0, pnl: -500, res: "loss", sess: "london", em: ["fearful"], mis: ["held_too_long"], rat: 2 },
    { inst: "NAS100", dir: "long", r: 2.7, pnl: 1350, res: "win", sess: "newyork", em: ["focused"], mis: [], rat: 5 },
    { inst: "BTCUSD", dir: "short", r: -1.0, pnl: -500, res: "loss", sess: "asia", em: ["impatient"], mis: ["oversized"], rat: 1 },
    { inst: "GER40", dir: "long", r: 1.5, pnl: 750, res: "win", sess: "london", em: ["calm"], mis: [], rat: 4 },
    { inst: "XAUUSD", dir: "long", r: 2.0, pnl: 1000, res: "win", sess: "london", em: ["confident"], mis: [], rat: 5 },
    { inst: "US30", dir: "short", r: -0.02, pnl: -10, res: "breakeven", sess: "newyork", em: ["calm"], mis: [], rat: 4 },
    { inst: "EURUSD", dir: "long", r: 2.2, pnl: 1100, res: "win", sess: "london", em: ["focused"], mis: [], rat: 5 },
    { inst: "GBPUSD", dir: "short", r: -1.0, pnl: -500, res: "loss", sess: "newyork", em: ["fomo"], mis: ["fomo"], rat: 2 },
    { inst: "NAS100", dir: "short", r: 3.8, pnl: 1900, res: "win", sess: "newyork", em: ["confident"], mis: [], rat: 5 },
    { inst: "XAUUSD", dir: "short", r: 1.9, pnl: 950, res: "win", sess: "london", em: ["calm"], mis: [], rat: 4 },

    { inst: "BTCUSD", dir: "long", r: -1.0, pnl: -500, res: "loss", sess: "asia", em: ["anxious"], mis: ["no_stop"], rat: 1 },
    { inst: "US30", dir: "long", r: 2.5, pnl: 1250, res: "win", sess: "overlap", em: ["focused"], mis: [], rat: 5 },
    { inst: "EURUSD", dir: "short", r: 1.4, pnl: 700, res: "win", sess: "london", em: ["calm"], mis: [], rat: 4 },
    { inst: "XAUUSD", dir: "long", r: -1.0, pnl: -500, res: "loss", sess: "newyork", em: ["frustrated"], mis: ["early_entry"], rat: 2 },
    { inst: "NAS100", dir: "long", r: 3.0, pnl: 1500, res: "win", sess: "newyork", em: ["confident"], mis: [], rat: 5 },
    { inst: "GBPUSD", dir: "short", r: 0.01, pnl: 5, res: "breakeven", sess: "london", em: ["calm"], mis: [], rat: 4 },
    { inst: "GER40", dir: "short", r: 1.9, pnl: 950, res: "win", sess: "london", em: ["focused"], mis: [], rat: 4 },
    { inst: "XAUUSD", dir: "short", r: 2.6, pnl: 1300, res: "win", sess: "london", em: ["calm"], mis: [], rat: 5 },
    { inst: "US30", dir: "long", r: -1.0, pnl: -500, res: "loss", sess: "newyork", em: ["impatient"], mis: ["late_entry"], rat: 2 },
    { inst: "NAS100", dir: "long", r: 2.2, pnl: 1100, res: "win", sess: "newyork", em: ["confident"], mis: [], rat: 5 },
  ];

  const trades: Trade[] = [];

  // Distribute 60 trades evenly over ~88 days leading up to refMs
  for (let i = 0; i < templates.length; i++) {
    const t = templates[i];
    const dayOffset = Math.floor((i / 60) * 88); // 0 to 88 days ago
    const hourOffset = (i % 3) * 4 + 8; // 8:00, 12:00, 16:00
    const openMs = refMs - (88 - dayOffset) * dayMs + hourOffset * 3600 * 1000;
    const closeMs = openMs + 2 * 3600 * 1000; // 2 hours holding time

    const openedAtIso = new Date(openMs).toISOString();
    const closedAtIso = new Date(closeMs).toISOString();

    trades.push({
      id: `demo_trade_${i + 1}`,
      accountId: DEMO_ACCOUNT.id,
      instrument: t.inst,
      direction: t.dir as "long" | "short",
      status: "closed",
      openedAt: openedAtIso,
      closedAt: closedAtIso,
      entryPrice: t.inst === "XAUUSD" ? 2350 : t.inst === "NAS100" ? 18200 : 1.085,
      exitPrice: t.inst === "XAUUSD" ? 2375 : t.inst === "NAS100" ? 18350 : 1.09,
      stopLoss: t.inst === "XAUUSD" ? 2340 : t.inst === "NAS100" ? 18150 : 1.08,
      riskAmount: 500,
      pnlMoney: t.pnl,
      rMultiple: t.r,
      result: t.res as "win" | "loss" | "breakeven",
      session: t.sess as any,
      emotions: t.em,
      mistakes: t.mis,
      executionRating: t.rat,
      verification: "verified",
      source: "manual",
      createdAt: openedAtIso,
      updatedAt: closedAtIso,
      schemaVersion: 1,
    });
  }

  return trades;
}
