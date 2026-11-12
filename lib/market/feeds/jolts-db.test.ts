// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { joltsResults, parseJoltsRelease } from "./jolts";
import { listedEvents } from "./schedules";
import { scheduleIdentity } from "./identity";

it("0012 preserves legacy JOLTS provenance and stores a new initial release on its existing ID", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
    for (const name of ["0009_market_feeds", "0010_market_feeds_sources", "0012_market_event_integrity"]) {
      await db.exec(readFileSync("supabase/migrations/" + name + ".sql", "utf8"));
    }
    const september = listedEvents().find(e => e.id === "bls:us_jolts:2026-11-03")!;
    const august = scheduleIdentity({...september, id: "bls:us_jolts:2026-09-29", starts_at: "2026-09-29T14:00Z"}, "2026-08", "regular");
    const apply = async (rows: unknown[], mode: string) => (await db.query<{result: {id?: string; conflict?: string}[]}>(
      "SELECT market_events_apply($1::jsonb,$2) AS result", [JSON.stringify(rows), mode],
    )).rows[0].result;
    await db.query("INSERT INTO market_events(id,source,country,kind,code,title,importance,starts_at,hidden) VALUES ($1,'bls','us','release','us_jolts',$2,2,$3,true)", [august.id, august.title, august.starts_at]);
    expect(await apply([august, september], "schedule")).toEqual([{id: august.id}, {id: september.id}]);
    const legacy = {period: "2026-09", series: "us_jolts", unit: "million", adjustment: "SA"};
    await apply([{id: september.id, actual: "7.52M", previous: "7.19M", result_meta: legacy}], "result");
    const result = (day: string, event: typeof september) => joltsResults([event], parseJoltsRelease(
      readFileSync("lib/market/feeds/fixtures/jolts-" + day + ".html", "utf8"), day,
    ));
    expect(await apply(result("2026-11-03", september), "result")).toEqual([{id: september.id, conflict: "series units or period changed"}]);
    const initial = result("2026-09-29", august);
    expect(await apply(initial, "result")).toEqual([{id: august.id}]);
    expect(await apply(initial, "result")).toEqual([{id: august.id}]);
    const stored = (await db.query("SELECT id,hidden,actual,previous,result_meta FROM market_events ORDER BY starts_at")).rows;
    expect(stored).toEqual([
      {id: august.id, hidden: true, actual: "7.079M", previous: "7.335M", result_meta: initial[0].result_meta},
      {id: september.id, hidden: false, actual: "7.52M", previous: "7.19M", result_meta: legacy},
    ]);
  } finally {
    await db.close();
  }
}, 30_000);
