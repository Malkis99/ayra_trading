// Runs supabase/migrations against an in-memory Postgres (PGlite) with a minimal Supabase auth stub,
// then the SQL tests in supabase/tests. PGlite is a dev dependency (runs in CI too):
//   node scripts/test-migrations.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("..", import.meta.url));
let PGlite;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  console.error("PGlite not installed. Run: npm ci");
  process.exit(2);
}
const read = (p) => readFileSync(`${repo}${p}`, "utf8").replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/, "");
const STUB = `
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  -- same as Supabase: the user id comes from the JWT claim set for the request (NULL when signed out)
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;`;
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
// D. 0003: nickname once per 14 days (first one free), applied twice (idempotent); rollback works
{
  const db = await fresh(); await db.exec(read("supabase/migrations/0001_init.sql"));
  await db.exec(read("supabase/migrations/0002_profile_defaults.sql"));
  await db.exec(read("supabase/migrations/0003_nickname_cooldown.sql"));
  await db.exec(read("supabase/migrations/0003_nickname_cooldown.sql")); ok("D: 0003 applied twice");
  try { await db.exec(read("supabase/tests/nickname_cooldown.sql")); ok("D: tests/nickname_cooldown.sql passed"); } catch (e) { fail(`D: test script: ${e.message}`); }
  const chk = (await db.query(read("supabase/checks/0003_status.sql"))).rows[0];
  (chk.nickname_changed_at_column && chk.cooldown_trigger) ? ok("D: check query") : fail(`D: check ${JSON.stringify(chk)}`);
  await db.exec(read("supabase/migrations/0003_nickname_cooldown.down.sql"));
  const after = (await db.query(read("supabase/checks/0003_status.sql"))).rows[0];
  (!after.nickname_changed_at_column && !after.cooldown_trigger) ? ok("D: rollback removes column and trigger") : fail(`D: rollback ${JSON.stringify(after)}`);
}
// E. 0004: journal tables + RLS + sync flag, applied twice (idempotent); test passes; rollback removes everything
{
  const db = await fresh();
  for (const f of ["0001_init", "0002_profile_defaults", "0003_nickname_cooldown"]) await db.exec(read(`supabase/migrations/${f}.sql`));
  await db.exec(read("supabase/migrations/0004_journal_sync.sql"));
  await db.exec(read("supabase/migrations/0004_journal_sync.sql")); ok("E: 0004 applied twice");
  try { await db.exec(read("supabase/tests/journal_sync_rls.sql")); ok("E: tests/journal_sync_rls.sql passed"); } catch (e) { fail(`E: test script: ${e.message}`); }
  const left = (await db.query(`SELECT count(*)::int n FROM public.journal_trades`)).rows[0].n;
  left === 0 ? ok("E: test rolled back (no rows left)") : fail("E: rows left after test");
  const chk = (await db.query(read("supabase/checks/0004_status.sql"))).rows[0];
  console.log("   check:", JSON.stringify(chk));
  (chk.journal_tables === 9 && chk.rls_enabled === 9 && chk.client_delete_grants === 0 && chk.write_trigger_function && chk.user_features_table && chk.cloud_sync_function)
    ? ok("E: check query") : fail("E: check query");
  await db.exec(read("supabase/migrations/0004_journal_sync.down.sql"));
  const after = (await db.query(read("supabase/checks/0004_status.sql"))).rows[0];
  (after.journal_tables === 0 && !after.user_features_table && !after.cloud_sync_function) ? ok("E: rollback removes tables, flag and functions") : fail(`E: rollback ${JSON.stringify(after)}`);
  const prof = (await db.query(read("supabase/checks/0003_status.sql"))).rows[0];
  prof.cooldown_trigger ? ok("E: rollback keeps 0001–0003") : fail("E: rollback touched earlier migrations");
}

// F. Owner's flag commands (docs/t7b-4f-plan.md 3.2 / 3.5) and the read-only cloud check: wrong e-mail enables
// nothing (INSERT 0 0), only the owner gets the flag, the check counts only the owner's rows, rollback is UPDATE 1
{
  const db = await fresh();
  for (const f of ["0001_init", "0002_profile_defaults", "0003_nickname_cooldown", "0004_journal_sync"]) await db.exec(read(`supabase/migrations/${f}.sql`));
  const OWNER = "00000000-0000-0000-0000-0000000000f1", OTHER = "00000000-0000-0000-0000-0000000000f2";
  await db.exec(`INSERT INTO auth.users (id,email) VALUES ('${OWNER}','owner@x'), ('${OTHER}','other@x')`);
  const enable = (email) => `INSERT INTO public.user_features (user_id, cloud_sync)
    SELECT id, TRUE FROM auth.users WHERE email = '${email}'
    ON CONFLICT (user_id) DO UPDATE SET cloud_sync = TRUE`;
  const wrong = await db.query(enable("typo@x"));
  const none = (await db.query(`SELECT count(*)::int n FROM public.user_features WHERE cloud_sync`)).rows[0].n;
  wrong.affectedRows === 0 && none === 0 ? ok("F: wrong e-mail → INSERT 0 0, nothing enabled") : fail(`F: wrong e-mail ${wrong.affectedRows}/${none}`);
  const right = await db.query(enable("owner@x"));
  const on = (await db.query(`SELECT user_id FROM public.user_features WHERE cloud_sync`)).rows;
  right.affectedRows === 1 && on.length === 1 && on[0].user_id === OWNER ? ok("F: INSERT 0 1, flag only for the owner") : fail(`F: enable ${right.affectedRows} ${JSON.stringify(on)}`);
  const trade = (id, extra = "") => `'{"id":"${id}","accountId":"acc","instrument":"EURUSD","direction":"long","result":"win","openedAt":"2026-10-01T10:00:00Z","updatedAt":"2026-10-01T10:00:00Z","schemaVersion":6${extra}}'`;
  await db.exec(`INSERT INTO public.journal_trades (user_id, id, data) VALUES
    ('${OWNER}','t1',${trade("t1")}), ('${OWNER}','t2',${trade("t2")}),
    ('${OWNER}','t3',${trade("t3", ',"deletedAt":"2026-10-01T10:00:00Z"')}), ('${OTHER}','t9',${trade("t9")})`);
  const rows = (await db.query(read("supabase/checks/cloud_sync_owner.sql").replaceAll("ТВОЯ_ПОЧТА", "owner@x"))).rows;
  const tr = rows.find((r) => r.what === "Сделки");
  rows.length === 7 && Number(tr.live) === 2 && Number(tr.deleted) === 1 ? ok("F: cloud check counts only the owner's rows (live 2, deleted 1)") : fail(`F: check ${JSON.stringify(rows)}`);
  const off = await db.query(`UPDATE public.user_features SET cloud_sync = FALSE
    WHERE user_id = (SELECT id FROM auth.users WHERE email = 'owner@x')`);
  const left = (await db.query(`SELECT count(*)::int n FROM public.user_features WHERE cloud_sync`)).rows[0].n;
  const kept = (await db.query(`SELECT count(*)::int n FROM public.journal_trades`)).rows[0].n;
  off.affectedRows === 1 && left === 0 && kept === 4 ? ok("F: rollback UPDATE 1, flag off, nothing deleted") : fail(`F: rollback ${off.affectedRows}/${left}/${kept}`);
}
