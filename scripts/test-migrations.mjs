// Runs supabase/migrations against an in-memory Postgres (PGlite) with a minimal Supabase auth stub,
// then the SQL tests in supabase/tests. PGlite is a dev dependency (runs in CI too):
//   node scripts/test-migrations.mjs
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installBaseline, readSql, runMetaChecks, seed, snapshot } from "./watchlist-meta-sql-checks.mjs";
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
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  -- the auth server's own role (Supabase): it runs the Custom Access Token Hook of 0018
  CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb DEFAULT '{}'::jsonb);
  -- as in Supabase Auth (the columns 0018 uses): the app_metadata of the user, sessions and refresh tokens
  CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(), not_after timestamptz);
  CREATE TABLE IF NOT EXISTS auth.refresh_tokens (id bigserial PRIMARY KEY, token varchar(255), user_id varchar(255),
    revoked boolean DEFAULT false, session_id uuid REFERENCES auth.sessions(id) ON DELETE CASCADE);
  -- same as Supabase: the user id comes from the JWT claim set for the request (NULL when signed out)
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;`;
// Minimal Supabase Storage: buckets, objects (RLS on, rules decide), foldername(). The Storage server's own checks
// (bucket size and type limits before a file is accepted) are not here — the bucket settings are checked instead.
const STORAGE_STUB = `
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now());
  CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id),
    name text NOT NULL, owner uuid, owner_id text, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
    UNIQUE (bucket_id, name));
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
  GRANT SELECT ON storage.buckets TO anon, authenticated;
  GRANT ALL ON storage.objects TO anon, authenticated;`;
async function fresh() { const db = new PGlite(); await db.exec(STUB); await db.exec(STORAGE_STUB); return db; }
const ok = (m) => console.log("PASS", m);
const fail = (m) => { console.log("FAIL", m); process.exitCode = 1; };

// WATCH-1B.1: separate metadata, safe reapplication, all legacy rows preserved, RLS and guarded rollback.
{
  const db = await fresh();
  const sqlDb = { query: async (sql, args) => args ? db.query(sql, args) : (await db.exec(sql)).at(-1) };
  try {
    await installBaseline(sqlDb); await seed(sqlDb);
    const before = await snapshot(sqlDb);
    for (let i = 0; i < 2; i++) await db.exec(readSql("migrations/0017_watchlist_meta.sql"));
    if (JSON.stringify(await snapshot(sqlDb)) !== JSON.stringify(before)) throw new Error("0017 changed existing rows");
    ok("WATCH: 0017 twice preserves every existing column");
    await runMetaChecks(sqlDb, ok);
    await db.exec(read("supabase/tests/market_sync_rls.sql"));
    ok("WATCH: old 0008 RLS tests pass with 0017");
  } catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`WATCH: ${e.message}`); }
  finally { await db.close(); }
}

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

// G. 0005: screenshots in the cloud — bucket, rows, Storage rules (limits, hard cap, delayed removal), applied twice;
// the usage check works; rollback stops on a non-empty bucket and otherwise removes everything, keeping 0001–0004
{
  const db = await fresh();
  for (const f of ["0001_init", "0002_profile_defaults", "0003_nickname_cooldown", "0004_journal_sync"]) await db.exec(read(`supabase/migrations/${f}.sql`));
  await db.exec(read("supabase/migrations/0005_journal_attachments.sql"));
  await db.exec(read("supabase/migrations/0005_journal_attachments.sql")); ok("G: 0005 applied twice");
  try { await db.exec(read("supabase/tests/journal_attachments_rls.sql")); ok("G: tests/journal_attachments_rls.sql passed"); } catch (e) { fail(`G: test script: ${e.message}`); }
  const left = (await db.query(`SELECT (SELECT count(*) FROM public.journal_attachments)::int + (SELECT count(*) FROM storage.objects)::int AS n`)).rows[0].n;
  left === 0 ? ok("G: test rolled back (no rows left)") : fail("G: rows left after test");
  const chk = (await db.query(read("supabase/checks/0005_status.sql"))).rows[0];
  console.log("   check:", JSON.stringify(chk));
  const want = { attachments_table: true, rls_enabled: true, client_delete_grants: 0, files_trigger: true, bucket_private: true,
    bucket_mime_types: "image/jpeg,image/png,image/webp", storage_policies: 3, storage_update_policies: 0, file_bytes: "5242880",
    quota_bytes: "209715200", hard_cap_bytes: "419430400", delete_after_days: "30", orphan_min_age_hours: "24", helpers_bypass_rls: true };
  const bad = Object.entries(want).filter(([k, v]) => chk[k] !== v);
  bad.length === 0 && Number(chk.bucket_size_limit) === 5242880 ? ok("G: check query") : fail(`G: check query ${JSON.stringify(bad)}`);

  // owner changes a limit, re-runs the migration: the change is kept
  await db.exec(`UPDATE public.journal_limits SET attachment_quota_bytes = 1 WHERE id = 1`);
  await db.exec(read("supabase/migrations/0005_journal_attachments.sql"));
  const q = (await db.query(`SELECT attachment_quota_bytes::text AS q FROM public.journal_limits`)).rows[0].q;
  q === "1" ? ok("G: re-run keeps the owner's limits") : fail(`G: re-run reset limits to ${q}`);
  await db.exec(`UPDATE public.journal_limits SET attachment_quota_bytes = 209715200 WHERE id = 1`);

  // usage check: one live file, one of a deleted screenshot, one without a row
  const U = "00000000-0000-0000-0000-0000000000d5";
  await db.exec(`INSERT INTO auth.users (id,email) VALUES ('${U}','usage@x');
    INSERT INTO public.journal_attachments (user_id, id, data) VALUES
      ('${U}','a1','{"id":"a1","tradeId":"t","bytes":1048576,"mime":"image/webp","createdAt":"2026-10-01T10:00:00Z"}'),
      ('${U}','a2','{"id":"a2","tradeId":"t","bytes":2097152,"mime":"image/webp","createdAt":"2026-10-01T10:00:00Z","deletedAt":"2026-10-02T10:00:00Z"}');
    INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
      ('journal-attachments','${U}/a1.webp','{"size":1048576}'), ('journal-attachments','${U}/a2.webp','{"size":2097152}'),
      ('journal-attachments','${U}/x.webp','{"size":524288}')`);
  const use = (await db.query(read("supabase/checks/attachments_usage.sql"))).rows[0];
  console.log("   usage:", JSON.stringify(use));
  (use.email === "usage@x" && Number(use.live_files) === 1 && Number(use.used_mb) === 1.5 && Number(use.all_mb) === 3.5
    && Number(use.waiting_mb) === 2 && Number(use.orphans) === 1 && Number(use.limit_mb) === 200 && Number(use.hard_cap_mb) === 400)
    ? ok("G: usage check by user") : fail("G: usage check");

  // rollback with files in the bucket: stops, nothing changed
  try { await db.exec(read("supabase/migrations/0005_journal_attachments.down.sql")); fail("G: rollback ran on a non-empty bucket"); }
  catch (e) {
    await db.exec("ROLLBACK").catch(() => {});
    const still = (await db.query(read("supabase/checks/0005_status.sql"))).rows[0];
    /not empty/.test(e.message) && still.attachments_table && still.storage_policies === 3 ? ok("G: rollback stops on a non-empty bucket, nothing changed") : fail(`G: rollback on non-empty: ${e.message}`);
  }
  await db.exec(`DELETE FROM storage.objects; DELETE FROM public.journal_attachments`);
  await db.exec(read("supabase/migrations/0005_journal_attachments.down.sql"));
  const after = (await db.query(read("supabase/checks/0005_status.sql"))).rows[0];
  console.log("   after rollback:", JSON.stringify(after));
  (!after.attachments_table && after.bucket_private === null && after.storage_policies === 0 && after.quota_bytes === null)
    ? ok("G: rollback removes table, limits, rules and the empty bucket") : fail("G: rollback");
  const j = (await db.query(read("supabase/checks/0004_status.sql"))).rows[0];
  j.journal_tables === 9 && j.write_trigger_function && j.cloud_sync_function ? ok("G: rollback keeps 0001–0004") : fail("G: rollback touched 0004");
}

// H. 0008: Market data in the account (Watchlist, notes, chart view) — applied twice; RLS, last-write-wins, tombstones;
//    rollback removes only the Market table
{
  const db = await fresh();
  for (const f of ["0001_init", "0002_profile_defaults", "0003_nickname_cooldown", "0004_journal_sync"]) await db.exec(read(`supabase/migrations/${f}.sql`));
  await db.exec(read("supabase/migrations/0008_market_sync.sql"));
  await db.exec(read("supabase/migrations/0008_market_sync.sql")); ok("H: 0008 applied twice");
  try { await db.exec(read("supabase/tests/market_sync_rls.sql")); ok("H: tests/market_sync_rls.sql passed"); } catch (e) { fail(`H: test script: ${e.message}`); }
  const left = (await db.query(`SELECT count(*)::int n FROM public.market_user_data`)).rows[0].n;
  left === 0 ? ok("H: test rolled back (no rows left)") : fail("H: rows left after test");
  const chk = (await db.query(read("supabase/checks/0008_status.sql"))).rows[0];
  console.log("   check:", JSON.stringify(chk));
  (chk.market_table && chk.rls_enabled && chk.write_trigger_function && chk.client_delete_grants === 0 && chk.policies === 3) ? ok("H: check query") : fail("H: check query");
  await db.exec(read("supabase/migrations/0008_market_sync.down.sql"));
  const after = (await db.query(read("supabase/checks/0008_status.sql"))).rows[0];
  (!after.market_table && !after.write_trigger_function) ? ok("H: rollback removes the Market table and its function") : fail(`H: rollback ${JSON.stringify(after)}`);
  const j = (await db.query(read("supabase/checks/0004_status.sql"))).rows[0];
  j.journal_tables === 9 && j.cloud_sync_function ? ok("H: rollback keeps 0004") : fail("H: rollback touched 0004");
}

// I. 0009: Market calendar and official news — applied twice; everyone reads (hidden rows excluded), nobody but the
//    collector writes, the log is closed, only https links and short descriptions, 90-day clean-up; rollback removes
//    only these tables
{
  const db = await fresh();
  for (const f of ["0001_init", "0002_profile_defaults", "0003_nickname_cooldown", "0004_journal_sync", "0008_market_sync"]) await db.exec(read(`supabase/migrations/${f}.sql`));
  await db.exec(read("supabase/migrations/0009_market_feeds.sql"));
  await db.exec(read("supabase/migrations/0009_market_feeds.sql")); ok("I: 0009 applied twice");
  try { await db.exec(read("supabase/tests/market_feeds_rls.sql")); ok("I: tests/market_feeds_rls.sql passed"); } catch (e) { fail(`I: test script: ${e.message}`); }
  const left = (await db.query(`SELECT (SELECT count(*) FROM public.market_events) + (SELECT count(*) FROM public.market_news) + (SELECT count(*) FROM public.market_feed_runs) AS n`)).rows[0].n;
  Number(left) === 0 ? ok("I: test rolled back (no rows left)") : fail("I: rows left after test");
  const svc = (await db.query(`SELECT has_table_privilege('service_role', 'public.market_news', 'INSERT') AS w, has_function_privilege('service_role', 'public.market_feeds_prune()', 'EXECUTE') AS p`)).rows[0];
  svc.w && svc.p ? ok("I: the collector (service role) may write and clean up") : fail(`I: service role rights ${JSON.stringify(svc)}`);
  const chk = (await db.query(read("supabase/checks/0009_status.sql"))).rows[0];
  console.log("   check:", JSON.stringify(chk));
  (chk.feed_tables === 3 && chk.rls_enabled === 3 && chk.prune_function && chk.client_write_grants === 0 && chk.client_log_grants === 0 && chk.read_policies === 2) ? ok("I: check query") : fail("I: check query");
  await db.exec(read("supabase/migrations/0009_market_feeds.down.sql"));
  const after = (await db.query(read("supabase/checks/0009_status.sql"))).rows[0];
  (after.feed_tables === 0 && !after.prune_function) ? ok("I: rollback removes the feed tables and functions") : fail(`I: rollback ${JSON.stringify(after)}`);
  const m = (await db.query(read("supabase/checks/0008_status.sql"))).rows[0];
  m.market_table ? ok("I: rollback keeps 0008") : fail("I: rollback touched 0008");
}

// J. 0010: more official sources — applied twice on top of 0009; the new sources and countries are accepted, others
//    (companies, aggregators, countries outside the plan) still rejected; access unchanged; rollback restores the 0009
//    lists, removing only rows of the new sources and keeping the old ones
{
  const db = await fresh();
  for (const f of ["0001_init", "0002_profile_defaults", "0003_nickname_cooldown", "0004_journal_sync", "0008_market_sync", "0009_market_feeds"]) await db.exec(read(`supabase/migrations/${f}.sql`));
  const before = (await db.query(read("supabase/checks/0010_status.sql"))).rows[0];
  (!before.events_sources && !before.news_countries) ? ok("J: check query is false before 0010") : fail(`J: before ${JSON.stringify(before)}`);
  await db.exec(read("supabase/migrations/0010_market_feeds_sources.sql"));
  await db.exec(read("supabase/migrations/0010_market_feeds_sources.sql")); ok("J: 0010 applied twice");
  try { await db.exec(read("supabase/tests/market_feeds_sources.sql")); ok("J: tests/market_feeds_sources.sql passed"); } catch (e) { fail(`J: test script: ${e.message}`); }
  try { await db.exec(read("supabase/tests/market_feeds_rls.sql")); ok("J: tests/market_feeds_rls.sql still passes after 0010"); } catch (e) { fail(`J: 0009 test after 0010: ${e.message}`); }
  const chk = (await db.query(read("supabase/checks/0010_status.sql"))).rows[0];
  console.log("   check:", JSON.stringify(chk));
  (chk.events_sources && chk.events_countries && chk.news_sources && chk.news_countries && chk.read_policies === 2 && chk.client_write_grants === 0) ? ok("J: check query") : fail("J: check query");
  await db.exec(`INSERT INTO public.market_events (id, source, kind, country, title, importance, starts_at) VALUES
    ('bls:keep:2026-11-06', 'bls', 'release', 'us', 'Keep', 3, '2026-11-06T13:30:00Z'),
    ('ons:gone:2026-11-12', 'ons', 'release', 'gb', 'Gone', 3, '2026-11-12T07:00:00Z');
    INSERT INTO public.market_news (id, source, kind, country, title, url, published_at, importance, dedupe_key) VALUES
    ('eia:gone', 'eia', 'data', 'us', 'Gone', 'https://www.eia.gov/x', '2026-11-04T15:30:00Z', 2, 'eia-gone')`);
  await db.exec(read("supabase/migrations/0010_market_feeds_sources.down.sql"));
  const after = (await db.query(read("supabase/checks/0010_status.sql"))).rows[0];
  (!after.events_sources && !after.events_countries && !after.news_sources && !after.news_countries) ? ok("J: rollback restores the 0009 lists") : fail(`J: rollback ${JSON.stringify(after)}`);
  const rows = (await db.query(`SELECT (SELECT string_agg(id, ',') FROM public.market_events) AS e, (SELECT count(*)::int FROM public.market_news) AS n`)).rows[0];
  (rows.e === "bls:keep:2026-11-06" && rows.n === 0) ? ok("J: rollback removes only the new sources' rows") : fail(`J: rows after rollback ${JSON.stringify(rows)}`);
  const f9 = (await db.query(read("supabase/checks/0009_status.sql"))).rows[0];
  (f9.feed_tables === 3 && f9.read_policies === 2) ? ok("J: rollback keeps 0009") : fail("J: rollback touched 0009");
}

// K. 0011: notification inbox/settings, two-user RLS, immutable content and atomic preferences.
{
  const db = await fresh();
  for (const f of ["0001_init", "0002_profile_defaults"]) await db.exec(read(`supabase/migrations/${f}.sql`));
  await db.exec(read("supabase/migrations/0011_notifications.sql"));
  await db.exec(read("supabase/migrations/0011_notifications.sql")); ok("K: 0011 applied twice");
  try { await db.exec(read("supabase/tests/notifications_rls.sql")); ok("K: notifications_rls.sql passed"); }
  catch (e) { fail(`K: notifications_rls.sql: ${e.code} ${e.message}`); }
  const chk = (await db.query(read("supabase/checks/0011_status.sql"))).rows[0];
  (chk.tables === 3 && chk.rls_enabled === 3 && chk.save_function && !chk.client_can_forge_notification && !chk.client_can_change_payload && chk.client_can_mark_read && !chk.anon_can_read)
    ? ok("K: grants and status") : fail(`K: status ${JSON.stringify(chk)}`);
  await db.close();
}

// L. 0012: additive calendar integrity with realistic legacy values, ambiguity, versioning and service-only writes.
{
  const db = await fresh();
  for (const f of ["0001_init", "0002_profile_defaults", "0009_market_feeds", "0010_market_feeds_sources"]) await db.exec(read(`supabase/migrations/${f}.sql`));
  await db.exec(`INSERT INTO public.market_events(id,source,country,kind,code,title,importance,starts_at,status,actual,previous,hidden) VALUES
    ('bea:legacy:2026-11-01','bea','us','release','us_pce','Legacy',3,'2026-11-01T13:30Z','released','3.0','2.0',true),
    ('bea:dup-a','bea','us','release','us_pce','Ambiguous',3,'2026-11-10T13:30Z','scheduled',NULL,NULL,false),
    ('bea:dup-b','bea','us','release','us_pce','Ambiguous',3,'2026-11-10T13:30Z','released','0.2','0.3',false);
    INSERT INTO public.market_news(id,source,kind,country,title,url,published_at,importance,dedupe_key,event_id) VALUES
    ('bea:keep-link','bea','data','us','Keep news','https://www.bea.gov/',now(),3,'keep-link','bea:legacy:2026-11-01');`);
  const before = JSON.stringify(await db.exec(read('supabase/checks/0012_preflight.sql')));
  const absent = (await db.query(`SELECT to_regprocedure('public.market_events_apply(jsonb,text)') IS NULL AS absent`)).rows[0].absent;
  const legacyRead = (await db.query(`SELECT id,status,actual,previous,starts_at FROM public.market_events`)).rows.length;
  absent && legacyRead === 3 ? ok('L: legacy calendar readable before migration, new writer absent') : fail('L: pre-migration compatibility');
  await db.exec(read('supabase/migrations/0012_market_event_integrity.sql'));
  await db.exec(read('supabase/migrations/0012_market_event_integrity.sql')); ok('L: 0012 applied twice over populated legacy data');
  const after = JSON.stringify(await db.exec(read('supabase/checks/0012_preflight.sql')));
  before === after ? ok('L: IDs, status, values, counts and duplicates preserved') : fail('L: additive migration changed legacy data');
  try { await db.exec(read('supabase/tests/market_event_integrity.sql')); ok('L: stable identity, move, cancel/restore, revisions, stale/null/ambiguous data and grants'); }
  catch (e) { fail(`L: ${e.code} ${e.message}`); }
  const check = (await db.query(read('supabase/checks/0012_status.sql'))).rows[0];
  check.columns_ready && check.writer_ready && check.rls_enabled && check.server_can_write && !check.client_can_write ? ok('L: status and grants') : fail(`L: status ${JSON.stringify(check)}`);
  (await db.query(`SELECT id,status,actual,previous,starts_at FROM public.market_events`)).rows.length === 3 ? ok('L: legacy calendar readable after migration') : fail('L: post-migration compatibility');
  const link = (await db.query(`SELECT event_id FROM public.market_news WHERE id='bea:keep-link'`)).rows[0];
  link.event_id === 'bea:legacy:2026-11-01' ? ok('L: news FK unchanged') : fail('L: news FK changed');
  await db.close();
}
{
  const db = await fresh();
  for (const file of ["0001_init", "0002_profile_defaults", "0009_market_feeds", "0010_market_feeds_sources", "0012_market_event_integrity"]) {
    await db.exec(read(`supabase/migrations/${file}.sql`));
  }
  const snapshot = async () => JSON.stringify((await db.query("SELECT id,actual,previous,result_meta FROM public.market_events ORDER BY id")).rows);
  await db.exec(`INSERT INTO public.market_events(id,source,country,kind,code,title,importance,starts_at,status,actual,previous,result_meta,reference_period,release_stage) VALUES
    ('bls:us_cpi:2026-11-10','bls','us','release','us_cpi','CPI',3,now()-interval '10 seconds','scheduled',NULL,NULL,NULL,'2026-10','regular'),
    ('bls:us_cpi_yoy:2026-11-10','bls','us','release','us_cpi_yoy','Annual CPI',3,now()-interval '10 seconds','scheduled',NULL,NULL,NULL,'2026-10','regular'),
    ('bls:us_cpi:2026-10-14','bls','us','release','us_cpi','Prior CPI',3,now()-interval '1 month','released','0.3%','0.2%','{"period":"2026-09"}','2026-09','regular');`);
  const before = await snapshot();
  const originalWriter = (await db.query("SELECT pg_get_functiondef('public.market_events_apply(jsonb,text)'::regprocedure) AS definition")).rows[0].definition;
  for (let i = 0; i < 2; i++) await db.exec(read("supabase/migrations/0013_market_release_checks.sql"));
  const afterWriter = (await db.query("SELECT pg_get_functiondef('public.market_events_apply(jsonb,text)'::regprocedure) AS definition")).rows[0].definition;
  before === await snapshot() && originalWriter === afterWriter ? ok("M: 0013 applied twice, old facts and writer preserved") : fail("M: changed old data or 0012 writer");
  const roles = (await db.query(`SELECT has_table_privilege('anon','public.market_release_checks','SELECT') AS anon_read,
    has_table_privilege('authenticated','public.market_release_checks','SELECT') AS user_read,
    has_function_privilege('anon','public.market_release_reserve(text,text[])','EXECUTE') AS anon_exec,
    has_function_privilege('authenticated','public.market_release_finish(uuid,boolean,text,timestamptz,jsonb,jsonb)','EXECUTE') AS user_exec,
    has_column_privilege('anon','public.market_events','release_outcome','SELECT') AS public_read`)).rows[0];
  !roles.anon_read && !roles.user_read && !roles.anon_exec && !roles.user_exec && roles.public_read ? ok("M: private attempts, public outcome") : fail("M: unexpected grants");
  const reserve = async () => (await db.query("SELECT public.market_release_reserve('cpi',ARRAY['bls:us_cpi:2026-11-10','bls:us_cpi_yoy:2026-11-10']) AS token")).rows[0].token;
  const finish = async (token, verified, failure, retryAt, results = [], absences = []) =>
    (await db.query("SELECT public.market_release_finish($1,$2,$3,$4,$5::jsonb,$6::jsonb) AS result",
      [token, verified, failure, retryAt, JSON.stringify(results), JSON.stringify(absences)])).rows[0].result;
  await db.exec("SET ROLE service_role");
  const claims = await Promise.all([reserve(), reserve()]);
  claims.filter(Boolean).length === 1 ? ok("M: one reservation wins") : fail("M: parallel acquisition");
  await finish(claims.find(Boolean), false, "rate_limited", new Date(Date.now() + 900_000).toISOString());
  const retry = (await db.query("SELECT retry_at > now()+interval '14 minutes' AS honors FROM public.market_release_checks")).rows[0];
  retry.honors && !await reserve() && before === await snapshot() ? ok("M: Retry-After and failure preserve facts") : fail("M: Retry-After or data loss");
  await db.exec("UPDATE public.market_release_checks SET retry_at=NULL; UPDATE public.market_events SET starts_at=now()-interval '3 minutes' WHERE id IN ('bls:us_cpi:2026-11-10','bls:us_cpi_yoy:2026-11-10')");
  const second = await reserve();
  if (!second) fail("M: no second release slot");
  await finish(second, false, "blocked", null);
  const blocked = (await db.query("SELECT retry_at > now()+interval '23 hours' AS paused FROM public.market_release_checks")).rows[0];
  blocked.paused && !await reserve() ? ok("M: 403 pauses frequent checks") : fail("M: missing 403 backoff");
  await db.exec("UPDATE public.market_release_checks SET retry_at=NULL,attempted_at=now()-interval '25 hours'; UPDATE public.market_events SET starts_at=now()-interval '2 days' WHERE id IN ('bls:us_cpi:2026-11-10','bls:us_cpi_yoy:2026-11-10')");
  const recovered = await reserve();
  if (!recovered) fail("M: no late recovery");
  const url = (await db.query(`SELECT 'https://www.bls.gov/news.release/archives/cpi_' || to_char(starts_at AT TIME ZONE 'America/New_York','MMDDYYYY') || '.htm' AS url FROM public.market_events WHERE id='bls:us_cpi:2026-11-10'`)).rows[0].url;
  const result = await finish(recovered, true, null, null, [
    {id:"bls:us_cpi:2026-11-10",actual:"+0.4%",release_stage:"regular",result_meta:{period:"2026-10",series:"CUSR0000SA0",unit:"percent-mom",adjustment:"SA",release_url:url,vintage:"release"}},
  ], [{id:"bls:us_cpi_yoy:2026-11-10",period:"2026-10",stage:"regular",url}]);
  const outcomes = (await db.query("SELECT id,actual,release_outcome,release_official_url,release_checked_at,release_saved_at FROM public.market_events ORDER BY id")).rows;
  !result.some(x => x.conflict) && outcomes[2].release_outcome === "not_published" && outcomes[2].actual === null &&
    outcomes[2].release_official_url === url && outcomes[1].actual === "+0.4%" && outcomes[1].release_saved_at && outcomes[1].release_checked_at &&
    outcomes[0].actual === "0.3%" && !await reserve() ? ok("M: late recovery, confirmed absence, old value and no more attempts") : fail("M: unexpected final outcomes");
  try { await finish(recovered, false, "transient", null); fail("M: consumed lease accepted twice"); }
  catch (error) { error.message.includes("release reservation expired") ? ok("M: consumed lease rejected") : fail(`M: ${error.message}`); }
  await db.exec(`INSERT INTO public.market_events(id,source,country,kind,code,title,importance,starts_at,reference_period,release_stage)
    VALUES ('bls:us_nfp:2026-11-06','bls','us','release','us_nfp','NFP',3,now(),'2026-10','regular');`);
  const reserveNfp = async () => (await db.query("SELECT public.market_release_reserve('nfp',ARRAY['bls:us_nfp:2026-11-06']) AS token")).rows[0].token;
  for (const minutes of [0, 2, 4, 8, 14]) {
    await db.query("UPDATE public.market_events SET starts_at=now() - $1::int * interval '1 minute' WHERE code='us_nfp'", [minutes]);
    const token = await reserveNfp();
    if (!token) fail(`M: no slot at T+${minutes}`);
    await finish(token, false, "transient", null);
    if (await reserveNfp()) fail(`M: same slot accepted twice at T+${minutes}`);
  }
  await db.exec("UPDATE public.market_events SET starts_at=now()-interval '19 minutes' WHERE code='us_nfp'");
  !await reserveNfp() ? ok("M: five initial slots with no extra reservation") : fail("M: more than five initial slots");
  await db.close();
}

// N. 0014: server economy schema (Q4.1) — applied twice; RLS, service-only awards, append-only ledger, idempotency,
//    evidence re-check (TOCTOU), source claims, day caps, one-way account state, rebuild; nothing switched on;
//    rollback removes only the economy objects
{
  const db = await fresh();
  for (const f of ["0001_init", "0002_profile_defaults", "0003_nickname_cooldown", "0004_journal_sync"]) await db.exec(read(`supabase/migrations/${f}.sql`));
  await db.exec(read("supabase/migrations/0014_game_economy.sql"));
  await db.exec(read("supabase/migrations/0014_game_economy.sql")); ok("N: 0014 applied twice");
  try { await db.exec(read("supabase/tests/game_economy.sql")); ok("N: tests/game_economy.sql passed"); }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`N: test script: ${e.message}`); }
  const left = (await db.query(`SELECT (SELECT count(*) FROM public.game_ledger)::int + (SELECT count(*) FROM public.game_accounts)::int
    + (SELECT count(*) FROM public.game_profile)::int AS n`)).rows[0].n;
  left === 0 ? ok("N: test rolled back (no rows left)") : fail("N: rows left after test");
  // nothing is switched on by the migration: the flag is off for everyone, no account leaves «local»
  const flags = (await db.query(`SELECT column_default FROM information_schema.columns WHERE table_name='user_features' AND column_name='game_sync'`)).rows[0];
  flags && /false/i.test(flags.column_default) ? ok("N: game_sync defaults to off") : fail(`N: game_sync default ${JSON.stringify(flags)}`);
  // the rules match the device values (variant C, 40 + 10 a mission, 100 Coins a day)
  const rules = Object.fromEntries((await db.query(`SELECT code, xp, coins FROM public.game_reward_rules`)).rows.map((r) => [r.code, [r.xp, r.coins]]));
  const want = { mission: [40, 10], pq_bronze_app: [100, 0], pq_silver_app: [180, 0], pq_gold_app: [250, 0], pq_bronze_self: [50, 0], pq_silver_self: [90, 0], pq_gold_self: [125, 0], daily_reward_7: [0, 50] };
  const bad = Object.entries(want).filter(([k, v]) => JSON.stringify(rules[k]) !== JSON.stringify(v));
  const cap = (await db.query(`SELECT coins_per_day, late_window_minutes FROM public.game_limits`)).rows[0];
  bad.length === 0 && cap.coins_per_day === 100 && cap.late_window_minutes === 0 ? ok("N: rules and limits match the app") : fail(`N: rules ${JSON.stringify(bad)} ${JSON.stringify(cap)}`);
  // the level formula matches lib/game.ts (xpForNextLevel = 80 + 40·level)
  const lv = (await db.query(`SELECT public.game_level_for_xp(0) a, public.game_level_for_xp(119) b, public.game_level_for_xp(120) c, public.game_level_for_xp(280) d, public.game_level_for_xp(279) e`)).rows[0];
  lv.a === 1 && lv.b === 1 && lv.c === 2 && lv.d === 3 && lv.e === 2 ? ok("N: level formula") : fail(`N: level formula ${JSON.stringify(lv)}`);
  // the owner's rule change survives a re-run
  await db.exec(`SET ROLE game_economy_owner; UPDATE public.game_reward_rules SET xp = 41 WHERE code = 'mission'; RESET ROLE;`);
  await db.exec(read("supabase/migrations/0014_game_economy.sql"));
  const kept = (await db.query(`SELECT xp FROM public.game_reward_rules WHERE code = 'mission'`)).rows[0].xp;
  kept === 41 ? ok("N: re-run keeps the owner's rules") : fail(`N: re-run reset the rule to ${kept}`);
  await db.exec(read("supabase/migrations/0014_game_economy.down.sql"));
  const gone = (await db.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'game_%'`)).rows[0].n;
  const col = (await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='user_features' AND column_name='game_sync'`)).rows[0].n;
  const j = (await db.query(read("supabase/checks/0004_status.sql"))).rows[0];
  gone === 0 && col === 0 && j.journal_tables === 9 && j.cloud_sync_function ? ok("N: rollback removes the economy and keeps 0001–0004") : fail(`N: rollback tables ${gone} column ${col}`);
  await db.close();
}

// O. 0015: the server game day (Q4.3) on top of 0014 — applied twice; day tests; the mode table matches the app;
//    rollback restores the 0014 award and keeps 0014; nothing switched on
{
  const db = await fresh();
  for (const f of ["0001_init", "0002_profile_defaults", "0003_nickname_cooldown", "0004_journal_sync", "0014_game_economy"]) await db.exec(read(`supabase/migrations/${f}.sql`));
  await db.exec(read("supabase/migrations/0015_game_days.sql"));
  await db.exec(read("supabase/migrations/0015_game_days.sql")); ok("O: 0015 applied twice");
  try { await db.exec(read("supabase/tests/game_days.sql")); ok("O: tests/game_days.sql passed"); }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`O: test script: ${e.message}`); }
  const left = (await db.query(`SELECT (SELECT count(*) FROM public.game_days)::int + (SELECT count(*) FROM public.game_ledger)::int
    + (SELECT count(*) FROM public.game_shadow_diagnostics)::int AS n`)).rows[0].n;
  left === 0 ? ok("O: test rolled back (no rows left)") : fail("O: rows left after test");
  const kinds = (await db.query(`SELECT count(*)::int n FROM public.game_award_kinds WHERE enabled`)).rows[0].n;
  const active = (await db.query(`SELECT count(*)::int n FROM public.game_accounts`)).rows[0].n;
  kinds === 0 && active === 0 ? ok("O: nothing switched on (no kind enabled, no account)") : fail(`O: kinds ${kinds} accounts ${active}`);
  // the three missions of each mode, as lib/missions.ts missionsForMode gives them
  const modes = Object.fromEntries((await db.query(`SELECT mode, array_agg(mission_id ORDER BY slot) m FROM public.game_mode_missions GROUP BY mode`)).rows.map((r) => [r.mode, r.m.join(",")]));
  modes.trading === "q_bias,q_riskcheck,q_reflect" && modes.study === "$study_first,m_backtest,m_lesson" && modes.recovery === "m_day_state,m_mistake,m_plan_tomorrow"
    ? ok("O: missions of each mode match the app") : fail(`O: modes ${JSON.stringify(modes)}`);
  const lim = (await db.query(`SELECT replacements_per_day FROM public.game_limits`)).rows[0];
  lim.replacements_per_day === 2 ? ok("O: two replacements a day, as the app") : fail(`O: replacements ${JSON.stringify(lim)}`);
  await db.exec(read("supabase/migrations/0015_game_days.down.sql"));
  const gone = (await db.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('game_days','game_mode_missions','game_shadow_diagnostics')`)).rows[0].n;
  const fnLeft = (await db.query(`SELECT count(*)::int n FROM pg_proc WHERE proname IN ('game_apply_reward_at','game_day_open','game_my_day','game_day_now')`)).rows[0].n;
  const award = (await db.query(`SELECT prosrc FROM pg_proc WHERE proname = 'game_apply_reward'`)).rows;
  const ledger = (await db.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name='game_ledger'`)).rows[0].n;
  gone === 0 && fnLeft === 0 && award.length === 1 && /game_day_for\(p_user\)/.test(award[0].prosrc) && ledger === 1
    ? ok("O: rollback removes the day and restores the 0014 award") : fail(`O: rollback tables ${gone} functions ${fnLeft} award ${award.length}`);
  // after the rollback 0014's own tests still pass
  try { await db.exec(read("supabase/tests/game_economy.sql")); ok("O: 0014 tests pass after the 0015 rollback"); }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`O: 0014 tests after rollback: ${e.message}`); }
  await db.close();
}

// P. 0016: the server game day API (Q4.4) on top of 0014 + 0015 — applied twice; rows written before 0016 have no first
//    trace (unknown); API tests; rollback restores the 0015 day functions (and their tests pass) and keeps the Journal rows
{
  const db = await fresh();
  for (const f of ["0001_init", "0002_profile_defaults", "0003_nickname_cooldown", "0004_journal_sync", "0014_game_economy", "0015_game_days"]) await db.exec(read(`supabase/migrations/${f}.sql`));
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000a9199', 'old@x');
    INSERT INTO public.journal_notes (user_id, id, data) VALUES ('00000000-0000-0000-0000-0000000a9199', 'old1',
      '{"id":"old1","templateKey":"lesson","body":"Old.","createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T10:00:00Z"}');`);
  await db.exec(read("supabase/migrations/0016_game_day_api.sql"));
  await db.exec(read("supabase/migrations/0016_game_day_api.sql")); ok("P: 0016 applied twice");
  const old = (await db.query(`SELECT first_seen_at FROM public.journal_notes WHERE id = 'old1'`)).rows[0];
  old && old.first_seen_at === null ? ok("P: rows from before 0016 have no first trace (unknown, never «made today»)") : fail(`P: old row ${JSON.stringify(old)}`);
  await db.exec(`UPDATE public.journal_notes SET data = data || '{"updatedAt":"2026-11-02T10:00:00Z"}' WHERE id = 'old1'`);
  const still = (await db.query(`SELECT first_seen_at FROM public.journal_notes WHERE id = 'old1'`)).rows[0];
  still.first_seen_at === null ? ok("P: an update does not invent a first trace for an old row") : fail(`P: old row got ${still.first_seen_at}`);
  await db.exec(`DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000a9199'`);
  try { await db.exec(read("supabase/tests/game_day_api.sql")); ok("P: tests/game_day_api.sql passed"); }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`P: test script: ${e.message}`); }
  const left = (await db.query(`SELECT (SELECT count(*) FROM public.game_days)::int + (SELECT count(*) FROM public.game_accounts)::int AS n`)).rows[0].n;
  left === 0 ? ok("P: test rolled back (no rows left)") : fail("P: rows left after test");
  const kinds = (await db.query(`SELECT count(*)::int n FROM public.game_award_kinds WHERE enabled`)).rows[0].n;
  kinds === 0 ? ok("P: nothing switched on (no award kind enabled)") : fail(`P: kinds ${kinds}`);
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000a9198', 'keep@x');
    INSERT INTO public.journal_notes (user_id, id, data) VALUES ('00000000-0000-0000-0000-0000000a9198', 'k1',
      '{"id":"k1","templateKey":"lesson","body":"Keep.","createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T10:00:00Z"}');`);
  await db.exec(read("supabase/migrations/0016_game_day_api.down.sql"));
  const col = (await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE column_name = 'first_seen_at'`)).rows[0].n;
  const kept = (await db.query(`SELECT count(*)::int n FROM public.journal_notes WHERE id = 'k1'`)).rows[0].n;
  const open3 = (await db.query(`SELECT count(*)::int n FROM pg_proc WHERE proname = 'game_day_open' AND pronargs = 3`)).rows[0].n;
  const gone = (await db.query(`SELECT count(*)::int n FROM pg_proc WHERE proname IN ('game_day_status','game_journal_for_check','game_set_trading_days')`)).rows[0].n;
  col === 0 && kept === 1 && open3 === 1 && gone === 0 ? ok("P: rollback removes the API, keeps the Journal rows, restores the 0015 day") : fail(`P: rollback col ${col} kept ${kept} open3 ${open3} gone ${gone}`);
  await db.exec(`DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000a9198'`);
  try { await db.exec(read("supabase/tests/game_days.sql")); ok("P: 0015 tests pass after the 0016 rollback"); }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`P: 0015 tests after rollback: ${e.message}`); }
  await db.close();
}

