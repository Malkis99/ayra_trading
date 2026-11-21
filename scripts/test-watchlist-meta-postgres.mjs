// Isolated database ONLY. Creates and removes its own uniquely named DB; never loads .env or DATABASE_URL.
import assert from "node:assert/strict";
import pg from "pg";
import { A, B, asUser, baseline, cas, createMeta, document, entry, installBaseline, readMeta, readSql, runMetaChecks, seed, snapshot } from "./watchlist-meta-sql-checks.mjs";

if (process.env.AYRA_TEST_DB_LOCAL_ONLY !== "1" || !["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST)) throw new Error("Explicit isolated loopback PostgreSQL required");
const config = { host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER || "postgres", password: process.env.PGPASSWORD || "", database: "postgres", connectionTimeoutMillis: 5000 };
const name = `ayra_watch_meta_${Date.now()}_${process.pid}`;
const admin = new pg.Client(config); const clients = [];
let created = false;
async function connection() { const c = new pg.Client({ ...config, database: name }); await c.connect(); clients.push(c); return c; }
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  const db = await connection();
  console.log((await db.query("SELECT version() v")).rows[0].v);
  await db.query(readSql("tests/stub/supabase_stub.sql"));
  await installBaseline(db); await seed(db);
  const before = await snapshot(db);
  const policies = (await db.query("SELECT policyname,cmd,qual,with_check FROM pg_policies WHERE tablename='market_user_data' ORDER BY policyname")).rows;
  const acl = (await db.query("SELECT relacl::text acl FROM pg_class WHERE oid='public.market_user_data'::regclass")).rows;
  const functionAcl = (await db.query("SELECT proacl::text acl FROM pg_proc WHERE oid='public.market_row_before_write()'::regprocedure")).rows;
  for (let i = 0; i < 2; i++) await db.query(readSql("migrations/0017_watchlist_meta.sql"));
  assert.deepEqual(await snapshot(db), before);
  assert.deepEqual((await db.query("SELECT policyname,cmd,qual,with_check FROM pg_policies WHERE tablename='market_user_data' ORDER BY policyname")).rows, policies);
  assert.deepEqual((await db.query("SELECT relacl::text acl FROM pg_class WHERE oid='public.market_user_data'::regclass")).rows, acl);
  assert.deepEqual((await db.query("SELECT proacl::text acl FROM pg_proc WHERE oid='public.market_row_before_write()'::regprocedure")).rows, functionAcl);
  console.log("PASS migration twice: every existing row/column, policies and ACL unchanged");
  await runMetaChecks(db);
  const sessions = await Promise.all(Array.from({ length: 20 }, connection));
  const initial = document(1, { eurusd: entry(true, 1, 100) });
  const creates = await Promise.all(sessions.map((c, i) => asUser(c, A, c => createMeta(c, A, document(1, { eurusd: entry(true, 1, 100 + i) }))).then(() => "created", e => e.code)));
  assert.equal(creates.filter(x => x === "created").length, 1);
  assert.equal(creates.filter(x => x === "23505").length, 19);
  console.log("PASS 20 concurrent first inserts: 1 created, 19 unique conflicts");

  let current = await readMeta(db, A);
  const outcomes = await Promise.all(sessions.map((c, i) => {
    const next = structuredClone(current); next.revision++;
    next.entries.eurusd = entry(false, 2, 200 + i);
    return asUser(c, A, c => cas(c, A, 1, next)).then(r => r.rows.length);
  }));
  assert.equal(outcomes.reduce((a, b) => a + b, 0), 1);
  assert.equal((await readMeta(db, A)).revision, 2);
  console.log("PASS 20 concurrent same-revision UPDATEs: 1 confirmed, 19 zero-row conflicts");

  // Different instruments use bounded read/rebase. Same-instrument changes never silently rebase.
  let conflicts = 0;
  async function change(client, instrument, opId) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await asUser(client, A, async c => {
        const old = await readMeta(c, A);
        const previous = old.entries[instrument];
        if (previous?.operationId === entry(true, 1, opId).operationId) return "replayed";
        if (previous) return "entry-conflict";
        const next = { ...old, revision: old.revision + 1, entries: { ...old.entries, [instrument]: entry(true, 1, opId) } };
        return (await cas(c, A, old.revision, next)).rows.length ? "saved" : "retry";
      });
      if (result !== "retry") return result;
      conflicts++;
    }
    return "pending";
  }
  const results = await Promise.all([change(sessions[0], "gbpusd", 300), change(sessions[1], "usdjpy", 301)]);
  assert.deepEqual(results, ["saved", "saved"]);
  current = await readMeta(db, A);
  assert.equal(current.revision, 4);
  assert.equal(current.entries.gbpusd.priority, true); assert.equal(current.entries.usdjpy.priority, true);
  // Simulated lost acknowledgement: discard the successful result and retry the same operation.
  assert.equal(await change(sessions[0], "gbpusd", 300), "replayed");
  assert.equal((await readMeta(db, A)).revision, 4);
  console.log(`PASS independent instruments rebase (CAS conflicts=${conflicts}), lost response retry does not increment revision`);

  for (const [revision, priority, opId] of [[5, true, 400], [6, false, 401]]) {
    const old = await readMeta(db, A);
    const next = { ...old, revision, entries: { ...old.entries, eurusd: entry(priority, revision - 2, opId) } };
    assert.equal((await asUser(sessions[0], A, c => cas(c, A, revision - 1, next))).rows.length, 1);
  }
  assert.equal((await readMeta(db, A)).entries.eurusd.priority, false);
  assert.equal((await asUser(sessions[1], A, c => cas(c, A, 4, initial))).rows.length, 0);
  assert.equal(await asUser(sessions[2], B, c => readMeta(c, A)), null);
  console.log("PASS rapid true→false, obsolete request=0 rows, account B cannot read A");
  // The old 0008 SQL tests also execute on top of 0017, in their own rollback transaction.
  await db.query(readSql("tests/market_sync_rls.sql"));
  console.log(`PASS old Market RLS suite; baseline migrations=${baseline.join(",")}`);
} finally {
  await Promise.all(clients.map(c => c.end().catch(() => {})));
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
