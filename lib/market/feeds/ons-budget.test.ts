import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { withOnsSlot, type OnsBudget } from "./ons-budget";
import { onsTransport } from "./ons-http";

const budget = () => ({
  daily: vi.fn(), due: vi.fn(), reserve: vi.fn(async () => "token"),
  charge: vi.fn(async (): Promise<boolean> => true), finish: vi.fn(async () => {}),
}) satisfies OnsBudget;

afterEach(() => { vi.restoreAllMocks(); });

test("lost charge response and expired reservation send zero HTTP requests", async () => {
  const rpc = budget();
  const get = vi.fn(async () => "body");
  rpc.charge.mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce(false);
  await expect(withOnsSlot(rpc, "schedule", "upcoming", "daily", get, () => undefined)).rejects.toThrow("lost");
  expect(await withOnsSlot(rpc, "schedule", "upcoming", "daily", get, () => undefined)).toBeNull();
  expect(get).not.toHaveBeenCalled();
});

test("late acknowledgment consumes the slot without dispatch", async () => {
  const rpc = budget();
  const get = vi.fn(async () => "body");
  vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(5_001);
  expect(await withOnsSlot(rpc, "schedule", "upcoming", "daily", get, () => undefined)).toBeNull();
  expect(get).not.toHaveBeenCalled();
  expect(rpc.finish).toHaveBeenCalledWith("token");
});

test("failed HTTP response persists a pause and never replays the GET", async () => {
  const rpc = budget();
  const pause = "2026-11-15T00:05:00Z";
  const read = vi.fn(async () => { throw new Error("HTTP 429"); });
  await expect(withOnsSlot(rpc, "schedule", "upcoming", "daily", read, () => pause)).rejects.toThrow("HTTP 429");
  expect(read).toHaveBeenCalledTimes(1);
  expect(rpc.finish).toHaveBeenCalledWith("token", undefined, pause);
});

test("exhaustion and an unconfirmed write have distinct diagnostics", async () => {
  const rpc = budget();
  const read = vi.fn(async () => ({ id: "ons:gdp", actual: "0.2%", previous: null, status: "released" as const, summary: null }));
  rpc.reserve.mockResolvedValueOnce("exhausted");
  await expect(withOnsSlot(rpc, "fact", "ons:gdp", null, read, () => undefined)).rejects.toThrow("budget exhausted; no GET sent");
  expect(read).not.toHaveBeenCalled();
  rpc.finish.mockRejectedValueOnce(new Error("provenance conflict"));
  await expect(withOnsSlot(rpc, "fact", "ons:gdp", null, read, () => undefined)).rejects.toThrow("GET sent; result write not confirmed: provenance conflict");
  expect(read).toHaveBeenCalledTimes(1);
});

