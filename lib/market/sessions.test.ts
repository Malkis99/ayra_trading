import { describe, expect, it } from "vitest";
import {
  SESSIONS,
  clockOf,
  dayBounds,
  instantOf,
  isForexOpen,
  isValidWindow,
  killzoneDefs,
  normalizeKillzones,
  occurrences,
  splitDuration,
  londonNewYorkOverlap,
  primaryOccurrence,
  intervalLabel,
  londonNewYorkGapHours,
  gapBackToUsual,
  windowStatus,
  windowsInRange,
  type WindowDef,
} from "./sessions";

const utc = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const def = (id: string) => [...SESSIONS, ...killzoneDefs()].find((d) => d.id === id) as WindowDef;
/** The occurrence that starts on this UTC date. */
const onDay = (id: string, day: string) => occurrences(def(id), utc(`${day}T12:00:00Z`)).find((o) => iso(o.start).startsWith(day));

describe("sessions follow summer time of Europe and of the USA (different dates)", () => {
  it("winter in both (2 March 2026): London 08:00 UTC, New York 13:00 UTC, London killzone 07:00 UTC", () => {
    expect(iso(onDay("london", "2026-03-02")!.start)).toBe("2026-03-02T08:00");
    expect(iso(onDay("newyork", "2026-03-02")!.start)).toBe("2026-03-02T13:00");
    expect(iso(onDay("londonKz", "2026-03-02")!.start)).toBe("2026-03-02T07:00");
    expect(iso(onDay("newyorkKz", "2026-03-02")!.start)).toBe("2026-03-02T12:00");
  });

  it("USA already in summer time, Europe not yet (16 March 2026): New York moves an hour earlier in UTC, London does not", () => {
    expect(iso(onDay("london", "2026-03-16")!.start)).toBe("2026-03-16T08:00");
    expect(iso(onDay("newyork", "2026-03-16")!.start)).toBe("2026-03-16T12:00");
    // killzones live in New York time: they move with the USA
    expect(iso(onDay("londonKz", "2026-03-16")!.start)).toBe("2026-03-16T06:00");
  });

  it("summer in both (6 April 2026): London 07:00 UTC, New York 12:00 UTC", () => {
    expect(iso(onDay("london", "2026-04-06")!.start)).toBe("2026-04-06T07:00");
    expect(iso(onDay("newyork", "2026-04-06")!.start)).toBe("2026-04-06T12:00");
  });

  it("autumn: Europe back to winter time (25 Oct), the USA not yet (1 Nov) — 26 October 2026", () => {
    expect(iso(onDay("london", "2026-10-26")!.start)).toBe("2026-10-26T08:00");
    expect(iso(onDay("newyork", "2026-10-26")!.start)).toBe("2026-10-26T12:00");
    expect(iso(onDay("newyork", "2026-11-02")!.start)).toBe("2026-11-02T13:00");
  });

  it("Tokyo has no summer time: 09:00 JST is always 00:00 UTC", () => {
    expect(iso(onDay("asia", "2026-03-16")!.start)).toBe("2026-03-16T00:00");
    expect(iso(onDay("asia", "2026-07-06")!.start)).toBe("2026-07-06T00:00");
  });
});