// Q. 0018: server economy safety (Q4.5-2) on top of 0014–0016 — applied twice; transitions, the mark in auth.users,
//    sessions, freshness, awards only through the session check; the 0015/0016 tests still pass with it; nothing
//    switched on; rollback refuses while an account is scheduled, otherwise restores the 0014 model
{
  const base = ["0001_init", "0002_profile_defaults", "0003_nickname_cooldown", "0004_journal_sync", "0014_game_economy", "0015_game_days", "0016_game_day_api"];
  const db = await fresh();
  for (const f of base) await db.exec(read(`supabase/migrations/${f}.sql`));
  await db.exec(read("supabase/migrations/0018_game_economy_sessions.sql"));
  await db.exec(read("supabase/migrations/0018_game_economy_sessions.sql")); ok("Q: 0018 applied twice");
  try { await db.exec(read("supabase/tests/game_economy_sessions.sql")); ok("Q: tests/game_economy_sessions.sql passed"); }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`Q: test script: ${e.message}`); }
  const left = (await db.query(`SELECT (SELECT count(*) FROM public.game_accounts)::int + (SELECT count(*) FROM auth.sessions)::int AS n`)).rows[0].n;
  left === 0 ? ok("Q: test rolled back (no rows left)") : fail("Q: rows left after test");
  // (tests/game_days.sql targets the 0015 signatures that 0016 replaced — it runs only after the 0016 rollback, block P)
  try { await db.exec(read("supabase/tests/game_day_api.sql")); ok("Q: tests/game_day_api.sql (0016, with the 0015 day) pass with 0018"); }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`Q: game_day_api with 0018: ${e.message}`); }
  const cr = (await db.query(`SELECT has_schema_privilege('game_economy_owner', 'public', 'CREATE') AS x`)).rows[0].x;
  cr === false ? ok("Q: after 0014–0016 and 0018 (each twice) the owner keeps no CREATE on public") : fail("Q: CREATE on public left to the owner");
  const on = (await db.query(`SELECT (SELECT count(*) FROM public.game_award_kinds WHERE enabled)::int AS kinds,
    (SELECT count(*) FROM public.game_accounts WHERE state <> 'local')::int AS moved,
    (SELECT count(*) FROM auth.users WHERE raw_app_meta_data ? 'ayra_economy')::int AS marked`)).rows[0];
  on.kinds === 0 && on.moved === 0 && on.marked === 0 ? ok("Q: nothing switched on (no kind, no account moved, no mark)") : fail(`Q: switched on ${JSON.stringify(on)}`);
  // rollback: refused while an account is scheduled (0014 has no such state), nothing changed then
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000e5a90', 'sched@x');
    SELECT public.game_economy_transition('00000000-0000-0000-0000-0000000e5a90', 'local', 'migration_scheduled');`);
  let refused = false;
  try { await db.exec(read("supabase/migrations/0018_game_economy_sessions.down.sql")); } catch { refused = true; await db.exec("ROLLBACK").catch(() => {}); }
  const still = (await db.query(`SELECT count(*)::int n FROM pg_proc WHERE proname = 'game_economy_transition'`)).rows[0].n;
  refused && still === 1 ? ok("Q: rollback refused while an account is scheduled; nothing changed") : fail(`Q: rollback with a scheduled account refused=${refused} fn=${still}`);
  await db.exec(`DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000e5a90'`);
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000e5a91', 'keep@x');
    SELECT public.game_economy_transition('00000000-0000-0000-0000-0000000e5a91', 'local', 'migration_pending');`);
  await db.exec(read("supabase/migrations/0018_game_economy_sessions.down.sql"));
  const keptState = (await db.query(`SELECT state FROM public.game_accounts WHERE user_id = '00000000-0000-0000-0000-0000000e5a91'`)).rows[0];
  keptState && keptState.state === "migration_pending" ? ok("Q: rollback keeps every account's state (no destructive step)") : fail(`Q: rollback state ${JSON.stringify(keptState)}`);
  await db.exec(`DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000e5a91'`);
  const gone = (await db.query(`SELECT count(*)::int n FROM pg_proc WHERE proname IN ('game_economy_transition','game_session_check','game_apply_reward_for_session','game_access_token_hook','game_state_rank')`)).rows[0].n;
  const after = (await db.query(`SELECT has_column_privilege('game_economy_owner', 'auth.sessions', 'user_id', 'SELECT') AS sess,
    has_schema_privilege('game_economy_owner', 'public', 'CREATE') AS cr,
    has_function_privilege('service_role', 'public.game_apply_reward(uuid,text,text,jsonb)', 'EXECUTE') AS award`)).rows[0];
  const kept = (await db.query(`SELECT count(*)::int n FROM public.game_accounts`)).rows[0].n;
  gone === 0 && !after.sess && !after.cr && after.award === true
    ? ok("Q: rollback removes 0018 (hook, check, transition), the read on auth.sessions and CREATE; restores the 0014 award access")
    : fail(`Q: rollback fns ${gone} ${JSON.stringify(after)} kept ${kept}`);
  try { await db.exec(read("supabase/tests/game_day_api.sql")); ok("Q: 0016 tests pass after the 0018 rollback (0014 entry points restored)"); }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`Q: 0016 tests after rollback: ${e.message}`); }
  await db.close();
}

