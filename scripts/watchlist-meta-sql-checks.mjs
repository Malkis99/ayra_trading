// Shared by PGlite migration checks and isolated real PostgreSQL. Never import into the application.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
export const readSql = name => readFileSync(new URL(`../supabase/${name}`, import.meta.url), "utf8").replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/, "");
export const A = "00000000-0000-0000-0000-0000000b1701";
export const B = "00000000-0000-0000-0000-0000000b1702";
export const C = "00000000-0000-0000-0000-0000000b1703";
export const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
export const document = (revision = 1, entries = {}) => ({ id: "watchlist_meta", version: 1, revision, entries });
export const entry = (priority, revision, n) => ({ priority, revision, operationId: uuid(n) });
export const baseline = ["0001_init", "0002_profile_defaults", "0003_nickname_cooldown", "0004_journal_sync", "0008_market_sync"];
export async function installBaseline(db) { for (const name of baseline) await db.query(readSql(`migrations/${name}.sql`)); }
export async function seed(db) {
  await db.query(`INSERT INTO auth.users(id,email) VALUES ($1,'meta-a@test.invalid'),($2,'meta-b@test.invalid'),($3,'meta-off@test.invalid')`, [A, B, C]);
  await db.query(`INSERT INTO public.user_features(user_id,cloud_sync) VALUES ($1,true),($2,true),($3,false) ON CONFLICT(user_id) DO UPDATE SET cloud_sync=excluded.cloud_sync`, [A, B, C]);
  await db.query(`INSERT INTO public.market_user_data(user_id,id,data,device_id) VALUES
    ($1,'watchlist','{"id":"watchlist","ids":["eurusd","btc"],"updatedAt":"2026-01-01T00:00:00Z"}','legacy'),
    ($1,'chart_view','{"id":"chart_view","instrument":"btc","updatedAt":"2026-01-01T00:00:00Z"}',NULL),
    ($1,'note:btc','{"id":"note:btc","text":"keep","updatedAt":"2026-01-01T00:00:00Z","deletedAt":"2026-01-01T00:00:00Z"}',NULL)`, [A]);
}
export const snapshot = async db => (await db.query("SELECT row_to_json(t) AS row FROM public.market_user_data t ORDER BY user_id,id")).rows;
export async function asUser(db, user, action, role = "authenticated") {
  await db.query("BEGIN");
  try {
    await db.query(`SET LOCAL ROLE ${role}`); // fixed test role, never user input
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user ?? ""]);
    const result = await action(db);
    await db.query("COMMIT"); return result;
  } catch (e) { await db.query("ROLLBACK"); throw e; }
}
export const createMeta = (db, user, data) => db.query("INSERT INTO public.market_user_data(user_id,id,data) VALUES($1,'watchlist_meta',$2::jsonb) RETURNING data", [user, JSON.stringify(data)]);
export const cas = (db, user, revision, data) => db.query("UPDATE public.market_user_data SET data=$3::jsonb WHERE user_id=$1 AND id='watchlist_meta' AND data->>'revision'=$2 RETURNING data", [user, String(revision), JSON.stringify(data)]);
export const readMeta = async (db, user) => (await db.query("SELECT data FROM public.market_user_data WHERE user_id=$1 AND id='watchlist_meta'", [user])).rows[0]?.data ?? null;

