// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { cpiResults, parseCpiRelease } from "./cpi";
import { scheduleIdentity } from "./identity";

it("0012 preserves legacy CPI IDs/values and stores the dated release provenance idempotently", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
    for (const name of ["0009_market_feeds", "0010_market_feeds_sources", "0012_market_event_integrity"]) await db.exec(readFileSync(`supabase/migrations/${name}.sql`, "utf8"));
    const row = scheduleIdentity({ id: "bls:us_cpi:2026-10-14", source: "bls", country: "us", kind: "release", code: "us_cpi", title: "Consumer Price Index", importance: 3, starts_at: "2026-10-14T12:30:00Z", time_tbd: false, url: null }, "2026-09", "regular", null, { sequence: 0 });
    await db.query("INSERT INTO market_events(id,source,country,kind,code,title,importance,starts_at) VALUES ($1,'bls','us','release','us_cpi','Consumer Price Index',3,$2)", [row.id, row.starts_at]);
    const apply = async (rows: unknown[], mode: string) => (await db.query<{ result: { conflict?: string }[] }>("SELECT market_events_apply($1::jsonb,$2) AS result", [JSON.stringify(rows), mode])).rows[0].result;
    expect(await apply([row], "schedule")).toEqual([{ id: row.id }]);
    const release = parseCpiRelease(readFileSync("lib/market/feeds/fixtures/cpi-2026-10-14.html", "utf8"), "2026-10-14");
    const result = cpiResults([row], release)[0];
    expect(await apply([result], "result")).toEqual([{ id: row.id }]);
    expect(await apply([result], "result")).toEqual([{ id: row.id }]);
    const stored = (await db.query("SELECT id,actual,previous,result_meta FROM market_events")).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: row.id, actual: "+0.6%", previous: "+0.4%", result_meta: result.result_meta });
    expect((await apply([{ ...result, actual: "+9.9%" }], "result"))[0].conflict).toBe("result freshness unproven");
    expect((await db.query<{ actual: string }>("SELECT actual FROM market_events")).rows[0].actual).toBe("+0.6%");
  } finally { await db.close(); }
}, 30_000);
