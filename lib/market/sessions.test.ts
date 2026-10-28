import { describe, expect, it } from "vitest";
import {
  ALL_SESSIONS,
  MAIN_SESSIONS,
  clockOf,
  convertClock,
  countdown,
  currentOrNext,
  dayBounds,
  dayOffset,
  defaultSessionHours,
  displayZoneOf,
  gapBackToUsual,
  hoursOf,
  instantOf,
  intervalLabel,
  isForexOpen,
  isValidWindow,
  killzoneDefs,
  londonNewYorkGapHours,
  londonNewYorkOverlap,
  normalizeDisplay,
  normalizeKillzones,
  normalizeSettings,
  occurrences,
  primaryOccurrence,
  progressOf,
  sessionDefs,
  splitDuration,
  statusFromList,
  upcomingEvents,
  wallAt,
  type SessionId,
  type WindowDef,
} from "./sessions";

const utc = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const S = sessionDefs();
const KZ = killzoneDefs();
/** The occurrence of a session whose start falls on this UTC date. */
const startingOn = (def: WindowDef, day: string) => occurrences(def, utc(`${day}T12:00:00Z`)).find((o) => iso(o.start).startsWith(day));
const UTC3 = "Etc/GMT-3"; // a fixed UTC+3 (the sign of Etc zones is reversed)

describe("default hours: the owner's table in UTC+3 for the northern summer", () => {
  it("Wednesday 15 July 2026", () => {
    const ref = utc("2026-07-15T09:00:00Z");
    const expected: Record<SessionId, string> = {
      asia: "02:00–11:00",
      hongkong: "03:00–12:00",
      frankfurt: "09:00–18:00",
      london: "10:00–19:00",
      newyork: "16:30–01:00 (+1)",
      chicago: "17:00–02:00 (+1)",
      wellington: "23:00–08:00 (+1)",
      sydney: "01:00–10:00",
    };
    for (const id of ALL_SESSIONS) {
      // the occurrence that starts on 15 July in UTC+3
      const o = occurrences(S[id], ref).find((x) => wallAt(x.start, UTC3).d === 15)!;
      expect(`${id}: ${hoursOf(o, UTC3)}`).toBe(`${id}: ${expected[id]}`);
    }
  });
});

describe("summer time of every country, on its own dates", () => {
  it("USA, 1 November: New York opens 13:30 UTC on Friday 30 Oct, 14:30 UTC on Monday 2 Nov", () => {
    expect(iso(startingOn(S.newyork, "2026-10-30")!.start)).toBe("2026-10-30T13:30");
    expect(iso(startingOn(S.newyork, "2026-11-02")!.start)).toBe("2026-11-02T14:30");
    expect(iso(startingOn(S.chicago, "2026-10-30")!.start)).toBe("2026-10-30T14:00");
    expect(iso(startingOn(S.chicago, "2026-11-02")!.start)).toBe("2026-11-02T15:00");
  });

  it("Europe, 29 March: London and Frankfurt an hour earlier in UTC", () => {
    expect(iso(startingOn(S.london, "2026-03-23")!.start)).toBe("2026-03-23T08:00");
    expect(iso(startingOn(S.london, "2026-03-30")!.start)).toBe("2026-03-30T07:00");
    expect(iso(startingOn(S.frankfurt, "2026-03-23")!.start)).toBe("2026-03-23T07:00");
    expect(iso(startingOn(S.frankfurt, "2026-03-30")!.start)).toBe("2026-03-30T06:00");
  });

  it("Australia: summer time ends 5 April and starts 4 October (Sydney)", () => {
    expect(iso(startingOn(S.sydney, "2026-04-02")!.start)).toBe("2026-04-02T21:00"); // Fri 3 Apr 08:00 AEDT
    expect(iso(startingOn(S.sydney, "2026-04-07")!.start)).toBe("2026-04-07T22:00"); // Wed 8 Apr 08:00 AEST
    expect(iso(startingOn(S.sydney, "2026-10-01")!.start)).toBe("2026-10-01T22:00"); // Fri 2 Oct 08:00 AEST
    expect(iso(startingOn(S.sydney, "2026-10-06")!.start)).toBe("2026-10-06T21:00"); // Wed 7 Oct 08:00 AEDT
  });

  it("New Zealand: summer time ends 5 April and starts 27 September (Wellington)", () => {
    expect(iso(startingOn(S.wellington, "2026-04-01")!.start)).toBe("2026-04-01T19:00"); // Thu 2 Apr 08:00 NZDT
    expect(iso(startingOn(S.wellington, "2026-04-06")!.start)).toBe("2026-04-06T20:00"); // Tue 7 Apr 08:00 NZST
    expect(iso(startingOn(S.wellington, "2026-09-24")!.start)).toBe("2026-09-24T20:00"); // Fri 25 Sep 08:00 NZST
    expect(iso(startingOn(S.wellington, "2026-09-28")!.start)).toBe("2026-09-28T19:00"); // Tue 29 Sep 08:00 NZDT
  });

  it("Tokyo and Hong Kong have no summer time", () => {
    expect(iso(startingOn(S.asia, "2026-01-12")!.start)).toBe("2026-01-12T23:00");
    expect(iso(startingOn(S.asia, "2026-07-12")!.start)).toBe("2026-07-12T23:00");
    expect(iso(startingOn(S.hongkong, "2026-01-13")!.start)).toBe("2026-01-13T00:00");
    expect(iso(startingOn(S.hongkong, "2026-07-14")!.start)).toBe("2026-07-14T00:00");
  });

  it("killzones live in New York time and move with the USA", () => {
    expect(iso(startingOn(KZ[0], "2026-10-30")!.start)).toBe("2026-10-30T06:00");
    expect(iso(startingOn(KZ[0], "2026-11-02")!.start)).toBe("2026-11-02T07:00");
  });
});