// R. 0019: device snapshots in quarantine, reconciliation, legacy reviews and the owner's activation (Q4.5-4) on top of
//    0014–0016 + 0018 — applied twice; the SQL tests; nothing switched on; the 0018 tests still pass with it; rollback
//    refused while any snapshot exists, otherwise restores 0018 (and its tests pass again)
{
  const base = ["0001_init", "0002_profile_defaults", "0003_nickname_cooldown", "0004_journal_sync", "0014_game_economy", "0015_game_days", "0016_game_day_api", "0018_game_economy_sessions"];
  const db = await fresh();
  for (const f of base) await db.exec(read(`supabase/migrations/${f}.sql`));
  await db.exec(read("supabase/migrations/0019_game_migration_import.sql"));
  await db.exec(read("supabase/migrations/0019_game_migration_import.sql")); ok("R: 0019 applied twice");
  try { await db.exec(read("supabase/tests/game_migration_import.sql")); ok("R: tests/game_migration_import.sql passed"); }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`R: test script: ${e.message}`); }
  const left = (await db.query(`SELECT (SELECT count(*) FROM public.game_imports)::int + (SELECT count(*) FROM public.game_migration_audit)::int
    + (SELECT count(*) FROM public.game_accounts)::int + (SELECT count(*) FROM public.game_migration_windows)::int
    + (SELECT count(*) FROM public.game_reconciliations)::int AS n`)).rows[0].n;
  left === 0 ? ok("R: test rolled back (no rows left)") : fail("R: rows left after test");
  try { await db.exec(read("supabase/tests/game_economy_sessions.sql")); ok("R: tests/game_economy_sessions.sql (0018) pass with 0019"); }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`R: 0018 tests with 0019: ${e.message}`); }
  const st = (await db.query(`SELECT has_schema_privilege('game_economy_owner', 'public', 'CREATE') AS cr,
    (SELECT count(*) FROM public.game_award_kinds WHERE enabled)::int AS kinds,
    (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
      WHERE r.rolname = 'game_migration_admin' AND u.rolname IN ('anon', 'authenticated', 'service_role', 'supabase_auth_admin'))::int AS api_members,
    (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'game_migration_admin') AS login`)).rows[0];
  !st.cr && st.kinds === 0 && st.api_members === 0 && st.login === false
    ? ok("R: no CREATE left, nothing switched on, the owner's role has no login and no API role in it") : fail(`R: state ${JSON.stringify(st)}`);
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000019b001', 'keep@x');
    SELECT public.game_economy_transition('00000000-0000-0000-0000-00000019b001', 'local', 'migration_pending');
    SELECT public.game_import_snapshot('00000000-0000-0000-0000-00000019b001', gen_random_uuid(), floor(extract(epoch FROM now()))::bigint,
      'migration_pending', gen_random_uuid(), gen_random_uuid(), 1, '{"level":2}');`);
  let refused = false;
  try { await db.exec(read("supabase/migrations/0019_game_migration_import.down.sql")); } catch { refused = true; await db.exec("ROLLBACK").catch(() => {}); }
  const kept = (await db.query(`SELECT count(*)::int n FROM public.game_imports`)).rows[0].n;
  refused && kept === 1 ? ok("R: rollback refused while a snapshot exists; the snapshot kept") : fail(`R: rollback with a snapshot refused=${refused} kept=${kept}`);
  await db.exec(`DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-00000019b001'`);
  await db.exec(read("supabase/migrations/0019_game_migration_import.down.sql"));
  const after = (await db.query(`SELECT to_regclass('public.game_imports') IS NULL AND to_regclass('public.game_migration_windows') IS NULL
      AND to_regprocedure('public.game_mig_reconcile(uuid)') IS NULL AS gone,
    NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'game_migration_admin') AS role_gone,
    has_function_privilege('service_role', 'public.game_economy_transition(uuid,text,text)', 'EXECUTE') AS tr,
    has_schema_privilege('game_economy_owner', 'public', 'CREATE') AS cr`)).rows[0];
  after.gone && after.role_gone && after.tr && !after.cr ? ok("R: rollback removes 0019 and restores the 0018 access") : fail(`R: rollback ${JSON.stringify(after)}`);
  try { await db.exec(read("supabase/tests/game_economy_sessions.sql")); ok("R: 0018 tests pass after the 0019 rollback"); }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`R: 0018 tests after rollback: ${e.message}`); }
  await db.close();
}

