import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { composeSwitchedSet, defaultModeFor, extrasForMode, poolForMode, DAY_MODES, QUEST_CATALOG_VERSION, type DayMode, type DaySet } from "./quest-engine";
import { JOURNAL_CONFIRMED, QUEST_POOL, questReward } from "./quests";
import { missionsForMode } from "./missions";

// Q4.3: the server day (migration 0015) must give the same mission slots as the app (lib/quest-engine.ts
// composeSwitchedSet, lib/missions.ts missionsForMode) — one rule, two places, checked against each other here.

const repo = join(__dirname, "..");
const read = (f: string) => readFileSync(join(repo, "supabase/migrations", f), "utf8").replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/, "");
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;`);
  for (const f of ["0001_init.sql", "0002_profile_defaults.sql", "0003_nickname_cooldown.sql", "0004_journal_sync.sql", "0014_game_economy.sql", "0015_game_days.sql", "0016_game_day_api.sql"]) await db.exec(read(f));
}, 120_000);
afterAll(async () => {
  await db?.close();
});

const subsets = <T,>(xs: T[]): T[][] => xs.reduce<T[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]]);
const MODES: Exclude<DayMode, "rest">[] = ["trading", "study", "recovery"];

describe("Q4.3 server day ↔ app: the same rules", () => {
  it("the three missions of each mode (both study choices)", async () => {
    for (const mode of MODES) {
      for (const tradeReview of [false, true]) {
        const first = tradeReview ? "m_trade_review" : "m_observation";
        const sql = (await db.query<{ c: string[] }>(`SELECT public.game_mode_core($1, $2) c`, [mode, first])).rows[0].c;
        expect(sql).toEqual(missionsForMode(mode, tradeReview));
      }
    }
    expect((await db.query<{ c: string[] }>(`SELECT public.game_mode_core('rest', 'm_observation') c`)).rows[0].c).toEqual(missionsForMode("rest", false));
  });

  it("a mode change mid-day: the same slots and carried missions for every paid / put-off combination", async () => {
    let cases = 0;
    for (const tradeReview of [false, true]) {
      const first = tradeReview ? "m_trade_review" : "m_observation";
      for (const from of MODES) {
        for (const to of MODES) {
          if (from === to) continue;
          // the day as it stands: the set of `from`, possibly after an earlier change (carried from a third mode)
          const third = MODES.find((m) => m !== from && m !== to)!;
          for (const start of ["plain", "afterChange"] as const) {
            const current = start === "plain" ? missionsForMode(from, tradeReview) : [missionsForMode(third, tradeReview)[0], ...missionsForMode(from, tradeReview).slice(1)];
            const carried: Record<string, DayMode> = start === "plain" ? {} : { [current[0]]: third };
            const fresh = missionsForMode(to, tradeReview);
            for (const done of subsets(current)) {
              for (const passed of subsets([...new Set([...fresh, ...current])]).filter((s) => s.length <= 3)) {
                const doneRec = Object.fromEntries(done.map((id) => [id, true]));
                const passedRec = Object.fromEntries(passed.map((id) => [id, true]));
                const freshSet: DaySet = { day: "2026-11-20", mode: to, catalogVersion: QUEST_CATALOG_VERSION, core: fresh, bonus: [], studyFirst: first };
                const app = composeSwitchedSet({ core: current, mode: from, carried, bonus: [] }, freshSet, doneRec, passedRec);
                const sql = (
                  await db.query<{ core: string[]; carried: Record<string, string> }>(
                    `SELECT (r).core, (r).carried FROM (SELECT public.game_compose_core($1::text[], $2, $3::jsonb, $4::text[], $5, $6::text[], $7::text[]) r) x`,
                    [current, from, JSON.stringify(carried), fresh, to, done, passed]
                  )
                ).rows[0];
                expect({ core: sql.core, carried: sql.carried }, `${from}→${to} done=${done} passed=${passed} start=${start}`).toEqual({ core: app.core, carried: app.carried ?? {} });
                cases++;
              }
            }
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(1000);
  }, 120_000);
});

describe("Q4.4 server day API ↔ app: the catalog and the opening mode", () => {
  it("the extras catalog: the same quests, XP, extras and pool of every mode, the same replaceable quests", async () => {
    const rows = (await db.query<{ id: string; reward_xp: number; xp_reward: number; extra_modes: string[]; pool_modes: string[]; replaceable: boolean }>(
      "SELECT id, reward_xp, xp_reward, extra_modes, pool_modes, replaceable FROM public.game_extra_quests ORDER BY id"
    )).rows;
    const app = QUEST_POOL.map((q) => ({
      id: q.id,
      reward_xp: questReward(q).xp,
      xp_reward: q.xpReward,
      extra_modes: DAY_MODES.filter((m) => extrasForMode(m).some((x) => x.id === q.id)),
      pool_modes: DAY_MODES.filter((m) => poolForMode(m).some((x) => x.id === q.id)),
      replaceable: !JOURNAL_CONFIRMED.has(q.id),
    })).sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(rows).toEqual(app);
  });

  it("the opening mode from the trading days (lib/quest-engine.ts defaultModeFor) for every weekday and several day sets", async () => {
    const uid = "00000000-0000-0000-0000-00000000aa01";
    await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${uid}', 'p@x') ON CONFLICT DO NOTHING`);
    for (const days of [[0, 1, 2, 3, 4], [5, 6], [2], [0, 1, 2, 3, 4, 5, 6]]) {
      // the owner writes the test row (the guard refuses anyone else)
      await db.exec(`SET ROLE game_economy_owner;
        INSERT INTO public.game_accounts (user_id, trading_days) VALUES ('${uid}', '{${days.join(",")}}')
        ON CONFLICT (user_id) DO UPDATE SET trading_days = EXCLUDED.trading_days; RESET ROLE;`);
      for (let i = 16; i <= 22; i++) {
        const day = `2026-11-${i}`;
        const sql = (await db.query<{ m: string }>("SELECT public.game_default_mode($1, $2::date) m", [uid, day])).rows[0].m;
        expect(sql, `${days} ${day}`).toBe(defaultModeFor(day, days));
      }
    }
  });
});