describe("weekends", () => {
  it("the forex week: Sunday 17:00 – Friday 17:00 New York time", () => {
    expect(isForexOpen(utc("2026-03-07T12:00:00Z"))).toBe(false); // Saturday
    expect(isForexOpen(utc("2026-03-08T20:59:00Z"))).toBe(false); // Sunday 16:59 EDT (US summer time from that morning)
    expect(isForexOpen(utc("2026-03-08T21:00:00Z"))).toBe(true); // Sunday 17:00 EDT
    expect(isForexOpen(utc("2026-03-13T20:59:00Z"))).toBe(true); // Friday 16:59 EDT
    expect(isForexOpen(utc("2026-03-13T21:00:00Z"))).toBe(false); // Friday 17:00 EDT
  });

  it("on Saturday everything is closed, «weekend», and the next opening is on Monday", () => {
    const sat = utc("2026-03-07T12:00:00Z");
    const london = windowStatus(def("london"), sat);
    expect(london).toMatchObject({ state: "closed", weekend: true });
    if (london.state !== "closed") throw new Error();
    expect(iso(london.next!.start)).toBe("2026-03-09T08:00");
    const asia = windowStatus(def("asia"), sat);
    if (asia.state !== "closed") throw new Error();
    // Monday 09:00 in Tokyo is still Sunday evening in Europe and America
    expect(iso(asia.next!.start)).toBe("2026-03-09T00:00");
  });

  it("no Saturday sessions and no Sunday London / New York", () => {
    const week = occurrences(def("london"), utc("2026-03-04T12:00:00Z"), 7).map((o) => new Date(o.start).getUTCDay());
    expect(week).not.toContain(6);
    expect(week).not.toContain(0);
    const tokyo = occurrences(def("asia"), utc("2026-03-04T12:00:00Z"), 7).map((o) => iso(o.start).slice(0, 10));
    expect(tokyo).not.toContain("2026-03-07"); // Saturday in Tokyo = Friday night in New York, after the close
    expect(tokyo).toContain("2026-03-09"); // Monday in Tokyo = Sunday evening in New York, after the opening
  });
});

describe("status now", () => {
  it("open: until when", () => {
    const s = windowStatus(def("london"), utc("2026-04-06T09:00:00Z"));
    expect(s.state).toBe("open");
    if (s.state === "open") expect(iso(s.end)).toBe("2026-04-06T16:00");
  });

  it("closed on a weekday: the next opening the same day, not «weekend»", () => {
    const s = windowStatus(def("newyork"), utc("2026-04-06T09:00:00Z"));
    expect(s).toMatchObject({ state: "closed", weekend: false });
    if (s.state === "closed") expect(iso(s.next!.start)).toBe("2026-04-06T12:00");
  });
});

describe("the user's day", () => {
  it("London on 6 April 2026 in Tbilisi (UTC+4): 11:00–20:00", () => {
    const zone = "Asia/Tbilisi";
    const { from, to } = dayBounds(utc("2026-04-06T09:00:00Z"), zone);
    const [london] = windowsInRange(def("london"), from, to);
    expect(clockOf(london.start, zone)).toBe("11:00");
    expect(clockOf(london.end, zone)).toBe("20:00");
  });

  it("a day with the clock change is 23 hours long (London, 29 March 2026)", () => {
    const { from, to } = dayBounds(utc("2026-03-29T12:00:00Z"), "Europe/London");
    expect((to - from) / 3600_000).toBe(23);
  });

  it("a window crossing the user's midnight is cut at the day's edges", () => {
    const zone = "America/Los_Angeles"; // Tokyo 09:00–18:00 = 17:00–02:00 here in April
    const { from, to } = dayBounds(utc("2026-04-07T19:00:00Z"), zone);
    const parts = windowsInRange(def("asia"), from, to);
    expect(parts.length).toBe(2);
    expect(parts[0].start).toBe(from);
    expect(parts[1].end).toBe(to);
  });
});

describe("killzone settings", () => {
  it("valid: both times, start before end", () => {
    expect(isValidWindow("02:00", "05:00")).toBe(true);
    expect(isValidWindow("05:00", "02:00")).toBe(false);
    expect(isValidWindow("02:00", "02:00")).toBe(false);
    expect(isValidWindow("2:00", "05:00")).toBe(false);
    expect(isValidWindow("24:00", "25:00")).toBe(false);
  });

  it("broken storage falls back to the default per killzone", () => {
    expect(normalizeKillzones(null).londonKz).toEqual({ start: "02:00", end: "05:00" });
    expect(normalizeKillzones({ londonKz: { start: "03:00", end: "06:00" }, newyorkKz: { start: "x", end: "y" } })).toEqual({
      londonKz: { start: "03:00", end: "06:00" },
      newyorkKz: { start: "07:00", end: "10:00" },
    });
  });

  it("a changed killzone moves with New York time", () => {
    const kz = killzoneDefs({ londonKz: { start: "01:30", end: "04:30" }, newyorkKz: { start: "08:30", end: "11:00" } });
    const ny = occurrences(kz[1], utc("2026-04-06T12:00:00Z")).find((o) => iso(o.start).startsWith("2026-04-06"))!;
    expect(iso(ny.start)).toBe("2026-04-06T12:30");
    expect(iso(ny.end)).toBe("2026-04-06T15:00");
  });
});

