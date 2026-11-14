import { describe, it, expect } from "vitest";
import { GAME_CONFIG } from "./game-config";
import { PLAYERS, missionSplit, simulateCurrent, simulateProposed, variantOf } from "./econ-sim-qh6";

// QH-6 proposal checks on the real game rules (docs/quest-hub-qh6-spec.md, section 5). Nothing here changes the game.

const runs = PLAYERS.map((p) => ({ p, cur: simulateCurrent(p, 90), a: simulateProposed(p, 90), split: missionSplit(p, 90) }));

describe("QH-6 economy simulation (90 days, real rules)", () => {
  it("never more than three verified missions a day, whatever the player does", () => {
    for (const r of runs) expect(r.a.maxMissionsDay).toBeLessThanOrEqual(GAME_CONFIG.CORE_QUESTS_PER_DAY);
  });

  it("coins stay under the daily cap in every variant (one-time rewards aside)", () => {
    for (const r of runs) {
      expect(r.cur.maxCoinsDay).toBeLessThanOrEqual(GAME_CONFIG.DAILY_COIN_CAP);
      expect(r.a.maxCoinsDay).toBeLessThanOrEqual(GAME_CONFIG.DAILY_COIN_CAP);
    }
  });

  it("closing a mission twice (a reload, a second tab) pays once: the maximiser's missions equal its days × 3", () => {
    const m = runs.find((r) => r.p === "maximiser")!;
    expect(m.a.missions).toBe(90 * 3);
  });

  it("self-reports stay within the approved daily cap: never more than 90 XP a day on average or on any day", () => {
    for (const r of runs) expect(r.a.selfXp).toBeLessThanOrEqual(90 * 90);
  });

  it("no mission needs a trade: the learner who never trades gets all its missions", () => {
    const l = runs.find((r) => r.p === "learner")!;
    expect(l.a.tradeLog).toBe(0);
    expect(l.a.missions).toBe(l.split.other);
  });

  it("the honest trader keeps about today's XP; the farmer gains nothing over today", () => {
    const t = runs.find((r) => r.p === "trader")!;
    expect(Math.abs(t.a.totalXp - t.cur.totalXp) / t.cur.totalXp).toBeLessThan(0.05);
    const m = runs.find((r) => r.p === "maximiser")!;
    expect(m.a.totalXp).toBeLessThanOrEqual(m.cur.totalXp);
    expect(m.a.coins).toBeLessThanOrEqual(m.cur.coins);
  });

  it("variants B and C only change the mission rate: B lowers XP and coins, C keeps today's coins for non-trading missions", () => {
    for (const r of runs) {
      const b = variantOf(r.a, r.split.trading, r.split.other, "B");
      const c = variantOf(r.a, r.split.trading, r.split.other, "C");
      expect(b.totalXp).toBe(r.a.totalXp - 10 * (r.split.trading + r.split.other));
      expect(c.totalXp).toBe(r.a.totalXp);
      expect(c.coins).toBe(r.a.coins - 10 * r.split.other);
    }
  });
});
