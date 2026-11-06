import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CPI_METRICS, cpiReleaseUrl, cpiResults, parseCpiRelease } from "./cpi";
import { listedEvents } from "./schedules";
import { collectFeeds, type Fetcher } from "./collect";
import { memoryFeedsDb } from "./memory-db";
import { scheduleIdentity } from "./identity";
import { blsResults } from "./bls";
import { applyListedCorrections } from "./listed-corrections";

const html = readFileSync("lib/market/feeds/fixtures/cpi-2026-10-14.html", "utf8");
const day = "2026-10-14";
const now = Date.parse("2026-10-14T12:45:00Z");
const events = Object.entries(CPI_METRICS).map(([code, metric]) => scheduleIdentity({
  id: `bls:${code}:${day}`, source: "bls", country: "us", kind: "release", code,
  title: metric.title, importance: 3, starts_at: "2026-10-14T12:30:00Z", time_tbd: false, url: cpiReleaseUrl(day),
}, "2026-09", "regular", null, { sequence: 0 }));

describe("CPI dated BLS release", () => {
  it("reads four explicitly published changes, their period and release vintage from the real archive", () => {
    const release = parseCpiRelease(html, day);
    expect(release).toMatchObject({ period: "2026-09", published: "2026-10-14T12:30:00.000Z" });
    expect(release.values.us_cpi).toEqual({ actual: "+0.6%", previous: "+0.4%" });
    expect(release.values.us_cpi_yoy).toEqual({ actual: "3.7%", previous: "3.4%" });
    expect(release.values.us_core_cpi).toEqual({ actual: "+0.3%", previous: "+0.3%" });
    expect(release.values.us_core_cpi_yoy).toEqual({ actual: "2.6%", previous: "2.4%" });
    expect(cpiResults(events, release)).toHaveLength(4);
    expect(cpiResults(events, release)[0].result_meta).toMatchObject({ series: "CUSR0000SA0", adjustment: "SA", vintage: "release", release_url: cpiReleaseUrl(day) });
  });
  it("rejects wrong release/date/period, changed units, corrected releases and HTML error pages", () => {
    expect(() => parseCpiRelease(html, "2026-10-15")).toThrow("release date");
    expect(() => parseCpiRelease(html.replace("Unadjusted percent change", "Index"), day)).toThrow("headers changed");
    expect(() => parseCpiRelease(html.replace("CONSUMER PRICE INDEX", "Corrected release CONSUMER PRICE INDEX"), day)).toThrow("corrected/reissued");
    expect(() => parseCpiRelease("<html>Access denied</html>", day)).toThrow("not verified");
    expect(cpiResults(events.map(e => ({ ...e, reference_period: "2026-08" })), parseCpiRelease(html, day))).toEqual([]);
  });
  it("never computes initial CPI from current series or aliases four metrics to one identity", () => {
    expect(blsResults(["bls:us_cpi:2026-11-10"], new Map())).toEqual([]);
    const rows = listedEvents().filter(e => e.id.endsWith(":2026-11-10") && e.code?.includes("cpi"));
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map(e => e.identity_key)).size).toBe(4);
    expect(rows.find(e => e.code === "us_cpi")?.id).toBe("bls:us_cpi:2026-11-10");
  });
  it("applies a reviewed CPI move/cancellation to all four metrics without changing identities", () => {
    const moved = applyListedCorrections(events, { [events[0].id]: { starts_at: "2026-10-15T12:30:00Z", cancelled: true, sequence: 1, official_url: "https://www.bls.gov/" } });
    expect(moved.map(e => e.identity_key)).toEqual(events.map(e => e.identity_key));
    for (const event of moved) expect(event).toMatchObject({ starts_at: "2026-10-15T12:30:00Z", schedule_meta: { cancelled: true, sequence: 1 } });
  });
  it("leaves missing/ambiguous values empty and does not guess the previous annual change", () => {
    const changed = html.replace("The all items index rose 3.7", "The all items index increased 3.7");
    const release = parseCpiRelease(changed, day);
    expect(release.values.us_cpi_yoy).toEqual({ actual: "3.7%", previous: null });
    expect(release.values.us_core_cpi_yoy).toEqual({ actual: "2.6%", previous: null });
    const missing = html.replace(/(<td headers="cpipress1.r.1 cpipress1.h.1.8 cpipress1.h.2.10">)[\s\S]*?<\/td>/, "$1—</td>");
    expect(parseCpiRelease(missing, day).values.us_cpi.actual).toBeNull();
  });
  it("uses the official New York release time across DST without deriving the reference period from it", () => {
    // Synthetic winter embargo only; the real September table remains unchanged.
    const winter = html.replace("Wednesday, October 14, 2026", "Thursday, February 11, 2027");
    expect(parseCpiRelease(winter, "2027-02-11")).toMatchObject({ period: "2026-09", published: "2027-02-11T13:30:00.000Z" });
  });
  it("uses only a proven adjacent release for missing annual previous, never an unversioned legacy figure", async () => {
    const release = parseCpiRelease(html, day);
    const prior = events.filter(e => e.code?.endsWith("yoy")).map(e => {
      const result = cpiResults([e], release)[0];
      return { ...e, id: e.id.replace(day, "2026-09-11"), identity_key: null, reference_period: "2026-08", starts_at: "2026-09-11T12:30:00Z", status: "released" as const, actual: "2.1%", result_meta: e.code === "us_cpi_yoy" ? { ...result.result_meta!, period: "2026-08", source_updated: "2026-09-11T12:30:00Z", release_url: cpiReleaseUrl("2026-09-11") } : undefined };
    });
    const { db, events: stored } = memoryFeedsDb({ events: [...events, ...prior] });
    for (const event of prior) stored.set(event.id, event);
    const changed = html.replace("The all items index rose 3.7", "The all items index increased 3.7");
    const fetch: Fetcher = async url => ({ ok: true, status: 200, text: async () => url === cpiReleaseUrl(day) ? changed : "" });
    await collectFeeds({ scope: "releases", db, now, fetch });
    expect(stored.get("bls:us_cpi_yoy:2026-10-14")?.previous).toBe("2.1%");
    expect(stored.get("bls:us_core_cpi_yoy:2026-10-14")?.previous).toBeUndefined();
  });
  it("shares the existing BLS throttle and alternates mixed work after a failed CPI archive", async () => {
    const nfp = scheduleIdentity({ ...events[0], id: "bls:us_nfp:2026-10-14", code: "us_nfp", title: "Employment Situation", identity_key: null }, "2026-09", "regular", null, { sequence: 0 });
    const { db, runs } = memoryFeedsDb({ events: [...events, nfp] });
    const asked: string[] = [];
    const fetch: Fetcher = async url => { asked.push(url); return { ok: false, status: 503, text: async () => "unavailable" }; };
    await collectFeeds({ scope: "releases", db, now, fetch });
    await collectFeeds({ scope: "releases", db, now: now + 60_000, fetch });
    expect(asked.filter(url => url.includes("bls.gov"))).toEqual([cpiReleaseUrl(day)]);
    await collectFeeds({ scope: "releases", db, now: now + 11 * 60_000, fetch });
    expect(asked.filter(url => url.includes("bls.gov"))).toHaveLength(2);
    expect(asked.filter(url => url.includes("bls.gov"))[1]).toContain("api.bls.gov");
    expect(runs.some(r => r.source === "bls-cpi-release" && !r.ok)).toBe(true);
    expect(runs.some(r => r.source === "bea-releases")).toBe(true);
  });
  it("collects once, persists provenance and safely repeats without duplicate events or more BLS requests", async () => {
    const { db, events: stored } = memoryFeedsDb({ events });
    const asked: string[] = [];
    const fetch: Fetcher = async url => { asked.push(url); return { ok: true, status: 200, text: async () => url === cpiReleaseUrl(day) ? html : "" }; };
    await collectFeeds({ scope: "releases", db, now, fetch });
    await collectFeeds({ scope: "releases", db, now: now + 60_000, fetch });
    expect(asked.filter(url => url.includes("bls.gov"))).toEqual([cpiReleaseUrl(day)]);
    expect(stored.size).toBe(4);
    for (const event of stored.values()) expect(event).toMatchObject({ status: "released", result_meta: { vintage: "release", period: "2026-09" } });
  });
});
