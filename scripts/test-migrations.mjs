// Runs supabase/migrations against an in-memory Postgres (PGlite) with a minimal Supabase auth stub,
// then supabase/tests/profile_defaults.sql. PGlite is not a project dependency; run with:
//   npm i --no-save @electric-sql/pglite@0.2.17 && node scripts/test-migrations.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("..", import.meta.url));
let PGlite;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  console.error("PGlite not installed. Run: npm i --no-save @electric-sql/pglite@0.2.17");
  process.exit(2);
}
const read = (p) => readFileSync(`${repo}${p}`, "utf8").replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/, "");
const STUB = `
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;`;
async function fresh() { const db = new PGlite(); await db.exec(STUB); return db; }
const ok = (m) => console.log("PASS", m);
const fail = (m) => { console.log("FAIL", m); process.exitCode = 1; };

// A. 0001 only: new user without age group -> sign-up fails (reproduces production 23502)
{
  const db = await fresh(); await db.exec(read("supabase/migrations/0001_init.sql"));
  try { await db.exec(`INSERT INTO auth.users (id,email) VALUES ('00000000-0000-0000-0000-000000000001','a@x')`); fail("A: insert unexpectedly succeeded on 0001"); }
  catch (e) { (e.code === "23502" && /minor_mode/.test(e.message)) ? ok(`A: 0001 reproduces bug: ${e.code} ${e.message}`) : fail(`A: other error ${e.code} ${e.message}`); }
}
// B. 0001 + 0002 (twice, idempotent) -> test script passes, check query as expected
{
  const db = await fresh(); await db.exec(read("supabase/migrations/0001_init.sql"));
  await db.exec(read("supabase/migrations/0002_profile_defaults.sql"));
  await db.exec(read("supabase/migrations/0002_profile_defaults.sql")); ok("B: 0002 applied twice");
  try { await db.exec(read("supabase/tests/profile_defaults.sql")); ok("B: tests/profile_defaults.sql passed"); } catch (e) { fail(`B: test script: ${e.message}`); }
  const left = await db.query(`SELECT count(*)::int AS n FROM public.profiles`);
  left.rows[0].n === 0 ? ok("B: test rolled back (no rows left)") : fail("B: rows left after test");
  const chk = await db.query(read("supabase/checks/0002_status.sql"));
  console.log("   check:", JSON.stringify(chk.rows[0]));
  const r = chk.rows[0];
  (r.minor_mode_default === "false" && r.calc_minor_mode_fixed && r.signup_never_fails && Number(r.users_without_profile) === 0) ? ok("B: check query") : fail("B: check query");
  const c1 = await db.query(read("supabase/checks/0001_status.sql").split("-- Query 2")[0]);
  console.log("   0001 check:", JSON.stringify(c1.rows[0]));
}
// C. Profile insert broken for another reason -> sign-up still succeeds; re-running 0002 backfills the row
{
  const db = await fresh(); await db.exec(read("supabase/migrations/0001_init.sql"));
  await db.exec(read("supabase/migrations/0002_profile_defaults.sql"));
  await db.exec(`CREATE OR REPLACE FUNCTION public.calc_minor_mode() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;`);
  try { await db.exec(`INSERT INTO auth.users (id,email) VALUES ('00000000-0000-0000-0000-000000000002','b@x')`); ok("C: sign-up not blocked by a profile error"); }
  catch (e) { fail(`C: sign-up blocked: ${e.message}`); }
  const n0 = (await db.query(`SELECT count(*)::int n FROM public.profiles`)).rows[0].n;
  await db.exec(read("supabase/migrations/0002_profile_defaults.sql"));
  const p = (await db.query(`SELECT minor_mode FROM public.profiles WHERE id='00000000-0000-0000-0000-000000000002'`)).rows[0];
  (n0 === 0 && p && p.minor_mode === false) ? ok("C: backfill created the missing row with minor_mode=false") : fail(`C: backfill n0=${n0} row=${JSON.stringify(p)}`);
}
