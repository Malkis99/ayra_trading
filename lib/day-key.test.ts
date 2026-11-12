import { describe, it, expect } from "vitest";
import { addDaysToKey, dayKeyInZone, deviceDayKey, mondayOfKey, weekdayOfKey } from "./day-key";

describe("game day key (account time zone)", () => {
  it("uses the account zone, not UTC and not the device", () => {
    // 20:30 UTC on the 12th is already the 13th in Tbilisi (UTC+4)
    expect(dayKeyInZone(new Date("2026-11-12T20:30:00Z"), "Asia/Tbilisi")).toBe("2026-11-13");
    // 03:30 UTC on the 13th is still the 12th in New York (UTC−5)
    expect(dayKeyInZone(new Date("2026-11-13T03:30:00Z"), "America/New_York")).toBe("2026-11-12");
    expect(dayKeyInZone(new Date("2026-11-12T23:59:59Z"), "UTC")).toBe("2026-11-12");
  });

  it("handles the extreme zones and the change to winter time", () => {
    const t = new Date("2026-11-12T11:00:00Z");
    expect(dayKeyInZone(t, "Pacific/Kiritimati")).toBe("2026-11-13"); // UTC+14
    expect(dayKeyInZone(t, "Etc/GMT+12")).toBe("2026-11-11"); // UTC−12
    // New York leaves summer time on 2026-11-01 at 06:00 UTC: the date does not jump
    expect(dayKeyInZone(new Date("2026-11-01T05:30:00Z"), "America/New_York")).toBe("2026-11-01");
    expect(dayKeyInZone(new Date("2026-11-01T06:30:00Z"), "America/New_York")).toBe("2026-11-01");
    expect(dayKeyInZone(new Date("2026-11-02T04:59:00Z"), "America/New_York")).toBe("2026-11-01");
    expect(dayKeyInZone(new Date("2026-11-02T05:00:00Z"), "America/New_York")).toBe("2026-11-02");
  });

  it("falls back to the device date for an empty or unknown zone", () => {
    const t = new Date("2026-11-12T12:00:00Z");
    expect(dayKeyInZone(t, "")).toBe(deviceDayKey(t));
    expect(dayKeyInZone(t, "Not/AZone")).toBe(deviceDayKey(t));
    expect(dayKeyInZone(t, null)).toBe(deviceDayKey(t));
  });

  it("does calendar arithmetic on keys", () => {
    expect(addDaysToKey("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDaysToKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(weekdayOfKey("2026-11-16")).toBe(0); // Monday
    expect(weekdayOfKey("2026-11-15")).toBe(6); // Sunday
    expect(mondayOfKey("2026-11-15")).toBe("2026-11-09");
    expect(mondayOfKey("2026-11-16")).toBe("2026-11-16");
  });
});
