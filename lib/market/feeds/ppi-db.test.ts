// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { parsePpiRelease, ppiResults } from "./ppi";
import { ppiSchedule } from "./bls-schedule";
import { scheduleIdentity } from "./identity";

it("0012 preserves legacy PPI history and persists four distinct initial facts/provenance without a migration", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
    for (const name of ["0009_market_feeds","0010_market_feeds_sources","0012_market_event_integrity"]) await db.exec(readFileSync(`supabase/migrations/${name}.sql`,"utf8"));
    const rows = ppiSchedule(readFileSync("lib/market/feeds/fixtures/ppi-schedule-2026-11-06.html","utf8")).slice(0,4).map(e=>scheduleIdentity({...e,id:e.id.replace("2026-11-13","2026-10-15"),starts_at:"2026-10-15T12:30Z"},"2026-09","regular",null,{}));
    await db.query("INSERT INTO market_events(id,source,country,kind,code,title,importance,starts_at,hidden) VALUES ($1,'bls','us','release','us_ppi','Producer Price Index',2,$2,true)",[rows[0].id,rows[0].starts_at]);
    const apply = async (rows:unknown[],mode:string) => (await db.query<{result:{id?:string;conflict?:string}[]}>("SELECT market_events_apply($1::jsonb,$2) AS result",[JSON.stringify(rows),mode])).rows[0].result;
    expect((await apply(rows,"schedule")).every(r=>!r.conflict)).toBe(true);
    const results = ppiResults(rows,parsePpiRelease(readFileSync("lib/market/feeds/fixtures/ppi-2026-10-15.html","utf8"),"2026-10-15"));
    expect((await apply(results,"result")).every(r=>!r.conflict)).toBe(true);
    expect((await apply(results,"result")).every(r=>!r.conflict)).toBe(true);
    const stored = (await db.query<{id:string;actual:string;hidden:boolean;result_meta:unknown}>("SELECT id,actual,hidden,result_meta FROM market_events ORDER BY id")).rows;
    expect(stored).toHaveLength(4);
    expect(stored.find(e=>e.id===rows[0].id)).toMatchObject({actual:"+1.3%",hidden:true,result_meta:results[0].result_meta});
    expect((await apply([{...results[0],actual:"+1.4%"}],"result"))[0].conflict).toBe("result freshness unproven");
    expect((await apply([{...results[0],actual:null,previous:null}],"result"))[0].conflict).toBeUndefined();
    expect((await db.query<{actual:string}>("SELECT actual FROM market_events WHERE id=$1",[rows[0].id])).rows[0].actual).toBe("+1.3%");
  } finally { await db.close(); }
},30_000);
