import { describe, it, expect } from "vitest";
import { PLAYERS, simulateLive } from "./econ-sim-qh6";
import { PQ_PROFILES, combined, simulatePersonal, type RateVariant } from "./econ-sim-qh8";

// QH-8.1: what personal quest rewards would do to the economy (proposed rates; nothing is wired to the game).

describe("personal quest rewards in the economy simulation", () => {
  it("the farmer gets exactly what an honest player with three full quests gets: every trick is refused", () => {
    for (const days of [90, 360]) {
      const max3 = simulatePersonal("max3", days);
      const farmer = simulatePersonal("farmer", days);
      expect(farmer.xp).toBe(max3.xp);
      expect(farmer.paidRuns).toBe(max3.paidRuns);
      expect(farmer.refused).toBeGreaterThan(0);
    }
  });

  it("the ceiling: 3 quests × 250 XP per 30-day period; nothing paid before the first period ends", () => {
    const d29 = simulatePersonal("max3", 30);
    expect(d29.xp).toBe(0); // the first report comes on day 31
    for (const days of [90, 360]) {
      const r = simulatePersonal("max3", days);
      const periods = Math.floor((days - 1) / 30); // settled on day 30, 60, … inside the horizon
      expect(r.paidRuns).toBe(3 * periods);
      expect(r.xp).toBe(3 * 250 * periods);
      expect(r.maxXpOneDay).toBe(750);
    }
  });

  it("fewer than 21 days pays nothing (the history keeps the runs)", () => {
    const r = simulatePersonal("lazy", 90);
    expect(r.xp).toBe(0);
    expect(r.ranks.none).toBe(r.settled);
    expect(r.settled).toBeGreaterThan(0);
  });

  it("variant C halves self-reported runs only; B lowers every rank", () => {
    expect(simulatePersonal("farmer", 90, "C").xp).toBe(simulatePersonal("farmer", 90, "A").xp / 2);
    expect(simulatePersonal("steady", 90, "C").xp).toBe(simulatePersonal("steady", 90, "A").xp); // app-confirmed
    expect(simulatePersonal("max3", 90, "B").xp).toBeLessThan(simulatePersonal("max3", 90, "A").xp);
  });

  it("coins never change: rewards are XP only", () => {
    const base = simulateLive("trader", 90);
    expect(combined("trader", "max3", 90, "A", base).coins).toBe(base.coins);
  });

  it("report (QH8_REPORT=1 prints the tables for the spec)", () => {
    const rows: string[] = [];
    for (const days of [90, 360]) {
      const bases = Object.fromEntries(PLAYERS.map((p) => [p, simulateLive(p, days)]));
      for (const v of ["A", "B", "C"] as RateVariant[]) {
        rows.push(`\n${days} days, variant ${v}`);
        rows.push("player | profile | base XP | personal XP | share | level base → with");
        for (const p of PLAYERS) {
          for (const prof of PQ_PROFILES) {
            if (prof === "none") continue;
            const c = combined(p, prof, days, v, bases[p]);
            rows.push(`${p} | ${prof} | ${c.baseXp} | ${c.pqXp} | ${(c.share * 100).toFixed(1)}% | ${c.baseLevel} → ${c.level}`);
          }
        }
      }
      const per = PQ_PROFILES.map((prof) => {
        const r = simulatePersonal(prof, days);
        return `${prof}: settled ${r.settled}, paid ${r.paidRuns}, xp ${r.xp}, ranks ${JSON.stringify(r.ranks)}, refused ${r.refused}`;
      });
      rows.push(`\nprofiles (${days} days, A):\n${per.join("\n")}`);
    }
    if (process.env.QH8_REPORT) console.log(rows.join("\n"));
    expect(rows.length).toBeGreaterThan(10);
  }, 240_000);
});
