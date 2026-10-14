import { describe, it, expect } from "vitest";
import { allTimeZones, browserTimeZone, timeZoneLabel, timeZoneOptions, tzCity, tzRegion } from "./timezones";

describe("time zones", () => {
  const d = new Date("2026-01-15T12:00:00Z");
  it("lists every zone the runtime knows, including UTC and the current one", () => {
    const all = allTimeZones("Mars/Base");
    expect(all.length).toBeGreaterThan(300);
    expect(all).toContain("UTC");
    expect(all[0]).toBe("Mars/Base");
    expect(browserTimeZone()).toBeTruthy();
  });
  it("localised labels with the UTC offset", () => {
    expect(timeZoneLabel("Asia/Tbilisi", "ru", d)).toMatch(/^Грузия.* · UTC\+4$/);
    expect(timeZoneLabel("America/New_York", "en", d)).toMatch(/UTC−5$/);
    expect(timeZoneLabel("UTC", "ru", d)).toBe("UTC+0");
  });
  it("options keep the IANA id as value, grouped by region, with the city for search", () => {
    const opts = timeZoneOptions("Asia/Tbilisi", "ru", d);
    const tb = opts.find((o) => o.value === "Asia/Tbilisi")!;
    expect(tb.region).toBe("Asia");
    expect(tb.description).toBe("Tbilisi");
    expect(opts.filter((o) => o.value === "Europe/Paris")).toHaveLength(1);
    expect(opts.filter((o) => o.value === "Europe/Berlin")).toHaveLength(1);
    const regions = opts.map((o) => o.region);
    expect(regions.indexOf("Europe")).toBeLessThan(regions.indexOf("Asia"));
    expect(tzCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(tzRegion("Etc/GMT+3")).toBe("Other");
  });
});