/** Real database permission checks (no mocked RLS). Every forbidden command rolls back its own transaction. */
export async function runMetaChecks(db, log = console.log) {
  const deny = async (user, sql, args = [], pattern = /permission denied|row-level security|market_meta_|check constraint|market_row_/) => {
    await assert.rejects(asUser(db, user, c => c.query(sql, args)), pattern);
  };
  const first = document(1, { eurusd: { ...entry(false, 1, 1), extension: { keep: true } }, futureasset: entry(false, 1, 9) });
  first.extension = { opaque: "preserve" }; first.updatedAt = "2999-01-01T00:00:00Z";
  const saved = (await asUser(db, A, c => createMeta(c, A, first))).rows[0].data;
  assert.notEqual(saved.updatedAt, first.updatedAt);
  assert.ok(Math.abs(Date.now() - Date.parse(saved.updatedAt)) < 60_000);
  const times = (await db.query("SELECT updated_at=client_updated_at AND updated_at=(data->>'updatedAt')::timestamptz AS same FROM public.market_user_data WHERE id='watchlist_meta'")).rows[0];
  assert.equal(times.same, true);
  log("PASS metadata server timestamp, explicit false, opaque/future instrument");

  assert.equal(await asUser(db, B, c => readMeta(c, A)), null);
  assert.equal((await asUser(db, B, c => cas(c, A, 1, saved))).rows.length, 0);
  await deny(B, "INSERT INTO public.market_user_data(user_id,id,data) VALUES($1,'watchlist_meta',$2)", [A, saved]);
  await deny(C, "INSERT INTO public.market_user_data(user_id,id,data) VALUES($1,'watchlist_meta',$2)", [C, document()]);
  await assert.rejects(asUser(db, null, c => c.query("SELECT * FROM public.market_user_data"), "anon"), /permission denied/);
  for (const column of ["updated_at", "client_updated_at", "deleted_at"]) await deny(A, `UPDATE public.market_user_data SET ${column}=now() WHERE id='watchlist_meta'`);
  await deny(A, "DELETE FROM public.market_user_data WHERE id='watchlist_meta'");
  log("PASS RLS A/B/anon, cloud_sync=false, forbidden server columns and DELETE");

  const next = structuredClone(saved); next.revision = 2;
  next.entries.eurusd = { ...next.entries.eurusd, ...entry(true, 2, 2) };
  const expectInvalid = data => assert.rejects(asUser(db, A, c => cas(c, A, 1, data)), /market_meta_|check constraint/);
  for (const mutate of [
    d => delete d.entries.futureasset,
    d => delete d.extension,
    d => delete d.entries.eurusd.extension,
    d => d.entries.eurusd.revision = 8,
    d => d.entries.eurusd.operationId = uuid(1),
    d => d.entries.eurusd.priority = "true",
    d => d.entries.eurusd.operationId = uuid(9),
    d => d.entries.eurusd.coins = 1,
    d => d.version = 2,
    d => d.revision = 1,
    d => d.deletedAt = "2026-01-01T00:00:00Z",
  ]) { const invalid = structuredClone(next); mutate(invalid); await expectInvalid(invalid); }
  const oversized = structuredClone(next); oversized.large = "я".repeat(9000);
  await expectInvalid(oversized);
  assert.equal((await readMeta(db, A)).revision, 1);
  const second = (await asUser(db, A, c => cas(c, A, 1, next))).rows[0].data;
  assert.equal(second.entries.futureasset.priority, false);
  assert.deepEqual(second.extension, saved.extension);
  assert.equal((await asUser(db, A, c => cas(c, A, 1, next))).rows.length, 0);
  await db.query("UPDATE public.user_features SET cloud_sync=false WHERE user_id=$1", [A]);
  const third = structuredClone(second); third.revision = 3; third.entries.eurusd = { ...third.entries.eurusd, ...entry(false, 3, 3) };
  await assert.rejects(asUser(db, A, c => cas(c, A, 2, third)), /row-level security/);
  await db.query("UPDATE public.user_features SET cloud_sync=true WHERE user_id=$1", [A]);
  log("PASS 16 KiB UTF-8, immutable extensions, per-entry/top revisions, stale CAS=0, sync-off update");

  const legacyBefore = (await db.query("SELECT data FROM public.market_user_data WHERE id='watchlist' AND user_id=$1", [A])).rows[0].data;
  const old = { ...legacyBefore, ids: ["gold"], updatedAt: "2025-01-01T00:00:00Z" };
  assert.equal((await asUser(db, A, c => c.query("UPDATE public.market_user_data SET data=$1 WHERE user_id=$2 AND id='watchlist' RETURNING data", [old, A]))).rows.length, 0);
  assert.deepEqual((await db.query("SELECT data FROM public.market_user_data WHERE id='watchlist' AND user_id=$1", [A])).rows[0].data, legacyBefore);
  // The actual old-client upsert changes only its known row; it cannot erase the metadata.
  const legacyNew = { ...legacyBefore, ids: ["eurusd"], updatedAt: "2026-01-02T00:00:00Z" };
  await asUser(db, A, c => c.query("INSERT INTO public.market_user_data(user_id,id,data) VALUES($1,'watchlist',$2) ON CONFLICT(user_id,id) DO UPDATE SET data=excluded.data", [A, legacyNew]));
  assert.deepEqual(await readMeta(db, A), second);
  log("PASS legacy timestamp/upsert and separate metadata remain compatible");

  // No broad grants, replacement function retains INVOKER; existing policies are unchanged by 0017.
  const rights = (await db.query(`SELECT
    has_table_privilege('anon','public.market_user_data','SELECT') AS anon,
    has_table_privilege('authenticated','public.market_user_data','DELETE') AS del,
    has_column_privilege('authenticated','public.market_user_data','updated_at','UPDATE') AS server,
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.market_user_data'::regclass) AS rls,
    (SELECT prosecdef FROM pg_proc WHERE oid='public.market_row_before_write()'::regprocedure) AS definer`)).rows[0];
  assert.deepEqual(rights, { anon: false, del: false, server: false, rls: true, definer: false });
  try { await db.query(readSql("migrations/0017_watchlist_meta.down.sql")); assert.fail("rollback discarded metadata"); }
  catch (e) { await db.query("ROLLBACK"); assert.match(e.message, /market_meta_rollback_requires_preservation/); }
  assert.deepEqual(await readMeta(db, A), second);
  // Cleanup belongs only to the disposable test database, using its administrator.
  await db.query("DELETE FROM public.market_user_data WHERE id='watchlist_meta'");
  await db.query(readSql("migrations/0017_watchlist_meta.down.sql"));
  assert.equal((await db.query("SELECT count(*)::int n FROM public.market_user_data")).rows[0].n, 3);
  await db.query(readSql("migrations/0017_watchlist_meta.sql"));
  log("PASS grants/INVOKER, data-preserving rollback refusal, empty rollback/reapply");
}
