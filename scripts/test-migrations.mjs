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