// T. 0020: achievements on the server, large snapshots, privacy and retention (Q4.6) on top of 0014–0016, 0018, 0019 —
//    applied twice; its tests; the 0019 and 0018 tests still pass with it; nothing readable by an API role; rollback
//    refused while an achievement exists, otherwise restores 0019 (its tests pass again)
{
  const base = ["0001_init", "0002_profile_defaults", "0003_nickname_cooldown", "0004_journal_sync", "0014_game_economy", "0015_game_days", "0016_game_day_api",
    "0018_game_economy_sessions", "0019_game_migration_import"];
  const db = await fresh();
  for (const f of base) await db.exec(read(`supabase/migrations/${f}.sql`));
  await db.exec(read("supabase/migrations/0020_game_achievements.sql"));
  await db.exec(read("supabase/migrations/0020_game_achievements.sql")); ok("T: 0020 applied twice");
  try { await db.exec(read("supabase/tests/game_achievements.sql")); ok("T: tests/game_achievements.sql passed"); }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`T: test script: ${e.message}`); }
  const left = (await db.query(`SELECT (SELECT count(*) FROM public.game_achievements)::int + (SELECT count(*) FROM public.game_imports)::int
    + (SELECT count(*) FROM public.game_privacy_stats)::int + (SELECT count(*) FROM public.game_deletion_log)::int AS n`)).rows[0].n;
  left === 0 ? ok("T: test rolled back (no rows left)") : fail("T: rows left after test");
  for (const t of ["game_migration_import", "game_economy_sessions"]) {
    try { await db.exec(read(`supabase/tests/${t}.sql`)); ok(`T: tests/${t}.sql pass with 0020`); }
    catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`T: ${t} with 0020: ${e.message}`); }
  }
  const st = (await db.query(`SELECT has_schema_privilege('game_economy_owner', 'public', 'CREATE') AS cr,
    (SELECT count(*) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['game_achievements', 'game_achievement_catalog', 'game_privacy_stats', 'game_deletion_log']) t
      WHERE has_table_privilege(r, 'public.' || t, 'SELECT') OR has_table_privilege(r, 'public.' || t, 'INSERT'))::int AS api,
    has_function_privilege('service_role', 'public.game_achievements_for_session(uuid,uuid,bigint,text)', 'EXECUTE') AS route,
    has_function_privilege('authenticated', 'public.game_achievements_for_session(uuid,uuid,bigint,text)', 'EXECUTE') AS client`)).rows[0];
  !st.cr && st.api === 0 && st.route && !st.client ? ok("T: no CREATE left; no API role reads or writes the new tables; only the route reads the person's achievements") : fail(`T: state ${JSON.stringify(st)}`);
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000020f001', 'keep@x');
    SET LOCAL ROLE game_economy_owner;
    INSERT INTO public.game_achievements (user_id, achievement_id, family, status, source, claimed_by, idempotency_key)
      VALUES ('00000000-0000-0000-0000-00000020f001', 'stylist', 'profile', 'verified', 'game_rule', '{x}', 'ach:stylist');
    RESET ROLE;`);
  let refused = false;
  try { await db.exec(read("supabase/migrations/0020_game_achievements.down.sql")); } catch { refused = true; await db.exec("ROLLBACK").catch(() => {}); }
  const kept = (await db.query("SELECT count(*)::int n FROM public.game_achievements")).rows[0].n;
  refused && kept === 1 ? ok("T: rollback refused while an achievement exists; the achievement kept") : fail(`T: rollback with an achievement refused=${refused} kept=${kept}`);
  await db.exec(`DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-00000020f001'`);
  await db.exec(read("supabase/migrations/0020_game_achievements.down.sql"));
  const after = (await db.query(`SELECT to_regclass('public.game_achievements') IS NULL AND to_regclass('public.game_deletion_log') IS NULL
      AND to_regprocedure('public.game_mig_achievement_plan(uuid,jsonb,bigint)') IS NULL AS gone,
    NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_reconciliations' AND column_name = 'achievements_transferred_at') AS col_gone,
    to_regclass('public.game_imports') IS NOT NULL AS kept_0019`)).rows[0];
  after.gone && after.col_gone && after.kept_0019 ? ok("T: rollback removes 0020 and keeps 0019") : fail(`T: rollback ${JSON.stringify(after)}`);
  try { await db.exec(read("supabase/tests/game_migration_import.sql")); ok("T: 0019 tests pass after the 0020 rollback"); }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`T: 0019 tests after rollback: ${e.message}`); }
  await db.close();
}

