import { describe, it, expect } from "vitest";
import { simulate, withSelfCap } from "./econ-sim";
import { GAME_CONFIG } from "./game-config";

// Properties of the CURRENT rules, including the approved self-report XP cap (docs/quests-2.0-plan.md). If a future change breaks one
// of them, the economy changed and needs the owner's decision.
describe("economy simulation on the real game rules", () => {
  const days = 28;
  const honest = simulate("honest", days);
  const active = simulate("active", days);
  const farmer = simulate("farmer", days);

  it("coins: nobody gets more than the daily cap (one-time first-action rewards aside)", () => {
    const firstActions = Object.values(GAME_CONFIG.FIRST_ACTION_REWARDS).reduce((n, r) => n + r.coins, 0);
    for (const r of [honest, active, farmer]) {
      for (const d of r.log) expect(d.coins).toBeLessThanOrEqual(GAME_CONFIG.DAILY_COIN_CAP + firstActions);
    }
  });

  it("self-report XP never goes over the approved daily cap", () => {
    for (const r of [honest, active, farmer]) for (const d of r.log) expect(d.selfXp).toBeLessThanOrEqual(GAME_CONFIG.SELF_REPORT_DAILY_XP_CAP);
  });

  it("the farmer gets no more coins than a very active honest player", () => {
    expect(farmer.coins).toBeLessThanOrEqual(active.coins);
  });

  it("duplicates, future-dated trades, extra trades, double clicks and repeated claims give the farmer nothing extra", () => {
    // farmer and active do the same journal actions; the farmer's extra attempts must add no XP beyond self-reports
    expect(farmer.totalXp - farmer.selfXp).toBe(active.totalXp - active.selfXp);
  });

  it("the farmer's only XP edge is self-reports (choosing the richest mode before the first reward)", () => {
    expect(farmer.totalXp - active.totalXp).toBe(farmer.selfXp - active.selfXp);
    expect(farmer.selfXp).toBeGreaterThanOrEqual(active.selfXp);
  });

  it("cap options are only computed here: with no cap the totals are the real ones", () => {
    expect(withSelfCap(farmer, null).totalXp).toBe(farmer.totalXp);
    expect(withSelfCap(farmer, 0).totalXp).toBe(farmer.totalXp - farmer.selfXp);
  });
});