test.skipIf(!process.env.ONS_TEST_PG_MODULE)("real PostgreSQL connections share five HTTP GETs", async () => {
  const { Pool } = createRequire(import.meta.url)(process.env.ONS_TEST_PG_MODULE!);
  const admin = new Pool({ host: "127.0.0.1", port: Number(process.env.ONS_TEST_PG_PORT), user: "postgres" });
  const database = "ons_test_" + crypto.randomUUID().replaceAll("-", "");
  let db: typeof admin | undefined;
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.method + " " + req.url);
    res.writeHead(302, { Location: "/unexpected-follow" }).end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await admin.query("CREATE DATABASE " + database);
    db = new Pool({ host: "127.0.0.1", port: Number(process.env.ONS_TEST_PG_PORT), user: "postgres", database, max: 16 });
    await db.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$`);
    await db.query(`CREATE TABLE public.test_clock(at timestamptz);
      INSERT INTO public.test_clock VALUES ('2026-11-14 06:10:00Z');
      CREATE FUNCTION public.test_now() RETURNS timestamptz LANGUAGE sql AS
        'SELECT at FROM public.test_clock';
      GRANT SELECT ON public.test_clock TO service_role;`);
    for (const file of [
      "migrations/0009_market_feeds.sql", "migrations/0010_market_feeds_sources.sql",
      "migrations/0012_market_event_integrity.sql", "review/0014_ons_request_budget.sql",
    ]) {
      const sql = readFileSync("supabase/" + file, "utf8");
      await db.query(file.startsWith("review/") ? sql.replaceAll("clock_timestamp()", "public.test_now()") : sql);
    }
    const call = async (expression: string, args: unknown[] = []) => {
      const connection = await db.connect();
      try {
        await connection.query("SET ROLE service_role");
        return (await connection.query("SELECT " + expression + " AS value", args)).rows[0].value;
      } finally { connection.release(); }
    };
    const owners = (await Promise.all(Array.from({ length: 12 }, () => call("public.ons_daily()")))).filter(Boolean);
    expect(owners).toHaveLength(1);
    const owner = owners[0];
    const rpc: OnsBudget = {
      daily: async () => null,
      due: async () => [],
      reserve: (kind, target, daily) => call("public.ons_reserve_slot($1,$2,$3)", [kind, target, daily]),
      charge: token => call("public.ons_charge_slot($1)", [token]),
      finish: async token => { await call("public.ons_finish_slot($1,NULL,NULL)", [token]); },
    };
    const unused = await rpc.reserve("schedule", "expired", owner);
    expect(unused).toBeTruthy();
    await db.query("RESET ROLE");
    await db.query("UPDATE ons_internal.slots SET reserved_until=public.test_now()-interval '1 second' WHERE token=$1", [unused]);
    expect(await rpc.charge(unused!)).toBe(false);
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("missing test server");
    const origin = "http://127.0.0.1:" + addr.port;
    const transport = onsTransport(origin);
    const read = async (path: string) => {
      const res = await transport(origin + "/" + path);
      expect(res.status).toBe(302);
      return path;
    };
    const elapsed = performance.now();
    const attempt = (kind: "schedule" | "move", target: string, path: string) =>
      withOnsSlot(rpc, kind, target, owner, () => read(path), () => undefined).catch(error => {
        expect(error.message).toBe("daily request budget exhausted; no GET sent");
      });
    await Promise.all(Array.from({ length: 12 }, (_, i) =>
      attempt("schedule", "schedule-" + i, "schedule")));
    for (let round = 0; round < 3; round++) {
      await Promise.all(Array.from({ length: 8 }, (_, i) =>
        attempt("move", `move-${round}-${i}`, "detail")));
    }
    expect(hits).toEqual(["GET /schedule", "GET /schedule", "GET /schedule", "GET /detail", "GET /detail"]);
    console.info("ONS PostgreSQL + HTTP:", hits.length, "GET,", Math.round(performance.now() - elapsed), "ms");
    await db.query("RESET ROLE");
    const acl = await db.query(`SELECT has_function_privilege('anon','public.ons_charge_slot(uuid)','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.ons_charge_slot(uuid)','EXECUTE') AS authenticated`);
    expect(acl.rows[0]).toEqual({ anon: false, authenticated: false });
    async function at(value: string) {
      await db.query("RESET ROLE");
      await db.query("UPDATE public.test_clock SET at=$1", [value]);
    }
    await at("2026-11-15 23:59:00Z");
    const nextOwner = await call("public.ons_daily()");
    const spent = await rpc.reserve("schedule", "crash", nextOwner);
    expect(await rpc.charge(spent!)).toBe(true);
    await at("2026-11-15 23:59:20Z");
    const midnightToken = await rpc.reserve("schedule", "midnight", nextOwner);
    await at("2026-11-15 23:59:35Z");
    expect(await rpc.charge(midnightToken!)).toBe(false);
    await call("public.ons_finish_slot($1,NULL,$2)", [spent, "2026-11-16 00:05:00Z"]);
    await at("2026-11-16 00:01:00Z");
    const nextDay = await call("public.ons_daily()");
    expect(await rpc.reserve("schedule", "upcoming", nextDay)).toBeNull();
    expect(await rpc.charge(spent!)).toBe(false);
    await at("2026-11-16 06:00:00Z");
    const daily = await call("public.ons_daily()");
    expect(daily).toBeNull(); // this UTC day already attempted reconciliation
    await at("2026-11-17 06:00:00Z");
    const fresh = await call("public.ons_daily()");
    const id = "ons:gb_gdp_monthly:2026-09";
    const starts = "2026-11-17T06:10:00Z";
    await db.query("RESET ROLE");
    await db.query(`INSERT INTO public.market_events
      (id,source,country,kind,code,title,importance,starts_at,reference_period,release_stage,source_uid)
      VALUES ($1,'ons','gb','release','gb_gdp_monthly','GDP',3,$2,'2026-09','regular','/releases/test')`, [id, starts]);
    await call("public.ons_daily($1,true)", [fresh]);
    const reserveFact = () => call("public.ons_reserve_slot('fact',$1,NULL,$2)", [id, starts]);
    expect(await reserveFact()).toBeNull();
    await at(starts);
    const fact = await reserveFact();
    expect(await rpc.charge(fact)).toBe(true);
    await at("2026-11-17 06:10:45Z"); // reservation expired; completion remains valid
    const result = { id, actual: "+0.2%", previous: "0.0%", reference_period: "2026-09", release_stage: "regular",
      result_meta: { period: "2026-09", series: "ECYX", unit: "percent-mom", adjustment: "SA" } };
    const finish = () => call("public.ons_finish_slot($1,$2,NULL)", [fact, result]);
    expect(await finish()).toBe("saved");
    expect(await finish()).toBe("saved");
    expect(await reserveFact()).toBeNull();
    const saved = await db.query("SELECT id,status,actual,previous FROM public.market_events WHERE id=$1", [id]);
    expect(saved.rows).toEqual([{ id, status: "released", actual: "+0.2%", previous: "0.0%" }]);
    const movedId = "ons:gb_gdp_first:2026-q3";
    await db.query("RESET ROLE");
    await db.query(`INSERT INTO public.market_events
      (id,source,country,kind,code,title,importance,starts_at,reference_period,release_stage,source_uid)
      VALUES ($1,'ons','gb','release','gb_gdp_first','GDP',3,$2,'2026-Q3','preliminary','/releases/test')`, [movedId, starts]);
    const moved = await call("public.ons_reserve_slot('fact',$1,NULL,$2)", [movedId, starts]);
    expect(await rpc.charge(moved)).toBe(true);
    await db.query("UPDATE public.market_events SET starts_at=starts_at+interval '1 hour' WHERE id=$1", [movedId]);
    expect(await call("public.ons_finish_slot($1,$2,NULL)", [moved, { ...result, id: movedId }])).toBe("release changed during verification");
  } finally {
    await db?.end();
    await admin.query("DROP DATABASE IF EXISTS " + database);
    await admin.end();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}, 30_000);