describe("the forex week: sessions are never open while the market is closed", () => {
  it("Sunday 17:00 – Friday 17:00 New York time", () => {
    expect(isForexOpen(utc("2026-03-07T12:00:00Z"))).toBe(false); // Saturday
    expect(isForexOpen(utc("2026-03-08T20:59:00Z"))).toBe(false); // Sunday 16:59 EDT
    expect(isForexOpen(utc("2026-03-08T21:00:00Z"))).toBe(true); // Sunday 17:00 EDT
    expect(isForexOpen(utc("2026-03-13T20:59:00Z"))).toBe(true); // Friday 16:59 EDT
    expect(isForexOpen(utc("2026-03-13T21:00:00Z"))).toBe(false); // Friday 17:00 EDT
  });

  it("Friday: New York closes at 17:00 with the market, not at 18:00; Chicago at 16:00 Chicago time", () => {
    const ny = startingOn(S.newyork, "2026-10-30")!;
    expect([clockOf(ny.start, "America/New_York"), clockOf(ny.end, "America/New_York")]).toEqual(["09:30", "17:00"]);
    const chi = startingOn(S.chicago, "2026-10-30")!;
    expect(clockOf(chi.end, "America/Chicago")).toBe("16:00");
    // on another weekday New York runs until 18:00
    expect(clockOf(startingOn(S.newyork, "2026-10-29")!.end, "America/New_York")).toBe("18:00");
  });

  it("Sunday evening: no New York or Chicago «session» from 17:00 when the market opens — only working days of the city", () => {
    const sunday = utc("2026-11-08T23:00:00Z"); // Sunday 18:00 New York, the market is open
    expect(isForexOpen(sunday)).toBe(true);
    expect(statusFromList("newyork", occurrences(S.newyork, sunday), sunday).state).toBe("closed");
    expect(statusFromList("chicago", occurrences(S.chicago, sunday), sunday).state).toBe("closed");
    for (const id of ["newyork", "chicago", "london", "frankfurt"] as const) {
      const days = occurrences(S[id], sunday).map((o) => wallAt(o.start, S[id].zone).wd);
      expect(days).not.toContain(0);
      expect(days).not.toContain(6);
    }
  });

  it("Friday evening: Sydney's Saturday morning does not happen", () => {
    const list = occurrences(S.sydney, utc("2026-10-28T12:00:00Z"), 8);
    const saturdays = list.filter((o) => wallAt(o.start, "Australia/Sydney").wd === 6);
    expect(saturdays).toHaveLength(0);
  });

  it("Sunday evening: Sydney's Monday starts when the market opens if that is later than 08:00 Sydney", () => {
    // November: Sydney 08:00 AEDT = Sunday 16:00 New York (before the opening) → starts at 17:00 New York = 09:00 Sydney
    const nov = occurrences(S.sydney, utc("2026-11-08T12:00:00Z")).find((o) => wallAt(o.start, "Australia/Sydney").wd === 1)!;
    expect(iso(nov.start)).toBe("2026-11-08T22:00");
    expect(clockOf(nov.start, "Australia/Sydney")).toBe("09:00");
    // July: Sydney 08:00 AEST = Sunday 18:00 New York (after the opening) → as usual
    const jul = occurrences(S.sydney, utc("2026-07-12T12:00:00Z")).find((o) => wallAt(o.start, "Australia/Sydney").wd === 1)!;
    expect(clockOf(jul.start, "Australia/Sydney")).toBe("08:00");
    // Wellington's Monday in July: 08:00 NZST = Sunday 16:00 New York → from 09:00 Wellington
    const wel = occurrences(S.wellington, utc("2026-07-12T12:00:00Z")).find((o) => wallAt(o.start, "Pacific/Auckland").wd === 1)!;
    expect(clockOf(wel.start, "Pacific/Auckland")).toBe("09:00");
  });

  it("on Saturday everything is closed, and the first opening is Sydney's Monday on Sunday evening", () => {
    const sat = utc("2026-03-07T12:00:00Z");
    for (const id of ALL_SESSIONS) expect(statusFromList(id, occurrences(S[id], sat), sat)).toMatchObject({ state: "closed", weekend: true });
    const [first] = upcomingEvents([...ALL_SESSIONS.map((id) => S[id]), ...KZ], sat, 5);
    expect(`${first.id}:${first.edge}@${iso(first.at)}`).toBe("sydney:start@2026-03-08T21:00");
  });
});

