// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { collectFeeds, type Fetcher } from "./collect";
import { memoryFeedsDb } from "./memory-db";
import { onsCalendarUrl, onsMoveSequence, onsSchedules } from "./ons-gdp";

const now = Date.parse("2026-11-12T14:00:00Z");
const upcoming = readFileSync("lib/market/feeds/fixtures/ons-gdp-upcoming.html", "utf8");
const published = readFileSync("lib/market/feeds/fixtures/ons-gdp-published.html", "utf8");
const monthlyId = "ons:gb_gdp_monthly:2026-10";
const monthlyUrl = "https://www.ons.gov.uk/releases/gdpmonthlyestimateukoctober2026";
const empty = '<h1>Release calendar</h1><div class="ons-pagination__position">Page 1 of 1</div>';
const moved = upcoming.replaceAll('20261211', '20261214').replaceAll('11 December 2026', '14 December 2026');
const notice = `<script>dataLayer.push({"contentTitle": "GDP monthly estimate, UK: October 2026"});</script>
<span>Release date:</span><span>14 December 2026 7:00am</span>
<section id="changestothisreleasedate"><h3>Previous date</h3><p>11 December 2026 7:00am</p>
<h3>Reason for change</h3><p>Synthetic schedule-change fixture.</p></section>`;

function source(overrides: Partial<Record<"upcoming" | "published" | "cancelled" | "detail", string>> = {}, outage?: number) {
  const calls: string[] = [];
  const fetch: Fetcher = async url => {
    const parsed = new URL(url);
    const list = parsed.searchParams.get("release-type")?.replace("type-", "") as "upcoming" | "published" | "cancelled" | undefined;
    if (parsed.hostname !== "www.ons.gov.uk") return { ok: false, status: 503, text: async () => "" };
    calls.push(url);
    if (outage && list === "upcoming") return { ok: false, status: outage, text: async () => "" };
    const body = list ? overrides[list] ?? { upcoming, published, cancelled: empty }[list] : overrides.detail ?? "";
    return { ok: true, status: 200, text: async () => body };
  };
  return { calls, fetch };
}

