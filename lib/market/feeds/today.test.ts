import { describe, expect, it } from "vitest";
import { dayOf, dedupeNews, feed, isImportantEvent, isImportantNews, nextImportant, todayItems, type NewsItem } from "./today";
import type { CalendarEvent } from "./calendar-view";

const ev = (id: string, starts_at: string, o: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id, source: "bls", kind: "release", code: null, country: "us", title: id, importance: 3, starts_at, time_tbd: false, status: "scheduled", actual: null, previous: null, url: null, updated_at: "2026-11-03T10:00:00Z", ...o,
});
const nw = (id: string, published_at: string, o: Partial<NewsItem> = {}): NewsItem => ({
  id, source: "fed", trust: "official", kind: "press_release", country: "us", title: id, summary: null, url: "https://www.federalreserve.gov/x", published_at, importance: 3, dedupe_key: id, ...o,
});

describe("«Today important»", () => {
  it("today is the user's day (Tbilisi midnight to midnight)", () => {
    expect(dayOf(Date.UTC(2026, 10, 3, 12), "Asia/Tbilisi")).toEqual({ from: Date.UTC(2026, 10, 2, 20), to: Date.UTC(2026, 10, 3, 20) });
    // 21:30 UTC on Tuesday is already Wednesday in Tbilisi
    expect(dayOf(Date.UTC(2026, 10, 3, 21, 30), "Asia/Tbilisi").from).toBe(Date.UTC(2026, 10, 3, 20));
  });

  it("events: high importance, and every decision and press conference; cancelled never", () => {
    expect(isImportantEvent(ev("a", "x"))).toBe(true);
    expect(isImportantEvent(ev("b", "x", { importance: 2 }))).toBe(false);
    expect(isImportantEvent(ev("c", "x", { importance: 2, kind: "decision" }))).toBe(true);
    expect(isImportantEvent(ev("d", "x", { importance: 1, kind: "press_conference" }))).toBe(true);
    expect(isImportantEvent(ev("e", "x", { status: "cancelled" }))).toBe(false);
    expect(isImportantEvent(ev("uk-gdp", "x", { source: "ons", country: "gb" }))).toBe(true);
  });

  it("includes eligible ONS GDP today and next, respecting UK filters while keeping US and EA coverage", () => {
    const now = Date.parse("2026-11-12T06:30:00Z");
    const day = dayOf(now, "Europe/London");
    const uk = ev("ons:gb_gdp_monthly:2026-09", "2026-11-12T07:00:00Z", { source: "ons", country: "gb" });
    const events = [
      uk,
      ev("ons:gb_gdp_qna:2026-q3", "2026-11-12T06:45:00Z", { source: "ons", country: "gb", importance: 2 }),
      ev("ons:gb_gdp_first:2026-q3", "2026-11-12T06:50:00Z", { source: "ons", country: "gb", status: "cancelled" }),
      ev("us", "2026-11-12T13:30:00Z"),
      ev("eu", "2026-11-12T14:30:00Z", { source: "ecb", country: "eu" }),
    ];
    expect(nextImportant(events, now, { countries: ["gb"], importance: ["high"] })).toBe(uk);
    for (const filters of [{ countries: ["us"] as const, importance: ["high"] as const }, { countries: ["gb"] as const, importance: ["medium"] as const }]) {
      const prefs = { countries: [...filters.countries], importance: [...filters.importance] };
      expect(nextImportant(events, now, prefs)?.id).toBe("us");
      expect(todayItems(events, [], day, prefs).map(item => item.type === "event" && item.event.id)).toEqual(["us", "eu"]);
    }
    expect(todayItems(events, [], day, { countries: ["gb"], importance: ["high"] }).map(item => item.type === "event" && item.event.id))
      .toEqual([uk.id, "us", "eu"]);
  });

  it("news: decisions and press conferences always; policy speeches (medium or high); the rest only when high", () => {
    expect(isImportantNews(nw("a", "x", { kind: "decision", importance: 1 }))).toBe(true);
    expect(isImportantNews(nw("b", "x", { kind: "speech", importance: 2 }))).toBe(true);
    expect(isImportantNews(nw("c", "x", { kind: "speech", importance: 1 }))).toBe(false); // supervision, AI talks
    expect(isImportantNews(nw("d", "x", { source: "whitehouse", kind: "presidential_action", importance: 3 }))).toBe(true);
    expect(isImportantNews(nw("e", "x", { source: "whitehouse", kind: "presidential_action", importance: 2 }))).toBe(false);
  });

  it("one timeline of today's events and news by time; repeats merged; other days left out", () => {
    const day = dayOf(Date.UTC(2026, 10, 3, 12), "Asia/Tbilisi");
    const items = todayItems(
      [ev("jolts", "2026-11-03T15:00:00Z", { importance: 2 }), ev("nfp", "2026-11-06T13:30:00Z"), ev("ecb", "2026-11-03T13:15:00Z", { kind: "decision", importance: 3 })],
      [nw("st1", "2026-11-03T19:00:00Z", { kind: "decision", dedupe_key: "k" }), nw("st2", "2026-11-03T19:00:00Z", { kind: "decision", dedupe_key: "k" }), nw("old", "2026-11-02T10:00:00Z")],
      day
    );
    expect(items.map((i) => (i.type === "event" ? i.event.id : i.news.id))).toEqual(["ecb", "st1"]);
  });

  it("the nearest important event still to come, today or later", () => {
    const now = Date.UTC(2026, 10, 3, 12);
    const events = [ev("past", "2026-11-03T11:00:00Z"), ev("released", "2026-11-03T13:00:00Z", { status: "released" }), ev("low", "2026-11-04T10:00:00Z", { importance: 1 }), ev("nfp", "2026-11-06T13:30:00Z"), ev("cpi", "2026-11-10T13:30:00Z")];
    expect(nextImportant(events, now)?.id).toBe("nfp");
    expect(nextImportant([], now)).toBeNull();
  });

  it("the feed: newest first, the chosen importance, repeats merged", () => {
    const items = [nw("a", "2026-11-01T10:00:00Z"), nw("b", "2026-11-03T10:00:00Z", { importance: 2 }), nw("c", "2026-11-02T10:00:00Z", { dedupe_key: "a" })];
    expect(feed(items, [3]).map((n) => n.id)).toEqual(["c"]);
    expect(feed(items, [3, 2]).map((n) => n.id)).toEqual(["b", "c"]);
    expect(dedupeNews(items).map((n) => n.id)).toEqual(["a", "b"]);
  });
});
