import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { composeSwitchedSet, QUEST_CATALOG_VERSION, type DayMode, type DaySet } from "./quest-engine";
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
  for (const f of ["0001_init.sql", "0002_profile_defaults.sql", "0003_nickname_cooldown.sql", "0004_journal_sync.sql", "0014_game_economy.sql", "0015_game_days.sql"]) await db.exec(read(f));
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
