import { beforeAll, afterAll, beforeEach, expect, test } from "vitest";
import pg from "pg";
import { A, asUser, installBaseline, readSql, seed } from "./watchlist-meta-sql-checks.mjs";
import { PriorityQueue, emptyPriorityAccount } from "../lib/market/priority-queue";

if (process.env.AYRA_TEST_DB_LOCAL_ONLY !== "1" || !["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST)) throw Error("Isolated loopback PostgreSQL required; production/env files are never used");
const config = { host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER || "postgres", password: process.env.PGPASSWORD || "", database: "postgres" };
const name = `ayra_priority_queue_${Date.now()}_${process.pid}`, admin = new pg.Client(config), clients = [];
let db, created = false, sequence = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
beforeAll(async () => {
  await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created = true;
  db = new pg.Client({ ...config, database: name });await db.connect();clients.push(db);
  await db.query(readSql("tests/stub/supabase_stub.sql"));await installBaseline(db);await seed(db);await db.query(readSql("migrations/0017_watchlist_meta.sql"));
});
beforeEach(async () => { await db.query("DELETE FROM public.market_user_data WHERE id='watchlist_meta'"); });
afterAll(async () => { await Promise.all(clients.map(c => c.end()));if (created) await admin.query(`DROP DATABASE "${name}"`);await admin.end(); });
async function device() {
  const c = new pg.Client({ ...config, database: name });await c.connect();clients.push(c);
  let record = emptyPriorityAccount(), online = true, lost = false, writes = 0;
  const remote = { currentUserId: async () => A, isSyncEnabled: async () => true,
    read: () => asUser(c, A, async connection => (await connection.query("SELECT data FROM public.market_user_data WHERE user_id=$1 AND id='watchlist_meta'", [A])).rows[0]?.data ?? null),
    create: async (_uid, data) => { writes++;try { const result = await asUser(c, A, async connection => (await connection.query("INSERT INTO public.market_user_data(user_id,id,data) VALUES($1,'watchlist_meta',$2) RETURNING data", [A, data])).rows[0]?.data ?? null);if (lost) { lost = false;throw TypeError("lost acknowledgement"); }return result; } catch (e) { if (e.code === "23505") return null;throw e; } },
    replace: async (_uid, revision, data) => { writes++;return asUser(c, A, async connection => (await connection.query("UPDATE public.market_user_data SET data=$3 WHERE user_id=$1 AND id='watchlist_meta' AND data->>'revision'=$2 RETURNING data", [A, String(revision), data])).rows[0]?.data ?? null); },
  };
  const store = { read: async () => structuredClone(record), update: async (_uid, change) => { record = change(structuredClone(record));return record; } };
  const queue = new PriorityQueue(A, remote, store, () => A, () => online, uuid);await queue.run();
  return { queue, remote, get record() { return record; }, get writes() { return writes; }, set online(value) { online = value; }, loseNextResponse() { lost = true; } };
}
test("real 0017/RLS: two device queues preserve different instruments", async () => {
  const a = await device(), b = await device();await Promise.all([a.queue.enqueue("eurusd", true), b.queue.enqueue("gold", true)]);
  expect(a.record.queue).toEqual([]);expect(b.record.queue).toEqual([]);
  const row = await a.remote.read();expect(Object.keys(row.entries).sort()).toEqual(["eurusd", "gold"]);expect(row.revision).toBe(2);
});
test("real same-instrument CAS conflict never overwrites automatically", async () => {
  const a = await device(), b = await device();b.online = false;await b.queue.enqueue("eurusd", false);await a.queue.enqueue("eurusd", true);b.online = true;await b.queue.run();
  expect(b.record.queue[0].status).toBe("conflict");expect((await b.remote.read()).entries.eurusd.priority).toBe(true);
  await b.queue.resolve("eurusd", true);expect((await b.remote.read()).entries.eurusd).toMatchObject({ priority: false, revision: 2 });
});
test("real lost response is idempotent; rapid outbox chain preserves final choice", async () => {
  const a = await device();a.loseNextResponse();await a.queue.enqueue("eurusd", true);expect(a.record.queue).toEqual([]);expect(a.writes).toBe(1);
  a.online = false;await a.queue.enqueue("eurusd", false);await a.queue.enqueue("eurusd", true);a.online = true;await a.queue.run();
  expect(a.record.queue).toEqual([]);expect((await a.remote.read()).entries.eurusd).toMatchObject({ priority: true, revision: 3 });
});