describe("hours of the user", () => {
  it("valid: «HH:MM», start ≠ end; across midnight is allowed", () => {
    expect(isValidWindow("02:00", "05:00")).toBe(true);
    expect(isValidWindow("20:00", "03:00")).toBe(true);
    expect(isValidWindow("02:00", "02:00")).toBe(false);
    expect(isValidWindow("2:00", "05:00")).toBe(false);
    expect(isValidWindow("24:00", "01:00")).toBe(false);
  });

  it("a session across midnight in its own city ends on the next day", () => {
    const tokyo = sessionDefs({ ...defaultSessionHours(), asia: { start: "20:00", end: "03:00" } }).asia;
    const o = startingOn(tokyo, "2026-07-14")!; // Wed 15 Jul? no: 20:00 JST on 14 Jul = 11:00 UTC on 14 Jul
    expect([iso(o.start), iso(o.end)]).toEqual(["2026-07-14T11:00", "2026-07-14T18:00"]);
  });

  it("converting hours between the display time and the city: London 08:00 = 04:00 New York this week, and back", () => {
    const ref = utc("2026-10-28T12:00:00Z");
    expect(convertClock("08:00", "Europe/London", "America/New_York", ref)).toBe("04:00");
    expect(convertClock("04:00", "America/New_York", "Europe/London", ref)).toBe("08:00");
    // the usual week: 5 hours apart
    expect(convertClock("08:00", "Europe/London", "America/New_York", utc("2026-11-04T12:00:00Z"))).toBe("03:00");
    expect(convertClock("08:00", "Europe/London", "UTC", ref)).toBe("08:00");
  });

  it("the overlap follows the configured London and New York hours", () => {
    const ref = utc("2026-10-28T12:00:00Z");
    const usual = londonNewYorkOverlap(ref, 8, S.london, S.newyork).find((o) => iso(o.start).startsWith("2026-10-28"))!;
    expect([iso(usual.start), iso(usual.end)]).toEqual(["2026-10-28T13:30", "2026-10-28T17:00"]);
    const longer = sessionDefs({ ...defaultSessionHours(), london: { start: "08:00", end: "18:00" } });
    const o = londonNewYorkOverlap(ref, 8, longer.london, longer.newyork).find((x) => iso(x.start).startsWith("2026-10-28"))!;
    expect(iso(o.end)).toBe("2026-10-28T18:00");
  });
});

describe("settings on the device", () => {
  it("display time: New York by default; my zone; UTC; another zone; a broken value falls back", () => {
    expect(displayZoneOf(normalizeDisplay(null), "Asia/Tbilisi")).toBe("America/New_York");
    expect(displayZoneOf({ kind: "profile" }, "Asia/Tbilisi")).toBe("Asia/Tbilisi");
    expect(displayZoneOf({ kind: "utc" }, "Asia/Tbilisi")).toBe("UTC");
    expect(displayZoneOf(normalizeDisplay({ kind: "zone", zone: "Asia/Dubai" }), "Asia/Tbilisi")).toBe("Asia/Dubai");
    expect(normalizeDisplay({ kind: "zone", zone: "Mars/Olympus" })).toEqual({ kind: "newyork" });
  });

  it("killzones saved before 1.1b are kept; broken session hours fall back per session", () => {
    const s = normalizeSettings(null, { londonKz: { start: "03:00", end: "06:00" } });
    expect(s.killzones.londonKz).toEqual({ start: "03:00", end: "06:00" });
    expect(s.killzones.newyorkKz).toEqual({ start: "07:00", end: "10:00" });
    const t = normalizeSettings({ sessions: { london: { start: "07:00", end: "16:00" }, newyork: { start: "x", end: "y" } } });
    expect(t.sessions.london).toEqual({ start: "07:00", end: "16:00" });
    expect(t.sessions.newyork).toEqual({ start: "09:30", end: "18:00" });
    expect(normalizeKillzones({ londonKz: { start: "05:00", end: "05:00" } }).londonKz).toEqual({ start: "02:00", end: "05:00" });
  });
});

