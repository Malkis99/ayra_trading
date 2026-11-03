import { describe, expect, it } from "vitest";
import { clockIn, countByDay, eventsOfDay, initialDay, lastUpdate, noOwnCountry, visibleEvents, workWeek, type CalendarEvent } from "./calendar-view";

const ev = (id: string, starts_at: string, o: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  source: "bls",
  kind: "release",
  code: null,
  country: "us",
  title: id,
  importance: 3,
  starts_at,
  time_tbd: false,
  status: "scheduled",
  actual: null,
  previous: null,
  url: null,
  updated_at: "2026-11-03T10:00:00Z",
  ...o,
});

describe("own calendar: the week in the user's zone", () => {
  const TBILISI = "Asia/Tbilisi"; // UTC+4, no summer time

  it("Monday to Friday of the current week; the days start at the user's midnight", () => {
    const tue = Date.UTC(2026, 10, 3, 12); // Tuesday 3 November
    const days = workWeek(tue, TBILISI, 0);
    expect(days.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(days[0].from).toBe(Date.UTC(2026, 10, 1, 20)); // Monday 00:00 in Tbilisi
    expect(days[4].to).toBe(Date.UTC(2026, 10, 6, 20)); // Saturday 00:00 in Tbilisi
    expect(initialDay(days, tue)).toBe("2026-11-03");
    expect(workWeek(tue, TBILISI, 1)[0].date).toBe("2026-11-09");
  });

  it("on Saturday and Sunday «this week» is the coming one", () => {
    expect(workWeek(Date.UTC(2026, 10, 7, 12), TBILISI, 0)[0].date).toBe("2026-11-09");
    expect(workWeek(Date.UTC(2026, 10, 8, 12), TBILISI, 0)[0].date).toBe("2026-11-09");
    expect(workWeek(Date.UTC(2026, 10, 8, 12), TBILISI, 1)[0].date).toBe("2026-11-16");
    const days = workWeek(Date.UTC(2026, 10, 8, 12), TBILISI, 0);
    expect(initialDay(days, Date.UTC(2026, 10, 8, 12))).toBe("2026-11-09");
  });

  it("New York: the clocks change inside a week, each day still starts at local midnight", () => {
    const days = workWeek(Date.UTC(2027, 2, 10, 15), "America/New_York", 0); // the week of 8 March 2027 (summer time from 14 March)
    expect(days[0].from).toBe(Date.UTC(2027, 2, 8, 5)); // EST
    const after = workWeek(Date.UTC(2027, 2, 16, 15), "America/New_York", 0);
    expect(after[0].from).toBe(Date.UTC(2027, 2, 15, 4)); // EDT
  });

  it("an event belongs to the user's day, not the UTC one; time to be announced goes last", () => {
    const days = workWeek(Date.UTC(2026, 10, 3, 12), TBILISI, 0);
    const late = ev("ecb-late", "2026-11-05T21:30:00Z"); // 01:30 on Friday in Tbilisi
    const nfp = ev("nfp", "2026-11-06T13:30:00Z");
    const tbd = ev("tbd", "2026-11-06T00:00:00Z", { time_tbd: true });
    const friday = days[4];
    expect(eventsOfDay([tbd, nfp, late], friday).map((e) => e.id)).toEqual(["ecb-late", "nfp", "tbd"]);
    expect(eventsOfDay([late], days[3])).toEqual([]);
    expect(countByDay([late, nfp], days)["2026-11-06"]).toBe(2);
    expect(clockIn(Date.parse(nfp.starts_at), TBILISI)).toBe("17:30");
  });

  it("filters: importance and our two countries; nothing to show when neither is chosen", () => {
    const rows = [ev("a", "2026-11-06T13:30:00Z"), ev("b", "2026-11-06T13:30:00Z", { importance: 2 }), ev("c", "2026-11-06T13:30:00Z", { country: "eu", importance: 1 })];
    expect(visibleEvents(rows, { importance: ["high", "medium"], countries: ["us", "eu"] }).map((e) => e.id)).toEqual(["a", "b"]);
    expect(visibleEvents(rows, { importance: ["low"], countries: ["eu"] }).map((e) => e.id)).toEqual(["c"]);
    expect(noOwnCountry(["gb", "jp"])).toBe(true);
    expect(noOwnCountry(["gb", "eu"])).toBe(false);
  });

  it("the «updated» time is the newest change", () => {
    expect(lastUpdate([ev("a", "x", { updated_at: "2026-11-03T10:00:00Z" }), ev("b", "x", { updated_at: "2026-11-03T12:05:00Z" })])).toBe(Date.UTC(2026, 10, 3, 12, 5));
    expect(lastUpdate([])).toBeNull();
  });
});
