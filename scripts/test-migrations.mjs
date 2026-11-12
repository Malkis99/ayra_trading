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
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
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
    name text NOT NULL, owner uuid, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
    UNIQUE (bucket_id, name));
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  GRANT USAGE ON SCHEMA storage TO anon, authenticated;
  GRANT SELECT ON storage.buckets TO anon, authenticated;
  GRANT ALL ON storage.objects TO anon, authenticated;`;
async function fresh() { const db = new PGlite(); await db.exec(STUB); await db.exec(STORAGE_STUB); return db; }
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
