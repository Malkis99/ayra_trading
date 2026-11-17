import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { GAME_CONFIG } from "./game-config";
import { xpForNextLevel } from "./game";
import { PQ_RANK_XP } from "./personal-quests";

// Q4.1: the server rules (supabase/migrations/0014_game_economy.sql) are the same numbers the app uses today — a change
// on one side without the other fails here. The server never takes an amount from a request; these rows are the amounts.

const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "0014_game_economy.sql"), "utf8");
const rules = new Map<string, { xp: number; coins: number; countMax: number | null; xpMax: number | null }>();
for (const m of sql.matchAll(/\('([a-z0-9_]+)',\s*'[a-z_]+',\s*(\d+),\s*(\d+),\s*(?:'[a-z_]+'|NULL),\s*(\d+|NULL),\s*(?:'[a-z_]+'|NULL),\s*(\d+|NULL),/g)) {
  rules.set(m[1], { xp: Number(m[2]), coins: Number(m[3]), countMax: m[4] === "NULL" ? null : Number(m[4]), xpMax: m[5] === "NULL" ? null : Number(m[5]) });
}

describe("server rules match the app (0014 ↔ lib)", () => {
  it("a mission: 40 XP + 10 Coins, three a day", () => {
    expect(rules.get("mission")).toEqual({ xp: GAME_CONFIG.QUEST_XP, coins: GAME_CONFIG.QUEST_COINS, countMax: 3, xpMax: null });
  });

  it("the daily reward by day of the series", () => {
    GAME_CONFIG.DAILY_REWARD_VALUES.forEach((coins, i) => expect(rules.get(`daily_reward_${i + 1}`)).toMatchObject({ xp: 0, coins, countMax: 1 }));
  });

  it("self-reports: no Coins, 90 XP a day", () => {
    for (const code of ["self_report_25", "self_report_45"]) expect(rules.get(code)).toMatchObject({ coins: 0, xpMax: GAME_CONFIG.SELF_REPORT_DAILY_XP_CAP });
  });

  it("personal quests: variant C, XP only", () => {
    for (const v of ["app", "self"] as const)
      for (const r of ["bronze", "silver", "gold"] as const) expect(rules.get(`pq_${r}_${v}`)).toMatchObject({ xp: PQ_RANK_XP[v][r], coins: 0 });
  });

  it("the Coins cap a day and the level formula", () => {
    expect(sql).toMatch(new RegExp(`coins_per_day INTEGER NOT NULL DEFAULT ${GAME_CONFIG.DAILY_COIN_CAP}\\b`));
    // game_level_for_xp: level n needs 80 + 40·n
    expect(sql).toContain("80 + v_level * 40");
    expect([1, 2, 5, 10].map(xpForNextLevel)).toEqual([1, 2, 5, 10].map((n) => 80 + 40 * n));
  });

  it("every rule was read (the parser follows the file)", () => {
    expect(rules.size).toBe(16);
  });
});