describe("helpers", () => {
  it("instantOf: the hour skipped by summer time moves forward", () => {
    // 02:30 on 8 March 2026 does not exist in New York
    expect(iso(instantOf(2026, 3, 8, 2, 30, "America/New_York"))).toBe("2026-03-08T07:30");
  });

  it("splitDuration rounds up to a minute", () => {
    expect(splitDuration(80 * 60_000)).toEqual({ d: 0, h: 1, m: 20 });
    expect(splitDuration(80 * 60_000 + 1)).toEqual({ d: 0, h: 1, m: 21 });
    expect(splitDuration(26 * 3600_000)).toEqual({ d: 1, h: 2, m: 0 });
  });
});

describe("readability helpers", () => {
  it("London + New York overlap: 4 hours in summer, 5 hours while only the USA is on summer time", () => {
    const apr = londonNewYorkOverlap(utc("2026-04-06T06:00:00Z")).find((o) => iso(o.start).startsWith("2026-04-06"))!;
    expect([iso(apr.start), iso(apr.end)]).toEqual(["2026-04-06T12:00", "2026-04-06T16:00"]);
    const mar = londonNewYorkOverlap(utc("2026-03-16T06:00:00Z")).find((o) => iso(o.start).startsWith("2026-03-16"))!;
    expect([iso(mar.start), iso(mar.end)]).toEqual(["2026-03-16T12:00", "2026-03-16T17:00"]);
  });

  it("one interval across the user's midnight: «16:00–01:00 (+1)»", () => {
    const zone = "Asia/Tbilisi";
    const ms = utc("2026-04-07T08:00:00Z"); // Tuesday: yesterday's New York tail and today's start
    const { from, to } = dayBounds(ms, zone);
    const o = primaryOccurrence(occurrences(def("newyork"), ms), from, to)!;
    expect(intervalLabel(o, zone, from, to)).toBe("16:00–01:00 (+1)");
  });

  it("a window that started the day before: «17:00 (−1)–02:00»", () => {
    const zone = "Asia/Tbilisi";
    const ms = utc("2026-03-07T08:00:00Z"); // Saturday: only Friday's New York session reaches into it
    const { from, to } = dayBounds(ms, zone);
    const o = primaryOccurrence(occurrences(def("newyork"), ms), from, to)!;
    expect(intervalLabel(o, zone, from, to)).toBe("17:00 (−1)–02:00");
    expect(primaryOccurrence(occurrences(def("london"), ms), from, to)).toBeNull();
  });

  it("the London–New York gap: 5 hours usually, 4 when the clocks moved on different dates — and until when", () => {
    expect(londonNewYorkGapHours(utc("2026-04-06T12:00:00Z"))).toBe(5);
    expect(londonNewYorkGapHours(utc("2026-03-16T12:00:00Z"))).toBe(4);
    expect(londonNewYorkGapHours(utc("2026-10-28T12:00:00Z"))).toBe(4);
    expect(gapBackToUsual(utc("2026-04-06T12:00:00Z"))).toBeNull();
    expect(iso(gapBackToUsual(utc("2026-03-16T12:00:00Z"))!).slice(0, 10)).toBe("2026-03-29");
    expect(iso(gapBackToUsual(utc("2026-10-28T12:00:00Z"))!).slice(0, 10)).toBe("2026-11-01");
  });
});