describe("ONS GDP official calendar", () => {
  it("reads confirmed dates, deduplicates time-series entries, separates stages and applies London DST", () => {
    const future = onsSchedules(upcoming, "upcoming", now);
    expect(future).toHaveLength(4);
    expect(future.map(r => [r.id, r.reference_period, r.release_stage, r.starts_at, r.importance])).toEqual(expect.arrayContaining([
      [monthlyId, "2026-10", "regular", "2026-12-11T07:00:00.000Z", 3],
      ["ons:gb_gdp_qna:2026-q3", "2026-Q3", "revision", "2026-12-22T07:00:00.000Z", 2],
      ["ons:gb_gdp_first:2027-q1", "2027-Q1", "preliminary", "2027-05-14T06:00:00.000Z", 3],
    ]));
    const recent = onsSchedules(published, "published", now);
    expect(recent.map(r => r.id).sort()).toEqual(["ons:gb_gdp_first:2026-q3", "ons:gb_gdp_monthly:2026-09"]);
    expect(recent.every(r => r.starts_at === "2026-11-12T07:00:00.000Z")).toBe(true);
    expect(onsCalendarUrl("published", now)).toContain("after-day=29");
    expect(onsSchedules(upcoming.replaceAll("Confirmed", "Provisional"), "upcoming", now)).toEqual([]);
    expect(() => onsSchedules(upcoming.replace("Page 1 of 1", "Page 1 of 2"), "upcoming", now)).toThrow("incomplete");
    expect(() => onsSchedules(upcoming.replaceAll('data-gtm-release-time="07:00"', 'data-gtm-release-time="07:01"'), "upcoming", now)).toThrow("unverified");
  });

  it("only writes schedules, skips duplicate daily requests, applies a verified move and retains old identity", async () => {
    const { db, events } = memoryFeedsDb();
    const original = source();
    await collectFeeds({ db, fetch: original.fetch, now, scope: "schedules" });
    await collectFeeds({ db, fetch: original.fetch, now: now + 60_000, scope: "schedules" });
    expect(original.calls).toHaveLength(3);
    const old = events.get(monthlyId)!;
    expect(old).toMatchObject({ status: "scheduled", starts_at: "2026-12-11T07:00:00.000Z" });
    expect(old.actual).toBeUndefined();
    expect(old.previous).toBeUndefined();
    const next = source({ upcoming: moved, detail: notice });
    await collectFeeds({ db, fetch: next.fetch, now: now + 86_400_000, scope: "schedules" });
    expect(next.calls.filter(url => url === monthlyUrl)).toHaveLength(1);
    expect(events.get(monthlyId)).toMatchObject({ identity_key: old.identity_key, starts_at: "2026-12-14T07:00:00.000Z", schedule_meta: { sequence: 2 } });
    expect(Array.from(events.values()).filter(e => e.source_uid === old.source_uid)).toHaveLength(1);
    const changedPath = source({ upcoming: moved.replaceAll('gdpmonthlyestimateukoctober2026"', 'gdpmonthlyestimateukoctober2026-v2"') });
    await collectFeeds({ db, fetch: changedPath.fetch, now: now + 2 * 86_400_000, scope: "schedules" });
    expect(events.get(monthlyId)?.source_uid).toBe(old.source_uid);
    expect(changedPath.calls).toHaveLength(3);
  });

  it("keeps dates on missing evidence and only cancels an explicit matching official record", async () => {
    const { db, events, runs } = memoryFeedsDb();
    await collectFeeds({ db, fetch: source().fetch, now, scope: "schedules" });
    await collectFeeds({ db, fetch: source({ upcoming: moved, detail: notice.replace("11 December", "10 December") }).fetch, now: now + 86_400_000, scope: "schedules" });
    expect(events.get(monthlyId)?.starts_at).toBe("2026-12-11T07:00:00.000Z");
    expect(runs.find(r => r.source === "ons-gdp-schedule" && !r.ok)?.error).toContain("date change not verified");
    const cards = [...upcoming.matchAll(/<li\b[^>]*>.*?<\/li>/g)];
    const monthly = cards.find(x => x[0].includes('href="/releases/gdpmonthlyestimateukoctober2026"'))![0];
    await collectFeeds({ db, fetch: source({ upcoming: upcoming.replace(monthly, ""), cancelled: empty + monthly.replace("Confirmed", "Cancelled") }).fetch, now: now + 2 * 86_400_000, scope: "schedules" });
    expect(events.get(monthlyId)).toMatchObject({ status: "cancelled", starts_at: "2026-12-11T07:00:00.000Z" });
    await collectFeeds({ db, fetch: source().fetch, now: now + 3 * 86_400_000, scope: "schedules" });
    expect(events.get(monthlyId)?.status).toBe("cancelled");
  });

  it.each([403, 429, 503])("preserves schedules and isolates HTTP %d from other sources", async status => {
    const { db, events, runs } = memoryFeedsDb();
    await collectFeeds({ db, fetch: source().fetch, now, scope: "schedules" });
    const saved = events.get(monthlyId);
    await collectFeeds({ db, fetch: source({}, status).fetch, now: now + 86_400_000, scope: "schedules" });
    expect(events.get(monthlyId)).toEqual(saved);
    expect(runs.some(r => r.source === "ons-gdp-schedule" && r.error?.includes(`HTTP ${status}`))).toBe(true);
    expect(runs.filter(r => r.source === "schedules-listed")).toHaveLength(2);
  });

  it("ignores a move notice for another publication", () => {
    const row = onsSchedules(moved, "upcoming", now).find(e => e.id === monthlyId)!;
    const prior = { id: monthlyId, source_uid: row.source_uid!, starts_at: "2026-12-11T07:00:00Z", status: "scheduled" as const, schedule_meta: { sequence: 0 } };
    expect(onsMoveSequence(notice.replace("October 2026", "November 2026"), row, prior)).toBeNull();
  });

  it("applies repeat, move, and cancellation through the existing 0012 writer", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
      for (const migration of ["0009_market_feeds", "0010_market_feeds_sources", "0012_market_event_integrity", "0013_market_release_checks"]) {
        await db.exec(readFileSync(`supabase/migrations/${migration}.sql`, "utf8"));
      }
      const row = onsSchedules(upcoming, "upcoming", now).find(e => e.id === monthlyId)!;
      const move = onsSchedules(moved, "upcoming", now).find(e => e.id === monthlyId)!;
      const apply = async (event: typeof row) => (await db.query<{ result: unknown }>(
        "SELECT public.market_events_apply($1::jsonb,'schedule') AS result", [JSON.stringify([event])],
      )).rows[0].result;
      for (const event of [row, row, { ...move, schedule_meta: { sequence: 2, cancelled: false } }, { ...move, schedule_meta: { sequence: 3, cancelled: true } }]) {
        expect(await apply(event)).toEqual([{ id: monthlyId }]);
      }
      expect(await apply(row)).toEqual([{ id: monthlyId, conflict: "schedule freshness unproven" }]);
      expect((await db.query("SELECT id,status,actual,previous,result_meta FROM public.market_events")).rows)
        .toEqual([{ id: monthlyId, status: "cancelled", actual: null, previous: null, result_meta: null }]);
    } finally {
      await db.close();
    }
  }, 30_000);
});