// U. 0021: what proves an achievement (Q4.7-B2) on top of 0020 — applied twice; its tests; the 0020, 0019 and 0018 tests
//    still pass with it; the plan only for the owner's tool; rollback refused once an achievement was recorded under its
//    rules, otherwise restores 0020 (whose tests pass again with 0020's expectations)
{
  const base = ["0001_init", "0002_profile_defaults", "0003_nickname_cooldown", "0004_journal_sync", "0014_game_economy", "0015_game_days", "0016_game_day_api",
    "0018_game_economy_sessions", "0019_game_migration_import", "0020_game_achievements"];
  const db = await fresh();
  for (const f of base) await db.exec(read(`supabase/migrations/${f}.sql`));
  await db.exec(read("supabase/migrations/0021_game_achievement_proof.sql"));
  await db.exec(read("supabase/migrations/0021_game_achievement_proof.sql")); ok("U: 0021 applied twice");
  for (const t of ["game_achievement_proof", "game_achievements", "game_migration_import", "game_economy_sessions"]) {
    try { await db.exec(read(`supabase/tests/${t}.sql`)); ok(`U: tests/${t}.sql pass with 0021`); }
    catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`U: ${t} with 0021: ${e.message}`); }
  }
  const left = (await db.query("SELECT (SELECT count(*) FROM public.game_achievements)::int + (SELECT count(*) FROM public.game_imports)::int AS n")).rows[0].n;
  left === 0 ? ok("U: tests rolled back (no rows left)") : fail("U: rows left after tests");
  const st = (await db.query(`SELECT has_schema_privilege('game_economy_owner', 'public', 'CREATE') AS cr,
    (SELECT count(*) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
      WHERE has_function_privilege(r, 'public.game_mig_achievement_plan(uuid,jsonb,bigint)', 'EXECUTE'))::int AS api,
    has_function_privilege('game_migration_admin', 'public.game_mig_achievement_plan(uuid,jsonb,bigint)', 'EXECUTE') AS admin,
    (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'public.game_mig_achievement_plan(uuid,jsonb,bigint)'::regprocedure) AS owner`)).rows[0];
  !st.cr && st.api === 0 && st.admin && st.owner === "game_economy_owner"
    ? ok("U: no CREATE left; the plan only for the owner's tool, owned by the economy owner") : fail(`U: state ${JSON.stringify(st)}`);
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000021f001', 'keep@x');
    SET LOCAL ROLE game_economy_owner;
    INSERT INTO public.game_achievements (user_id, achievement_id, family, status, source, claimed_by, idempotency_key)
      VALUES ('00000000-0000-0000-0000-00000021f001', 'firstPlan', 'profile', 'pending_review', 'device_flag', '{x}', 'ach:firstPlan');
    RESET ROLE;`);
  let refused = false;
  try { await db.exec(read("supabase/migrations/0021_game_achievement_proof.down.sql")); } catch { refused = true; await db.exec("ROLLBACK").catch(() => {}); }
  const kept = (await db.query("SELECT rules_version FROM public.game_achievements")).rows;
  refused && kept.length === 1 && kept[0].rules_version === "q4.7"
    ? ok("U: rollback refused once an achievement was recorded under the q4.7 rules; it is kept") : fail(`U: rollback refused=${refused} kept=${JSON.stringify(kept)}`);
  // (its deletion is counted in the anonymous deletion log, which outlives a rollback of 0021: cleared so the 0020 tests
  //  below count only their own deletions)
  await db.exec(`DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-00000021f001';
    SET LOCAL ROLE game_economy_owner; DELETE FROM public.game_deletion_log; RESET ROLE;`);
  await db.exec(read("supabase/migrations/0021_game_achievement_proof.down.sql"));
  const after = (await db.query(`SELECT (SELECT proof FROM public.game_achievement_catalog WHERE id = 'stylist') AS stylist,
    (SELECT column_default FROM information_schema.columns WHERE table_name = 'game_achievements' AND column_name = 'rules_version') AS def`)).rows[0];
  after.stylist === "game_rule" && /q4\.6/.test(after.def) ? ok("U: rollback restores 0020's catalog and rules version") : fail(`U: rollback ${JSON.stringify(after)}`);
  try { await db.exec(read("supabase/tests/game_achievements.sql")); ok("U: 0020 tests pass after the 0021 rollback"); }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`U: 0020 tests after rollback: ${e.message}`); }
  await db.close();
}

// V. 0022: the bulk review of one account's unproven achievements (Q4.7-Б3) on top of 0021 — applied twice; its tests;
//    the 0021, 0020, 0019 and 0018 tests still pass with it; only the owner's tool calls it; rollback removes the functions
//    and keeps every decision (the 0021 tests pass again)
{
  const base = ["0001_init", "0002_profile_defaults", "0003_nickname_cooldown", "0004_journal_sync", "0014_game_economy", "0015_game_days", "0016_game_day_api",
    "0018_game_economy_sessions", "0019_game_migration_import", "0020_game_achievements", "0021_game_achievement_proof"];
  const db = await fresh();
  for (const f of base) await db.exec(read(`supabase/migrations/${f}.sql`));
  await db.exec(read("supabase/migrations/0022_game_achievement_bulk_review.sql"));
  await db.exec(read("supabase/migrations/0022_game_achievement_bulk_review.sql")); ok("V: 0022 applied twice");
  for (const t of ["game_achievement_bulk_review", "game_achievement_proof", "game_achievements", "game_migration_import", "game_economy_sessions"]) {
    try { await db.exec(read(`supabase/tests/${t}.sql`)); ok(`V: tests/${t}.sql pass with 0022`); }
    catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`V: ${t} with 0022: ${e.message}`); }
  }
  const left = (await db.query("SELECT (SELECT count(*) FROM public.game_achievements)::int + (SELECT count(*) FROM public.game_migration_audit)::int AS n")).rows[0].n;
  left === 0 ? ok("V: tests rolled back (no rows left)") : fail("V: rows left after tests");
  const st = (await db.query(`SELECT has_schema_privilege('game_economy_owner', 'public', 'CREATE') AS cr,
    (SELECT count(*) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['public.game_mig_achievement_review(uuid)',
      'public.game_mig_bulk_accept_achievements(uuid,bigint,jsonb,uuid,text,text)']) f WHERE has_function_privilege(r, f, 'EXECUTE'))::int AS api,
    has_function_privilege('game_migration_admin', 'public.game_mig_bulk_accept_achievements(uuid,bigint,jsonb,uuid,text,text)', 'EXECUTE') AS admin`)).rows[0];
  !st.cr && st.api === 0 && st.admin ? ok("V: no CREATE left; no API role calls the review; the owner's tool does") : fail(`V: state ${JSON.stringify(st)}`);
  // a decision taken with 0022 stays after its rollback (it is an ordinary legacy_accepted row with its log)
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000022f001', 'keep@x');
    SET LOCAL ROLE game_economy_owner;
    INSERT INTO public.game_achievements (user_id, achievement_id, family, status, source, claimed_by, idempotency_key, decided_by, decided_at, reason)
      VALUES ('00000000-0000-0000-0000-00000022f001', 'author', 'profile', 'legacy_accepted', 'device_flag', '{x}', 'ach:author', 'owner', now(), 'kept');
    RESET ROLE;`);
  await db.exec(read("supabase/migrations/0022_game_achievement_bulk_review.down.sql"));
  const after = (await db.query(`SELECT to_regprocedure('public.game_mig_bulk_accept_achievements(uuid,bigint,jsonb,uuid,text,text)') IS NULL
      AND to_regprocedure('public.game_mig_achievement_review(uuid)') IS NULL AS gone,
    (SELECT count(*) FROM public.game_achievements WHERE status = 'legacy_accepted')::int AS kept`)).rows[0];
  after.gone && after.kept === 1 ? ok("V: rollback removes the review and keeps every decision") : fail(`V: rollback ${JSON.stringify(after)}`);
  await db.exec(`DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-00000022f001';
    SET LOCAL ROLE game_economy_owner; DELETE FROM public.game_deletion_log; RESET ROLE;`);
  try { await db.exec(read("supabase/tests/game_achievement_proof.sql")); ok("V: 0021 tests pass after the 0022 rollback"); }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`V: 0021 tests after rollback: ${e.message}`); }
  await db.close();
}

