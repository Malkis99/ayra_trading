import { describe, it, expect } from "vitest";
import { dayKeyInZone, mondayOfKey } from "./day-key";
import { getPropFirmDayKey } from "./journal/prop";

// Day edges (TEST-FIX): the game day and its week in the account zone, the prop day at its reset hour.
// Fixed instants only; nothing here reads the clock or the zone of the machine.

describe("the game day and its week at day edges", () => {
  const cases: Array<{ at: string; tz: string; day: string; monday: string; what: string }> = [
    { what: "UTC, evening before midnight", at: "2026-11-15T23:59:00Z", tz: "UTC", day: "2026-11-15", monday: "2026-11-09" },
    { what: "UTC, first minute of Monday", at: "2026-11-16T00:01:00Z", tz: "UTC", day: "2026-11-16", monday: "2026-11-16" },
    { what: "Tbilisi, Sunday 23:59", at: "2026-11-15T19:59:00Z", tz: "Asia/Tbilisi", day: "2026-11-15", monday: "2026-11-09" },
    { what: "Tbilisi, Monday 00:01 (still Sunday in UTC)", at: "2026-11-15T20:01:00Z", tz: "Asia/Tbilisi", day: "2026-11-16", monday: "2026-11-16" },
    { what: "Tbilisi, a month end", at: "2026-11-30T20:05:00Z", tz: "Asia/Tbilisi", day: "2026-12-01", monday: "2026-11-30" },
    { what: "UTC, a month end", at: "2026-11-30T23:55:00Z", tz: "UTC", day: "2026-11-30", monday: "2026-11-30" },
    { what: "Tbilisi, a year end", at: "2026-12-31T20:05:00Z", tz: "Asia/Tbilisi", day: "2027-01-01", monday: "2026-12-28" },
    { what: "UTC, a year end", at: "2026-12-31T23:55:00Z", tz: "UTC", day: "2026-12-31", monday: "2026-12-28" },
  ];
  for (const c of cases) {
    it(c.what, () => {
      const day = dayKeyInZone(new Date(c.at), c.tz);
      expect(day).toBe(c.day);
      expect(mondayOfKey(day)).toBe(c.monday);
    });
  }
});

describe("the prop day at its reset hour", () => {
  it("midnight does not start a new prop day; the reset hour does (UTC and Tbilisi)", () => {
    for (const [tz, off] of [["UTC", 0], ["Asia/Tbilisi", 4]] as const) {
      const at = (local: string) => new Date(Date.parse(`${local}:00Z`) - off * 3600_000);
      const reset = { timezone: tz, hour: 17 };
      // 23:55 and 00:05 belong to the prop day that began at 17:00 the day before
      expect(getPropFirmDayKey(at("2026-11-15T23:55"), reset)).toBe("2026-11-15");
      expect(getPropFirmDayKey(at("2026-11-16T00:05"), reset)).toBe("2026-11-15");
      expect(getPropFirmDayKey(at("2026-11-16T16:59"), reset)).toBe("2026-11-15");
      expect(getPropFirmDayKey(at("2026-11-16T17:00"), reset)).toBe("2026-11-16");
      // a month end and a year end
      expect(getPropFirmDayKey(at("2026-12-01T00:05"), reset)).toBe("2026-11-30");
      expect(getPropFirmDayKey(at("2027-01-01T00:05"), reset)).toBe("2026-12-31");
      // with the reset at midnight the prop day is the calendar day
      expect(getPropFirmDayKey(at("2026-11-15T23:59"), { timezone: tz, hour: 0 })).toBe("2026-11-15");
      expect(getPropFirmDayKey(at("2026-11-16T00:01"), { timezone: tz, hour: 0 })).toBe("2026-11-16");
    }
  });
});