describe("status, labels and the day", () => {
  it("open: until when; closed on a weekday: the next opening, not «weekend»", () => {
    const at = utc("2026-04-06T09:00:00Z"); // Monday
    const london = statusFromList("london", occurrences(S.london, at), at);
    expect(london.state).toBe("open");
    if (london.state === "open") expect(iso(london.end)).toBe("2026-04-06T16:00");
    const ny = statusFromList("newyork", occurrences(S.newyork, at), at);
    expect(ny).toMatchObject({ state: "closed", weekend: false });
    if (ny.state === "closed") expect(iso(ny.next!.start)).toBe("2026-04-06T13:30");
  });

  it("one interval across the user's midnight: «17:30–02:00 (+1)»; a window from the day before: «18:30 (−1)–02:00»", () => {
    const zone = "Asia/Tbilisi";
    const tue = utc("2026-04-07T08:00:00Z");
    const d1 = dayBounds(tue, zone);
    expect(intervalLabel(primaryOccurrence(occurrences(S.newyork, tue), d1.from, d1.to)!, zone, d1.from, d1.to)).toBe("17:30–02:00 (+1)");
    const sat = utc("2026-03-07T08:00:00Z"); // Friday's New York (cut at 17:00 New York) reaches into Saturday here
    const d2 = dayBounds(sat, zone);
    expect(intervalLabel(primaryOccurrence(occurrences(S.newyork, sat), d2.from, d2.to)!, zone, d2.from, d2.to)).toBe("18:30 (−1)–02:00");
  });

  it("card hours, day offsets, the countdown and the progress", () => {
    const now = utc("2026-04-06T08:30:00Z");
    const ny = currentOrNext(occurrences(S.newyork, now), now)!;
    expect(hoursOf(ny, "Asia/Tbilisi")).toBe("17:30–02:00 (+1)");
    expect(hoursOf(ny, "America/New_York")).toBe("09:30–18:00");
    expect(dayOffset(ny.start, now, "Asia/Tbilisi")).toBe(0);
    expect(countdown(2 * 3600_000 + 14 * 60_000 + 9_000)).toEqual({ d: 0, hms: "02:14:09" });
    expect(countdown(-5)).toEqual({ d: 0, hms: "00:00:00" });
    expect(countdown(44 * 3600_000)).toEqual({ d: 1, hms: "20:00:00" });
    expect(progressOf({ id: "london", start: 1000, end: 5000 }, 2000)).toBe(0.25);
  });

  it("the next 5 events of the main sessions and killzones, in order", () => {
    const now = utc("2026-04-06T08:30:00Z");
    const events = upcomingEvents([...MAIN_SESSIONS.map((id) => S[id]), ...KZ], now, 5).map((e) => `${e.id}:${e.edge}@${iso(e.at).slice(11)}`);
    expect(events).toEqual(["londonKz:end@09:00", "newyorkKz:start@11:00", "newyork:start@13:30", "newyorkKz:end@14:00", "london:end@16:00"]);
  });

  it("a day with the clock change is 23 hours long (London, 29 March 2026)", () => {
    const { from, to } = dayBounds(utc("2026-03-29T12:00:00Z"), "Europe/London");
    expect((to - from) / 3600_000).toBe(23);
  });

  it("the London–New York gap: 5 hours usually, 4 when the clocks moved on different dates — and until when", () => {
    expect(londonNewYorkGapHours(utc("2026-04-06T12:00:00Z"))).toBe(5);
    expect(londonNewYorkGapHours(utc("2026-10-28T12:00:00Z"))).toBe(4);
    expect(iso(gapBackToUsual(utc("2026-10-28T12:00:00Z"))!).slice(0, 10)).toBe("2026-11-01");
    expect(iso(gapBackToUsual(utc("2026-03-16T12:00:00Z"))!).slice(0, 10)).toBe("2026-03-29");
  });

  it("helpers: the hour skipped by summer time moves forward; durations round up", () => {
    expect(iso(instantOf(2026, 3, 8, 2, 30, "America/New_York"))).toBe("2026-03-08T07:30");
    expect(splitDuration(80 * 60_000)).toEqual({ d: 0, h: 1, m: 20 });
    expect(splitDuration(80 * 60_000 + 1)).toEqual({ d: 0, h: 1, m: 21 });
  });
});