// W. 0023: deleting one's own account, files included (Q4.7-Б1) on top of 0001–0005 and 0014–0022 — applied twice; its
//    tests; the journal and screenshot rules of 0004/0005 still pass with it (cloud_sync_enabled is redefined); only the
//    service role calls it; rollback refused while a deletion is unfinished, otherwise restores 0004's cloud_sync_enabled
{
  const base = ["0001_init", "0002_profile_defaults", "0003_nickname_cooldown", "0004_journal_sync", "0005_journal_attachments", "0008_market_sync",
    "0011_notifications", "0014_game_economy",
    "0015_game_days", "0016_game_day_api", "0018_game_economy_sessions", "0019_game_migration_import", "0020_game_achievements",
    "0021_game_achievement_proof", "0022_game_achievement_bulk_review"];
  const db = await fresh();
  for (const f of base) await db.exec(read(`supabase/migrations/${f}.sql`));
  await db.exec(read("supabase/migrations/0023_account_deletion.sql"));
  await db.exec(read("supabase/migrations/0023_account_deletion.sql")); ok("W: 0023 applied twice");
  for (const t of ["account_deletion", "journal_sync_rls", "journal_attachments_rls", "market_sync_rls", "notifications_rls", "game_achievement_bulk_review"]) {
    try { await db.exec(read(`supabase/tests/${t}.sql`)); ok(`W: tests/${t}.sql pass with 0023`); }
    catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`W: ${t} with 0023: ${e.message}`); }
  }
  const st = (await db.query(`SELECT
    (SELECT count(*) FROM unnest(ARRAY['anon', 'authenticated']) r, unnest(ARRAY['public.account_deletion_begin(uuid)', 'public.account_deletion_manifest(uuid)',
      'public.account_deletion_ready(uuid)', 'public.account_deletion_status(uuid)', 'public.account_deletion_failed(uuid,text)']) f
      WHERE has_function_privilege(r, f, 'EXECUTE'))::int AS api,
    has_function_privilege('service_role', 'public.account_deletion_manifest(uuid)', 'EXECUTE') AS route,
    (SELECT count(*) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['public.account_deletions', 'public.account_deletion_objects',
      'public.account_deletion_stats']) t WHERE has_table_privilege(r, t, 'SELECT') OR has_table_privilege(r, t, 'INSERT'))::int AS tables`)).rows[0];
  st.api === 0 && st.route && st.tables === 0 ? ok("W: only the route (service role) calls the steps; no API role reads or writes the tables") : fail(`W: state ${JSON.stringify(st)}`);
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000023f001', 'keep@x');
    INSERT INTO public.account_deletions (user_id) VALUES ('00000000-0000-0000-0000-00000023f001');`);
  let refused = false;
  try { await db.exec(read("supabase/migrations/0023_account_deletion.down.sql")); } catch { refused = true; await db.exec("ROLLBACK").catch(() => {}); }
  refused ? ok("W: rollback refused while a deletion is unfinished") : fail("W: rollback ran with an unfinished deletion");
  await db.exec("DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-00000023f001'");
  await db.exec(read("supabase/migrations/0023_account_deletion.down.sql"));
  const after = (await db.query(`SELECT to_regclass('public.account_deletions') IS NULL AND to_regprocedure('public.account_deletion_begin(uuid)') IS NULL AS gone,
    position('account_deletions' IN pg_get_functiondef('public.cloud_sync_enabled()'::regprocedure)) = 0
      AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE '%account_deletion%') AS restored`)).rows[0];
  after.gone && after.restored ? ok("W: rollback removes 0023 and restores 0004's cloud_sync_enabled") : fail(`W: rollback ${JSON.stringify(after)}`);
  for (const t of ["journal_sync_rls", "journal_attachments_rls"]) {
    try { await db.exec(read(`supabase/tests/${t}.sql`)); ok(`W: tests/${t}.sql pass after the 0023 rollback`); }
    catch (e) { await db.exec("ROLLBACK").catch(() => {}); fail(`W: ${t} after rollback: ${e.message}`); }
  }
  await db.close();
}

// S. Supabase compatibility (found on the official supabase/postgres image, Q4.5-2): «GRANT <role> TO CURRENT_USER»
//    crashes the server process there (supautils, signal 11) — role grants must name the role (format(... %I, current_user))
{
  const dir = `${repo}supabase/migrations/`;
  const bad = readdirSync(dir).filter((f) => f.endsWith(".sql")).filter((f) => /GRANT\s+[a-z_"][\w"]*\s+TO\s+CURRENT_USER/i.test(readFileSync(dir + f, "utf8").replace(/--.*$/gm, "")));
  bad.length === 0 ? ok("S: no «GRANT <role> TO CURRENT_USER» in any migration (it crashes Supabase's server process)") : fail(`S: GRANT … TO CURRENT_USER in ${bad.join(", ")}`);
}
